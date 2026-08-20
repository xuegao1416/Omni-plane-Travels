import type {
  ModuleRevisionCheckpoint,
  ModuleRuntimeId,
  ModuleRuntimeMetrics,
  ModuleStateRecord,
} from './types';

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function recordBytes(record: ModuleStateRecord): number {
  return new TextEncoder().encode(JSON.stringify(record)).byteLength;
}

function statesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

/**
 * In-memory authority for independently revisioned module partitions.
 * Persistence is deliberately handled by the save adapter so reads and
 * gameplay transactions remain synchronous.
 */
export class ModuleRuntimeRegistry {
  private readonly current = new Map<ModuleRuntimeId, ModuleStateRecord>();
  private readonly history = new Map<ModuleRuntimeId, Map<number, ModuleStateRecord>>();
  private readonly dirty = new Set<ModuleRuntimeId>();

  constructor(private readonly saveId: string) {}

  initialize<T>(moduleId: ModuleRuntimeId, state: T, schemaVersion = 1): ModuleStateRecord<T> {
    const existing = this.current.get(moduleId);
    if (existing) return cloneValue(existing) as ModuleStateRecord<T>;
    const record: ModuleStateRecord<T> = {
      saveId: this.saveId,
      moduleId,
      revision: 0,
      schemaVersion,
      updatedAt: Date.now(),
      state: cloneValue(state),
    };
    this.remember(record);
    this.dirty.add(moduleId);
    return cloneValue(record);
  }

  importRecord<T>(record: ModuleStateRecord<T>): void {
    if (record.saveId !== this.saveId) {
      throw new Error(`Module state belongs to ${record.saveId}, expected ${this.saveId}`);
    }
    this.remember(cloneValue(record));
    this.dirty.delete(record.moduleId);
  }

  importHistoryRecord<T>(record: ModuleStateRecord<T>): void {
    if (record.saveId !== this.saveId) {
      throw new Error(`Module checkpoint belongs to ${record.saveId}, expected ${this.saveId}`);
    }
    const copy = cloneValue(record) as ModuleStateRecord;
    const revisions = this.history.get(record.moduleId) ?? new Map<number, ModuleStateRecord>();
    revisions.set(record.revision, copy);
    this.history.set(record.moduleId, revisions);
  }

  read<T>(moduleId: ModuleRuntimeId): T | undefined {
    const record = this.current.get(moduleId);
    return record ? cloneValue(record.state as T) : undefined;
  }

  getRecord<T>(moduleId: ModuleRuntimeId): ModuleStateRecord<T> | undefined {
    const record = this.current.get(moduleId);
    return record ? cloneValue(record) as ModuleStateRecord<T> : undefined;
  }

  syncState<T>(moduleId: ModuleRuntimeId, state: T, schemaVersion = 1): ModuleStateRecord<T> {
    const current = this.current.get(moduleId);
    if (!current) return this.initialize(moduleId, state, schemaVersion);
    if (statesEqual(current.state, state)) return cloneValue(current) as ModuleStateRecord<T>;
    return this.update<T>(moduleId, () => state);
  }

  listCurrentRecords(): ModuleStateRecord[] {
    return [...this.current.values()].map(record => cloneValue(record));
  }

  listCheckpointRecords(): ModuleStateRecord[] {
    const records: ModuleStateRecord[] = [];
    for (const revisions of this.history.values()) {
      for (const record of revisions.values()) records.push(cloneValue(record));
    }
    return records.sort((a, b) => a.moduleId.localeCompare(b.moduleId) || a.revision - b.revision);
  }

  update<T = Record<string, any>>(
    moduleId: ModuleRuntimeId,
    updater: (state: T) => T,
  ): ModuleStateRecord<T> {
    const current = this.current.get(moduleId);
    if (!current) throw new Error(`Module partition is not initialized: ${moduleId}`);
    const nextState = updater(cloneValue(current.state as T));
    const next: ModuleStateRecord<T> = {
      ...current,
      revision: current.revision + 1,
      updatedAt: Date.now(),
      state: cloneValue(nextState),
    };
    this.remember(next);
    this.dirty.add(moduleId);
    return cloneValue(next);
  }

  checkpoint(): ModuleRevisionCheckpoint {
    const checkpoint: ModuleRevisionCheckpoint = {};
    for (const [moduleId, record] of this.current) checkpoint[moduleId] = record.revision;
    return checkpoint;
  }

  restore(checkpoint: ModuleRevisionCheckpoint): void {
    for (const [moduleId, revision] of Object.entries(checkpoint) as Array<[ModuleRuntimeId, number | undefined]>) {
      if (revision === undefined) continue;
      const revisions = this.history.get(moduleId);
      let record = revisions?.get(revision);
      if (!record && revisions?.size) {
        const available = [...revisions.keys()].sort((left, right) => left - right);
        const fallbackRevision = [...available].reverse().find(candidate => candidate <= revision) ?? available[0];
        record = revisions.get(fallbackRevision);
        console.warn(`[module-runtime] ${moduleId} revision ${revision} missing; restored nearest revision ${fallbackRevision}`);
      }
      if (!record) {
        console.warn(`[module-runtime] ${moduleId} revision ${revision} missing and no checkpoint is available; current state retained`);
        continue;
      }
      this.current.set(moduleId, cloneValue(record));
      this.dirty.add(moduleId);
    }
  }

  drainDirtyRecords(): ModuleStateRecord[] {
    const records = [...this.dirty]
      .map(moduleId => this.current.get(moduleId))
      .filter((record): record is ModuleStateRecord => Boolean(record))
      .map(record => cloneValue(record));
    this.dirty.clear();
    return records;
  }

  measure(): ModuleRuntimeMetrics {
    const partitions: ModuleRuntimeMetrics['partitions'] = {};
    let totalBytes = 0;
    for (const [moduleId, record] of this.current) {
      const bytes = recordBytes(record);
      partitions[moduleId] = bytes;
      totalBytes += bytes;
    }
    return { totalBytes, partitions };
  }

  private remember<T>(record: ModuleStateRecord<T>): void {
    const copy = cloneValue(record) as ModuleStateRecord;
    this.current.set(record.moduleId, copy);
    const revisions = this.history.get(record.moduleId) ?? new Map<number, ModuleStateRecord>();
    revisions.set(record.revision, copy);
    this.history.set(record.moduleId, revisions);
  }
}

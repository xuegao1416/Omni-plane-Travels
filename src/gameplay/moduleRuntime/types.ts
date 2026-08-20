export const MODULE_RUNTIME_IDS = [
  'stat',
  'progression',
  'survival',
  'business',
  'dice',
  'profession',
] as const;

export type ModuleRuntimeId = typeof MODULE_RUNTIME_IDS[number];

export interface ModuleStateRecord<T = unknown> {
  saveId: string;
  moduleId: ModuleRuntimeId;
  revision: number;
  schemaVersion: number;
  updatedAt: number;
  state: T;
}

export type ModuleRevisionCheckpoint = Partial<Record<ModuleRuntimeId, number>>;

export interface ModuleRuntimeMetrics {
  totalBytes: number;
  partitions: Partial<Record<ModuleRuntimeId, number>>;
}

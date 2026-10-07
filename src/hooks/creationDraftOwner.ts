import { z } from 'zod';
import type { PlayerProfile } from '../storage/db';
import { STORAGE_KEYS } from '../config/storageKeys';

export interface CreationDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface CreationDraft {
  selectedWorld: string;
  profile: PlayerProfile;
  step: number;
  segments: Record<string, string>;
  includeAgeStages: boolean;
  started: boolean;
  updatedAt: number;
  warning: string;
}
type DraftPatch = Partial<Omit<CreationDraft, 'warning' | 'updatedAt'>>;
export interface CreationDraftOperation {
  readonly signal: AbortSignal;
  readonly inputs: CreationDraft;
  isCurrent(): boolean;
  commit(patch: DraftPatch): boolean;
  finish(): boolean;
}

export function emptyCreationProfile(): PlayerProfile {
  return { name: '', gender: '', age: '', background: '', personality: '', appearance: '', career: '', socialClass: '', organization: '', specialIdentity: '', perspective: '第三人称', initialSkills: {}, initialItems: {}, customNpcs: [], combatRiskMode: 'normal' };
}
function emptyDraft(selectedWorld = 'default', started = false): CreationDraft {
  return { selectedWorld, profile: emptyCreationProfile(), step: 1, segments: {}, includeAgeStages: true, started, updatedAt: Date.now(), warning: '' };
}
const number = z.number().finite();
const stringRecord = z.record(z.string(), z.string());
const numberRecord = z.record(z.string(), number);
const quality = z.enum(['普通', '精良', '稀有', '史诗', '传说']);
const skills = z.record(z.string(), z.object({ 品质: quality, 描述: z.string(), 类型: z.string() }));
const items = z.record(z.string(), z.object({ 数量: number, 类型: z.string(), 品质: quality, 备注: z.string() }));
const npc = z.object({
  id: z.string(), name: z.string(), gender: z.string(), age: z.string(), race: z.string(), relationshipType: z.string(), occupation: z.string(), socialStatus: z.string(), personality: z.string(), hiddenPersonality: z.string(), currentThought: z.string(), appearance: z.string(), currentOutfit: z.string(), currentAction: z.string(), currentLocation: z.string(), currentState: z.string(), shortTermGoal: z.string(), longTermGoal: z.string(), background: z.string(), chronicles: z.array(z.string()),
  skillsList: z.record(z.string(), z.object({ 描述: z.string(), 类型: z.string(), 品质: z.string() })),
  itemsList: z.record(z.string(), z.object({ 数量: number, 类型: z.string(), 品质: z.string(), 备注: z.string() })),
  survivalStats: numberRecord.optional(), tierIndex: number.int().optional(),
});
const profileSchema = z.object({
  name: z.string(), gender: z.string(), age: z.string(), background: z.string(), personality: z.string(), appearance: z.string(), career: z.string(), socialClass: z.string(), organization: z.string(), specialIdentity: z.string(),
  perspective: z.enum(['第一人称', '第二人称', '第三人称']), initialSkills: skills, initialItems: items, customNpcs: z.array(npc),
  directorRole: z.object({ definitionId: z.string(), version: z.string(), mode: z.enum(['custom', 'original']), actorId: z.string().optional(), startStageId: z.string() }).optional(),
  portrait: z.object({ source: z.enum(['default', 'custom']), customDataUrl: z.string().optional(), zoom: number, positionX: number, positionY: number, fileName: z.string().optional() }).optional(),
  moduleInitData: z.record(z.string(), z.json()).optional(), professionId: z.string().nullable().optional(), innateTalentIds: z.array(z.string()).optional(),
  combatRiskMode: z.enum(['easy', 'normal', 'hard', 'inferno']).optional(), creationPointAllocations: numberRecord.optional(), creationDrawCount: number.int().nonnegative().optional(), creationDrawnTalentIds: z.array(z.string()).optional(),
});
const storedDraftSchema = z.object({ version: z.literal(1), draft: z.object({
  selectedWorld: z.string().min(1), profile: profileSchema, step: number.int().min(1).max(6), segments: stringRecord, includeAgeStages: z.boolean(), started: z.boolean(), updatedAt: number.optional(),
}) });

// React consumes a stable immutable projection; request inputs never share caller-owned objects.
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const immutable = <T>(value: T): T => freeze(structuredClone(value));
const READ_WARNING = '创建草稿无法读取。当前填写仅保留在本次会话；原始草稿记录仍保留。重新开始可替换它。';
const SAVE_WARNING = '草稿已保留在本次会话，但本地保存失败；刷新会丢失未保存修改。请重试保存。';

export class CreationDraftOwner {
  private snapshot: CreationDraft;
  private readonly listeners = new Set<() => void>();
  private readonly operations = new Map<string, AbortController>();
  private preserveUnreadableRecord = false;

  constructor(private readonly storage: CreationDraftStorage) {
    this.snapshot = immutable(emptyDraft());
    try {
      const raw = storage.getItem(STORAGE_KEYS.JOURNEY_CREATION_DRAFT);
      if (raw === null) return;
      const saved = storedDraftSchema.parse(JSON.parse(raw));
      this.snapshot = immutable({ ...emptyDraft(), ...saved.draft, warning: '' });
    } catch {
      this.preserveUnreadableRecord = true;
      this.snapshot = immutable({ ...emptyDraft(), warning: READ_WARNING });
    }
  }
  getSnapshot = (): CreationDraft => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  hasDraft = (): boolean => this.snapshot.started || Boolean(this.snapshot.profile.name.trim() || Object.values(this.snapshot.segments).some(text => text.trim()));
  private publish(next: CreationDraft): void { this.snapshot = immutable(next); for (const listener of this.listeners) listener(); }
  private save(next: CreationDraft): void {
    // AI responses are untrusted at the same boundary as restored records. Invalid
    // proposals must leave both the last usable projection and its persisted form intact.
    storedDraftSchema.parse({ version: 1, draft: next });
    let warning = '';
    if (this.preserveUnreadableRecord) warning = READ_WARNING;
    else {
      try {
        const { warning: _warning, ...draft } = next;
        this.storage.setItem(STORAGE_KEYS.JOURNEY_CREATION_DRAFT, JSON.stringify({ version: 1, draft }));
      } catch { warning = SAVE_WARNING; }
    }
    this.publish({ ...next, warning });
  }
  edit = (patch: DraftPatch): void => {
    // Any player edit changes the premises of in-flight AI work, including nested profile edits.
    this.cancelOperations();
    this.save({ ...this.snapshot, ...structuredClone(patch), updatedAt: Date.now() });
  };
  retrySave = (): void => this.save(this.snapshot);
  reset = (worldId = this.snapshot.selectedWorld): void => {
    this.cancelOperations(); this.preserveUnreadableRecord = false;
    this.save(emptyDraft(worldId, true));
  };
  complete = (): void => {
    this.cancelOperations(); this.preserveUnreadableRecord = false;
    this.save(emptyDraft(this.snapshot.selectedWorld));
  };
  cancelOperation = (key: string): void => {
    const controller = this.operations.get(key);
    this.operations.delete(key); controller?.abort();
  };
  cancelOperations = (): void => { for (const key of [...this.operations.keys()]) this.cancelOperation(key); };
  beginOperation = (key: string): CreationDraftOperation => {
    // Simultaneous generators would race on the same creation document.
    this.cancelOperations();
    const controller = new AbortController();
    this.operations.set(key, controller);
    const isCurrent = () => !controller.signal.aborted && this.operations.get(key) === controller;
    return {
      signal: controller.signal, inputs: this.snapshot, isCurrent,
      commit: patch => {
        if (!isCurrent()) return false;
        this.save({ ...this.snapshot, ...structuredClone(patch), updatedAt: Date.now() });
        return true;
      },
      finish: () => { if (!isCurrent()) return false; this.operations.delete(key); return true; },
    };
  };
}

let browserOwner: CreationDraftOwner | undefined;
export function getCreationDraftOwner(): CreationDraftOwner {
  return browserOwner ??= new CreationDraftOwner({
    getItem: key => globalThis.localStorage.getItem(key),
    setItem: (key, value) => globalThis.localStorage.setItem(key, value),
  });
}

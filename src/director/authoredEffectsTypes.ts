import type { CustomModuleLifecycle } from '../custom-modules/runtime';

/** Immutable author declarations, copied only by the trusted source binder. */
export type DirectorAuthoredEffect =
  | { type: 'npc.move'; actorId: string; location: string }
  | { type: 'npc.die'; actorId: string; status?: string }
  | { type: 'module.rule'; moduleId: string; moduleVersion: string; lifecycle: CustomModuleLifecycle; ruleId: string }
  | { type: 'uniqueItem.transfer'; moduleId: string; moduleVersion: string; itemId: string; ownerField: string; expectedOwner: string; newOwner: string };

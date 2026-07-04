/**
 * 世界书相关共享类型
 *
 * 使用方：inGameWorldBook、worldBookEditor
 */

import type { WorldBookEntryDef } from '../data/worlds-schema';

/** 编辑态条目：WorldBookEntryDef + 临时脏标记 */
export type EditModeEntry = WorldBookEntryDef & { _dirty?: boolean };

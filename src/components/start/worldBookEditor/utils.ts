import type { WorldBookEntryDef } from '../../../data/worlds-schema';
import type { EditModeEntry } from './types';

/** 去除编辑态 _dirty 标记，返回纯数据 */
export function cleanEntries(entries: EditModeEntry[]): WorldBookEntryDef[] {
  return entries.map(({ _dirty, ...rest }) => rest);
}

/** 创建新触发式条目 */
export function createNewEntry(uid: number, order: number): EditModeEntry {
  return {
    uid,
    key: [],
    comment: '新条目',
    content: '',
    constant: false,
    order,
    position: 'after_char',
    _dirty: true,
  };
}

// 记忆系统数组字段深度归一化 — 防御 AI 返回字符串/undefined 导致 spread 崩溃

/**
 * 确保返回字符串数组
 */
export function ensureStrArray(val: unknown): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter((v): v is string => typeof v === 'string');
  if (typeof val === 'string') return [val];
  return [];
}

/**
 * 确保返回数组
 */
export function asArr<T = unknown>(val: unknown): T[] {
  if (!val) return [];
  if (Array.isArray(val)) return val as T[];
  return [val] as T[];
}

/**
 * 深度归一化一个对象的所有数组字段
 * 遍历对象的每个字段，如果是 string[] 类型声明但实际不是数组的，转为数组
 */
export function normalizeObjectArrays<T extends Record<string, unknown>>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj;
  const result = { ...obj };
  for (const [key, val] of Object.entries(result)) {
    if (val === undefined || val === null) {
      // 保留 null/undefined
      continue;
    }
    if (typeof val === 'string') {
      // 字符串可能是数组字段的误值 — 不自动转换，由调用方决定
      continue;
    }
    if (Array.isArray(val)) {
      // 递归归一化数组元素中的对象
      (result as Record<string, unknown>)[key] = val.map(item =>
        item && typeof item === 'object' ? normalizeObjectArrays(item) : item
      );
    } else if (typeof val === 'object') {
      // 递归归一化嵌套对象
      (result as Record<string, unknown>)[key] = normalizeObjectArrays(val as Record<string, unknown>);
    }
  }
  return result;
}

/**
 * 归一化线程（thread）对象
 */
export function normalizeThread<T extends Record<string, unknown>>(thread: T): T {
  const arrayFields = ['relatedLocations', 'relatedEntities', 'relatedEvents', 'tags', 'keywords', 'participants'];
  const result = { ...thread };
  for (const field of arrayFields) {
    if (field in result) {
      (result as any)[field] = ensureStrArray((result as any)[field]);
    }
  }
  return result;
}

/**
 * 归一化事件卡（event card）对象
 */
export function normalizeEventCard<T extends Record<string, unknown>>(card: T): T {
  const arrayFields = ['tags', 'keywords', 'relatedEntities', 'relatedLocations', 'triggers', 'effects'];
  const result = { ...card };
  for (const field of arrayFields) {
    if (field in result) {
      (result as any)[field] = ensureStrArray((result as any)[field]);
    }
  }
  return result;
}

/**
 * 归一化实体卡（entity card）对象
 */
export function normalizeEntityCard<T extends Record<string, unknown>>(card: T): T {
  const arrayFields = ['tags', 'aliases', 'traits', 'relations', 'roles', 'knownLocations'];
  const result = { ...card };
  for (const field of arrayFields) {
    if (field in result) {
      (result as any)[field] = ensureStrArray((result as any)[field]);
    }
  }
  return result;
}

/**
 * 通用归一化入口 — 根据对象类型自动选择归一化函数
 */
export function normalizeMemoryObject<T extends Record<string, unknown>>(obj: T): T {
  if (!obj) return obj;
  // 检测对象类型
  if ('participants' in obj || 'relatedLocations' in obj) {
    return normalizeThread(obj);
  }
  if ('triggers' in obj || 'effects' in obj) {
    return normalizeEventCard(obj);
  }
  if ('aliases' in obj || 'traits' in obj) {
    return normalizeEntityCard(obj);
  }
  // 通用归一化
  return normalizeObjectArrays(obj);
}

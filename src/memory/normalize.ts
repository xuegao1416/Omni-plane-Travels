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

/** 归一化事实治理元数据；旧存档没有这些字段时保持可运行并使用保守默认值。 */
export function normalizeProvenance<T extends Record<string, unknown>>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj;
  const result = { ...obj } as Record<string, unknown>;
  const sourceTypes = new Set(['world_fact', 'plot_fact', 'system_state', 'player_statement', 'npc_statement', 'player_inference', 'summary', 'unknown']);
  const layers = new Set(['fact', 'state', 'inference', 'summary']);
  const conflictStatuses = new Set(['none', 'disputed', 'superseded', 'rejected']);
  const sourceType = String(result.sourceType ?? '').trim();
  const layer = String(result.layer ?? '').trim();
  const normalizedSourceType = sourceTypes.has(sourceType) ? sourceType : 'unknown';
  const normalizedLayer = layers.has(layer)
    ? layer
    : normalizedSourceType === 'player_inference' ? 'inference'
      : normalizedSourceType === 'system_state' ? 'state'
        : normalizedSourceType === 'summary' ? 'summary' : 'fact';
  // 推测不能伪装成世界事实；这是运行时边界，不只依赖提示词约束。
  if (normalizedLayer === 'inference' || normalizedSourceType === 'player_inference') {
    result.sourceType = 'player_inference';
    result.layer = 'inference';
  } else {
    result.sourceType = normalizedSourceType;
    result.layer = normalizedLayer;
  }
  const confidence = Number(result.confidence);
  result.confidence = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5;
  for (const field of ['validFromRound', 'validUntilRound']) {
    const value = result[field];
    result[field] = value === null || value === undefined || value === ''
      ? null
      : Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : null;
  }
  if (result.evidence !== undefined) result.evidence = ensureStrArray(result.evidence).slice(0, 8);
  // 原始事件账本是不可变证据链；来源 ID 不能按存档瘦身策略静默截断。
  if (result.sourceEventIds !== undefined) {
    result.sourceEventIds = [...new Set(ensureStrArray(result.sourceEventIds))];
  }
  if (result.supersedesId !== undefined && result.supersedesId !== null) result.supersedesId = String(result.supersedesId);
  if (result.previousVersionId !== undefined && result.previousVersionId !== null) result.previousVersionId = String(result.previousVersionId);
  const conflictStatus = String(result.conflictStatus ?? '').trim();
  result.conflictStatus = conflictStatuses.has(conflictStatus) ? conflictStatus : 'none';
  return result as T;
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
  const result = normalizeProvenance({ ...thread });
  for (const field of arrayFields) {
    if (field in result) {
      (result as any)[field] = ensureStrArray((result as any)[field]);
    }
  }
  const statuses = new Set(['open', 'blocked', 'suspended', 'resolved', 'failed', 'superseded']);
  (result as Record<string, unknown>).status = statuses.has(String(result.status)) ? result.status : 'open';
  return result;
}

/**
 * 归一化事件卡（event card）对象
 */
export function normalizeEventCard<T extends Record<string, unknown>>(card: T): T {
  const arrayFields = ['tags', 'keywords', 'relatedEntities', 'relatedLocations', 'triggers', 'effects'];
  const result = normalizeProvenance({ ...card });
  for (const field of arrayFields) {
    if (field in result) {
      (result as any)[field] = ensureStrArray((result as any)[field]);
    }
  }
  const statuses = new Set(['hot', 'warm', 'cold']);
  (result as Record<string, unknown>).status = statuses.has(String(result.status)) ? result.status : 'hot';
  return result;
}

/** 归一化状态槽及关系对象的运行时枚举；旧存档可能带有未知字符串。 */
export function normalizeStateSlot<T extends Record<string, unknown>>(slot: T): T {
  const result = normalizeProvenance({ ...slot });
  const statuses = new Set(['active', 'resolved', 'expired']);
  (result as Record<string, unknown>).status = statuses.has(String(result.status)) ? result.status : 'active';
  return result as T;
}

export function normalizeRelationEdge<T extends Record<string, unknown>>(edge: T): T {
  const result = normalizeProvenance({ ...edge });
  const statuses = new Set(['active', 'broken', 'changed']);
  (result as Record<string, unknown>).status = statuses.has(String(result.status)) ? result.status : 'active';
  return result as T;
}

export function normalizeRelationNetworkItem<T extends Record<string, unknown>>(item: T): T {
  const result = normalizeProvenance({ ...item });
  const statuses = new Set(['active', 'changed', 'broken', 'superseded']);
  (result as Record<string, unknown>).status = statuses.has(String(result.status)) ? result.status : 'active';
  return result as T;
}

/**
 * 归一化实体卡（entity card）对象
 */
export function normalizeEntityCard<T extends Record<string, unknown>>(card: T): T {
  const arrayFields = ['tags', 'aliases', 'traits', 'relations', 'roles', 'knownLocations', 'currentStatus', 'stableFacts', 'affiliations', 'relatedThreads', 'relatedEvents', 'sourceEventIds'];
  const result = normalizeProvenance({ ...card });
  for (const field of arrayFields) {
    if (field in result) {
      (result as any)[field] = ensureStrArray((result as any)[field]);
    }
  }
  if (result.layer === 'inference' || result.sourceType === 'player_inference') {
    const inferredFacts = ensureStrArray((result as any).stableFacts);
    if (inferredFacts.length > 0) {
      const existingHistory = Array.isArray((result as any).factHistory) ? (result as any).factHistory : [];
      (result as any).factHistory = [...existingHistory, ...inferredFacts.map(fact => ({ fact, recordedAt: Date.now(), sourceType: 'player_inference', layer: 'inference', confidence: result.confidence }))].slice(-20);
      (result as any).stableFacts = [];
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

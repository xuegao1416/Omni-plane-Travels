/**
 * 状态差异：把一次结算前后的状态对比成逐路径的 before/after 记录。
 * 变量面板的「撤销」与机械日志都基于它，所以记录的是实际存储路径。
 */
export interface StateChange {
  path: string;
  before: unknown;
  after: unknown;
}

/**
 * 内部账本字段：变化不进日志，也不参与撤销。
 * 后四项是只给界面看的流水（经营账本与报表、物资流水、事件卡历史），每回合整段变化，
 * 记进日志会让 200 条日志膨胀到上 MB。
 */
export const BOOKKEEPING_PATHS = [
  'gameplay.logs',
  'gameplay.sequence',
  'gameplay.eventHistory',
  'gameplay.pendingEvents',
  'gameplay.rng',
  'gameplay.settlementKeys',
  'moduleRevisions',
  'simulationRuntime.effectLog',
  'economy.ledger',
  'economy.reports',
  'resources.ledger',
  'eventDirector.history',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isBookkeeping(path: string, ignore: readonly string[]): boolean {
  return ignore.some(prefix => path === prefix || path.startsWith(`${prefix}.`));
}

function clone<T>(value: T): T {
  return value === undefined || value === null || typeof value !== 'object' ? value : structuredClone(value);
}

export function diffStates(before: unknown, after: unknown, ignore: readonly string[] = BOOKKEEPING_PATHS): StateChange[] {
  const changes: StateChange[] = [];
  const visit = (left: unknown, right: unknown, path: string) => {
    if (path && isBookkeeping(path, ignore)) return;
    if (Object.is(left, right)) return;
    if (isRecord(left) && isRecord(right)) {
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
        visit(left[key], right[key], path ? `${path}.${key}` : key);
      }
      return;
    }
    if (Array.isArray(left) && Array.isArray(right) && JSON.stringify(left) === JSON.stringify(right)) return;
    if (!path) return;
    changes.push({ path, before: clone(left), after: clone(right) });
  };
  visit(before, after, '');
  return changes;
}

// 玩家决策日志 —— 记录选择卡（路径 C）最终选中的 aiNote，
// 供下一轮 AI 叙事作为「玩家决策」上下文注入。
// 轻量模块级存储，不依赖 React / 存档库，便于单测 mock。

export interface PlayerDecision {
  note: string;
  round: number;
  at: number;
}

const MAX_RECENT = 8;
const recent: PlayerDecision[] = [];

/** 记录一条玩家决策（仅取其 aiNote 文本）。 */
export function recordPlayerDecision(note: string, round = 0): void {
  const trimmed = (note ?? '').trim();
  if (!trimmed) return;
  recent.push({ note: trimmed, round, at: Date.now() });
  if (recent.length > MAX_RECENT) recent.splice(0, recent.length - MAX_RECENT);
}

/** 取最近决策（按时间升序，最新的在末尾）。 */
export function getRecentDecisions(): PlayerDecision[] {
  return [...recent];
}

/** 取最近决策文本（最新的在前），用于调试。 */
export function getRecentDecisionNotes(): string[] {
  return [...recent].reverse().map((d) => d.note);
}

/**
 * 组装注入 AI 提示词的「玩家决策」上下文段。
 * 无决策时返回空串（调用方据此跳过注入，避免污染既有 prompt）。
 */
export function getPlayerDecisionContext(): string {
  if (recent.length === 0) return '';
  const lines = ['【玩家决策记录 — 供下一轮叙事参考】'];
  for (const d of recent) {
    lines.push(`- ${d.note}`);
  }
  return lines.join('\n');
}

/** 清空（测试 / 新存档隔离用）。 */
export function clearPlayerDecisionLog(): void {
  recent.length = 0;
}

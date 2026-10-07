// Pure display helpers: source text and runtime identifiers remain unchanged.
const reconstructionPrefix = /^\[本档排程重建[，,]非原存档运行日志\]/;
const legacySourceTitle = /^【[^【】：:]+[：:]([^【】]+)】\s*(?:原著证据|本档安排)[：:]/;
export function directorTitle(raw: string | undefined, fallback = '剧情计划'): string {
  const text = raw?.trim();
  if (!text) return fallback;
  const match = legacySourceTitle.exec(text) || (reconstructionPrefix.test(text) ? text.match(/【[^【】：:]+[：:]([^【】]+)】/) : null);
  const title = match?.[1]?.trim() || (reconstructionPrefix.test(text) ? '存档补记' : text);
  return title.replace(/\bR(\d+)\b/g, (_, round: string) => `第${Number(round)}轮`);
}
export function isReconstructed(raw: string | undefined): boolean { return !!raw && (reconstructionPrefix.test(raw.trim()) || legacySourceTitle.test(raw.trim())); }
export function isSupplementaryRecord(...values: Array<string | undefined>): boolean {
  return values.some(value => !!value && (isReconstructed(value) || /^(?:external:)?reconstruction:(?:v3|directive):/.test(value) || value === 'rebuild:v3'));
}
export function turnTitle(id: string | undefined): string {
  const match = id?.match(/^msg_(\d+)_asst$/);
  return match ? `第${Number(match[1])}轮` : '回合记录';
}

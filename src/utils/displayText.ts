function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Convert legacy/AI-shaped scalar fields into text before they reach React. */
export function toDisplayText(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(item => toDisplayText(item)).filter(Boolean);
    return parts.length ? parts.join('、') : fallback;
  }
  if (isRecord(value)) {
    for (const key of ['描述', '名称', '文本', '目标', '标题']) {
      const text = toDisplayText(value[key]);
      if (text) return text;
    }
  }
  return fallback;
}

const FALLBACK_OPTIONS = [
  '[OPTION]{t: "继续当前行动", d: "沿着当前选择继续推进场景"}',
  '[OPTION]{t: "观察周围", d: "留意环境与在场角色的变化"}',
  '[OPTION]{t: "与在场角色交谈", d: "通过交谈获得更多信息"}',
];

const CONTENT_OPEN_RE = /<contenttext>/i;
const CONTENT_END_RE = /<\/contenttext>/i;
const OPTION_START_RE = /\[OPTION_START\]/i;
const OPTION_END_RE = /\[OPTION_END\]/i;
const COMPLETE_OPTION_LINE_SOURCE = String.raw`^\s*(\[OPTION\]\s*\{["']?t["']?\s*:\s*"(?:\\.|[^"\\])*"\s*,\s*["']?d["']?\s*:\s*"(?:\\.|[^"\\])*"\s*\})\s*$`;

function extractCompleteOptionLines(text: string): string[] {
  return [...text.matchAll(new RegExp(COMPLETE_OPTION_LINE_SOURCE, 'gmi'))].map(match => match[1]);
}

/** DeepSeek 主回复只有正文和选项块都闭合后才允许进入显示层。 */
export function isDeepSeekResponseComplete(rawText: string): boolean {
  const text = rawText.trim();
  if (!text) return false;

  const contentOpen = text.search(CONTENT_OPEN_RE);
  const contentEnd = text.search(CONTENT_END_RE);
  const optionStart = text.search(OPTION_START_RE);
  const optionEnd = text.search(OPTION_END_RE);
  if (contentOpen < 0 || contentEnd <= contentOpen || optionStart <= contentEnd || optionEnd <= optionStart) {
    return false;
  }

  const optionBlock = text.slice(optionStart, optionEnd);
  const completeOptions = extractCompleteOptionLines(optionBlock);
  if (completeOptions.length < 3) return false;
  const optionRemainder = optionBlock
    .replace(OPTION_START_RE, '')
    .replace(new RegExp(COMPLETE_OPTION_LINE_SOURCE, 'gmi'), '')
    .trim();
  if (optionRemainder) return false;

  return text.slice(optionEnd + '[OPTION_END]'.length).trim().length === 0;
}

/** 根据已生成到的位置，请模型只续写缺失的尾部。 */
export function buildDeepSeekRepairPrompt(rawText: string): string {
  if (!CONTENT_END_RE.test(rawText)) {
    return '上一条回复提前结束。只输出缺失的尾部，不要重复已有正文：补完当前句后立即闭合 </contenttext>，不要继续扩写场景；随后完整输出 [OPTION_START]、3-5 个 [OPTION] 和 [OPTION_END]。';
  }
  if (!OPTION_START_RE.test(rawText)) {
    return '上一条回复缺少行动选项。只输出缺失的尾部，不要重复正文：从 [OPTION_START] 开始，输出 3-5 个 [OPTION]，最后输出 [OPTION_END]。';
  }
  return '上一条回复的行动选项被截断。只输出缺失的尾部，不要重复正文或已有选项：继续补足 3-5 个 [OPTION]，最后输出 [OPTION_END]。';
}

/** 将模型补写内容拼到首段回复后，保持流式首段原样。 */
export function appendDeepSeekRepair(rawText: string, suffix: string): string {
  const head = rawText.trimEnd();
  const tail = suffix.trim();
  if (!tail) return head;
  if (!head) return tail;
  return `${head}\n${tail}`;
}

/**
 * 模型补尾仍失败时的本地保险：闭合正文并保证至少三个通用行动选项。
 * 不改写模型正文，也不伪造剧情事实。
 */
export function ensureDeepSeekResponseFallback(rawText: string): string {
  if (isDeepSeekResponseComplete(rawText)) return rawText.trim();

  let text = rawText.trim();
  const optionStartIndex = text.search(OPTION_START_RE);
  const optionTail = optionStartIndex >= 0 ? text.slice(optionStartIndex) : '';
  const completeOptions = extractCompleteOptionLines(optionTail).slice(0, 5);
  let narrative = optionStartIndex >= 0 ? text.slice(0, optionStartIndex).trim() : text;

  if (!CONTENT_OPEN_RE.test(narrative)) {
    narrative = narrative.replace(/<\/contenttext>/gi, '').trim();
    narrative = `<contenttext>${narrative}</contenttext>`;
  } else if (!CONTENT_END_RE.test(narrative)) {
    narrative = `${narrative}\n</contenttext>`;
  } else {
    const contentEndIndex = narrative.search(CONTENT_END_RE);
    const contentEndLength = narrative.slice(contentEndIndex).match(CONTENT_END_RE)?.[0].length ?? 0;
    narrative = narrative.slice(0, contentEndIndex + contentEndLength).trim();
  }

  const existingCount = completeOptions.length;
  const missingCount = Math.max(0, 3 - completeOptions.length);
  if (missingCount > 0) {
    completeOptions.push(...FALLBACK_OPTIONS.slice(existingCount, existingCount + missingCount));
  }

  return `${narrative}\n[OPTION_START]\n${completeOptions.join('\n')}\n[OPTION_END]`;
}

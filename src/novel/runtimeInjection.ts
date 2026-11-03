import type { NovelDataset, NovelSegment } from './types';

function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function renderSegment(label: string, segment: NovelSegment | undefined, detailed: boolean, adapted = false): string {
  if (!segment) return '';
  const lines = [`${label}：${segment.title}`, segment.summary];
  if (detailed && segment.carryFacts?.length) lines.push(`承接事实：${segment.carryFacts.join('；')}`);
  if (detailed && segment.hardConstraints.length) {
    lines.push(`${adapted ? '原著约束参考' : '不可违背'}：${segment.hardConstraints.map(content => {
      const visibility = segment.constraintDetails?.find(detail => detail.content === content)?.visibility;
      if (!visibility) return content;
      const boundary = [
        visibility.readerOnly ? '仅读者视角，不得写为角色已知' : '',
        visibility.knownBy.length ? `已知者：${visibility.knownBy.join('、')}` : '',
        visibility.unknownTo.length ? `未知者：${visibility.unknownTo.join('、')}` : '',
      ].filter(Boolean).join('；');
      return boundary ? `${content}（${boundary}）` : content;
    }).join('；')}`);
  }
  if (detailed && segment.events.length) {
    lines.push(`关键事件：${segment.events.map(event => {
      const readerOnly = event.visibility === 'reader_only'
        || (typeof event.visibility === 'object' && event.visibility.readerOnly);
      const visibility = readerOnly ? '（仅读者视角，不得写为角色已知）' : '';
      return `${event.name}：${event.description}${visibility}`;
    }).join('；')}`);
  }
  if (detailed && segment.foreshadowing?.length) lines.push(`伏笔：${segment.foreshadowing.join('；')}`);
  return lines.join('\n');
}

/** Builds the bounded, progress-driven counterpart of static WorldBook entries. */
export function buildNovelRuntimeInjection(
  dataset: NovelDataset | undefined,
  cursor = 0,
  maxChars = 4000,
  adaptationMode: 'source_faithful' | 'adapted' = 'source_faithful',
): string {
  if (!dataset) return '';
  const segments = [...dataset.segments].sort((left, right) => left.index - right.index);
  if (segments.length === 0) return '';
  const requestedIndex = Math.max(0, Math.floor(cursor) || 0);
  const matchedIndex = segments.findIndex(segment => segment.index === requestedIndex);
  const currentIndex = matchedIndex >= 0 ? matchedIndex : Math.min(requestedIndex, segments.length - 1);
  const current = segments[currentIndex];
  const previous = segments[currentIndex - 1];
  const next = segments[currentIndex + 1];
  const text = [
    `【原著进度窗口：${dataset.title}】`,
    adaptationMode === 'adapted'
      ? '这是用户明确选择的世界改编。原著约束仅作参考，冲突时以已启用模块规则为准；未冲突事实继续沿用。“仅读者视角”不可变成任何角色的既有认知。'
      : '以下是与当前剧情相邻的原著阶段。遵守当前阶段的不可违背事项；“仅读者视角”不可变成任何角色的既有认知。',
    renderSegment('上一阶段', previous, false),
    renderSegment('当前阶段', current, true, adaptationMode === 'adapted'),
    renderSegment('下一阶段', next, false),
  ].filter(Boolean).join('\n\n');
  return clip(text, Math.max(300, Math.floor(maxChars) || 4000));
}

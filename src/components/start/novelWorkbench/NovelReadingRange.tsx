import type { ReadingRange, ReadingScope } from './readingRange';
import { readingRangeLabel } from './readingRange';

interface Props {
  chapterCount: number; scope: ReadingScope; start: number; end: number; disabled: boolean;
  range?: ReadingRange; error?: string;
  onScope: (scope: ReadingScope) => void; onStart: (value: number) => void; onEnd: (value: number) => void;
}

export function NovelReadingRange({ chapterCount, scope, start, end, disabled, range, error, onScope, onStart, onEnd }: Props) {
  const sampleCount = Math.min(10, chapterCount);
  return <fieldset className="novel-import-workbench__panel novel-workbench-reading-range" disabled={disabled}>
    <legend>这次先拆多少章？</legend>
    <p>全书 {chapterCount.toLocaleString()} 章。可以先拆一小部分看效果，满意后再增加章节。</p>
    <div className="novel-workbench-scope-options" role="group" aria-label="本次拆解范围">
      <button type="button" aria-pressed={scope === 'sample'} onClick={() => onScope('sample')}><strong>先试拆前 {sampleCount} 章</strong><small>先看人物和设定，花费更少</small></button>
      <button type="button" aria-pressed={scope === 'custom'} onClick={() => onScope('custom')}><strong>自己选章节</strong><small>从哪章到哪章，由你决定</small></button>
      <button type="button" aria-pressed={scope === 'all'} onClick={() => onScope('all')}><strong>拆解整本小说</strong><small>全部 {chapterCount.toLocaleString()} 章，耗时和费用更多</small></button>
    </div>
    {scope === 'custom' && <div className="novel-import-workbench__range-fields">
      <label className="novel-import-workbench__field">从第几章开始？<input type="number" min={1} max={chapterCount} value={Number.isFinite(start) ? start + 1 : ''} onChange={event => onStart(event.target.value === '' ? NaN : Number(event.target.value) - 1)} /></label>
      <label className="novel-import-workbench__field">拆到第几章？<input type="number" min={1} max={chapterCount} value={Number.isFinite(end) ? end + 1 : ''} onChange={event => onEnd(event.target.value === '' ? NaN : Number(event.target.value) - 1)} /></label>
    </div>}
    {error ? <p role="alert" className="is-error">{error}</p> : range && <p className="novel-workbench-range-summary"><strong>本次只拆：{readingRangeLabel(range)} · {range.selectedCount} 章</strong><span>{range.isPartial ? '其余章节本次不会调用 AI。读出资料后，就可以查看效果或创建自由游玩世界。' : '本次覆盖整本小说，可随时暂停。'}</span></p>}
  </fieldset>;
}

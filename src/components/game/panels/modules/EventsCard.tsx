// 事件卡片（右侧面板）：随机事件节奏、待处理的事件、最近的结果、本世界的事件概况。
import { memo } from 'react';
import { AlertTriangle, ChevronRight, Sparkles } from 'lucide-react';
import type { EventsPanelView } from '../../../../events/viewModel';
import type { PacingLevel } from '../../../../events/types';
import { Collapsible } from '../../../shared/Collapsible';
import '../../../../ui/screens/module-cards.css';

interface EventsCardProps {
  view: EventsPanelView;
  onSetPacing?: (level: PacingLevel) => void;
  onOpenPending?: () => void;
}

export default memo(function EventsCard({ view, onSetPacing, onOpenPending }: EventsCardProps) {
  const current = view.pacingOptions.find(option => option.level === view.pacing);
  return (
    <Collapsible icon={<Sparkles size={15} />} title="事件" defaultOpen={view.pending.length > 0}>
      <div className="mc-stack">
        {view.pending.length > 0 && (
          <ul className="mc-list" aria-label="待处理的事件">
            {view.pending.map((item, index) => (
              <li key={item.key}>
                <span>{item.name}</span>
                {index === 0 && onOpenPending
                  ? <button type="button" className="mc-mini" onClick={onOpenPending}>处理<ChevronRight size={11} /></button>
                  : <b>排队中</b>}
              </li>
            ))}
          </ul>
        )}

        <div className="mc-field">
          <small id="mc-pacing-label">随机事件</small>
          <div className="mc-seg" role="group" aria-labelledby="mc-pacing-label">
            {view.pacingOptions.map(option => (
              <button key={option.level} type="button" aria-pressed={option.level === view.pacing}
                disabled={!onSetPacing} title={option.hint}
                onClick={() => { if (option.level !== view.pacing) onSetPacing?.(option.level); }}>
                {option.level === 'off' ? '关闭' : option.label}
              </button>
            ))}
          </div>
          {current && <small className="mc-field__hint">{current.hint}</small>}
        </div>

        {view.paused && <p className="mc-field__hint">{view.paused}</p>}

        {view.recent.length > 0 && (
          <ul className="mc-list" aria-label="最近的事件">
            {view.recent.map(item => (
              <li key={item.key}>
                <span>{item.name}</span>
                <span className={item.tone === 'gain' ? 'is-up' : item.tone === 'loss' ? 'is-down' : ''}>{item.text}</span>
              </li>
            ))}
          </ul>
        )}

        {view.warnings.length > 0 && (
          <div className="mc-alerts" role="status" title={view.warnings.join('\n')}>
            <span><AlertTriangle size={12} />事件包有 {view.warnings.length} 处问题：{view.warnings[0]}</span>
          </div>
        )}

        <div className="mc-actions">
          <small className="mc-field__hint">
            随机牌堆 {view.deck.ready}/{view.deck.total} 张可抽 · 剧情触发 {view.triggered} 张 · 规则 {view.rules} 条
          </small>
        </div>
      </div>
    </Collapsible>
  );
});

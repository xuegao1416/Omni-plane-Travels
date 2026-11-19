// 物资卡片（右侧面板）：只显示资源模块给出的界面数据。
import { memo, useState, type CSSProperties } from 'react';
import { AlertTriangle, ChevronRight, Leaf, Loader, Plus, Sparkle, Sparkles, X } from 'lucide-react';
import type { ResourcesViewModel } from '../../../../domains/resources/viewModel';
import { Collapsible } from '../../../shared/Collapsible';
import { resourceGlyph } from '../resourceGlyph';
import '../../../../ui/screens/module-cards.css';

interface ResourcesCardProps {
  view: ResourcesViewModel;
  onGather?: (resourceId: string) => void;
  onGenerateRecipe?: (request: string) => Promise<boolean>;
  onCancelRecipeGeneration?: () => void;
  isGeneratingRecipe?: boolean;
  onOpenLedger?: () => void;
}

export default memo(function ResourcesCard({ view, onGather, onGenerateRecipe, onCancelRecipeGeneration, isGeneratingRecipe, onOpenLedger }: ResourcesCardProps) {
  const [composing, setComposing] = useState(false);
  const [request, setRequest] = useState('');
  const craftable = view.recipes.filter(recipe => recipe.craftable).length;

  const submit = async () => {
    if (!request.trim() || !onGenerateRecipe || isGeneratingRecipe) return;
    if (await onGenerateRecipe(request.trim())) {
      setRequest('');
      setComposing(false);
    }
  };

  return (
    <Collapsible icon={<Leaf size={15} />} title={view.title} defaultOpen={true}>
      <div className="mc-stack">
        {view.alerts.length > 0 && (
          <div className="mc-alerts" role="status">
            {view.alerts.map(alert => <span key={alert}><AlertTriangle size={12} />{alert}</span>)}
          </div>
        )}
        {view.statuses.length > 0 && (
          <div className="mc-chips">
            {view.statuses.map(status => <span key={status.id} className={`mc-chip is-${status.severity}`} title={status.effect}>{status.name}</span>)}
          </div>
        )}
        <ul className="mc-rows">
          {view.resources.map(row => {
            const Glyph = resourceGlyph(row);
            return (
              <li key={row.id} className={`mc-row is-${row.tone}`} style={{ '--fill': row.fill } as CSSProperties}>
                <div className="mc-row__head">
                  <Glyph size={13} />
                  <span className="mc-row__name">{row.name}</span>
                  <span className="mc-row__value">{row.amount}<small>/{row.max}</small></span>
                </div>
                <span className="mc-meter" aria-hidden="true"><i /></span>
                <div className="mc-row__foot">
                  <small>{[row.upkeepLabel, row.remainingLabel].filter(Boolean).join(' · ') || row.kindLabel}</small>
                  {onGather && row.gather && (
                    <button type="button" className="mc-mini" onClick={() => onGather(row.id)} disabled={Boolean(row.gather.blocked)}
                      title={`采集 +${row.gather.amount}，约 ${row.gather.minutes} 分钟，体力 -${row.gather.stamina}`}>
                      <Sparkle size={10} />{row.gather.blocked ?? `采集 +${row.gather.amount}`}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {onGenerateRecipe && (composing || isGeneratingRecipe) && (
          <div className="mc-compose">
            <input value={request} onChange={event => setRequest(event.target.value)} placeholder="想做什么？如：石斧、净水器、熏鱼"
              onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) void submit(); }} disabled={isGeneratingRecipe} />
            {isGeneratingRecipe
              ? <button type="button" className="mc-mini" onClick={onCancelRecipeGeneration}><Loader size={11} className="animate-spin" />停止</button>
              : <button type="button" className="mc-mini" onClick={() => void submit()} disabled={!request.trim()}><Sparkles size={11} />设计</button>}
            {!isGeneratingRecipe && <button type="button" className="mc-mini is-ghost" onClick={() => setComposing(false)} aria-label="取消"><X size={11} /></button>}
          </div>
        )}
        <div className="mc-actions">
          {onGenerateRecipe && !composing && !isGeneratingRecipe && (
            <button type="button" className="mc-link" onClick={() => setComposing(true)}><Plus size={12} />设计配方</button>
          )}
          {onOpenLedger && (
            <button type="button" className="mc-link is-primary" onClick={onOpenLedger}>
              账本与制作台{craftable > 0 ? `（${craftable} 可制作）` : ''}<ChevronRight size={12} />
            </button>
          )}
        </div>
      </div>
    </Collapsible>
  );
});

// 商号卡片（右侧面板）：钱袋、预计净额、产业、仓库与即将到期的订单。
import { memo } from 'react';
import { AlertTriangle, Briefcase, ChevronRight } from 'lucide-react';
import type { EconomyViewModel } from '../../../../domains/economy/viewModel';
import { Collapsible } from '../../../shared/Collapsible';
import '../../../../ui/screens/module-cards.css';

interface EconomyCardProps {
  view: EconomyViewModel;
  onOpenLedger?: () => void;
}

function signed(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded > 0 ? '+' : ''}${rounded}`;
}

export default memo(function EconomyCard({ view, onOpenLedger }: EconomyCardProps) {
  const contracts = view.contracts.filter(item => item.status === 'open').slice(0, 2);
  const market = view.markets[0];
  const movers = market ? [...market.goods].sort((left, right) => Math.abs(right.changePct) - Math.abs(left.changePct)).slice(0, 3) : [];
  return (
    <Collapsible icon={<Briefcase size={15} />} title={view.title} defaultOpen={true}>
      <div className="mc-stack">
        {view.alerts.length > 0 && (
          <div className="mc-alerts" role="status">
            {view.alerts.map(alert => <span key={alert}><AlertTriangle size={12} />{alert}</span>)}
          </div>
        )}
        <div className="mc-figures">
          <div className="mc-figure"><small>钱袋</small><strong>{view.wallet}</strong></div>
          <div className={`mc-figure ${view.projected.net >= 0 ? 'is-gain' : 'is-loss'}`}><small>预计{view.cycleLabel}</small><strong>{signed(view.projected.net)}</strong></div>
          <div className="mc-figure"><small>产业</small><strong>{view.holdings.length} 处</strong></div>
          <div className="mc-figure"><small>仓库</small><strong>{view.warehouse.used}/{view.warehouse.capacity}</strong></div>
        </div>
        {movers.length > 0 && (
          <ul className="mc-list" aria-label={`${market!.name}行情`}>
            {movers.map(goods => (
              <li key={goods.id}>
                <span>{goods.name}</span>
                <span><b>{goods.mid}</b> <span className={goods.trend === 'up' ? 'is-up' : goods.trend === 'down' ? 'is-down' : ''}>{goods.changePct > 0 ? '+' : ''}{goods.changePct}%</span></span>
              </li>
            ))}
          </ul>
        )}
        {contracts.length > 0 && (
          <ul className="mc-list" aria-label="订单">
            {contracts.map(contract => (
              <li key={contract.id}>
                <span>{contract.title}（{contract.have}/{contract.quantity}）</span>
                <b>{contract.daysLeft > 0 ? `${contract.daysLeft} 天` : '今天'}</b>
              </li>
            ))}
          </ul>
        )}
        {onOpenLedger && (
          <div className="mc-actions">
            <button type="button" className="mc-link is-primary" onClick={onOpenLedger}>市场、产业与订单<ChevronRight size={12} /></button>
          </div>
        )}
      </div>
    </Collapsible>
  );
});

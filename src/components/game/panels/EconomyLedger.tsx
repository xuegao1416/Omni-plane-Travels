/**
 * 商号账簿（游戏界面右侧抽屉）：市场买卖、产业经营、订单与账目。
 * 只渲染经营模块给出的界面数据，操作回调到 useEconomyActions。
 */
import { useEffect, useState, type CSSProperties } from 'react';
import {
  AlertTriangle, ArrowLeft, BarChart3, Building2, ClipboardList, Coins, Hammer, Minus, Package, PauseCircle, PlayCircle,
  Plus, ScrollText, ShoppingCart, TrendingDown, TrendingUp, Users, Wrench, X, MapPin,
} from 'lucide-react';
import type { EconomyViewModel } from '../../../domains/economy/viewModel';
import '../../../ui/screens/module-ledger.css';

export interface EconomyLedgerActions {
  buy?: (market: string, goods: string, quantity: number) => void;
  sell?: (market: string, goods: string, quantity: number) => void;
  acquire?: (id: string) => void;
  upgrade?: (id: string) => void;
  repair?: (id: string) => void;
  staff?: (id: string, count: number) => void;
  setActive?: (id: string, active: boolean) => void;
  deliver?: (id: string) => void;
  abandon?: (id: string) => void;
}

interface EconomyLedgerProps extends EconomyLedgerActions {
  open: boolean;
  view: EconomyViewModel;
  onClose: () => void;
}

type Tab = 'market' | 'holdings' | 'contracts' | 'books';

function signed(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded > 0 ? '+' : ''}${rounded}`;
}

function Trend({ trend }: { trend: 'up' | 'down' | 'flat' }) {
  if (trend === 'up') return <TrendingUp className="ml-trend" />;
  if (trend === 'down') return <TrendingDown className="ml-trend" />;
  return <Minus className="ml-trend" />;
}

export default function EconomyLedger({ open, view, onClose, buy, sell, acquire, upgrade, repair, staff, setActive, deliver, abandon }: EconomyLedgerProps) {
  const [visible, setVisible] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [tab, setTab] = useState<Tab>('market');
  const [marketId, setMarketId] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  useEffect(() => {
    if (open) {
      setVisible(true);
      requestAnimationFrame(() => setAnimating(true));
      return;
    }
    setAnimating(false);
    const timer = setTimeout(() => setVisible(false), 250);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!visible) return null;

  const market = view.markets.find(item => item.id === marketId) ?? view.markets[0];
  const openContracts = view.contracts.filter(item => item.status === 'open').length;
  const qty = (goods: string) => Math.max(1, quantities[`${market?.id}:${goods}`] ?? 1);
  const setQty = (goods: string, value: number) => setQuantities(current => ({ ...current, [`${market?.id}:${goods}`]: Math.max(1, Math.min(999, Math.trunc(value) || 1)) }));
  const tabs: Array<{ id: Tab; label: string; icon: typeof BarChart3; badge?: number }> = [
    { id: 'market', label: '市场', icon: BarChart3 },
    { id: 'holdings', label: '产业', icon: Building2, badge: view.holdings.length },
    { id: 'contracts', label: '订单', icon: ClipboardList, badge: openContracts },
    { id: 'books', label: '账簿', icon: ScrollText },
  ];

  return (
    <>
      <div className={`game-journey__nested-overlay game-journey__nested-overlay--contained ml-veil${animating ? ' is-open' : ''}`} onClick={onClose} />
      <aside className={`business-drawer game-journey__nested-panel game-journey__nested-panel--side ml-drawer${animating ? ' is-open' : ''}`} aria-label={view.title}>
        <header className="ml-bar">
          <button type="button" className="ml-bar__btn" onClick={onClose} aria-label="返回"><ArrowLeft /></button>
          <div className="ml-bar__title">
            <small>商号账簿</small>
            <h2>{view.title}</h2>
          </div>
          <button type="button" className="ml-bar__btn is-ghost" onClick={onClose} aria-label="关闭"><X /></button>
        </header>

        <div className="ml-body">
          <section className="ml-card ml-treasury">
            <div className="ml-treasury__row">
              <span className="ml-coin" aria-hidden="true"><Coins /></span>
              <div className="ml-treasury__funds">
                <strong>{view.wallet}</strong>
                <small>钱袋{view.currencyName ? ` · ${view.currencyName}` : ''}</small>
              </div>
              <div className={`ml-treasury__net ${view.projected.net >= 0 ? 'is-gain' : 'is-loss'}`}>
                <strong>{signed(view.projected.net)}</strong>
                <small>预计净额 / {view.cycleLabel.replace('每', '')}</small>
              </div>
            </div>
            {view.description && <p className="ml-prose">{view.description}</p>}
            <div className="ml-figures">
              <div className="ml-figure"><TrendingUp /><span>产业收益</span><b className="is-gain">+{view.projected.income}</b></div>
              <div className="ml-figure"><TrendingDown /><span>维护工钱</span><b className="is-loss">-{view.projected.upkeep}</b></div>
              <div className="ml-figure"><Package /><span>仓库</span><b>{view.warehouse.used}/{view.warehouse.capacity}</b></div>
              <div className="ml-figure"><ClipboardList /><span>订单</span><b>{openContracts}</b></div>
            </div>
          </section>

          {view.alerts.length > 0 && (
            <section className="ml-alerts" role="status">
              {view.alerts.map(alert => <p key={alert}><AlertTriangle />{alert}</p>)}
            </section>
          )}

          <nav className="ml-tabs" role="tablist" aria-label="商号分区">
            {tabs.map(item => {
              const Icon = item.icon;
              return (
                <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'is-active' : ''} onClick={() => setTab(item.id)}>
                  <Icon />{item.label}{item.badge ? <span>{item.badge}</span> : null}
                </button>
              );
            })}
          </nav>

          {tab === 'market' && (
            <section className="ml-card">
              {view.markets.length === 0 ? (
                <p className="ml-empty-line">这个世界没有可交易的商品。</p>
              ) : (
                <>
                  {view.markets.length > 1 && (
                    <div className="ml-segment" role="radiogroup" aria-label="选择市场">
                      {view.markets.map(item => (
                        <button key={item.id} type="button" role="radio" aria-checked={item.id === market?.id} className={item.id === market?.id ? 'is-active' : ''} onClick={() => setMarketId(item.id)}>
                          {item.name}
                        </button>
                      ))}
                    </div>
                  )}
                  {market && (
                    <>
                      <h3 className="ml-card__title"><BarChart3 />{market.name}<span>声望 {signed(market.reputation)}</span></h3>
                      {market.description && <p className="ml-prose">{market.description}</p>}
                      {!market.accessible && <p className="ml-note"><MapPin />{market.accessNote}，现在只能看行情。</p>}
                      <div className="ml-market">
                        {market.goods.map(goods => {
                          const amount = qty(goods.id);
                          const tone = goods.trend === 'up' ? 'is-gain' : goods.trend === 'down' ? 'is-loss' : 'is-flat';
                          return (
                            <div key={goods.id} className={`ml-trade ${tone}`}>
                              <div className={`ml-market__row ${tone}`}>
                                <span>{goods.name}<small>持有 {goods.owned}{goods.unit}</small></span>
                                <b>{goods.mid}</b>
                                <Trend trend={goods.trend} />
                                <em>{goods.changePct > 0 ? '+' : ''}{goods.changePct}%</em>
                              </div>
                              <div className="ml-trade__controls">
                                <span className="ml-trade__quote">买 {goods.buy} · 卖 {goods.sell}</span>
                                <div className="ml-stepper">
                                  <button type="button" onClick={() => setQty(goods.id, amount - 1)} aria-label="减少数量"><Minus /></button>
                                  <input type="number" min={1} max={999} value={amount} onChange={event => setQty(goods.id, Number(event.target.value))} aria-label={`${goods.name}数量`} />
                                  <button type="button" onClick={() => setQty(goods.id, amount + 1)} aria-label="增加数量"><Plus /></button>
                                </div>
                                {buy && <button type="button" className="pk-btn pk-btn--secondary pk-btn--sm" disabled={!market.accessible} onClick={() => buy(market.id, goods.id, amount)}><ShoppingCart />买</button>}
                                {sell && <button type="button" className="pk-btn pk-btn--primary pk-btn--sm" disabled={!market.accessible || goods.owned < amount} onClick={() => sell(market.id, goods.id, amount)}><Coins />卖</button>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <p className="ml-note"><Package />成交量越大，价格被推得越多；行情每天变动，市场压力会逐日恢复。</p>
                    </>
                  )}
                </>
              )}
              {view.warehouse.items.length > 0 && (
                <>
                  <h3 className="ml-card__title"><Package />仓库<span>{view.warehouse.used}/{view.warehouse.capacity}</span></h3>
                  <div className="ml-grid">
                    {view.warehouse.items.map(item => (
                      <div key={item.id} className="ml-chipcard">
                        <strong>{item.name}</strong>
                        <small>{item.quantity}{item.unit}{item.value ? ` · 约值 ${item.value}` : ''}</small>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>
          )}

          {tab === 'holdings' && (
            <section className="ml-stack">
              {view.holdings.length === 0 ? (
                <div className="ml-empty">
                  <span className="ml-empty__seal" aria-hidden="true"><Building2 /></span>
                  <strong>还没有产业</strong>
                  <small>可以在下面购置，或在故事里谈下一门生意。</small>
                </div>
              ) : view.holdings.map(holding => (
                <article key={holding.id} className={`ml-asset ml-holding is-${holding.status}`} style={{ '--fill': holding.condition / 100 } as CSSProperties}>
                  <div className="ml-asset__head">
                    <div className="ml-asset__copy">
                      <span className="ml-asset__name"><strong>{holding.name}</strong><em className="ml-tag is-brass">{holding.level}/{holding.maxLevel} 级</em>
                        <em className={`ml-tag ${holding.status === 'damaged' ? 'is-ember' : holding.status === 'idle' ? 'is-mute' : 'is-moon'}`}>{holding.statusLabel}</em></span>
                      <small>{holding.type ? `${holding.type} · ` : ''}{holding.risk}</small>
                    </div>
                    <span className="ml-asset__nums"><b className={holding.net >= 0 ? 'is-gain' : 'is-loss'}>{signed(holding.net)}</b><small>{view.cycleLabel}</small></span>
                  </div>
                  {holding.description && <p className="ml-prose">{holding.description}</p>}
                  <div className="ml-holding__meter"><span>状况 {holding.condition}</span><span className="ml-meter" aria-hidden="true"><i /></span></div>
                  <div className="ml-figures">
                    <div className="ml-figure"><TrendingUp /><span>收益</span><b className="is-gain">+{holding.gross}</b></div>
                    <div className="ml-figure"><TrendingDown /><span>维护</span><b className="is-loss">-{holding.upkeep}</b></div>
                    {holding.storage > 0 && <div className="ml-figure"><Package /><span>仓位</span><b>+{holding.storage}</b></div>}
                  </div>
                  {holding.productionText && <p className="ml-note"><Hammer />生产：{holding.productionText}</p>}
                  {holding.staffMax > 0 && (
                    <div className="ml-staff">
                      <Users /><span>人手 {holding.staff}/{holding.staffMax}{holding.wage ? `（每人工钱 ${holding.wage}）` : ''}</span>
                      {staff && (
                        <div className="ml-stepper">
                          <button type="button" disabled={holding.staff <= 0} onClick={() => staff(holding.id, holding.staff - 1)} aria-label="减少人手"><Minus /></button>
                          <output>{holding.staff}</output>
                          <button type="button" disabled={holding.staff >= holding.staffMax} onClick={() => staff(holding.id, holding.staff + 1)} aria-label="增加人手"><Plus /></button>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="ml-recipe__actions">
                    {upgrade && holding.upgradeCost !== undefined && <button type="button" className="pk-btn pk-btn--primary pk-btn--sm" disabled={view.wallet < holding.upgradeCost} onClick={() => upgrade(holding.id)}><Building2 />升级 · {holding.upgradeCost}</button>}
                    {repair && holding.repairCost !== undefined && <button type="button" className="pk-btn pk-btn--secondary pk-btn--sm" disabled={view.wallet < holding.repairCost} onClick={() => repair(holding.id)}><Wrench />修缮 · {holding.repairCost}</button>}
                    {setActive && holding.status !== 'damaged' && (
                      <button type="button" className="ml-icon-btn" onClick={() => setActive(holding.id, holding.status === 'idle')} title={holding.status === 'idle' ? '重新开张' : '暂停营业'} aria-label={holding.status === 'idle' ? '重新开张' : '暂停营业'}>
                        {holding.status === 'idle' ? <PlayCircle /> : <PauseCircle />}
                      </button>
                    )}
                  </div>
                </article>
              ))}
              {view.offers.length > 0 && (
                <section className="ml-card">
                  <h3 className="ml-card__title"><ShoppingCart />可购置</h3>
                  <div className="ml-stack is-tight">
                    {view.offers.map(offer => (
                      <div key={offer.id} className="ml-offer">
                        <div>
                          <strong>{offer.name}</strong>
                          <small>{offer.description || offer.type} · {offer.incomeText}{offer.materials ? ` · 材料 ${offer.materials}` : ''}</small>
                        </div>
                        {acquire && <button type="button" className="pk-btn pk-btn--primary pk-btn--sm" disabled={!offer.affordable} onClick={() => acquire(offer.id)}><ShoppingCart />{offer.cost}</button>}
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </section>
          )}

          {tab === 'contracts' && (
            <section className="ml-stack is-tight">
              {view.contracts.length === 0 ? (
                <div className="ml-empty">
                  <span className="ml-empty__seal" aria-hidden="true"><ClipboardList /></span>
                  <strong>暂无订单</strong>
                  <small>客商会不时上门；故事里接下的委托也会出现在这里。</small>
                </div>
              ) : view.contracts.map(contract => (
                <div key={contract.id} className={`ml-contract is-${contract.status}`}>
                  <div className="ml-recipe__head">
                    <strong>{contract.title}</strong>
                    <span>{contract.status === 'open' ? (contract.daysLeft > 0 ? `${contract.daysLeft} 天后到期` : '今天到期') : contract.status === 'done' ? '已交付' : '已作废'}</span>
                  </div>
                  <small>{contract.client} · {contract.quantity}{contract.unit}{contract.goods}（仓库 {contract.have}）{contract.market ? ` · 交货地：${contract.market}` : ''}</small>
                  <div className="ml-recipe__actions">
                    <b className="is-gain">酬金 {contract.reward}</b>
                    {contract.status === 'open' && deliver && <button type="button" className="pk-btn pk-btn--primary pk-btn--sm" disabled={!contract.canDeliver} onClick={() => deliver(contract.id)}><Package />交货</button>}
                    {contract.status === 'open' && abandon && <button type="button" className="ml-icon-btn is-danger" onClick={() => abandon(contract.id)} title="放弃订单" aria-label={`放弃订单 ${contract.title}`}><X /></button>}
                  </div>
                </div>
              ))}
            </section>
          )}

          {tab === 'books' && (
            <>
              {view.reports.length > 0 && (
                <section className="ml-card">
                  <h3 className="ml-card__title"><ClipboardList />经营日报</h3>
                  <div className="ml-log">
                    {view.reports.map(report => (
                      <div key={report.day} className="ml-log__entry">
                        <small className="ml-log__reason">第 {report.day} 天 · 净 {signed(report.net)}</small>
                        <div className={`ml-log__row ${report.net >= 0 ? 'is-gain' : 'is-loss'}`}><span>收入 +{report.income} · 支出 -{report.costs}</span></div>
                        {report.lines.map(line => <div key={line} className="ml-log__row"><span>{line}</span></div>)}
                      </div>
                    ))}
                  </div>
                </section>
              )}
              <section className="ml-card">
                <h3 className="ml-card__title"><ScrollText />账目</h3>
                {view.ledger.length === 0 ? <p className="ml-empty-line">还没有账目。</p> : (
                  <div className="ml-log">
                    {view.ledger.map(entry => (
                      <div key={entry.key} className={`ml-log__row ${entry.amount > 0 ? 'is-gain' : entry.amount < 0 ? 'is-loss' : ''}`}>
                        <span>{entry.description}</span>
                        {entry.amount !== 0 && <b>{signed(entry.amount)}</b>}
                        {entry.day > 0 && <small>第 {entry.day} 天</small>}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

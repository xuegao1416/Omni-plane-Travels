/**
 * 游戏内的地图卷宗：2D / 3D 地图 + 当前位置 + 选中地点的赶路预估与「前往」。
 * 赶路、休整交给玩法宿主的地图模块结算（map.travel / map.rest），采集走生存资源模块。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, BedDouble, Compass, Footprints, Hourglass, MapPin, Mountain, Pickaxe, ScrollText, ShieldAlert, Sparkles, Store, Swords, Users, Zap,
} from 'lucide-react';
import type { GameState } from '../../../schema/variables';
import type { WorldDef } from '../../../data/worlds-schema';
import { buildMapViewModel, planMapTravel, type MapLocationView } from '../../../domains/map/viewModel';
import { buildGraph, estimateLeg, formatMinutes } from '../../../domains/map/graph';
import { legContextFor, mapModuleConfigFor } from '../../../domains/map/module';
import { LOCATION_KIND_LABELS, SERVICE_LABELS, TERRAIN_LABELS, routeKindLabel } from '../../../domains/map/types';
import MapView from '../../map/MapView';
import '../../../ui/screens/map.css';

export interface MapPanelProps {
  world: WorldDef | undefined;
  gameState: GameState;
  readOnly?: boolean;
  onTravel?: (locationId: string, name: string) => { ok: boolean; feedback: string };
  onRest?: () => { ok: boolean; feedback: string };
  onGather?: (resourceId: string) => void;
}

function Chips({ item }: { item: MapLocationView }) {
  const chips: Array<{ icon: typeof Store; text: string; tone?: string }> = [];
  const danger = Math.max(item.location.danger ?? 0, item.region?.danger ?? 0);
  if (danger) chips.push({ icon: ShieldAlert, text: `危险 ${danger}`, tone: danger >= 3 ? 'is-danger' : 'is-warn' });
  for (const service of item.location.services ?? []) chips.push({ icon: service === 'rest' ? BedDouble : Sparkles, text: SERVICE_LABELS[service] });
  for (const market of item.markets) chips.push({ icon: Store, text: market.name, tone: 'is-trade' });
  for (const holding of item.holdings) chips.push({ icon: Store, text: `${holding.name}${holding.owned ? '（我的）' : ''}`, tone: holding.owned ? 'is-own' : undefined });
  for (const gather of item.gather) chips.push({ icon: Pickaxe, text: `可采 ${gather.name}${gather.bonus ? ` +${Math.round(gather.bonus * 100)}%` : ''}`, tone: 'is-gather' });
  for (const profession of item.professions) chips.push({ icon: Swords, text: `${profession.name}会馆` });
  if (!chips.length) return null;
  return <ul className="map-dossier__chips">{chips.map((chip, index) => <li key={index} className={chip.tone}><chip.icon size={12} aria-hidden="true" />{chip.text}</li>)}</ul>;
}

export default function MapPanel({ world, gameState, readOnly, onTravel, onRest, onGather }: MapPanelProps) {
  const view = useMemo(() => buildMapViewModel(world, gameState), [world, gameState]);
  const [selected, setSelected] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const current = view?.current;
  useEffect(() => { if (selected && selected === current?.location.id) setSelected(null); }, [current?.location.id, selected]);
  const target = selected ? view?.locations.find(item => item.location.id === selected) : undefined;
  const plan = useMemo(() => (target && current && target.location.id !== current.location.id && target.status !== 'unknown' ? planMapTravel(world, gameState, target.location.id) : null), [target, current, world, gameState]);
  const exits = useMemo(() => {
    const config = mapModuleConfigFor(world);
    if (!config || !view || !current) return [];
    // 用视图里整理过的进度：旧存档的 gameState.map 可能还不存在。
    const graph = buildGraph(view.config, view.runtime, { knownOnly: true });
    const context = legContextFor(config);
    return (graph.adjacency.get(current.location.id) ?? []).map(edge => ({ edge, leg: estimateLeg(graph, edge.route, current.location.id, context), to: view.locations.find(item => item.location.id === edge.to)! }))
      .filter(item => item.to).sort((a, b) => a.leg.minutes - b.leg.minutes);
  }, [world, view, current]);

  if (!view) return <p className="map-dossier__empty">这个世界没有地图。</p>;
  const placeText = String(gameState.世界?.空间定位?.当前位置 ?? '').trim();
  const travel = () => {
    if (!target || !onTravel) return;
    const result = onTravel(target.location.id, target.location.name);
    setFeedback({ ok: result.ok, text: result.feedback });
    if (result.ok) setSelected(null);
  };
  const rest = () => {
    if (!onRest) return;
    const result = onRest();
    setFeedback({ ok: result.ok, text: result.feedback });
  };

  return (
    <div className={`map-dossier map-dossier--${view.theme}`}>
      <div className="map-dossier__stage">
        <MapView view={view} selectedId={selected} onSelect={setSelected} plan={plan?.ok ? plan.nodes : undefined} />
      </div>
      <aside className="map-dossier__info" aria-label="位置与路线">
        {current && (
          <section className="map-dossier__card map-dossier__here">
            <span className="map-dossier__kicker"><MapPin size={12} aria-hidden="true" />当前位置{current.region ? ` · ${current.region.name}` : ''}{current.region && current.region.terrain !== 'sea' ? ` · ${TERRAIN_LABELS[current.region.terrain]}` : ''}</span>
            <h3>{current.location.name}<small>{LOCATION_KIND_LABELS[current.location.kind]}</small></h3>
            {placeText && placeText !== current.location.name && !placeText.endsWith(current.location.name) && <p className="map-dossier__sub">正文里的位置：{placeText}</p>}
            {current.location.description && <p className="map-dossier__desc">{current.location.description}</p>}
            <Chips item={current} />
            {(current.people.length > 0 || current.quests.length > 0) && (
              <ul className="map-dossier__notes">
                {current.people.length > 0 && <li><Users size={12} aria-hidden="true" />此地人物：{current.people.map(person => person.name).join('、')}</li>}
                {current.quests.length > 0 && <li><ScrollText size={12} aria-hidden="true" />相关任务：{current.quests.join('、')}</li>}
                {current.effects.map(effect => <li key={effect}><Sparkles size={12} aria-hidden="true" />{effect}</li>)}
              </ul>
            )}
            {!readOnly && (current.location.services?.includes('rest') || (current.gather.length > 0 && onGather)) && (
              <div className="map-dossier__actions">
                {current.location.services?.includes('rest') && onRest && <button type="button" className="btn-secondary btn-sm map-dossier__btn" onClick={rest}><BedDouble size={14} aria-hidden="true" />休整 8 小时{current.location.restPrice ? `（${current.location.restPrice}）` : ''}</button>}
                {onGather && current.gather.map(gather => <button type="button" key={gather.id} className="btn-secondary btn-sm map-dossier__btn" onClick={() => onGather(gather.id)}><Pickaxe size={14} aria-hidden="true" />采集{gather.name}</button>)}
              </div>
            )}
          </section>
        )}

        {target && target.location.id !== current?.location.id ? (
          <section className="map-dossier__card map-dossier__target" aria-live="polite">
            <span className="map-dossier__kicker"><Compass size={12} aria-hidden="true" />{target.status === 'visited' ? '到过的地方' : '已知的地方'}{target.region ? ` · ${target.region.name}` : ''}</span>
            <h3>{target.location.name}<small>{LOCATION_KIND_LABELS[target.location.kind]}</small></h3>
            {target.location.description && <p className="map-dossier__desc">{target.location.description}</p>}
            <Chips item={target} />
            {target.people.length > 0 && <p className="map-dossier__sub"><Users size={12} aria-hidden="true" /> {target.people.map(person => person.name).join('、')}</p>}
            {plan && (
              <div className="map-dossier__plan">
                {plan.legs.length > 0 && (
                  <ol>
                    {plan.legs.map((leg, index) => (
                      <li key={index} className={leg.blocked ? 'is-blocked' : leg.danger >= 3 ? 'is-danger' : ''}>
                        <b>{leg.toName}</b>
                        <span>{leg.routeName} · {formatMinutes(leg.minutes)}{leg.stamina ? ` · 体力 -${leg.stamina}` : ''}{leg.currency ? ` · 路费 ${leg.currency}` : ''}{leg.supplies.map(item => ` · ${item.name} -${item.amount}`).join('')}</span>
                        {leg.danger >= 2 && <em>危险 {leg.danger}{view.links.dice ? ` · ${leg.checkLabel}检定 ${leg.dc}` : ''}{view.links.combat && leg.danger >= 2 ? ' · 可能遇伏' : ''}</em>}
                        {leg.blocked && <em className="is-blocked">{leg.blocked}</em>}
                      </li>
                    ))}
                  </ol>
                )}
                <div className="map-dossier__totals">
                  <span><Hourglass size={13} aria-hidden="true" />{plan.minutesLabel || '—'}</span>
                  {plan.stamina > 0 && <span><Zap size={13} aria-hidden="true" />体力 -{plan.stamina}</span>}
                  {plan.danger > 0 && <span className={plan.danger >= 3 ? 'is-danger' : ''}><Mountain size={13} aria-hidden="true" />危险 {plan.danger}</span>}
                </div>
                {plan.reason && <p className="map-dossier__reason">{plan.reason}</p>}
                {!readOnly && onTravel && (
                  <button type="button" className="btn-primary map-dossier__go" onClick={travel} disabled={!plan.ok}>
                    <Footprints size={15} aria-hidden="true" />前往{target.location.name}<ArrowRight size={15} aria-hidden="true" />
                  </button>
                )}
              </div>
            )}
          </section>
        ) : (
          exits.length > 0 && (
            <section className="map-dossier__card">
              <span className="map-dossier__kicker"><Footprints size={12} aria-hidden="true" />从这里可以去</span>
              <ul className="map-dossier__exits">
                {exits.map(({ edge, leg, to }) => (
                  <li key={edge.route.id}>
                    <button type="button" onClick={() => setSelected(to.location.id)}>
                      <b>{to.location.name}</b>
                      <span>{edge.route.name || routeKindLabel(edge.route.kind, view.theme)} · {formatMinutes(leg.minutes)}{leg.danger ? ` · 危险 ${leg.danger}` : ''}</span>
                      <ArrowRight size={14} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )
        )}

        {feedback && <p className={`map-dossier__feedback${feedback.ok ? ' is-ok' : ' is-error'}`} role="status">{feedback.text}</p>}

        <section className="map-dossier__card map-dossier__progress">
          <span className="map-dossier__kicker"><Compass size={12} aria-hidden="true" />探索</span>
          <div className="map-dossier__meter" aria-label={`已知 ${view.stats.known} / ${view.stats.total}`}>
            <i style={{ width: `${Math.round((view.stats.known / Math.max(1, view.stats.total)) * 100)}%` }} />
            <i className="is-visited" style={{ width: `${Math.round((view.stats.visited / Math.max(1, view.stats.total)) * 100)}%` }} />
          </div>
          <p>已知 {view.stats.known}/{view.stats.total} 处 · 到过 {view.stats.visited} 处</p>
          {view.trail.length > 1 && <p className="map-dossier__trail">{view.trail.slice(-6).map(id => view.locations.find(item => item.location.id === id)?.location.name ?? id).join(' → ')}</p>}
        </section>
      </aside>
    </div>
  );
}

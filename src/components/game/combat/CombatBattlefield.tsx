import { useRef,type CSSProperties } from 'react';
import type { CombatUnitCardModel } from '../../../gameplay/combatViewModel';
import type { CombatSessionV2 } from '../../../gameplay/protocols';
import { Ribbon,Seal } from '../../../ui/planar/Ornaments';
import BattleBackdrop from './BattleBackdrop';
import type { BattleSceneId } from './battleScene';
import { frameArtFor,standeeArtFor } from './combatArt';
import { useCombatFx,type CombatFxEvent } from './useCombatFx';

/* Feet positions (% of the stage), front → back. Lower on screen = nearer = larger. */
const SLOTS = [
  { x: 31, y: 95, d: 1 }, { x: 15, y: 70, d: .84 }, { x: 43, y: 66, d: .8 }, { x: 9, y: 96, d: .98 }, { x: 29, y: 52, d: .7 }, { x: 4, y: 58, d: .7 },
];

function phoneSlot(index: number, count: number, side: 'ally' | 'enemy') {
  const perRow = Math.min(count, 4);
  const row = Math.floor(index / 4);
  const x = (((index % 4) + 1) / (perRow + 1)) * 100;
  const y = side === 'enemy' ? 44 - row * 10 : 96 - row * 10;
  return { x, y };
}

function slotStyle(index: number, count: number, side: 'ally' | 'enemy'): CSSProperties {
  const slot = SLOTS[Math.min(index, SLOTS.length - 1)];
  const x = side === 'ally' ? slot.x : 100 - slot.x;
  const phone = phoneSlot(index, count, side);
  return { '--x': `${x}%`, '--y': `${slot.y}%`, '--depth': slot.d, '--px': `${phone.x}%`, '--py': `${phone.y}%`, zIndex: Math.round(slot.y) } as CSSProperties;
}

function UnitStandee({
  unit, scene, style, statLabels, selectable, selected, rostered, preparing, struck, acting, onSelect,
}: {
  unit: CombatUnitCardModel;
  scene: BattleSceneId;
  style: CSSProperties;
  statLabels: { health: string; resource: string };
  selectable: boolean;
  selected: boolean;
  rostered: boolean;
  preparing: boolean;
  struck?: 'hit' | 'critical' | 'heal' | 'miss';
  acting: boolean;
  onSelect: () => void;
}) {
  const art = standeeArtFor(unit, scene);
  const defeated = unit.hp <= 0;
  const classes = [
    'cb-unit', `is-${unit.side}`, `is-${art.figure}`,
    unit.isActive && !defeated ? 'is-active' : '',
    selectable ? 'is-selectable' : '',
    selected ? 'is-selected' : '',
    defeated ? 'is-defeated' : '',
    preparing && !rostered && unit.side === 'ally' ? 'is-benched' : '',
    struck ? `is-struck-${struck}` : '',
    acting ? 'is-acting' : '',
    unit.hpPercent > 0 && unit.hpPercent <= 30 ? 'is-low' : '',
    art.custom ? 'has-portrait' : '',
  ].filter(Boolean).join(' ');
  const bars = { '--hp': unit.hpPercent / 100, '--res': unit.resourcePercent / 100 } as CSSProperties;
  return (
    <button
      type="button"
      className={classes}
      style={style}
      onClick={onSelect}
      aria-pressed={selectable ? selected : undefined}
      aria-label={`${unit.side === 'ally' ? '我方' : '敌方'} ${unit.name}，${statLabels.health} ${unit.hp}/${unit.maxHp}，${statLabels.resource} ${unit.resource}/${unit.maxResource}${unit.statuses.length ? `，状态 ${unit.statuses.join('、')}` : ''}${defeated ? '，已退场' : ''}${selectable ? '，可选为目标' : ''}`}
    >
      <span className="cb-unit__ground" aria-hidden="true"><i /></span>
      <span className="cb-unit__card" data-combat-unit={unit.id}>
        <span className="cb-unit__glow" aria-hidden="true" />
        <span className="cb-unit__art"><img src={art.src} alt="" draggable={false} /></span>
        <img className="cb-unit__frame" src={frameArtFor(unit.side)} alt="" aria-hidden="true" draggable={false} />
        <svg className="cb-unit__reticle" viewBox="0 0 100 140" preserveAspectRatio="none" aria-hidden="true"><path d="M6 30V14H22M78 14H94V30M94 112V128H78M22 128H6V112" /><path d="M50 4v8M50 128v8M2 70h8M90 70h8" /></svg>
        {unit.initiativeIndex >= 0 && !defeated && <span className="cb-unit__order" aria-hidden="true">{unit.initiativeIndex + 1}</span>}
        {defeated && <svg className="cb-unit__slash" viewBox="0 0 100 140" aria-hidden="true" preserveAspectRatio="none"><path d="M14 24 86 116" /><path d="M20 22 90 108" /></svg>}
        {preparing && unit.side === 'ally' && <span className={`cb-unit__roster${rostered ? ' is-on' : ''}`}>{rostered ? '出战' : '待命'}</span>}
      </span>
      <span className="cb-unit__plate" style={bars}>
        <span className="cb-unit__plate-cap" aria-hidden="true" />
        <strong>{unit.name}</strong>
        <span className="cb-unit__bar is-hp"><i className="is-ghost" /><i className="is-fill" /></span>
        <span className="cb-unit__bar is-res"><i className="is-fill" /></span>
        <small><b>{unit.hp}</b>/{unit.maxHp}</small>
      </span>
      {unit.statuses.length > 0 && <span className="cb-unit__statuses">{unit.statuses.slice(0, 3).map(status => <em key={status}>{status}</em>)}</span>}
    </button>
  );
}

function FxLayer({ events }: { events: CombatFxEvent[] }) {
  return <>
    <svg className="cb-fx" aria-hidden="true">
      <defs>
        <linearGradient id="cb-trail-ally" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#f2d48e" stopOpacity="0" /><stop offset=".7" stopColor="#ffe9b0" /><stop offset="1" stopColor="#fffaea" /></linearGradient>
        <linearGradient id="cb-trail-enemy" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#d0675a" stopOpacity="0" /><stop offset=".7" stopColor="#ff8f80" /><stop offset="1" stopColor="#ffe0d8" /></linearGradient>
        <radialGradient id="cb-burst" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#fffaea" /><stop offset=".35" stopColor="#f2d48e" stopOpacity=".8" /><stop offset="1" stopColor="#f2d48e" stopOpacity="0" /></radialGradient>
        <radialGradient id="cb-burst-enemy" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#ffe0d8" /><stop offset=".35" stopColor="#e2584a" stopOpacity=".8" /><stop offset="1" stopColor="#e2584a" stopOpacity="0" /></radialGradient>
      </defs>
      {events.map(event => {
        const side = event.fromEnemy ? 'enemy' : 'ally';
        return <g key={event.id} className={`cb-fx__event is-${event.kind} is-${side}${event.critical ? ' is-critical' : ''}`}>
          {(event.kind === 'attack' || event.kind === 'skill' || event.kind === 'item') && event.hits.filter(hit => hit.targetId !== event.actorId).map(hit => {
            const mx = (event.from.x + hit.x) / 2;
            const my = Math.min(event.from.y, hit.y) - Math.abs(hit.x - event.from.x) * (event.kind === 'skill' ? .32 : .14);
            const d = `M${event.from.x} ${event.from.y} Q${mx} ${my} ${hit.x} ${hit.y}`;
            return <g key={hit.targetId}>
              <path className="cb-fx__trail-glow" d={d} pathLength={100} />
              <path className="cb-fx__trail" d={d} pathLength={100} stroke={`url(#cb-trail-${side})`} />
            </g>;
          })}
          {event.hits.map(hit => hit.tone === 'miss' ? null : <g key={`b-${hit.targetId}`} className={`cb-fx__impact is-${hit.tone}`} transform={`translate(${hit.x} ${hit.y})`}>
            <circle className="cb-fx__flash" r="46" fill={`url(#${event.fromEnemy ? 'cb-burst-enemy' : 'cb-burst'})`} />
            <circle className="cb-fx__ring" r="30" />
            {hit.tone === 'damage' || hit.tone === 'critical'
              ? [0, 45, 90, 135, 180, 225, 270, 315].map(angle => <line key={angle} className="cb-fx__spoke" x1="0" y1="-18" x2="0" y2={hit.tone === 'critical' ? -58 : -42} transform={`rotate(${angle + 22})`} />)
              : hit.tone === 'heal'
                ? [-22, -8, 6, 20].map((x, index) => <path key={x} className="cb-fx__mote" d="M0 -5 1.4 -1.4 5 0 1.4 1.4 0 5 -1.4 1.4 -5 0 -1.4 -1.4z" transform={`translate(${x} ${12 - index * 6})`} style={{ animationDelay: `${index * 70}ms` }} />)
                : <path className="cb-fx__guard" d="M0 -30 24 -20v16c0 18-12 30-24 36-12-6-24-18-24-36v-16z" />}
          </g>)}
        </g>;
      })}
    </svg>
    {events.flatMap(event => event.hits.map(hit => <span key={`${event.id}-${hit.targetId}`} className={`cb-float is-${hit.tone}`} style={{ left: hit.x, top: hit.y } as CSSProperties}>{hit.text}{hit.tone === 'critical' && <small>暴击</small>}</span>))}
  </>;
}

export default function CombatBattlefield({
  session, scene, allyUnits, enemyUnits, effectiveTarget, targetIds, selectedRoster, preparing, statLabels, turnBanner, onChoose,
}: {
  session: CombatSessionV2;
  scene: BattleSceneId;
  allyUnits: CombatUnitCardModel[];
  enemyUnits: CombatUnitCardModel[];
  effectiveTarget: string;
  targetIds: Set<string>;
  selectedRoster: string[];
  preparing: boolean;
  statLabels: { health: string; resource: string };
  turnBanner?: { key: string; label: string; side: 'ally' | 'enemy' } | null;
  onChoose: (unit: CombatUnitCardModel) => void;
}) {
  const stageRef = useRef<HTMLElement>(null);
  const events = useCombatFx(session, stageRef);
  const struck = new Map<string, 'hit' | 'critical' | 'heal' | 'miss'>();
  const acting = new Set<string>();
  for (const event of events) {
    acting.add(event.actorId);
    for (const hit of event.hits) {
      if (hit.tone === 'damage') struck.set(hit.targetId, 'hit');
      else if (hit.tone === 'critical') struck.set(hit.targetId, 'critical');
      else if (hit.tone === 'heal') struck.set(hit.targetId, 'heal');
      else if (hit.tone === 'miss') struck.set(hit.targetId, 'miss');
    }
  }
  const fieldAllies = preparing ? allyUnits.filter(unit => selectedRoster.includes(unit.id)) : allyUnits;
  const render = (units: CombatUnitCardModel[], side: 'ally' | 'enemy') => units.map((unit, index) => (
    <UnitStandee
      key={`${unit.id}:${struck.has(unit.id) ? events.find(event => event.hits.some(hit => hit.targetId === unit.id))?.id : ''}`}
      unit={unit}
      scene={scene}
      style={slotStyle(index, units.length, side)}
      statLabels={statLabels}
      selectable={!preparing && targetIds.has(unit.id)}
      selected={!preparing && effectiveTarget === unit.id}
      rostered={selectedRoster.includes(unit.id)}
      preparing={preparing}
      struck={struck.get(unit.id)}
      acting={acting.has(unit.id)}
      onSelect={() => onChoose(unit)}
    />
  ));
  const shake = events.some(event => event.critical) ? ' is-shaking' : '';
  return (
    <main ref={stageRef} className={`cb-stage${shake}`} aria-label="战场">
      <BattleBackdrop scene={scene} />
      <div className="cb-stage__round" aria-hidden="true">
        <Seal size={58}><strong key={session.round}>{preparing ? '阵' : session.round}</strong></Seal>
        <small>{preparing ? '布阵' : '回合'}</small>
      </div>
      <span className="cb-stage__side-label is-ally" aria-hidden="true">我方 · {fieldAllies.filter(unit => unit.hp > 0).length}/{fieldAllies.length}</span>
      <span className="cb-stage__side-label is-enemy" aria-hidden="true">敌方 · {enemyUnits.filter(unit => unit.hp > 0).length}/{enemyUnits.length}</span>
      <div className="cb-stage__units">
        {render(enemyUnits, 'enemy')}
        {render(fieldAllies, 'ally')}
      </div>
      <FxLayer events={events} />
      {turnBanner && <div key={turnBanner.key} className={`cb-turn-banner is-${turnBanner.side}`} aria-hidden="true"><Ribbon>{turnBanner.label}</Ribbon></div>}
    </main>
  );
}

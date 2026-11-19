import { useMemo,useState,type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
BookOpen,Map,Flag,Users,Landmark,Scale,Layers,ChevronDown,MapPin,Clock,Cloud,Compass,Swords,
Sparkles,Coins,CalendarDays,Hourglass,HeartHandshake,Zap,Network,Dices,Gauge,TrendingUp,Briefcase,
Package,Activity,Puzzle,ShieldAlert,Ban,Timer,
} from 'lucide-react';
import type { WorldDef,WorldBookEntryDef,WorldModule } from '../../../data/worlds-schema';
import PlanarFrame from '../../../ui/planar/PlanarFrame';
import { resourceGlyph } from '../../game/panels/resourceGlyph';
import '../../../ui/screens/world-dossier.css';

type ChapterKey = 'overview' | 'lore' | 'factions' | 'npcs' | 'culture' | 'laws' | 'systems';
interface Chapter { key: ChapterKey; label: string; icon: LucideIcon; count?: number; render: () => ReactNode }

const byType = (world: WorldDef, type: string) => (world.worldBookEntries ?? []).filter(entry => entry.entryType === type && !entry.disable);

/** Prose from the setting entry, minus the trailing 【时间】/【地点】/【氛围】 lines already shown as coordinates. */
function settingProse(content: string): string {
  const match = content.match(/【(?:世界)?背景】\s*([\s\S]*?)(?=【(?:时间|地点|氛围|核心|特色)】)/);
  if (match) return match[1].trim();
  const lines = content.split('\n');
  const cut = lines.findIndex(line => /^【(?:时间|地点|氛围)/.test(line.trim()));
  return (cut > 0 ? lines.slice(0, cut) : lines).join('\n').trim().replace(/^【(?:世界)?背景】\s*/, '');
}

const ALIGNMENT_TONE: Record<string, string> = { 友善: 'is-ally', 友好: 'is-ally', 盟友: 'is-ally', 中立: 'is-neutral', 敌对: 'is-hostile', 敌意: 'is-hostile' };

const MODULE_ICON: Record<string, LucideIcon> = {
  stat: Gauge, progression: TrendingUp, survival: Package, business: Briefcase, dice: Dices,
  talent: Sparkles, profession: Swords, combat: Swords, simulation: Activity,
};
const MODULE_FALLBACK: Record<string, string> = {
  stat: '数值属性', progression: '成长体系', survival: '生存资源', business: '经营资产', dice: '骰子检定',
  talent: '天赋体系', profession: '职业体系', combat: '图形化战斗', simulation: '世界动态',
};

/** A titled section inside a chapter. */
function Section({ icon: Icon, title, children, aside }: { icon: LucideIcon; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="wd-section">
      <h3 className="wd-section__title"><Icon aria-hidden="true" /><span>{title}</span>{aside && <small>{aside}</small>}</h3>
      {children}
    </section>
  );
}

/** Long-form world book entries as a folding index: title rows, one open at a time. */
function Folios({ entries, numbered = true }: { entries: Array<{ id: string | number; title: string; body: string }>; numbered?: boolean }) {
  const [open, setOpen] = useState<string | number | null>(entries[0]?.id ?? null);
  return (
    <ol className={`wd-folios${numbered ? '' : ' is-plain'}`}>
      {entries.map((entry, index) => {
        const isOpen = open === entry.id;
        return (
          <li key={entry.id} className={`wd-folio${isOpen ? ' is-open' : ''}`} style={{ '--i': Math.min(index, 12) } as React.CSSProperties}>
            <button type="button" className="wd-folio__head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : entry.id)}>
              {numbered && <span className="wd-folio__no">{String(index + 1).padStart(2, '0')}</span>}
              <b>{entry.title}</b>
              <ChevronDown className="wd-folio__chevron" aria-hidden="true" />
            </button>
            {isOpen && <p className="wd-folio__body">{entry.body}</p>}
          </li>
        );
      })}
    </ol>
  );
}

const asFolios = (entries: WorldBookEntryDef[], fallback: string) => entries.map((entry, index) => ({ id: entry.uid ?? index, title: entry.comment || `${fallback} ${index + 1}`, body: entry.content }));

function OverviewChapter({ world }: { world: WorldDef }) {
  const setting = byType(world, 'setting')[0];
  const highlights = byType(world, 'highlights').flatMap(entry => entry.meta?.highlights ?? []);
  const meta = setting?.meta;
  const prose = setting?.content ? settingProse(setting.content) : '';
  const coordinates = [
    { icon: Compass, label: '类型', value: meta?.genre },
    { icon: MapPin, label: '坐标', value: meta?.location },
    { icon: Clock, label: '时代', value: meta?.timePeriod },
    { icon: Cloud, label: '气候', value: meta?.atmosphere },
    { icon: ShieldAlert, label: '冲突', value: meta?.conflict },
    { icon: Timer, label: '时长', value: meta?.estimatedPlaytime },
  ].filter(row => row.value);
  return (
    <>
      {prose && <p className="wd-prose">{prose}</p>}
      {coordinates.length > 0 && (
        <dl className="wd-coords">
          {coordinates.map(({ icon: Icon, label, value }) => <div key={label}><dt><Icon aria-hidden="true" />{label}</dt><dd>{value}</dd></div>)}
        </dl>
      )}
      {highlights.length > 0 && (
        <Section icon={Sparkles} title="此界特色">
          <ol className="wd-highlights">{highlights.map((text, index) => <li key={index}><span>{index + 1}</span>{text}</li>)}</ol>
        </Section>
      )}
      {(meta?.recommendedFor?.length || meta?.avoidIf?.length) ? (
        <Section icon={Compass} title="旅者指引">
          <div className="wd-chips">
            {meta?.recommendedFor?.map(text => <span key={text} className="wd-chip">{text}</span>)}
            {meta?.avoidIf?.map(text => <span key={text} className="wd-chip is-warn"><Ban aria-hidden="true" />{text}</span>)}
          </div>
        </Section>
      ) : null}
    </>
  );
}

function FactionsChapter({ world }: { world: WorldDef }) {
  const factions = byType(world, 'factions').flatMap(entry => entry.meta?.factions ?? []);
  return (
    <div className="wd-factions">
      {factions.map((faction, index) => {
        const tone = ALIGNMENT_TONE[faction.alignment ?? ''] ?? 'is-neutral';
        return (
          <article key={`${faction.name}-${index}`} className={`wd-faction ${tone}`} style={{ '--i': Math.min(index, 12) } as React.CSSProperties}>
            <span className="wd-faction__banner" aria-hidden="true"><Flag /></span>
            <div>
              <header><b>{faction.name}</b>{faction.alignment && <em>{faction.alignment}</em>}</header>
              <p>{faction.description}</p>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function NpcsChapter({ world }: { world: WorldDef }) {
  const npcs = byType(world, 'npcs').flatMap(entry => entry.meta?.npcs ?? []);
  const [open, setOpen] = useState<number | null>(null);
  return (
    <ul className="wd-people">
      {npcs.map((npc, index) => {
        const isOpen = open === index;
        return (
          <li key={`${npc.name}-${index}`} className={`wd-person${isOpen ? ' is-open' : ''}`} style={{ '--i': Math.min(index, 12) } as React.CSSProperties}>
            <button type="button" className="wd-person__head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : index)}>
              <span className="wd-person__seal" aria-hidden="true">{Array.from(npc.name)[0]}</span>
              <span className="wd-person__name"><b>{npc.name}</b><small>{npc.role}</small></span>
              <ChevronDown className="wd-folio__chevron" aria-hidden="true" />
            </button>
            <p className="wd-person__desc">{npc.description}</p>
            {isOpen && npc.personality && <p className="wd-person__trait"><Sparkles aria-hidden="true" />{npc.personality}</p>}
          </li>
        );
      })}
    </ul>
  );
}

function CultureChapter({ world }: { world: WorldDef }) {
  const culture = byType(world, 'culture');
  const items = byType(world, 'items');
  return (
    <>
      {culture.length > 0 && <Section icon={Landmark} title="风俗" aside={`${culture.length} 则`}><Folios entries={asFolios(culture, '风俗')} /></Section>}
      {items.length > 0 && <Section icon={Package} title="器物" aside={`${items.length} 件`}><Folios entries={asFolios(items, '器物')} /></Section>}
    </>
  );
}

function LawsChapter({ world }: { world: WorldDef }) {
  const rules = byType(world, 'rules');
  const economy = byType(world, 'economy');
  const events = byType(world, 'events').flatMap(entry => entry.meta?.events ?? []);
  const relations = byType(world, 'relationships').map(entry => entry.meta?.relationships).find(Boolean);
  const currency = economy.map(entry => entry.meta?.currency).find(Boolean);
  const priceLevel = economy.map(entry => entry.meta?.priceLevel).find(Boolean);
  const time = economy.map(entry => entry.meta).find(meta => meta?.calendar || meta?.startTime || meta?.timeSpeed);
  const powers = rules.map(entry => entry.meta).filter(meta => meta?.powerSystem || meta?.socialStructure);
  const specials = rules.flatMap(entry => entry.meta?.specialRules ?? []);
  const plainRules = rules.filter(entry => !entry.meta?.powerSystem && !entry.meta?.socialStructure && !entry.meta?.specialRules?.length);
  const ledgerEntries = economy.filter(entry => entry.content && economy.length > 1);
  return (
    <>
      {(powers.length > 0 || specials.length > 0 || plainRules.length > 0) && (
        <Section icon={Scale} title="世界法则">
          {powers.map((meta, index) => (
            <dl key={index} className="wd-coords is-stacked">
              {meta?.powerSystem && <div><dt><Zap aria-hidden="true" />力量</dt><dd>{meta.powerSystem}</dd></div>}
              {meta?.socialStructure && <div><dt><Network aria-hidden="true" />社会</dt><dd>{meta.socialStructure}</dd></div>}
            </dl>
          ))}
          {specials.length > 0 && <ol className="wd-edicts">{specials.map((rule, index) => <li key={index}>{rule}</li>)}</ol>}
          {plainRules.length > 0 && <Folios entries={asFolios(plainRules, '法则')} numbered={false} />}
        </Section>
      )}
      {(currency || priceLevel || ledgerEntries.length > 0) && (
        <Section icon={Coins} title="钱货往来">
          {currency && (
            <div className="wd-coin">
              <span className="wd-coin__face" aria-hidden="true">{currency.symbol || Array.from(currency.name)[0]}</span>
              <div><b>{currency.name}</b>{currency.description && <p>{currency.description}</p>}</div>
            </div>
          )}
          {priceLevel && <p className="wd-note">{priceLevel}</p>}
          {ledgerEntries.length > 0 && <Folios entries={asFolios(ledgerEntries, '账目')} numbered={false} />}
        </Section>
      )}
      {time && (
        <Section icon={Hourglass} title="历法">
          <dl className="wd-coords is-stacked">
            {time.calendar && <div><dt><CalendarDays aria-hidden="true" />历法</dt><dd>{time.calendar}</dd></div>}
            {time.startTime && <div><dt><Clock aria-hidden="true" />开局</dt><dd>{time.startTime}</dd></div>}
            {time.timeSpeed && <div><dt><Hourglass aria-hidden="true" />流速</dt><dd>{time.timeSpeed}</dd></div>}
          </dl>
        </Section>
      )}
      {events.length > 0 && (
        <Section icon={CalendarDays} title="岁时大事">
          <ol className="wd-timeline">
            {events.map((event, index) => (
              <li key={`${event.name}-${index}`} className={event.significance === 'major' ? 'is-major' : ''}>
                <header><b>{event.name}</b>{event.trigger && <small>{event.trigger}</small>}</header>
                <p>{event.description}</p>
              </li>
            ))}
          </ol>
        </Section>
      )}
      {relations && (
        <Section icon={HeartHandshake} title="人情关系">
          {relations.description && <p className="wd-note">{relations.description}</p>}
          {relations.types?.length ? <div className="wd-chips">{relations.types.map(type => <span key={type.name} className="wd-chip" title={type.description}>{type.name}</span>)}</div> : null}
        </Section>
      )}
    </>
  );
}

function moduleFigures(module: WorldModule): ReactNode {
  const config = (module.moduleConfig ?? {}) as Record<string, any>;
  if (module.moduleId === 'stat') {
    const dims = ['dim1', 'dim2', 'dim3', 'dim4', 'dim5', 'dim6'].map(key => config[key]).filter(Boolean);
    const vitals = [config.attrA, config.attrB].filter(Boolean);
    if (!dims.length && !vitals.length) return null;
    return (
      <div className="wd-stats">
        {vitals.map((attr: any) => <span key={attr.name} className="is-vital"><b>{attr.name}</b><small>{attr.max ?? ''}</small></span>)}
        {dims.map((dim: any) => <span key={dim.name}><b>{dim.name}</b>{dim.range && <small>{dim.range[0]}–{dim.range[1]}</small>}</span>)}
      </div>
    );
  }
  if (module.moduleId === 'progression') {
    const tiers: Array<{ name: string }> = config.tiers ?? [];
    if (tiers.length) return <ol className="wd-ladder">{tiers.map((tier, index) => <li key={`${tier.name}-${index}`}>{tier.name}</li>)}</ol>;
    if (config.levelData?.maxLevel) return <p className="wd-note">等级制 · 0 – {config.levelData.maxLevel} 级</p>;
    return null;
  }
  if (module.moduleId === 'survival') {
    const resources: Array<{ id?: string; name: string; scarce?: boolean }> = config.resources ?? [];
    if (!resources.length) return null;
    return (
      <div className="wd-chips">
        {resources.map(resource => { const Glyph = resourceGlyph(resource); return <span key={resource.id ?? resource.name} className={`wd-chip${resource.scarce ? ' is-warn' : ''}`}><Glyph aria-hidden="true" />{resource.name}</span>; })}
      </div>
    );
  }
  if (module.moduleId === 'business') {
    const goods: Array<{ name: string }> = config.market?.items ?? [];
    return (
      <>
        <p className="wd-note">起始资金 {config.funds ?? 0} · 每{config.cycleName || '天'}结算</p>
        {goods.length > 0 && <div className="wd-chips">{goods.map(item => <span key={item.name} className="wd-chip">{item.name}</span>)}</div>}
      </>
    );
  }
  return null;
}

function SystemsChapter({ modules }: { modules: WorldModule[] }) {
  return (
    <ul className="wd-modules">
      {modules.map((module, index) => {
        const Icon = MODULE_ICON[module.moduleId] ?? Puzzle;
        return (
          <li key={`${module.moduleId}-${index}`} className="wd-module" style={{ '--i': Math.min(index, 12) } as React.CSSProperties}>
            <span className="wd-module__badge" aria-hidden="true"><Icon /></span>
            <div className="wd-module__copy">
              <b>{module.name || MODULE_FALLBACK[module.moduleId] || module.moduleId}</b>
              {module.description && <p>{module.description}</p>}
              {moduleFigures(module)}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Right-hand plane dossier: chapters built only from the data this world actually carries. */
export default function WorldDossier({ world }: { world: WorldDef }) {
  const chapters = useMemo<Chapter[]>(() => {
    const count = (type: string) => byType(world, type).length;
    const factions = byType(world, 'factions').flatMap(entry => entry.meta?.factions ?? []).length;
    const npcs = byType(world, 'npcs').flatMap(entry => entry.meta?.npcs ?? []).length;
    const lore = byType(world, 'lore');
    const modules = (world.modules ?? []).filter(module => module.enabled);
    const hasOverview = count('setting') > 0 || count('highlights') > 0;
    const hasLaws = ['rules', 'economy', 'events', 'relationships'].some(type => count(type) > 0);
    const list: Array<Chapter | false> = [
      hasOverview && { key: 'overview', label: '概览', icon: BookOpen, render: () => <OverviewChapter world={world} /> },
      lore.length > 0 && { key: 'lore', label: '地理', icon: Map, count: lore.length, render: () => <Folios entries={asFolios(lore, '地点')} /> },
      factions > 0 && { key: 'factions', label: '势力', icon: Flag, count: factions, render: () => <FactionsChapter world={world} /> },
      npcs > 0 && { key: 'npcs', label: '人物', icon: Users, count: npcs, render: () => <NpcsChapter world={world} /> },
      (count('culture') + count('items')) > 0 && { key: 'culture', label: '风物', icon: Landmark, count: count('culture') + count('items'), render: () => <CultureChapter world={world} /> },
      hasLaws && { key: 'laws', label: '法则', icon: Scale, render: () => <LawsChapter world={world} /> },
      modules.length > 0 && { key: 'systems', label: '系统', icon: Layers, count: modules.length, render: () => <SystemsChapter modules={modules} /> },
    ];
    return list.filter((chapter): chapter is Chapter => Boolean(chapter));
  }, [world]);
  const [active, setActive] = useState<ChapterKey | null>(null);
  const current = chapters.find(chapter => chapter.key === active) ?? chapters[0];

  return (
    <PlanarFrame as="section" variant="plate" material="glass" className="wd-dossier" ariaLabel="位面档案">
      <header className="wd-dossier__head">
        <span className="pk-kicker">位面档案</span>
        <p>{chapters.filter(chapter => chapter.count).map(chapter => `${chapter.label} ${chapter.count}`).join(' · ') || '此界尚无更多记载'}</p>
      </header>
      {chapters.length > 0 ? (
        <>
          <div className="wd-index" role="tablist" aria-label="档案章节">
            {chapters.map(chapter => {
              const Icon = chapter.icon;
              const selected = chapter.key === current?.key;
              return (
                <button key={chapter.key} type="button" role="tab" id={`wd-tab-${chapter.key}`} aria-selected={selected} aria-controls="wd-chapter" className={selected ? 'is-active' : ''} onClick={() => setActive(chapter.key)}>
                  <Icon aria-hidden="true" /><span>{chapter.label}</span>
                </button>
              );
            })}
          </div>
          <div key={current?.key} id="wd-chapter" role="tabpanel" aria-labelledby={`wd-tab-${current?.key}`} className="wd-chapter">
            {current?.render()}
          </div>
        </>
      ) : (
        <div className="wd-empty"><BookOpen aria-hidden="true" /><p>这个世界还没有写下设定、地理或人物。</p><small>进入「编辑世界」补全后，这里会自动编成档案。</small></div>
      )}
    </PlanarFrame>
  );
}

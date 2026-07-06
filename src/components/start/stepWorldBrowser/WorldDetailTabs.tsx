import {
  ScrollText, MapPin, Clock, Cloud, Sparkles, Star, Compass, Globe, Map,
  Flag, BookMarked, User, AlertTriangle, Zap, Users, Swords, Layers,
  BarChart3, Target, Briefcase, DollarSign, Heart, Calendar,
} from 'lucide-react';
import type { WorldDef, WorldBookEntryDef } from '../../../data/worlds-schema';
import type { WorldBookEntry } from '../../../worldbook/index';
import { findEntryByType } from './constants';

/** 从设定文本中提取【世界背景】之后、【时间】/【地点】/【氛围】之前的内容 */
function extractBackgroundText(content: string): string {
  // 匹配 【背景】 或 【世界背景】 之后，到 【时间】/【地点】/【氛围】/【核心】/【特色】 之前的内容
  const bgMatch = content.match(/【(?:世界)?背景】\s*([\s\S]*?)(?=【(?:时间|地点|氛围|核心|特色)】)/);
  if (bgMatch) return bgMatch[1].trim();
  // 兜底：去掉末尾的 时间/地点/氛围 行
  const lines = content.split('\n');
  const cutIdx = lines.findIndex(l => /^【(?:时间|地点|氛围)/.test(l.trim()));
  return (cutIdx > 0 ? lines.slice(0, cutIdx) : lines).join('\n').trim();
}

export function OverviewTab({ world, worldEntry }: { world: WorldDef; worldEntry: WorldBookEntry | null }) {
  const settingEntry = findEntryByType(world.worldBookEntries, 'setting');
  const highlightsEntry = findEntryByType(world.worldBookEntries, 'highlights');
  const rawContent = worldEntry?.content || settingEntry?.content || '';
  const backgroundText = rawContent ? extractBackgroundText(rawContent) : '';
  return (
    <div className="tab-section">
      {backgroundText && (
        <div className="detail-block"><div className="detail-block-title"><ScrollText size={15} />世界设定</div><div className="detail-block-body">{backgroundText}</div></div>
      )}
      {settingEntry?.meta && (
        <div className="detail-badges">
          {settingEntry.meta.location && <span className="detail-badge"><MapPin size={12} />{settingEntry.meta.location}</span>}
          {settingEntry.meta.timePeriod && <span className="detail-badge"><Clock size={12} />{settingEntry.meta.timePeriod}</span>}
          {settingEntry.meta.atmosphere && <span className="detail-badge"><Cloud size={12} />{settingEntry.meta.atmosphere}</span>}
        </div>
      )}
      {highlightsEntry?.meta?.highlights && highlightsEntry.meta.highlights.length > 0 && (
        <div className="detail-block"><div className="detail-block-title"><Star size={15} />核心特色</div><div className="detail-pills">{highlightsEntry.meta.highlights.map((h, i) => <span key={i} className="detail-pill"><Sparkles size={11} />{h}</span>)}</div></div>
      )}
      {settingEntry?.meta?.recommendedFor && settingEntry.meta.recommendedFor.length > 0 && (
        <div className="detail-block"><div className="detail-block-title"><Compass size={15} />适合人群</div><div className="detail-pills">{settingEntry.meta.recommendedFor.map((p, i) => <span key={i} className="detail-pill">{p}</span>)}</div></div>
      )}
    </div>
  );
}


export function LoreTab({ world }: { world: WorldDef }) {
  const loreEntries = world.worldBookEntries?.filter(e => e.entryType === 'lore') ?? [];
  return (
    <div className="tab-section">
      {loreEntries.length > 0 ? (
        <div className="detail-block"><div className="detail-block-title"><Map size={15} />地理区域</div><div className="factions-grid">{loreEntries.map((entry, i) => (
          <div key={i} className="faction-card"><div className="faction-header"><span className="faction-name">{entry.comment}</span></div><div className="faction-desc">{entry.content}</div></div>
        ))}</div></div>
      ) : <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>暂无地理数据</div>}
    </div>
  );
}

export function FactionsTab({ world }: { world: WorldDef }) {
  const allFactions = (world.worldBookEntries?.filter(e => e.entryType === 'factions') ?? []).flatMap(e => e.meta?.factions ?? []);
  return (
    <div className="tab-section">
      {allFactions.length > 0 ? (
        <div className="detail-block"><div className="detail-block-title"><Flag size={15} />势力分布</div><div className="factions-grid">{allFactions.map((f, i) => (
          <div key={i} className="faction-card"><div className="faction-header"><span className="faction-name">{f.name}</span>{f.alignment && <span className={`faction-alignment ${f.alignment === '友善' ? 'friendly' : f.alignment === '敌对' ? 'hostile' : 'neutral'}`}>{f.alignment}</span>}</div><div className="faction-desc">{f.description}</div></div>
        ))}</div></div>
      ) : <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>暂无势力数据</div>}
    </div>
  );
}

export function CultureTab({ world }: { world: WorldDef }) {
  const entries = world.worldBookEntries?.filter(e => e.entryType === 'culture') ?? [];
  return (
    <div className="tab-section">
      {entries.length > 0 ? entries.map((entry, i) => (
        <div key={i} className="detail-block"><div className="detail-block-title"><BookMarked size={15} />{entry.comment || '文化风俗'}</div><div className="detail-block-body">{entry.content}</div></div>
      )) : <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>暂无文化数据</div>}
    </div>
  );
}

export function NpcsTab({ world }: { world: WorldDef }) {
  const allNPCs = (world.worldBookEntries?.filter(e => e.entryType === 'npcs') ?? []).flatMap(e => e.meta?.npcs ?? []);
  return (
    <div className="tab-section">
      {allNPCs.length > 0 ? (
        <div className="detail-block"><div className="detail-block-title"><User size={15} />关键 NPC</div><div className="npcs-grid">{allNPCs.map((npc, i) => (
          <div key={i} className="npc-card"><div className="npc-header"><span className="npc-name">{npc.name}</span><span className="npc-role">{npc.role}</span></div><div className="npc-desc">{npc.description}</div>{npc.personality && <div className="npc-personality">性格：{npc.personality}</div>}</div>
        ))}</div></div>
      ) : <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>暂无人物数据</div>}
    </div>
  );
}

export function RulesTab({ world }: { world: WorldDef }) {
  const rulesEntry = findEntryByType(world.worldBookEntries, 'rules');
  return (
    <div className="tab-section">
      {rulesEntry?.meta ? (
        <div className="detail-block"><div className="detail-block-title"><Swords size={15} />世界规则</div><div className="detail-block-body">
          {rulesEntry.meta.powerSystem && <div className="detail-row"><Zap size={13} /><strong>力量体系：</strong>{rulesEntry.meta.powerSystem}</div>}
          {rulesEntry.meta.socialStructure && <div className="detail-row"><Users size={13} /><strong>社会结构：</strong>{rulesEntry.meta.socialStructure}</div>}
          {rulesEntry.meta.specialRules?.map((rule, i) => <div key={i} className="detail-rule"><AlertTriangle size={12} />{rule}</div>)}
        </div></div>
      ) : rulesEntry?.content ? (
        <div className="detail-block"><div className="detail-block-title"><Swords size={15} />世界规则</div><div className="detail-block-body">{rulesEntry.content}</div></div>
      ) : <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>暂无规则数据</div>}
    </div>
  );
}

export function EconomyTab({ world }: { world: WorldDef }) {
  const survMod = world.modules?.find(m => m.moduleId === 'survival' && m.enabled);
  const survData = survMod?.moduleConfig as any;
  const resources = survData?.resources || [];
  const recipes = survData?.recipes || [];
  const resDesc = survData?.description;
  const economyEntry = findEntryByType(world.worldBookEntries, 'economy');
  const currency = economyEntry?.meta?.currency;

  return (
    <div className="tab-section">
      {(economyEntry || currency) && (
        <div className="detail-block"><div className="detail-block-title"><DollarSign size={15} />经济系统</div><div className="detail-block-body">
          {currency && <div className="detail-row"><strong>{currency.symbol ?? ''} {currency.name}</strong>{currency.description && <span> — {currency.description}</span>}</div>}
          {economyEntry?.meta?.priceLevel && <div className="detail-row"><BarChart3 size={13} /><strong>物价水平：</strong>{economyEntry.meta.priceLevel}</div>}
        </div></div>
      )}
      {resources.length > 0 && (
        <div className="detail-block"><div className="detail-block-title"><Flag size={15} />生存资源</div><div className="detail-block-body">
          {resDesc && <p>{resDesc}</p>}
          <div className="resources-list">{resources.map((res: any) => (
            <div key={res.id} className={`resource-item${res.scarce ? ' scarce' : ''}`}><div className="resource-header"><span className="resource-name">{res.symbol ? `${res.symbol} ` : ''}{res.name}</span>{res.scarce && <span className="resource-scarce">稀缺</span>}</div><div className="resource-desc">{res.description}</div></div>
          ))}</div>
        </div></div>
      )}
      {economyEntry?.meta && (economyEntry.meta.calendar || economyEntry.meta.startTime || economyEntry.meta.timeSpeed) && (
        <div className="detail-block"><div className="detail-block-title"><Clock size={15} />时间系统</div><div className="detail-block-body">
          {economyEntry.meta.calendar && <div className="detail-row"><Calendar size={13} /><strong>历法：</strong>{economyEntry.meta.calendar}</div>}
          {economyEntry.meta.startTime && <div className="detail-row"><Clock size={13} /><strong>开局时间：</strong>{economyEntry.meta.startTime}</div>}
          {economyEntry.meta.timeSpeed && <div className="detail-row"><Zap size={13} /><strong>时间流速：</strong>{economyEntry.meta.timeSpeed}</div>}
        </div></div>
      )}
    </div>
  );
}

export function SystemsTab({ world }: { world: WorldDef }) {
  const statMod = world.modules?.find(m => m.moduleId === 'stat' && m.enabled);
  const progMod = world.modules?.find(m => m.moduleId === 'progression' && m.enabled);
  const survMod = world.modules?.find(m => m.moduleId === 'survival' && m.enabled);
  const statData = statMod?.moduleConfig as any;
  const hasNewStat = !!statData?.attrA;
  const dims = hasNewStat ? ['dim1','dim2','dim3','dim4','dim5','dim6'].filter(k => statData[k]).map(k => ({ key: k, name: statData[k].name, range: statData[k].range })) : [];
  const specials: Array<{ id: string; name: string; value: number; range: [number,number]; description: string }> = statData?.special || [];
  const progData = progMod?.moduleConfig as any;
  const tiers: Array<{ name: string; description?: string }> = progData?.tiers || [];
  const progDesc = progData ? (progData.mode === 'tiered' ? '段位制' : '等级制') : '';
  const survData = survMod?.moduleConfig as any;
  const resources = survData?.resources || [];
  const resDesc = survData?.description;
  const relationshipsEntry = findEntryByType(world.worldBookEntries, 'relationships');
  const eventsEntry = findEntryByType(world.worldBookEntries, 'events');
  const modulesRaw = world.modules as any[] | undefined;
  const isStringArray = Array.isArray(modulesRaw) && modulesRaw.length > 0 && typeof modulesRaw[0] === 'string';
  const enabledModules = isStringArray ? (modulesRaw as string[]) : [];
  const MODULE_NAMES: Record<string, string> = { stat: '数值属性', progression: '成长体系', survival: '生存资源', business: '经营资产', dice: '骰子检定', talent: '天赋体系', simulation: '世界演化' };

  if (isStringArray && !statData && !progData && !survData) {
    return (
      <div className="tab-section">
        {enabledModules.length > 0 ? (
          <div className="detail-block"><div className="detail-block-title"><Layers size={15} />启用的模块</div><div className="detail-block-body"><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{enabledModules.map(mod => <span key={mod} className="detail-pill">{MODULE_NAMES[mod] || mod}</span>)}</div></div></div>
        ) : (
          <div className="detail-block"><div className="detail-block-title"><Layers size={15} />系统模块</div><div className="detail-block-body"><p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>该世界为纯叙事模式，无数值系统模块。</p></div></div>
        )}
      </div>
    );
  }

  return (
    <div className="tab-section">
      {(dims.length > 0 || specials.length > 0) && (
        <div className="detail-block"><div className="detail-block-title"><BarChart3 size={15} />数值属性</div><div className="detail-block-body">
          {dims.length > 0 && <div className="stats-grid">{dims.map(d => <div key={d.key} className="stat-card"><div className="stat-name">{d.name}</div><div className="stat-range">{d.range ? `${d.range[0]}~${d.range[1]}` : ''}</div></div>)}</div>}
          {specials.length > 0 && <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>{specials.map(sp => <span key={sp.id} className="detail-pill" title={sp.description}>{sp.name} {sp.value}</span>)}</div>}
        </div></div>
      )}
      {(tiers.length > 0 || (progData?.mode === 'level' && progData?.levelData)) && (
        <div className="detail-block"><div className="detail-block-title"><Target size={15} />成长体系</div><div className="detail-block-body">
          {progDesc && <p>{progDesc}</p>}
          {progData?.mode === 'level' && progData?.levelData && <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>等级范围：0 ~ {progData.levelData.maxLevel} 级<span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>（每级生命+{progData.levelData.growthPerLevel?.attrAMax || 0}，六维+{progData.levelData.growthPerLevel?.dim1Max || 0}）</span></div>}
          {tiers.length > 0 && <div className="progression-ladder">{tiers.map((tier, i) => <div key={i} className="progression-tier"><span className="tier-number">{i + 1}</span><div><span className="tier-name">{tier.name}</span>{tier.description && <span className="tier-desc">{tier.description}</span>}</div></div>)}</div>}
        </div></div>
      )}
      {resources.length > 0 && (
        <div className="detail-block"><div className="detail-block-title"><Flag size={15} />生存资源</div><div className="detail-block-body">
          {resDesc && <p>{resDesc}</p>}
          <div className="resources-list">{resources.map((res: any) => <div key={res.id} className={`resource-item${res.scarce ? ' scarce' : ''}`}><div className="resource-header"><span className="resource-name">{res.symbol ? `${res.symbol} ` : ''}{res.name}</span>{res.scarce && <span className="resource-scarce">稀缺</span>}</div><div className="resource-desc">{res.description}</div></div>)}</div>
        </div></div>
      )}
      {(() => {
        const bizMod = world.modules?.find(m => m.moduleId === 'business' && m.enabled);
        const bizData = bizMod?.moduleConfig as any;
        if (!bizData) return null;
        return (
          <div className="detail-block"><div className="detail-block-title"><Briefcase size={15} />经营资产</div><div className="detail-block-body">
            {bizData.description && <p>{bizData.description}</p>}
            <div className="detail-row"><DollarSign size={13} /><strong>初始资金：</strong>{bizData.funds ?? 0}</div>
            <div className="detail-row"><Clock size={13} /><strong>结算周期：</strong>每{bizData.cycleName || '天'}</div>
            {bizData.market?.items && bizData.market.items.length > 0 && (
              <><div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--text-muted)', marginTop: 8, marginBottom: 4 }}>市场行情</div><div className="detail-pills">{bizData.market.items.map((item: any, i: number) => <span key={i} className="detail-pill" title={`基准价: ${item.basePrice}`}>{item.name} {item.trend === 'up' ? '▲' : item.trend === 'down' ? '▼' : '─'}{Math.abs(item.changePercent || 0)}%</span>)}</div></>
            )}
          </div></div>
        );
      })()}
      {relationshipsEntry?.meta?.relationships && (
        <div className="detail-block"><div className="detail-block-title"><Heart size={15} />关系系统</div><div className="detail-block-body">
          {relationshipsEntry.meta.relationships.description && <p>{relationshipsEntry.meta.relationships.description}</p>}
          {relationshipsEntry.meta.relationships.mechanics && <div className="detail-row"><Zap size={13} /><strong>机制：</strong>{relationshipsEntry.meta.relationships.mechanics}</div>}
          <div className="detail-pills">{(relationshipsEntry.meta.relationships.types ?? []).map((rt, i) => <span key={i} className="detail-pill" title={rt.description}>{rt.name}</span>)}</div>
        </div></div>
      )}
      {eventsEntry?.meta?.events && eventsEntry.meta.events.length > 0 && (
        <div className="detail-block"><div className="detail-block-title"><Calendar size={15} />世界事件</div><div className="events-list">{eventsEntry.meta.events.map((evt, i) => (
          <div key={i} className={`event-item${evt.significance === 'major' ? ' major' : ''}`}><div className="event-header"><span className="event-name">{evt.name}</span>{evt.trigger && <span className="event-trigger">{evt.trigger}</span>}</div><div className="event-desc">{evt.description}</div></div>
        ))}</div></div>
      )}
    </div>
  );
}

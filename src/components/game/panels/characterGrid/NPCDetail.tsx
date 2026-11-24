import type { ChronicleMergeOptions } from './chronicleActions';
import { useCallback, useId, useState, type CSSProperties, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  User, BarChart3, Briefcase, MapPin, Sparkles, BookOpen, Brain, Dna, Zap, Star, Swords, ScrollText, Eye, EyeOff,
} from 'lucide-react';
import OverlayPortal from '../../../shared/OverlayPortal';
import { ExcelRow } from '../../../shared/ExcelRow';
import EmptyState from '../../../shared/EmptyState';
import type { KnownNPC } from '../../../../engine/playerKnowledge';
import type { GameState, NPCData } from '../../../../schema/variables';
import type { WorldDef } from '../../../../data/worlds-schema';
import type { StatModuleSchema } from '../../../../modules/schema';
import { findWorldDef } from '../../../../data/worldLoader';
import { statDefinitions } from '../../../../domains/stats/module';
import { equipmentStatBonus } from '../../../../domains/equipment/bonus';
import { readNpcEquipment, itemSlotKind, SLOT_KIND_LABEL } from '../../../../domains/equipment/slots';
import { buildNpcEquipmentView, buildPlayerEquipmentView, itemBonusChips, statsConfigFor } from '../../../../domains/equipment/viewModel';
import { bagSize, npcInventoryLayout, type BagView, type InventoryCell } from '../../../../domains/inventory/capacity';
import { useStoredImageUrl } from '../../../../hooks/useStoredImageUrl';
import { DETAIL_TABS } from './types';
import type { DetailTab } from './types';
import { RevealRow } from './RevealRow';
import { FogPanel, hasBlockContent } from './FogPanel';
import { TagList } from './SharedUI';
import { ListOrRecord } from './ListOrRecord';
import { DeedsModal } from './DeedsModal';
import { PortraitHeader } from './PortraitHeader';
import { NpcGearRing } from '../../inventory/NpcGearRing';
import { InventoryPack } from '../../inventory/InventoryPack';
import { ItemSheet, SheetBlock, SheetRows } from '../../inventory/ItemSheet';
import { BonusChips, ItemGlyph, qualityStyle } from '../../inventory/ItemGlyph';
import '../../../../ui/screens/game-equipment.css';
import '../../../../ui/screens/game-npc.css';

type Rec = Record<string, any>;

function Block({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <section className="npc-block">
      <h4 className="npc-block__title"><Icon size={14} strokeWidth={1.6} aria-hidden="true" />{title}</h4>
      {children}
    </section>
  );
}

function statConfigOf(world: WorldDef | undefined): StatModuleSchema | undefined {
  return world?.modules?.find(module => module.moduleId === 'stat' && module.enabled)?.moduleConfig as StatModuleSchema | undefined;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 生命/体力条 + 六维 + 特色属性；穿戴装备的加成标在旁边（生命/体力的加成算在上限里）。 */
function NpcStats({ data, world }: { data: Rec; world?: WorldDef }) {
  const stats = data.生存状态 as Record<string, number> | undefined;
  if (!stats || Object.keys(stats).length === 0) return null;
  const config = statConfigOf(world);
  const defs = config ? statDefinitions(config) : [];
  const gear = readNpcEquipment(data).slots;
  const bonusOf = (field: string) => {
    const def = defs.find(item => item.field === field || item.id === field);
    return def && config?.equipment?.enabled !== false ? equipmentStatBonus(gear, def) : 0;
  };
  const vitals = [
    { key: '血量', name: config?.attrA?.name || '血量', max: Number(config?.attrA?.max) || 100, color: 'rgb(var(--d-red-bg, 214, 112, 98))' },
    { key: '体力值', name: config?.attrB?.name || '体力值', max: Number(config?.attrB?.max) || 100, color: 'rgb(var(--d-warn-bg, 240, 186, 96))' },
  ].filter(vital => typeof stats[vital.key] === 'number');
  const rest = Object.entries(stats).filter(([key, value]) => key !== '血量' && key !== '体力值' && typeof value === 'number');
  return (
    <div>
      {vitals.length > 0 && (
        <div className="npc-vitals">
          {vitals.map(vital => {
            const max = Math.max(1, vital.max + bonusOf(vital.key));
            const value = Number(stats[vital.key]);
            return (
              <div key={vital.key} className="npc-vital">
                <div><span>{vital.name}</span><b>{value}/{max}</b></div>
                <span className="npc-vital__bar"><i style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%`, '--bar': vital.color } as CSSProperties} /></span>
              </div>
            );
          })}
        </div>
      )}
      {rest.length > 0 && (
        <div className="npc-dims">
          {rest.map(([key, value]) => {
            const def = defs.find(item => item.field === key || item.id === key);
            const bonus = bonusOf(key);
            return (
              <div key={key} className="npc-dim" title={bonus ? `基础 ${value}，装备 ${bonus > 0 ? '+' : ''}${bonus}` : undefined}>
                <span>{def?.name ?? key}</span>
                <b>{round(value + bonus)}{bonus ? <small data-sign={bonus > 0 ? 'up' : 'down'}>{bonus > 0 ? '▲' : '▼'}{Math.abs(bonus)}</small> : null}</b>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 能力页签：属性、成长、天赋与技能（已知版本直接显示，只有幕后版本时放进迷雾）。 */
function SkillsBlock({ data, world }: { data: Rec; world?: WorldDef }) {
  return (
    <div className="npc-stack">
      {data.特殊能力 && <Block icon={Sparkles} title="特殊能力"><p className="npc-text">{String(data.特殊能力)}</p></Block>}
      {data.生存状态 && Object.keys(data.生存状态).length > 0 && <Block icon={BarChart3} title="属性"><NpcStats data={data} world={world} /></Block>}
      {data.成长状态 && (
        <Block icon={Star} title="成长状态">
          <span className="eq-chips">
            {data.成长状态.当前段位索引 != null && <span className="eq-chip">段位 <b>{data.成长状态.当前段位索引}</b></span>}
            {data.成长状态.当前经验值 != null && <span className="eq-chip">经验 <b>{data.成长状态.当前经验值}</b></span>}
          </span>
        </Block>
      )}
      {Array.isArray(data.天赋) && data.天赋.length > 0 && <Block icon={Star} title="天赋"><TagList items={data.天赋} accent /></Block>}
      {data.技能列表 && hasBlockContent(data.技能列表) && <Block icon={Zap} title="技能"><ListOrRecord data={data.技能列表} emptyText="暂无技能" /></Block>}
    </div>
  );
}

function hasGear(data: unknown): boolean {
  const reading = readNpcEquipment(data);
  return Object.keys(reading.slots).length > 0 || reading.extras.length > 0;
}

function hasPack(data: unknown): boolean {
  const layout = npcInventoryLayout(data);
  return layout.cells.length > 0 || layout.bags.length > 0;
}

/** 行囊页签：物品栏与建档时的物品列表合成一个有容量的行囊。 */
export function NpcPackBlock({ data, onSelect, onSelectBag }: { data: Rec; onSelect?: (cell: InventoryCell) => void; onSelectBag?: (bag: BagView) => void }) {
  return (
    <div className="npc-block">
      <InventoryPack layout={npcInventoryLayout(data)} title="随身行囊" onSelect={onSelect} onSelectBag={onSelectBag} emptyNote="身上没有带东西。" />
    </div>
  );
}

/** 装备页签：装备环（装备栏 + 建档时的装备列表），与主角同部位比较。 */
export function NpcGearBlock({ data, name, portrait, world, gameState }: { data: Rec; name: string; portrait: ReactNode; world?: WorldDef; gameState?: GameState }) {
  const state = gameState ?? ({ 玩家: { 生存状态: {}, 物品栏: {} }, 人物档案: {} } as unknown as GameState);
  const view = buildNpcEquipmentView(data, world, state);
  const player = gameState ? buildPlayerEquipmentView(gameState, world) : undefined;
  return (
    <div className="npc-block">
      <NpcGearRing view={view} portrait={portrait} name={name} player={player} />
    </div>
  );
}

type Inspect = { source: 'known' | 'truth'; key: string; bag?: boolean };

export function NPCDetail({ npc, npcId, truth, gameState, onClose, onUpdateChronicles, onMergeChronicles, onDeleteNpc, worldId, onDeleted }: {
  npc: KnownNPC; npcId: string; onClose: () => void;
  /** 幕后真相：只用于读者点开眼睛查看，不会同步给玩家扮演的角色。 */
  truth?: NPCData;
  /** 当前存档：装备页与主角同部位比较、读世界的属性名称。 */
  gameState?: GameState;
  onUpdateChronicles?: (npcId: string, chronicles: string[], expectedChronicles?: string[]) => boolean | void;
  onMergeChronicles?: (npcId: string, startIndex: number, endIndex: number, options?: ChronicleMergeOptions) => Promise<boolean>;
  /** 删除该 NPC；返回 false 表示删除未生效。 */
  onDeleteNpc?: (npcId: string) => boolean | Promise<boolean>;
  worldId?: string;
  /** 删除成功后的回调（用于关闭外层卡片选择状态）。 */
  onDeleted?: () => void;
}) {
  const [tab, setTab] = useState<DetailTab>('overview');
  const [showDeeds, setShowDeeds] = useState(false);
  /** 读者视角总开关：一键展开/收起本页全部幕后内容。 */
  const [readerView, setReaderView] = useState(false);
  const [inspect, setInspect] = useState<Inspect | null>(null);
  const titleId = useId();
  const tabId = useId();

  const ext = npc as Rec;
  const world = worldId ? findWorldDef(worldId) ?? undefined : undefined;
  const portraitUrl = useStoredImageUrl(ext.portraitBlobKey || `portrait-${npcId}`);
  const name = npc.姓名 || npcId;
  const portrait = portraitUrl ? <img src={portraitUrl} alt="" /> : <span>{name.trim()[0] ?? '?'}</span>;

  const handleDelete = useCallback(async () => {
    if (!onDeleteNpc) return;
    const ok = await onDeleteNpc(npcId);
    // 通知外层移除选中态；onDeleteNpc 内部已经做完存档 + 头像清理。
    if (ok) onDeleted?.();
  }, [onDeleteNpc, onDeleted, npcId]);

  const chronicles = (ext.人物事迹 as string[] | undefined) ?? [];
  const rd = npc.关系数据 ?? {};
  const sj = npc.社会身份 ?? { 职业: '', 社会地位: '' };
  const pi = npc.个人信息 ?? { 外貌: '', 表性格: '', 里性格: '', 当前想法: '', 当前穿着: '', 当前位置: '', 当前状态: '', 备注: '' };
  // 眼睛按钮点开的是幕后真相：只给屏幕前的读者看，不写回玩家认知、不进提示词。
  const truthPi = truth?.个人信息;
  const truthExt = truth as unknown as Rec | undefined;
  // 成块的内容：玩家已知就直出，只有幕后版本才压在迷雾下，两者皆空才显示暂无。
  const hasKnownSkills = hasBlockContent(ext.特殊能力, ext.生存状态, ext.成长状态, ext.天赋, ext.技能列表);
  const hasTruthSkills = hasBlockContent(truthExt?.特殊能力, truthExt?.生存状态, truthExt?.成长状态, truthExt?.天赋, truthExt?.技能列表);
  const knownGear = hasGear(ext);
  const truthGear = truthExt ? hasGear(truthExt) : false;
  const knownPack = hasPack(ext);
  const truthPack = truthExt ? hasPack(truthExt) : false;

  const inspectSource = inspect?.source === 'truth' ? truthExt : ext;
  const inspectItem = inspect ? npcInventoryLayout(inspectSource).cells.find(cell => cell.key === inspect.key)?.item
    ?? npcInventoryLayout(inspectSource).bags.find(bag => bag.key === inspect.key)?.item : undefined;

  const packFor = (source: 'known' | 'truth', data: Rec) => (
    <NpcPackBlock
      data={data}
      onSelect={cell => setInspect({ source, key: cell.key })}
      onSelectBag={bag => setInspect({ source, key: bag.key, bag: true })}
    />
  );

  return (
    <OverlayPortal className="game-journey__nested-overlay npc-sheet-overlay" ariaLabelledBy={titleId} onClose={onClose}>
      <section className="game-journey__nested-panel npc-sheet">
        <PortraitHeader npc={npc} npcId={npcId} titleId={titleId} onClose={onClose} onDelete={onDeleteNpc ? () => handleDelete() : undefined} />

        <div className="npc-tabs" role="tablist" aria-label="人物卷宗" style={{ '--npc-tabs': DETAIL_TABS.length } as CSSProperties}>
          {DETAIL_TABS.map(item => {
            const TabIcon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`${tabId}-${item.id}`}
                className="npc-tab"
                aria-selected={tab === item.id}
                aria-controls={`${tabId}-panel`}
                onClick={() => setTab(item.id)}
              >
                <TabIcon size={15} strokeWidth={1.6} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="npc-reader">
          <span>幕后内容只给屏幕前的你看，角色本人并不知道。</span>
          <button type="button" className="npc-reader__switch" aria-pressed={readerView} onClick={() => setReaderView(value => !value)}
            title="查看角色尚不知情的幕后内容（仅屏幕前的你看得到）">
            {readerView ? <EyeOff size={13} strokeWidth={1.6} /> : <Eye size={13} strokeWidth={1.6} />}
            {readerView ? '收起幕后内容' : '查看幕后内容'}
          </button>
        </div>

        <div className="npc-sheet__body" role="tabpanel" id={`${tabId}-panel`} aria-labelledby={`${tabId}-${tab}`}>
          {tab === 'overview' && (
            <div className="npc-columns">
              <Block icon={User} title="基本信息">
                <ExcelRow label="姓名" value={npc.姓名 ?? '未知'} />
                <ExcelRow label="种族" value={npc.种族 ?? '未知'} />
                <ExcelRow label="性别" value={npc.性别 ?? '未知'} />
                <RevealRow label="年龄" known={npc.年龄} hidden={truth?.年龄} revealed={readerView} />
              </Block>
              <Block icon={BarChart3} title="关系">
                <ExcelRow label="好感度" value={rd.好感度 ?? '未知'} />
                <ExcelRow label="关系类型" value={rd.关系类型 ?? '未知'} />
              </Block>
              <Block icon={Briefcase} title="社会身份">
                <RevealRow label="职业" known={sj.职业} hidden={truth?.社会身份?.职业} revealed={readerView} />
                <RevealRow label="地位" known={sj.社会地位} hidden={truth?.社会身份?.社会地位} revealed={readerView} />
              </Block>
              <Block icon={MapPin} title="状态">
                <ExcelRow label="位置" value={pi.当前位置 ?? '未知'} />
                <ExcelRow label="状态" value={pi.当前状态 ?? '未知'} />
                <ExcelRow label="当前行动" value={ext.当前行动 ?? '未知'} />
              </Block>
            </div>
          )}

          {tab === 'dossier' && (
            <div className="npc-columns">
              <Block icon={Sparkles} title="外貌与性格">
                <ExcelRow label="外貌" value={pi.外貌 ?? '未知'} />
                <ExcelRow label="表性格" value={pi.表性格 ?? '未知'} />
                <RevealRow label="里性格" known={pi.里性格} hidden={truthPi?.里性格} revealed={readerView} />
                <ExcelRow label="穿着" value={pi.当前穿着 ?? '未知'} />
              </Block>
              <Block icon={Brain} title="内心世界">
                <RevealRow label="当前想法" known={pi.当前想法 || ext.内心想法} hidden={truthPi?.当前想法 || truth?.内心想法} revealed={readerView} />
                <RevealRow label="短期目标" known={ext.短期目标} hidden={truth?.短期目标} revealed={readerView} />
                <RevealRow label="长期目标" known={ext.长期目标} hidden={truth?.长期目标} revealed={readerView} />
              </Block>
              <Block icon={BookOpen} title="背景与备注">
                <RevealRow label="背景" known={ext.背景 || npc.背景} hidden={truth?.背景} revealed={readerView} />
                <RevealRow label="备注" known={pi.备注} hidden={truthPi?.备注} revealed={readerView} />
              </Block>
              {(ext.种族描述 || ext.种族效果 || (ext.种族特性 && ext.种族特性.length > 0)) && (
                <Block icon={Dna} title="种族">
                  <ExcelRow label="种族描述" value={ext.种族描述} />
                  <ExcelRow label="种族效果" value={ext.种族效果} />
                  {ext.种族特性 && ext.种族特性.length > 0 && <div style={{ marginTop: 6 }}><TagList items={ext.种族特性} /></div>}
                </Block>
              )}
              <Block icon={ScrollText} title="人物事迹">
                <button type="button" className="npc-deeds" onClick={() => setShowDeeds(true)}>
                  <span><ScrollText size={14} aria-hidden="true" />查看与整理人物事迹</span>
                  <small>{chronicles.length > 0 ? `${chronicles.length} 条` : '暂无'}</small>
                </button>
              </Block>
            </div>
          )}

          {tab === 'skills' && (
            hasKnownSkills
              ? <SkillsBlock data={ext} world={world} />
              : hasTruthSkills
                ? <FogPanel label="技能与状态（幕后）" revealed={readerView}><SkillsBlock data={truthExt!} world={world} /></FogPanel>
                : <EmptyState icon={Swords} message="暂无技能数据" />
          )}

          {/* 装备与行囊：默认只给角色看得到的（已知的名称）；打开幕后内容时换成完整的真相（品质、加成、行囊）。 */}
          {tab === 'gear' && (
            truthGear && (readerView || !knownGear)
              ? <FogPanel label="身上的装备（幕后）" revealed={readerView}><NpcGearBlock data={truthExt!} name={name} portrait={portrait} world={world} gameState={gameState} /></FogPanel>
              : <NpcGearBlock data={ext} name={name} portrait={portrait} world={world} gameState={gameState} />
          )}

          {tab === 'bag' && (
            truthPack && (readerView || !knownPack)
              ? <FogPanel label="随身物品（幕后）" revealed={readerView}>{packFor('truth', truthExt!)}</FogPanel>
              : packFor('known', ext)
          )}
        </div>
      </section>

      {inspect && inspectItem && (() => {
        const kind = itemSlotKind(inspect.key, inspectItem);
        const size = bagSize(inspect.key, inspectItem);
        const bonuses = itemBonusChips(gameState ? statsConfigFor(world, gameState) : undefined, inspectItem);
        return (
          <ItemSheet
            title={inspect.key}
            quality={inspectItem.品质}
            glyph={<ItemGlyph name={inspect.key} item={inspectItem} size="lg" />}
            meta={<>
              <span className="eq-chip eq-chip--quality" style={qualityStyle(inspectItem.品质)}>{inspectItem.品质 || '普通'}</span>
              {inspectItem.类型 && <span className="eq-chip">{inspectItem.类型}</span>}
              {kind && <span className="eq-chip">{SLOT_KIND_LABEL[kind]}装备</span>}
              {size > 0 && <span className="eq-chip">背包 +{size} 格</span>}
              {inspect.source === 'truth' && <span className="eq-chip">角色尚不知</span>}
            </>}
            onClose={() => setInspect(null)}
          >
            <SheetRows rows={[['数量', inspectItem.数量], ['备注', inspectItem.备注]]} />
            {bonuses.length > 0 && <SheetBlock title="穿戴加成"><BonusChips chips={bonuses} /></SheetBlock>}
          </ItemSheet>
        );
      })()}

      {showDeeds && (
        <DeedsModal
          npcId={npcId} chronicles={chronicles}
          onClose={() => setShowDeeds(false)}
          onUpdate={onUpdateChronicles ?? (() => {})}
          onMerge={onMergeChronicles}
        />
      )}
    </OverlayPortal>
  );
}

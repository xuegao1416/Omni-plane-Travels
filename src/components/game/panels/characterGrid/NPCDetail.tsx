import { useState } from 'react';
import {
  User, BarChart3, Briefcase, MapPin, Sparkles, BookOpen, Brain, Dna,
  Zap, Star, Shield, Swords, Backpack, ScrollText,
} from 'lucide-react';
import { ExcelRow } from '../../../shared/ExcelRow';
import EmptyState from '../../../shared/EmptyState';
import type { NPCData } from '../../../../schema/variables';
import { DETAIL_TABS, favorClass } from './types';
import type { DetailTab } from './types';
import { GaugeBar } from './NPCCard';
import { TagList, RecordGrid, Section } from './SharedUI';
import { ListOrRecord } from './ListOrRecord';
import { InventoryGrid } from './InventoryGrid';
import { DeedsModal } from './DeedsModal';
import { PortraitHeader } from './PortraitHeader';

export function NPCDetail({ npc, npcId, onClose, onUpdateChronicles, onMergeChronicles }: {
  npc: NPCData; npcId: string; onClose: () => void;
  onUpdateChronicles?: (npcId: string, chronicles: string[]) => void;
  onMergeChronicles?: (npcId: string, startIndex: number, endIndex: number) => Promise<boolean>;
}) {
  const [tab, setTab] = useState<DetailTab>('overview');
  const [showDeeds, setShowDeeds] = useState(false);

  const ext = npc as any;
  const chronicles = (ext.人物事迹 as string[] | undefined) ?? [];
  const rd = npc.关系数据 ?? { 好感度: 0, 关系类型: '未知' };
  const sj = npc.社会身份 ?? { 职业: '', 社会地位: '' };
  const pi = npc.个人信息 ?? { 外貌: '', 表性格: '', 里性格: '', 当前想法: '', 当前穿着: '', 当前位置: '', 当前状态: '', 备注: '' };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, animation: 'fadeIn 0.15s ease',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
        width: '92%', maxWidth: '640px', height: '82vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: 'var(--shadow-lg)',
      }}>
        <PortraitHeader npc={npc} npcId={npcId} onClose={onClose} />

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <div style={{
            width: '48px', flexShrink: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', padding: '8px 0', gap: '2px',
            borderRight: '1px solid var(--border)', background: 'var(--bg-primary)',
          }}>
            {DETAIL_TABS.map(t => {
              const TabIcon = t.icon;
              return (
                <button key={t.id} onClick={() => setTab(t.id)} title={t.label} style={{
                  width: '36px', height: '36px', border: 'none', borderRadius: 'var(--radius-md)',
                  background: tab === t.id ? 'var(--accent-dim)' : 'transparent',
                  color: tab === t.id ? 'var(--accent)' : 'var(--text-muted)',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
                }}
                onMouseEnter={e => { if (tab !== t.id) e.currentTarget.style.background = 'var(--accent-dim)'; }}
                onMouseLeave={e => { if (tab !== t.id) e.currentTarget.style.background = 'transparent'; }}
                >
                  <TabIcon size={16} strokeWidth={1.5} />
                </button>
              );
            })}
          </div>

          <div style={{ flex: 1, padding: '14px 18px', overflowY: 'auto', fontSize: 'var(--font-size-base)', lineHeight: '1.6' }}>
            {tab === 'overview' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <Section icon={User} title="基本信息">
                  <ExcelRow label="姓名" value={npc.姓名} />
                  <ExcelRow label="种族" value={npc.种族} />
                  <ExcelRow label="性别" value={npc.性别} />
                  <ExcelRow label="年龄" value={String(npc.年龄)} />
                </Section>
                <Section icon={BarChart3} title="关系数据">
                  <div style={{ marginBottom: '8px' }}>
                    <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginBottom: '2px' }}>好感度 {rd.好感度}</div>
                    <GaugeBar value={rd.好感度} color={favorClass(rd.好感度).color} />
                  </div>
                  <ExcelRow label="关系类型" value={rd.关系类型} />
                </Section>
                <Section icon={Briefcase} title="社会身份">
                  <ExcelRow label="职业" value={sj.职业} />
                  <ExcelRow label="地位" value={sj.社会地位} />
                </Section>
                <Section icon={MapPin} title="状态">
                  <ExcelRow label="位置" value={pi.当前位置} />
                  <ExcelRow label="状态" value={pi.当前状态} />
                </Section>
              </div>
            )}

            {tab === 'dossier' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <Section icon={Sparkles} title="外貌与性格">
                  <ExcelRow label="外貌" value={pi.外貌} />
                  <ExcelRow label="表性格" value={pi.表性格} />
                  <ExcelRow label="里性格" value={pi.里性格} />
                  <ExcelRow label="穿着" value={pi.当前穿着} />
                </Section>
                {(ext.背景 || npc.背景) && (
                  <Section icon={BookOpen} title="背景">
                    <div style={{ fontSize: 'var(--font-size-sm)', lineHeight: '1.6', color: 'var(--text-secondary)' }}>{ext.背景 || npc.背景}</div>
                  </Section>
                )}
                <Section icon={Brain} title="内心世界">
                  <ExcelRow label="当前想法" value={pi.当前想法 || ext.内心想法} />
                  <ExcelRow label="当前行动" value={ext.当前行动} />
                  <ExcelRow label="短期目标" value={ext.短期目标} />
                  <ExcelRow label="长期目标" value={ext.长期目标} />
                </Section>
                {(ext.种族描述 || ext.种族效果 || (ext.种族特性 && ext.种族特性.length > 0)) && (
                  <Section icon={Dna} title="种族信息">
                    <ExcelRow label="种族描述" value={ext.种族描述} />
                    <ExcelRow label="种族效果" value={ext.种族效果} />
                    {ext.种族特性 && ext.种族特性.length > 0 && (
                      <div style={{ marginTop: '4px' }}>
                        <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginBottom: '3px' }}>种族特性</div>
                        <TagList items={ext.种族特性} />
                      </div>
                    )}
                  </Section>
                )}
                {pi.备注 && (
                  <Section icon={BookOpen} title="备注">
                    <div style={{ fontSize: 'var(--font-size-sm)', lineHeight: '1.5', color: 'var(--text-secondary)' }}>{pi.备注}</div>
                  </Section>
                )}
                <Section icon={ScrollText} title="人物事迹">
                  <button onClick={() => setShowDeeds(true)} style={{
                    width: '100%', padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-primary)', color: 'var(--text-primary)', cursor: 'pointer',
                    fontSize: 'var(--font-size-sm)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><ScrollText size={14} />查看人物事迹</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>{chronicles.length > 0 ? `${chronicles.length} 条` : '暂无'}</span>
                  </button>
                </Section>
              </div>
            )}

            {tab === 'skills' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {ext.特殊能力 && (
                  <Section icon={Sparkles} title="特殊能力">
                    <div style={{ padding: '8px 10px', background: 'var(--accent-dim)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-base)', lineHeight: '1.5' }}>{ext.特殊能力}</div>
                  </Section>
                )}
                {ext.属性 && Object.keys(ext.属性).length > 0 && (
                  <Section icon={BarChart3} title="属性"><RecordGrid data={ext.属性} /></Section>
                )}
                {ext.天赋 && ext.天赋.length > 0 && (
                  <Section icon={Star} title="天赋"><TagList items={ext.天赋} accent /></Section>
                )}
                {ext.技能列表 && (
                  <Section icon={Zap} title="技能列表"><ListOrRecord data={ext.技能列表} emptyText="暂无技能" /></Section>
                )}
                {!ext.特殊能力 && !ext.属性 && !ext.天赋 && !ext.技能列表 && (
                  <EmptyState icon={Swords} message="暂无技能数据" />
                )}
              </div>
            )}

            {tab === 'items' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {ext.物品列表 && (
                  <Section icon={Backpack} title="物品列表"><InventoryGrid data={ext.物品列表} /></Section>
                )}
                {ext.装备列表 && Object.keys(ext.装备列表).length > 0 && (
                  <Section icon={Shield} title="装备列表"><RecordGrid data={ext.装备列表} /></Section>
                )}
                {!ext.物品列表 && !ext.装备列表 && (
                  <EmptyState icon={Backpack} message="暂无物品数据" />
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {showDeeds && (
        <DeedsModal
          npcId={npcId} npcName={npc.姓名 || npcId} chronicles={chronicles}
          onClose={() => setShowDeeds(false)}
          onUpdate={onUpdateChronicles ?? (() => {})}
          onMerge={onMergeChronicles}
        />
      )}
    </div>
  );
}

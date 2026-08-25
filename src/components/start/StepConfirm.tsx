import type { PlayerProfile } from '../../storage/db';
import type { GameState } from '../../schema/variables';
import type { CombatRiskMode } from '../../gameplay/protocols';
import type { SegmentDef } from './StepCharacterHistory';
import {
  ShieldCheck, User, Users, ScrollText,
} from 'lucide-react';

interface StepConfirmProps {
  personalInfo: PlayerProfile;
  segmentDefs: SegmentDef[];
  segments: Record<string, string>;
  buildInitialState: () => GameState;
  selectedWorldName?: string;
  worldSummary?: string;
  portraitSource?: string;
  onStartGame: () => void;
  onPrev: () => void;
  showNavigation?: boolean;
  hasProfession?: boolean;
  hasCombat?: boolean;
  combatRiskMode?: CombatRiskMode;
  onCombatRiskModeChange?: (mode: CombatRiskMode) => void;
}

export default function StepConfirm({
  personalInfo, segmentDefs, segments, buildInitialState, selectedWorldName, worldSummary, portraitSource, onStartGame, onPrev, showNavigation = true, hasProfession = false, hasCombat = false, combatRiskMode = 'normal', onCombatRiskModeChange,
}: StepConfirmProps) {
  const npcCount = personalInfo.customNpcs.length;
  const skillCount = hasProfession ? 0 : Object.keys(personalInfo.initialSkills).length;
  const itemCount = Object.keys(personalInfo.initialItems).length;
  const hasSegments = Object.values(segments).some(v => v.trim());

  return (
    <div className="confirm-layout">
      <div className="confirm-journey-strip">
        {portraitSource && <img src={portraitSource} alt="人物形象" className="confirm-portrait" />}
        <div className="confirm-journey-strip__copy">
          <span className="confirm-eyebrow">启程契约</span>
          <strong>{personalInfo.name || '未命名旅者'}</strong>
          <span>{selectedWorldName || '尚未选择世界'}</span>
          {worldSummary && <small>{worldSummary}</small>}
        </div>
      </div>
      {/* 左栏：角色 + NPC */}
      <div className="confirm-left">
        <div className="confirm-card">
          <div className="confirm-card-header">
            <User size={16} />
            <span>角色状态</span>
          </div>
          <div className="confirm-card-body">
            <ConfirmRow label="姓名" value={personalInfo.name} />
            <ConfirmRow label="性别" value={personalInfo.gender} />
            <ConfirmRow label="年龄" value={personalInfo.age} />
            <ConfirmRow label="视角" value={personalInfo.perspective} />
            <ConfirmRow label="职业" value={personalInfo.career} />
            {hasProfession && <ConfirmRow label="先天天赋" value={`${personalInfo.innateTalentIds?.length ?? 0}个`} ok />}
            {skillCount > 0 && <ConfirmRow label="初始技能" value={`${skillCount}个`} ok />}
            {itemCount > 0 && <ConfirmRow label="初始物品" value={`${itemCount}个`} ok />}
          </div>
        </div>

        {npcCount > 0 && (
          <div className="confirm-card">
            <div className="confirm-card-header">
              <Users size={16} />
              <span>自建NPC</span>
              <span className="confirm-count">{npcCount}</span>
            </div>
            <div className="confirm-card-body">
              {personalInfo.customNpcs.map(npc => (
                <div key={npc.id} className="confirm-npc-row">
                  <span style={{ color: 'var(--success)', flexShrink: 0 }}>✓</span>
                  <span style={{ fontWeight: '600' }}>{npc.name}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>
                    {[npc.gender, npc.age && `${npc.age}岁`, npc.relationshipType].filter(Boolean).join(' / ')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 右栏：开局内容 */}
      <div className="confirm-right">
        {hasSegments ? (
          <div className="confirm-card" style={{ flex: 1 }}>
            <div className="confirm-card-header">
              <ScrollText size={16} />
              <span>开局内容预览</span>
            </div>
            <div className="confirm-card-body">
              {segmentDefs.map(def => {
                const content = segments[def.id]?.trim();
                if (!content) return null;
                return (
                  <div key={def.id} className="confirm-segment">
                    <div className="confirm-segment-title">
                      {def.icon} {def.title}
                    </div>
                    <div className="confirm-segment-content">
                      {content.length > 300 ? content.slice(0, 300) + '...' : content}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="confirm-card confirm-empty">
            <ScrollText size={32} style={{ color: 'var(--text-muted)', opacity: 0.3 }} />
            <p>暂无开局内容</p>
          </div>
        )}
        {hasCombat && (
          <div className="confirm-card" aria-labelledby="combat-risk-title">
            <div className="confirm-card-header">
              <ShieldCheck size={16} />
              <span id="combat-risk-title">战斗风险（开始后不可修改）</span>
            </div>
            <div className="confirm-card-body" role="radiogroup" aria-label="战斗风险">
              {([
                ['normal', '普通', '可在战前恢复检查点重打，归零后失去战力但可继续。'],
                ['hard', '困难', '可重打；战斗可能造成重伤或死亡。'],
                ['inferno', '炼狱', '不可重打或历史回滚；玩家死亡后存档封存为只读。'],
              ] as Array<[CombatRiskMode, string, string]>).map(([mode, label, description]) => (
                <label key={mode} className="confirm-risk-option">
                  <input
                    type="radio"
                    name="combat-risk-mode"
                    value={mode}
                    checked={combatRiskMode === mode}
                    onChange={() => onCombatRiskModeChange?.(mode)}
                  />
                  <span><strong>{label}</strong><small>{description}</small></span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 导航 */}
      {showNavigation && (
        <div className="confirm-nav">
          <button className="btn-secondary" onClick={onPrev} style={{ padding: '10px 24px' }}>← 上一步</button>
          <button className="btn-primary" onClick={onStartGame} style={{ padding: '10px 32px', fontSize: 'var(--font-size-lg)' }}>
            开始冒险 →
          </button>
        </div>
      )}
    </div>
  );
}

/** 确认行：标签 + 值 + 状态指示 */
function ConfirmRow({ label, value, ok }: { label: string; value?: string; ok?: boolean }) {
  const hasValue = value?.trim();
  return (
    <div className="confirm-row">
      <span style={{ color: hasValue || ok ? 'var(--success)' : 'var(--text-muted)', flexShrink: 0 }}>
        {hasValue || ok ? '✓' : '–'}
      </span>
      <span className="confirm-row-label">{label}</span>
      <span className="confirm-row-value" style={{ color: hasValue ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: hasValue ? '500' : '400' }}>
        {hasValue || '未设定'}
      </span>
    </div>
  );
}

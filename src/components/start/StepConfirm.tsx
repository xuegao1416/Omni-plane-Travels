import type { PlayerProfile } from '../../storage/db';
import type { GameState } from '../../schema/variables';
import type { SegmentDef } from './StepCharacterHistory';
import {
  ShieldCheck, User, Users, ScrollText,
} from 'lucide-react';

interface StepConfirmProps {
  personalInfo: PlayerProfile;
  segmentDefs: SegmentDef[];
  segments: Record<string, string>;
  buildInitialState: () => GameState;
  onStartGame: () => void;
  onPrev: () => void;
}

export default function StepConfirm({
  personalInfo, segmentDefs, segments, buildInitialState, onStartGame, onPrev,
}: StepConfirmProps) {
  const npcCount = personalInfo.customNpcs.length;
  const skillCount = Object.keys(personalInfo.initialSkills).length;
  const itemCount = Object.keys(personalInfo.initialItems).length;
  const hasSegments = Object.values(segments).some(v => v.trim());

  return (
    <div className="confirm-layout">
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
      </div>

      {/* 导航 */}
      <div className="confirm-nav">
        <button className="btn-secondary" onClick={onPrev} style={{ padding: '10px 24px' }}>← 上一步</button>
        <button className="btn-primary" onClick={onStartGame} style={{ padding: '10px 32px', fontSize: 'var(--font-size-lg)' }}>
          开始冒险 →
        </button>
      </div>
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

import { useState } from 'react';
import { ArrowLeft, FilePlus, Zap } from 'lucide-react';
import { useIsPhone, useBreakpoint } from '../../hooks/useIsMobile';
import { RULE_TEMPLATES, type RuleTemplate } from './ruleTemplates';
import type { EventGraph } from '../../modules/schema';
import { createRulePack } from '../../modules/webEventStore';
import { saveRulesToPack } from '../../modules/webEventStore';
import { graphToRuleFile } from '../../modules/ruleGraph';

interface RuleTemplatePickerProps {
  onSelect: (packId: string) => void;
  onBack: () => void;
}

export default function RuleTemplatePicker({ onSelect, onBack }: RuleTemplatePickerProps) {
  const isPhone = useIsPhone();
  const breakpoint = useBreakpoint();
  const isSmallPhone = breakpoint === 'xs' || breakpoint === 'sm';
  const [creating, setCreating] = useState(false);

  const handleSelect = async (graph: EventGraph | null) => {
    setCreating(true);
    try {
      const packId = await createRulePack();
      if (graph) {
        const rf = graphToRuleFile(graph);
        await saveRulesToPack(packId, rf.rules, rf.periodicRules);
      }
      onSelect(packId);
    } catch (err) {
      console.error('[RuleTemplatePicker] 创建规则包失败：', err);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      className="event-fade-in"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* 头部 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: isPhone ? 'var(--space-2)' : 'var(--space-3)',
          padding: isPhone ? '8px 12px' : '12px 16px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-secondary)',
          flexShrink: 0,
        }}
      >
        <button
          className="btn-ghost btn-sm"
          onClick={onBack}
          disabled={creating}
          style={{
            minHeight: 'var(--touch-min)',
            minWidth: isPhone ? 44 : undefined,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ArrowLeft size={16} />{!isPhone && ' 返回'}
        </button>
        <h1
          style={{
            fontSize: isPhone ? 'var(--font-size-lg)' : 'var(--font-size-xl)',
            fontWeight: 600,
            fontFamily: 'var(--font-display)',
            whiteSpace: 'nowrap',
          }}
        >
          选择模板
        </h1>
      </div>

      {/* 内容 */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: isPhone ? 'var(--space-4)' : 'var(--space-6)',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isSmallPhone
              ? '1fr'
              : isPhone
                ? 'repeat(2, 1fr)'
                : 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 'var(--space-3)',
          }}
        >
          {/* 空白规则包（第一位） */}
          <TemplateCard
            name="空白规则包"
            description="从零开始，自己搭建规则。"
            icon={FilePlus}
            difficulty="beginner"
            disabled={creating}
            onClick={() => void handleSelect(null)}
          />

          {/* 预设模板 */}
          {RULE_TEMPLATES.map((t) => (
            <TemplateCard
              key={t.id}
              name={t.name}
              description={t.description}
              icon={t.icon}
              difficulty={t.difficulty}
              disabled={creating}
              onClick={() => void handleSelect(t.graph)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface TemplateCardProps {
  name: string;
  description: string;
  icon: typeof Zap;
  difficulty: 'beginner' | 'intermediate';
  disabled?: boolean;
  onClick: () => void;
}

function TemplateCard({ name, description, icon: Icon, difficulty, disabled, onClick }: TemplateCardProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      className="event-fade-in"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        padding: 'var(--space-4)',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderColor: hovered ? 'var(--accent)' : 'var(--border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: hovered ? 'var(--shadow-md)' : 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        textAlign: 'left',
        transition:
          'box-shadow var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out)',
        minHeight: 44,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 'var(--radius-md)',
            background: 'var(--accent-dim)',
            color: 'var(--accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Icon size={20} strokeWidth={1.75} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--font-size-md)',
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}
          >
            {name}
          </div>
          <span
            style={{
              fontSize: 'var(--font-size-xs)',
              color: difficulty === 'beginner' ? 'var(--success, #22c55e)' : 'var(--warning, #f59e0b)',
              fontWeight: 500,
            }}
          >
            {difficulty === 'beginner' ? '入门' : '进阶'}
          </span>
        </div>
      </div>
      <div
        style={{
          fontSize: 'var(--font-size-sm)',
          color: 'var(--text-secondary)',
          lineHeight: 1.5,
        }}
      >
        {description}
      </div>
    </button>
  );
}

// 天赋觉醒内联卡片 — 渲染在消息正文中的天赋觉醒展示
import { useState } from 'react';
import { Sparkles } from 'lucide-react';

interface InlineTalentCardProps {
  /** 天赋 ID */
  id: string;
  /** 天赋名称 */
  name: string;
  /** 天赋品质 */
  rarity: string;
  /** 天赋描述 */
  description: string;
  /** 天赋效果列表 */
  effects?: string[];
}

/** 品质颜色映射 */
const RARITY_COLORS: Record<string, string> = {
  '普通': '#9ca3af',
  '精良': '#22c55e',
  '稀有': '#3b82f6',
  '史诗': '#a855f7',
  '传说': '#f59e0b',
};

/** 品质背景色映射 */
const RARITY_BG_COLORS: Record<string, string> = {
  '普通': 'rgba(156, 163, 175, 0.1)',
  '精良': 'rgba(34, 197, 94, 0.1)',
  '稀有': 'rgba(59, 130, 246, 0.1)',
  '史诗': 'rgba(168, 85, 247, 0.1)',
  '传说': 'rgba(245, 158, 11, 0.1)',
};

export default function InlineTalentCard({ id, name, rarity, description, effects }: InlineTalentCardProps) {
  const [expanded, setExpanded] = useState(false);
  const rarityColor = RARITY_COLORS[rarity] || '#9ca3af';
  const rarityBg = RARITY_BG_COLORS[rarity] || 'rgba(156, 163, 175, 0.1)';

  return (
    <div
      className="inline-talent-card"
      style={{
        border: `1px solid ${rarityColor}40`,
        borderRadius: 8,
        padding: '10px 14px',
        margin: '8px 0',
        background: rarityBg,
        cursor: 'pointer',
        transition: 'all 0.2s ease',
      }}
      onClick={() => setExpanded(!expanded)}
    >
      {/* 头部 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 4,
      }}>
        <Sparkles size={14} style={{ color: rarityColor }} />
        <span style={{
          fontSize: 'var(--font-size-xs)',
          color: 'var(--text-muted)',
        }}>
          天赋觉醒
        </span>
        <span style={{
          fontSize: '10px',
          padding: '1px 6px',
          borderRadius: 8,
          background: `${rarityColor}20`,
          color: rarityColor,
          fontWeight: 600,
        }}>
          {rarity}
        </span>
      </div>

      {/* 天赋名称 */}
      <div style={{
        fontSize: 'var(--font-size-md)',
        fontWeight: 600,
        color: rarityColor,
        marginBottom: 4,
      }}>
        {name}
      </div>

      {/* 天赋描述 */}
      <div style={{
        fontSize: 'var(--font-size-sm)',
        color: 'var(--text-secondary)',
        lineHeight: 1.5,
      }}>
        {description}
      </div>

      {/* 效果列表（展开时显示） */}
      {expanded && effects && effects.length > 0 && (
        <div style={{
          marginTop: 8,
          paddingTop: 8,
          borderTop: `1px solid ${rarityColor}20`,
        }}>
          <div style={{
            fontSize: 'var(--font-size-xs)',
            color: 'var(--text-muted)',
            marginBottom: 4,
          }}>
            效果：
          </div>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}>
            {effects.map((eff, i) => (
              <div
                key={i}
                style={{
                  fontSize: 'var(--font-size-xs)',
                  padding: '2px 8px',
                  borderRadius: 6,
                  background: `${rarityColor}10`,
                  color: 'var(--text-secondary)',
                }}
              >
                • {eff}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 展开/收起提示 */}
      <div style={{
        fontSize: '10px',
        color: 'var(--text-muted)',
        marginTop: 4,
        textAlign: 'center',
      }}>
        {expanded ? '点击收起' : '点击查看详情'}
      </div>
    </div>
  );
}

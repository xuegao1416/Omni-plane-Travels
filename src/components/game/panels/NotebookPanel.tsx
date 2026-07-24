/**
 * 纪事面板（原 NotebookPanel）
 *
 * 统一情报板 — 展示玩家已知的所有重要信息（危机/机遇/线索/情报/承诺/关系/地点/物品）
 * 替代原来的"潜在危机"+"当前机遇"硬编码分区，改为灵活的类型标签系统。
 */
import { useState } from 'react';
import {
  AlertTriangle, Sparkles, Search, Shield, MapPin, Package,
  BookOpen, CheckCircle2, Clock,
} from 'lucide-react';
import type { GameState, ChronicleType, ChronicleEntry } from '../../../schema/variables';
import EmptyState from '../../shared/EmptyState';

interface Props { gameState: GameState; }

/** 纪事类型配置 */
const CHRONICLE_TYPE_CONFIG: Record<ChronicleType, { icon: typeof AlertTriangle; color: string; label: string }> = {
  '风险': { icon: AlertTriangle, color: 'var(--danger)', label: '风险' },
  '机遇': { icon: Sparkles, color: 'var(--success)', label: '机遇' },
  '线索': { icon: Search, color: '#3b82f6', label: '线索' },
  '关系': { icon: Shield, color: '#ec4899', label: '关系' },
  '地点': { icon: MapPin, color: '#06b6d4', label: '地点' },
  '物品': { icon: Package, color: '#84cc16', label: '物品' },
};

const ALL_TYPES: Array<ChronicleType | '全部'> = ['全部', '风险', '机遇', '线索', '关系', '地点', '物品'];

/** 单条纪事卡片 */
function ChronicleCard({ entry }: { entry: ChronicleEntry }) {
  const config = CHRONICLE_TYPE_CONFIG[entry.类型] || CHRONICLE_TYPE_CONFIG['线索'];
  const Icon = config.icon;
  const isResolved = entry.状态 === '已解决' || entry.状态 === '已过期';

  return (
    <div style={{
      padding: '8px 10px', marginBottom: '6px', background: 'var(--bg-primary)',
      borderRadius: 'var(--radius-sm)', borderLeft: `3px solid ${config.color}`,
      opacity: isResolved ? 0.5 : 1,
    }}>
      {/* 头部：类型标签 + 标题 + 状态 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
        <Icon size={14} style={{ color: config.color, flexShrink: 0 }} />
        <span style={{
          fontWeight: '500', fontSize: 'var(--font-size-base)',
          textDecoration: isResolved ? 'line-through' : 'none', flex: 1,
        }}>
          {entry.标题}
        </span>
        <span style={{
          fontSize: 'var(--font-size-xs)', padding: '1px 6px',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-tertiary)',
          color: config.color,
          border: `1px solid ${config.color}`,
          fontWeight: '600',
        }}>
          {config.label}
        </span>
        {entry.状态 === '已解决' && <CheckCircle2 size={12} style={{ color: 'var(--success)' }} />}
        {entry.状态 === '已过期' && <Clock size={12} style={{ color: 'var(--text-muted)' }} />}
      </div>

      {/* 描述 */}
      <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginBottom: '4px' }}>
        {entry.描述}
      </div>

      {/* 详情字段 */}
      {entry.详情 && Object.keys(entry.详情).length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
          {Object.entries(entry.详情).map(([key, val]) => (
            <span key={key} style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
              {key}：{String(val)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function NotebookPanel({ gameState }: Props) {
  const [filter, setFilter] = useState<ChronicleType | '全部'>('全部');
  const chronicleSystem = gameState.玩家.纪事系统;

  // 读取纪事数据
  const allEntries = chronicleSystem?.纪事
    ? Object.values(chronicleSystem.纪事).sort((a, b) => (b.$time ?? 0) - (a.$time ?? 0))
    : [];

  // 过滤
  const filtered = filter === '全部'
    ? allEntries
    : allEntries.filter(e => e.类型 === filter);

  // 统计各类型数量
  const typeCounts = {} as Record<string, number>;
  for (const entry of allEntries) {
    typeCounts[entry.类型] = (typeCounts[entry.类型] || 0) + 1;
  }

  return (
    <div>
      {/* 过滤标签 */}
      <div style={{
        display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '10px',
      }}>
        {ALL_TYPES.map(type => {
          const isActive = filter === type;
          const count = type === '全部' ? allEntries.length : (typeCounts[type] || 0);
          if (type !== '全部' && count === 0) return null; // 不显示空类型
          const config = type === '全部' ? null : CHRONICLE_TYPE_CONFIG[type];
          return (
            <button
              key={type}
              onClick={() => setFilter(type)}
              style={{
                padding: '2px 8px', fontSize: 'var(--font-size-xs)',
                borderRadius: 'var(--radius-sm)',
                background: isActive ? 'var(--text-primary)' : 'var(--bg-tertiary)',
                color: isActive ? 'var(--bg-primary)' : 'var(--text-secondary)',
                border: isActive ? '1px solid var(--text-primary)' : '1px solid var(--border)',
                cursor: 'pointer', fontWeight: isActive ? '600' : '400',
              }}
            >
              {type}{count > 0 ? ` ${count}` : ''}
            </button>
          );
        })}
      </div>

      {/* 纪事列表 */}
      {filtered.length > 0 ? (
        filtered.map((entry, i) => (
          <ChronicleCard key={entry.标题 + i} entry={entry} />
        ))
      ) : (
        <EmptyState icon={BookOpen} message={filter === '全部' ? '暂无纪事' : `暂无${filter}类纪事`} />
      )}
    </div>
  );
}

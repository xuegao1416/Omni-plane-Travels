/**
 * 效果日志 Tab — 展示世界演化系统产生的变量变化日志
 */

import type { EffectLogEntry } from '../../../../modules/schema';

interface EffectLogTabProps {
  effectLog: EffectLogEntry[];
}

/** 来源标签颜色 */
const SOURCE_COLORS: Record<string, string> = {
  rule: '#3b82f6',      // 蓝色
  periodic: '#f59e0b',  // 橙色
  ai: '#8b5cf6',        // 紫色
  npc: '#10b981',       // 绿色
};

/** 来源标签文本 */
const SOURCE_LABELS: Record<string, string> = {
  rule: '规则',
  periodic: '周期',
  ai: 'AI',
  npc: 'NPC',
};

/** 模块标签颜色 */
const MODULE_COLORS: Record<string, string> = {
  survival: '#ef4444',    // 红色
  business: '#f59e0b',    // 橙色
  stats: '#3b82f6',       // 蓝色
  progression: '#8b5cf6', // 紫色
  worldState: '#6b7280',  // 灰色
};

export function EffectLogTab({ effectLog }: EffectLogTabProps) {
  // 过滤掉数据不完整的条目
  const validLog = effectLog.filter(e => e && e.source && e.module && e.variable);

  if (validLog.length === 0) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '200px', color: 'var(--text-muted)',
      }}>
        <div style={{ fontSize: 'var(--font-size-lg)', marginBottom: '8px', fontWeight: 600 }}>
          LOG
        </div>
        <div style={{ fontSize: 'var(--font-size-sm)' }}>暂无效果日志</div>
        <div style={{ fontSize: 'var(--font-size-xs)', marginTop: '4px' }}>
          世界演化产生的变量变化会记录在这里
        </div>
      </div>
    );
  }

  // 按时间倒序显示
  const sortedLog = [...validLog].reverse();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {/* 统计信息 */}
      <div style={{
        display: 'flex', gap: '12px', padding: '8px',
        fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)',
        borderBottom: '1px solid var(--border)', marginBottom: '8px',
      }}>
        <span>共 {validLog.length} 条记录</span>
        <span>规则: {validLog.filter(l => l.source === 'rule').length}</span>
        <span>周期: {validLog.filter(l => l.source === 'periodic').length}</span>
        <span>AI: {validLog.filter(l => l.source === 'ai').length}</span>
      </div>

      {/* 日志列表 */}
      {sortedLog.map((entry, index) => (
        <div
          key={index}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '6px 8px', borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-secondary)', fontSize: 'var(--font-size-xs)',
          }}
        >
          {/* Tick */}
          <span style={{ color: 'var(--text-muted)', minWidth: '32px' }}>
            #{entry.tick ?? '?'}
          </span>

          {/* 来源标签 */}
          <span style={{
            padding: '1px 6px', borderRadius: '3px',
            background: SOURCE_COLORS[entry.source] ?? '#6b7280',
            color: '#fff', fontSize: '10px', fontWeight: 600,
          }}>
            {SOURCE_LABELS[entry.source] ?? entry.source ?? '未知'}
          </span>

          {/* 模块标签 */}
          <span style={{
            padding: '1px 6px', borderRadius: '3px',
            background: MODULE_COLORS[entry.module] ?? '#6b7280',
            color: '#fff', fontSize: '10px',
          }}>
            {entry.module ?? '?'}
          </span>

          {/* 变量名 */}
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            {entry.variable ?? '?'}
          </span>

          {/* 变化 */}
          <span style={{ color: 'var(--text-secondary)' }}>
            {entry.before != null && entry.after != null && typeof entry.before === 'number' && typeof entry.after === 'number' ? (
              <>
                {entry.before} → {entry.after}
                <span style={{
                  marginLeft: '4px',
                  color: entry.after > entry.before ? '#22c55e' : entry.after < entry.before ? '#ef4444' : 'var(--text-muted)',
                }}>
                  ({entry.after > entry.before ? '+' : ''}{entry.after - entry.before})
                </span>
              </>
            ) : entry.before != null || entry.after != null ? (
              <>{String(entry.before ?? '?')} → {String(entry.after ?? '?')}</>
            ) : (
              <span style={{ color: 'var(--text-muted)' }}>无数据</span>
            )}
          </span>

          {/* 原因 */}
          {entry.reason && (
            <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>
              {entry.reason}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

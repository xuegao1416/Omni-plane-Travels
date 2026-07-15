import { AlertTriangle, Sparkles, ClipboardList, BookOpen } from 'lucide-react';
import type { GameState } from '../../../schema/variables';
import { Collapsible } from '../../shared/Collapsible';
import EmptyState from '../../shared/EmptyState';

interface Props { gameState: GameState; }

function priorityColor(p?: string) {
  if (!p) return '#6b7280';
  if (p.includes('紧急') || p.includes('高')) return 'var(--danger)';
  if (p.includes('中')) return 'var(--warning)';
  return 'var(--success)';
}

export default function NotebookPanel({ gameState }: Props) {
  const nb = gameState.玩家.记事本;
  const crises = Object.entries(nb?.潜在危机 ?? {});
  const opps = Object.entries(nb?.当前机遇 ?? {});
  const todos = Object.entries(nb?.待办事项 ?? {});

  return (
    <div>
      {crises.length > 0 && (
        <Collapsible icon={<AlertTriangle size={15} />} title="潜在危机" count={crises.length}>
          {crises.map(([name, c]) => (
            <div key={name} style={{
              padding: '8px 10px', marginBottom: '6px', background: 'var(--bg-primary)',
              borderRadius: 'var(--radius-sm)', borderLeft: '3px solid var(--danger)', fontSize: 'var(--font-size-base)',
            }}>
              <div style={{ fontWeight: '500', marginBottom: '3px' }}>{name}</div>
              {c.严重程度 && <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>严重程度：{c.严重程度}</div>}
              {c.预计影响时间 && <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>预计影响时间：{c.预计影响时间}</div>}
              {c.应对措施 && <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginTop: '2px' }}>应对：{c.应对措施}</div>}
            </div>
          ))}
        </Collapsible>
      )}

      {opps.length > 0 && (
        <Collapsible icon={<Sparkles size={15} />} title="当前机遇" count={opps.length}>
          {opps.map(([name, o]) => (
            <div key={name} style={{
              padding: '8px 10px', marginBottom: '6px', background: 'var(--bg-primary)',
              borderRadius: 'var(--radius-sm)', borderLeft: '3px solid var(--success)', fontSize: 'var(--font-size-base)',
            }}>
              <div style={{ fontWeight: '500', marginBottom: '3px' }}>{name}</div>
              {o.时效性 && <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>时效：{o.时效性}</div>}
              {o.所需资源 && <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>所需资源：{o.所需资源}</div>}
              {o.行动计划 && <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginTop: '2px' }}>计划：{o.行动计划}</div>}
            </div>
          ))}
        </Collapsible>
      )}

      {todos.length > 0 && (
        <Collapsible icon={<ClipboardList size={15} />} title="待办事项" count={todos.length}>
          {todos.map(([name, t]) => {
            const done = t.状态 === '已完成' || t.状态 === '已取消';
            return (
              <div key={name} style={{
                padding: '8px 10px', marginBottom: '4px', background: 'var(--bg-primary)',
                borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-base)', display: 'flex', alignItems: 'center', gap: '8px',
              }}>
                <span style={{
                  width: '10px', height: '10px', borderRadius: 'var(--radius-md)', flexShrink: 0,
                  background: done ? 'var(--success)' : priorityColor(t.优先级),
                }} />
                <div style={{ flex: 1, opacity: done ? 0.5 : 1 }}>
                  <span style={{ textDecoration: done ? 'line-through' : 'none' }}>{name}</span>
                  {t.截止时间 && <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>截止: {t.截止时间}</div>}
                </div>
                <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>{t.优先级}</span>
              </div>
            );
          })}
        </Collapsible>
      )}

      {crises.length === 0 && opps.length === 0 && todos.length === 0 && (
        <EmptyState icon={BookOpen} message="暂无笔记内容" />
      )}
    </div>
  );
}

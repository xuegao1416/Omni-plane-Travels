/**
 * 动态任务系统面板
 *
 * 展示玩家的任务列表，与物品/属性/资源/技能/NPC系统深度联动。
 * 替代原记事本中的"待办事项"，提供更丰富的任务追踪体验。
 */
import { useState } from 'react';
import {
  Target, Crosshair, Star, Eye, Repeat, CheckCircle2, XCircle, Clock,
  Package, Dumbbell, Leaf, Swords, Heart, Coins, ChevronDown, ChevronRight,
  Zap, Trophy, Shield,
} from 'lucide-react';
import type { GameState, Task, TaskType, TaskStage, TaskReward } from '../../../schema/variables';
import { Collapsible } from '../../shared/Collapsible';
import EmptyState from '../../shared/EmptyState';

interface Props { gameState: GameState; }

// ── 任务类型图标和颜色 ──
const TASK_TYPE_CONFIG: Record<TaskType, { icon: typeof Target; color: string; label: string }> = {
  '主线': { icon: Crosshair, color: 'var(--danger)', label: '主线' },
  '支线': { icon: Star, color: 'var(--warning)', label: '支线' },
  '日常': { icon: Repeat, color: 'var(--success)', label: '日常' },
  '隐藏': { icon: Eye, color: 'var(--text-muted)', label: '隐藏' },
  '成就': { icon: Trophy, color: '#a855f7', label: '成就' },
};

// ── 优先级颜色 ──
function priorityColor(p: string) {
  if (p === '紧急') return 'var(--danger)';
  if (p === '高') return 'var(--warning)';
  if (p === '中') return 'var(--info, #3b82f6)';
  return 'var(--text-muted)';
}

// ── 进度条 ──
function ProgressBar({ value, color }: { value: number; color?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div style={{
      width: '100%', height: '6px', background: 'var(--bg-tertiary)',
      borderRadius: '3px', overflow: 'hidden', margin: '4px 0',
    }}>
      <div style={{
        width: `${pct}%`, height: '100%',
        background: color || 'var(--primary)',
        borderRadius: '3px', transition: 'width 0.3s',
      }} />
    </div>
  );
}

// ── 阶段进度指示器 ──
function StageIndicator({ stages }: { stages: TaskStage[] }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', flexWrap: 'wrap', margin: '6px 0' }}>
      {stages.map((stage, i) => {
        const done = stage.状态 === '已完成';
        const active = stage.状态 === '进行中';
        return (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
            {i > 0 && <span style={{ color: 'var(--text-muted)', margin: '0 2px' }}>→</span>}
            <span style={{
              fontSize: 'var(--font-size-xs)',
              padding: '2px 6px', borderRadius: 'var(--radius-sm)',
              background: done ? 'var(--success)' : active ? 'var(--primary)' : 'var(--bg-tertiary)',
              color: done || active ? '#fff' : 'var(--text-muted)',
              opacity: done ? 0.7 : 1,
            }}>
              {done ? '✓' : active ? '⏳' : '·'} {stage.名称}
            </span>
          </span>
        );
      })}
    </div>
  );
}

// ── 需求条件列表 ──
function RequirementList({ task, gameState }: { task: Task; gameState: GameState }) {
  const items: Array<{ icon: typeof Package; label: string; met: boolean }> = [];

  // 物品需求
  if (task.物品需求) {
    for (const req of task.物品需求) {
      const owned = gameState.玩家.物品栏?.[req.物品名]?.数量 ?? 0;
      items.push({
        icon: Package,
        label: `${req.消耗 ? '交付' : '收集'} ${req.物品名} ${owned}/${req.数量}`,
        met: owned >= req.数量,
      });
    }
  }

  // 属性需求
  if (task.属性需求) {
    for (const req of task.属性需求) {
      const val = (gameState.玩家.生存状态 as any)?.[req.属性名] ?? 0;
      items.push({
        icon: Dumbbell,
        label: `${req.属性名} ≥ ${req.最小值} (当前: ${val})`,
        met: val >= req.最小值,
      });
    }
  }

  // 资源需求
  if (task.资源需求) {
    for (const req of task.资源需求) {
      const res = gameState.玩家.生存资源?.[req.资源名];
      const amount = res?.数量 ?? 0;
      items.push({
        icon: Leaf,
        label: `${req.消耗 ? '消耗' : '拥有'} ${req.资源名} ${amount}/${req.数量}`,
        met: amount >= req.数量,
      });
    }
  }

  // 技能需求
  if (task.技能需求) {
    for (const req of task.技能需求) {
      const skill = gameState.玩家.技能系统?.[req.技能名];
      const has = !!skill;
      items.push({
        icon: Swords,
        label: `技能: ${req.技能名}${req.最低品质 ? ` (${req.最低品质}+)` : ''}`,
        met: has,
      });
    }
  }

  // NPC需求
  if (task.NPC需求) {
    for (const req of task.NPC需求) {
      const npc = Object.values(gameState.人物档案).find(n => n.姓名 === req.NPC名);
      const favor = npc?.关系数据?.好感度 ?? 0;
      const met = !req.最低好感度 || favor >= req.最低好感度;
      items.push({
        icon: Heart,
        label: `${req.NPC名} 好感度 ≥ ${req.最低好感度 ?? 0} (当前: ${favor})`,
        met,
      });
    }
  }

  // 骰子检定
  if (task.骰子检定) {
    items.push({
      icon: Target,
      label: `${task.骰子检定.描述 || task.骰子检定.属性名} DC${task.骰子检定.难度DC}`,
      met: false, // 骰子检定需要实际掷骰
    });
  }

  // 货币需求
  if (task.货币需求) {
    const money = gameState.玩家.货币资源?.主货币?.数量 ?? 0;
    items.push({
      icon: Coins,
      label: `${task.货币需求.消耗 ? '花费' : '拥有'} ${gameState.玩家.货币资源?.主货币?.名称 || '金币'} ${money}/${task.货币需求.数量}`,
      met: money >= task.货币需求.数量,
    });
  }

  if (items.length === 0) return null;

  return (
    <div style={{ margin: '6px 0' }}>
      {items.map((item, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          fontSize: 'var(--font-size-xs)', padding: '2px 0',
          color: item.met ? 'var(--success)' : 'var(--text-secondary)',
        }}>
          <item.icon size={12} style={{ flexShrink: 0 }} />
          <span>{item.label}</span>
          {item.met && <CheckCircle2 size={11} style={{ color: 'var(--success)' }} />}
        </div>
      ))}
    </div>
  );
}

// ── 奖励展示 ──
function RewardDisplay({ reward }: { reward: TaskReward }) {
  const items: string[] = [];
  if (reward.经验值) items.push(`⭐ ${reward.经验值}XP`);
  if (reward.金币) items.push(`💰 ${reward.金币}`);
  if (reward.物品?.length) items.push(`📦 ${reward.物品.map(i => i.物品名).join('、')}`);
  if (reward.技能?.length) items.push(`⚔️ ${reward.技能.map(s => s.技能名).join('、')}`);
  if (reward.天赋?.length) items.push(`✨ ${reward.天赋.map(t => t.天赋名).join('、')}`);
  if (reward.属性提升) {
    for (const [stat, val] of Object.entries(reward.属性提升)) {
      items.push(`📈 ${stat}+${val}`);
    }
  }
  if (reward.好感度变化) {
    for (const [npc, val] of Object.entries(reward.好感度变化)) {
      items.push(`❤️ ${npc}${val > 0 ? '+' : ''}${val}`);
    }
  }
  if (reward.资源) {
    for (const [res, val] of Object.entries(reward.资源)) {
      items.push(`🪵 ${res}+${val}`);
    }
  }
  if (reward.解锁任务?.length) items.push(`🔓 解锁: ${reward.解锁任务.join('、')}`);
  if (reward.解锁段位 != null) items.push(`🏆 解锁新段位`);

  if (items.length === 0) return null;

  return (
    <div style={{
      margin: '6px 0', padding: '6px 8px',
      background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)',
      fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)',
    }}>
      <span style={{ fontWeight: '500', marginRight: '6px' }}>奖励:</span>
      {items.join('  ')}
    </div>
  );
}

// ── 单个任务卡片 ──
function TaskCard({ task, gameState }: { task: Task; gameState: GameState }) {
  const [expanded, setExpanded] = useState(false);
  const typeConfig = TASK_TYPE_CONFIG[task.任务类型] || TASK_TYPE_CONFIG['支线'];
  const TypeIcon = typeConfig.icon;
  const done = task.状态 === '已完成';
  const failed = task.状态 === '已失败';

  // 计算阶段进度
  const stageProgress = task.阶段
    ? { done: task.阶段.filter(s => s.状态 === '已完成').length, total: task.阶段.length }
    : null;

  return (
    <div style={{
      marginBottom: 'var(--space-2)', background: 'var(--bg-primary)',
      borderRadius: 'var(--radius-sm)', borderLeft: `3px solid ${typeConfig.color}`,
      opacity: done ? 0.6 : failed ? 0.4 : 1,
    }}>
      {/* 任务头 */}
      <div
        role="button" tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded); } }}
        style={{
          padding: '8px 10px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)',
        }}
      >
        {/* 第一行：类型图标 + 任务名 + 优先级 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <TypeIcon size={14} style={{ color: typeConfig.color, flexShrink: 0 }} />
          <span style={{
            fontWeight: '500', fontSize: 'var(--font-size-base)',
            textDecoration: done ? 'line-through' : 'none',
            flex: 1,
          }}>
            {task.任务名}
          </span>
          <span style={{
            fontSize: 'var(--font-size-xs)', padding: '1px 6px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-tertiary)',
            color: priorityColor(task.优先级),
            border: `1px solid ${priorityColor(task.优先级)}`,
            fontWeight: '600',
          }}>
            {task.优先级}
          </span>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>

        {/* 第二行：来源 + 类型 + 进度 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
          {task.来源 && <span>来源: {task.来源}</span>}
          <span>{typeConfig.label}</span>
          {task.进度 != null && !stageProgress && (
            <span style={{ flex: 1, textAlign: 'right' }}>{task.进度}%</span>
          )}
          {stageProgress && (
            <span style={{ flex: 1, textAlign: 'right' }}>{stageProgress.done}/{stageProgress.total}</span>
          )}
        </div>

        {/* 进度条 */}
        {task.进度 != null && !stageProgress && (
          <ProgressBar value={task.进度} color={typeConfig.color} />
        )}

        {/* 阶段进度 */}
        {task.阶段 && <StageIndicator stages={task.阶段} />}
      </div>

      {/* 展开详情 */}
      {expanded && (
        <div style={{ padding: '0 10px 10px', borderTop: '1px solid var(--border)' }}>
          {/* 描述 */}
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: '8px 0' }}>
            {task.描述}
          </div>

          {/* 当前目标 */}
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)', margin: '4px 0' }}>
            <Target size={12} style={{ display: 'inline', marginRight: 'var(--space-1)', verticalAlign: 'middle' }} />
            目标: {task.目标}
          </div>

          {/* 截止时间 */}
          {task.截止时间 && (
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', margin: '4px 0' }}>
              <Clock size={11} style={{ display: 'inline', marginRight: 'var(--space-1)', verticalAlign: 'middle' }} />
              截止: {task.截止时间}
            </div>
          )}

          {/* 需求条件 */}
          <RequirementList task={task} gameState={gameState} />

          {/* 阶段详情 */}
          {task.阶段?.map((stage, i) => (
            <div key={i} style={{
              margin: '6px 0', padding: '6px 8px',
              background: stage.状态 === '进行中' ? 'var(--bg-tertiary)' : 'transparent',
              borderRadius: 'var(--radius-sm)',
              borderLeft: `2px solid ${stage.状态 === '已完成' ? 'var(--success)' : stage.状态 === '进行中' ? 'var(--primary)' : 'var(--border)'}`,
            }}>
              <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: '500' }}>
                {stage.状态 === '已完成' ? '✓' : stage.状态 === '进行中' ? '⏳' : '·'} {stage.名称}
              </div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>{stage.描述}</div>
            </div>
          ))}

          {/* 奖励 */}
          {task.奖励 && <RewardDisplay reward={task.奖励} />}
        </div>
      )}
    </div>
  );
}

// ── 主面板 ──
export default function TaskPanel({ gameState }: Props) {
  const [filter, setFilter] = useState<TaskType | '全部'>('全部');
  const taskSystem = gameState.玩家.任务系统;

  if (!taskSystem) {
    return <EmptyState icon={Target} message="暂无任务" />;
  }

  const activeTasks = Object.values(taskSystem.活跃任务);
  const completedTasks = Object.values(taskSystem.已完成任务);
  const failedTasks = Object.values(taskSystem.已失败任务);

  // 过滤
  const filteredActive = filter === '全部'
    ? activeTasks
    : activeTasks.filter(t => t.任务类型 === filter);

  // 按优先级排序
  const priorityOrder = { '紧急': 0, '高': 1, '中': 2, '低': 3 };
  const sortedActive = [...filteredActive].sort(
    (a, b) => (priorityOrder[a.优先级] ?? 9) - (priorityOrder[b.优先级] ?? 9)
  );

  const filters: Array<TaskType | '全部'> = ['全部', '主线', '支线', '日常', '隐藏', '成就'];

  return (
    <div>
      {/* 标题 + 统计 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        padding: '8px 0', marginBottom: 'var(--space-2)',
        borderBottom: '1px solid var(--border)',
      }}>
        <Target size={16} style={{ color: 'var(--primary)' }} />
        <span style={{ fontWeight: '600', fontSize: 'var(--font-size-lg)' }}>任务系统</span>
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginLeft: 'auto' }}>
          活跃: {activeTasks.length}
        </span>
      </div>

      {/* 过滤标签 */}
      <div style={{
        display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap', marginBottom: '10px',
      }}>
        {filters.map(f => {
          const isActive = filter === f;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '2px 8px', fontSize: 'var(--font-size-xs)',
                borderRadius: 'var(--radius-sm)',
                background: isActive ? 'var(--text-primary)' : 'var(--bg-tertiary)',
                color: isActive ? 'var(--bg-primary)' : 'var(--text-secondary)',
                border: isActive ? '1px solid var(--text-primary)' : '1px solid var(--border)',
                cursor: 'pointer', fontWeight: isActive ? '600' : '400',
              }}
            >
              {f}
            </button>
          );
        })}
      </div>

      {/* 活跃任务列表 */}
      {sortedActive.length > 0 ? (
        sortedActive.map(task => (
          <TaskCard key={task.任务名} task={task} gameState={gameState} />
        ))
      ) : (
        <EmptyState
          icon={filter === '全部' ? Target : TASK_TYPE_CONFIG[filter]?.icon || Target}
          message={filter === '全部' ? '暂无活跃任务' : `暂无${filter}任务`}
        />
      )}

      {/* 已完成 / 已失败折叠区 */}
      {(completedTasks.length > 0 || failedTasks.length > 0) && (
        <div style={{ marginTop: 'var(--space-3)', borderTop: '1px solid var(--border)', paddingTop: 'var(--space-2)' }}>
          {completedTasks.length > 0 && (
            <Collapsible icon={<CheckCircle2 size={14} />} title="已完成" count={completedTasks.length} defaultOpen={false}>
              {completedTasks.map(task => (
                <TaskCard key={task.任务名} task={task} gameState={gameState} />
              ))}
            </Collapsible>
          )}
          {failedTasks.length > 0 && (
            <Collapsible icon={<XCircle size={14} />} title="已失败" count={failedTasks.length} defaultOpen={false}>
              {failedTasks.map(task => (
                <TaskCard key={task.任务名} task={task} gameState={gameState} />
              ))}
            </Collapsible>
          )}
        </div>
      )}
    </div>
  );
}

import type { GameState } from '../../../../schema/variables';
import type { SimulationState } from '../../../../simulation/types';
import { directorTitle } from '../../../../utils/directorDisplayText';
import { EffectLogTab } from './EffectLogTab';
import { PanelCard, StatusPill, VerificationDetails } from './directorUi';

const statuses: Record<string, string> = { applied: '已结算', blocked: '未满足条件', failed: '结算失败', reverted: '已回退' };

export function MechanicalLogTab({ gameState, simState, variableLabels }: {
  gameState?: GameState; simState: SimulationState; variableLabels?: Record<string, string>;
}) {
  const receipts = new Map<string, NonNullable<NonNullable<SimulationState['mechanics']>['lastSettlement']>>();
  for (const snapshot of simState.snapshots) {
    const receipt = snapshot.snapshot.mechanics?.lastSettlement;
    if (receipt) receipts.set(receipt.turnId, receipt);
  }
  const current = simState.mechanics?.lastSettlement;
  if (current) receipts.set(current.turnId, current);
  const logs = gameState?.gameplay?.logs ?? [];
  return <div style={{ display: 'grid', gap: 12 }}>
    <PanelCard title={`逐轮规则检查 · ${receipts.size} 轮`}>
      {receipts.size === 0 && <p>此存档尚无规则检查回执。后续回合结算后会显示结果。</p>}
      {[...receipts.values()].sort((a, b) => b.round - a.round).map(r => <div key={r.turnId} style={{ padding: '6px 0' }}>
        <strong>第 {r.round} 轮</strong> · {r.effectCount || r.notificationCount
          ? `${r.effectCount} 项变量变化，${r.notificationCount} 项事件通知`
          : '已检查，无周期资源或事件变化'}
        {r.origin === 'replay' && <> <StatusPill>存档补记</StatusPill></>}
        <VerificationDetails data={r}/>
      </div>)}
    </PanelCard>
    <PanelCard title={`玩法交易 · ${logs.length} 条`}>
      {logs.length === 0 && <p>暂无玩法交易。</p>}
      {[...logs].reverse().map(entry => <div key={entry.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
        <strong>{entry.label && /[\p{Script=Han}]/u.test(entry.label) ? directorTitle(entry.label) : '玩法结算'}</strong> <StatusPill>{statuses[entry.status] ?? '其他状态'}</StatusPill>
        <div>第 {entry.tick} 次结算 · {entry.changes.length} 项变化{entry.reason && /[\p{Script=Han}]/u.test(entry.reason) ? ` · ${entry.reason}` : ''}</div>
        {entry.changes.filter(c => !c.path.startsWith('customModules.')).map((c, i) => {
          const leaf = c.path.split('.').at(-1) ?? '';
          const label = /[\p{Script=Han}]/u.test(leaf) ? leaf : '规则状态';
          const numeric = typeof c.before === 'number' && typeof c.after === 'number';
          return <div key={i} style={{ color: 'var(--text-muted)', fontSize: 12 }}>{label}：{numeric ? `${c.before} → ${c.after}` : '已更新'}</div>;
        })}
        <VerificationDetails data={entry}/>
      </div>)}
    </PanelCard>
    <PanelCard title="周期与规则效果">
      <EffectLogTab effectLog={gameState?.simulationRuntime?.effectLog ?? []} variableLabels={variableLabels}/>
    </PanelCard>
  </div>;
}

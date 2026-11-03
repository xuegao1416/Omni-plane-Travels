import { useMemo, useState } from 'react';
import { CheckCircle2, FlaskConical, RotateCcw } from 'lucide-react';
import type { WorkshopRevision } from '../../custom-modules/workshopSession';
import type { CustomGameplayModuleV3 } from '../../custom-modules/schema';
import { validateCustomGameplayModule } from '../../custom-modules/validator';
import { CustomModuleView } from '../../custom-modules/viewRenderer';
import { createCustomModulePreview, simulateCustomModule } from '../../custom-modules/preview';
import { buildCustomModuleHostContext } from '../../custom-modules/context';
import { WorkshopSaveApplication } from './WorkshopSaveApplication';
import { createDefaultSimulationRuntimeState } from '../../modules/schema';

const lifecycleNames: Record<string, string> = { onGameStart: '开始游戏', onTurnEnd: '回合结束', onTick: '世界推进', onChoice: '玩家选择', onButton: '点击按钮' };
const capabilityNames: Record<string, string> = { currency: '主货币', inventory: '背包物品', survival: '生存资源' };

function collectDiff(before: unknown, after: unknown, path = ''): string[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (before && after && typeof before === 'object' && typeof after === 'object' && Array.isArray(before) === Array.isArray(after)) {
    const a = before as Record<string, unknown>, b = after as Record<string, unknown>;
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(key => collectDiff(a[key], b[key], path ? `${path}.${key}` : key));
  }
  const text = (value: unknown) => value === undefined ? '（无）' : JSON.stringify(value);
  return [`${path || '模块'}：${text(before)} → ${text(after)}`];
}

function ModulePreview({ module }: { module: CustomGameplayModuleV3 }) {
  const [initial] = useState(() => createCustomModulePreview(module));
  const [game, setGame] = useState(initial.gameState);
  const [round, setRound] = useState(0);
  const [log, setLog] = useState<Array<{ id: string; label: string; changes: string[]; warnings: string[]; applied: number }>>(() => [{ id: 'start', label: '初始化', changes: [], warnings: initial.warnings, applied: initial.applied }]);
  const run = (event?: string) => {
    const nextRound = event ? round : round + 1;
    const source = structuredClone(game);
    if (!event) { source.simulationRuntime ??= createDefaultSimulationRuntimeState(); source.simulationRuntime.tick = nextRound; }
    const context = buildCustomModuleHostContext(source, { round: nextRound, items: module.items, ...(event ? { event: { type: 'button' as const, moduleId: module.id, event } } : {}) });
    const tick = event ? undefined : simulateCustomModule(module, source, 'onTick', { eventId: `tick:${nextRound}`, context });
    const result = simulateCustomModule(module, tick?.gameState ?? source, event ? 'onButton' : 'onTurnEnd', { eventId: event ? crypto.randomUUID() : `turn:${nextRound}`, context });
    if (tick) { result.applied += tick.applied; result.warnings.unshift(...tick.warnings); }
    const changes = collectDiff({ 玩家: game.玩家, 模块状态: game.customModules?.[module.id]?.values }, { 玩家: result.gameState.玩家, 模块状态: result.gameState.customModules?.[module.id]?.values });
    setGame(result.gameState); setRound(nextRound);
    setLog(prior => [{ id: crypto.randomUUID(), label: event ? `按钮 · ${event}` : `第 ${nextRound} 回合`, changes, warnings: result.warnings, applied: result.applied }, ...prior].slice(0, 40));
  };
  const changeResource = (update: (copy: typeof game) => void) => { setGame(current => { const copy = structuredClone(current); update(copy); return copy; }); };
  return <div className="mws-preview">
    <div className="mws-preview-bar"><span>独立试玩 · 第 {round} 回合</span><button className="mws-icon" type="button" aria-label="重置试玩" onClick={() => { const reset = createCustomModulePreview(module); setGame(reset.gameState); setRound(0); setLog([{ id: 'start', label: '初始化', changes: [], warnings: reset.warnings, applied: reset.applied }]); }}><RotateCcw size={15} /></button></div>
    <p className="mws-footnote">使用正式游戏规则与界面，在独立副本上运行。调整资源后点击模块按钮，或推进回合。</p>
    <details className="mws-details" open><summary>试玩资源</summary><div className="mws-resource-grid">
      <label>主货币<input type="number" min="0" value={game.玩家.货币资源.主货币.数量} onChange={e => { const n = Math.max(0, Number(e.target.value)); if (Number.isFinite(n)) changeResource(copy => { copy.玩家.货币资源.主货币.数量 = n; }); }} /></label>
      {Object.entries(game.玩家.物品栏).map(([name, item]) => <label key={name}>{name}<input type="number" min="0" step="1" value={item.数量} onChange={e => { const n = Math.max(0, Math.trunc(Number(e.target.value))); if (Number.isFinite(n)) changeResource(copy => { copy.玩家.物品栏[name].数量 = n; }); }} /></label>)}
      {Object.entries(game.玩家.生存资源 ?? {}).map(([id, resource]) => <label key={id}>{id}<input type="number" min="0" max={resource.最大值} value={resource.数量} onChange={e => { const n = Math.max(0, Number(e.target.value)); if (Number.isFinite(n)) changeResource(copy => { copy.玩家.生存资源![id].数量 = Math.min(n, resource.最大值 ?? Infinity); }); }} /></label>)}
    </div></details>
    {module.view ? <CustomModuleView view={module.view} values={game.customModules?.[module.id]?.values ?? {}} onEvent={run} /> : <p className="mws-muted">模块未定义可视界面，仍可推进回合测试规则。</p>}
    <button type="button" className="mws-button" onClick={() => run()}>推进一个回合</button>
    <details className="mws-details"><summary>当前模块状态</summary><pre>{JSON.stringify(game.customModules?.[module.id]?.values ?? {}, null, 2)}</pre></details>
    <section className="mws-simulation-log" aria-label="试玩执行记录" aria-live="polite"><h4>执行记录</h4>{!log.length && <p className="mws-muted">点击按钮或推进回合后，查看资源与状态变化。</p>}{log.map(item => <article key={item.id}><strong>{item.label}</strong><span> · {item.applied} 个操作生效</span>{item.warnings.map((warning, index) => <p className="mws-error" key={index}>{warning}</p>)}{item.changes.length ? <ul>{item.changes.map((line, index) => <li key={index}>{line}</li>)}</ul> : <p className="mws-muted">{item.label === '初始化' ? '已建立初始模块状态。' : '资源和状态没有变化。'}</p>}</article>)}</section>
  </div>;
}

interface Props { worldId: string; revision?: WorkshopRevision; revisions: WorkshopRevision[]; disabled: boolean; onRestore: (id: string) => void }
export function WorkshopModulePanel({ worldId, revision, revisions, disabled, onRestore }: Props) {
  const [tab, setTab] = useState('preview');
  const [compareId, setCompareId] = useState(revisions.at(-2)?.id ?? '');
  const validation = useMemo(() => revision ? validateCustomGameplayModule(revision.module) : undefined, [revision]);
  const module = validation?.normalized;
  const previous = revisions.find(item => item.id === compareId);
  const diff = useMemo(() => module ? collectDiff(previous?.module, module) : [], [previous, module]);
  if (!module || !revision) return <div className="mws-empty-module"><FlaskConical size={34} /><h3>在这里看见你的玩法</h3><p>Agent 创建草稿后，可直接试玩、查看规则和版本，再决定何时应用。</p></div>;
  return <><div className="mws-module-summary"><strong>{module.name}</strong><p>{module.description || '暂无模块说明'}</p><small>{module.id} · {module.version}</small></div>
    <nav className="mws-panel-tabs" aria-label="模块查看方式">{[['preview', '试玩'], ['rules', '规则'], ['validation', '校验'], ['history', '版本'], ['saves', '存档'], ['json', 'JSON']].map(([id, title]) => <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>{title}</button>)}</nav>
    <div className="mws-panel-content">
      {tab === 'preview' && <ModulePreview module={module} />}
      {tab === 'rules' && <div className="mws-rules"><h4>宿主能力</h4><div className="mws-chips">{module.capabilities?.map(capability => <span key={capability}>{capabilityNames[capability] ?? capability}</span>)}</div>{!module.capabilities?.length && <p className="mws-muted">仅使用模块自身状态。</p>}<h4>物品定义</h4>{Object.entries(module.items ?? {}).map(([id, item]) => <p key={id}><strong>{item.name}</strong> <code>{id}</code>{item.description && <small> · {item.description}</small>}</p>)}{Object.entries(module.logic).map(([lifecycle, rules]) => rules.length > 0 && <section key={lifecycle}><h4>{lifecycleNames[lifecycle] ?? lifecycle} · {rules.length} 条规则</h4>{rules.map((rule, index) => <details className="mws-details" key={rule.id ?? index}><summary>{rule.id || `规则 ${index + 1}`} · {rule.actions.length} 个操作</summary>{rule.when && <><h5>触发条件</h5><pre>{JSON.stringify(rule.when, null, 2)}</pre></>}<h5>执行操作</h5><pre>{JSON.stringify(rule.actions, null, 2)}</pre></details>)}</section>)}</div>}
      {tab === 'validation' && <div><p className={validation?.valid ? 'mws-notice' : 'mws-error'}><CheckCircle2 size={16} />{validation?.valid ? '模块协议与规则校验通过' : '模块校验未通过'}</p>{[...(validation?.errors ?? []), ...(validation?.warnings ?? [])].map((issue, index) => <p key={index} className={issue.severity === 'error' ? 'mws-error' : 'mws-muted'}>{issue.path.join('.')}：{issue.message}</p>)}<p className="mws-footnote">静态校验通过后，仍需在试玩中检查资源不足和重复操作等实际结果。</p></div>}
      {tab === 'history' && <div><p className="mws-footnote">回退会创建一个新版本，保留现有聊天及全部版本历史。</p><div className="mws-versions">{[...revisions].reverse().map(item => <article key={item.id}><div><strong>v{item.number} · {item.summary}</strong><small>{new Date(item.createdAt).toLocaleString()}</small></div><button type="button" className="mws-button" disabled={disabled || item.id === revision.id} onClick={() => onRestore(item.id)}>{item.id === revision.id ? '当前' : '回退到此版'}</button></article>)}</div><label className="mws-compare">与当前版本比较<select value={compareId} onChange={event => setCompareId(event.target.value)}><option value="">初始空草稿</option>{revisions.filter(item => item.id !== revision.id).map(item => <option key={item.id} value={item.id}>v{item.number} · {item.summary}</option>)}</select></label><pre className="mws-diff">{diff.length ? diff.join('\n\n') : '两个版本没有差异。'}</pre></div>}
      {tab === 'saves' && <WorkshopSaveApplication worldId={worldId} module={module} disabled={disabled} />}
      {tab === 'json' && <div><p className="mws-footnote">高级查看：当前有效草稿的完整协议。</p><pre>{JSON.stringify(module, null, 2)}</pre></div>}
    </div></>;
}

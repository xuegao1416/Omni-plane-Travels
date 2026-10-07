import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorldDef } from '../../../data/worlds-schema';
import type { ApiConfig } from '../../../api/types';
import { requestCompletion } from '../../../api/client';
import { getNovelDataset } from '../../../novel/novelStore';
import { compileDirectorDefinition, createDirectorCompileJob, type DirectorCompileJob } from '../../../director/definitionCompiler';
import { getDirectorDefinition, listDirectorCompileJobs, listDirectorDefinitions, saveDirectorAuthorRevision, saveDirectorCompileJob, saveDirectorDefinition } from '../../../director/definitionStore';
import type { DirectorDefinition } from '../../../director/definitionTypes';
import { validateDirectorDraft, type DirectorDraft } from '../../../director/definitionSchema';

type Binding = NonNullable<WorldDef['directorSource']>;
const lines = (text: string) => text.split('\n').map(s => s.trim()).filter(Boolean);
function editable(definition: DirectorDefinition): DirectorDraft {
  const { schemaVersion, id, version, source, createdAt, editedByAuthor, ...draft } = definition;
  return structuredClone(draft);
}

export default function DirectorAuthorEditor({ workspaceId, title, binding, novelDatasetId, apiConfig, onBind, required = false }: {
  workspaceId: string; title: string; binding?: Binding; novelDatasetId?: string; apiConfig: ApiConfig;
  onBind: (binding: Binding | undefined) => void; required?: boolean;
}) {
  const [raw, setRaw] = useState('');
  const [base, setBase] = useState<DirectorDefinition>();
  const [draft, setDraft] = useState<DirectorDraft>();
  const [job, setJob] = useState<DirectorCompileJob>();
  const [history, setHistory] = useState<DirectorDefinition[]>([]);
  const [start, setStart] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const abort = useRef<AbortController | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    const scope = ++generation.current;
    void (async () => {
      try {
        const definitionId = binding?.definitionId ?? workspaceId;
        const [loaded, jobs, definitions] = await Promise.all([
          binding ? getDirectorDefinition(binding.definitionId, binding.version) : Promise.resolve(undefined),
          listDirectorCompileJobs(definitionId),
          listDirectorDefinitions(definitionId),
        ]);
        if (scope !== generation.current) return;
        const latest = jobs[0];
        const revisions = definitions.filter(item => item.editedByAuthor);
        setHistory(revisions);
        setJob(latest);
        const recovered = loaded ?? (!binding ? revisions[0] : undefined);
        if (recovered) {
          setBase(recovered); setDraft(editable(recovered));
          if (recovered.source.kind === 'author') setRaw(recovered.source.text);
          setStart(binding?.startStageId && recovered.stages.some(stage => stage.id === binding.startStageId) ? binding.startStageId : recovered.stages[0]?.id ?? '');
          if (!loaded && !binding) setNotice('已恢复最近保存的人工剧情版本，请检查后再决定是否选用。');
        } else if (latest) {
          if (latest.source.kind === 'author') setRaw(latest.source.text);
          if (latest.definition) { setBase(latest.definition); setDraft(editable(latest.definition)); setStart(latest.definition.stages[0]?.id ?? ''); setNotice('已恢复上次整理结果，请检查后保存剧情版本。'); }
        }
        if (binding && !loaded) setError('绑定的剧情版本缺失，请重新导入剧情资料。');
      } catch (e) { if (scope === generation.current) setError(e instanceof Error ? e.message : String(e)); }
    })();
    return () => { ++generation.current; abort.current?.abort(); };
  }, [workspaceId]);

  const compile = async (kind: 'author' | 'novel' | 'resume') => {
    const scope = generation.current;
    setBusy(true); setError(''); setNotice('');
    const controller = new AbortController(); abort.current = controller;
    try {
      let next: DirectorCompileJob;
      if (kind === 'resume') {
        if (!job) throw new Error('没有可恢复的编译任务');
        next = job;
      } else if (kind === 'novel') {
        const dataset = novelDatasetId && await getNovelDataset(novelDatasetId);
        if (!dataset) throw new Error('小说资料尚未加载或已经删除');
        next = createDirectorCompileJob({ kind: 'novel', dataset }, { definitionId: binding?.definitionId ?? workspaceId });
      } else next = createDirectorCompileJob({ kind: 'author', text: raw, title }, { definitionId: binding?.definitionId ?? workspaceId });
      const result = await compileDirectorDefinition(next, {
        signal: controller.signal,
        onCheckpoint: async saved => { await saveDirectorCompileJob(saved); if (scope === generation.current) setJob(saved); },
        request: async input => {
          const result = await requestCompletion(apiConfig, [{ role: 'system', content: input.system }, { role: 'user', content: input.prompt }], { signal: input.signal, temperature: 0.2 });
          return result.text;
        },
      });
      if (scope !== generation.current) return;
      if (result.definition) { setBase(result.definition); setDraft(editable(result.definition)); setStart(result.definition.stages[0]?.id ?? ''); setNotice('整理完成。请检查下方内容，然后保存剧情版本。'); }
      else setError(result.error ?? '编译未完成，已保留检查点');
    } catch (e) { if (scope === generation.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (scope === generation.current) { setBusy(false); abort.current = null; } }
  };

  const save = async () => {
    if (!base || !draft) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const checked = validateDirectorDraft(draft);
      if (!checked.stages.some(s => s.id === start)) throw new Error('请选择有效起始阶段');
      const same = JSON.stringify(checked) === JSON.stringify(editable(base));
      const saved = same ? base : await saveDirectorAuthorRevision(base, checked);
      if (same) await saveDirectorDefinition(saved);
      setBase(saved); setHistory((await listDirectorDefinitions(saved.id)).filter(item => item.editedByAuthor)); onBind({ definitionId: saved.id, version: saved.version, startStageId: start });
      setNotice('剧情版本已保存，保存世界后用于新开局。');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const patchNode = (index: number, patch: Partial<DirectorDraft['nodes'][number]>) => setDraft(d => d && ({ ...d, nodes: d.nodes.map((n, i) => i === index ? { ...n, ...patch } : n) }));
  const toggle = (ids: string[], id: string, checked: boolean) => checked ? [...new Set([...ids, id])] : ids.filter(value => value !== id);
  const patchStage = (index: number, patch: Partial<DirectorDraft['stages'][number]>) => setDraft(d => d && ({ ...d, stages: d.stages.map((s, i) => i === index ? { ...s, ...patch } : s) }));
  // 来源回显用索引：面板里每个事件都要回显来源，逐条 find 整份证据数组在小说来源下是平方级开销。
  const evidenceExcerpts = useMemo(() => {
    const index = new Map<string, string>();
    for (const ref of base?.source.evidenceRefs ?? []) index.set(`novel:${ref.chapterId}:${ref.startOffset}:${ref.endOffset}`, ref.excerpt);
    return index;
  }, [base]);

  const field = 'world-weave-field world-weave-field--wide';
  return <details className="world-weave-accordion">
    <summary><span>主线剧情</span><em>{binding ? '已选择版本' : required ? '创建世界前必需' : '可选'}</em></summary>
    <div className="world-weave-accordion-body">
      <p>写下核心冲突、人物动机和故事走向，整理后可逐项修改。剧情只引导未来发展，玩家行动仍会改变路径。</p>
      <label className={field}><span>作者原稿</span><textarea rows={7} value={raw} disabled={busy} onChange={e => setRaw(e.target.value)} placeholder="例如：港城不断有人失踪，调查者发现商会与教团的联系……写到哪里，剧情就提供到哪里。" /></label>
      <div className="world-weave-artwork-actions">
        <button type="button" className="btn-ghost" disabled={busy || !raw.trim()} onClick={() => void compile('author')}>AI 整理原稿</button>
        {novelDatasetId && <button type="button" className="btn-ghost" disabled={busy} onClick={() => void compile('novel')}>整理本世界小说剧情</button>}
        {job && job.status !== 'completed' && <button type="button" className="btn-ghost" disabled={busy} onClick={() => void compile('resume')}>恢复上次整理</button>}
        {busy && abort.current && <button type="button" className="btn-ghost" onClick={() => abort.current?.abort()}>取消并保留进度</button>}
      </div>
      {job && <p role="status">已完成 {Object.keys(job.checkpoints).length} 个处理单元；原始资料 {job.units.length} 批。{busy ? '正在整理…' : ''}</p>}
      {error && <p role="alert" className="world-weave-validation world-weave-validation--error">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!!history.length && <label className={field}><span>历史剧情版本</span><select value={base?.editedByAuthor ? base.version : ''} disabled={busy} onChange={e => { const selected = history.find(item => item.version === e.target.value); if (!selected) return; setBase(selected); setDraft(editable(selected)); if (selected.source.kind === 'author') setRaw(selected.source.text); setStart(selected.stages[0]?.id ?? ''); setNotice('已载入历史剧情版本；保存并选用前不会改变世界绑定。'); }}><option value="">选择人工修订版本</option>{history.map(item => <option key={item.version} value={item.version}>{item.title} · 人工修订</option>)}</select><small>查看旧版不会自动改动世界绑定；只有“保存剧情版本并选用”才会更新新开局使用的版本。</small></label>}
      {draft && <fieldset disabled={busy} style={{ border: 0, padding: 0, marginTop: 16 }}>
        <legend>检查与修改整理结果</legend>
        <label className={field}><span>剧情名称</span><input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
        <label className={field}><span>核心冲突</span><textarea value={draft.coreConflict} onChange={e => setDraft({ ...draft, coreConflict: e.target.value })} /></label>
        <label className={field}><span>应保持的大方向（每行一项）</span><textarea value={draft.anchors.join('\n')} onChange={e => setDraft({ ...draft, anchors: lines(e.target.value) })} /></label>
        <label className={field}><span>内容边界</span><textarea value={draft.coverage.boundary} onChange={e => setDraft({ ...draft, coverage: { ...draft.coverage, boundary: e.target.value } })} /></label>
        <label className={field}><span>未知与缺口（每行一项）</span><textarea value={draft.coverage.gaps.join('\n')} onChange={e => setDraft({ ...draft, coverage: { ...draft.coverage, complete: false, gaps: lines(e.target.value) } })} /></label>
        <label className={field}><span>默认起始阶段</span><select value={start} onChange={e => setStart(e.target.value)}>{draft.stages.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
        <details className="world-weave-accordion"><summary>参与人物 · {draft.characters.length} 人</summary><div className="world-weave-accordion-body">
          {draft.characters.map((actor, index) => <div key={actor.id}>
            <label className={field}><span>人物姓名 {index + 1}</span><input value={actor.name} onChange={e => setDraft({ ...draft, characters: draft.characters.map((a, i) => i === index ? { ...a, name: e.target.value } : a) })} /></label>
            <label className={field}><span>{actor.name || '该人物'}的别名（每行一项）</span><textarea value={actor.aliases.join('\n')} onChange={e => setDraft({ ...draft, characters: draft.characters.map((a, i) => i === index ? { ...a, aliases: lines(e.target.value) } : a) })} /></label>
            <button type="button" className="btn-ghost" onClick={() => setDraft({ ...draft, characters: draft.characters.filter(a => a.id !== actor.id), nodes: draft.nodes.map(n => ({ ...n, actorIds: n.actorIds.filter(id => id !== actor.id) })) })}>移除人物 {actor.name}</button>
          </div>)}
          <button type="button" className="btn-ghost" onClick={() => setDraft({ ...draft, characters: [...draft.characters, { id: `actor-${crypto.randomUUID()}`, name: '', aliases: [] }] })}>添加人物</button>
        </div></details>
        {draft.stages.map((stage, index) => <details key={stage.id} className="world-weave-accordion">
          <summary>{stage.title} · {stage.nodeIds.length} 个事件</summary>
          <div className="world-weave-accordion-body">
            <label className={field}><span>阶段名称</span><input value={stage.title} onChange={e => setDraft({ ...draft, stages: draft.stages.map((s, i) => i === index ? { ...s, title: e.target.value } : s) })} /></label>
            <label className={field}><span>阶段走向</span><textarea value={stage.description} onChange={e => setDraft({ ...draft, stages: draft.stages.map((s, i) => i === index ? { ...s, description: e.target.value } : s) })} /></label>
            <label className={field}><span>阶段完成方式</span><select value={stage.completion?.mode ?? 'all'} onChange={e => patchStage(index, { completion: { mode: e.target.value as 'all' | 'any', nodeIds: stage.completion?.nodeIds ?? [...stage.nodeIds] } })}><option value="all">选定事件全部落实</option><option value="any">选定事件任意一个落实</option></select></label>
            <fieldset><legend>决定阶段完成的事件</legend>{stage.nodeIds.map(id => <label key={id} style={{ display: 'block' }}><input type="checkbox" checked={(stage.completion?.nodeIds ?? stage.nodeIds).includes(id)} onChange={e => patchStage(index, { completion: { mode: stage.completion?.mode ?? 'all', nodeIds: toggle(stage.completion?.nodeIds ?? stage.nodeIds, id, e.target.checked) } })} />{draft.nodes.find(n => n.id === id)?.title}</label>)}</fieldset>
            {draft.nodes.map((node, i) => node.stageId === stage.id && <details key={node.id} className="world-weave-accordion"><summary>{node.title}</summary><div className="world-weave-accordion-body">
              <label className={field}><span>事件名称</span><input value={node.title} onChange={e => patchNode(i, { title: e.target.value })} /></label>
              <label className={field}><span>推进意图</span><textarea value={node.intent} onChange={e => patchNode(i, { intent: e.target.value })} /></label>
              <label className={field}><span>发生方式</span><select value={node.execution} onChange={e => patchNode(i, { execution: e.target.value as typeof node.execution })}><option value="foreground">玩家在场</option><option value="offscreen">幕后发生</option><option value="either">视实际情况决定</option></select></label>
              <label className={field}><span>参考结果（不是玩家必须完成的行为）</span><textarea value={node.referenceOutcome ?? ''} onChange={e => patchNode(i, { referenceOutcome: e.target.value || undefined })} /></label>
              <label className={field}><span>限制与秘密边界（每行一项）</span><textarea value={node.constraints.join('\n')} onChange={e => patchNode(i, { constraints: lines(e.target.value) })} /></label>
              {node.conditions.map((condition, ci) => <div key={condition.id}><label className={field}><span>成立条件 {ci + 1}</span><textarea value={condition.description} onChange={e => patchNode(i, { conditions: node.conditions.map((c, j) => j === ci ? { ...c, description: e.target.value, predicates: undefined } : c) })} /></label><button type="button" className="btn-ghost" onClick={() => patchNode(i, { conditions: node.conditions.filter(c => c.id !== condition.id) })}>移除条件 {ci + 1}</button></div>)}
              <button type="button" className="btn-ghost" onClick={() => patchNode(i, { conditions: [...node.conditions, { id: `condition-${crypto.randomUUID()}`, description: '' }] })}>添加成立条件</button>
              <fieldset><legend>参与人物</legend>{draft.characters.map(actor => <label key={actor.id} style={{ display: 'block' }}><input type="checkbox" checked={node.actorIds.includes(actor.id)} onChange={e => patchNode(i, { actorIds: toggle(node.actorIds, actor.id, e.target.checked) })} />{actor.name || '未命名人物'}</label>)}</fieldset>
              <fieldset><legend>依赖已落实事件（全部满足才成立）</legend>{draft.nodes.filter(n => n.id !== node.id).map(dependency => <label key={dependency.id} style={{ display: 'block' }}><input type="checkbox" checked={node.dependsOn.includes(dependency.id)} onChange={e => patchNode(i, { dependsOn: toggle(node.dependsOn, dependency.id, e.target.checked) })} />{draft.stages.find(s => s.id === dependency.stageId)?.title} · {dependency.title}</label>)}</fieldset>
              <details><summary>查看来源</summary>{node.sourceRefs.map(ref => { const match = /^author:(\d+):(\d+)$/.exec(ref); const excerpt = evidenceExcerpts.get(ref); return <blockquote key={ref}>{match ? base?.source.text.slice(Number(match[1]), Number(match[2])) : excerpt ?? ref}</blockquote>; })}</details>
            </div></details>)}
          </div>
        </details>)}
        <div className="world-weave-artwork-actions"><button type="button" className="btn-ghost" onClick={() => void save()}>保存剧情版本并选用</button>{binding && <button type="button" className="btn-ghost" onClick={() => { onBind(undefined); setNotice('已取消新开局的主线选择，保存世界后生效。'); }}>取消选用</button>}</div>
      </fieldset>}
    </div>
  </details>;
}

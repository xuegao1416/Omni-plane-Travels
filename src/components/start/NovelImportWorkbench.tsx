import { useEffect,useMemo,useRef,useState } from 'react';
import { BookOpen,Download,Pause,Sparkles,Upload,X } from 'lucide-react';
import type { WorldDef } from '../../data/worlds-schema';
import { DEFAULT_LOCAL_EMBEDDING_MODEL,createEmbeddingClient } from '../../memory/embeddingRuntime';
import { useMemoryStore } from '../../memory/memoryStore';
import { NOVEL_ANALYSIS_VERSION,runNovelAnalysis,type NovelAnalysisProgress } from '../../novel/analysisRunner';
import { copyNovelDataset,importNovelDataset } from '../../novel/datasetImport';
import { createNovelDatasetFromEpub } from '../../novel/epubImport';
import { getNovelDataset,listNovelDatasets,listNovelJobs,saveNovelDataset,saveNovelDatasetHeader } from '../../novel/novelStore';
import { createNovelDatasetFromBytes,type NovelTextEncoding } from '../../novel/plainText';
import { probeNovelEmbedding } from '../../novel/semanticIndex';
import type { NovelDataset,NovelEvidenceRef,NovelStaticMaterial } from '../../novel/types';
import { canCreateNovelWorld,mergeNovelChapterWithPrevious,rebuildNovelDatasetSegments,renameNovelChapter,splitNovelChapter } from '../../novel/workbenchState';
import { createWorldFromNovel,regenerateNovelWorldMaterial } from '../../novel/worldFactory';
import { buildNovelWorldBookEntries } from '../../novel/worldBookAdapter';
import { useNovelConfigStore } from '../../stores/novelConfigStore';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import DawnFrameV4 from '../shared/dawn/DawnFrameV4';
import { NovelConnectionSettings } from './novelWorkbench/NovelConnectionSettings';
import './novelWorkbench/workbench.css';
import DirectorAuthorEditor from './worldEditorForm/DirectorAuthorEditor';
import { collectDirectorDependencies, restoreDirectorDependencies } from '../../director/dependencies';

interface NovelImportWorkbenchProps { onClose: () => void; onCreateWorld: (world: WorldDef) => void; worlds?: WorldDef[]; onUpdateWorld?: (world: WorldDef) => void }
const TABS = ['来源与章节', '分析任务', '世界资料', '剧情资料', '创建世界'];
const PAGE_SIZE = 20;
const CATEGORIES: Record<string, string> = { setting: '背景', rules: '规则', npcs: '人物', factions: '势力', lore: '地点', items: '物品', culture: '文化', economy: '经济与时间', custom: '其他' };
const STATUSES: Record<string, string> = { draft: '待分析', processing: '处理中', ready: '已完成', partial: '部分完成', failed: '失败', pending: '等待', completed: '完成', running: '运行中', paused: '已暂停', off: '关闭', preparing: '准备中', enhanced: '已增强', degraded: '已降级', evidence: '原文证据', overview: '世界归并', segments: '剧情编译' };
const label = (status?: string) => status ? STATUSES[status] ?? status : '尚未开始';
function downloadJson(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name.replace(/[\\/:*?"<>|]/g, '_'); anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Pager({ page, count, onChange }: { page: number; count: number; onChange: (value: number) => void }) {
  const last = Math.max(0, Math.ceil(count / PAGE_SIZE) - 1);
  return <nav className="novel-workbench-pager" aria-label="列表分页"><button disabled={page <= 0} onClick={() => onChange(page - 1)}>上一页</button><span>{count} 项 · {page + 1}/{last + 1} 页</span><button disabled={page >= last} onClick={() => onChange(page + 1)}>下一页</button></nav>;
}

export function NovelImportWorkbench({ onClose, onCreateWorld, worlds = [], onUpdateWorld }: NovelImportWorkbenchProps) {
  useBodyScrollLock(true);
  const inputRef = useRef<HTMLInputElement>(null), dialogRef = useRef<HTMLDivElement>(null), chapterPreviewRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null), runRef = useRef<ReturnType<typeof runNovelAnalysis> | null>(null);
  const memoryConfig = useMemoryStore(state => state.config), config = useNovelConfigStore(state => state.config);
  const [dataset, setDataset] = useState<NovelDataset>();
  const [title, setTitle] = useState(''), [tab, setTab] = useState(0), [message, setMessage] = useState('导入一本小说，逐段提取世界资料和剧情依据。');
  const [progress, setProgress] = useState<NovelAnalysisProgress>();
  const [isReading, setIsReading] = useState(false), [isAnalyzing, setIsAnalyzing] = useState(false), [isPausing, setIsPausing] = useState(false);
  const [recent, setRecent] = useState<NovelDataset[]>([]);
  const [chapterIndex, setChapterIndex] = useState(0), [chapterSearch, setChapterSearch] = useState(''), [chapterPage, setChapterPage] = useState(0);
  const [segmentPage, setSegmentPage] = useState(0), [plotIndex, setPlotIndex] = useState(0), [startSegmentIndex, setStartSegmentIndex] = useState(0);
  const [mode, setMode] = useState<'auto' | 'single_chapter' | 'custom'>('auto'), [maxTokens, setMaxTokens] = useState(6000);
  const [rangeStart, setRangeStart] = useState(0), [rangeEnd, setRangeEnd] = useState(0), [sourceFile, setSourceFile] = useState<File>();
  const [pendingImport, setPendingImport] = useState<{ dataset: NovelDataset; world?: WorldDef }>();
  const [search, setSearch] = useState(''), [category, setCategory] = useState('all'), [archivePage, setArchivePage] = useState(0), [conflictsOnly, setConflictsOnly] = useState(false);
  const [materialDraft, setMaterialDraft] = useState<string>();
  const [embeddingState, setEmbeddingState] = useState('off'), [probing, setProbing] = useState(false);
  const [evidence, setEvidence] = useState<NovelEvidenceRef>();
  const [worldUpdate, setWorldUpdate] = useState<WorldDef>(), [worldDiff, setWorldDiff] = useState<string[]>([]);
  const [directorBinding, setDirectorBinding] = useState<WorldDef['directorSource']>();
  const busy = isAnalyzing || isReading || isPausing;
  const apiReady = Boolean(config.api.baseUrl.trim() && config.api.model.trim());

  useEffect(() => { void useNovelConfigStore.getState().initialize().catch(error => setMessage(`配置读取失败：${String(error)}`)); void listNovelDatasets().then(setRecent).catch(error => setMessage(`资料列表读取失败：${String(error)}`)); return () => abortRef.current?.abort(); }, []);
  useEffect(() => setEmbeddingState(config.embeddingMode === 'off' ? 'off' : '未测试'), [config, memoryConfig]);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialogRef.current?.focus(); return () => previous?.focus(); }, []);
  const pause = async () => { setIsPausing(true); abortRef.current?.abort(); await runRef.current?.catch(() => undefined); setIsPausing(false); };
  const close = async () => { await pause(); onClose(); };
  const keyboard = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); void close(); }
    if (event.key !== 'Tab') return;
    const nodes = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary') ?? [])].filter(node => node.offsetParent !== null);
    if (event.shiftKey && (document.activeElement === nodes[0] || document.activeElement === dialogRef.current)) { event.preventDefault(); nodes.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0]?.focus(); }
  };
  const openDataset = async (requested: NovelDataset) => {
    try {
      const next = await getNovelDataset(requested.id) ?? requested, latestJob = (await listNovelJobs(next.id))[0];
      setDataset(next); setTitle(next.title); setChapterIndex(0); setChapterPage(0); setSegmentPage(0); setArchivePage(0); setPlotIndex(0); setEvidence(undefined); setMaterialDraft(undefined);
      setDirectorBinding(worlds.find(world => world.novelSource?.datasetId === next.id)?.directorSource);
      setRangeStart(0); setRangeEnd(Math.max(0, next.chapters.length - 1)); setStartSegmentIndex(Math.min(latestJob?.startSegmentIndex ?? 0, Math.max(0, next.segments.length - 1))); setProgress(undefined);
      setMessage(`已载入《${next.title}》。${next.chapters.length ? '可继续分析或审查已有资料。' : '这是静态资料档案；没有原文，不能重新拆解。'}`);
    } catch (error) { setMessage(`载入失败：${String(error)}`); }
  };
  const acceptImport = async (next: NovelDataset, world?: WorldDef, original?: NovelDataset) => {
    try {
      await saveNovelDataset(next); await openDataset(next); setRecent(await listNovelDatasets()); setPendingImport(undefined); setTab(0);
      if (world) {
        const chapterIds = new Map(original?.chapters.map((chapter, index) => [chapter.id, next.chapters[index]?.id]));
        (onUpdateWorld ?? onCreateWorld)({ ...world, id: `novel_${next.id}`,
          novelSource: { ...world.novelSource, datasetId: next.id, startSegmentIndex: world.novelSource?.startSegmentIndex ?? 0 },
          worldBookEntries: world.worldBookEntries?.map(entry => entry.novelProvenance ? { ...entry, novelProvenance: {
            ...entry.novelProvenance, datasetId: next.id,
            evidenceRefs: entry.novelProvenance.evidenceRefs?.map(ref => ({ ...ref, chapterId: chapterIds.get(ref.chapterId) ?? ref.chapterId })),
          } } : entry),
        });
      }
    } catch (error) { setMessage(`导入保存失败：${String(error)}`); }
  };
  const loadFile = async (file?: File, encoding?: NovelTextEncoding) => {
    if (!file || busy) return;
    setIsReading(true); setMessage(`正在读取《${file.name}》…`);
    try {
      const extension = file.name.toLowerCase().split('.').pop(); let next: NovelDataset; let world: WorldDef | undefined;
      if (extension === 'epub') next = await createNovelDatasetFromEpub(file.name, await file.arrayBuffer());
      else if (extension === 'json') { const raw = JSON.parse(await file.text()); if (raw.kind === 'novel-world-package' && raw.dataset && raw.world) { next = importNovelDataset(raw.dataset); await restoreDirectorDependencies({ customWorld: raw.world }, raw.directorDefinitions); world = raw.world as WorldDef; } else next = importNovelDataset(raw); }
      else if (extension === 'txt') next = createNovelDatasetFromBytes(file.name.replace(/\.[^.]+$/, ''), await file.arrayBuffer(), encoding);
      else throw new Error('请选择 TXT、EPUB 或拆解资料 JSON。');
      setSourceFile(extension === 'txt' ? file : undefined);
      if (await getNovelDataset(next.id)) { setPendingImport({ dataset: next, world }); setMessage('已有同一资料档案。默认导入为副本，也可以明确更新原资料。'); }
      else await acceptImport(next, world);
    } catch (error) { setMessage(`导入失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setIsReading(false); }
  };
  const replaceStructure = async (chapters: NovelDataset['chapters']) => {
    if (!dataset || busy) return;
    try {
      const next = rebuildNovelDatasetSegments(dataset, chapters, { mode, maxTokens, startChapterIndex: mode === 'custom' ? rangeStart : 0, endChapterIndex: mode === 'custom' ? rangeEnd : Math.max(0, chapters.length - 1) });
      await saveNovelDataset(next); setDataset(next); setStartSegmentIndex(0); setPlotIndex(0); setProgress(undefined); setChapterIndex(index => Math.min(index, Math.max(0, chapters.length - 1))); setRangeEnd(Math.max(0, chapters.length - 1));
      setMessage('章节与分段已更新；保留输入未变化的检查点，变化部分重新分析。');
    } catch (error) { setMessage(`章节保存失败：${String(error)}`); }
  };
  const makeEmbedding = () => {
    if (config.embeddingMode === 'off') return undefined;
    const runtime = config.embeddingMode === 'local_endpoint' ? { ...memoryConfig, vectorEnabled: true, vectorRuntime: 'local_endpoint' as const, localEmbeddingEndpoint: config.embeddingEndpoint, localEmbeddingModelId: config.embeddingModel } : { ...memoryConfig, vectorEnabled: true };
    const model = runtime.vectorRuntime === 'remote' ? runtime.vectorApiModel.trim() : runtime.localEmbeddingModelId?.trim() || DEFAULT_LOCAL_EMBEDDING_MODEL;
    return { client: createEmbeddingClient(runtime), model, identity: `${runtime.vectorRuntime}:${runtime.vectorRuntime === 'local_endpoint' ? runtime.localEmbeddingEndpoint : runtime.vectorRuntime === 'remote' ? runtime.vectorApiUrl : 'browser'}:${model}`, rateLimitMs: config.embeddingRateLimitMs };
  };
  const testEmbedding = async () => {
    const embedding = makeEmbedding(); if (!embedding) return;
    setProbing(true); setEmbeddingState('preparing');
    try { const result = await probeNovelEmbedding(embedding.client); setEmbeddingState('连接通过'); setMessage(`真实 embedding 请求通过：${embedding.model}，${result.dimension} 维。全书索引尚未因此完成。`); }
    catch (error) { setEmbeddingState('degraded'); setMessage(`Embedding 不可用：${String(error)}；基础检索仍可继续。`); }
    finally { setProbing(false); }
  };
  const startAnalysis = async (regenerate = false, reExtractEvidence = false) => {
    if (!dataset || busy || !apiReady) return;
    const controller = new AbortController(); abortRef.current = controller; setIsAnalyzing(true); setTab(1);
    try {
      const latest = await getNovelDataset(dataset.id) ?? dataset, previousMaterial = structuredClone(latest.staticMaterial);
      await saveNovelDatasetHeader({ ...latest, title: title.trim() || latest.title, updatedAt: Date.now() });
      const run = runNovelAnalysis({ datasetId: dataset.id, config: { ...config.api, rateLimitMs: config.analysisRateLimitMs }, startSegmentIndex, embedding: makeEmbedding(), forceOverview: regenerate, reExtractEvidence, signal: controller.signal, onCheckpoint: setDataset, onProgress: value => { setProgress(value); setMessage(value.message); if (value.embeddingStatus) setEmbeddingState(value.embeddingStatus); } });
      runRef.current = run; const result = await run; setDataset(result.dataset); setRecent(await listNovelDatasets());
      if (result.job.embeddingStatus) setEmbeddingState(result.job.embeddingStatus);
      if (regenerate && !result.dataset.overviewError) {
        const existing = worlds.find(world => world.novelSource?.datasetId === result.dataset.id);
        if (existing && onUpdateWorld) { const updated = regenerateNovelWorldMaterial(existing, result.dataset, result.dataset.legacyStaticMaterial ?? previousMaterial); setWorldUpdate(updated); const before = new Map(existing.worldBookEntries?.map(entry => [entry.uid, entry])); setWorldDiff((updated.worldBookEntries ?? []).flatMap(entry => { const original = before.get(entry.uid); return !original ? [`新增：${entry.comment}`] : original.content !== entry.content ? [`更新：${entry.comment}`] : []; })); }
      }
      setMessage(result.job.status === 'paused' ? '已暂停并保存检查点，可继续未完成部分。' : result.dataset.analysisStatus === 'ready' ? '全书拆解完成，可审查资料并创建世界。' : '已保存当前结果；尚有未处理、失败或排除内容，请查看覆盖情况。');
    } catch (error) { const latest = await getNovelDataset(dataset.id).catch(() => undefined); if (latest) setDataset(latest); setMessage(`拆解未完成：${error instanceof Error ? error.message : String(error)}`); }
    finally { abortRef.current = null; runRef.current = null; setIsAnalyzing(false); }
  };
  const createWorld = async () => {
    if (!dataset) return;
    try {
      const latest = await getNovelDataset(dataset.id) ?? dataset, next = { ...latest, title: title.trim() || latest.title, updatedAt: Date.now() };
      const base = worlds.find(world => world.novelSource?.datasetId === next.id) ?? createWorldFromNovel(next, startSegmentIndex);
      const binding = directorBinding ?? base.directorSource;
      if (next.segments.length && !binding) throw new Error('请先在下方整理并保存主线版本，再创建小说世界');
      await saveNovelDatasetHeader(next);
      onCreateWorld({ ...base, directorSource: binding });
    }
    catch (error) { setMessage(`创建失败：${String(error)}`); }
  };
  const exportData = async (withWorld: boolean) => {
    if (!dataset) return;
    try {
      const base = worlds.find(item => item.novelSource?.datasetId === dataset.id) ?? (worldReady ? createWorldFromNovel(dataset, startSegmentIndex) : undefined);
      const world = base ? { ...base, directorSource: directorBinding ?? base.directorSource } : undefined;
      const directorDefinitions = withWorld && world ? await collectDirectorDependencies({ customWorld: world as unknown as Record<string, unknown> }) : [];
      downloadJson(withWorld && world ? { kind: 'novel-world-package', version: 1, dataset, world, directorDefinitions } : dataset, `${title || dataset.title}-${withWorld && world ? '世界资料包' : '拆解资料'}.json`);
    }
    catch (error) { setMessage(`导出失败：${String(error)}`); }
  };
  const saveMaterial = async () => {
    if (!dataset || busy || materialDraft === undefined) return;
    try { const material = JSON.parse(materialDraft) as NovelStaticMaterial; if (!material || Array.isArray(material) || typeof material !== 'object') throw new Error('资料必须是 JSON 对象。'); const normalized = importNovelDataset({ ...dataset, staticMaterial: material }), next = { ...dataset, staticMaterial: normalized.staticMaterial, updatedAt: Date.now() }; await saveNovelDatasetHeader(next); setDataset(next); setMaterialDraft(undefined); setMessage('资料修改已保存。已创建世界中的手工内容继续保留。'); }
    catch (error) { setMessage(`资料保存失败：${String(error)}`); }
  };
  const evidenceButton = (ref: NovelEvidenceRef, index: number) => <button key={`${ref.chapterId}-${ref.startOffset}-${index}`} type="button" className="novel-workbench-source-link" onClick={() => setEvidence(ref)}>{dataset?.chapters.find(chapter => chapter.id === ref.chapterId)?.title ?? '原文来源'}：{ref.excerpt.slice(0, 70)}</button>;
  const chapter = dataset?.chapters[chapterIndex], plot = dataset?.segments[plotIndex];
  const chapters = useMemo(() => (dataset?.chapters ?? []).map((chapter, index) => ({ chapter, index })).filter(({ chapter }) => !chapterSearch || `${chapter.title} ${chapter.volumeTitle ?? ''}`.includes(chapterSearch)), [dataset?.chapters, chapterSearch]);
  const generated = useMemo(() => dataset ? buildNovelWorldBookEntries(dataset.staticMaterial, 1) : [], [dataset?.staticMaterial]);
  const archives = dataset ? [...(dataset.staticMaterial.characters ?? []), ...(dataset.staticMaterial.factions ?? []), ...(dataset.staticMaterial.locations ?? []), ...(dataset.staticMaterial.items ?? [])] : [];
  const entries = generated.filter(entry => (category === 'all' || entry.entryType === category) && (!search || `${entry.comment} ${entry.content} ${entry.key?.join(' ')}`.includes(search)) && (!conflictsOnly || archives.some(archive => archive.conflict && entry.comment.includes(archive.name))));
  const completed = dataset?.segments.filter(segment => segment.status === 'completed' && segment.analysisVersion === NOVEL_ANALYSIS_VERSION).length ?? 0;
  const evidenceCompleted = dataset?.segments.filter(segment => segment.evidenceNotes).length ?? 0;
  const staticOnly = Boolean(dataset && !dataset.chapters.length && generated.length), worldReady = staticOnly || canCreateNovelWorld(dataset, startSegmentIndex);
  const fullReady = dataset?.analysisStatus === 'ready' && completed === dataset.segments.length && !dataset.importIssues?.some(issue => issue.severity === 'error');
  const evidenceChapter = dataset?.chapters.find(chapter => chapter.id === evidence?.chapterId);
  return <div className="novel-import-workbench" role="dialog" aria-modal="true" aria-labelledby="novel-import-workbench-title" ref={dialogRef} tabIndex={-1} onKeyDown={keyboard}>
    <div className="novel-import-workbench__backdrop" aria-hidden="true" />
    <DawnFrameV4 mode="panel" withFill className="novel-import-workbench__frame" ariaLabel="小说拆解台"><div className="novel-import-workbench__layout">
      <header className="novel-import-workbench__header"><div className="novel-import-workbench__heading"><span className="novel-import-workbench__kicker">NOVEL TO WORLD</span><h2 id="novel-import-workbench-title"><BookOpen size={21} /> 小说拆解台</h2><p>从完整原文构建世界书，保存未来剧情主线的依据。</p></div><button className="novel-import-workbench__close" onClick={() => void close()} disabled={isPausing} aria-label="保存进度并关闭"><X size={20} /></button></header>
      <nav className="novel-workbench-tabs" aria-label="拆解工作区">{TABS.map((name, index) => <button key={name} type="button" aria-current={tab === index ? 'page' : undefined} className={tab === index ? 'is-active' : ''} onClick={() => setTab(index)}>{String(index + 1).padStart(2, '0')} · {name}</button>)}</nav>
      <main className="novel-import-workbench__body"><p className={`novel-import-workbench__status${/失败|未完成|不可用/.test(message) ? ' is-error' : ''}`} role="status">{message}</p>
        {pendingImport && <section className="novel-import-workbench__panel"><h3>检测到相同资料 ID</h3><p>默认导入为副本保留现有资料。更新会使用导入文件替换原资料。</p><div className="novel-import-workbench__structure-actions"><button autoFocus onClick={() => void acceptImport(copyNovelDataset(pendingImport.dataset), pendingImport.world, pendingImport.dataset)}>作为副本（默认）</button><button onClick={() => void acceptImport(pendingImport.dataset, pendingImport.world)}>恢复／更新现有资料</button><button onClick={() => setPendingImport(undefined)}>取消导入</button></div></section>}
        {tab === 0 && <><section className="novel-import-workbench__step"><button type="button" className="novel-import-workbench__dropzone" disabled={busy} onClick={() => inputRef.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void loadFile(e.dataTransfer.files[0]); }}><Upload size={24} /><strong>{isReading ? '正在识别文件…' : '选择或拖入小说文件'}</strong><small>TXT 文本 · EPUB 电子书 · JSON 拆解档案／世界资料包</small></button><input ref={inputRef} type="file" accept=".txt,.epub,.json" hidden onChange={e => { void loadFile(e.target.files?.[0]); e.target.value = ''; }} />
          {!!recent.length && <label className="novel-import-workbench__field">继续已有资料<select disabled={busy} value={dataset?.id ?? ''} onChange={e => { const found = recent.find(item => item.id === e.target.value); if (found) { setSourceFile(undefined); void openDataset(found); } }}><option value="" disabled>选择本地资料</option>{recent.map(item => <option key={item.id} value={item.id}>{item.title} · {label(item.analysisStatus)} · {item.completedSegmentCount ?? 0}/{item.segmentCount ?? item.segments.length} 段</option>)}</select></label>}</section>
          {dataset && <><div className="novel-workbench-metrics"><span><b>{dataset.chapters.length}</b>章</span><span><b>{dataset.rawTextLength.toLocaleString()}</b>原文字符</span><span><b>{dataset.segments.length}</b>分析段</span><span><b>{dataset.importIssues?.length ?? 0}</b>导入提示</span></div>
            {sourceFile && <label className="novel-import-workbench__field">TXT 编码 · 当前 {dataset.encoding ?? '未知'}<select disabled={busy} value={dataset.encoding ?? ''} onChange={e => void loadFile(sourceFile, e.target.value as NovelTextEncoding || undefined)}><option value="">自动识别</option><option value="utf-8">UTF-8</option><option value="utf-16le">UTF-16 LE</option><option value="utf-16be">UTF-16 BE</option><option value="gb18030">GB18030 / GBK</option></select><small>切换编码重新导入新的来源，请先检查正文预览。</small></label>}
            {!!dataset.importIssues?.length && <details className="novel-import-workbench__segments" open><summary>导入报告 · {dataset.importIssues.length} 项</summary><ul>{dataset.importIssues.slice(0, 100).map((issue, index) => <li key={index}>{issue.severity === 'error' ? '无法读取：' : '请核对：'}{issue.message}{issue.chapterId && <button onClick={() => { const index = dataset.chapters.findIndex(chapter => chapter.id === issue.chapterId); if (index >= 0) setChapterIndex(index); }}>查看章节</button>}</li>)}</ul>{dataset.importIssues.length > 100 && <p>显示前 100 项，完整报告包含在资料导出中。</p>}</details>}
            {chapter ? <div className="novel-import-workbench__grid"><section className="novel-import-workbench__panel"><h3>章节目录</h3><label className="novel-import-workbench__field">搜索章节<input value={chapterSearch} onChange={e => { setChapterSearch(e.target.value); setChapterPage(0); }} placeholder="章节名称或卷名" /></label><ol className="novel-workbench-select-list">{chapters.slice(chapterPage * PAGE_SIZE, (chapterPage + 1) * PAGE_SIZE).map(({ chapter, index }) => <li key={chapter.id}><button className={chapterIndex === index ? 'is-active' : ''} onClick={() => setChapterIndex(index)}>{index + 1}. {chapter.title}<small>{chapter.included === false ? '已排除' : `${chapter.content.length} 字`}</small></button></li>)}</ol><Pager page={chapterPage} count={chapters.length} onChange={setChapterPage} /></section>
              <section className="novel-import-workbench__panel"><h3>正文预览与边界修正</h3><label className="novel-import-workbench__field">章节标题<input key={chapter.id + chapter.title} defaultValue={chapter.title} disabled={busy} onBlur={e => { if (e.target.value.trim() && e.target.value !== chapter.title) void replaceStructure(renameNovelChapter(dataset.chapters, chapterIndex, e.target.value)); }} /></label><label className="novel-workbench-checkbox"><input type="checkbox" checked={chapter.included !== false} disabled={busy} onChange={e => void replaceStructure(dataset.chapters.map((item, index) => index === chapterIndex ? { ...item, included: e.target.checked } : item))} />参与正文分析（简介、广告等可排除）</label><textarea ref={chapterPreviewRef} className="novel-workbench-original" readOnly value={chapter.content} aria-label="章节正文预览" /><div className="novel-import-workbench__structure-actions"><button disabled={busy || !chapterIndex} onClick={() => void replaceStructure(mergeNovelChapterWithPrevious(dataset.chapters, chapterIndex))}>合并至上一章</button><button disabled={busy} onClick={() => { const next = splitNovelChapter(dataset.chapters, chapterIndex, chapterPreviewRef.current?.selectionStart ?? 0); if (next.length === dataset.chapters.length) setMessage('请先在正文中间点选拆分位置。'); else void replaceStructure(next); }}>从光标拆分</button></div></section></div> : <p>该档案没有原文，可直接审查静态资料并创建世界。</p>}
            {!!dataset.chapters.length && <section className="novel-import-workbench__panel"><h3>分析分段</h3><div className="novel-import-workbench__range-fields"><label className="novel-import-workbench__field">分段方式<select disabled={busy} value={mode} onChange={e => setMode(e.target.value as typeof mode)}><option value="auto">全书自动分段</option><option value="single_chapter">每章一组</option><option value="custom">局部试拆</option></select></label><label className="novel-import-workbench__field">每段输入预算<input type="number" disabled={busy} min={1000} max={12000} step={500} value={maxTokens} onChange={e => setMaxTokens(Math.max(1000, Math.min(12000, Number(e.target.value) || 6000)))} /></label></div>{mode === 'custom' && <div className="novel-import-workbench__range-fields"><label className="novel-import-workbench__field">起始章<input type="number" disabled={busy} min={1} max={dataset.chapters.length} value={rangeStart + 1} onChange={e => setRangeStart(Math.min(rangeEnd, Math.max(0, Number(e.target.value) - 1)))} /></label><label className="novel-import-workbench__field">结束章<input type="number" disabled={busy} min={rangeStart + 1} max={dataset.chapters.length} value={rangeEnd + 1} onChange={e => setRangeEnd(Math.min(dataset.chapters.length - 1, Math.max(rangeStart, Number(e.target.value) - 1)))} /></label></div>}<button className="novel-import-workbench__apply" disabled={busy} onClick={() => void replaceStructure(dataset.chapters)}>应用分段设置</button></section>}
          </>}</>}
        {tab === 1 && <><NovelConnectionSettings disabled={busy} onMessage={setMessage} /><section className="novel-import-workbench__panel"><h3>检索状态：{label(embeddingState)}</h3><p>连接测试仅验证服务；全书增强进度以分析任务为准。</p><button disabled={busy || probing || config.embeddingMode === 'off'} onClick={() => void testEmbedding()}>{probing ? '正在发送真实请求…' : '测试 embedding 连接'}</button>{progress?.totalChunks !== undefined && <p>向量索引：{progress.embeddedChunks ?? 0}/{progress.totalChunks} 块</p>}</section>
          {dataset ? <><div className="novel-workbench-metrics"><span><b>{evidenceCompleted}/{dataset.segments.length}</b>证据提取</span><span><b>{completed}/{dataset.segments.length}</b>剧情编译</span><span><b>{dataset.segments.filter(item => item.status === 'failed').length}</b>失败分段</span><span><b>{fullReady ? '全书完成' : '部分／待完成'}</b>覆盖状态</span></div>{progress && <section className="novel-import-workbench__analysis-detail"><strong>{label(progress.phase)} · {progress.segmentTitle ?? '全书资料'}</strong><div className="novel-import-workbench__progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.completed}><span style={{ width: `${100 * progress.completed / Math.max(1, progress.total)}%` }} /></div><p>{progress.completed}/{progress.total} · {progress.message}</p><small>本次生成请求：{progress.requestCount ?? 0} 次（含重试）</small>{progress.streamText && <details><summary>当前响应预览</summary><pre>{progress.streamText.slice(-1600)}</pre></details>}</section>}{dataset.overviewError && <p role="alert">归并未完成：{dataset.overviewError}</p>}<section className="novel-import-workbench__panel"><h3>分段检查点</h3><ol className="novel-workbench-select-list">{dataset.segments.slice(segmentPage * PAGE_SIZE, (segmentPage + 1) * PAGE_SIZE).map(segment => <li key={segment.id}><button onClick={() => { setPlotIndex(segment.index); setTab(3); }}><strong>{segment.index + 1}. {segment.title}</strong><small>证据 {segment.evidenceNotes ? '已提取' : '未提取'} · 剧情 {label(segment.status)} · {segment.estimatedTokens ?? 0} tokens</small>{segment.error && <span className="is-error">{segment.error}</span>}</button></li>)}</ol><Pager page={segmentPage} count={dataset.segments.length} onChange={setSegmentPage} /></section></> : <p>先在「来源与章节」导入小说，配置可提前保存。</p>}</>}
        {tab === 2 && (dataset ? <><div className="novel-workbench-section-header"><h3>世界资料 · {generated.length} 条</h3><button disabled={busy} onClick={() => setMaterialDraft(JSON.stringify(dataset.staticMaterial, null, 2))}>编辑结构化资料</button></div>{materialDraft !== undefined && <section className="novel-import-workbench__panel"><label className="novel-import-workbench__field">世界资料 JSON<textarea className="novel-workbench-original" value={materialDraft} onChange={e => setMaterialDraft(e.target.value)} /></label><div className="novel-import-workbench__structure-actions"><button disabled={busy} onClick={() => void saveMaterial()}>校验并保存</button><button onClick={() => setMaterialDraft(undefined)}>取消修改</button></div></section>}
          <div className="novel-import-workbench__range-fields"><label className="novel-import-workbench__field">名称、别名、内容<input value={search} onChange={e => { setSearch(e.target.value); setArchivePage(0); }} /></label><label className="novel-import-workbench__field">资料分类<select value={category} onChange={e => { setCategory(e.target.value); setArchivePage(0); }}><option value="all">全部分类</option>{Object.entries(CATEGORIES).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label></div><label className="novel-workbench-checkbox"><input type="checkbox" checked={conflictsOnly} onChange={e => { setConflictsOnly(e.target.checked); setArchivePage(0); }} />仅显示冲突档案</label>
          {entries.slice(archivePage * PAGE_SIZE, (archivePage + 1) * PAGE_SIZE).map(entry => <article className="novel-import-workbench__panel" key={entry.uid}><div className="novel-workbench-section-header"><h3>{entry.comment}</h3><small>{CATEGORIES[entry.entryType ?? 'custom'] ?? entry.entryType} · {entry.constant ? '常驻概览' : '关键词触发'}</small></div><p className="novel-workbench-prose">{entry.content}</p><small>触发词：{entry.key?.join('、') || '无'}</small>{archives.filter(archive => entry.comment.includes(archive.name)).map(archive => <div key={archive.id ?? archive.name}>{archive.conflict && <p role="note">待核对：{archive.conflict}</p>}{archive.evidenceRefs?.map(evidenceButton)}</div>)}</article>)}{!entries.length && <p>尚无符合条件的世界资料，完成分析归并后会出现在这里。</p>}<Pager page={archivePage} count={entries.length} onChange={setArchivePage} />
          {dataset.staticCoverage && <details className="novel-import-workbench__segments"><summary>设定覆盖报告</summary>{Object.entries(dataset.staticCoverage).map(([key, status]) => <p key={key}>{({ rules: '世界规则', culture: '文化', powerSystem: '力量体系', economy: '经济', time: '时间' } as Record<string, string>)[key]}：{status === 'available' ? '已有资料' : status === 'no_evidence' ? '原文未提供依据' : '待补齐'}</p>)}</details>}</> : <p>导入小说后，在这里审查完整世界资料。</p>)}
        {tab === 3 && (dataset && plot ? <><label className="novel-import-workbench__field">查看剧情分段（共 {dataset.segments.length} 段）<input type="number" min={1} max={dataset.segments.length} value={plotIndex + 1} onChange={e => setPlotIndex(Math.max(0, Math.min(dataset.segments.length - 1, Number(e.target.value) - 1)))} /></label><h3>{plot.title} · {label(plot.status)}</h3><p className="novel-import-workbench__hint">这是原著剧情资料，尚未自动启用动态主线。顺序不等同于因果关系。</p><p className="novel-workbench-prose">{plot.summary || plot.evidenceNotes?.summary || '该段尚未分析。'}</p>{plot.contextGap && <p role="alert">前段上下文存在缺口，补齐后相关剧情会重新编译。</p>}
          {plot.events.map((event, index) => <article className="novel-import-workbench__panel" key={event.id ?? index}><h3>{event.name}</h3><p>{event.description}</p><dl className="novel-workbench-facts">{[['前提', event.prerequisites?.join('；')], ['触发', event.trigger], ['阻断条件', event.blockers?.join('；')], ['结果', event.result], ['后续影响', event.nextImpact?.join('；')]].map(([name, value]) => value ? <div key={name}><dt>{name}</dt><dd>{value}</dd></div> : null)}</dl>{event.evidenceRefs?.map(evidenceButton)}</article>)}
          {!!plot.characterProgress?.length && <section className="novel-import-workbench__panel"><h3>人物变化</h3>{plot.characterProgress.map((character, index) => <article key={index}><h4>{character.characterName}</h4><p>之前：{character.before.join('；')}</p><p>变化：{character.changes.join('；')}</p><p>之后：{character.after.join('；')}</p>{character.evidenceRefs.map(evidenceButton)}</article>)}</section>}
          {[['开场事实', plot.openingFacts], ['结尾事实', plot.endingFacts], ['伏笔', plot.foreshadowing], ['未解决线索', plot.evidenceNotes?.openThreads], ['硬约束', plot.hardConstraints], ['后续参考', plot.nextReference]].map(([name, values]) => Array.isArray(values) && values.length ? <section className="novel-import-workbench__panel" key={String(name)}><h3>{String(name)}</h3><ul>{values.map((value, index) => <li key={index}>{value}</li>)}</ul></section> : null)}{!!plot.evidenceRefs?.length && <details className="novel-import-workbench__segments"><summary>分段证据 · {plot.evidenceRefs.length} 条</summary>{plot.evidenceRefs.map(evidenceButton)}</details>}</> : <p>暂无剧情分段，只有静态资料的档案也可直接创建世界。</p>)}
        {tab === 4 && (dataset ? <section className="novel-import-workbench__panel"><h3>将资料接入项目世界</h3><label className="novel-import-workbench__field">世界名称<input value={title} disabled={busy} onChange={e => setTitle(e.target.value)} /></label><p>世界书：{generated.length} 条 · 剧情：{completed}/{dataset.segments.length} 段 · {staticOnly ? '仅静态资料' : fullReady ? '全书完成' : '部分资料'}</p>{!!dataset.segments.length && <label className="novel-import-workbench__field">世界起始剧情段<input type="number" min={1} max={dataset.segments.length} value={startSegmentIndex + 1} disabled={busy} onChange={e => setStartSegmentIndex(Math.max(0, Math.min(dataset.segments.length - 1, Number(e.target.value) - 1)))} /><small>{dataset.segments[startSegmentIndex]?.title} · {label(dataset.segments[startSegmentIndex]?.status)}</small></label>}<p className="novel-import-workbench__hint">创建后可在世界列表继续编辑和开始游戏。完整档案按关键词调用；剧情资料保留来源，不直接创建数值规则。</p><div className="novel-import-workbench__structure-actions"><button disabled={!worldReady || busy || (!!dataset.segments.length && !directorBinding)} onClick={() => void createWorld()}>{worlds.some(world => world.novelSource?.datasetId === dataset.id) ? '打开已创建世界' : staticOnly ? '创建静态资料世界' : fullReady ? '创建完整小说世界' : '创建部分资料世界'}</button><button onClick={() => exportData(false)} disabled={busy}><Download size={15} />导出拆解资料</button><button onClick={() => exportData(true)} disabled={busy || !worldReady}><Download size={15} />导出世界资料包</button></div>{!worldReady && <p>需要可用的世界资料，以及所选起始分段的分析结果。</p>}{worldReady && !!dataset.segments.length && !directorBinding && <p className="novel-import-workbench__hint">小说世界需要先在下方整理并保存一个主线版本；保存后即可创建世界。</p>}
          {!!dataset.segments.length && <DirectorAuthorEditor key={dataset.id} workspaceId={`novel-director:${dataset.id}`} title={title || dataset.title} binding={directorBinding} novelDatasetId={dataset.id} apiConfig={config.api} onBind={setDirectorBinding} required />}
          {worldUpdate && <div><h3>世界更新预览</h3><p>保留手工修改；不会直接删除本次未出现的旧条目。</p><ul>{worldDiff.slice(0, 100).map((line, index) => <li key={index}>{line}</li>)}</ul>{!worldDiff.length && <p>没有需要替换的生成内容。</p>}<button onClick={() => { onUpdateWorld?.(worldUpdate); setWorldUpdate(undefined); setMessage('世界资料更新已应用。'); }}>应用到已有世界</button><button onClick={() => setWorldUpdate(undefined)}>保留当前世界</button></div>}</section> : <p>导入小说并准备世界资料后，在这里创建世界。</p>)}
        {evidence && <aside className="novel-workbench-evidence" aria-label="原文依据"><div className="novel-workbench-section-header"><h3>{evidenceChapter?.title ?? '来源章节不存在'}</h3><button onClick={() => setEvidence(undefined)} aria-label="关闭原文依据"><X size={16} /></button></div><blockquote>{evidence.excerpt}</blockquote><small>来源区间：{evidence.chapterStartOffset ?? evidence.startOffset}—{evidence.chapterEndOffset ?? evidence.endOffset} · {evidence.confidence === 'explicit' ? '明确事实' : '推断'}</small>{evidenceChapter && <><p className="novel-workbench-prose">{(() => { const at = evidenceChapter.content.indexOf(evidence.excerpt); return at < 0 ? '摘录与当前原文不匹配，请核对来源版本。' : evidenceChapter.content.slice(Math.max(0, at - 250), at + evidence.excerpt.length + 250); })()}</p><button onClick={() => { setChapterIndex(dataset!.chapters.indexOf(evidenceChapter)); setTab(0); setEvidence(undefined); }}>打开完整章节</button></>}</aside>}
      </main><footer className="novel-import-workbench__footer"><span>{dataset ? `${dataset.title} · ${fullReady ? '全书完成' : label(dataset.analysisStatus)}` : 'TXT / EPUB / JSON'}{isPausing ? ' · 正在保存检查点…' : ''}</span><div className="novel-import-workbench__footer-actions"><button className="novel-import-workbench__secondary novel-import-workbench__save-close" onClick={() => void close()} disabled={isPausing}>保存并关闭</button><div className="novel-import-workbench__footer-primary">{isAnalyzing ? <button className="novel-import-workbench__secondary" onClick={() => void pause()} disabled={isPausing}><Pause size={16} />暂停</button> : <><button className="novel-import-workbench__primary" disabled={!dataset?.segments.length || busy || !apiReady} onClick={() => void startAnalysis()}><Sparkles size={16} />开始／继续拆解</button>{!!generated.length && !!dataset?.segments.length && <button className="novel-import-workbench__secondary" disabled={!apiReady || busy} onClick={() => void startAnalysis(true)}>重新归并资料</button>}{!!evidenceCompleted && <button className="novel-import-workbench__secondary" disabled={!apiReady || busy} onClick={() => void startAnalysis(false, true)} title="忽略已提取的证据，重新调用模型提取全部段落的证据">重新提取证据</button>}</>}</div></div></footer>
    </div></DawnFrameV4>
  </div>;
}

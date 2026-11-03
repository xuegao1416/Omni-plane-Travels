import { useEffect,useMemo,useRef,useState } from 'react';
import { ArrowLeft,ArrowRight,BookOpen,Check,Download,Pause,Upload,X } from 'lucide-react';
import type { WorldDef } from '../../data/worlds-schema';
import { DEFAULT_LOCAL_EMBEDDING_MODEL,createEmbeddingClient } from '../../memory/embeddingRuntime';
import { useMemoryStore } from '../../memory/memoryStore';
import { NOVEL_ANALYSIS_VERSION,runNovelAnalysis,type NovelAnalysisProgress } from '../../novel/analysisRunner';
import { copyNovelDataset,importNovelDataset } from '../../novel/datasetImport';
import { createNovelDatasetFromEpub } from '../../novel/epubImport';
import { deleteNovelDataset,getNovelDataset,listNovelDatasets,listNovelJobs,saveNovelDataset,saveNovelDatasetHeader,novelRecoveryRevision } from '../../novel/novelStore';
import { editNovelMaterial,novelMaterialConflicts,novelMaterialFieldLabel,resolveNovelMaterialConflict } from '../../novel/materialDocument';
import { createNovelDatasetFromBytes,type NovelTextEncoding } from '../../novel/plainText';
import { probeNovelEmbedding } from '../../novel/semanticIndex';
import { buildNovelTaskPlan } from '../../novel/taskPlan';
import type { NovelAnalysisGoal,NovelDataset,NovelEvidenceRef,NovelMaterialField,NovelStaticMaterial } from '../../novel/types';
import { canCreateNovelWorld,mergeNovelChapterWithPrevious,rebuildNovelDatasetSegments,renameNovelChapter,splitNovelChapter } from '../../novel/workbenchState';
import { createNovelBackgroundWorld,createWorldFromNovel,regenerateNovelWorldMaterial } from '../../novel/worldFactory';
import { buildNovelWorldBookEntries } from '../../novel/worldBookAdapter';
import { useNovelConfigStore } from '../../stores/novelConfigStore';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useDialog } from '../shared/Dialog';
import { NovelConnectionSettings } from './novelWorkbench/NovelConnectionSettings';
import { nextWorkflowAction,resumeWorkflow,WORKFLOW_STEPS,type WorkflowState } from './novelWorkbench/workflow';
import { defaultReadingOptions,describeReadingRange,prepareNovelReading,readingRangeLabel,readingScope,type ReadingScope } from './novelWorkbench/readingRange';
import { NovelReadingRange } from './novelWorkbench/NovelReadingRange';
import './novelWorkbench/workbench.css';
import DirectorAuthorEditor, { type DirectorWorkflowActions,type DirectorWorkflowState } from './worldEditorForm/DirectorAuthorEditor';
import { collectDirectorDependencies, restoreDirectorDependencies } from '../../director/dependencies';
import { deleteDirectorWorkspace } from '../../director/definitionStore';
import { exportNovelRecoveryPackage, parseNovelRecoveryPackage, restoreNovelRecoveryPackage, importNovelPaidProductPackage } from '../../novel/paidProductTransfer';

interface NovelImportWorkbenchProps { onClose: () => void; onCreateWorld: (world: WorldDef) => void; worlds?: WorldDef[]; onUpdateWorld?: (world: WorldDef) => void }
const PAGE_SIZE = 20;
const CATEGORIES: Record<string, string> = { setting: '背景', rules: '规则', npcs: '人物', factions: '势力', lore: '地点', items: '物品', culture: '文化', economy: '经济与时间', custom: '其他' };
const STATUSES: Record<string, string> = { draft: '待分析', processing: '处理中', ready: '已完成', partial: '部分完成', failed: '失败', pending: '等待', completed: '完成', running: '运行中', paused: '已暂停', off: '关闭', preparing: '准备中', enhanced: '已增强', degraded: '已降级', evidence: '原文证据', overview: '世界归并', segments: '剧情编译' };
const label = (status?: string) => status ? STATUSES[status] ?? status : '尚未开始';
function downloadJson(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name.replace(/[\\/:*?"<>|]/g, '_'); anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function previewJson(value: unknown): string {
  const text = typeof value === 'string' ? value : value === undefined ? '（无内容）' : JSON.stringify(value);
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}
function Pager({ page, count, onChange }: { page: number; count: number; onChange: (value: number) => void }) {
  const last = Math.max(0, Math.ceil(count / PAGE_SIZE) - 1);
  return <nav className="novel-workbench-pager" aria-label="列表分页"><button disabled={page <= 0} onClick={() => onChange(page - 1)}>上一页</button><span>{count} 项 · {page + 1}/{last + 1} 页</span><button disabled={page >= last} onClick={() => onChange(page + 1)}>下一页</button></nav>;
}

export function NovelImportWorkbench({ onClose, onCreateWorld, worlds = [], onUpdateWorld }: NovelImportWorkbenchProps) {
  useBodyScrollLock(true);
  const dialog = useDialog();
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
  const [failedOnly, setFailedOnly] = useState(false);
  const [mode, setMode] = useState<'auto' | 'single_chapter' | 'custom'>('auto'), [maxTokens, setMaxTokens] = useState(6000);
  const [scope, setScope] = useState<ReadingScope>('sample');
  const [rangeStart, setRangeStart] = useState(0), [rangeEnd, setRangeEnd] = useState(0), [sourceFile, setSourceFile] = useState<File>();
  const [pendingImport, setPendingImport] = useState<{ dataset: NovelDataset; world?: WorldDef }>();
  const [pendingRecovery, setPendingRecovery] = useState<{ text: string; revision: string }>();
  const [search, setSearch] = useState(''), [category, setCategory] = useState('all'), [archivePage, setArchivePage] = useState(0), [conflictsOnly, setConflictsOnly] = useState(false);
  const [materialDraft, setMaterialDraft] = useState<string>();
  const [goal, setGoal] = useState<NovelAnalysisGoal>('background');
  const [helpOpen, setHelpOpen] = useState(false);
  const bodyRef = useRef<HTMLElement>(null);
  const connectionRef = useRef<HTMLDivElement>(null), rangeRef = useRef<HTMLDivElement>(null), evidenceRef = useRef<HTMLElement>(null);
  const directorActions = useRef<DirectorWorkflowActions>(null);
  const [directorState, setDirectorState] = useState<DirectorWorkflowState>({ busy: false, hasDraft: false });
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const goTo = (next: number) => { setTab(next); setEvidence(undefined); bodyRef.current?.scrollTo({ top: 0 }); };
  const [channels, setChannels] = useState<string[]>([]);
  const [overviewPending, setOverviewPending] = useState(false);
  const [embeddingState, setEmbeddingState] = useState('off'), [probing, setProbing] = useState(false);
  const [evidence, setEvidence] = useState<NovelEvidenceRef>();
  useEffect(() => { if (evidence) evidenceRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, [evidence]);
  const [worldUpdate, setWorldUpdate] = useState<WorldDef>(), [worldDiff, setWorldDiff] = useState<string[]>([]);
  const [directorBinding, setDirectorBinding] = useState<WorldDef['directorSource']>();
  const busy = isAnalyzing || isReading || isPausing;
  const apiReady = Boolean(config.api.baseUrl.trim() && config.api.model.trim());
  const readingOptions = useMemo(() => ({ mode, maxTokens, startChapterIndex: rangeStart, endChapterIndex: rangeEnd }), [mode, maxTokens, rangeStart, rangeEnd]);
  const chooseScope = (nextScope: ReadingScope) => {
    if (!dataset || busy) return;
    setScope(nextScope);
    setMode(nextScope === 'all' ? 'auto' : 'custom');
    if (nextScope !== 'custom') { setRangeStart(0); setRangeEnd(nextScope === 'sample' ? Math.min(9, dataset.chapters.length - 1) : dataset.chapters.length - 1); }
  };

  useEffect(() => { void useNovelConfigStore.getState().initialize().catch(error => setMessage(`配置读取失败：${String(error)}`)); void listNovelDatasets().then(setRecent).catch(error => setMessage(`资料列表读取失败：${String(error)}`)); return () => abortRef.current?.abort(); }, []);
  useEffect(() => setEmbeddingState(config.embeddingMode === 'off' ? 'off' : '未测试'), [config, memoryConfig]);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialogRef.current?.focus(); return () => previous?.focus(); }, []);
  const pause = async () => { setIsPausing(true); abortRef.current?.abort(); await runRef.current?.catch(() => undefined); setIsPausing(false); };
  const close = async () => { await pause(); onClose(); };
  const keyboard = (event: React.KeyboardEvent) => {
    if (dialog.isOpen) return;
    if (event.key === 'Escape') { event.preventDefault(); void close(); }
    if (event.key !== 'Tab') return;
    const nodes = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,a[href]') ?? [])].filter(node => node.offsetParent !== null);
    if (event.shiftKey && (document.activeElement === nodes[0] || document.activeElement === dialogRef.current)) { event.preventDefault(); nodes.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0]?.focus(); }
  };
  const openDataset = async (requested: NovelDataset, resume = true) => {
    try {
      const next = await getNovelDataset(requested.id) ?? requested, jobs = await listNovelJobs(next.id), latestJob = jobs[0];
      setDataset(next); setTitle(next.title); setChapterIndex(0); setChapterPage(0); setSegmentPage(0); setArchivePage(0); setPlotIndex(0); setEvidence(undefined); setMaterialDraft(undefined);
      setChapterSearch(''); setSearch(''); setCategory('all'); setConflictsOnly(false);
      setWorldUpdate(undefined); setWorldDiff([]);
      setFailedOnly(false);
      setChannels(jobs.map(job => job.configFingerprint).filter((value): value is string => Boolean(value)));
      setGoal(latestJob?.goal ?? 'background'); setOverviewPending(Boolean(latestJob?.overviewRefreshPending));
      setDirectorBinding(worlds.find(world => world.novelSource?.datasetId === next.id)?.directorSource);
      const options = defaultReadingOptions(next);
      setMode(options.mode); setMaxTokens(options.maxTokens); setScope(readingScope(options, next.chapters.length));
      setRangeStart(options.startChapterIndex); setRangeEnd(options.endChapterIndex); setStartSegmentIndex(Math.min(latestJob?.startSegmentIndex ?? 0, Math.max(0, next.segments.length - 1))); setProgress(undefined);
      setMessage(`已载入《${next.title}》。${next.chapters.length ? '可继续分析或审查已有资料。' : '这是静态资料档案；没有原文，不能重新拆解。'}`);
      if (resume) {
        const nextGoal = latestJob?.goal ?? 'background';
        const nextChannels = jobs.flatMap(job => job.configFingerprint ? [job.configFingerprint] : []);
        const nextPlan = next.segments.length ? buildNovelTaskPlan(next, { goal: nextGoal, config: config.api, preset: config.analysisPreset, channels: nextChannels, forceOverview: Boolean(latestJob?.overviewRefreshPending), retrieval: embedding?.identity ?? 'basic' }) : undefined;
        goTo(resumeWorkflow({ hasDataset: true, hasSource: !!next.chapters.length, hasSegments: !!next.segments.length, hasMaterial: !!buildNovelWorldBookEntries(next.staticMaterial, 1).length, apiReady, analysisPending: Boolean(nextPlan?.requests.min), worldReady: canCreateNovelWorld(next, 0), hasDirector: false, goal: nextGoal }));
      }
    } catch (error) { setMessage(`载入失败：${String(error)}`); }
  };
  const acceptImport = async (next: NovelDataset, world?: WorldDef, original?: NovelDataset) => {
    try {
      await saveNovelDataset(next); await openDataset(next, false); setRecent(await listNovelDatasets()); setPendingImport(undefined); setTab(0);
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
  const removeDataset = async () => {
    if (!dataset || busy) return;
    const warning = linkedWorlds.length ? `\n正在使用这份资料的世界：${linkedWorlds.map(world => world.name).join('、')}。移除后将失去小说来源和对应主线剧情。` : '';
    if (!await dialog.confirm(`确定移除《${dataset.title}》吗？会删除本地原文、拆解结果和剧情整理草稿。移除前自动下载原文与成果恢复备份，请保留该 JSON。${warning}`, { title: '确认移除小说资料', confirmText: '确认移除', cancelText: '取消', danger: true })) return;
    setIsReading(true);
    setMessage(`正在备份并移除《${dataset.title}》…`);
    try {
      const target = await getNovelDataset(dataset.id) ?? dataset;
      const recovery = await exportNovelRecoveryPackage(target);
      downloadJson(JSON.parse(recovery), `${target.title}-移除前恢复备份.json`);
      await deleteNovelDataset(target.id);
      await deleteDirectorWorkspace(`novel-director:${target.id}`);
      setDataset(undefined); setTitle(''); setEvidence(undefined); setMaterialDraft(undefined); setProgress(undefined);
      setChapterIndex(0); setChapterPage(0); setSegmentPage(0); setPlotIndex(0); setArchivePage(0); setSourceFile(undefined);
      setDirectorBinding(undefined); setWorldUpdate(undefined); setWorldDiff([]);
      setRecent(await listNovelDatasets());
      setMessage(`《${target.title}》已从本地移除，已发起下载移除前恢复备份；请保留该 JSON，需要恢复时重新导入。`);
      goTo(0);
    } catch (error) { setMessage(`删除失败：${String(error)}`); }
    finally { setIsReading(false); }
  };
  const loadFile = async (file?: File, encoding?: NovelTextEncoding) => {
    if (!file || busy) return;
    setIsReading(true); setMessage(`正在读取《${file.name}》…`);
    try {
      const extension = file.name.toLowerCase().split('.').pop(); let next: NovelDataset; let world: WorldDef | undefined;
      if (extension === 'epub') next = await createNovelDatasetFromEpub(file.name, await file.arrayBuffer());
      else if (extension === 'json') {
        const text = await file.text(), raw = JSON.parse(text);
        if (raw.format === 'omni-novel-recovery') {
          const recovery = parseNovelRecoveryPackage(text), existing = await getNovelDataset(recovery.dataset.id);
          if (existing) { setPendingRecovery({ text, revision: novelRecoveryRevision(existing) }); setMessage('本机已有这份小说资料。可只补回付费成果，或明确使用备份恢复资料。'); }
          else { await restoreNovelRecoveryPackage(text); await openDataset(recovery.dataset); setRecent(await listNovelDatasets()); setMessage('原文、作者资料、付费成果和任务进度已恢复；继续时复用已有成果。'); }
          return;
        }
        if (raw.kind === 'novel-world-package' && raw.dataset && raw.world) { next = importNovelDataset(raw.dataset); await restoreDirectorDependencies({ customWorld: raw.world }, raw.directorDefinitions); world = raw.world as WorldDef; } else next = importNovelDataset(raw);
      }
      else if (extension === 'txt') next = createNovelDatasetFromBytes(file.name.replace(/\.[^.]+$/, ''), await file.arrayBuffer(), encoding);
      else throw new Error('请选择 TXT、EPUB 或拆解资料 JSON。');
      setSourceFile(extension === 'txt' ? file : undefined);
      if (await getNovelDataset(next.id)) { setPendingImport({ dataset: next, world }); setMessage('已有同一资料档案。默认导入为副本，也可以明确更新原资料。'); }
      else await acceptImport(next, world);
    } catch (error) { setMessage(`导入失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setIsReading(false); }
  };
  const restoreRecovery = async (productsOnly: boolean) => {
    if (!pendingRecovery || busy) return;
    setIsReading(true);
    try {
      const parsed = parseNovelRecoveryPackage(pendingRecovery.text);
      if (productsOnly) await importNovelPaidProductPackage(parsed.paidProducts, parsed.dataset.id);
      else await restoreNovelRecoveryPackage(pendingRecovery.text, pendingRecovery.revision);
      await openDataset(parsed.dataset); setRecent(await listNovelDatasets()); setPendingRecovery(undefined);
      setMessage(productsOnly ? '已补回付费成果，本机原文和作者修改保留。' : '资料与付费成果已一起恢复。');
    } catch (error) { setMessage(`恢复失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setIsReading(false); }
  };
  const exportRecovery = async () => {
    if (!dataset) return;
    try { const latest = await getNovelDataset(dataset.id) ?? dataset; downloadJson(JSON.parse(await exportNovelRecoveryPackage(latest)), `${latest.title}-恢复备份.json`); }
    catch (error) { setMessage(`备份失败：${error instanceof Error ? error.message : String(error)}`); }
  };
  const replaceStructure = async (chapters: NovelDataset['chapters']) => {
    if (!dataset || busy) return;
    try {
      const next = rebuildNovelDatasetSegments(dataset, chapters, { mode, maxTokens, startChapterIndex: mode === 'custom' ? rangeStart : 0, endChapterIndex: mode === 'custom' ? rangeEnd : Math.max(0, chapters.length - 1) });
      await saveNovelDataset(next); setDataset(next); setStartSegmentIndex(0); setPlotIndex(0); setProgress(undefined); setChapterIndex(index => Math.min(index, Math.max(0, chapters.length - 1)));
      setMessage('处理范围与请求预算已保存；预算变化保留语义资料和已完成结果。');
    } catch (error) { setMessage(`章节保存失败：${String(error)}`); }
  };
  const embedding = useMemo(() => {
    if (config.embeddingMode === 'off') return undefined;
    const runtime = config.embeddingMode === 'local_endpoint' ? { ...memoryConfig, vectorEnabled: true, vectorRuntime: 'local_endpoint' as const, localEmbeddingEndpoint: config.embeddingEndpoint, localEmbeddingModelId: config.embeddingModel } : { ...memoryConfig, vectorEnabled: true };
    const model = runtime.vectorRuntime === 'remote' ? runtime.vectorApiModel.trim() : runtime.localEmbeddingModelId?.trim() || DEFAULT_LOCAL_EMBEDDING_MODEL;
    return { client: createEmbeddingClient(runtime), model, identity: `${runtime.vectorRuntime}:${runtime.vectorRuntime === 'local_endpoint' ? runtime.localEmbeddingEndpoint : runtime.vectorRuntime === 'remote' ? runtime.vectorApiUrl : 'browser'}:${model}`, rateLimitMs: config.embeddingRateLimitMs };
  }, [config.embeddingMode, config.embeddingEndpoint, config.embeddingModel, config.embeddingRateLimitMs, memoryConfig]);
  const makeEmbedding = () => embedding;
  const testEmbedding = async () => {
    const embedding = makeEmbedding(); if (!embedding) return;
    setProbing(true); setEmbeddingState('preparing');
    try { const result = await probeNovelEmbedding(embedding.client); setEmbeddingState('连接通过'); setMessage(`真实 embedding 请求通过：${embedding.model}，${result.dimension} 维。全书索引尚未因此完成。`); }
    catch (error) { setEmbeddingState('degraded'); setMessage(`Embedding 不可用：${String(error)}；基础检索仍可继续。`); }
    finally { setProbing(false); }
  };
  const startAnalysis = async (regenerate = false, reExtractEvidence = false, retrySegments?: string | string[]) => {
    if (!dataset || busy || !apiReady) return;
    const retrySegmentIds = typeof retrySegments === 'string' ? [retrySegments] : retrySegments;
    const controller = new AbortController(); abortRef.current = controller; setIsAnalyzing(true); setTab(1);
    try {
      const stored = await getNovelDataset(dataset.id) ?? dataset;
      const latest = stored.chapters.length ? prepareNovelReading(stored, readingOptions) : stored;
      const rangeChanged = latest.segments.length !== stored.segments.length || latest.segments.some((segment, index) => segment.id !== stored.segments[index]?.id);
      if (rangeChanged) await saveNovelDataset(latest);
      else if (JSON.stringify(latest.taskPreparation) !== JSON.stringify(stored.taskPreparation)) await saveNovelDatasetHeader(latest);
      setDataset(latest);
      if (rangeChanged) { setStartSegmentIndex(0); setPlotIndex(0); setSegmentPage(0); setProgress(undefined); }
      const runStartIndex = rangeChanged ? 0 : startSegmentIndex;
      const previousMaterial = structuredClone(latest.staticMaterial);
      const runGoal = retrySegmentIds && latest.segments.some(segment => retrySegmentIds.includes(segment.id) && segment.evidenceNotes) ? 'full' : goal;
      await saveNovelDatasetHeader({ ...latest, title: title.trim() || latest.title, updatedAt: Date.now() });
      setChannels((await listNovelJobs(dataset.id)).map(job => job.configFingerprint).filter((value): value is string => Boolean(value)));
      const run = runNovelAnalysis({ datasetId: dataset.id, config: { ...config.api, rateLimitMs: config.analysisRateLimitMs }, preset: config.analysisPreset, startSegmentIndex: runStartIndex, goal: runGoal, retrySegmentIds, embedding: makeEmbedding(), forceOverview: regenerate, reExtractEvidence, signal: controller.signal, onCheckpoint: setDataset, onProgress: value => { setProgress(value); setMessage(value.message); if (value.embeddingStatus) setEmbeddingState(value.embeddingStatus); } });
      runRef.current = run; const result = await run; setDataset(result.dataset); setOverviewPending(Boolean(result.job.overviewRefreshPending)); setRecent(await listNovelDatasets());
      if (result.job.embeddingStatus) setEmbeddingState(result.job.embeddingStatus);
      if (regenerate && !result.dataset.overviewError) {
        const existing = worlds.find(world => world.novelSource?.datasetId === result.dataset.id);
        if (existing && onUpdateWorld) { const updated = regenerateNovelWorldMaterial(existing, result.dataset, result.dataset.legacyStaticMaterial ?? previousMaterial); setWorldUpdate(updated); const before = new Map(existing.worldBookEntries?.map(entry => [entry.uid, entry])); setWorldDiff((updated.worldBookEntries ?? []).flatMap(entry => { const original = before.get(entry.uid); return !original ? [`新增：${entry.comment}`] : original.content !== entry.content ? [`更新：${entry.comment}`] : []; })); }
      }
      const retryFailures = retrySegmentIds ? result.dataset.segments.filter(segment => retrySegmentIds.includes(segment.id) && (segment.status === 'failed' || segment.evidenceStatus === 'failed')).length : 0;
      setMessage(result.job.status === 'paused' ? '已暂停并保存检查点，可继续未完成部分。' : retrySegmentIds ? retryFailures ? `重试结果已保存，所选分段仍有 ${retryFailures} 段失败，请查看错误信息。` : `${Array.isArray(retrySegments) ? '批量' : '本段'}重试完成，其他分段保持原有进度。` : goal === 'background' && result.job.status === 'completed' ? '人物与世界设定已保存。可以查看资料，然后创建自由游玩世界。' : result.dataset.analysisStatus === 'ready' ? '全书拆解完成，可审查资料并创建世界。' : '已保存当前结果；尚有未处理、失败或排除内容，请查看覆盖情况。');
      if (result.job.status === 'completed' && !retrySegmentIds && !regenerate && !reExtractEvidence && tabRef.current === 1 && buildNovelWorldBookEntries(result.dataset.staticMaterial, 1).length) goTo(2);
    } catch (error) { const latest = await getNovelDataset(dataset.id).catch(() => undefined); if (latest) setDataset(latest); setOverviewPending(Boolean((await listNovelJobs(dataset.id).catch(() => [])).find(job => job.goal === goal)?.overviewRefreshPending)); setMessage(`拆解未完成：${error instanceof Error ? error.message : String(error)}`); }
    finally { abortRef.current = null; runRef.current = null; setIsAnalyzing(false); }
  };
  const createWorld = async (backgroundOnly = false) => {
    if (!dataset) return;
    try {
      const latest = await getNovelDataset(dataset.id) ?? dataset, next = { ...latest, title: title.trim() || latest.title, updatedAt: Date.now() };
      if (backgroundOnly) {
        const background = createNovelBackgroundWorld(next);
        await saveNovelDatasetHeader(next);
        onCreateWorld(worlds.find(world => world.id === background.id) ?? background);
        return;
      }
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
    try { const material = JSON.parse(materialDraft) as NovelStaticMaterial; if (!material || Array.isArray(material) || typeof material !== 'object') throw new Error('资料必须是 JSON 对象。'); const normalized = importNovelDataset({ ...dataset, materialDocument: undefined, staticMaterial: material }), next = editNovelMaterial({ ...dataset, updatedAt: Date.now() }, normalized.staticMaterial); await saveNovelDatasetHeader(next); setDataset(next); setMaterialDraft(undefined); setMessage('人工修改已保存为覆盖层，重新归并不会覆盖它。'); }
    catch (error) { setMessage(`资料保存失败：${String(error)}`); }
  };
  const evidenceButton = (ref: NovelEvidenceRef, index: number) => <button key={`${ref.chapterId}-${ref.startOffset}-${index}`} type="button" className="novel-workbench-source-link" onClick={() => setEvidence(ref)}>{dataset?.chapters.find(chapter => chapter.id === ref.chapterId)?.title ?? '原文来源'}：{ref.excerpt.slice(0, 70)}</button>;
  const resolveConflict = async (field: NovelMaterialField, choice: 'author' | 'generated') => {
    if (!dataset || busy) return;
    try {
      const latest = await getNovelDataset(dataset.id) ?? dataset, next = resolveNovelMaterialConflict(latest, field, choice);
      await saveNovelDatasetHeader(next); setDataset(next);
      setMessage(choice === 'generated' ? '已采用本次生成的资料。' : '已保留你的修改，新版本作为下次对比基准。');
    } catch (error) { setMessage(`冲突处理失败：${String(error)}`); }
  };
  const chapter = dataset?.chapters[chapterIndex], plot = dataset?.segments[plotIndex];
  const linkedWorlds = dataset ? worlds.filter(world => world.novelSource?.datasetId === dataset.id) : [];
  const chapters = useMemo(() => (dataset?.chapters ?? []).map((chapter, index) => ({ chapter, index })).filter(({ chapter }) => !chapterSearch || `${chapter.title} ${chapter.volumeTitle ?? ''}`.includes(chapterSearch)), [dataset?.chapters, chapterSearch]);
  const generated = useMemo(() => dataset ? buildNovelWorldBookEntries(dataset.staticMaterial, 1) : [], [dataset?.staticMaterial]);
  const readingSelection = useMemo(() => dataset?.chapters.length ? describeReadingRange(dataset, readingOptions) : undefined, [dataset, readingOptions]);
  const readingDataset = useMemo(() => dataset && readingSelection?.range ? prepareNovelReading(dataset, readingOptions) : dataset, [dataset, readingOptions, readingSelection]);
  const analysisDataset = tab === 1 ? readingDataset : dataset;
  const analysisSegments = analysisDataset?.segments ?? [];
  const savedReading = useMemo(() => dataset?.chapters.length ? describeReadingRange(dataset, dataset.taskPreparation ?? { mode: 'auto', maxTokens: 6000, startChapterIndex: 0, endChapterIndex: dataset.chapters.length - 1 }) : undefined, [dataset]);
  const archives = dataset ? [...(dataset.staticMaterial.characters ?? []), ...(dataset.staticMaterial.factions ?? []), ...(dataset.staticMaterial.locations ?? []), ...(dataset.staticMaterial.items ?? [])] : [];
  const entries = generated.filter(entry => (category === 'all' || entry.entryType === category) && (!search || `${entry.comment} ${entry.content} ${entry.key?.join(' ')}`.includes(search)) && (!conflictsOnly || archives.some(archive => archive.conflict && entry.comment.includes(archive.name))));
  const completed = analysisSegments.filter(segment => segment.status === 'completed' && segment.analysisVersion === NOVEL_ANALYSIS_VERSION).length;
  const evidenceCompleted = analysisSegments.filter(segment => segment.evidenceNotes).length;
  const failedSegments = analysisSegments.filter(segment => segment.status === 'failed' || segment.evidenceStatus === 'failed');
  const checkpointSegments = analysisSegments.filter(segment => !failedOnly || segment.status === 'failed' || segment.evidenceStatus === 'failed');
  const checkpointPage = Math.min(segmentPage, Math.max(0, Math.ceil(checkpointSegments.length / PAGE_SIZE) - 1));
  const conflicts = useMemo(() => dataset ? novelMaterialConflicts(dataset) : [], [dataset]);
  const plan = useMemo(() => analysisDataset?.segments.length ? buildNovelTaskPlan(analysisDataset, { goal, config: config.api, preset: config.analysisPreset, channels, forceOverview: overviewPending, retrieval: embedding?.identity ?? 'basic' }) : undefined, [analysisDataset, goal, config.api, config.analysisPreset, channels, embedding, overviewPending]);
  const staticOnly = Boolean(dataset && !dataset.chapters.length && generated.length), worldReady = staticOnly || canCreateNovelWorld(dataset, startSegmentIndex);
  const evidenceChapter = dataset?.chapters.find(chapter => chapter.id === evidence?.chapterId);
  const workflow: WorkflowState = { hasDataset: !!dataset, hasSource: !!dataset?.chapters.length, hasSegments: !!analysisSegments.length, hasMaterial: !!generated.length, apiReady, analysisPending: Boolean(plan?.requests.min), failedSegmentCount: failedSegments.length, worldReady, hasDirector: !!directorBinding, goal, readingRange: readingSelection?.range, readingRangeError: readingSelection?.error };
  const next = nextWorkflowAction(tab, workflow);
  const directorBusy = tab === 4 && goal === 'full' && directorState.busy;
  const primaryLabel = directorBusy ? '正在整理或保存剧情…' : next.action === 'director' ? directorState.hasDraft ? '保存剧情版本并选用' : '整理开局剧情' : next.label;
  const stepIndex = tab === 3 ? 2 : WORKFLOW_STEPS.findIndex(step => step.tab === tab);
  const step = WORKFLOW_STEPS[stepIndex];
  const stepDone = [!!dataset, !!generated.length && !workflow.analysisPending, !!generated.length, linkedWorlds.some(world => goal === 'background' ? world.id === `novel_${dataset?.id}_background` : world.id !== `novel_${dataset?.id}_background`)];
  const runNext = () => {
    switch (next.action) {
      case 'import': if (!dataset || !dataset.chapters.length) inputRef.current?.click(); goTo(0); break;
      case 'read': goTo(1); break;
      case 'range': goTo(1); requestAnimationFrame(() => { rangeRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); rangeRef.current?.querySelector<HTMLInputElement>('input')?.focus(); }); break;
      case 'settings': goTo(1); requestAnimationFrame(() => { connectionRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); connectionRef.current?.querySelector<HTMLInputElement>('input')?.focus(); }); break;
      case 'analyze': void startAnalysis(); break;
      case 'retry': void startAnalysis(false, false, failedSegments.map(segment => segment.id)); break;
      case 'review': goTo(2); break;
      case 'prepare': goTo(4); break;
      case 'director': if (directorState.hasDraft) directorActions.current?.save(); else directorActions.current?.compile(); break;
      case 'create': void createWorld(goal === 'background'); break;
    }
  };
  return <div className="novel-import-workbench" role="dialog" aria-modal="true" aria-labelledby="novel-import-workbench-title" ref={dialogRef} tabIndex={-1} onKeyDown={keyboard}>
    {dialog.DialogUI}
    <div className="novel-import-workbench__backdrop" aria-hidden="true" />
    <section className="novel-import-workbench__frame"><div className="novel-import-workbench__layout">
      <header className="novel-import-workbench__header"><div className="novel-import-workbench__heading"><BookOpen size={24} /><div><h2 id="novel-import-workbench-title">小说拆解台</h2><p>{dataset ? `正在处理《${dataset.title}》` : '把喜欢的小说，变成你能玩的世界'}</p></div></div><div className="novel-workbench-tools">{dataset && <button onClick={() => void exportRecovery()} disabled={isReading || isPausing}><Download size={16} />备份</button>}<button aria-expanded={helpOpen} aria-controls="novel-workbench-help" onClick={() => setHelpOpen(!helpOpen)}>怎么开始玩？</button><button className="novel-import-workbench__close" onClick={() => void close()} disabled={isPausing} aria-label="保存进度并关闭"><X size={20} /></button></div></header>
      <div className="novel-workbench-workspace">
      <aside className="novel-workbench-sidebar"><nav className="novel-workbench-steps" aria-label="小说拆解步骤">{WORKFLOW_STEPS.map((item, index) => <button key={item.tab} type="button" aria-current={stepIndex === index ? 'step' : undefined} className={stepIndex === index ? 'is-active' : ''} onClick={() => goTo(item.tab)}><span className="novel-workbench-step-number">{stepDone[index] && stepIndex !== index ? <Check size={17} /> : index + 1}</span><span><strong>{item.title}</strong><small>{item.description}</small></span></button>)}</nav><p className="novel-workbench-sidebar-note">进度自动保存。中途退出后，选择已有小说即可继续。</p></aside>
      <main className="novel-import-workbench__body" ref={bodyRef} data-step={stepIndex}>
        {helpOpen && <section className="novel-import-workbench__panel" id="novel-workbench-help"><h3>从小说到开局，只走这四步</h3><ol><li>上传小说，检查正文有没有乱码。</li><li>先选择前 10 章、自选范围或整本。保存 AI 配置，再点「开始拆解第…章」。</li><li>看人物、地点和设定的效果。不满意或内容不够，可以继续增加章节。</li><li>不必等全书拆完。已有资料即可创建自由世界；原作玩法还需整理并保存开局剧情。</li></ol><p>创建后回到大厅选择世界，填写角色并开始冒险。AI 读取和剧情整理会产生接口费用。</p></section>}
        <div className="novel-workbench-page-heading"><span>第 {stepIndex + 1} 步 / 4</span><h3>{tab === 1 ? '先拆一点，看看效果' : tab === 2 || tab === 3 ? '小说里的人物和设定' : tab === 4 ? '用这些资料开始玩' : step.title}</h3>{stepIndex !== 2 && <p>{isAnalyzing ? 'AI 正在读取小说。你可以查看已有内容，或暂停后稍后继续。' : next.description}</p>}</div>
        <p className={`novel-import-workbench__status${/失败|未完成|不可用/.test(message) ? ' is-error' : ''}`} role="status">{message}</p>
        {tab === 1 && !!failedSegments.length && <section className="novel-import-workbench__panel novel-workbench-retry-banner"><h3>有 {failedSegments.length} 个分段读取失败</h3><p>批量重试覆盖当前章节范围的所有页，无需逐段点击。已完成的成果会保留。{isAnalyzing ? '请先点底部「暂停并保存」，再批量重试。' : ''}</p><div className="novel-import-workbench__structure-actions"><button className="novel-import-workbench__primary" disabled={busy || !apiReady || !!readingSelection?.error} onClick={() => void startAnalysis(false, false, failedSegments.map(segment => segment.id))}>批量重试全部失败（{failedSegments.length}）</button><button disabled={busy || !apiReady || !!readingSelection?.error} onClick={() => void startAnalysis()}>继续读取未完成内容</button></div></section>}
        <input ref={inputRef} type="file" accept=".txt,.epub,.json" hidden onChange={e => { void loadFile(e.target.files?.[0]); e.target.value = ''; }} />
        {(tab === 2 || tab === 3) && <div className="novel-workbench-result-tabs" role="group" aria-label="资料内容"><button aria-pressed={tab === 2} onClick={() => goTo(2)}>人物与世界设定 · {generated.length}</button><button aria-pressed={tab === 3} onClick={() => goTo(3)}>原作故事 · {completed} 段已完成</button></div>}
        {(tab === 2 || tab === 3 || tab === 4) && savedReading?.range && <section className="novel-workbench-current-range">
          <strong>当前任务：{readingRangeLabel(savedReading.range)} · 全书 {savedReading.range.chapterCount.toLocaleString()} 章</strong>
          <p>{goal === 'background' ? '不必等全书拆完，当前资料即可创建自由世界。' : '开场故事段读完并保存剧情后即可创建，不必等全书。'}</p>
          <div className="novel-import-workbench__structure-actions">{savedReading.range.endChapterIndex < savedReading.range.chapterCount - 1 && <button disabled={busy} onClick={() => { const range = savedReading.range!; setScope('custom'); setMode('custom'); setRangeStart(range.startChapterIndex); setRangeEnd(Math.min(range.endChapterIndex + 10, range.chapterCount - 1)); goTo(1); }}>再多拆 {Math.min(10, savedReading.range.chapterCount - savedReading.range.endChapterIndex - 1)} 章，先看范围</button>}<button disabled={busy} onClick={() => goTo(1)}>重新选择章节</button></div>
        </section>}
        {pendingRecovery && <section className="novel-import-workbench__panel"><h3>本机已有这份资料</h3><p>只补回付费成果会保留本机资料；完整恢复会用备份替换这份资料和任务进度。</p><div className="novel-import-workbench__structure-actions"><button autoFocus disabled={busy} onClick={() => void restoreRecovery(true)}>只补回付费成果</button><button disabled={busy} onClick={() => void restoreRecovery(false)}>用备份恢复资料</button><button disabled={busy} onClick={() => setPendingRecovery(undefined)}>取消</button></div></section>}
        {pendingImport && <section className="novel-import-workbench__panel"><h3>检测到相同资料 ID</h3><p>默认导入为副本保留现有资料。更新会使用导入文件替换原资料。</p><div className="novel-import-workbench__structure-actions"><button autoFocus onClick={() => void acceptImport(copyNovelDataset(pendingImport.dataset), pendingImport.world, pendingImport.dataset)}>作为副本（默认）</button><button onClick={() => void acceptImport(pendingImport.dataset, pendingImport.world)}>恢复／更新现有资料</button><button onClick={() => setPendingImport(undefined)}>取消导入</button></div></section>}
        {tab === 0 && <><section className="novel-import-workbench__step"><button type="button" className="novel-import-workbench__dropzone" disabled={busy} onClick={() => inputRef.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void loadFile(e.dataTransfer.files[0]); }}><Upload size={30} /><strong>{isReading ? '正在识别文件…' : dataset ? '更换或导入另一部小说' : '选择或拖入小说文件'}</strong><small>TXT / EPUB 小说 · JSON 资料或恢复备份</small></button>
          {!!recent.length && <section className="novel-workbench-library"><h3>继续已有小说</h3><p className="novel-import-workbench__hint">直接打开，继续上次进度。无需重新上传。</p><ul className="novel-workbench-select-list">{recent.map(item => <li key={item.id}><button disabled={busy} onClick={() => { setSourceFile(undefined); void openDataset(item); }}><BookOpen size={18} /><strong>{item.title}</strong><small>{label(item.analysisStatus)} · 已完成 {item.completedSegmentCount ?? 0}/{item.segmentCount ?? item.segments.length} 段{dataset?.id === item.id ? ' · 当前小说' : ''}</small><span>打开并继续 <ArrowRight size={14} /></span></button></li>)}</ul></section>}
          {dataset && <div className="novel-import-workbench__structure-actions"><button type="button" disabled={busy} onClick={() => void removeDataset()}>移除当前资料</button></div>}</section>
          {dataset && <><div className="novel-workbench-metrics"><span><b>{dataset.chapters.length}</b>章</span><span><b>{dataset.rawTextLength.toLocaleString()}</b>原文字符</span><span><b>{dataset.segments.length}</b>分析段</span><span><b>{dataset.importIssues?.length ?? 0}</b>导入提示</span></div>
            {sourceFile && <label className="novel-import-workbench__field">TXT 编码 · 当前 {dataset.encoding ?? '未知'}<select disabled={busy} value={dataset.encoding ?? ''} onChange={e => void loadFile(sourceFile, e.target.value as NovelTextEncoding || undefined)}><option value="">自动识别</option><option value="utf-8">UTF-8</option><option value="utf-16le">UTF-16 LE</option><option value="utf-16be">UTF-16 BE</option><option value="gb18030">GB18030 / GBK</option></select><small>切换编码重新导入新的来源，请先检查正文预览。</small></label>}
            {!!dataset.importIssues?.length && <details className="novel-import-workbench__segments" open><summary>导入报告 · {dataset.importIssues.length} 项</summary><ul>{dataset.importIssues.slice(0, 100).map((issue, index) => <li key={index}>{issue.severity === 'error' ? '无法读取：' : '请核对：'}{issue.message}{issue.chapterId && <button onClick={() => { const index = dataset.chapters.findIndex(chapter => chapter.id === issue.chapterId); if (index >= 0) setChapterIndex(index); }}>查看章节</button>}</li>)}</ul>{dataset.importIssues.length > 100 && <p>显示前 100 项，完整报告包含在资料导出中。</p>}</details>}
            {chapter ? <div className="novel-import-workbench__grid"><section className="novel-import-workbench__panel"><h3>章节目录</h3><label className="novel-import-workbench__field">搜索章节<input value={chapterSearch} onChange={e => { setChapterSearch(e.target.value); setChapterPage(0); }} placeholder="章节名称或卷名" /></label><ol className="novel-workbench-select-list">{chapters.slice(chapterPage * PAGE_SIZE, (chapterPage + 1) * PAGE_SIZE).map(({ chapter, index }) => <li key={chapter.id}><button className={chapterIndex === index ? 'is-active' : ''} onClick={() => setChapterIndex(index)}>{index + 1}. {chapter.title}<small>{chapter.included === false ? '已排除' : `${chapter.content.length} 字`}</small></button></li>)}</ol><Pager page={chapterPage} count={chapters.length} onChange={setChapterPage} /></section>
              <section className="novel-import-workbench__panel"><h3>正文预览与边界修正</h3><label className="novel-import-workbench__field">章节标题<input key={chapter.id + chapter.title} defaultValue={chapter.title} disabled={busy} onBlur={e => { if (e.target.value.trim() && e.target.value !== chapter.title) void replaceStructure(renameNovelChapter(dataset.chapters, chapterIndex, e.target.value)); }} /></label><label className="novel-workbench-checkbox"><input type="checkbox" checked={chapter.included !== false} disabled={busy} onChange={e => void replaceStructure(dataset.chapters.map((item, index) => index === chapterIndex ? { ...item, included: e.target.checked } : item))} />参与正文分析（简介、广告等可排除）</label><textarea ref={chapterPreviewRef} className="novel-workbench-original" readOnly value={chapter.content} aria-label="章节正文预览" /><div className="novel-import-workbench__structure-actions"><button disabled={busy || !chapterIndex} onClick={() => void replaceStructure(mergeNovelChapterWithPrevious(dataset.chapters, chapterIndex))}>合并至上一章</button><button disabled={busy} onClick={() => { const next = splitNovelChapter(dataset.chapters, chapterIndex, chapterPreviewRef.current?.selectionStart ?? 0); if (next.length === dataset.chapters.length) setMessage('请先在正文中间点选拆分位置。'); else void replaceStructure(next); }}>从光标拆分</button></div></section></div> : <p>该档案没有原文，可直接审查静态资料并创建世界。</p>}
          </>}</>}
        {tab === 1 && <>
          {!!dataset?.chapters.length && <div ref={rangeRef}><NovelReadingRange chapterCount={dataset.chapters.length} scope={scope} start={rangeStart} end={rangeEnd} disabled={busy} range={readingSelection?.range} error={readingSelection?.error} onScope={chooseScope} onStart={setRangeStart} onEnd={setRangeEnd} /></div>}
          <fieldset className="novel-import-workbench__panel novel-workbench-play-choice" disabled={busy}><legend>拆出来之后，你想怎么玩？</legend><div className="novel-workbench-route-cards"><label className={goal === 'background' ? 'is-selected' : ''}><input type="radio" name="novel-analysis-goal" checked={goal === 'background'} onChange={() => setGoal('background')} /><strong>只要人物和世界设定</strong><span>用书中的世界，开始自己的故事。</span><small>所选章节读出资料后就能创建，不必等全书</small></label><label className={goal === 'full' ? 'is-selected' : ''}><input type="radio" name="novel-analysis-goal" checked={goal === 'full'} onChange={() => setGoal('full')} /><strong>人物设定 + 原作故事</strong><span>连这几章的剧情一起拆，扮演书中人物。</span><small>再整理并保存开局剧情，即可创建世界</small></label></div></fieldset>
          <div ref={connectionRef}><NovelConnectionSettings disabled={busy} onMessage={setMessage} /></div>
          {plan && !readingSelection?.error && <section className="novel-import-workbench__panel"><h3>开始前确认一下</h3><p>{readingSelection?.range ? `${readingRangeLabel(readingSelection.range)} · 本次 ${readingSelection.range.selectedCount} 章 / 全书 ${readingSelection.range.chapterCount} 章` : '使用已有资料'} · 预计新增 AI 请求 {plan.requests.min} 次起</p><p className="novel-import-workbench__hint">点击底部「{next.label}」{next.action === 'analyze' ? '才会实际调用 AI。章节选择和参数会一起保存，不用再找“应用范围”按钮。' : '继续。'}暂停后会保留成果，继续读取只补做未完成内容。</p>{!!generated.length && <button onClick={() => goTo(2)}>先看已拆出的资料 <ArrowRight size={16} /></button>}</section>}
          <details className="novel-import-workbench__panel"><summary>每次请求的大小（通常不用改）</summary><label className="novel-import-workbench__field">每次请求最多使用多少原文 tokens？<input type="number" disabled={busy} min={1000} max={12000} step={500} value={maxTokens} onChange={e => setMaxTokens(Math.max(1000, Math.min(12000, Number(e.target.value) || 6000)))} /></label>{scope === 'all' && <label className="novel-workbench-checkbox"><input type="checkbox" disabled={busy} checked={mode === 'single_chapter'} onChange={event => setMode(event.target.checked ? 'single_chapter' : 'auto')} />每次请求不跨章节</label>}<p className="novel-import-workbench__hint">这个参数只影响请求大小。要先拆 10 章，在上面的章节选择中设置；开始拆解时参数一起生效。</p></details>
          {dataset ? <><div className="novel-workbench-metrics"><span><b>{evidenceCompleted}/{analysisSegments.length}</b>证据提取</span><span><b>{goal === 'full' ? `${completed}/${analysisSegments.length}` : generated.length}</b>{goal === 'full' ? '原作故事' : '世界资料'}</span><span><b>{analysisSegments.filter(item => item.status === 'failed' || item.evidenceStatus === 'failed').length}</b>失败分段</span><span><b>{goal === 'background' ? generated.length && !workflow.analysisPending ? '已读完' : '可继续读取' : generated.length && !workflow.analysisPending ? '本次已拆完' : '本次未拆完'}</b>{goal === 'background' ? '人物与设定' : '覆盖状态'}</span></div>{progress && <section className="novel-import-workbench__analysis-detail"><strong>{label(progress.phase)} · {progress.segmentTitle ?? '全书资料'}</strong><div className="novel-import-workbench__progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.completed}><span style={{ width: `${100 * progress.completed / Math.max(1, progress.total)}%` }} /></div><p>{progress.completed}/{progress.total} · {progress.message}</p><small>本次生成请求：{progress.requestCount ?? 0} 次（含重试）</small>{progress.streamText && <details><summary>当前响应预览</summary><pre>{progress.streamText.slice(-1600)}</pre></details>}</section>}{dataset.overviewError && <p role="alert">归并未完成：{dataset.overviewError}</p>}
            <section className="novel-import-workbench__panel"><div className="novel-workbench-section-header"><h3>逐段读取进度</h3><label className="novel-workbench-checkbox"><input type="checkbox" checked={failedOnly} onChange={event => { setFailedOnly(event.target.checked); setSegmentPage(0); }} />仅看失败</label></div>
              <p className="novel-import-workbench__hint">可单段或批量重试当前章节范围内的失败内容，保留已完成资料；其他未开始的分段不会因此读取。运行中请先暂停，再点重试。</p>
              <ol className="novel-workbench-select-list">{checkpointSegments.slice(checkpointPage * PAGE_SIZE, (checkpointPage + 1) * PAGE_SIZE).map(segment => <li key={segment.id} className="novel-workbench-checkpoint"><button disabled={!dataset.segments.some(item => item.id === segment.id)} onClick={() => { setPlotIndex(dataset.segments.findIndex(item => item.id === segment.id)); goTo(3); }}><strong>{segment.index + 1}. {segment.title}</strong><small>证据 {segment.evidenceNotes ? '已提取' : '未提取'} · 剧情 {label(segment.status)} · {segment.estimatedTokens ?? 0} tokens</small>{segment.error && <span className="is-error">{segment.error}</span>}</button>{(segment.status === 'failed' || segment.evidenceStatus === 'failed') && <button className="novel-workbench-checkpoint__retry" disabled={busy || !apiReady} onClick={() => void startAnalysis(false, false, segment.id)} aria-label={`重试 ${segment.title}`}>重试本段</button>}</li>)}</ol>
              {failedOnly && !checkpointSegments.length && <p>当前没有失败分段。</p>}<Pager page={checkpointPage} count={checkpointSegments.length} onChange={setSegmentPage} />
            </section></> : <p>先导入小说；AI 连接可以提前配置并保存。</p>}
          <details className="novel-import-workbench__panel"><summary>检索增强与重新处理（可选）</summary><h4>检索状态：{label(embeddingState)}</h4><p>连接测试仅验证服务；全书增强进度以分析任务为准。</p><button disabled={busy || probing || config.embeddingMode === 'off'} onClick={() => void testEmbedding()}>{probing ? '正在发送真实请求…' : '测试 embedding 连接'}</button>{progress?.totalChunks !== undefined && <p>向量索引：{progress.embeddedChunks ?? 0}/{progress.totalChunks} 块</p>}<p className="novel-import-workbench__hint">下面操作会再次调用 AI 并产生费用。普通续读使用底部主按钮即可。</p><div className="novel-import-workbench__structure-actions">{!!generated.length && !!dataset?.segments.length && <button disabled={!apiReady || busy} onClick={() => void startAnalysis(true)}>重新归并资料</button>}{!!evidenceCompleted && <button disabled={!apiReady || busy} onClick={() => void startAnalysis(false, true)}>重新提取全部原文证据</button>}</div></details></>}
        {tab === 2 && (dataset ? <><div className="novel-workbench-section-header"><h3>世界资料 · {generated.length} 条</h3><button disabled={busy} onClick={() => setMaterialDraft(JSON.stringify(dataset.staticMaterial, null, 2))}>编辑结构化资料</button></div>
          {!!conflicts.length && <section className="novel-import-workbench__panel"><h3>资料冲突 · {conflicts.length} 项</h3><p className="novel-import-workbench__hint">这些字段你手工改过，本次模型又给出了新内容；未处理前显示的仍是你的版本。</p>{conflicts.map(edit => { const incoming = dataset.materialDocument?.generated[edit.field]; return <article key={edit.field}><h4>{novelMaterialFieldLabel(edit.field)}</h4><p><strong>你的版本：</strong>{previewJson(edit.remove ? undefined : edit.value)}</p><p><strong>新生成：</strong>{previewJson(incoming)}</p><div className="novel-import-workbench__structure-actions"><button disabled={busy} onClick={() => void resolveConflict(edit.field, 'generated')}>采用新生成</button><button disabled={busy} onClick={() => void resolveConflict(edit.field, 'author')}>保留我的版本</button></div></article>; })}</section>}
          {materialDraft !== undefined && <section className="novel-import-workbench__panel"><label className="novel-import-workbench__field">世界资料 JSON<textarea className="novel-workbench-original" value={materialDraft} onChange={e => setMaterialDraft(e.target.value)} /></label><div className="novel-import-workbench__structure-actions"><button disabled={busy} onClick={() => void saveMaterial()}>校验并保存</button><button onClick={() => setMaterialDraft(undefined)}>取消修改</button></div></section>}
          <label className="novel-import-workbench__field">搜索人物、地点或设定<input value={search} placeholder="输入名称、别名或内容" onChange={e => { setSearch(e.target.value); setArchivePage(0); }} /></label><div className="novel-workbench-category-tabs" role="group" aria-label="资料分类">{[['all', '全部'], ...Object.entries(CATEGORIES)].filter(([key]) => key === 'all' || generated.some(entry => entry.entryType === key)).map(([key, value]) => <button key={key} aria-pressed={category === key} onClick={() => { setCategory(key); setArchivePage(0); }}>{value}{key === 'all' ? ` · ${generated.length}` : ` · ${generated.filter(entry => entry.entryType === key).length}`}</button>)}</div><label className="novel-workbench-checkbox"><input type="checkbox" checked={conflictsOnly} onChange={e => { setConflictsOnly(e.target.checked); setArchivePage(0); }} />仅显示冲突档案</label>
          {entries.slice(archivePage * PAGE_SIZE, (archivePage + 1) * PAGE_SIZE).map(entry => <article className="novel-import-workbench__panel" key={entry.uid}><div className="novel-workbench-section-header"><h3>{entry.comment}</h3><small>{CATEGORIES[entry.entryType ?? 'custom'] ?? entry.entryType} · {entry.constant ? '常驻概览' : '关键词触发'}</small></div><p className="novel-workbench-prose">{entry.content}</p><small>触发词：{entry.key?.join('、') || '无'}</small>{archives.filter(archive => entry.comment.includes(archive.name)).map(archive => <div key={archive.id ?? archive.name}>{archive.conflict && <p role="note">待核对：{archive.conflict}</p>}{archive.evidenceRefs?.map(evidenceButton)}</div>)}</article>)}{!entries.length && <p>尚无符合条件的世界资料，完成分析归并后会出现在这里。</p>}<Pager page={archivePage} count={entries.length} onChange={setArchivePage} />
          {dataset.staticCoverage && <details className="novel-import-workbench__segments"><summary>设定覆盖报告</summary>{Object.entries(dataset.staticCoverage).map(([key, status]) => <p key={key}>{({ rules: '世界规则', culture: '文化', powerSystem: '力量体系', economy: '经济', time: '时间' } as Record<string, string>)[key]}：{status === 'available' ? '已有资料' : status === 'no_evidence' ? '原文未提供依据' : '待补齐'}</p>)}</details>}</> : <p>导入小说后，在这里审查完整世界资料。</p>)}
        {tab === 3 && (dataset && plot ? <><label className="novel-import-workbench__field">选择要查看的故事段<select value={plotIndex} onChange={e => setPlotIndex(Number(e.target.value))}>{dataset.segments.map((segment, index) => <option key={segment.id} value={index}>{index + 1}. {segment.title} · {label(segment.status)}</option>)}</select></label><h3>{plot.title} · {label(plot.status)}</h3><p className="novel-import-workbench__hint">这是读出的原作剧情资料。创建原作世界时，还需要在第 4 步整理并保存开局剧情。</p>{goal === 'background' && !completed && <button disabled={busy} onClick={() => { setGoal('full'); goTo(1); }}>我也想读取原作故事 <ArrowRight size={16} /></button>}<p className="novel-workbench-prose">{plot.summary || plot.evidenceNotes?.summary || '该段尚未分析。'}</p>{plot.contextGap && <p role="alert">前段上下文存在缺口，补齐后相关剧情会重新编译。</p>}
          {(plot.status === 'failed' || plot.evidenceStatus === 'failed') && <section className="novel-import-workbench__panel"><p role="alert">本段失败：{plot.error || '尚未完成分析'}</p><button disabled={busy || !apiReady} onClick={() => void startAnalysis(false, false, plot.id)}>重试本段</button></section>}
          {plot.events.map((event, index) => <article className="novel-import-workbench__panel" key={event.id ?? index}><h3>{event.name}</h3><p>{event.description}</p><dl className="novel-workbench-facts">{[['前提', event.prerequisites?.join('；')], ['触发', event.trigger], ['阻断条件', event.blockers?.join('；')], ['结果', event.result], ['后续影响', event.nextImpact?.join('；')]].map(([name, value]) => value ? <div key={name}><dt>{name}</dt><dd>{value}</dd></div> : null)}</dl>{event.evidenceRefs?.map(evidenceButton)}</article>)}
          {!!plot.characterProgress?.length && <section className="novel-import-workbench__panel"><h3>人物变化</h3>{plot.characterProgress.map((character, index) => <article key={index}><h4>{character.characterName}</h4><p>之前：{character.before.join('；')}</p><p>变化：{character.changes.join('；')}</p><p>之后：{character.after.join('；')}</p>{character.evidenceRefs.map(evidenceButton)}</article>)}</section>}
          {[['开场事实', plot.openingFacts], ['结尾事实', plot.endingFacts], ['伏笔', plot.foreshadowing], ['未解决线索', plot.evidenceNotes?.openThreads], ['硬约束', plot.hardConstraints], ['后续参考', plot.nextReference]].map(([name, values]) => Array.isArray(values) && values.length ? <section className="novel-import-workbench__panel" key={String(name)}><h3>{String(name)}</h3><ul>{values.map((value, index) => <li key={index}>{value}</li>)}</ul></section> : null)}{!!plot.evidenceRefs?.length && <details className="novel-import-workbench__segments"><summary>分段证据 · {plot.evidenceRefs.length} 条</summary>{plot.evidenceRefs.map(evidenceButton)}</details>}</> : <p>暂无剧情分段，只有静态资料的档案也可直接创建世界。</p>)}
        {tab === 4 && (dataset ? <section className="novel-import-workbench__panel">
          <h3>准备你的世界</h3>
          <label className="novel-import-workbench__field">世界名称<input value={title} disabled={busy} onChange={e => setTitle(e.target.value)} /></label>
          <div className="novel-workbench-result-tabs" role="group" aria-label="创建世界的玩法"><button disabled={busy || directorState.busy} aria-pressed={goal === 'background'} onClick={() => setGoal('background')}>在小说世界里自由玩</button><button disabled={busy || directorState.busy} aria-pressed={goal === 'full'} onClick={() => setGoal('full')}>从原作故事开局</button></div>
          {goal === 'background' ? <section className="novel-create-choice">
            <h4>用小说里的人物、地点和规则，开始自己的故事</h4>
            <p>{generated.length ? `已准备 ${generated.length} 条世界资料，不需要额外整理主线。点击底部「创建世界，回大厅游玩」即可继续。` : '还没有可用的人物与设定。点击底部主按钮，先完成 AI 读取。'}</p>
          </section> : <section className="novel-create-choice">
            <h4>原作开局准备</h4>
            <ol className="novel-workbench-creation-checklist"><li>选择已读完的起始故事段</li><li>让 AI 整理开局剧情</li><li>保存剧情版本，然后创建世界</li></ol>
            {!!dataset.segments.length && <label className="novel-import-workbench__field">从哪段故事开始？<select value={startSegmentIndex} disabled={busy || directorState.busy} onChange={e => setStartSegmentIndex(Number(e.target.value))}>{dataset.segments.map((segment, index) => <option key={segment.id} value={index}>{index + 1}. {segment.title} · {label(segment.status)}</option>)}</select></label>}
            {!generated.length ? <p role="status">还缺人物和世界设定，点击底部按钮继续读取。</p> : !worldReady ? <p role="status">当前开场尚未读完。选择一个已完成的故事段，或点击底部按钮继续读取。</p> : !!dataset.segments.length && !directorBinding ? <p role="status">{directorState.hasDraft ? '剧情已整理好：点击底部「保存剧情版本并选用」。' : '点击底部「整理开局剧情」，完成后继续保存。'}</p> : <p role="status">开局资料已准备好，可以创建世界。</p>}
            {!!dataset.segments.length && worldReady && <fieldset className="novel-workbench-director" disabled={busy || !apiReady}><DirectorAuthorEditor key={dataset.id} workspaceId={`novel-director:${dataset.id}`} title={title || dataset.title} binding={directorBinding} novelDatasetId={dataset.id} apiConfig={config.api} onBind={setDirectorBinding} workflow={{ actionRef: directorActions, onStateChange: setDirectorState }} required /></fieldset>}
          </section>}
          <section className="novel-workbench-after-create"><h4>创建后怎么开玩？</h4><p>回到世界大厅 → 选择这个世界 → 填写角色 → 开始冒险。{goal === 'full' ? '角色页可以选择书中人物和剧情起点。' : '可以自创角色，也可以填写书中人物的身份。'}</p></section>
          <details><summary>导出资料与备份（可选）</summary><div className="novel-import-workbench__structure-actions"><button onClick={() => exportData(false)} disabled={busy}><Download size={15} />导出拆解资料</button><button onClick={() => exportData(true)} disabled={busy || !worldReady}><Download size={15} />导出世界资料包</button></div></details>
          {worldUpdate && <div><h3>世界更新预览</h3><p>保留手工修改；不会直接删除本次未出现的旧条目。</p><ul>{worldDiff.slice(0, 100).map((line, index) => <li key={index}>{line}</li>)}</ul>{!worldDiff.length && <p>没有需要替换的生成内容。</p>}<button onClick={() => { onUpdateWorld?.(worldUpdate); setWorldUpdate(undefined); setMessage('世界资料更新已应用。'); }}>应用到已有世界</button><button onClick={() => setWorldUpdate(undefined)}>保留当前世界</button></div>}</section> : <p>导入小说并准备世界资料后，在这里创建世界。</p>)}
        {evidence && <aside ref={evidenceRef} className="novel-workbench-evidence" aria-label="原文依据"><div className="novel-workbench-section-header"><h3>{evidenceChapter?.title ?? '来源章节不存在'}</h3><button onClick={() => setEvidence(undefined)} aria-label="关闭原文依据"><X size={16} /></button></div><blockquote>{evidence.excerpt}</blockquote><small>来源区间：{evidence.chapterStartOffset ?? evidence.startOffset}—{evidence.chapterEndOffset ?? evidence.endOffset} · {evidence.confidence === 'explicit' ? '明确事实' : '推断'}</small>{evidenceChapter && <><p className="novel-workbench-prose">{(() => { const at = evidenceChapter.content.indexOf(evidence.excerpt); return at < 0 ? '摘录与当前原文不匹配，请核对来源版本。' : evidenceChapter.content.slice(Math.max(0, at - 250), at + evidence.excerpt.length + 250); })()}</p><button onClick={() => { setChapterIndex(dataset!.chapters.indexOf(evidenceChapter)); goTo(0); }}>打开完整章节</button></>}</aside>}
      </main></div><footer className="novel-import-workbench__footer"><div className="novel-import-workbench__footer-info"><strong>{isPausing ? '正在保存进度…' : isAnalyzing ? '正在读取小说…' : primaryLabel}</strong><small>{isAnalyzing ? '可以暂停，已完成的结果会保留。' : next.description}</small></div><div className="novel-import-workbench__footer-actions">{stepIndex > 0 && <button disabled={isPausing || directorBusy} aria-label="返回上一步" onClick={() => goTo(WORKFLOW_STEPS[stepIndex - 1].tab)}><ArrowLeft size={16} />上一步</button>}<button onClick={() => void close()} disabled={isPausing}>保存并关闭</button>{isAnalyzing ? <button className="novel-import-workbench__primary" onClick={() => void pause()} disabled={isPausing}><Pause size={16} />{isPausing ? '正在暂停…' : '暂停并保存'}</button> : <button className="novel-import-workbench__primary" disabled={busy || directorBusy} onClick={runNext}>{isReading ? '正在导入…' : primaryLabel}<ArrowRight size={16} /></button>}</div></footer>
    </div></section>
  </div>;
}

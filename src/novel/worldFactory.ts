import type { WorldDef } from '../data/worlds-schema';
import type { NovelDataset } from './types';
import { buildNovelWorldBookEntries, identifyLegacyNovelEntries, mergeNovelWorldBookEntries } from './worldBookAdapter';
import type { NovelStaticMaterial } from './types';

export function getNovelWorldReadiness(dataset: NovelDataset): { status: 'unavailable' | 'static_only' | 'partial' | 'complete'; entryCount: number } {
  const entryCount = buildNovelWorldBookEntries(dataset.staticMaterial, 1).length;
  if (!entryCount) return { status: 'unavailable', entryCount };
  if (!dataset.chapters.length && !dataset.segments.length) return { status: 'static_only', entryCount };
  const covered = new Set(dataset.segments.flatMap(segment => segment.chapterIds));
  const coverageComplete = !dataset.coverage || (dataset.coverage.selectedChapters === dataset.coverage.totalChapters
    && dataset.coverage.evidenceCompleted === dataset.coverage.totalSegments
    && dataset.coverage.segmentsCompleted === dataset.coverage.totalSegments);
  const complete = dataset.analysisStatus === 'ready' && dataset.segments.length > 0
    && dataset.segments.every(segment => segment.status === 'completed')
    && dataset.chapters.every(chapter => chapter.included === false || covered.has(chapter.id))
    && coverageComplete && dataset.sourceVerified !== false
    && !dataset.importIssues?.some(issue => issue.severity === 'error');
  return { status: complete ? 'complete' : 'partial', entryCount };
}

/** Turns an imported novel dataset into a standalone custom world definition. */
export function createWorldFromNovel(dataset: NovelDataset, startSegmentIndex = 0): WorldDef {
  const readiness = getNovelWorldReadiness(dataset);
  if (readiness.status === 'unavailable') throw new Error('尚无可创建世界的资料，请先分析原文或导入静态档案。');
  const title = dataset.title.trim() || '未命名小说';
  const staticMaterial = {
    ...dataset.staticMaterial,
    summary: dataset.staticMaterial.summary || `该世界由小说《${title}》导入；章节进度由小说拆解工作台维护。`,
  };
  return {
    id: `novel_${dataset.id}`,
    name: `${title}（小说世界）`,
    description: `由小说《${title}》创建的独立世界。`,
    tags: ['小说导入'],
    source: undefined,
    worldBookEntries: buildNovelWorldBookEntries(staticMaterial, Date.now(), { datasetId: dataset.id, analysisVersion: dataset.analysisVersion ?? 1 }),
    novelSource: {
      datasetId: dataset.id,
      startSegmentIndex: Math.max(0, Math.min(Math.floor(startSegmentIndex) || 0, Math.max(0, dataset.segments.length - 1))),
      schemaVersion: dataset.schemaVersion,
      analysisVersion: dataset.analysisVersion,
    },
    novelAdaptationMode: 'source_faithful',
    novelMaterialStatus: readiness.status,
  };
}

export function regenerateNovelWorldMaterial(world: WorldDef, dataset: NovelDataset, previousMaterial?: NovelStaticMaterial): WorldDef {
  if (world.novelSource?.datasetId !== dataset.id) throw new Error('世界与小说资料不匹配');
  const generated = buildNovelWorldBookEntries(dataset.staticMaterial, Date.now(), { datasetId: dataset.id, analysisVersion: dataset.analysisVersion ?? 2 });
  const existing = previousMaterial
    ? identifyLegacyNovelEntries(world.worldBookEntries ?? [], previousMaterial, dataset.id)
    : world.worldBookEntries ?? [];
  return { ...world, novelMaterialStatus: getNovelWorldReadiness(dataset).status, worldBookEntries: mergeNovelWorldBookEntries(existing, generated), novelSource: {
    ...world.novelSource, analysisVersion: dataset.analysisVersion, schemaVersion: dataset.schemaVersion,
  } };
}

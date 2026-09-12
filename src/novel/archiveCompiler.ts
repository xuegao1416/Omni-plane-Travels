import { hashNovelText } from './segmentation';
import type { NovelArchiveRecord, NovelNamedArchive, NovelSegment, NovelStaticMaterial } from './types';

type Category = NovelArchiveRecord['category'];
export interface NovelArchiveFinding { findingId: string; segmentId: string; category: Category; archive: NovelNamedArchive & { role?: string }; }
export interface NovelArchiveCandidateGroup { datasetId: string; category: Category; findings: NovelArchiveFinding[]; }
export interface NovelArchiveIssue { reason: 'ambiguous_identity' | 'invalid_resolution'; findingIds: string[]; }
const categories: Category[] = ['characters', 'factions', 'locations', 'items'];
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

/** Identity resolution can group discoveries, but cannot remove or rewrite their source facts. */
export async function compileNovelArchives(datasetId: string, segments: NovelSegment[], options: {
  resolve?: (group: NovelArchiveCandidateGroup) => Promise<string[][]>;
  onCheckpoint?: (group: NovelArchiveCandidateGroup, resolution: string[][]) => Promise<void>;
} = {}) {
  const records: NovelArchiveRecord[] = [], unresolved: NovelArchiveIssue[] = [];
  let findingsTotal = 0;
  for (const category of categories) {
    const findings = segments.flatMap(segment => (segment.evidenceNotes?.archives?.[category] ?? []).map((archive, index): NovelArchiveFinding => ({
      findingId: `${segment.id}:${category}:${index}`, segmentId: segment.id, category, archive,
    })));
    findingsTotal += findings.length;
    // Only explicit aliases or matching source IDs unify name buckets.
    const parent = new Map<string, string>();
    const find = (name: string): string => { const p = parent.get(name); if (!p || p === name) return name; const root = find(p); parent.set(name, root); return root; };
    for (const { archive } of findings) {
      const key = archive.name.trim();
      for (const alias of archive.aliases ?? []) if (alias.trim()) parent.set(find(alias.trim()), find(key));
    }
    const buckets = new Map<string, NovelArchiveFinding[]>();
    for (const finding of findings) {
      const key = finding.archive.id ? `id:${finding.archive.id}` : find(finding.archive.name.trim());
      const bucket = buckets.get(key) ?? []; bucket.push(finding); buckets.set(key, bucket);
    }
    for (const bucket of buckets.values()) {
      const hasAlias = new Set(bucket.map(f => f.archive.name)).size > 1;
      const exact = new Set(bucket.map(f => JSON.stringify([f.archive.name, f.archive.description, f.archive.role ?? '']))).size === 1;
      let groups: NovelArchiveFinding[][];
      let conflict = false;
      if (hasAlias || exact || bucket.every(f => f.archive.id && f.archive.id === bucket[0].archive.id)) groups = [bucket];
      else {
        groups = []; conflict = true;
        let offset = 0;
        while (offset < bucket.length) {
          const batch: NovelArchiveFinding[] = [];
          while (offset < bucket.length && batch.length < 24) {
            const next = bucket[offset];
            if (batch.length && JSON.stringify([...batch, next]).length > 12000) break;
            batch.push(next); offset++;
          }
          const candidate = { datasetId, category, findings: batch };
          let resolution: string[][] | undefined;
          if (options.resolve && JSON.stringify(candidate).length <= 14000) resolution = await options.resolve(candidate);
          const ids = new Set(batch.map(f => f.findingId)), flattened = resolution?.flat() ?? [];
          const valid = resolution && resolution.every(g => g.length > 0) && flattened.length === ids.size
            && new Set(flattened).size === ids.size && flattened.every(id => ids.has(id));
          if (valid && resolution) {
            groups.push(...resolution.map(group => group.map(id => batch.find(f => f.findingId === id)!)));
            await options.onCheckpoint?.(candidate, resolution);
          } else {
            groups.push(...batch.map(f => [f]));
            unresolved.push({ reason: options.resolve ? 'invalid_resolution' : 'ambiguous_identity', findingIds: [...ids] });
          }
        }
      }
      for (const group of groups) {
        const first = group[0];
        const references = group.flatMap(f => f.archive.evidenceRefs ?? []);
        const refs = [...new Map(references.map(ref => [JSON.stringify(ref), ref])).values()];
        records.push({
          id: first.archive.id ?? `${datasetId}:entity:${hashNovelText(first.findingId)}`, datasetId, category,
          name: first.archive.name,
          description: unique(group.map(f => f.archive.description)).join('\n'),
          aliases: unique(group.flatMap(f => [f.archive.name, ...(f.archive.aliases ?? [])])).filter(name => name !== first.archive.name),
          details: unique(group.flatMap(f => f.archive.details ?? [])),
          ...(first.archive.role ? { role: first.archive.role } : {}),
          evidenceRefs: refs, sourceFindingIds: group.map(f => f.findingId),
          ...(conflict && groups.length > 1 ? { conflict: '同名资料存在不同描述，保留各自依据，需审查身份或设定变化。' } : {}),
        });
      }
    }
  }
  const material: Pick<NovelStaticMaterial, Category> = {};
  for (const category of categories) material[category] = records.filter(record => record.category === category);
  return { material, records, findingsTotal, unresolved };
}

export function collectNovelStaticObservations(segments: NovelSegment[]) {
  const result = { settings: [] as string[], rules: [] as string[], culture: [] as string[], powerSystem: [] as string[], economy: [] as string[], time: [] as string[] };
  for (const key of Object.keys(result) as Array<keyof typeof result>) result[key] = unique(segments.flatMap(segment => segment.evidenceNotes?.staticFindings?.[key] ?? []));
  return result;
}

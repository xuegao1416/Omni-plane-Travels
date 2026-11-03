import { expect, test } from 'bun:test';
import { buildNovelEvidencePrompt, buildNovelOverviewPrompt, buildNovelSegmentPrompt } from './analysisPrompts';
import type { NovelEvidenceNote, NovelSegment } from './types';

test('gives Flash a complete, stage-specific output contract', () => {
  const segment: NovelSegment = { id: 's1', index: 0, title: '第一章', chapterIds: ['c1'], summary: '', hardConstraints: [], events: [] };
  const note: NovelEvidenceNote = { summary: '', facts: [], characters: [], factions: [], locations: [], items: [], events: [], rules: [], relationships: [], openThreads: [], evidenceRefs: [] };
  const schemaFrom = (prompt: string) => JSON.parse(prompt.match(/<output_schema>\s*([\s\S]*?)\s*<\/output_schema>/)?.[1] ?? '{}');
  const evidence = schemaFrom(buildNovelEvidencePrompt({ novelTitle: '测试', segment, sourceText: '城门开启。', chapterContext: 'c1' }));
  const overview = schemaFrom(buildNovelOverviewPrompt({ novelTitle: '测试', notes: [note] }));
  const formal = schemaFrom(buildNovelSegmentPrompt({ novelTitle: '测试', segment, sourceText: '城门开启。', evidenceNote: note, previousEndingFacts: [], retrievedEvidence: '' }));
  expect(evidence.properties?.characters.items.type).toBe('string');
  expect(overview.properties?.characters.items.type).toBe('object');
  expect(overview.properties?.events).toBeUndefined();
  expect(evidence.properties?.staticFindings.properties.culture.type).toBe('array');
  expect(evidence.properties?.archives.properties.items.items.type).toBe('object');
  expect(evidence.properties?.events.items.properties.visibility.type).toBe('object');
  expect(formal.properties?.hardConstraints.items.properties.evidenceRefs.items.type).toBe('object');
});

/** Immutable authored content; kept separate from save-scoped director plans. */
export interface DirectorSource {
  kind: 'author' | 'novel';
  text: string;
  datasetId?: string;
  sourceVersion?: string;
  chapterIds?: string[];
  evidenceRefs?: Array<{ chapterId: string; startOffset: number; endOffset: number; excerpt: string }>;
}

export interface DirectorDefinition {
  schemaVersion: 1;
  id: string;
  version: string;
  title: string;
  source: DirectorSource;
  coreConflict: string;
  anchors: string[];
  stages: Array<{
    id: string;
    title: string;
    description: string;
    nodeIds: string[];
    completion?: { mode: 'all' | 'any'; nodeIds: string[] };
  }>;
  nodes: Array<{
    id: string;
    stageId: string;
    title: string;
    intent: string;
    actorIds: string[];
    execution: 'foreground' | 'offscreen' | 'either';
    conditions: Array<{
      id: string;
      description: string;
      predicates?: Array<{
        path: string;
        operator: 'eq' | 'neq' | 'exists' | 'gt' | 'gte' | 'lt' | 'lte';
        value?: string | number | boolean | null;
      }>;
    }>;
    dependsOn: string[];
    constraints: string[];
    sourceRefs: string[];
    referenceOutcome?: string;
  }>;
  characters: Array<{ id: string; name: string; aliases: string[] }>;
  coverage: { complete: boolean; gaps: string[]; boundary: string };
  createdAt: number;
  editedByAuthor: boolean;
}

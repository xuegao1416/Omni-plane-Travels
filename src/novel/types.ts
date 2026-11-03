export type NovelSourceType = 'txt' | 'epub' | 'structured';

export type NovelAnalysisStatus = 'draft' | 'processing' | 'ready' | 'partial' | 'failed';
export type NovelSegmentStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type NovelEvidenceConfidence = 'explicit' | 'strong_inference' | 'weak_inference';

export interface NovelEvidenceRef {
  sourceVersion?: string;
  chapterStartOffset?: number;
  chapterEndOffset?: number;
  chapterId: string;
  startOffset: number;
  endOffset: number;
  excerpt: string;
  confidence: NovelEvidenceConfidence;
}

export interface NovelInformationVisibility {
  knownBy: string[];
  unknownTo: string[];
  readerOnly: boolean;
}

export interface NovelNamedArchive {
  id?: string;
  evidenceRefs?: NovelEvidenceRef[];
  sourceFindingIds?: string[];
  conflict?: string;
  name: string;
  description: string;
  aliases?: string[];
  details?: string[];
}

export interface NovelEvent {
  id?: string;
  entityIds?: string[];
  name: string;
  description: string;
  startTime?: string;
  earliestStartTime?: string;
  latestStartTime?: string;
  endTime?: string;
  prerequisites?: string[];
  trigger?: string;
  blockers?: string[];
  result?: string;
  nextImpact?: string[];
  visibility?: 'public' | 'reader_only' | NovelInformationVisibility;
  evidenceRefs?: NovelEvidenceRef[];
}

export interface NovelHardConstraint {
  content: string;
  visibility: NovelInformationVisibility;
  confidence: NovelEvidenceConfidence;
  evidenceRefs: NovelEvidenceRef[];
}

export interface NovelCharacterProgress {
  characterName: string;
  before: string[];
  changes: string[];
  after: string[];
  nextImpact: string[];
  evidenceRefs: NovelEvidenceRef[];
}

/** The reusable, stable portion of a novel. This becomes native world-book entries. */
export interface NovelStaticMaterial {
  summary?: string;
  settings?: string[];
  rules?: string[];
  powerSystem?: string;
  factions?: NovelNamedArchive[];
  characters?: Array<NovelNamedArchive & { role?: string }>;
  locations?: NovelNamedArchive[];
  items?: NovelNamedArchive[];
  relations?: string[];
  /** Legacy imports only. Never emitted into the static output contract or world book. */
  events?: NovelEvent[];
  culture?: string[];
  highlights?: string[];
  economy?: {
    currencyName?: string;
    currencySymbol?: string;
    currencyDescription?: string;
    priceLevel?: string;
    calendar?: string;
    startTime?: string;
    timeSpeed?: string;
  };
}

export interface NovelChapter {
  sourceVersion?: string;
  included?: boolean;
  sourceResource?: string;
  id: string;
  datasetId?: string;
  index: number;
  title: string;
  content: string;
  volumeTitle?: string;
  startOffset?: number;
  endOffset?: number;
  wordCount?: number;
  contentHash?: string;
}

export interface NovelSegment {
  sourceRanges?: Array<{ chapterId: string; startOffset: number; endOffset: number; sourceVersion?: string }>;
  evidenceStatus?: NovelSegmentStatus;
  contextGap?: boolean;
  retrievedEvidenceIds?: string[];
  id: string;
  datasetId?: string;
  index: number;
  title: string;
  chapterIds: string[];
  /** Exact source slice sent to the analysis model. */
  sourceText?: string;
  /** Source hash used by the last successful evidence extraction. */
  evidenceInputHash?: string;
  /** Structured input hash used by the last successful formal analysis. */
  analysisInputHash?: string;
  estimatedTokens?: number;
  inputHash?: string;
  status?: NovelSegmentStatus;
  summary: string;
  hardConstraints: string[];
  events: NovelEvent[];
  carryFacts?: string[];
  endingFacts?: string[];
  foreshadowing?: string[];
  openingFacts?: string[];
  nextReference?: string[];
  constraintDetails?: NovelHardConstraint[];
  characterProgress?: NovelCharacterProgress[];
  worldRules?: string[];
  relationships?: string[];
  timelineStart?: string;
  timelineEnd?: string;
  evidenceRefs?: NovelEvidenceRef[];
  evidenceNotes?: NovelEvidenceNote;
  error?: string;
  analysisVersion?: number;
  updatedAt?: number;
}

export interface NovelEvidenceNote {
  summary: string;
  facts: string[];
  characters: string[];
  factions: string[];
  locations: string[];
  items: string[];
  events: NovelEvent[];
  rules: string[];
  relationships: string[];
  openThreads: string[];
  evidenceRefs: NovelEvidenceRef[];
  /** Stable observations, kept separate from facts/events and their chronology. */
  staticFindings?: {
    settings: string[];
    rules: string[];
    culture: string[];
    powerSystem: string[];
    economy: string[];
    time: string[];
  };
  /** Complete stable profiles, not just names; excludes future state changes. */
  archives?: Pick<NovelStaticMaterial, 'characters' | 'factions' | 'locations' | 'items'>;
}

export interface NovelChunk {
  embeddingIdentity?: string;
  embeddingInputHash?: string;
  chapterStartOffset?: number;
  chapterEndOffset?: number;
  id: string;
  datasetId: string;
  chapterId: string;
  index: number;
  text: string;
  contextPrefix: string;
  startOffset: number;
  endOffset: number;
  contentHash: string;
  embedding?: number[];
  embeddingModel?: string;
  embeddingDimension?: number;
  embeddedAt?: number;
}

export type NovelJobStatus = 'idle' | 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type NovelJobPhase = 'index' | 'evidence' | 'overview' | 'segments' | 'completed';

export interface NovelAnalysisJob {
  runId?: string;
  model?: string;
  configFingerprint?: string;
  phaseCounts?: Partial<Record<NovelJobPhase, { completed: number; total: number; failed: number }>>;
  embeddingStatus?: 'off' | 'preparing' | 'enhanced' | 'partial' | 'degraded';
  embeddedChunks?: number;
  totalChunks?: number;
  requestCount?: number;
  tokenUsage?: { prompt: number; completion: number };
  id: string;
  datasetId: string;
  status: NovelJobStatus;
  phase: NovelJobPhase;
  startSegmentIndex: number;
  total: number;
  completed: number;
  failed: number;
  retryCount: number;
  currentSegmentId?: string;
  lastError?: string;
  embeddingMode?: 'enhanced' | 'basic';
  createdAt: number;
  updatedAt: number;
}

export interface NovelDataset {
  sourceVersion?: string;
  encoding?: string;
  importIssues?: Array<{code: string; message: string; chapterId?: string; resource?: string; severity: 'warning' | 'error'}>;
  importMetadata?: Record<string, unknown>;
  sourceVerified?: boolean;
  chapterCount?: number;
  segmentCount?: number;
  completedSegmentCount?: number;
  coverage?: { selectedChapters: number; totalChapters: number; evidenceCompleted: number; segmentsCompleted: number; totalSegments: number };
  id: string;
  title: string;
  sourceType: NovelSourceType;
  schemaVersion?: number;
  rawTextLength: number;
  rawText?: string;
  chapters: NovelChapter[];
  staticMaterial: NovelStaticMaterial;
  /** v1 upgrade baseline for exact-match regeneration of worlds created before provenance. */
  legacyStaticMaterial?: NovelStaticMaterial;
  segments: NovelSegment[];
  analysisStatus?: NovelAnalysisStatus;
  overviewInputHash?: string;
  overviewError?: string;
  overviewCheckpoints?: Array<{ inputHash: string; material: NovelStaticMaterial }>;
  staticCoverage?: Partial<Record<'rules' | 'culture' | 'powerSystem' | 'economy' | 'time', 'available' | 'no_evidence' | 'missing'>>;
  analysisVersion?: number;
  createdAt: number;
  updatedAt: number;
}

export interface NovelArchiveRecord extends NovelNamedArchive {
  id: string;
  datasetId: string;
  category: 'characters' | 'factions' | 'locations' | 'items';
  role?: string;
}

export interface NovelOverviewCheckpoint {
  id: string;
  datasetId: string;
  inputHash: string;
  material: NovelStaticMaterial;
}

/** A save can bind one novel dataset and choose the active chapter segment explicitly. */

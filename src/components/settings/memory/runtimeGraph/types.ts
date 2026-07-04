import type { MemorySystemConfig, NarrativeMemoryRuntime, VectorMemoryItem } from '../../../../memory/types';

export interface RuntimeGraphPanelProps {
  config: MemorySystemConfig;
  memoryRuntime: NarrativeMemoryRuntime | null;
  vectorMemory: VectorMemoryItem[];
  stats: {
    sceneCount: number; threadCount: number; stateCount: number;
    relationCount: number; eventCount: number; entityCount: number;
    archiveCount: number; mutationCount: number; checkpointCount: number;
    lastIngestCursor: number; totalObjects: number;
  };
  search: string;
  activeTab: string;
  onSearchChange: (v: string) => void;
  onTabChange: (v: string) => void;
  onOpenEditor: (tabKey: string) => void;
  onOpenExportPicker: () => void;
  onOpenVectorExtract: () => void;
  isExporting: boolean;
}

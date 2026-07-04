import { useMemo } from 'react';
import type { NarrativeMemoryRuntime, VectorMemoryItem } from '../../../../memory/types';
import type { NodeDetail } from '../../../shared/MermaidGraphPanel';
import { buildMemoryRuntimeGraphPayload } from '../../../../memory/narrativeGraph';

interface GraphViewProps {
  rt: NarrativeMemoryRuntime | null;
  vectorMemory: VectorMemoryItem[];
  activeTab: string;
  search: string;
  children: (payload: {
    graphDefinition: string;
    nodeDetails: Record<string, NodeDetail>;
  }) => React.ReactNode;
}

export function GraphView({ rt, vectorMemory, activeTab, search, children }: GraphViewProps) {
  const graphPayload = useMemo(() => {
    return buildMemoryRuntimeGraphPayload({
      tabKey: activeTab,
      query: search || undefined,
      sceneAnchor: rt?.sceneAnchor ?? null,
      threads: rt?.activeThreads ?? [],
      states: rt?.stateSlots ?? [],
      relations: rt?.relationEdges ?? [],
      relationNetwork: rt?.relationNetwork ?? [],
      events: rt?.eventCards ?? [],
      entities: rt?.entityCards ?? [],
      archives: rt?.archiveCards ?? [],
      vectorMemories: vectorMemory ?? [],
      summaryHistory: rt?.summarySaveHistory ?? [],
      lastRetrievePlan: rt?.lastRetrievePlan ?? null,
      mutations: rt?.mutationLog ?? [],
      checkpoints: rt?.checkpoints ?? [],
      writeLogs: rt?.writeDebugLogs ?? [],
      retrieveLogs: rt?.retrieveDebugLogs ?? [],
      compileLogs: rt?.compileDebugLogs ?? [],
    });
  }, [rt, vectorMemory, activeTab, search]);

  const nodeDetails = useMemo(() => {
    if (!graphPayload?.nodeDetails) return {};
    const result: Record<string, NodeDetail> = {};
    for (const [key, val] of Object.entries(graphPayload.nodeDetails)) {
      const detail = val as any;
      result[key] = {
        title: detail?.title || key,
        typeLabel: detail?.typeLabel,
        summary: detail?.summary,
        fields: detail?.fields || [],
        rawLabel: detail?.rawLabel,
      };
    }
    return result;
  }, [graphPayload]);

  return <>{children({ graphDefinition: graphPayload?.definition || '', nodeDetails })}</>;
}

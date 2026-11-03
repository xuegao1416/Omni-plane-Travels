import type { MemoryProvenance, MemoryVisibility, NarrativeMemoryRuntime } from './types';

export type MemoryAudience = 'player' | 'director';

export function isMemoryVisibleInRuntime(value: MemoryProvenance, runtime: NarrativeMemoryRuntime, audience: MemoryAudience = 'player'): boolean {
  return isMemoryVisible(value, audience) && (audience === 'director'
    || Boolean(value.playerKnown && value.discovery?.sourceEventId && value.discovery.evidence)
    || !(value.sourceEventIds ?? []).some(id => runtime.sourceEvents.some(source => source.id === id && !isMemoryVisible(source))));
}

/** This is an information boundary, independent of confidence or retrieval score. */
export function isMemoryVisible(value: MemoryProvenance, audience: MemoryAudience = 'player'): boolean {
  if (audience === 'director') return true;
  if (value.playerKnown === false) return false;
  if (value.visibility === 'offscreen' || value.visibility === 'restricted' || value.sourceType === 'offscreen_event') {
    return value.playerKnown === true && Boolean(value.discovery?.sourceEventId && value.discovery.evidence);
  }
  return true;
}

export function revealMemoryWithEvidence<T extends MemoryProvenance>(value: T, discovery: NonNullable<MemoryVisibility['discovery']>): T & MemoryProvenance {
  if (!discovery.sourceEventId.trim() || !discovery.evidence.trim() || !Number.isInteger(discovery.round) || discovery.round < 0) {
    throw new Error('Memory discovery requires a committed source, round and evidence');
  }
  return { ...value, playerKnown: true, discovery: { ...discovery }, sourceEventIds: [...new Set([...(value.sourceEventIds ?? []), discovery.sourceEventId])] };
}

/** Mark only newly narrated fact fragments as discovered; never unlock their hidden originals. */
export function annotateNarrativeDiscoveries(runtime: NarrativeMemoryRuntime, parsed: Record<string, unknown>, sourceEventId: string, round: number): Record<string, unknown> {
  const source = runtime.sourceEvents.find(item => item.id === sourceEventId && item.round === round);
  if (!source || source.sourceType === 'offscreen_event' || !isMemoryVisible(source)) return parsed;
  const result = { ...parsed };
  for (const key of ['threadUpserts', 'stateSlotUpserts', 'relationUpserts', 'relationNetworkUpserts', 'eventCandidates', 'entityPatches', 'archiveHints']) {
    const items = parsed[key];
    if (!Array.isArray(items)) continue;
    result[key] = items.map(item => {
      if (!item || typeof item !== 'object') return item;
      const fact = item as MemoryProvenance;
      if (fact.layer !== 'fact' || !isMemoryVisible(fact) || fact.sourceType === 'offscreen_event') return item;
      const evidence = fact.evidence?.find(quote => typeof quote === 'string' && quote.trim() && source.assistantText.includes(quote));
      return evidence ? revealMemoryWithEvidence(fact, { sourceEventId, round, evidence }) : item;
    });
  }
  return result;
}

/** Different knowledge partitions must never merge merely because names/IDs match. */
export function sameMemoryVisibility(left: object, right: object): boolean {
  const a = left as MemoryProvenance;
  const b = right as MemoryProvenance;
  return isMemoryVisible(a) === isMemoryVisible(b)
    && (isMemoryVisible(a) || JSON.stringify([a.visibility, [...(a.knownBy ?? [])].sort()]) === JSON.stringify([b.visibility, [...(b.knownBy ?? [])].sort()]));
}

export function memoryVisibilityMetadata(value: MemoryVisibility): MemoryVisibility {
  return {
    visibility: value.visibility === undefined ? undefined : ['public', 'offscreen', 'restricted'].includes(value.visibility) ? value.visibility : 'restricted',
    playerKnown: typeof value.playerKnown === 'boolean' ? value.playerKnown : undefined,
    knownBy: Array.isArray(value.knownBy) ? value.knownBy.filter((id): id is string => typeof id === 'string') : undefined,
    discovery: value.discovery && typeof value.discovery.sourceEventId === 'string' && typeof value.discovery.evidence === 'string' && Number.isInteger(value.discovery.round) ? { ...value.discovery } : undefined,
  };
}

/** A detached projection; director inspection cannot mutate knowledge or stored facts. */
export function projectMemoryRuntime(runtime: NarrativeMemoryRuntime, audience: MemoryAudience = 'player'): NarrativeMemoryRuntime {
  const result = structuredClone(runtime);
  const hiddenSources = new Set(runtime.sourceEvents.filter(event => !isMemoryVisible(event, audience)).map(event => event.id));
  const visible = (value: MemoryProvenance) => isMemoryVisible(value, audience)
    && (audience === 'director' || Boolean(value.playerKnown && value.discovery?.sourceEventId && value.discovery.evidence)
      || !(value.sourceEventIds ?? []).some(id => hiddenSources.has(id)));
  for (const key of ['activeThreads', 'stateSlots', 'relationEdges', 'relationNetwork', 'eventCards', 'entityCards', 'archiveCards', 'sourceEvents'] as const) {
    (result[key] as MemoryProvenance[]) = result[key].filter(visible);
  }
  result.sceneAnchor = result.sceneAnchor && visible(result.sceneAnchor) ? result.sceneAnchor : null;
  result.vectorMemory = result.vectorMemory?.filter(visible);
  result.summarySaveHistory = result.summarySaveHistory.filter(visible).map(record => ({ ...record, summaryData: record.summaryData && {
    playerMemories: record.summaryData.playerMemories.filter(visible),
    otherCharacterMemories: record.summaryData.otherCharacterMemories.filter(visible),
    itemMemories: record.summaryData.itemMemories.filter(visible),
  } }));
  if (audience === 'player') {
    // Derived caches/logs can contain pre-filter text and are never retrieval evidence.
    result.lastCompiledContext = null;
    result.lastRuntimeFlow = null;
    result.lastRetrievePlan = null;
    result.lastSummarySave = null;
    result.mutationLog = [];
    result.checkpoints = [];
    result.writeDebugLogs = [];
    result.retrieveDebugLogs = [];
    result.compileDebugLogs = [];
  }
  return result;
}

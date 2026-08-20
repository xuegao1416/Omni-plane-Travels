import type {
  MemoryEntry,
  MemoryEntryType,
  MemoryProvenance,
  NarrativeMemoryRuntime,
  SummaryMemoryItem,
} from './types';

function active(provenance: MemoryProvenance, currentRound: number): boolean {
  if (provenance.conflictStatus === 'superseded' || provenance.conflictStatus === 'rejected') return false;
  // validUntilRound 是失效轮次；到达该轮次后不再进入当前检索池。
  return provenance.validUntilRound == null || provenance.validUntilRound > currentRound;
}

function strings(...values: unknown[]): string[] {
  return [...new Set(values.flatMap(value => Array.isArray(value) ? value : [value])
    .map(value => String(value ?? '').trim())
    .filter(Boolean))].slice(0, 32);
}

function provenance(value: MemoryProvenance): MemoryProvenance {
  return {
    sourceType: value.sourceType ?? 'unknown',
    layer: value.layer ?? 'fact',
    confidence: Number.isFinite(value.confidence) ? value.confidence : 0.5,
    evidence: Array.isArray(value.evidence) ? [...value.evidence] : [],
    validFromRound: value.validFromRound ?? null,
    validUntilRound: value.validUntilRound ?? null,
    validFromLabel: value.validFromLabel,
    validUntilLabel: value.validUntilLabel,
    supersedesId: value.supersedesId ?? null,
    previousVersionId: value.previousVersionId ?? null,
    conflictStatus: value.conflictStatus ?? 'none',
    sourceEventIds: Array.isArray(value.sourceEventIds) ? [...value.sourceEventIds] : [],
  };
}

function entry(
  value: MemoryProvenance & { id: string },
  type: MemoryEntryType,
  title: string,
  summary: string,
  keywords: string[],
  sourceFloor: number,
  savedAt: number,
): MemoryEntry {
  return {
    ...provenance(value),
    id: value.id,
    type,
    title: title.trim() || value.id,
    summary: summary.trim() || title.trim() || value.id,
    keywords: strings(keywords),
    sourceFloor: Math.max(0, Math.floor(sourceFloor || 0)),
    savedAt: Math.max(0, Math.floor(savedAt || 0)),
  };
}

function summaryEntry(
  item: SummaryMemoryItem,
  fallbackId: string,
  type: Extract<MemoryEntryType, 'player' | 'otherCharacter' | 'item'>,
  floor: number,
  savedAt: number,
  parentProvenance: MemoryProvenance,
): MemoryEntry {
  const inheritedSourceEventIds = Array.isArray(item.sourceEventIds) && item.sourceEventIds.length > 0
    ? item.sourceEventIds
    : parentProvenance.sourceEventIds;
  return entry(
    {
      ...parentProvenance,
      ...item,
      id: item.id || fallbackId,
      sourceType: item.sourceType ?? parentProvenance.sourceType ?? 'summary',
      layer: item.layer ?? parentProvenance.layer ?? 'summary',
      sourceEventIds: inheritedSourceEventIds,
      validFromRound: item.validFromRound ?? parentProvenance.validFromRound ?? null,
      validUntilRound: item.validUntilRound ?? parentProvenance.validUntilRound ?? null,
    },
    type,
    item.title,
    item.summary,
    item.keywords ?? [],
    item.sourceStartIndex ?? floor,
    item.savedAt ?? savedAt,
  );
}

/** Build the single retrieval pool used by keyword, planner and rerank stages. */
export function collectMemoryEntries(runtime: NarrativeMemoryRuntime): MemoryEntry[] {
  const memories: MemoryEntry[] = [];
  const currentRound = Math.max(0, Math.floor(Number(runtime.lastIngestCursor) || 0));

  for (const record of runtime.summarySaveHistory) {
    if (!active(record, currentRound) || !record.summaryData) continue;
    const floor = record.sourceStartIndex ?? 0;
    const parentProvenance: MemoryProvenance = {
      sourceType: record.sourceType ?? 'summary',
      layer: record.layer ?? 'summary',
      confidence: record.confidence,
      evidence: record.evidence,
      validFromRound: record.validFromRound ?? floor,
      validUntilRound: record.validUntilRound ?? null,
      validFromLabel: record.validFromLabel,
      validUntilLabel: record.validUntilLabel,
      supersedesId: record.supersedesId,
      previousVersionId: record.previousVersionId,
      conflictStatus: record.conflictStatus,
      sourceEventIds: record.sourceEventIds,
    };
    for (const item of record.summaryData.playerMemories ?? []) {
      if (active(item, currentRound)) memories.push(summaryEntry(item, `pm_${floor}_${memories.length}`, 'player', floor, record.savedAt, parentProvenance));
    }
    for (const item of record.summaryData.otherCharacterMemories ?? []) {
      if (active(item, currentRound)) memories.push(summaryEntry(item, `oc_${floor}_${memories.length}`, 'otherCharacter', floor, record.savedAt, parentProvenance));
    }
    for (const item of record.summaryData.itemMemories ?? []) {
      if (active(item, currentRound)) memories.push(summaryEntry(item, `im_${floor}_${memories.length}`, 'item', floor, record.savedAt, parentProvenance));
    }
  }

  for (const item of runtime.activeThreads) {
    if (!active(item, currentRound)) continue;
    memories.push(entry(item, 'thread', item.title, [item.summary, item.goal, item.blockingReason].filter(Boolean).join('；'),
      strings(item.relatedEntities, item.relatedItems, item.relatedLocations, item.category), item.sourceStartIndex ?? 0, item.updatedAt ?? item.createdAt ?? 0));
  }
  for (const item of runtime.stateSlots) {
    if (!active(item, currentRound)) continue;
    memories.push(entry(item, 'state', `${item.scopeId} · ${item.slotType}`, item.summary || item.value,
      strings(item.scopeId, item.slotType, item.value), item.sourceStartIndex ?? 0, item.updatedAt ?? item.createdAt ?? 0));
  }
  for (const item of runtime.relationEdges) {
    if (!active(item, currentRound)) continue;
    memories.push(entry(item, 'relation', `${item.sourceEntityId} → ${item.targetEntityId} · ${item.relationType}`, item.summary || item.stance,
      strings(item.sourceEntityId, item.targetEntityId, item.relationType, item.stance, item.locationScope), item.sourceStartIndex ?? 0, item.updatedAt ?? item.createdAt ?? 0));
  }
  for (const item of runtime.relationNetwork) {
    if (!active(item, currentRound)) continue;
    memories.push(entry({ ...item, id: `network:${item.id}` }, 'relation', `${item.sourceEntityId} → ${item.targetEntityId} · ${item.relationType}`, item.summary,
      strings(item.sourceEntityId, item.targetEntityId, item.relationType, item.locationScope), item.sourceStartIndex ?? 0, item.updatedAt ?? item.createdAt ?? 0));
  }
  for (const item of runtime.eventCards) {
    if (!active(item, currentRound)) continue;
    memories.push(entry(item, 'event', item.title, item.summary || item.excerpt,
      strings(item.entityRefs, item.locationRefs, item.threadRefs, item.timeLabels), item.sourceStartIndex ?? 0, item.updatedAt ?? item.createdAt ?? 0));
  }
  for (const item of runtime.entityCards) {
    if (!active(item, currentRound)) continue;
    memories.push(entry(item, 'entity', item.name, strings(item.currentStatus, item.stableFacts, item.currentStance).join('；'),
      strings(item.name, item.aliases, item.affiliations, item.relatedThreads, item.relatedEvents), item.sourceStartIndex ?? 0, item.updatedAt ?? item.createdAt ?? 0));
  }
  for (const item of runtime.archiveCards) {
    if (!active(item, currentRound)) continue;
    memories.push(entry(item, 'archive', item.title || item.arcTitle, item.summary,
      strings(item.keywords, item.entityRefs, item.arcTitle, item.timeSpan), item.sourceStartIndex ?? 0, item.archivedAt ?? item.createdAt ?? 0));
  }

  return memories.sort((left, right) => right.savedAt - left.savedAt || right.sourceFloor - left.sourceFloor);
}

// 事件 ID 选择器 —— 下拉事件列表 + 自定义兜底。
// 事件 = canonical v2 索引条目，对应一个 CardWorkflowDefinition。
// 数据来源：
//   1. 当前事件包的 schema/events.json
//   2. 关联世界的所有事件包的 schema/events.json（按包分组）
import { useEffect, useState } from 'react';
import { getWebEvent, allWebEvents } from '../../modules/eventDb';
import type { WebEventRecord } from '../../modules/eventDb';
import type { WorldDef } from '../../data/worlds-schema';
import { readCanonicalEventPack } from '../../modules/eventPackFormat';

interface Props {
  value?: string;
  eventPackId?: string;
  /** 关联世界：从该世界的所有事件包读取事件 */
  worldDef?: WorldDef;
  onChange: (eventId: string, eventPackId?: string) => void;
}

const CUSTOM_SENTINEL = '__CUSTOM_EVENT__';

const selectStyle: React.CSSProperties = {
  padding: '8px 10px',
  minHeight: 40,
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
  background: 'var(--bg-primary)',
  color: 'var(--text-primary)',
  fontSize: 'var(--font-size-sm)',
  fontFamily: 'var(--font-body)',
  width: '100%',
  boxSizing: 'border-box',
};

interface EventOption {
  id: string;
  name: string;
  nodeCount: number;
  packName: string;
  packId: string;
}

export function getEventPackWorldId(pack: Pick<WebEventRecord, 'worldId' | 'manifest'>): string | undefined {
  return pack.worldId ?? pack.manifest.worldId;
}

export function isCardEventPack(pack: Pick<WebEventRecord, 'manifest'>): boolean {
  return pack.manifest.type === 'card';
}

/** 从一个事件包的 IndexedDB 记录中提取事件列表 */
async function extractEventsFromPack(packId: string): Promise<EventOption[]> {
  const rec = await getWebEvent(packId);
  if (!rec || !isCardEventPack(rec)) return [];
  try {
    const pack = readCanonicalEventPack(rec.files);
    const packName = pack.index.name ?? rec.manifest?.name ?? packId;
    return pack.index.events.map((event, index) => ({
      id: event.id,
      name: event.name,
      nodeCount: pack.workflows[index].nodes.length,
      packName,
      packId,
    }));
  } catch (error) {
    console.error('[EventIdSelect] 事件包读取失败:', packId, error);
    return [];
  }
}

export default function EventIdSelect({ value, eventPackId, worldDef, onChange }: Props) {
  const [events, setEvents] = useState<EventOption[]>([]);

  useEffect(() => {
    (async () => {
      const all: EventOption[] = [];

      // 1. 当前事件包的事件
      if (eventPackId) {
        all.push(...await extractEventsFromPack(eventPackId));
      }

      // 2. 关联世界的所有事件包的事件（去重）
      if (worldDef?.id) {
        const packs = await allWebEvents();
        for (const pack of packs) {
          if (isCardEventPack(pack) && getEventPackWorldId(pack) === worldDef.id && pack.id !== eventPackId) {
            all.push(...await extractEventsFromPack(pack.id));
          }
        }
      }

      // 去重（同 id 只保留第一个）
      const seen = new Set<string>();
      const deduped: EventOption[] = [];
      for (const ev of all) {
        if (!seen.has(ev.id)) {
          seen.add(ev.id);
          deduped.push(ev);
        }
      }

      setEvents(deduped);
    })();
  }, [eventPackId, worldDef?.id]);

  const known = events.some((e) => e.id === value);
  const [forceCustom, setForceCustom] = useState(false);

  useEffect(() => {
    if (forceCustom && known) setForceCustom(false);
  }, [known, forceCustom]);

  const showCustom = forceCustom && !known;

  if (showCustom) {
    return (
      <input
        value={value ?? ''}
        placeholder="事件 ID"
        onChange={(e) => onChange(e.target.value)}
        style={selectStyle}
      />
    );
  }

  // 建立 eventId → packId 映射
  const eventPackMap = new Map(events.map((ev) => [ev.id, ev.packId]));

  // 按 packName 分组
  const groups = new Map<string, EventOption[]>();
  for (const ev of events) {
    if (!groups.has(ev.packName)) groups.set(ev.packName, []);
    groups.get(ev.packName)!.push(ev);
  }

  return (
    <select
      value={known ? (value ?? '') : ''}
      onChange={(e) => {
        if (e.target.value === CUSTOM_SENTINEL) {
          setForceCustom(true);
          onChange('');
          return;
        }
        const selectedId = e.target.value;
        onChange(selectedId, eventPackMap.get(selectedId));
      }}
      style={selectStyle}
    >
      <option value="">（选择事件）</option>
      {Array.from(groups.entries()).map(([pack, evts]) => (
        <optgroup key={pack} label={pack}>
          {evts.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {ev.name}（{ev.nodeCount} 个节点）
            </option>
          ))}
        </optgroup>
      ))}
      <option value={CUSTOM_SENTINEL}>自定义…</option>
    </select>
  );
}

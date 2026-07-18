// 事件 ID 选择器 —— 下拉事件列表 + 自定义兜底。
// 事件 = EventDef（最小单位），包含 cards[] / rules[] / worldbook[]。
// 数据来源：
//   1. 当前事件包的 schema/events.json
//   2. 关联世界的所有事件包的 schema/events.json（按包分组）
import { useEffect, useState } from 'react';
import { getWebEvent, allWebEvents } from '../../modules/eventDb';
import type { EventPackFile } from '../../modules/schema';
import type { WorldDef } from '../../data/worlds-schema';

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
  cardCount: number;
  packName: string;
  packId: string;
}

/** 从一个事件包的 IndexedDB 记录中提取事件列表 */
async function extractEventsFromPack(packId: string): Promise<EventOption[]> {
  const rec = await getWebEvent(packId);
  if (!rec) return [];
  const evRaw = rec.files['schema/events.json'];
  if (typeof evRaw !== 'string') return [];
  try {
    const file = JSON.parse(evRaw) as EventPackFile;
    const packName = file.name ?? rec.manifest?.name ?? packId;
    return (file.events ?? []).map((ev) => ({
      id: ev.id,
      name: ev.name ?? ev.id,
      cardCount: ev.cards?.length ?? 0,
      packName,
      packId,
    }));
  } catch {
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
          if (pack.worldId === worldDef.id && pack.id !== eventPackId) {
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
              {ev.name}（{ev.cardCount} 张卡片）
            </option>
          ))}
        </optgroup>
      ))}
      <option value={CUSTOM_SENTINEL}>自定义…</option>
    </select>
  );
}

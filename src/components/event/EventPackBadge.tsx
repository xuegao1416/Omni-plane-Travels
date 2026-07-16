// ============================================================
// 事件包顶层徽章（P0#1 标签正名）
//
// 问题：事件库/已装列表的顶层徽章曾用 <EventTypeBadge type={meta.type} /> 直接拿
//   PACK 的「内容类型」(computePackType 推断：装满卡片→'card') 当包标签，导致装满卡片的
//   事件包被打成「卡片」。
// 修正：顶层统一标【事件包】主 pill，次级标【内容构成 chips】，全部由各包真实
//   EventPackFile 内容派生（含卡片 / 含周期 / 含世界书 / 含规则）。
//   数据来源：懒加载 getWebEvent(packId).files → parseEventPackFile → derivePackFlags。
//
// EventListRow（已装）/ EventLibrary（发现）共用本组件，消除重复。
// 仅 Lucide 图标、零 emoji、全项目 Token。
// ============================================================
import { useEffect, useState, type CSSProperties } from 'react';
import { Package, FileText, Repeat, BookOpen, Spline, type LucideIcon } from 'lucide-react';
import { getWebEvent } from '../../modules/eventDb';
import type { EventPackFile, CardDef } from '../../modules/schema';

/** 事件包内容构成标记（库顶层徽章与筛选共用同一派生口径） */
export interface EventPackFlags {
  hasCards: boolean;
  hasPeriodic: boolean;
  hasWorldbook: boolean;
  hasRules: boolean;
  /** 包内事件数（>1 即「合集」语义） */
  eventCount: number;
}

export const EMPTY_FLAGS: EventPackFlags = {
  hasCards: false,
  hasPeriodic: false,
  hasWorldbook: false,
  hasRules: false,
  eventCount: 0,
};

/** 由 EventPackFile 推导内容构成标记（遍历各事件 cards/rules/worldbook + 包级 periodic/worldbook） */
export function derivePackFlags(file: EventPackFile | null | undefined): EventPackFlags {
  if (!file) return { ...EMPTY_FLAGS };
  const events = file.events ?? [];
  let cards = 0;
  let rules = 0;
  let wb = 0;
  for (const ev of events) {
    cards += ev.cards?.length ?? 0;
    rules += ev.rules?.length ?? 0;
    wb += ev.worldbook?.length ?? 0;
  }
  wb += file.worldbook?.length ?? 0;
  return {
    hasCards: cards > 0,
    hasPeriodic: (file.periodicRules?.length ?? 0) > 0,
    hasWorldbook: wb > 0,
    hasRules: rules > 0,
    eventCount: events.length,
  };
}

const OPT_EVENTS_INDEX = 'schema/events.json';

/** 从 WebEventRecord.files 解析出 EventPackFile；兼容旧包（仅 schema/card.json，包成单事件） */
export function parseEventPackFile(files: Record<string, string | Blob> | undefined): EventPackFile | null {
  if (!files) return null;
  const idxRaw = files[OPT_EVENTS_INDEX];
  if (typeof idxRaw === 'string') {
    try {
      return JSON.parse(idxRaw) as EventPackFile;
    } catch {
      /* 索引损坏：回退旧包 */
    }
  }
  const cRaw = files['schema/card.json'];
  if (typeof cRaw === 'string') {
    try {
      const cf = JSON.parse(cRaw) as { cards?: CardDef[] };
      return { version: 1, events: [{ id: 'legacy', name: '旧版卡片', cards: cf.cards ?? [] }] };
    } catch {
      /* 跳过 */
    }
  }
  return null;
}

/** 中性 pill 基础样式（无渐变，仅 Token） */
const PILL: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '2px 8px',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--font-size-xs)',
  fontWeight: 600,
  whiteSpace: 'nowrap',
  lineHeight: 1.4,
};

interface EventPackBadgeProps {
  /** 事件包 id（= manifest.id = WebEventRecord.id） */
  packId: string;
  /** 可选：预解析的构成标记。提供后跳过懒加载，直接渲染。 */
  flags?: EventPackFlags;
}

/**
 * 事件包顶层徽章：主 pill「事件包」+ 次级「内容构成 chips」。
 * 构成由包的真实 EventPackFile 内容派生，不再误用 PACK 的 content-type 单一字段。
 */
export default function EventPackBadge({ packId, flags: flagsProp }: EventPackBadgeProps) {
  const [flags, setFlags] = useState<EventPackFlags | null>(flagsProp ?? null);
  const [loading, setLoading] = useState(!flagsProp);

  useEffect(() => {
    if (flagsProp) {
      setFlags(flagsProp);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const rec = await getWebEvent(packId);
        if (cancelled) return;
        setFlags(derivePackFlags(rec ? parseEventPackFile(rec.files) : null));
      } catch {
        if (!cancelled) setFlags({ ...EMPTY_FLAGS });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [packId, flagsProp]);

  const chips: { key: string; label: string; Icon: LucideIcon }[] = [];
  if (flags?.hasCards) chips.push({ key: 'cards', label: '含卡片', Icon: FileText });
  if (flags?.hasPeriodic) chips.push({ key: 'periodic', label: '含周期', Icon: Repeat });
  if (flags?.hasWorldbook) chips.push({ key: 'worldbook', label: '含世界书', Icon: BookOpen });
  if (flags?.hasRules) chips.push({ key: 'rules', label: '含规则', Icon: Spline });

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-1)',
        flexWrap: 'wrap',
        flexShrink: 0,
      }}
    >
      {/* 主 pill：事件包（中性，始终展示） */}
      <span style={{ ...PILL, background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
        <Package size={12} strokeWidth={2} />
        事件包
      </span>
      {/* 次级构成 chips：仅展示存在的构成项，零 emoji */}
      {!loading &&
        chips.map(({ key, label, Icon }) => (
          <span
            key={key}
            style={{ ...PILL, background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
          >
            <Icon size={12} strokeWidth={2} />
            {label}
          </span>
        ))}
    </span>
  );
}

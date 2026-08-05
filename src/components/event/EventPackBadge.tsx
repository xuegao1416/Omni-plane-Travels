// ============================================================
// 事件包顶层徽章（P0#1 标签正名）
//
// 问题：事件库/已装列表的顶层徽章曾用 <EventTypeBadge type={meta.type} /> 直接拿
//   PACK 的「内容类型」(computePackType 推断：装满卡片→'card') 当包标签，导致装满卡片的
//   事件包被打成「卡片」。
// 修正：顶层统一标【事件包】主 pill，次级标【内容构成 chips】，全部由各包真实
//   canonical workflow 与 rules.json 内容派生（含节点 / 含周期 / 含规则）。
//   数据来源：懒加载 getWebEvent(packId).files → parseCanonicalPackView → derivePackFlags。
//
// EventListRow（已装）/ EventLibrary（发现）共用本组件，消除重复。
// 仅 Lucide 图标、零 emoji、全项目 Token。
// ============================================================
import { useEffect, useState, type CSSProperties } from 'react';
import { Package, FileText, Repeat, BookOpen, Spline, type LucideIcon } from 'lucide-react';
import { getWebEvent } from '../../modules/eventDb';
import type { RuleFile } from '../../modules/schema';
import { readCanonicalEventPack, type CanonicalEventPackView } from '../../modules/eventPackFormat';

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

export interface ParsedEventPack {
  view: CanonicalEventPackView;
  rules: RuleFile | null;
}

/** 由 canonical workflow 与独立 rules.json 推导内容构成标记。 */
export function derivePackFlags(file: ParsedEventPack | null | undefined): EventPackFlags {
  if (!file) return { ...EMPTY_FLAGS };
  return {
    hasCards: file.view.workflowNodeCount > 0,
    hasPeriodic: (file.rules?.periodicRules?.length ?? 0) > 0,
    hasWorldbook: false,
    hasRules: (file.rules?.rules?.length ?? 0) > 0,
    eventCount: file.view.eventCount,
  };
}

/** 保留现有调用形状，但只解析 canonical v2；旧格式由导入迁移层负责。 */
export function parseCanonicalPackView(files: Record<string, string | Blob> | undefined): ParsedEventPack | null {
  if (!files) return null;
  const view = readCanonicalEventPack(files);
  let rules: RuleFile | null = null;
  const rulesRaw = files['schema/rules.json'];
  if (typeof rulesRaw === 'string') {
    const parsed = JSON.parse(rulesRaw) as Partial<RuleFile>;
    if (Array.isArray(parsed.rules) && Array.isArray(parsed.periodicRules)) {
      rules = parsed as RuleFile;
    }
  }
  return { view, rules };
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
 * 构成由包的 canonical workflow 内容派生，不再误用 PACK 的 content-type 单一字段。
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
        setFlags(derivePackFlags(rec ? parseCanonicalPackView(rec.files) : null));
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

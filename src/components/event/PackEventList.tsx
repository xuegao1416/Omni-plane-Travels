// ============================================================
// 事件包内事件清单（3 级层级：事件库/已装列表 → 事件包 → 事件 → 卡片）
//
// 职责：给定一个事件包 id，读取其 WebEventRecord.files 中的
//   - schema/events.json     → canonical v2 元数据索引
//   - schema/event-<id>.json → CardWorkflowDefinition
// 并渲染为「事件（tier2，name + 卡片数）」列表，每个事件可展开显示其
// 「卡片（tier3）」。事件与卡片是两层结构，不再把卡片拍平成事件。
//
// 设计要点：
//   - 只读存储，不修改任何数据（getWebEvent 为 eventDb 既有 API）。
//   - 懒加载：仅在父级展开时由 effect 触发一次 fetch。
//   - 容错：索引解析失败不影响其它；包未安装 / 无内容均有明确空态。
//   - EventListRow（已装）/ EventLibrary（发现）共用本组件，行为一致。
// ============================================================
import { useEffect, useState } from 'react';
import { Loader2, Layers, AlertTriangle, PackageX, ListTree, ChevronRight } from 'lucide-react';
import { getWebEvent } from '../../modules/eventDb';
import type { CardWorkflowDefinition, EventIndexEntry, PeriodicRule, RuleFile } from '../../modules/schema';
import { readCanonicalEventPack } from '../../modules/eventPackFormat';

interface PackEventEntry {
  entry: EventIndexEntry;
  workflow: CardWorkflowDefinition;
}

interface PackEventView {
  events: PackEventEntry[];
  periodicRules: PeriodicRule[];
}

/** 严格解析 canonical v2 事件包，并从 rules.json 单独读取周期规则。 */
function parseCanonicalEvents(files: Record<string, string | Blob>): PackEventView {
  const pack = readCanonicalEventPack(files);
  let periodicRules: PeriodicRule[] = [];
  const rulesRaw = files['schema/rules.json'];
  if (typeof rulesRaw === 'string') {
    try {
      const rules = JSON.parse(rulesRaw) as Partial<RuleFile>;
      if (Array.isArray(rules.periodicRules)) periodicRules = rules.periodicRules;
    } catch {
      /* rules.json 的错误不掩盖已经通过严格校验的卡片工作流。 */
    }
  }
  return {
    events: pack.index.events.map((entry, index) => ({ entry, workflow: pack.workflows[index] })),
    periodicRules,
  };
}

interface PackEventListProps {
  /** 事件包 id（= WebEventRecord.id = manifest.id） */
  packId: string;
}

/** 事件包内事件清单组件：展开时惰性读取并解析包内容，呈现 事件 → 卡片 两级。 */
export default function PackEventList({ packId }: PackEventListProps) {
  const [view, setView] = useState<PackEventView | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotFound(false);
    void (async () => {
      try {
        const rec = await getWebEvent(packId);
        if (cancelled) return;
        if (!rec) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        setView(parseCanonicalEvents(rec.files));
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : '读取事件包内容失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [packId]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>
        <Loader2 size={16} className="event-spin" /> 读取事件包内容…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--danger)', fontSize: 'var(--font-size-sm)' }}>
        <AlertTriangle size={16} /> {error}
      </div>
    );
  }

  if (notFound) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>
        <PackageX size={16} /> 尚未安装，导入 .opt-event 后可查看事件内容。
      </div>
    );
  }

  if (!view || view.events.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>
        <ListTree size={16} /> 该事件包暂未包含事件（可含周期规则，见下）。
      </div>
    );
  }

  return (
    <div>
      {view.periodicRules.length > 0 && (
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
          包级周期规则 {view.periodicRules.length} 条（与事件平级，每 tick 静默结算）
        </div>
      )}
      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
        共 {view.events.length} 个事件
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {view.events.map((event) => (
          <EventRow key={event.entry.id} event={event} />
        ))}
      </ul>
    </div>
  );
}

// ─── Tier 2：事件（name + 卡片数），可展开 ───
function EventRow({ event }: { event: PackEventEntry }) {
  const [open, setOpen] = useState(false);
  const nodes = event.workflow.nodes;
  return (
    <li
      style={{
        background: 'var(--bg-primary)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}
    >
      <div
        onClick={() => setOpen((o) => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '8px 10px', cursor: 'pointer' }}
      >
        <ChevronRight
          size={16}
          style={{ color: 'var(--text-secondary)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform var(--duration-fast) var(--ease-out)', flexShrink: 0 }}
        />
        <Layers size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <span style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {event.entry.name || '(未命名事件)'}
        </span>
        <span style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', padding: '2px 8px' }}>
          {nodes.length} 个节点
        </span>
      </div>
      {open && <WorkflowNodesTier workflow={event.workflow} />}
    </li>
  );
}

// ─── Tier 3：事件工作流节点摘要 ───
function WorkflowNodesTier({ workflow }: { workflow: CardWorkflowDefinition }) {
  if (workflow.nodes.length === 0) {
    return (
      <div style={{ padding: '8px 10px 10px 34px', fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
        该事件暂无工作流节点
      </div>
    );
  }
  return (
    <ul
      style={{
        listStyle: 'none',
        margin: 0,
        padding: '0 10px 10px 34px',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
        borderTop: '1px solid var(--border)',
      }}
    >
      {workflow.nodes.map((node) => (
        <li
          key={node.id}
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '5px 8px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}
        >
          <CardTypeBadge type={node.typeId} />
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {node.label || node.typeId}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>{node.id}</span>
        </li>
      ))}
    </ul>
  );
}

const CARD_TYPE_META: Record<string, { label: string; color: string }> = {
  'narrative.title': { label: '标题', color: 'var(--accent)' },
  'narrative.text': { label: '叙述', color: 'var(--text-secondary)' },
  'choice.static': { label: '选择', color: 'var(--warning)' },
};

function CardTypeBadge({ type }: { type?: string }) {
  const meta = (type && CARD_TYPE_META[type]) || { label: type || '节点', color: 'var(--text-muted)' };
  return (
    <span
      style={{
        flexShrink: 0,
        fontSize: 'var(--font-size-xs)',
        fontWeight: 600,
        color: meta.color,
        background: 'var(--bg-tertiary)',
        borderRadius: 'var(--radius-sm)',
        padding: '1px 6px',
        whiteSpace: 'nowrap',
      }}
    >
      {meta.label}
    </span>
  );
}

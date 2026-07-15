// ============================================================
// 卡片渲染器 — 按编辑器实际导出的 CardFile 形状渲染。
//   形状来源：CardEditor.toCardFile() → schema/card.json，即
//   { version, puck:{ root, components:{ title[],narrative[],choice[],stat[] } }, cards:[{id,componentId,title,kind}] }
//   其中 props 落在 puck.components[类型] 的组件里；渲染顺序以 cards 数组为准
//   （保留编辑器拖拽顺序），props 再按 id 回到对应组件。
//   仅用 tokens.css 现有变量（--bg-elevated/--border/--text-*/--accent），不新造色。
// ============================================================
import { FileText, ScrollText, ListChecks } from 'lucide-react';
import type { CardFile, ChoiceOption, ChoiceEffect } from '../../modules/schema';

type BlockType = 'title' | 'narrative' | 'choice';

export interface CardBlockView {
  id: string;
  type: BlockType;
  props: Record<string, unknown>;
}

/** 从 CardFile 解析出有序 block 列表（顺序以 cards 数组为准）。 */
export function cardFileToBlocks(file: CardFile): CardBlockView[] {
  if (!file?.puck?.components) return [];
  const comps = file.puck.components;
  const out: CardBlockView[] = [];
  for (const c of file.cards ?? []) {
    const group = comps[c.componentId] ?? [];
    const comp = group.find((g) => g.id === c.id) ?? group[0];
    if (!comp) continue;
    out.push({ id: c.id, type: c.componentId as BlockType, props: (comp.props ?? {}) as Record<string, unknown> });
  }
  // 兜底：某些来源把 blocks 直接放在 components 而没有 cards 索引时，按类型顺序补回
  if (out.length === 0) {
    for (const t of Object.keys(comps) as BlockType[]) {
      for (const comp of comps[t] ?? []) {
        out.push({ id: comp.id, type: t, props: (comp.props ?? {}) as Record<string, unknown> });
      }
    }
  }
  return out;
}

const TYPE_ICON = {
  title: FileText,
  narrative: ScrollText,
  choice: ListChecks,
} as const;

export interface CardRendererProps {
  blocks: CardBlockView[];
  /** 选择卡被点击时回调（单选：传 blockId + 选项 index） */
  onChoice?: (blockId: string, index: number) => void;
  /** 各选择块当前选中的选项 index（key = blockId），由父组件持有 */
  selectedByBlock?: Record<string, number>;
  /** 各选择块选中那一刻的 stat 基准值（key = blockId），用于预览 */
  baseByBlock?: Record<string, number>;
}

export default function CardRenderer({ blocks, onChoice, selectedByBlock, baseByBlock }: CardRendererProps) {
  if (!blocks || blocks.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {blocks.map((b) => (
        <BlockView key={b.id} block={b} onChoice={onChoice} selectedByBlock={selectedByBlock} baseByBlock={baseByBlock} />
      ))}
    </div>
  );
}

function BlockView({ block, onChoice, selectedByBlock, baseByBlock }: { block: CardBlockView; onChoice?: (blockId: string, index: number) => void; selectedByBlock?: Record<string, number>; baseByBlock?: Record<string, number> }) {
  const Icon = TYPE_ICON[block.type] ?? FileText;
  return (
    <div
      style={{
        marginBottom: 'var(--space-3)',
        padding: 'var(--space-3)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border)',
        background: 'var(--bg-secondary)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>
        <Icon size={14} style={{ color: 'var(--accent)' }} />
        {BLOCK_LABEL[block.type]}
      </div>
      <BlockBody block={block} onChoice={onChoice} selectedByBlock={selectedByBlock} baseByBlock={baseByBlock} />
    </div>
  );
}

const BLOCK_LABEL: Record<BlockType, string> = {
  title: '标题',
  narrative: '叙述',
  choice: '选择',
};

/** 把 choice.props.choices 的元素（旧版 string 或新版 ChoiceOption）统一成 ChoiceOption。 */
function normalizeChoice(c: unknown): ChoiceOption {
  if (typeof c === 'string') return { label: c };
  if (c && typeof c === 'object') {
    const o = c as Record<string, unknown>;
    const label = typeof o.label === 'string' ? o.label : String(o.label ?? '');
    const effect = o.effect && typeof o.effect === 'object' ? (o.effect as ChoiceEffect) : undefined;
    const aiNote = typeof o.aiNote === 'string' ? o.aiNote : undefined;
    return { label, effect, aiNote };
  }
  return { label: String(c ?? '') };
}

/** 预览文本：基准值 + delta → 结果（相对选中那一刻基准，不累加）。 */
function renderChoicePreview(base: number, effect: ChoiceEffect): string {
  const delta = effect.delta ?? 0;
  const after = base + delta;
  const sign = delta >= 0 ? '+' : '';
  return `${effect.statId} ${base} ${sign}${delta} → ${after}`;
}

function BlockBody({ block, onChoice, selectedByBlock, baseByBlock }: { block: CardBlockView; onChoice?: (blockId: string, index: number) => void; selectedByBlock?: Record<string, number>; baseByBlock?: Record<string, number> }) {
  switch (block.type) {
    case 'title':
      return (
        <div style={{ fontWeight: 700, fontSize: 'var(--font-size-lg)', color: 'var(--accent)', fontFamily: 'var(--font-display)' }}>
          {String(block.props.title ?? '')}
        </div>
      );
    case 'narrative':
      return (
        <div style={{ lineHeight: 1.7, fontSize: 'var(--font-size-base)', color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
          {String(block.props.text ?? '')}
        </div>
      );
    case 'choice': {
      const raw = Array.isArray(block.props.choices) ? (block.props.choices as unknown[]) : [];
      const options = raw.map(normalizeChoice);
      const selectedIdx = selectedByBlock?.[block.id];
      return (
        <div className="action-options-grid">
          {options.length === 0 && (
            <div className="action-option-card" style={{ cursor: 'default' }}>（无选项）</div>
          )}
          {options.map((opt, i) => {
            const selected = selectedIdx === i;
            const preview =
              selected && opt.effect && typeof opt.effect.statId === 'string' && opt.effect.statId.length > 0
                ? renderChoicePreview(baseByBlock?.[block.id] ?? 0, opt.effect)
                : null;
            return (
              <div
                key={i}
                className={`action-option-card${selected ? ' selected' : ''}`}
                role="radio"
                aria-checked={selected}
                tabIndex={0}
                onClick={() => onChoice?.(block.id, i)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChoice?.(block.id, i); } }}
              >
                <div className="action-option-card-title">{opt.label || `选项 ${i + 1}`}</div>
                {opt.effect && typeof opt.effect.statId === 'string' && opt.effect.statId.length > 0 && (
                  <div className="action-option-card-desc">
                    {opt.effect.statId} {opt.effect.delta >= 0 ? '+' : ''}{opt.effect.delta}
                  </div>
                )}
                {preview && (
                  <div className="action-option-preview">{preview}</div>
                )}
              </div>
            );
          })}
        </div>
      );
    }
    default:
      return null;
  }
}

import type { SVGProps } from 'react';
import type { SlotKind } from '../../../domains/equipment/slots';

/**
 * 代码绘制的部位图标（24×24 描边，与 lucide 同一套线宽与圆角），
 * 纸娃娃插槽、装备环与行囊格子共用；颜色跟随 currentColor。
 */
export type GlyphKind = SlotKind | 'accessory2' | 'bag';

const PATHS: Record<GlyphKind, React.ReactNode> = {
  weapon: (
    <>
      <path d="M20.5 3.5v4L11 17l-4-4 9.5-9.5z" />
      <path d="M5.5 11.5l7 7" />
      <path d="M8 16l-3.7 3.7" />
      <circle cx="3.6" cy="20.4" r="1.1" />
      <path d="M18.2 5.8L10 14" opacity=".55" />
    </>
  ),
  head: (
    <>
      <path d="M4.5 16a7.5 7.5 0 0 1 15 0v3h-15z" />
      <path d="M4.5 15.5h15" />
      <path d="M12 4.2V8" />
      <path d="M8.5 15.5v3.5M15.5 15.5v3.5" opacity=".55" />
    </>
  ),
  hands: (
    <>
      <path d="M8 3.5h8l1.2 5.5L16 20.5H8L6.8 9z" />
      <path d="M7.2 8.5h9.6" />
      <path d="M7.6 13.5h8.8" opacity=".6" />
      <path d="M10 17h4" opacity=".6" />
    </>
  ),
  chest: (
    <>
      <path d="M6.5 4l3 1.8h5l3-1.8 2.5 3.6-2 2.2v10.7h-12V9.8l-2-2.2z" />
      <path d="M12 6v14.5" opacity=".6" />
      <path d="M8.5 12.5h7M8.8 16h6.4" opacity=".5" />
    </>
  ),
  legs: (
    <>
      <path d="M7 3.5h10l-1.2 17h-3.3L12 10l-.5 10.5H8.2z" />
      <path d="M7.1 7h9.8" opacity=".6" />
      <path d="M9.6 14.5h-1.7M14.4 14.5h1.7" opacity=".55" />
    </>
  ),
  feet: (
    <>
      <path d="M7.5 3.5h5.5v9.2l5.6 2.7a2.2 2.2 0 0 1 1.3 2V20H5.8v-6.6z" />
      <path d="M5.8 20h14.1" />
      <path d="M8 9h4.6" opacity=".55" />
    </>
  ),
  accessory: (
    <>
      <path d="M5 3.5c0 6 3.2 9.2 7 9.2s7-3.2 7-9.2" />
      <path d="M12 12.7l2.6 3.4-2.6 4.4-2.6-4.4z" />
      <circle cx="12" cy="16.4" r=".7" opacity=".6" />
    </>
  ),
  accessory2: (
    <>
      <circle cx="12" cy="14.5" r="6" />
      <circle cx="12" cy="14.5" r="3.8" opacity=".5" />
      <path d="M9.6 7.2L12 3.8l2.4 3.4L12 9.2z" />
    </>
  ),
  bag: (
    <>
      <rect x="5" y="7" width="14" height="14" rx="3" />
      <path d="M9 7V5.5a3 3 0 0 1 6 0V7" />
      <path d="M8.5 13.5h7v4h-7z" opacity=".65" />
      <path d="M5 11h14" opacity=".45" />
    </>
  ),
};

export function SlotGlyph({ kind, size, strokeWidth = 1.6, ...props }: { kind: GlyphKind; size?: number | string; strokeWidth?: number } & Omit<SVGProps<SVGSVGElement>, 'children'>) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
      {PATHS[kind]}
    </svg>
  );
}

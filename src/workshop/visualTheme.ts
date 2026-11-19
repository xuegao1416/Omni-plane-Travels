/**
 * visualTheme.ts — 应用创意工坊的视觉主题。
 *
 * 主题只能改 --d-* 颜色变量（与 src/ui/planar 的两套主题共用的色板），值统一换算成 “r, g, b”。
 * 通过一个 <style> 注入，夜色（默认）与晨光主题分别覆盖；选择器的优先级高于主题自身的定义，
 * 所以不需要 !important。取消主题即移除这个 <style>。
 */
import { RUNTIME_ASSETS_CHANGED, getWorkshopRuntimeAsset, type StoredWorkshopRuntimeAsset } from './runtimeAssets';

const STYLE_ID = 'omni-workshop-visual-theme';
const ACTIVE_KEY = 'omni.workshop.activeTheme.v1';
export const VISUAL_THEME_CHANGED = 'workshop-visual-theme-changed';

const TOKEN_PATTERN = /^--d-[a-z0-9-]{1,40}$/;

export interface ThemePalettes {
  night: Record<string, string>;
  dawn: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** #rgb / #rrggbb / “r, g, b” → “r, g, b”；其他写法返回 null。 */
export function toRgbTriple(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].split('').map(char => char + char).join('') : hex[1];
    return [0, 2, 4].map(offset => parseInt(digits.slice(offset, offset + 2), 16)).join(', ');
  }
  const triple = text.match(/^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/);
  if (triple && triple.slice(1).every(part => Number(part) <= 255)) return triple.slice(1).join(', ');
  return null;
}

function cleanPalette(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [token, raw] of Object.entries(value)) {
    const rgb = toRgbTriple(raw);
    if (TOKEN_PATTERN.test(token) && rgb) out[token] = rgb;
  }
  return out;
}

/** tokens / variables / theme 对两套主题都生效；themes.night、themes.dawn 分别覆盖。 */
export function themePalettes(data: unknown): ThemePalettes {
  const source = isRecord(data) ? data : {};
  const shared = { ...cleanPalette(source.theme), ...cleanPalette(source.variables), ...cleanPalette(source.tokens) };
  const themes = isRecord(source.themes) ? source.themes : {};
  return { night: { ...shared, ...cleanPalette(themes.night) }, dawn: { ...shared, ...cleanPalette(themes.dawn) } };
}

function block(selector: string, palette: Record<string, string>): string {
  const entries = Object.entries(palette);
  return entries.length ? `${selector} {\n${entries.map(([token, value]) => `  ${token}: ${value};`).join('\n')}\n}\n` : '';
}

export function themeCss(palettes: ThemePalettes): string {
  return block(":root:not([data-ui-theme='dawn'])", palettes.night) + block(":root:root[data-ui-theme='dawn']", palettes.dawn);
}

export function getActiveVisualThemeId(): string | null {
  try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; }
}

function setActiveId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch { /* 存储不可用时只在本次会话生效 */ }
}

function applyCss(css: string): void {
  if (typeof document === 'undefined') return;
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!css) {
    style?.remove();
    return;
  }
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
  }
  style.textContent = css;
  // 始终放在 <head> 最后，保证在主题样式之后。
  document.head.appendChild(style);
}

export function applyVisualTheme(asset: Pick<StoredWorkshopRuntimeAsset, 'data'> | null | undefined): void {
  applyCss(asset ? themeCss(themePalettes(asset.data)) : '');
}

/** 启用（或传 null 取消）某个已安装的视觉主题。 */
export async function activateVisualTheme(id: string | null): Promise<void> {
  const asset = id ? await getWorkshopRuntimeAsset(id) : undefined;
  if (id && (!asset || asset.type !== 'visual_theme')) throw new Error('找不到这个视觉主题，可能已被删除');
  setActiveId(asset ? asset.id : null);
  applyVisualTheme(asset);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(VISUAL_THEME_CHANGED));
}

/** 启动时恢复上次启用的主题；主题被删或被编辑时自动跟着变。 */
export async function restoreVisualTheme(): Promise<void> {
  const sync = async () => {
    const id = getActiveVisualThemeId();
    if (!id) return applyVisualTheme(null);
    const asset = await getWorkshopRuntimeAsset(id).catch(() => undefined);
    if (!asset || asset.type !== 'visual_theme') {
      setActiveId(null);
      applyVisualTheme(null);
      return;
    }
    applyVisualTheme(asset);
  };
  await sync();
  if (typeof window !== 'undefined') window.addEventListener(RUNTIME_ASSETS_CHANGED, () => { void sync(); });
}

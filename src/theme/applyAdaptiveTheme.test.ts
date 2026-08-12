import { describe, expect, test } from 'bun:test';
import { applyAdaptiveTheme } from './applyAdaptiveTheme';

describe('applyAdaptiveTheme', () => {
  test('writes skin, mode, and CSS variables to the root element', () => {
    const cssVariables: Record<string, string> = {};
    const root = {
      dataset: {} as DOMStringMap,
      style: {
        setProperty(name: string, value: string) {
          cssVariables[name] = value;
        },
        getPropertyValue(name: string) {
          return cssVariables[name] ?? '';
        },
      },
    } as unknown as HTMLElement;

    applyAdaptiveTheme(root, {
      skinId: 'crystal-cyber',
      mode: 'dark',
      tokens: { accent: '#5ee7ff', surface: '#10152a' },
    } as any);

    expect(root.dataset.worldSkin).toBe('crystal-cyber');
    expect(root.dataset.themeMode).toBe('dark');
    expect(root.style.getPropertyValue('--theme-accent')).toBe('#5ee7ff');
    expect(root.style.getPropertyValue('--theme-surface')).toBe('#10152a');
  });
});

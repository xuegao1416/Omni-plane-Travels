import { describe, expect, test } from 'bun:test';
import { createPresetArtwork, resolveWorldArtwork } from './worldArtwork';
import { defaultForm, formToWorldDef } from '../components/start/worldEditorForm/types';

describe('world artwork compatibility', () => {
  test('prefers uploaded artwork over preset and builtin fallback', () => {
    const resolved = resolveWorldArtwork({ id: 'custom_one', artwork: { source: 'upload', dataUrl: 'data:image/webp;base64,AAAA' } });
    expect(resolved.source).toBe('upload');
    expect(resolved.src).toContain('data:image/webp');
  });

  test('prefers a selected preset for a custom world', () => {
    const resolved = resolveWorldArtwork({ id: 'custom_one', artwork: createPresetArtwork('wuxia_world') });
    expect(resolved.source).toBe('preset');
    expect(resolved.src).toContain('wuxia_world-scene.png');
  });

  test('old custom worlds without artwork use the neutral fallback', () => {
    const resolved = resolveWorldArtwork({ id: 'custom_old', artwork: undefined });
    expect(resolved.source).toBe('fallback');
    expect(resolved.src).toContain('common-journey-backdrop-v1.png');
  });

  test('artwork survives WorldDef form serialization', () => {
    const artwork = createPresetArtwork('border_trade');
    const world = formToWorldDef({ ...defaultForm, name: '测试世界', description: '一座雾中城市', artwork }, null, []);
    expect(world.artwork).toEqual(artwork);
  });
});

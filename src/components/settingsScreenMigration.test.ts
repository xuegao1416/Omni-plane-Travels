import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('settings screen Dawn V4 migration contract', () => {
  test('keeps the complete settings shell inside one Dawn surface', () => {
    const source = read('./SettingsScreen.tsx');
    const css = read('../styles/layout-settings.css');
    const general = read('./settings/GeneralSettingsTab.tsx');
    const api = read('./settings/ApiSettingsTab.tsx');
    const image = read('./settings/ImageGenSettingsTab.tsx');
    const preset = read('./settings/PresetSettingsTab.tsx');
    const frameStart = source.indexOf('<DawnFrameV4');
    const frameEnd = source.indexOf('</DawnFrameV4>');
    const frameSource = source.slice(frameStart, frameEnd);

    expect(source).toContain("import DawnFrameV4 from './shared/dawn/DawnFrameV4';");
    expect(source).not.toContain('settings-screen entry-default-theme');
    expect(source).toContain("'general' | 'api' | 'image' | 'preset'");
    expect(source).toContain('onClick={handleSave}');
    expect(source).toContain('onClick={goBack}');
    expect((source.match(/<DawnFrameV4/g) ?? []).length).toBe(1);
    expect(source).not.toContain('withUnderlay');
    expect(frameSource).toContain('settings-screen__header');
    expect(frameSource).toContain('settings-screen__body');
    expect(frameSource).toContain('settings-screen__scroll');
    expect(frameSource).toContain('settings-screen__footer');
    for (const tab of [general, api, image, preset]) {
      expect(tab).toContain('settings-tab-panel');
    }
    expect(general).not.toContain("maxWidth: '560px'");
    expect(api).not.toContain("maxWidth: '560px'");
    expect(css).toContain('.settings-screen__frame');
    expect(css).toMatch(/\.settings-screen__frame\s*\{[\s\S]*height:\s*calc\(100dvh/);
    expect(css).toMatch(/\.settings-screen__frame\s*>\s*\.dawn-frame-v4__content\s*\{[\s\S]*display:\s*grid/);
    expect(css).toMatch(/\.settings-screen__body\s*\{[\s\S]*grid-template-columns:\s*148px\s+minmax\(0,\s*1fr\)/);
    expect(css).toMatch(/\.settings-screen__scroll\s*\{[\s\S]*overflow:\s*auto/);
    expect(css).toMatch(/\.settings-tab-panel\s*\{[\s\S]*width:\s*100%;[\s\S]*min-width:\s*0/);
    expect(css).toContain('.settings-section--paper');
    expect(css).toMatch(/\.settings-section--paper[^}]*background:\s*transparent/);
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).toContain('env(safe-area-inset-bottom)');
  });
});

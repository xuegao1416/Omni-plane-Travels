import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const workshop = readFileSync(new URL('./WorkshopSettingsTab.tsx', import.meta.url), 'utf8');
const localAssets = readFileSync(new URL('./LocalAssetsTab.tsx', import.meta.url), 'utf8');

describe('旅者登记所资产管理', () => {
  test('创意工坊只保留类型按钮，不显示重复或无效筛选', () => {
    expect(workshop).not.toContain('玩法模块绑定世界');
    expect(workshop).not.toContain('全部分类');
    expect(workshop).not.toContain("['popular', '热门']");
    expect(workshop).not.toContain("['featured', '精选']");
  });

  test('每种本地资产都提供编辑入口', () => {
    expect(localAssets).toContain('handleEdit');
    expect(localAssets).toContain('<Pencil size={14} />编辑');
  });

  test('本地资产编辑复用原生编辑器并且不向玩家暴露 JSON', () => {
    expect(localAssets).toContain('<WorldEditorForm');
    expect(localAssets).toContain('<NpcEditorModal');
    expect(localAssets).toContain('<CardEditor');
    expect(localAssets).toContain('<WorkflowEditor');
    expect(localAssets).toContain('<StructuredAssetEditor');
    expect(localAssets).not.toContain('registry-asset-json');
    expect(localAssets).not.toContain('高级数据');
  });
});

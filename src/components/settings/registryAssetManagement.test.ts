import { describe,expect,test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';

const workshop = readFileSync(new URL('./WorkshopSettingsTab.tsx', import.meta.url), 'utf8');
const workshopBrowse = readFileSync(new URL('../workshop/WorkshopBrowse.tsx', import.meta.url), 'utf8');
const workshopUi = [workshop, workshopBrowse].join('\n');
const workshopDir = new URL('../workshop/', import.meta.url);
const workshopComponents = readdirSync(workshopDir).filter(name => name.endsWith('.tsx')).map(name => readFileSync(new URL(name, workshopDir), 'utf8'));
const workshopCss = readFileSync(new URL('../../ui/screens/workshop.css', import.meta.url), 'utf8');
const localAssets = readFileSync(new URL('./LocalAssetsTab.tsx', import.meta.url), 'utf8');

describe('旅者登记所资产管理', () => {
  test('创意工坊不显示重复或无效筛选：类型按钮之外只有服务端支持的排序', () => {
    expect(workshopUi).not.toContain('玩法模块绑定世界');
    // “分类”与类型重复，不提供分类筛选。
    expect(workshopUi).not.toContain('全部分类');
    expect(workshopUi).not.toContain("['popular', '热门']");
    expect(workshopUi).not.toContain("['featured', '精选']");
    // 排序选项只来自与服务端共用的 WORKSHOP_SORTS。
    expect(workshopBrowse).toContain('WORKSHOP_SORTS.map(');
    expect(workshopBrowse).toContain('PUBLIC_WORKSHOP_TYPES.map(');
  });

  test('创意工坊不使用原生弹窗，样式不写 !important', () => {
    expect(workshopComponents.length).toBeGreaterThan(5);
    for (const source of [workshop, ...workshopComponents]) {
      expect(source).not.toMatch(/(window\.)?\b(alert|confirm|prompt)\(/);
    }
    expect(workshopCss).not.toContain('!important');
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

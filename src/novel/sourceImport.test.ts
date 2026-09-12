import { describe, expect, test } from 'bun:test';
import { extractNovelStaticMaterial } from './sourceImport';

describe('novel source import', () => {
  test('reads the existing decomposition archive into reusable static material', () => {
    const material = extractNovelStaticMaterial({
      标题: '旧拆解档',
      世界背景: '围绕能源遗迹建立的浮空城市。',
      当前阶段概括: '浮空港进入封锁状态。',
      世界观规则: ['跃迁装置需要能量核心。'],
      势力档案: [{ 名称: '北岸议会', 立场目标: '维持港口秩序', 当前状态: '戒备' }],
      角色档案: [{ 名称: '洛安', 身份: '调查员', 状态摘要: ['正在查案'] }],
      地图地点档案: [{ 名称: '浮空港', 地貌功能: '交通枢纽' }],
    });

    expect(material.summary).toBe('围绕能源遗迹建立的浮空城市。');
    expect(material.rules).toEqual(['跃迁装置需要能量核心。']);
    expect(material.factions?.[0]).toMatchObject({ name: '北岸议会', description: '维持港口秩序' });
    expect(material.characters?.[0]?.description).not.toContain('正在查案');
    expect(material.characters?.[0]).toMatchObject({ name: '洛安', role: '调查员' });
  });
});

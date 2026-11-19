/**
 * `?plshot=workshop`（仅 localhost）：用内存数据渲染创意工坊，供两套主题的视觉检查。
 * 拦截 /api/workshop 请求并返回固定样例，不连接任何服务器。
 */
import { useEffect, useState } from 'react';
import WorkshopSettingsTab from '../components/settings/WorkshopSettingsTab';
import { useAuthStore } from '../stores/authStore';
import type { WorkshopItemSummary } from '../workshop/protocol';
import '../ui/screens/traveler-registry.css';

const base: Omit<WorkshopItemSummary, 'id' | 'title' | 'type' | 'contentType'> = {
  ownerId: 'author-1', author: { id: 'author-1', name: '星图绘师' }, contentId: null, version: '1.2.0', description: null, changelog: null,
  tags: [], category: null, status: 'published', downloadCount: 0, favoriteCount: 0, ratingCount: 0, ratingAverage: null,
  createdAt: Date.UTC(2026, 9, 2), updatedAt: Date.UTC(2026, 10, 12), dependencies: [], recommendations: [], minAppVersion: null,
  compatibility: {}, featured: false, screenshots: [], dataSize: 48_213,
};

const items: WorkshopItemSummary[] = [
  { ...base, id: 'w-1', type: 'world_package', contentType: 'world_package', contentId: 'fog-harbor', title: '雾港奇谈', description: '蒸汽与海雾笼罩的港口城市，码头工会、灯塔守望者与走私船在夜色里角力。附带港口经营模块与 12 张事件卡。', tags: ['蒸汽朋克', '港口', '经营'], downloadCount: 1824, favoriteCount: 312, ratingCount: 87, ratingAverage: 4.6, featured: true, dependencies: [{ id: 'm-1', version: '1.0.0' }], recommendations: [{ id: 'a-1', reason: '主线冒险' }], changelog: '新增灯塔区地图与两名常驻 NPC；修复夜市价格不刷新。' },
  { ...base, id: 'm-1', type: 'gameplay_module', contentType: 'gameplay_module', contentId: 'harbor-trade', title: '港口贸易', description: '按季节浮动的货价、仓储与合同。', tags: ['经营'], downloadCount: 940, favoriteCount: 120, ratingCount: 31, ratingAverage: 4.2, version: '1.0.3' },
  { ...base, id: 'a-1', type: 'adventure_pack', contentType: 'adventure_pack', contentId: 'lost-temple', title: '失落神殿', description: '五个场景的短篇冒险，选项会影响体力与金钱。', tags: ['冒险', '短篇'], downloadCount: 410, favoriteCount: 64, ratingCount: 12, ratingAverage: 3.9, author: { id: 'author-2', name: '旅者·7f3a21' } },
  { ...base, id: 't-1', type: 'visual_theme', contentType: 'visual_theme', title: '青铜暮色', description: '偏暖的金铜色板。', downloadCount: 77, favoriteCount: 9 },
  { ...base, id: 'e-1', type: 'event_pack', contentType: 'event_pack', contentId: 'night-market', title: '夜市怪谈', description: '十张夜市随机事件。', tags: ['事件'], downloadCount: 230, favoriteCount: 18, ratingCount: 5, ratingAverage: 4.8 },
  { ...base, id: 'n-1', type: 'npc_template', contentType: 'npc_template', title: '老船长奥德', description: '退役的远洋船长，嗜酒，消息灵通。', downloadCount: 51 },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function route(url: URL): Response | null {
  const path = url.pathname.replace(/^\/api\/workshop/, '');
  if (path === '' || path === '/') {
    const type = url.searchParams.get('type');
    const list = items.filter(item => !type || item.type === type);
    return json({ items: list, page: 1, pageSize: 18, total: list.length });
  }
  if (path === '/updates') return json({ items: [{ id: 'm-1', title: '港口贸易', version: '1.0.3', status: 'published', updatedAt: 1 }] });
  if (path === '/mine') return json({ items: [{ ...items[0], ownerId: 'me' }, { ...items[3], ownerId: 'me', status: 'unlisted' }] });
  if (path === '/favorites') return json({ items: [items[2]] });
  const match = path.match(/^\/([^/]+)(\/.*)?$/);
  const item = items.find(entry => entry.id === match?.[1]);
  if (!item) return json({ error: 'NOT_FOUND', message: '条目不存在' }, 404);
  const rest = match?.[2] ?? '';
  if (rest === '/install-plan') {
    const deps = item.dependencies.map(dependency => items.find(entry => entry.id === dependency.id)!).filter(Boolean);
    return json({ ok: true, rootId: item.id, items: [...deps, item], recommendations: item.recommendations.map(rec => ({ ...rec, available: true, title: items.find(entry => entry.id === rec.id)?.title })), errors: [] });
  }
  if (rest === '/versions') return json({ versions: [{ version: item.version, changelog: item.changelog, createdAt: item.updatedAt, dataSize: item.dataSize }, { version: '1.0.0', changelog: '首个版本', createdAt: item.createdAt, dataSize: 40_100 }] });
  return json({ item: { ...item, data: {}, viewer: { isOwner: false, rating: 4, favorited: true, reported: false } } });
}

export default function WorkshopPreview() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const original = window.fetch.bind(window);
    const stub = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.origin);
      return url.pathname.startsWith('/api/workshop') ? route(url) ?? original(input, init) : original(input, init);
    };
    window.fetch = stub as typeof window.fetch;
    useAuthStore.setState({ user: { id: 'me', username: 'me', email: 'me@example.test', displayName: '雾港旅人', workshopAdmin: true }, isAuthenticated: true, isLoading: false });
    setReady(true);
    return () => { window.fetch = original; };
  }, []);
  if (!ready) return null;
  const open = new URLSearchParams(window.location.search).get('open');
  return (
    <div className="traveler-registry-screen">
      <div className="traveler-registry-backdrop" aria-hidden="true" />
      <div className="traveler-registry-shell-wrap">
        <div className="traveler-registry-shell">
          <main className="traveler-registry-signed-content"><WorkshopSettingsTab initialDetailId={open ?? undefined} /></main>
        </div>
      </div>
    </div>
  );
}

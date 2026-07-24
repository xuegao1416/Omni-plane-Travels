/**
 * 本地资产标签页
 * 展示本地存储的世界包、人物预设、NPC 模板、人生经历
 * 支持一键上传到创意工坊（需登录）
 */
import { useState, useMemo, useCallback } from 'react';
import {
  Globe, User, BookOpen, Layers, Upload, Trash2,
  Package, Loader, Download,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { STORAGE_KEYS } from '../../config/storageKeys';
import { useAuthStore } from '../../stores/authStore';
import { useDialog } from '../shared/Dialog';
import type { WorldDef } from '../../data/worlds-schema';

/* ─── 类型定义 ─── */
type AssetType = 'world_package' | 'character_preset' | 'npc_template' | 'history_preset';

interface AssetTypeInfo {
  label: string;
  icon: LucideIcon;
  storageKey: string;
  /** 从 localStorage 条目中提取名称 */
  getName: (item: any) => string;
  /** 从 localStorage 条目中提取描述 */
  getDesc: (item: any) => string;
  /** 上传时的类型标识 */
  uploadType: string;
}

const ASSET_TYPES: Record<AssetType, AssetTypeInfo> = {
  world_package: {
    label: '世界包',
    icon: Globe,
    storageKey: STORAGE_KEYS.CUSTOM_WORLDS,
    getName: (w: WorldDef) => w.name || '未命名世界',
    getDesc: (w: WorldDef) => w.description || '',
    uploadType: 'world_package',
  },
  character_preset: {
    label: '人物预设',
    icon: User,
    storageKey: STORAGE_KEYS.PLAYER_PRESETS,
    getName: (p: any) => p.name || '未命名预设',
    getDesc: (p: any) => p.description || '',
    uploadType: 'character_preset',
  },
  npc_template: {
    label: 'NPC 模板',
    icon: BookOpen,
    storageKey: STORAGE_KEYS.NPC_TEMPLATES,
    getName: (t: any) => t.name || '未命名NPC',
    getDesc: (t: any) => t.description || '',
    uploadType: 'npc_template',
  },
  history_preset: {
    label: '人生经历',
    icon: Layers,
    storageKey: STORAGE_KEYS.HISTORY_PRESETS,
    getName: (h: any) => h.name || '未命名经历',
    getDesc: (h: any) => h.description || '',
    uploadType: 'history_preset',
  },
};

const ASSET_TYPE_KEYS = Object.keys(ASSET_TYPES) as AssetType[];

/* ─── 组件 ─── */
export default function LocalAssetsTab() {
  const { isAuthenticated } = useAuthStore();
  const { DialogUI, confirm, alert: showAlert } = useDialog();
  const [activeType, setActiveType] = useState<AssetType>('world_package');
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  /* 读取本地资产 */
  const assets = useMemo(() => {
    const result: Record<AssetType, { id: string; name: string; desc: string; raw: any }[]> = {} as any;
    for (const type of ASSET_TYPE_KEYS) {
      const info = ASSET_TYPES[type];
      try {
        const raw = JSON.parse(localStorage.getItem(info.storageKey) || '[]');
        result[type] = (Array.isArray(raw) ? raw : []).map((item: any, idx: number) => ({
          id: item.id || `${type}_${idx}`,
          name: info.getName(item),
          desc: info.getDesc(item),
          raw: item,
        }));
      } catch {
        result[type] = [];
      }
    }
    return result;
  }, []); // 只读一次，上传/删除后刷新

  /* 刷新（重新读取 localStorage） */
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey(k => k + 1), []);
  // refreshKey 变化时重新计算 assets
  const currentAssets = useMemo(() => {
    const result: Record<AssetType, { id: string; name: string; desc: string; raw: any }[]> = {} as any;
    for (const type of ASSET_TYPE_KEYS) {
      const info = ASSET_TYPES[type];
      try {
        const raw = JSON.parse(localStorage.getItem(info.storageKey) || '[]');
        result[type] = (Array.isArray(raw) ? raw : []).map((item: any, idx: number) => ({
          id: item.id || `${type}_${idx}`,
          name: info.getName(item),
          desc: info.getDesc(item),
          raw: item,
        }));
      } catch {
        result[type] = [];
      }
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  /* 上传到创意工坊 */
  const handleUpload = async (asset: { id: string; name: string; desc: string; raw: any }) => {
    if (!isAuthenticated) {
      await showAlert('请先登录后再上传到创意工坊', { title: '需要登录' });
      return;
    }

    const typeInfo = ASSET_TYPES[activeType];
    setUploadingId(asset.id);

    try {
      const res = await fetch('/api/workshop', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: asset.name,
          description: asset.desc || null,
          type: typeInfo.uploadType,
          tags: [],
          data: asset.raw,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: '上传失败' }));
        throw new Error(err.message || '上传失败');
      }

      await showAlert(`「${asset.name}」已上传到创意工坊！`, { title: '上传成功' });
    } catch (err) {
      await showAlert('上传失败：' + (err as Error).message, { title: '上传失败', danger: true });
    } finally {
      setUploadingId(null);
    }
  };

  /* 删除本地资产 */
  const handleDelete = async (asset: { id: string; name: string; raw: any }) => {
    const ok = await confirm(`确定删除「${asset.name}」吗？此操作不可撤销。`, {
      danger: true,
      confirmText: '删除',
    });
    if (!ok) return;

    const info = ASSET_TYPES[activeType];
    try {
      const list: any[] = JSON.parse(localStorage.getItem(info.storageKey) || '[]');
      const idx = list.findIndex((item: any) => (item.id || `${activeType}_${list.indexOf(item)}`) === asset.id);
      if (idx >= 0) {
        list.splice(idx, 1);
        localStorage.setItem(info.storageKey, JSON.stringify(list));
      }
      refresh();
    } catch {
      await showAlert('删除失败', { title: '删除失败', danger: true });
    }
  };

  /* 导出为 JSON 文件 */
  const handleExport = (asset: { name: string; raw: any }) => {
    const blob = new Blob([JSON.stringify(asset.raw, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${asset.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const items = currentAssets[activeType] || [];

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
      padding: 'var(--space-5)',
    }}>
      {DialogUI}

      {/* 标题 */}
      <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: '600' }}>
        本地资产
      </h3>
      <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginTop: 'calc(-1 * var(--space-2))' }}>
        管理本地存储的世界包、预设和模板，可一键上传到创意工坊
      </p>

      {/* 类型 Tab */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        {ASSET_TYPE_KEYS.map(type => {
          const info = ASSET_TYPES[type];
          const Icon = info.icon;
          const count = currentAssets[type]?.length || 0;
          return (
            <button
              key={type}
              onClick={() => setActiveType(type)}
              style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
                padding: '6px 12px',
                background: activeType === type ? 'var(--accent-dim)' : 'var(--bg-tertiary)',
                color: activeType === type ? 'var(--accent)' : 'var(--text-secondary)',
                border: 'none', borderRadius: 'var(--radius-md)',
                cursor: 'pointer', fontSize: 'var(--font-size-sm)',
              }}
            >
              <Icon size={14} />
              {info.label}
              <span style={{
                fontSize: 'var(--font-size-xs)', opacity: 0.7,
                marginLeft: '2px',
              }}>
                ({count})
              </span>
            </button>
          );
        })}
      </div>

      {/* 资产列表 */}
      {items.length === 0 ? (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: 'var(--space-10) var(--space-5)', color: 'var(--text-muted)',
        }}>
          <Package size={48} style={{ marginBottom: 'var(--space-4)', opacity: 0.5 }} />
          <p style={{ fontSize: 'var(--font-size-base)' }}>
            暂无本地{ASSET_TYPES[activeType].label}
          </p>
          <p style={{ fontSize: 'var(--font-size-xs)', marginTop: 'var(--space-1)' }}>
            在游戏中创建后会自动出现在这里
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {items.map(item => (
            <div
              key={item.id}
              style={{
                padding: 'var(--space-4)', background: 'var(--bg-secondary)',
                borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)',
              }}
            >
              {/* 名称 + 描述 */}
              <div style={{ marginBottom: 'var(--space-2)' }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                  marginBottom: 'var(--space-1)',
                }}>
                  {(() => {
                    const Icon = ASSET_TYPES[activeType].icon;
                    return <Icon size={14} color="var(--accent)" />;
                  })()}
                  <span style={{
                    fontSize: 'var(--font-size-xs)', color: 'var(--accent)',
                    background: 'var(--accent-dim)', padding: '2px 6px',
                    borderRadius: 'var(--radius-sm)',
                  }}>
                    {ASSET_TYPES[activeType].label}
                  </span>
                </div>
                <div style={{ fontSize: 'var(--font-size-base)', fontWeight: '600' }}>
                  {item.name}
                </div>
                {item.desc && (
                  <div style={{
                    fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)',
                    marginTop: 'var(--space-1)',
                  }}>
                    {item.desc}
                  </div>
                )}
              </div>

              {/* 操作按钮 */}
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                {/* 上传到创意工坊 */}
                <button
                  onClick={() => handleUpload(item)}
                  disabled={uploadingId === item.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
                    padding: 'var(--space-2) var(--space-3)',
                    background: 'var(--accent-dim)', color: 'var(--accent)',
                    border: 'none', borderRadius: 'var(--radius-md)',
                    cursor: uploadingId === item.id ? 'wait' : 'pointer',
                    fontSize: 'var(--font-size-sm)', fontWeight: '500',
                    opacity: uploadingId === item.id ? 0.6 : 1,
                  }}
                >
                  {uploadingId === item.id
                    ? <Loader size={14} className="animate-spin" />
                    : <Upload size={14} />
                  }
                  上传到工坊
                </button>

                {/* 导出 */}
                <button
                  onClick={() => handleExport(item)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
                    padding: 'var(--space-2) var(--space-3)',
                    background: 'transparent', color: 'var(--text-secondary)',
                    border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
                    cursor: 'pointer', fontSize: 'var(--font-size-sm)',
                  }}
                >
                  <Download size={14} />
                  导出
                </button>

                {/* 删除 */}
                <button
                  onClick={() => handleDelete(item)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
                    padding: 'var(--space-2) var(--space-3)',
                    background: 'transparent', color: 'var(--danger)',
                    border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)',
                    cursor: 'pointer', fontSize: 'var(--font-size-sm)',
                  }}
                >
                  <Trash2 size={14} />
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

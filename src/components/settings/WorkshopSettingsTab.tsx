/**
 * 创意工坊设置标签页
 */
import { useEffect, useState } from 'react';
import { useWorkshopStore, type WorkshopItem, type WorkshopItemDetail, type WorkshopInstallPlan } from '../../stores/workshopStore';
import { useAuthStore } from '../../stores/authStore';
import { useDialog } from '../shared/Dialog';
import { STORAGE_KEYS } from '../../config/storageKeys';
import type { WorldDef } from '../../data/worlds-schema';
import { installWorkshopItem, type WorkshopInstallOperation, restoreCustomWorldStorage } from '../../workshopRuntime';
import { PUBLIC_WORKSHOP_TYPES, isPublicWorkshopType, type PublicWorkshopType } from '../../workshopCatalog';
import {
  Store, Download, Trash2, Loader, RefreshCw,
  Globe, BookOpen, Plus, Upload, X, Puzzle, CalendarDays, TrendingUp, Star, ChevronRight, ArrowLeft
} from 'lucide-react';

const TYPE_LABELS: Record<PublicWorkshopType, { label: string; icon: typeof Globe }> = {
  world_package: { label: '世界包', icon: Globe },
  npc_template: { label: 'NPC 模板', icon: BookOpen },
  gameplay_module: { label: '玩法模块', icon: Puzzle },
  event_pack: { label: '事件包', icon: CalendarDays },
  workflow_pack: { label: '工作流包', icon: TrendingUp },
  adventure_pack: { label: '冒险包', icon: BookOpen },
  visual_theme: { label: '视觉主题', icon: Star },
};
const PUBLISHABLE_TYPES = PUBLIC_WORKSHOP_TYPES;

function getTypeInfo(type: string): { label: string; icon: typeof Globe } {
  return isPublicWorkshopType(type) ? TYPE_LABELS[type] : { label: type, icon: Store };
}

export default function WorkshopSettingsTab() {
  const { user, isAuthenticated } = useAuthStore();
  const { items, isLoading, error, fetchItems, fetchItem, downloadItem, deleteItem, getInstallPlan } = useWorkshopStore();
  const { DialogUI, confirm, alert: showAlert } = useDialog();
  const [typeFilter, setTypeFilter] = useState<PublicWorkshopType | ''>('');
  const [detail, setDetail] = useState<WorkshopItemDetail | null>(null);
  const [detailPlan, setDetailPlan] = useState<WorkshopInstallPlan | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    title: '',
    description: '',
    type: 'world_package' as PublicWorkshopType,
    version: '1.0.0',
    category: 'world',
    tags: '',
    screenshots: '',
    file: null as File | null,
  });
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetchItems({ type: typeFilter || undefined, sort: 'latest' });
  }, [fetchItems, typeFilter]);

  const installOne = async (item: WorkshopItem, data: any, bindWorldId?: string): Promise<WorkshopInstallOperation> => {
    if (item.type === 'world_package') {
      const world = { ...(data as WorldDef) };
      if (!world.id) world.id = bindWorldId || `workshop_${item.id}`;
      if (!world.name) world.name = item.title;
      const previous = localStorage.getItem(STORAGE_KEYS.CUSTOM_WORLDS);
      const existing: WorldDef[] = JSON.parse(previous || '[]');
      const idx = existing.findIndex(w => w.id === world.id);
      if (idx >= 0) existing[idx] = world; else existing.push(world);
      localStorage.setItem(STORAGE_KEYS.CUSTOM_WORLDS, JSON.stringify(existing));
      return {
        label: `世界「${world.name}」`,
        rollback: () => restoreCustomWorldStorage(STORAGE_KEYS.CUSTOM_WORLDS, previous),
      };
    }
    const operation = await installWorkshopItem(item, data, item.type === 'gameplay_module' && bindWorldId ? { worldId: bindWorldId } : undefined);
    if (item.type === 'gameplay_module') window.dispatchEvent(new Event('custom-modules-changed'));
    return operation;
  };

  const handleDownload = async (item: WorkshopItem) => {
    try {
      const plan = await getInstallPlan(item.id);
      if (!plan) throw new Error('无法读取安装计划');
      if (!plan.ok) {
        const messages = plan.errors.map(error => {
          if (error.code === 'MISSING') return `缺少依赖：${error.id}`;
          if (error.code === 'INCOMPATIBLE') return `版本不兼容：${error.id}（需要 ${error.requiredVersion || '更高版本'}）`;
          return `依赖循环：${error.path.join(' → ')}`;
        });
        await showAlert(messages.join('\n'), { title: '无法安装', danger: true });
        return;
      }
      const optional = plan.recommendations.filter(recommendation => recommendation.optional);
      const requiredSummary = plan.items.map(entry => `${getTypeInfo(entry.type).label}「${entry.title}」`).join('\n');
      const recommendationSummary = plan.recommendations.length
        ? `\n\n推荐内容（不会被静默忽略）：\n${plan.recommendations.map(rec => `${rec.optional ? '可选' : '必需'} · ${rec.type || '内容'} · ${rec.id}${rec.reason ? `：${rec.reason}` : ''}`).join('\n')}`
        : '';
      if (!(await confirm(`将按依赖顺序安装：\n${requiredSummary}${recommendationSummary}`, { title: '确认安装计划', confirmText: optional.length ? '安装主内容' : '安装' }))) return;
      // Download every payload before mutating local runtime state. This keeps
      // network failures from leaving a half-installed dependency graph.
      const payloads: Array<{ entry: WorkshopItem; data: any }> = [];
      for (const entry of plan.items) {
        const result = await downloadItem(entry.id);
        if (!result?.data) throw new Error(`${entry.title} 返回的数据为空`);
        payloads.push({ entry, data: result.data });
      }

      const worldPayload = payloads.find(({ entry }) => entry.type === 'world_package');
      const worldData = worldPayload?.data as Partial<WorldDef> | undefined;
      const packageWorldId = worldPayload
        ? (typeof worldData?.id === 'string' && worldData.id.trim() ? worldData.id : `workshop_${worldPayload.entry.id}`)
        : undefined;
      // A world package owns modules that arrive in the same install plan.
      // Standalone modules remain unbound until the player enables them from the module workspace.
      const bindWorldId = packageWorldId;

      const operations: WorkshopInstallOperation[] = [];
      try {
        for (const payload of payloads) operations.push(await installOne(payload.entry, payload.data, bindWorldId));
      } catch (error) {
        for (const operation of [...operations].reverse()) {
          try { await operation.rollback(); } catch { /* preserve the original install error */ }
        }
        throw error;
      }
      await showAlert(`${operations.map(operation => operation.label).join('、')}已安装。${plan.recommendations.length ? '推荐内容已列出，请按需单独安装。' : ''}`, { title: '安装成功' });
    } catch {
      await showAlert('安装失败：请稍后重试或检查依赖。', { title: '安装失败', danger: true });
    }
  };

  const openDetail = async (item: WorkshopItem) => {
    const [loaded, plan] = await Promise.all([fetchItem(item.id), getInstallPlan(item.id)]);
    setDetail(loaded);
    setDetailPlan(plan);
  };

  const handleDelete = async (itemId: string) => {
    const ok = await confirm('确定要删除这个条目吗？此操作不可撤销。', { danger: true, confirmText: '删除' });
    if (!ok) return;
    try {
      await deleteItem(itemId);
      await showAlert('条目已删除。', { title: '删除成功' });
    } catch {
      await showAlert('删除失败', { title: '删除失败', danger: true });
    }
  };

  const handleUpload = async () => {
    if (!uploadForm.title.trim()) {
      await showAlert('请输入标题', { title: '提示' });
      return;
    }
    if (!uploadForm.file) {
      await showAlert('请选择要上传的文件', { title: '提示' });
      return;
    }

    setUploading(true);
    try {
      const text = await uploadForm.file.text();
      const data = JSON.parse(text);

      const tags = uploadForm.tags
        .split(/[,，、]/)
        .map(t => t.trim())
        .filter(Boolean);

      const res = await fetch(`/api/workshop`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: uploadForm.title.trim(),
          description: uploadForm.description.trim() || null,
          type: uploadForm.type,
          version: uploadForm.version,
          category: uploadForm.category,
          tags,
          screenshots: uploadForm.screenshots.split(/[\n,，]/).map(value => value.trim()).filter(Boolean),
          data,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: '上传失败' }));
        throw new Error(err.message || '上传失败');
      }

      await showAlert('上传成功！', { title: '上传成功' });
      setShowUpload(false);
      setUploadForm({ title: '', description: '', type: 'world_package', version: '1.0.0', category: 'world', tags: '', screenshots: '', file: null });
      fetchItems({ type: typeFilter || undefined });
    } catch (err) {
      await showAlert('上传失败：' + (err as Error).message, { title: '上传失败', danger: true });
    } finally {
      setUploading(false);
    }
  };

  const formatTime = (timestamp: number) => new Date(timestamp).toLocaleString('zh-CN');

  return (
    <div className="registry-settings-page registry-workshop-page" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', padding: 'var(--space-5)' }}>
      {DialogUI}

      {/* 标题 */}
      <div className="registry-settings-title-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: '600' }}>创意工坊</h3>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {isAuthenticated && (
            <button
              onClick={() => setShowUpload(!showUpload)}
              style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
                padding: 'var(--space-2) var(--space-3)', background: 'var(--accent-dim)', color: 'var(--accent)',
                border: 'none', borderRadius: 'var(--radius-md)',
                cursor: 'pointer', fontSize: 'var(--font-size-sm)', fontWeight: '500',
              }}
            >
              {showUpload ? <X size={14} /> : <Plus size={14} />}
              {showUpload ? '取消' : '上传'}
            </button>
          )}
          <button
            onClick={() => fetchItems({ type: typeFilter || undefined, sort: 'latest' })}
            disabled={isLoading}
            style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
              padding: 'var(--space-2) var(--space-3)', background: 'transparent',
              border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
              color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)',
            }}
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            刷新
          </button>
        </div>
      </div>

      {/* 上传表单 */}
      {showUpload && (
        <div style={{
          padding: 'var(--space-4)', background: 'var(--bg-secondary)',
          borderRadius: 'var(--radius-lg)', border: '1px solid var(--accent)',
          display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
        }}>
          <div className="registry-workshop-upload-grid" style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', display: 'block', marginBottom: 'var(--space-1)' }}>
                标题 *
              </label>
              <input
                className="input-field"
                value={uploadForm.title}
                onChange={e => setUploadForm(f => ({ ...f, title: e.target.value }))}
                placeholder="输入标题"
                style={{ width: '100%', padding: '8px 10px' }}
              />
            </div>
            <div style={{ width: '140px' }}>
              <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', display: 'block', marginBottom: 'var(--space-1)' }}>
                类型
              </label>
              <select
                className="input-field"
                value={uploadForm.type}
                onChange={e => setUploadForm(f => ({ ...f, type: e.target.value as PublicWorkshopType }))}
                style={{ width: '100%', padding: '8px 10px' }}
              >
                {PUBLISHABLE_TYPES.map(type => <option key={type} value={type}>{TYPE_LABELS[type].label}</option>)}
              </select>
            </div>
            <div style={{ width: '100px' }}>
              <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', display: 'block', marginBottom: 'var(--space-1)' }}>版本</label>
              <input className="input-field" value={uploadForm.version} onChange={e => setUploadForm(f => ({ ...f, version: e.target.value }))} placeholder="1.0.0" style={{ width: '100%', padding: '8px 10px' }} />
            </div>
            <div style={{ width: '120px' }}>
              <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', display: 'block', marginBottom: 'var(--space-1)' }}>分类</label>
              <select className="input-field" value={uploadForm.category} onChange={e => setUploadForm(f => ({ ...f, category: e.target.value }))} style={{ width: '100%', padding: '8px 10px' }}><option value="world">世界</option><option value="character">角色</option><option value="gameplay">玩法</option><option value="story">剧情</option><option value="visual">视觉</option></select>
            </div>
          </div>

          <div>
            <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', display: 'block', marginBottom: 'var(--space-1)' }}>截图 URL（最多 6 张，逗号或换行分隔）</label>
            <textarea className="input-field" rows={2} value={uploadForm.screenshots} onChange={e => setUploadForm(f => ({ ...f, screenshots: e.target.value }))} placeholder="https://example.com/screenshot.webp" style={{ width: '100%', padding: '8px 10px', resize: 'vertical' }} />
          </div>

          <div>
            <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', display: 'block', marginBottom: 'var(--space-1)' }}>
              描述
            </label>
            <textarea
              className="input-field"
              value={uploadForm.description}
              onChange={e => setUploadForm(f => ({ ...f, description: e.target.value }))}
              placeholder="简要描述（可选）"
              rows={2}
              style={{ width: '100%', padding: '8px 10px', resize: 'vertical' }}
            />
          </div>

          <div className="registry-workshop-upload-grid" style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', display: 'block', marginBottom: 'var(--space-1)' }}>
                标签（逗号分隔）
              </label>
              <input
                className="input-field"
                value={uploadForm.tags}
                onChange={e => setUploadForm(f => ({ ...f, tags: e.target.value }))}
                placeholder="奇幻, 冒险, 魔法"
                style={{ width: '100%', padding: '8px 10px' }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', display: 'block', marginBottom: 'var(--space-1)' }}>
                文件（JSON）*
              </label>
              <input
                type="file"
                accept=".json"
                onChange={e => setUploadForm(f => ({ ...f, file: e.target.files?.[0] || null }))}
                style={{ fontSize: 'var(--font-size-sm)', padding: '6px 0' }}
              />
            </div>
          </div>

          <button
            onClick={handleUpload}
            disabled={uploading || !uploadForm.title.trim() || !uploadForm.file}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              padding: '10px 20px', background: 'var(--accent, #d4af37)', color: '#000',
              border: 'none', borderRadius: 'var(--radius-md)',
              fontSize: 'var(--font-size-sm)', fontWeight: '600',
              cursor: uploading ? 'wait' : 'pointer',
              opacity: uploading || !uploadForm.title.trim() || !uploadForm.file ? 0.5 : 1,
            }}
          >
            {uploading ? <Loader size={14} className="animate-spin" /> : <Upload size={14} />}
            上传到工坊
          </button>
        </div>
      )}

      {/* 类型筛选 */}
      <div className="registry-type-tabs registry-workshop-type-tabs" style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <button
          onClick={() => setTypeFilter('')}
          style={{
            padding: '6px 12px',
            background: !typeFilter ? 'var(--accent-dim)' : 'var(--bg-tertiary)',
            color: !typeFilter ? 'var(--accent)' : 'var(--text-secondary)',
            border: 'none', borderRadius: 'var(--radius-md)',
            cursor: 'pointer', fontSize: 'var(--font-size-sm)',
          }}
        >
          全部
        </button>
        {PUBLIC_WORKSHOP_TYPES.map(type => (
          <button
            key={type}
            onClick={() => setTypeFilter(type)}
            style={{
              padding: '6px 12px',
              background: typeFilter === type ? 'var(--accent-dim)' : 'var(--bg-tertiary)',
              color: typeFilter === type ? 'var(--accent)' : 'var(--text-secondary)',
              border: 'none', borderRadius: 'var(--radius-md)',
              cursor: 'pointer', fontSize: 'var(--font-size-sm)',
            }}
          >
            {TYPE_LABELS[type].label}
          </button>
        ))}
      </div>

      {/* 错误提示 */}
      {error && (
        <div style={{
          padding: 'var(--space-3)', background: 'var(--danger-dim)', color: 'var(--danger)',
          borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)',
        }}>
          {error}
        </div>
      )}

      {/* 条目列表 */}
      <div className="registry-asset-list" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {items.length === 0 && !isLoading && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: 'var(--space-10) var(--space-5)', color: 'var(--text-muted)',
          }}>
            <Store size={48} style={{ marginBottom: 'var(--space-4)', opacity: 0.5 }} />
            <p style={{ fontSize: 'var(--font-size-base)' }}>
              {typeFilter ? '没有找到该类型的条目' : '创意工坊暂无内容'}
            </p>
          </div>
        )}

        {items.map(item => {
          const typeInfo = getTypeInfo(item.type);
          const TypeIcon = typeInfo.icon;
          return (
            <div
              key={item.id}
              style={{
                padding: 'var(--space-4)', background: 'var(--bg-secondary)',
                borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)',
              }}
            >
              {item.screenshots?.[0] && <img src={item.screenshots[0]} alt={`${item.title} 截图`} loading="lazy" style={{ display: 'block', width: '100%', maxHeight: 220, objectFit: 'cover', marginBottom: 'var(--space-3)', borderRadius: 'var(--radius-md)' }} />}
              <div style={{
                display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 'var(--space-2)',
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
                    <TypeIcon size={16} color="var(--accent)" />
                    <span style={{
                      fontSize: 'var(--font-size-xs)', color: 'var(--accent)',
                      background: 'var(--accent-dim)', padding: '2px 6px', borderRadius: 'var(--radius-sm)',
                    }}>
                      {typeInfo.label}
                    </span>
                  </div>
                  <div style={{ fontSize: 'var(--font-size-base)', fontWeight: '600' }}>{item.title}</div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: 3 }}>v{item.version} · 作者 {item.ownerId}</div>
                  {item.description && (
                    <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
                      {item.description}
                    </div>
                  )}
                </div>
              </div>

              {item.tags.length > 0 && (
                <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap', marginBottom: 'var(--space-2)' }}>
                  {item.tags.map(tag => (
                    <span
                      key={tag}
                      style={{
                        fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)',
                        background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: 'var(--radius-sm)',
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {(item.dependencies?.length || item.minAppVersion || item.category) ? (
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-2)', fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                  {item.category && <span>分类：{item.category}</span>}
                  {item.minAppVersion && <span>最低版本：{item.minAppVersion}</span>}
                  {item.dependencies && item.dependencies.length > 0 && <span>依赖：{item.dependencies.map(dep => dep.id).join('、')}</span>}
                </div>
              ) : null}

              <div style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginBottom: 'var(--space-3)',
              }}>
                <span>下载 {item.downloadCount} 次</span>
                <span>{formatTime(item.createdAt)}</span>
              </div>

              <div className="registry-card-actions" style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button
                  onClick={() => void openDetail(item)}
                  disabled={isLoading}
                  style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', padding: 'var(--space-2) var(--space-3)', background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--font-size-sm)' }}
                >
                  <ChevronRight size={14} />详情
                </button>
                <button
                  onClick={() => handleDownload(item)}
                  disabled={isLoading}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
                    padding: 'var(--space-2) var(--space-3)', background: 'var(--accent-dim)', color: 'var(--accent)',
                    border: 'none', borderRadius: 'var(--radius-md)',
                    cursor: 'pointer', fontSize: 'var(--font-size-sm)', fontWeight: '500',
                  }}
                >
                  <Download size={14} />
                  下载
                </button>

                {isAuthenticated && user?.id === item.ownerId && (
                  <button
                    onClick={() => handleDelete(item.id)}
                    disabled={isLoading}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
                      padding: 'var(--space-2) var(--space-3)', background: 'transparent', color: 'var(--danger)',
                      border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)',
                      cursor: 'pointer', fontSize: 'var(--font-size-sm)', fontWeight: '500',
                    }}
                  >
                    <Trash2 size={14} />
                    删除
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {isLoading && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 'var(--space-5)', color: 'var(--text-muted)',
        }}>
          <Loader size={20} className="animate-spin" style={{ marginRight: 'var(--space-2)' }} />
          <span>加载中...</span>
        </div>
      )}

      {detail && (
        <div role="dialog" aria-modal="true" aria-label={`${detail.title}详情`} style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'grid', placeItems: 'center', padding: 'var(--space-5)', background: 'rgba(0,0,0,.58)' }} onClick={() => setDetail(null)}>
          <section onClick={event => event.stopPropagation()} style={{ width: 'min(760px, 100%)', maxHeight: 'min(760px, 90vh)', overflow: 'auto', padding: 'var(--space-5)', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div><div style={{ color: 'var(--accent)', fontSize: 'var(--font-size-xs)' }}>{getTypeInfo(detail.type).label}</div><h2 style={{ margin: '4px 0' }}>{detail.title}</h2><div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>作者 {detail.ownerId} · v{detail.version} · {detail.minAppVersion ? `最低版本 ${detail.minAppVersion}` : '无最低版本限制'}</div></div>
              <button type="button" aria-label="关闭详情" onClick={() => setDetail(null)} style={{ border: 0, background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            {detail.screenshots?.length ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8, margin: 'var(--space-4) 0' }}>{detail.screenshots.slice(0, 6).map((src, index) => <img key={`${src}-${index}`} src={src} alt={`${detail.title}截图${index + 1}`} loading="lazy" style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }} />)}</div> : null}
            <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, color: 'var(--text-secondary)' }}>{detail.description || '暂无说明。'}</p>
            {detail.compatibility && Object.keys(detail.compatibility).length > 0 && <div style={{ marginTop: 'var(--space-3)', color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>兼容：{Object.entries(detail.compatibility).map(([key, value]) => `${key}=${String(value)}`).join(' · ')}</div>}
            <div style={{ display: 'grid', gap: 8, marginTop: 'var(--space-4)', padding: 'var(--space-3)', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)' }}>
              <strong>安装计划</strong>
              <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>{detailPlan?.items.map(item => `${item.title} v${item.version}`).join(' → ') || '正在解析依赖…'}</span>
              {detailPlan?.errors.map(error => <span key={`${error.code}-${error.id}`} style={{ color: 'var(--danger)', fontSize: 'var(--font-size-sm)' }}>{error.code === 'CYCLE' ? `循环依赖：${error.path.join(' → ')}` : error.code === 'MISSING' ? `缺少依赖：${error.id}` : `版本不兼容：${error.id}`}</span>)}
              {detailPlan?.recommendations.map(recommendation => <span key={`recommend-${recommendation.id}`} style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>推荐：{recommendation.id}{recommendation.reason ? ` · ${recommendation.reason}` : ''}</span>)}
            </div>
            <div className="registry-detail-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 'var(--space-4)' }}><button type="button" onClick={() => setDetail(null)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '8px 12px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', borderRadius: 'var(--radius-md)' }}><ArrowLeft size={14} />返回列表</button><button type="button" onClick={() => { setDetail(null); void handleDownload(detail); }} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '8px 12px', border: 0, background: 'var(--accent)', color: 'var(--color-on-accent, #fff)', borderRadius: 'var(--radius-md)' }}><Download size={14} />按计划安装</button></div>
          </section>
        </div>
      )}
    </div>
  );
}

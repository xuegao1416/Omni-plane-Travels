/**
 * 创意工坊设置标签页
 */
import { useEffect, useState } from 'react';
import { useWorkshopStore, type WorkshopItem } from '../../stores/workshopStore';
import { useAuthStore } from '../../stores/authStore';
import { useDialog } from '../shared/Dialog';
import {
  Store, Download, Trash2, Loader, RefreshCw,
  Globe, User, BookOpen, Layers, Plus, Upload, X
} from 'lucide-react';

const TYPE_LABELS: Record<string, { label: string; icon: typeof Globe }> = {
  world_package: { label: '世界包', icon: Globe },
  character_preset: { label: '人物预设', icon: User },
  npc_template: { label: 'NPC 模板', icon: BookOpen },
  history_preset: { label: '人生经历', icon: Layers },
};

export default function WorkshopSettingsTab() {
  const { user, isAuthenticated } = useAuthStore();
  const { items, isLoading, error, fetchItems, downloadItem, deleteItem } = useWorkshopStore();
  const { DialogUI, confirm, alert: showAlert } = useDialog();
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [showUpload, setShowUpload] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    title: '',
    description: '',
    type: 'world_package' as string,
    tags: '',
    file: null as File | null,
  });
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetchItems({ type: typeFilter || undefined });
  }, [fetchItems, typeFilter]);

  const handleDownload = async (item: WorkshopItem) => {
    try {
      const data = await downloadItem(item.id);
      if (data) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${item.title}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      await showAlert('下载失败', { title: '下载失败', danger: true });
    }
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

      const res = await fetch(`${import.meta.env.VITE_API_BASE || ''}/api/workshop`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: uploadForm.title.trim(),
          description: uploadForm.description.trim() || null,
          type: uploadForm.type,
          tags,
          data,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: '上传失败' }));
        throw new Error(err.message || '上传失败');
      }

      await showAlert('上传成功！', { title: '上传成功' });
      setShowUpload(false);
      setUploadForm({ title: '', description: '', type: 'world_package', tags: '', file: null });
      fetchItems({ type: typeFilter || undefined });
    } catch (err) {
      await showAlert('上传失败：' + (err as Error).message, { title: '上传失败', danger: true });
    } finally {
      setUploading(false);
    }
  };

  const formatTime = (timestamp: number) => new Date(timestamp).toLocaleString('zh-CN');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
      {DialogUI}

      {/* 标题 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: '600' }}>创意工坊</h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          {isAuthenticated && (
            <button
              onClick={() => setShowUpload(!showUpload)}
              style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                padding: '8px 12px', background: 'var(--accent-dim)', color: 'var(--accent)',
                border: 'none', borderRadius: 'var(--radius-md)',
                cursor: 'pointer', fontSize: 'var(--font-size-sm)', fontWeight: '500',
              }}
            >
              {showUpload ? <X size={14} /> : <Plus size={14} />}
              {showUpload ? '取消' : '上传'}
            </button>
          )}
          <button
            onClick={() => fetchItems({ type: typeFilter || undefined })}
            disabled={isLoading}
            style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              padding: '8px 12px', background: 'transparent',
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
          padding: '16px', background: 'var(--bg-secondary)',
          borderRadius: 'var(--radius-lg)', border: '1px solid var(--accent)',
          display: 'flex', flexDirection: 'column', gap: '12px',
        }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
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
              <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                类型
              </label>
              <select
                className="input-field"
                value={uploadForm.type}
                onChange={e => setUploadForm(f => ({ ...f, type: e.target.value }))}
                style={{ width: '100%', padding: '8px 10px' }}
              >
                {Object.entries(TYPE_LABELS).map(([type, { label }]) => (
                  <option key={type} value={type}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
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

          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
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
              <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
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
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
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
        {Object.entries(TYPE_LABELS).map(([type, { label }]) => (
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
            {label}
          </button>
        ))}
      </div>

      {/* 错误提示 */}
      {error && (
        <div style={{
          padding: '12px', background: 'var(--danger-dim)', color: 'var(--danger)',
          borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)',
        }}>
          {error}
        </div>
      )}

      {/* 条目列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {items.length === 0 && !isLoading && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: '40px 20px', color: 'var(--text-muted)',
          }}>
            <Store size={48} style={{ marginBottom: 16, opacity: 0.5 }} />
            <p style={{ fontSize: 'var(--font-size-base)' }}>
              {typeFilter ? '没有找到该类型的条目' : '创意工坊暂无内容'}
            </p>
          </div>
        )}

        {items.map(item => {
          const typeInfo = TYPE_LABELS[item.type] || { label: item.type, icon: Store };
          const TypeIcon = typeInfo.icon;
          return (
            <div
              key={item.id}
              style={{
                padding: '16px', background: 'var(--bg-secondary)',
                borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)',
              }}
            >
              <div style={{
                display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '8px',
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <TypeIcon size={16} color="var(--accent)" />
                    <span style={{
                      fontSize: 'var(--font-size-xs)', color: 'var(--accent)',
                      background: 'var(--accent-dim)', padding: '2px 6px', borderRadius: '4px',
                    }}>
                      {typeInfo.label}
                    </span>
                  </div>
                  <div style={{ fontSize: 'var(--font-size-base)', fontWeight: '600' }}>{item.title}</div>
                  {item.description && (
                    <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {item.description}
                    </div>
                  )}
                </div>
              </div>

              {item.tags.length > 0 && (
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '8px' }}>
                  {item.tags.map(tag => (
                    <span
                      key={tag}
                      style={{
                        fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)',
                        background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '4px',
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              <div style={{
                display: 'flex', alignItems: 'center', gap: '12px',
                fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginBottom: '12px',
              }}>
                <span>下载 {item.downloadCount} 次</span>
                <span>{formatTime(item.createdAt)}</span>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => handleDownload(item)}
                  disabled={isLoading}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '4px',
                    padding: '8px 12px', background: 'var(--accent-dim)', color: 'var(--accent)',
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
                      display: 'flex', alignItems: 'center', gap: '4px',
                      padding: '8px 12px', background: 'transparent', color: 'var(--danger)',
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
          padding: '20px', color: 'var(--text-muted)',
        }}>
          <Loader size={20} className="animate-spin" style={{ marginRight: 8 }} />
          <span>加载中...</span>
        </div>
      )}
    </div>
  );
}

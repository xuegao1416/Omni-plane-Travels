/**
 * 云存档设置标签页
 */
import { useEffect, useState } from 'react';
import { useCloudSaveStore } from '../../stores/cloudSaveStore';
import { useSaveStore } from '../../stores/saveStore';
import { useAuthStore } from '../../stores/authStore';
import { useDialog } from '../shared/Dialog';
import { Cloud, Upload, Download, Trash2, Loader, RefreshCw } from 'lucide-react';

export default function CloudSaveSettingsTab() {
  const { isAuthenticated } = useAuthStore();
  const { slots, isLoading, error, fetchSlots, uploadSave, downloadSave, deleteSave } = useCloudSaveStore();
  const { savesMeta, exportSave, importSave } = useSaveStore();
  const { DialogUI, confirm, alert: showAlert } = useDialog();
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);

  useEffect(() => {
    if (isAuthenticated) {
      fetchSlots();
    }
  }, [isAuthenticated, fetchSlots]);

  if (!isAuthenticated) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '40px 20px', color: 'var(--text-muted)',
      }}>
        <Cloud size={48} style={{ marginBottom: 16, opacity: 0.5 }} />
        <p style={{ fontSize: 'var(--font-size-base)', textAlign: 'center' }}>
          请先登录以使用云存档功能
        </p>
      </div>
    );
  }

  const handleUpload = async (slotIndex: number) => {
    if (savesMeta.length === 0) {
      await showAlert('本地没有存档，请先创建一个存档。', { title: '无存档' });
      return;
    }

    // 让用户选择要上传的本地存档
    setUploadingSlot(slotIndex);
  };

  const handleSelectSave = async (saveId: string, saveName: string) => {
    if (uploadingSlot === null) return;

    try {
      // 导出本地存档数据
      const blob = await exportSave(saveId);
      const text = await blob.text();
      const saveData = JSON.parse(text);

      await uploadSave(uploadingSlot, saveData);
      await showAlert(`存档「${saveName}」已上传到云端槽位 ${uploadingSlot}。`, { title: '上传成功' });
      setUploadingSlot(null);
    } catch (error) {
      if ((error as Error).message === 'VERSION_CONFLICT') {
        const ok = await confirm('云端已有存档，是否覆盖？', { danger: true, confirmText: '覆盖' });
        if (ok) {
          try {
            const blob = await exportSave(saveId);
            const text = await blob.text();
            const saveData = JSON.parse(text);
            const slot = slots.find(s => s.slotIndex === uploadingSlot);
            await uploadSave(uploadingSlot, saveData, slot?.version);
            await showAlert('覆盖上传成功！', { title: '上传成功' });
          } catch (e) {
            await showAlert('上传失败：' + (e as Error).message, { title: '上传失败', danger: true });
          }
        }
        setUploadingSlot(null);
      } else {
        await showAlert('上传失败：' + (error as Error).message, { title: '上传失败', danger: true });
        setUploadingSlot(null);
      }
    }
  };

  const handleDownload = async (slotIndex: number) => {
    try {
      const saveData = await downloadSave(slotIndex);
      if (saveData) {
        await importSave(saveData);
        await showAlert('云存档已下载并导入到本地存档列表。', { title: '下载成功' });
      }
    } catch (error) {
      await showAlert('下载失败：' + (error as Error).message, { title: '下载失败', danger: true });
    }
  };

  const handleDelete = async (slotIndex: number) => {
    const ok = await confirm('确定要删除这个云存档吗？此操作不可撤销。', { danger: true, confirmText: '删除' });
    if (!ok) return;
    try {
      await deleteSave(slotIndex);
      await showAlert('云存档已删除。', { title: '删除成功' });
    } catch (error) {
      await showAlert('删除失败：' + (error as Error).message, { title: '删除失败', danger: true });
    }
  };

  const formatTime = (timestamp: number) => new Date(timestamp).toLocaleString('zh-CN');
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
      {DialogUI}

      {/* 标题 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: '600' }}>云存档管理</h3>
        <button
          onClick={fetchSlots}
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

      {/* 错误提示 */}
      {error && (
        <div style={{
          padding: '12px', background: 'var(--danger-dim)', color: 'var(--danger)',
          borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)',
        }}>
          {error}
        </div>
      )}

      {/* 存档选择面板（上传时展开） */}
      {uploadingSlot !== null && (
        <div style={{
          padding: '16px', background: 'var(--bg-secondary)',
          borderRadius: 'var(--radius-lg)', border: '1px solid var(--accent)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px',
          }}>
            <span style={{ fontSize: 'var(--font-size-base)', fontWeight: '600' }}>
              选择要上传到槽位 {uploadingSlot} 的本地存档
            </span>
            <button
              onClick={() => setUploadingSlot(null)}
              style={{
                background: 'none', border: 'none', color: 'var(--text-muted)',
                cursor: 'pointer', fontSize: 'var(--font-size-sm)',
              }}
            >
              取消
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {savesMeta.map(save => (
              <button
                key={save.id}
                onClick={() => handleSelectSave(save.id, save.name)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px', background: 'var(--bg-primary)',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
                  cursor: 'pointer', textAlign: 'left',
                }}
              >
                <div>
                  <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: '600' }}>{save.name}</div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
                    {formatTime(save.timestamp)} · {save.messageCount ?? 0} 条消息
                  </div>
                </div>
                <Upload size={14} color="var(--accent)" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 存档槽位列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {[1, 2].map(slotIndex => {
          const slot = slots.find(s => s.slotIndex === slotIndex);
          return (
            <div
              key={slotIndex}
              style={{
                padding: '16px', background: 'var(--bg-secondary)',
                borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)',
              }}
            >
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: slot ? '12px' : '0',
              }}>
                <div>
                  <div style={{ fontSize: 'var(--font-size-base)', fontWeight: '600' }}>
                    存档槽位 {slotIndex}
                  </div>
                  {slot ? (
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: 4 }}>
                      版本 {slot.version} · {formatSize(slot.size)} · {formatTime(slot.updatedAt)}
                    </div>
                  ) : (
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: 4 }}>
                      空槽位
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => handleUpload(slotIndex)}
                  disabled={isLoading}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '4px',
                    padding: '8px 12px', background: 'var(--accent-dim)', color: 'var(--accent)',
                    border: 'none', borderRadius: 'var(--radius-md)',
                    cursor: 'pointer', fontSize: 'var(--font-size-sm)', fontWeight: '500',
                  }}
                >
                  <Upload size={14} />
                  上传
                </button>

                {slot && (
                  <>
                    <button
                      onClick={() => handleDownload(slotIndex)}
                      disabled={isLoading}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '4px',
                        padding: '8px 12px', background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
                        border: 'none', borderRadius: 'var(--radius-md)',
                        cursor: 'pointer', fontSize: 'var(--font-size-sm)', fontWeight: '500',
                      }}
                    >
                      <Download size={14} />
                      下载
                    </button>
                    <button
                      onClick={() => handleDelete(slotIndex)}
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
                  </>
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
          <span>处理中...</span>
        </div>
      )}
    </div>
  );
}

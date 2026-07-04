// 图片画廊弹窗 — 展示已生成的图片
import { useState, useEffect, useCallback } from 'react';
import { useImageGen } from '@/hooks/useImageGen';
import type { ImageTask, ImageCategory } from '@/api/imageGenTypes';
import { X, Trash2, ZoomIn, ImageIcon } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ImageGallery({ open, onClose }: Props) {
  const { tasks, getImageUrl, deleteImageTask } = useImageGen();
  const [filter, setFilter] = useState<ImageCategory | 'all'>('all');
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [selectedTask, setSelectedTask] = useState<ImageTask | null>(null);

  const completedTasks = tasks.filter((t) => t.status === 'completed');
  const filteredTasks = filter === 'all' ? completedTasks : completedTasks.filter((t) => t.category === filter);

  // 加载图片 URL
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const loadUrls = async () => {
      const newUrls: Record<string, string> = {};
      for (const task of filteredTasks) {
        if (imageUrls[task.id]) {
          newUrls[task.id] = imageUrls[task.id];
          continue;
        }
        try {
          const url = await getImageUrl(task);
          if (!cancelled) newUrls[task.id] = url;
        } catch {
          // skip failed loads
        }
      }
      if (!cancelled) setImageUrls((prev) => ({ ...prev, ...newUrls }));
    };

    loadUrls();
    return () => { cancelled = true; };
  }, [open, filteredTasks, getImageUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = useCallback(
    async (taskId: string) => {
      await deleteImageTask(taskId);
      setImageUrls((prev) => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
      if (selectedTask?.id === taskId) setSelectedTask(null);
    },
    [deleteImageTask, selectedTask],
  );

  if (!open) return null;

  const categoryTabs = [
    { label: '全部', value: 'all' as const },
    { label: '正文', value: 'story' as const },
    { label: '角色', value: 'character' as const },
    { label: '玩家', value: 'player' as const },
  ];

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '90vw',
          maxWidth: '900px',
          maxHeight: '85vh',
          background: 'var(--bg-secondary)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ImageIcon size={18} />
            <span style={{ fontWeight: '600', fontSize: 'var(--font-size-lg)' }}>图片画廊</span>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>({completedTasks.length})</span>
          </div>
          <button className="btn-ghost btn-sm" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* 分类筛选 */}
        <div
          style={{
            display: 'flex',
            gap: '4px',
            padding: '8px 16px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          {categoryTabs.map((tab) => (
            <button
              key={tab.value}
              className={`btn-ghost btn-sm${filter === tab.value ? ' active' : ''}`}
              style={{
                background: filter === tab.value ? 'var(--accent-dim)' : undefined,
                color: filter === tab.value ? 'var(--accent)' : undefined,
              }}
              onClick={() => setFilter(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 图片网格 */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '16px',
          }}
        >
          {filteredTasks.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '40px',
                color: 'var(--text-muted)',
              }}
            >
              暂无图片
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: '12px',
              }}
            >
              {filteredTasks.map((task) => (
                <div
                  key={task.id}
                  style={{
                    position: 'relative',
                    borderRadius: 'var(--radius-md)',
                    overflow: 'hidden',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-tertiary)',
                    cursor: 'pointer',
                  }}
                  onClick={() => setSelectedTask(task)}
                >
                  {imageUrls[task.id] ? (
                    <img
                      src={imageUrls[task.id]}
                      alt={task.prompt}
                      style={{ width: '100%', height: '160px', objectFit: 'cover', display: 'block' }}
                      loading="lazy"
                    />
                  ) : (
                    <div
                      style={{
                        width: '100%',
                        height: '160px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--text-muted)',
                      }}
                    >
                      加载中...
                    </div>
                  )}
                  <div style={{ padding: '8px' }}>
                    <div
                      style={{
                        fontSize: 'var(--font-size-xs)',
                        color: 'var(--text-secondary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {task.prompt}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                        {task.params?.model as string || ''}
                      </span>
                      <button
                        className="btn-ghost btn-sm"
                        style={{ padding: '2px', color: 'var(--danger)' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(task.id);
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 放大查看 */}
      {selectedTask && imageUrls[selectedTask.id] && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1001,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.85)',
            cursor: 'pointer',
          }}
          onClick={() => setSelectedTask(null)}
        >
          <img
            src={imageUrls[selectedTask.id]}
            alt={selectedTask.prompt}
            style={{ maxWidth: '90vw', maxHeight: '75vh', objectFit: 'contain', borderRadius: 'var(--radius-md)' }}
          />
          <div
            style={{
              marginTop: '12px',
              padding: '12px 20px',
              background: 'var(--bg-secondary)',
              borderRadius: 'var(--radius-md)',
              maxWidth: '600px',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)', marginBottom: '4px' }}>
              {selectedTask.prompt}
            </div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
              {selectedTask.params?.model as string} | {selectedTask.params?.sampler as string} |
              Steps: {selectedTask.params?.steps as number} | Seed: {selectedTask.params?.seed as number}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

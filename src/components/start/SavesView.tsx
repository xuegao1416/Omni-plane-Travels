import { useState, useRef } from 'react';
import { ArrowLeft, Save, Trash2, User, MessageSquare, FolderOpen, Download, Upload, Edit3, Check, X, AlertTriangle } from 'lucide-react';
import EmptyState from '../shared/EmptyState';
import type { SaveMeta, GameSave } from '../../storage/db';
import { loadGame as loadGameFromDb } from '../../storage/db';

/** 格式化字节数为可读字符串 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface SavesViewProps {
  allSaves: SaveMeta[];
  locale: string;
  currentSaveId: string | null;
  onBack: () => void;
  onLoadSave: (save: GameSave) => void;
  onDeleteSave: (id: string) => void;
  onForceDeleteSave: (id: string) => void;
  onRenameSave: (id: string, newName: string) => void;
  onImportSave: (file: File) => void;
  onExportSave: (id: string) => void;
}

export default function SavesView({
  allSaves, locale, currentSaveId, onBack, onLoadSave, onDeleteSave, onForceDeleteSave, onRenameSave, onImportSave, onExportSave,
}: SavesViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLoadSelected = async () => {
    if (!selectedId) return;
    setLoading(true);
    try {
      const fullSave = await loadGameFromDb(selectedId);
      if (fullSave) {
        onLoadSave(fullSave);
      }
    } finally {
      setLoading(false);
    }
  };

  const startRename = (id: string, currentName: string) => {
    setEditingId(id);
    setEditingName(currentName);
  };

  const confirmRename = () => {
    if (editingId && editingName.trim()) {
      onRenameSave(editingId, editingName.trim());
    }
    setEditingId(null);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImportSave(file);
      e.target.value = '';
    }
  };

  return (
    <div
      className="full-height"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        background: 'var(--bg-deep)',
        padding: '2rem',
      }}
    >
      <div style={{ width: '100%', maxWidth: '680px', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {/* 可滚动区域：头部 + 存档列表 */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {/* 头部 */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '1.5rem' }}>
          <button
            onClick={onBack}
            style={{ border: 'none', background: 'var(--bg-secondary)', width: '32px', height: '32px', borderRadius: 'var(--radius-md)', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: '12px' }}
          ><ArrowLeft size={16} /></button>
          <h2 style={{ fontSize: '1.2rem', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Save size={18} strokeWidth={1.5} />选择存档
          </h2>
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginLeft: '8px' }}>{allSaves.length} 个存档</span>
        </div>

        {/* 存档列表 */}
        {allSaves.length === 0 ? (
          <EmptyState icon={FolderOpen} message="暂无存档记录" />
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '10px',
            marginBottom: '1.5rem',
          }}>
            {allSaves.map(meta => {
              const isActive = meta.id === currentSaveId;
              const isSelected = meta.id === selectedId;
              const isEditing = meta.id === editingId;

              return (
                <div
                  key={meta.id}
                  className="surface-card"
                  onClick={() => setSelectedId(meta.id)}
                  style={{
                    padding: '14px 16px',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    borderColor: isSelected ? 'var(--accent)' : isActive ? 'var(--accent-dim)' : undefined,
                    boxShadow: isSelected ? '0 0 0 2px var(--accent-dim)' : 'none',
                  }}
                >
                  {/* 存档名 + 操作 */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <div style={{ fontWeight: '600', fontSize: 'var(--font-size-md)', display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0 }}>
                      {isEditing ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1 }}>
                          <input
                            value={editingName}
                            onChange={e => setEditingName(e.target.value)}
                            onClick={e => e.stopPropagation()}
                            onKeyDown={e => { if (e.key === 'Enter') confirmRename(); if (e.key === 'Escape') setEditingId(null); }}
                            style={{ flex: 1, fontSize: 'var(--font-size-md)', padding: '2px 6px', border: '1px solid var(--accent)', borderRadius: '4px', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                            autoFocus
                          />
                          <button onClick={e => { e.stopPropagation(); confirmRename(); }} style={{ border: 'none', background: 'none', color: 'var(--accent)', cursor: 'pointer', padding: '2px' }}><Check size={14} /></button>
                          <button onClick={e => { e.stopPropagation(); setEditingId(null); }} style={{ border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}><X size={14} /></button>
                        </div>
                      ) : (
                        <>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta.name}</span>
                          {isActive && <span style={{ fontSize: 'var(--font-size-xs)', padding: '1px 6px', borderRadius: '8px', background: 'var(--accent-dim)', color: 'var(--accent)', fontWeight: '500', flexShrink: 0 }}>当前</span>}
                        </>
                      )}
                    </div>
                    {!isEditing && (
                      <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
                        <button onClick={e => { e.stopPropagation(); startRename(meta.id, meta.name); }} title="重命名" style={{ border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}><Edit3 size={13} /></button>
                        <button onClick={e => { e.stopPropagation(); onExportSave(meta.id); }} title="导出" style={{ border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}><Download size={13} /></button>
                        <button onClick={e => { e.stopPropagation(); onDeleteSave(meta.id); }} title="删除" style={{ border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}><Trash2 size={13} /></button>
                      </div>
                    )}
                  </div>

                  {/* 预览信息 */}
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '6px' }}>
                    {meta.preview && (
                      <span style={{ fontSize: 'var(--font-size-xs)', padding: '2px 8px', borderRadius: '10px', background: 'var(--bg-tertiary)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}><User size={11} /> {meta.preview}</span>
                    )}
                  </div>

                  {/* 时间 + 存档大小 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                    <span>{new Date(meta.timestamp).toLocaleString(locale)}</span>
                    {meta.estBytes && meta.estBytes > 50 * 1024 * 1024 && (
                      <span style={{
                        display: 'flex', alignItems: 'center', gap: '2px',
                        color: 'var(--danger, #e74c3c)', fontWeight: 600,
                      }}>
                        <AlertTriangle size={11} />
                        {formatBytes(meta.estBytes)}
                      </span>
                    )}
                    {meta.messageCount && (
                      <span>{meta.messageCount} 条消息</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        </div>{/* 结束可滚动区域 */}

        {/* 底部操作栏 - 固定在底部 */}
        <div style={{
          display: 'flex',
          gap: '8px',
          justifyContent: 'center',
          flexWrap: 'wrap',
          paddingTop: '1rem',
          borderTop: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <button
            onClick={onBack}
            style={{
              padding: '10px 20px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              fontSize: 'var(--font-size-md)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <ArrowLeft size={14} /> 返回
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              padding: '10px 20px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              fontSize: 'var(--font-size-md)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Upload size={14} /> 导入存档
          </button>

          {selectedId && (
            <button
              onClick={() => onExportSave(selectedId)}
              style={{
                padding: '10px 20px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                fontSize: 'var(--font-size-md)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Download size={14} /> 导出存档
            </button>
          )}

          {selectedId && (
            <button
              onClick={() => onForceDeleteSave(selectedId)}
              style={{
                padding: '10px 20px',
                border: '1px solid var(--danger, #e74c3c)',
                borderRadius: 'var(--radius-md)',
                background: 'transparent',
                color: 'var(--danger, #e74c3c)',
                cursor: 'pointer',
                fontSize: 'var(--font-size-sm)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <AlertTriangle size={14} /> 强制删除
            </button>
          )}

          {selectedId && (
            <button
              onClick={handleLoadSelected}
              disabled={loading}
              style={{
                padding: '10px 24px',
                border: '1px solid var(--accent)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--accent-dim)',
                color: 'var(--accent)',
                cursor: loading ? 'wait' : 'pointer',
                fontSize: 'var(--font-size-md)',
                fontWeight: '600',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Save size={14} /> {loading ? '加载中...' : '读取存档'}
            </button>
          )}
        </div>

        {/* 隐藏的文件输入 */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleImport}
          style={{ display: 'none' }}
        />
      </div>
    </div>
  );
}

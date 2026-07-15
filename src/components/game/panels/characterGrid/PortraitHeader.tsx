import { useState, useEffect, useRef, useCallback } from 'react';
import { Star, X, ImageIcon, Upload, Save } from 'lucide-react';
import Avatar from '../../../shared/Avatar';
import { useDialog } from '../../../shared/Dialog';
import { useCharacterPortrait, buildPortraitPrompt } from '../../../../hooks/useCharacterPortrait';
import { imageDb } from '../../../../storage/imageDb';
import { saveNpcTemplate } from '../../../../storage/templateStore';
import type { NPCData } from '../../../../schema/variables';
import { categoryStyle, npcDataToCustomNpc } from './types';

export function PortraitHeader({ npc, npcId, onClose }: {
  npc: NPCData; npcId: string; onClose: () => void;
}) {
  const [portraitUrl, setPortraitUrl] = useState<string | null>(null);
  const [portraitStatus, setPortraitStatus] = useState('');
  const [showPortraitZoom, setShowPortraitZoom] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { DialogUI, prompt: dlgPrompt, alert: dlgAlert } = useDialog();
  const { generatePortrait } = useCharacterPortrait();

  const ext = npc as any;
  const cat = categoryStyle(npc.人物分类);

  useEffect(() => {
    const blobKey = ext.portraitBlobKey || `portrait-${npcId}`;
    let cancelled = false;
    (async () => {
      try {
        const record = await imageDb.getBlob(blobKey);
        if (!cancelled && record?.blob) {
          setPortraitUrl(URL.createObjectURL(record.blob));
        }
      } catch { /* no portrait saved yet */ }
    })();
    return () => { cancelled = true; };
  }, [ext.portraitBlobKey, npcId]);

  const handleGeneratePortrait = async () => {
    const defaultPrompt = buildPortraitPrompt(npc);
    const editedPrompt = await dlgPrompt('编辑画像提示词（英文 booru 标签）：', {
      defaultValue: defaultPrompt, title: '生成角色画像',
    });
    if (!editedPrompt?.trim()) return;
    const result = await generatePortrait(npc, setPortraitStatus, editedPrompt.trim());
    if (result) { setPortraitUrl(result.url); ext.portraitBlobKey = result.blobKey; }
  };

  const handleUploadPortrait = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const blobKey = `portrait-${npcId}`;
    try {
      await imageDb.saveBlob(blobKey, file, file.type);
      setPortraitUrl(URL.createObjectURL(file));
      ext.portraitBlobKey = blobKey;
    } catch (err) { console.error('上传头像失败:', err); }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [npcId, ext]);

  const handleSaveTemplate = async () => {
    const name = await dlgPrompt('请输入NPC模板名称：', { defaultValue: npc.姓名 || 'NPC模板', title: '保存NPC模板' });
    if (!name?.trim()) return;
    saveNpcTemplate(name.trim(), npcDataToCustomNpc(npc));
    await dlgAlert(`NPC模板「${name.trim()}」已保存 ✓`);
  };

  return (
    <>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
        <div style={{ position: 'relative' }}>
          <div onClick={() => portraitUrl && setShowPortraitZoom(true)} style={{ cursor: portraitUrl ? 'pointer' : 'default' }} title={portraitUrl ? '点击放大' : ''}>
            <Avatar name={npc.姓名 || npcId} size="lg" imageSrc={portraitUrl} />
          </div>
          <button onClick={handleGeneratePortrait} title={portraitUrl ? '重新生成画像' : '生成画像'} style={{
            position: 'absolute', bottom: -2, right: -2, width: '20px', height: '20px', borderRadius: 'var(--radius-md)',
            background: 'var(--accent)', border: '2px solid var(--bg-secondary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0,
          }}>
            <ImageIcon size={10} color="#fff" />
          </button>
          <button onClick={() => fileInputRef.current?.click()} title="上传自定义头像" style={{
            position: 'absolute', top: -2, right: -2, width: '20px', height: '20px', borderRadius: 'var(--radius-md)',
            background: 'var(--bg-tertiary)', border: '2px solid var(--bg-secondary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0,
          }}>
            <Upload size={10} color="var(--text-secondary)" />
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleUploadPortrait} style={{ display: 'none' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: '600', fontSize: 'var(--font-size-lg)', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            {npc.重要NPC && <Star size={14} fill="var(--warning)" color="var(--warning)" />}
            <span>{npc.姓名 || npcId}</span>
            <span style={{ fontSize: 'var(--font-size-xs)', padding: '2px 8px', borderRadius: '10px', background: cat.bg, color: cat.color, fontWeight: '500' }}>{cat.label}</span>
          </div>
          <div style={{ display: 'flex', gap: '6px', marginTop: '3px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--font-size-xs)', padding: '1px 7px', borderRadius: '10px', background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>{npc.种族 || '未知种族'}</span>
            <span style={{ fontSize: 'var(--font-size-xs)', padding: '1px 7px', borderRadius: '10px', background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>{npc.性别}</span>
            <span style={{ fontSize: 'var(--font-size-xs)', padding: '1px 7px', borderRadius: '10px', background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>{npc.年龄}岁</span>
          </div>
          {portraitStatus && (
            <div style={{ fontSize: 'var(--font-size-xs)', color: portraitStatus.includes('成功') ? 'var(--success)' : portraitStatus.includes('失败') || portraitStatus.includes('错误') ? 'var(--danger)' : 'var(--accent)', marginTop: '2px' }}>
              {portraitStatus}
            </div>
          )}
        </div>
        <button onClick={handleSaveTemplate} title="保存为NPC模板" style={{
          border: 'none', background: 'var(--bg-tertiary)', width: '28px', height: '28px',
          borderRadius: 'var(--radius-sm)', cursor: 'pointer', color: 'var(--accent)',
          flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Save size={14} />
        </button>
        <button onClick={onClose} style={{
          border: 'none', background: 'var(--bg-tertiary)', width: '28px', height: '28px',
          borderRadius: 'var(--radius-sm)', cursor: 'pointer', color: 'var(--text-muted)',
          flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}><X size={14} /></button>
      </div>

      {showPortraitZoom && portraitUrl && (
        <div onClick={() => setShowPortraitZoom(false)} style={{
          position: 'fixed', inset: 0, zIndex: 1100,
          background: 'rgba(0,0,0,0.8)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        }}>
          <img src={portraitUrl} alt={npc.姓名 || '头像'} style={{
            maxWidth: '90vw', maxHeight: '90vh',
            borderRadius: 'var(--radius-md)', objectFit: 'contain',
          }} />
        </div>
      )}
      {DialogUI}
    </>
  );
}

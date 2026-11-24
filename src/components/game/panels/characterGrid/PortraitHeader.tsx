import { useState,useEffect,useRef,useCallback, type CSSProperties } from 'react';
import { Star,X,ImageIcon,Upload,Save,Trash2 } from 'lucide-react';
import { useDialog } from '../../../shared/Dialog';
import { useCharacterPortrait,buildPortraitPrompt,translatePromptWithLLM } from '../../../../hooks/useCharacterPortrait';
import { imageDb } from '../../../../storage/imageDb';
import { saveNpcTemplate } from '../../../../storage/templateStore';
import { useStoredImageUrl } from '../../../../hooks/useStoredImageUrl';
import { useSaveStore } from '../../../../stores/saveStore';
import type { KnownNPC } from '../../../../engine/playerKnowledge';
import { favorClass,npcDataToCustomNpc } from './types';
import { useUISettings } from '../../../../context/UISettingsContext';
import { confirmNpcDeletion } from './confirmNpcDeletion';

const CATEGORY_TONE: Record<string, string> = { 在场: 'present', 重点: 'focus', 离场: 'away' };

function statusTone(text: string): 'ok' | 'error' | 'busy' {
  if (text.includes('失败') || text.includes('错误')) return 'error';
  return text.includes('成功') || text.includes('已保存') || text.includes('已恢复') ? 'ok' : 'busy';
}

/**
 * 人物卷宗的抬头：头像（生成 / 上传 / 放大）、姓名与标签、好感刻度，以及保存模板、删除、关闭。
 * 生成与上传的流程沿用原实现：生成前先翻译提示词并允许编辑，结果按 portrait-<id> 存进图片库。
 */
export function PortraitHeader({ npc, npcId, titleId, onClose, onDelete }: {
  npc: KnownNPC; npcId: string; onClose: () => void;
  /** 标题元素 id（给外层对话框的 aria-labelledby）。 */
  titleId?: string;
  /** 提供时，标题栏会出现一个删除按钮；点击后弹出二次确认。 */
  onDelete?: () => void | Promise<void>;
}) {
  const [portraitStatus, setPortraitStatus] = useState('');
  const [showPortraitZoom, setShowPortraitZoom] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { DialogUI, prompt: dlgPrompt, alert: dlgAlert, confirm: dlgConfirm, loading: dlgLoading, close: dlgClose } = useDialog();
  const { generatePortrait, recoverPortrait, findRecoverableImage } = useCharacterPortrait();
  const { t } = useUISettings();

  const ext = npc as any;
  const portraitUrl = useStoredImageUrl(ext.portraitBlobKey || `portrait-${npcId}`);
  const portraitIdentity = JSON.stringify(npc);
  const portraitOwner = useRef({ identity: portraitIdentity, npcId, mounted: true });
  portraitOwner.current.identity = portraitIdentity; portraitOwner.current.npcId = npcId;
  useEffect(() => {
    portraitOwner.current.mounted = true;
    return () => { portraitOwner.current.mounted = false; };
  }, []);
  const name = npc.姓名 || npcId;
  const category = npc.人物分类 ?? '';
  const favor = npc.关系数据?.好感度;
  const favorTone = favorClass(favor);
  const favorValue = typeof favor === 'number' ? Math.max(-100, Math.min(100, favor)) : undefined;

  const handleGeneratePortrait = async () => {
    const saveId = useSaveStore.getState().currentSaveId;
    const isCurrent = () => portraitOwner.current.mounted && portraitOwner.current.identity === portraitIdentity
      && portraitOwner.current.npcId === npcId && useSaveStore.getState().currentSaveId === saveId;
    const stableKey = `portrait-${npcId}`;
    if (findRecoverableImage(stableKey)) {
      try {
        const recovered = await recoverPortrait(stableKey, isCurrent);
        if (recovered && isCurrent()) {
          ext.portraitBlobKey = recovered.blobKey;
          setPortraitStatus('已恢复生成的画像');
        }
      } catch (error) { if (isCurrent()) setPortraitStatus(`恢复失败：${error instanceof Error ? error.message : String(error)}`); }
      return;
    }
    // 1. 显示加载弹窗
    dlgLoading('提示词翻译中，请稍候…', { title: '生成角色画像' });

    // 2. 调用 LLM 翻译
    let translatedPrompt: string;
    try {
      translatedPrompt = await translatePromptWithLLM(npc);
    } catch (e) {
      // LLM 失败时降级到本地字典翻译
      console.warn('[PortraitHeader] LLM 翻译失败，降级为本地翻译:', e);
      translatedPrompt = buildPortraitPrompt(npc);
    }

    // 3. 关闭加载弹窗，显示可编辑的翻译结果
    if (!isCurrent()) return;
    dlgClose();
    const editedPrompt = await dlgPrompt('编辑画像提示词（英文 booru 标签）：', {
      defaultValue: translatedPrompt, title: '生成角色画像',
    });
    if (!editedPrompt?.trim() || !isCurrent()) return;

    // 4. 生成画像
    const result = await generatePortrait(npc, status => { if (isCurrent()) setPortraitStatus(status); }, editedPrompt.trim(),
      { storageKey: stableKey, npcId, isCurrent });
    if (result && isCurrent()) {
      ext.portraitBlobKey = stableKey;
    }
  };

  const handleUploadPortrait = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const blobKey = `portrait-${npcId}`;
    const saveId = useSaveStore.getState().currentSaveId;
    const isCurrent = () => portraitOwner.current.mounted && portraitOwner.current.identity === portraitIdentity
      && portraitOwner.current.npcId === npcId && useSaveStore.getState().currentSaveId === saveId;
    try {
      await imageDb.saveBlob(blobKey, file, file.type, npc.姓名 || npcId, undefined, isCurrent);
      if (!isCurrent()) return;
      ext.portraitBlobKey = blobKey;
      setPortraitStatus('头像已保存');
    } catch (err) { console.error('上传头像失败:', err); }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [npcId, ext, npc, portraitIdentity]);

  const handleSaveTemplate = async () => {
    const templateName = await dlgPrompt('请输入NPC模板名称：', { defaultValue: npc.姓名 || 'NPC模板', title: '保存NPC模板' });
    if (!templateName?.trim()) return;
    saveNpcTemplate(templateName.trim(), npcDataToCustomNpc(npc));
    await dlgAlert(`NPC模板「${templateName.trim()}」已保存 ✓`);
  };

  const handleDeleteConfirm = async () => {
    if (!onDelete || deleting) return;
    await confirmNpcDeletion(
      () => dlgConfirm(t('npc.delete.confirm'), {
        title: t('npc.delete.title'),
        confirmText: t('npc.delete'),
        cancelText: t('common.cancel'),
        danger: true,
      }),
      async () => {
        setDeleting(true);
        try {
          await onDelete();
        } finally {
          setDeleting(false);
        }
      },
    );
  };

  const recoverable = findRecoverableImage(`portrait-${npcId}`);
  return (
    <>
      <header className="npc-head">
        <div className="npc-head__portrait">
          <button
            type="button"
            className="npc-head__frame"
            data-zoomable={Boolean(portraitUrl) || undefined}
            onClick={() => portraitUrl && setShowPortraitZoom(true)}
            title={portraitUrl ? '点击放大' : undefined}
            aria-label={portraitUrl ? `放大${name}的画像` : `${name}的画像`}
          >
            {portraitUrl ? <img src={portraitUrl} alt="" /> : <span>{name.trim()[0] ?? '?'}</span>}
          </button>
          <button type="button" className="npc-head__mini npc-head__mini--generate" onClick={handleGeneratePortrait}
            title={recoverable ? '保存并使用已生成的画像（无需重新生成）' : portraitUrl ? '重新生成画像' : '生成画像'} aria-label="生成画像">
            <ImageIcon size={11} />
          </button>
          <button type="button" className="npc-head__mini npc-head__mini--upload" onClick={() => fileInputRef.current?.click()} title="上传自定义头像" aria-label="上传自定义头像">
            <Upload size={11} />
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleUploadPortrait} hidden />
        </div>

        <div className="npc-head__title">
          <h2 className="npc-head__name" id={titleId}>
            {npc.重要NPC && <Star size={14} aria-label="重要人物" />}
            <span>{name}</span>
          </h2>
          <div className="npc-head__chips">
            <span className="npc-chip" data-tone={CATEGORY_TONE[category]}>{category || '状态未知'}</span>
            <span className="npc-chip">{npc.种族 || '未知种族'}</span>
            {npc.性别 && <span className="npc-chip">{npc.性别}</span>}
            {npc.年龄 !== undefined && npc.年龄 !== '' && <span className="npc-chip">{npc.年龄}{typeof npc.年龄 === 'number' || /^\d+$/.test(String(npc.年龄)) ? '岁' : ''}</span>}
            {npc.社会身份?.职业 && <span className="npc-chip">{npc.社会身份.职业}</span>}
          </div>
          {portraitStatus && <p className="npc-head__status" data-tone={statusTone(portraitStatus)} role="status">{portraitStatus}</p>}
        </div>

        <button type="button" className="npc-icon-btn npc-icon-btn--close npc-head__close" onClick={onClose} aria-label="关闭人物卷宗"><X size={16} /></button>

        <div className="npc-favor">
          <span>好感</span>
          <div className="npc-favor__track" style={{ '--favor': favorTone.color } as CSSProperties} aria-hidden="true">
            {favorValue !== undefined && (
              <i className="npc-favor__fill" style={favorValue >= 0
                ? { left: '50%', width: `${favorValue / 2}%` }
                : { left: `${50 + favorValue / 2}%`, width: `${-favorValue / 2}%` }} />
            )}
          </div>
          <span className="npc-favor__value" style={{ '--favor': favorTone.color } as CSSProperties}>
            <b>{favorValue ?? '未知'}</b>{npc.关系数据?.关系类型 ? ` · ${npc.关系数据.关系类型}` : ''}
          </span>
          <span className="npc-head__tools">
            <button type="button" className="npc-icon-btn npc-icon-btn--sm" onClick={handleSaveTemplate} title="保存为NPC模板" aria-label="保存为NPC模板"><Save size={14} /></button>
            {onDelete && (
              <button type="button" className="npc-icon-btn npc-icon-btn--sm npc-icon-btn--danger" onClick={handleDeleteConfirm} disabled={deleting} title={t('npc.delete.button')} aria-label={t('npc.delete.button')}>
                <Trash2 size={14} />
              </button>
            )}
          </span>
        </div>
      </header>

      {showPortraitZoom && portraitUrl && (
        <div className="npc-portrait-zoom" role="presentation" onClick={() => setShowPortraitZoom(false)}>
          <img src={portraitUrl} alt={npc.姓名 || '头像'} />
        </div>
      )}
      {DialogUI}
    </>
  );
}

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Check, RotateCcw, Trash2, X } from 'lucide-react';
import type { PlayerProfile, PortraitSettings } from '../../storage/db';

const PORTRAIT_DEFAULTS = {
  male: '/art/theme/ui-kit/dawn-v4/portraits/portrait-silhouette-male-v1.png',
  female: '/art/theme/ui-kit/dawn-v4/portraits/portrait-silhouette-female-v1.png',
  neutral: '/art/theme/ui-kit/dawn-v4/portraits/portrait-silhouette-neutral-v1.png',
} as const;

export const DEFAULT_PORTRAIT_SETTINGS: PortraitSettings = {
  source: 'default', zoom: 1, positionX: 0, positionY: 0,
};

export function getDefaultPortraitSource(gender: string): string {
  if (gender.includes('男')) return PORTRAIT_DEFAULTS.male;
  if (gender.includes('女')) return PORTRAIT_DEFAULTS.female;
  return PORTRAIT_DEFAULTS.neutral;
}

export function getPortraitSource(profile: Pick<PlayerProfile, 'gender' | 'portrait'>): string {
  return profile.portrait?.source === 'custom' && profile.portrait.customDataUrl
    ? profile.portrait.customDataUrl
    : getDefaultPortraitSource(profile.gender);
}

interface PortraitEditorProps {
  personalInfo: PlayerProfile;
  onChange: (portrait?: PortraitSettings) => void;
}

function normalizePortrait(portrait?: PortraitSettings): PortraitSettings {
  return {
    ...DEFAULT_PORTRAIT_SETTINGS,
    ...portrait,
    zoom: Math.min(1.8, Math.max(1, portrait?.zoom ?? 1)),
    positionX: Math.min(24, Math.max(-24, portrait?.positionX ?? 0)),
    positionY: Math.min(24, Math.max(-24, portrait?.positionY ?? 0)),
  };
}

function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('无法读取形象文件'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('形象文件无法解析'));
      image.onload = () => {
        const longest = Math.max(image.naturalWidth, image.naturalHeight);
        const ratio = longest > 768 ? 768 / longest : 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
        const context = canvas.getContext('2d');
        if (!context) { reject(new Error('当前浏览器不支持图片处理')); return; }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/webp', 0.84));
      };
      image.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export default function PortraitEditor({ personalInfo, onChange }: PortraitEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const didDragRef = useRef(false);
  const [draft, setDraft] = useState(() => normalizePortrait(personalInfo.portrait));
  const [editing, setEditing] = useState(personalInfo.portrait?.source === 'custom');
  const [error, setError] = useState('');

  useEffect(() => {
    setDraft(normalizePortrait(personalInfo.portrait));
    setEditing(personalInfo.portrait?.source === 'custom');
  }, [personalInfo.portrait]);

  const openPicker = () => inputRef.current?.click();
  const handleFile = async (file?: File) => {
    if (!file) return;
    setError('');
    try {
      const customDataUrl = await compressImage(file);
      setDraft({ source: 'custom', customDataUrl, zoom: 1, positionX: 0, positionY: 0, fileName: file.name });
      setEditing(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '形象文件处理失败');
    }
  };
  const updateDraft = (change: Partial<PortraitSettings>) => setDraft(current => normalizePortrait({ ...current, ...change }));
  const confirm = () => { onChange(draft); setEditing(draft.source === 'custom'); };
  const cancel = () => { setDraft(normalizePortrait(personalInfo.portrait)); setEditing(personalInfo.portrait?.source === 'custom'); setError(''); };
  const restoreDefault = () => {
    const next = { ...DEFAULT_PORTRAIT_SETTINGS };
    setDraft(next); onChange(undefined); setEditing(false); setError('');
  };

  const source = getPortraitSource({ gender: personalInfo.gender, portrait: editing ? draft : personalInfo.portrait });
  const transform = `translate(${draft.positionX}%, ${draft.positionY}%) scale(${draft.zoom})`;
  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (!editing) return;
    dragRef.current = { x: event.clientX, y: event.clientY };
    didDragRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current || !editing) return;
    const dx = event.clientX - dragRef.current.x;
    const dy = event.clientY - dragRef.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) didDragRef.current = true;
    updateDraft({ positionX: draft.positionX + dx * .18, positionY: draft.positionY + dy * .18 });
    dragRef.current = { x: event.clientX, y: event.clientY };
  };
  const handlePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div className="portrait-editor">
      <button type="button" className="portrait-editor__mirror" onClick={() => { if (!didDragRef.current) openPicker(); didDragRef.current = false; }} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} aria-label={editing ? '拖动调整人物形象，点击更换图片' : '更换人物形象'}>
        <span className="portrait-editor__frame">
          <img className="portrait-editor__frame-art" src="/art/theme/ui-kit/dawn-v4/ritual/identity-mirror-v1.png" alt="" aria-hidden="true" />
          <span className="portrait-editor__ellipse">
            <img src={source} alt="当前人物剪影" style={{ transform }} />
          </span>
        </span>
        <span className="portrait-editor__mirror-caption">万象镜 · 点击更换</span>
      </button>
      <input ref={inputRef} className="portrait-editor__input" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { void handleFile(event.target.files?.[0]); event.currentTarget.value = ''; }} />
      <div className="portrait-editor__actions">
        {editing && <>
          <label className="portrait-editor__range">缩放
            <input type="range" min="1" max="1.8" step="0.01" value={draft.zoom} onChange={event => updateDraft({ zoom: Number(event.target.value) })} aria-label="形象缩放" />
          </label>
          <label className="portrait-editor__range">上下
            <input type="range" min="-24" max="24" step="1" value={draft.positionY} onChange={event => updateDraft({ positionY: Number(event.target.value) })} aria-label="形象上下位置" />
          </label>
          <label className="portrait-editor__range">左右
            <input type="range" min="-24" max="24" step="1" value={draft.positionX} onChange={event => updateDraft({ positionX: Number(event.target.value) })} aria-label="形象左右位置" />
          </label>
          <button type="button" className="portrait-editor__icon-button" onClick={restoreDefault} title="恢复默认形象" aria-label="恢复默认形象"><RotateCcw size={13} /></button>
          <button type="button" className="portrait-editor__icon-button" onClick={() => { onChange(undefined); setDraft(normalizePortrait()); setEditing(false); }} title="删除自定义形象" aria-label="删除自定义形象"><Trash2 size={13} /></button>
          <button type="button" className="portrait-editor__icon-button" onClick={confirm} title="确认形象调整" aria-label="确认形象调整"><Check size={13} /></button>
          <button type="button" className="portrait-editor__icon-button" onClick={cancel} title="取消形象调整" aria-label="取消形象调整"><X size={13} /></button>
        </>}
      </div>
      {error && <p className="portrait-editor__error" role="alert">{error}</p>}
      {editing && draft.fileName && <span className="portrait-editor__filename" title={draft.fileName}>{draft.fileName}</span>}
    </div>
  );
}

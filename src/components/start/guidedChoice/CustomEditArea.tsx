import { Loader, Sparkles } from 'lucide-react';

interface CustomEditAreaProps {
  dimLabel: string;
  placeholderTitle: string;
  placeholderSubtitle: string;
  customTitle: string;
  customSubtitle: string;
  isCompleting: boolean;
  onTitleChange: (v: string) => void;
  onSubtitleChange: (v: string) => void;
  onCancel: () => void;
  onAIComplete: () => void;
  onSave: () => void;
}

export function CustomEditArea({ dimLabel, placeholderTitle, placeholderSubtitle, customTitle, customSubtitle, isCompleting, onTitleChange, onSubtitleChange, onCancel, onAIComplete, onSave }: CustomEditAreaProps) {
  return (
    <section className="guided-choice-custom-edit" aria-label={`自定义${dimLabel}`}>
      <div className="guided-choice-custom-edit__heading"><Sparkles size={15} /><strong>自定义「{dimLabel}」</strong></div>
      <div className="guided-choice-custom-edit__fields">
        <label><span>标题</span><input type="text" value={customTitle} onChange={e => onTitleChange(e.target.value)} placeholder={`例如：${placeholderTitle}`} maxLength={20} /></label>
        <label><span>描述</span><textarea value={customSubtitle} onChange={e => onSubtitleChange(e.target.value)} placeholder={`例如：${placeholderSubtitle}`} rows={3} maxLength={200} /></label>
      </div>
      <div className="guided-choice-custom-edit__actions">
        <button type="button" className="guided-choice-nav-button" onClick={onCancel}>取消</button>
        <button type="button" className="guided-choice-nav-button" onClick={onAIComplete} disabled={!customTitle.trim() || isCompleting}>
          {isCompleting ? <><Loader size={14} className="is-spinning" /> 补全中...</> : <><Sparkles size={14} /> AI 补全</>}
        </button>
        <button type="button" className="guided-choice-primary" onClick={onSave} disabled={!customTitle.trim()}>保存并选中</button>
      </div>
    </section>
  );
}

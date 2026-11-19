/** 模板选择弹窗 — 子组件拆分至 ./templatePicker/ */
import { useState,useRef,useCallback } from 'react';
import { Plus,FileJson,Users,User,BookOpen,ArrowLeft } from 'lucide-react';
import { useDialog } from './Dialog';
import OverlayPortal from './OverlayPortal';
import PlanarFrame from '../../ui/planar/PlanarFrame';
import type { TemplatePickerProps } from './templatePicker/types';
import type { NpcTemplate,PlayerPreset,HistoryPreset } from '../../storage/templateStore';
import { getNpcTemplates,importNpcFromTemplate,parseNpcTemplateJSON,getPlayerPresets,parsePlayerPresetJSON,applyPresetToProfile,deleteNpcTemplate,deletePlayerPreset,getHistoryPresets,parseHistoryPresetJSON,deleteHistoryPreset } from '../../storage/templateStore';
import { OptionCard } from './templatePicker/OptionCard';
import { TemplateCard } from './templatePicker/TemplateCard';
import s from './templatePicker/styles.module.css';

export type { NpcPickerProps, PlayerPickerProps, HistoryPickerProps } from './templatePicker/types';

export default function TemplatePickerDialog(props: TemplatePickerProps) {
  const { mode, onClose } = props;
  const [view, setView] = useState<'main' | 'list'>('main');
  const [templates, setTemplates] = useState(() =>
    mode === 'npc' ? getNpcTemplates() : mode === 'history' ? getHistoryPresets() : getPlayerPresets()
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { DialogUI, confirm: dlgConfirm, alert: dlgAlert } = useDialog();

  const refresh = useCallback(() => {
    setTemplates(mode === 'npc' ? getNpcTemplates() : mode === 'history' ? getHistoryPresets() : getPlayerPresets());
  }, [mode]);

  const showError = (msg: string) => dlgAlert(msg, { title: '导入错误' });
  const handleFileImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const text = await file.text();
      if (mode === 'npc') {
        const r = parseNpcTemplateJSON(text);
        if (!r.ok) { await showError(`导入失败：${r.error}`); return; }
        props.onImportTemplate(importNpcFromTemplate(r.data));
      } else if (mode === 'history') {
        const r = parseHistoryPresetJSON(text);
        if (!r.ok) { await showError(`导入失败：${r.error}`); return; }
        props.onApplyPreset(r.data);
      } else {
        const r = parsePlayerPresetJSON(text);
        if (!r.ok) { await showError(`导入失败：${r.error}`); return; }
        props.onApplyPreset(applyPresetToProfile(r.data, props.currentProfile));
      }
      onClose();
    } catch (err) { await showError(`文件读取失败：${err instanceof Error ? err.message : String(err)}`);
    } finally { e.target.value = ''; }
  }, [mode, props, onClose, dlgAlert]);

  const handleSelect = useCallback((tpl: NpcTemplate | PlayerPreset | HistoryPreset) => {
    if (mode === 'npc') props.onImportTemplate(importNpcFromTemplate(tpl as NpcTemplate));
    else if (mode === 'history') props.onApplyPreset(tpl as HistoryPreset);
    else props.onApplyPreset(applyPresetToProfile(tpl as PlayerPreset, props.currentProfile));
    onClose();
  }, [mode, props, onClose]);

  const handleDelete = useCallback(async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!await dlgConfirm('确定删除这个模板吗？', { title: '删除模板', danger: true, confirmText: '删除' })) return;
    if (mode === 'npc') deleteNpcTemplate(id);
    else if (mode === 'history') deleteHistoryPreset(id);
    else deletePlayerPreset(id);
    refresh();
  }, [mode, refresh, dlgConfirm]);

  const title = mode === 'npc' ? '创建NPC' : mode === 'history' ? '导入人生经历预设' : '导入主角预设';
  const listTitle = mode === 'npc' ? 'NPC 模板库' : mode === 'history' ? '人生经历预设库' : '主角预设库';
  const listIcon = mode === 'npc' ? <Users size={18} /> : mode === 'history' ? <BookOpen size={18} /> : <User size={18} />;
  const tplLabel = mode === 'npc' ? 'NPC模板' : mode === 'history' ? '经历预设' : '预设';

  return (
    <OverlayPortal className="pk-dialog-overlay" ariaLabel={view === 'main' ? title : listTitle} onClose={onClose}>
      <PlanarFrame className={`pk-dialog ${s.dialog}`} onClick={e => e.stopPropagation()}>
        <header className={s.dialogHeader}>
          <small className={s.dialogKicker}>{view === 'main' ? (mode === 'npc' ? '同行者' : mode === 'history' ? '前尘编年' : '降临身份') : '档案库'}</small>
          <h2 className={`pk-title ${s.dialogTitle}`}>{view === 'main' ? title : listTitle}</h2>
          <p className={s.dialogSubtitle}>{view === 'main' ? (mode === 'npc' ? '选择创建方式' : '选择导入来源') : '点击条目载入，右侧可删除'}</p>
        </header>

        <div className={s.dialogBody}>
          {view === 'main' ? (
            <div className={s.optionList}>
              {mode === 'npc' && <OptionCard icon={<Plus size={18} />} title="空白新建" desc="从零开始创建一个新的NPC" onClick={() => { props.onBlank(); onClose(); }} />}
              {templates.length > 0 && <OptionCard icon={listIcon} title={mode === 'npc' ? '从模板导入' : '从预设导入'} desc={`已保存 ${templates.length} 个${tplLabel}`} onClick={() => setView('list')} />}
              <OptionCard icon={<FileJson size={18} />} title="导入 JSON 文件" desc="从本地文件导入（支持多种格式自动识别）" onClick={() => fileInputRef.current?.click()} />
            </div>
          ) : (
            <div className={s.templateList}>
              {templates.map(tpl => <TemplateCard key={tpl.id} tpl={tpl} mode={mode} onSelect={handleSelect} onDelete={handleDelete} />)}
            </div>
          )}
        </div>

        <div className="pk-dialog__actions">
          {view === 'list' && <button type="button" className="pk-btn pk-btn--secondary" onClick={() => setView('main')}><ArrowLeft />返回</button>}
          <button type="button" className="pk-btn pk-btn--ghost" onClick={onClose}>取消</button>
        </div>
        <input ref={fileInputRef} type="file" accept=".json" className={s.hiddenInput} onChange={handleFileImport} />
        {DialogUI}
      </PlanarFrame>
    </OverlayPortal>
  );
}

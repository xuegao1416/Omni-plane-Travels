import { useState } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import type { PresetPack } from '@/data/builtinPresets';
import { DRC_WORD_COUNT_PROMPT_ID } from '@/data/presetDrcV12';
import { DRC_PERSPECTIVE_NOTICE, getChoiceValue, getPresetChoiceControls, getPresetToggleSections, selectPresetChoice } from '@/data/presetControls';
import { getDrcWordRange, setDrcWordRange } from '@/data/presetParameters';
import './PresetQuickControls.css';

function WordRange({ preset, onSave }: { preset: PresetPack; onSave: (preset: PresetPack) => void }) {
  const range = getDrcWordRange(preset);
  const [min, setMin] = useState(String(range?.min ?? ''));
  const [max, setMax] = useState(String(range?.max ?? ''));
  const [error, setError] = useState('');
  const enabled = preset.prompts.find(p => p.identifier === DRC_WORD_COUNT_PROMPT_ID)?.enabled;
  if (!range) return <p className="preset-quick-note">字数条目已使用自定义文本，可在「高级条目」中编辑。</p>;
  return (
    <form className="preset-quick-range" onSubmit={event => {
      event.preventDefault();
      try { onSave(setDrcWordRange(preset, Number(min), Number(max))); setError(''); }
      catch (error) { setError(error instanceof Error ? error.message : '保存失败，请重试。'); }
    }}>
      <label>最少字数<input type="number" min={100} max={19999} step={1} required value={min} disabled={!enabled} onChange={event => setMin(event.target.value)} /></label>
      <label>最多字数<input type="number" min={101} max={20000} step={1} required value={max} disabled={!enabled} onChange={event => setMax(event.target.value)} /></label>
      <button type="submit" disabled={!enabled}>应用字数</button>
      {!enabled && <span className="preset-quick-note">选择「字数设定」后生效</span>}
      {error && <p className="preset-quick-error" role="alert">{error}</p>}
    </form>
  );
}

export function PresetQuickControls({ preset, onSave }: { preset: PresetPack; onSave: (preset: PresetPack) => void }) {
  const [query, setQuery] = useState('');
  const choices = getPresetChoiceControls(preset);
  const sections = getPresetToggleSections(preset);
  const matches = (text: string) => text.toLowerCase().includes(query.trim().toLowerCase());
  const visibleChoices = choices.filter(control => matches(`${control.label} ${control.section} ${control.options.map(option => option.label).join(' ')}`));
  const visibleSections = sections.map(section => ({ ...section, entries: preset.prompts.filter(p =>
    section.promptIds.includes(p.identifier) && matches(`${section.label} ${p.name}`)) })).filter(section => section.entries.length);
  const wordEntry = preset.prompts.find(p => p.identifier === DRC_WORD_COUNT_PROMPT_ID);
  return (
    <div className="preset-quick">
      <div className="preset-quick-intro"><SlidersHorizontal size={18} /><span>快捷配置</span><small>修改后自动保存并启用此预设</small></div>
      <label className="preset-quick-search"><Search size={16} /><input aria-label="搜索预设配置" type="search" placeholder="搜索文风、角色表现、表达修正…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      {visibleChoices.length > 0 && <section className="preset-quick-section" aria-label="创作偏好">
        <h3>创作偏好</h3>
        <div className="preset-quick-grid">{visibleChoices.map(control => {
          const value = getChoiceValue(preset, control);
          return <label key={control.id} className="preset-quick-choice">
            <span>{control.label}</span>
            <select value={value} onChange={event => onSave(selectPresetChoice(preset, control, event.target.value))}>
              {value === '__mixed__' && <option value="__mixed__" disabled>存在其他启用项，请重新选择</option>}
              {control.allowOff && <option value="">关</option>}
              {control.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            {value === '__mixed__' && <small className="preset-quick-note">选一项会自动关闭本组其余选项。</small>}
          </label>;
        })}</div>
        {wordEntry && visibleChoices.some(control => control.id === 'word_count') && <WordRange key={wordEntry.content} preset={preset} onSave={onSave} />}
      </section>}
      {visibleSections.map(section => <section key={section.id} className="preset-quick-section" aria-label={section.label}>
        <h3>{section.label}</h3>
        <div className="preset-quick-grid">{section.entries.map(entry => <label key={entry.identifier} className="preset-quick-toggle">
          <span>{entry.name.split('丨').at(-1) ?? entry.name}</span>
          <input type="checkbox" role="switch" checked={entry.enabled} onChange={event => onSave({ ...preset, prompts: preset.prompts.map(p => p.identifier === entry.identifier ? { ...p, enabled: event.target.checked } : p) })} />
          <small>{entry.enabled ? '开' : '关'}</small>
        </label>)}</div>
      </section>)}
      {!visibleChoices.length && !visibleSections.length && <p className="preset-quick-empty">{query.trim() ? '没有匹配的配置项。' : '此预设暂无快捷配置，可在「高级条目」中编辑。'}</p>}
      {preset.prompts.some(p => p.identifier === 'drc_host_perspective_protocol') && <p className="preset-quick-note">{DRC_PERSPECTIVE_NOTICE}</p>}
      <p className="preset-quick-note">更多提示词内容可在「高级条目」中编辑。已有自定义内容会保留。</p>
    </div>
  );
}

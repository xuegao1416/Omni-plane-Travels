import { useState } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import type { PresetPack } from '@/data/builtinPresets';
import { DRC_PERSPECTIVE_NOTICE, getChoiceValue, getPresetChoiceControls, getPresetToggleSections, selectPresetChoice } from '@/data/presetControls';
import { getPresetWordRange, getPresetWordRangeEntry, resetPresetWordRange, setPresetWordRange } from '@/data/presetParameters';
import './PresetQuickControls.css';

function WordRange({ preset, onSave }: { preset: PresetPack; onSave: (preset: PresetPack) => void }) {
  const range = getPresetWordRange(preset);
  const [min, setMin] = useState(String(range?.min ?? ''));
  const [max, setMax] = useState(String(range?.max ?? ''));
  const [error, setError] = useState('');
  const entry = getPresetWordRangeEntry(preset);
  const enabled = entry?.enabled;
  if (!range) return (
    <div className="preset-quick-range preset-quick-range--reset">
      <p className="preset-quick-note">「字数设定」条目已被改成自定义文本，快捷区间输入暂不可用。</p>
      <button type="button" onClick={() => {
        try { onSave(resetPresetWordRange(preset)); setError(''); }
        catch (cause) { setError(cause instanceof Error ? cause.message : '转换失败，请重试。'); }
      }}>改用区间模式（覆盖自定义文本）</button>
      {error && <p className="preset-quick-error" role="alert">{error}</p>}
    </div>
  );
  return (
    <form className="preset-quick-range" onSubmit={event => {
      event.preventDefault();
      try { onSave(setPresetWordRange(preset, Number(min), Number(max))); setError(''); }
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
  const wordEntry = getPresetWordRangeEntry(preset);
  const hasWordChoice = choices.some(control => control.id === 'word_count');
  const showStandaloneWordRange = !!wordEntry && !hasWordChoice && matches('篇幅 字数 最少字数 最多字数');
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
      {showStandaloneWordRange && <section className="preset-quick-section" aria-label="篇幅">
        <h3>篇幅</h3>
        <WordRange key={wordEntry.content} preset={preset} onSave={onSave} />
      </section>}
      {visibleSections.map(section => <section key={section.id} className="preset-quick-section" aria-label={section.label}>
        <h3>{section.label}</h3>
        <div className="preset-quick-grid">{section.entries.map(entry => <label key={entry.identifier} className="preset-quick-toggle">
          <span>{entry.name.split('丨').at(-1) ?? entry.name}</span>
          <input type="checkbox" role="switch" checked={entry.enabled} onChange={event => onSave({ ...preset, prompts: preset.prompts.map(p => p.identifier === entry.identifier ? { ...p, enabled: event.target.checked } : p) })} />
          <small>{entry.enabled ? '开' : '关'}</small>
        </label>)}</div>
      </section>)}
      {!visibleChoices.length && !visibleSections.length && !showStandaloneWordRange && <p className="preset-quick-empty">{query.trim() ? '没有匹配的配置项。' : '此预设暂无快捷配置，可在「高级条目」中编辑。'}</p>}
      {preset.prompts.some(p => p.identifier === 'drc_host_perspective_protocol') && <p className="preset-quick-note">{DRC_PERSPECTIVE_NOTICE}</p>}
      <p className="preset-quick-note">更多提示词内容可在「高级条目」中编辑。已有自定义内容会保留。</p>
    </div>
  );
}

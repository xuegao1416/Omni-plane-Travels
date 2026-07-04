// ============================================================
// 提示词模板区块 — 使用共享组件重写
// ============================================================

import { ChevronRight, RotateCcw, FileText } from 'lucide-react';
import type { NarrativePromptTemplates } from '../../../memory/types';
import { TextArea, Button } from '../SettingsUIComponents';

interface Props {
  templates: NarrativePromptTemplates;
  expanded: Record<string, boolean>;
  onToggle: (key: string) => void;
  onChange: (key: string, value: string) => void;
  onReset: (key: string) => void;
}

const PROMPT_SECTIONS: { key: keyof NarrativePromptTemplates; label: string; desc: string }[] = [
  { key: 'ingest', label: '对象写入提示词', desc: '把最新剧情批次写入 scene / thread / state / relation / event / entity。' },
  { key: 'summary', label: '摘要保存提示词', desc: '主写入完成后，只总结本层剧情的新增推进，生成稳定标题与正文摘要。' },
  { key: 'retrievePlanner', label: '发送前上下文记忆整理提示词', desc: '发送前结合当前输入、最近原始剧情、热编译摘要，以及候选记忆的标题、关键词和完整摘要正文，整理输出最终上下文记忆。' },
  { key: 'multiRoundRetrievePlanner', label: '多轮检索提示词（非最后一轮）', desc: '多轮检索模式下，非最后一轮使用。AI 会根据前序检索结果判断是否需要继续检索。' },
  { key: 'multiRoundRetrievePlannerFinal', label: '多轮检索提示词（最后一轮）', desc: '多轮检索模式下，最后一轮使用。AI 必须基于所有前序检索结果整理出完整的上下文记忆。' },
  { key: 'queryRewrite', label: '编译查询改写提示词', desc: '把当前输入重写为适合对象层召回与编译的查询包。' },
  { key: 'rerank', label: '对象候选精排提示词', desc: '为线程、状态、关系、事件、实体候选做最终排序。' },
  { key: 'conflictJudge', label: '对象冲突裁决提示词', desc: '判断新旧对象冲突时如何覆盖、失效、保留。' },
  { key: 'vectorExtract', label: '向量事实提取提示词', desc: '把剧情提炼成长程向量事实库。' },
  { key: 'vectorQueryRewrite', label: '语义检索分析提示词', desc: '在长程向量召回前，先分析玩家输入、最近原始剧情与热编译摘要。' },
  { key: 'vectorRerank', label: '向量候选重排提示词', desc: '对长程向量候选做最终 LLM 兜底重排。' },
];

export function PromptTemplatesPanel({ templates, expanded, onToggle, onChange, onReset }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <FileText size={16} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 'var(--font-size-lg)', fontWeight: '600' }}>记忆系统提示词</span>
        </div>
        <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
          旧小总结 / 大总结 / 审计提示词已彻底移除，只保留新系统对象写入与召回提示词。
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {PROMPT_SECTIONS.map(section => {
          const isOpen = !!expanded[section.key];
          const value = String(templates[section.key] ?? '');
          return (
            <div key={section.key} style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
              transition: 'border-color 0.15s',
            }}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => onToggle(section.key)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(section.key); } }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 16px', cursor: 'pointer', gap: '12px',
                  background: 'none', border: 'none', width: '100%',
                  color: 'var(--text-primary)', textAlign: 'left',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-dim)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <div>
                  <div style={{ fontSize: 'var(--font-size-base)', fontWeight: '600' }}>{section.label}</div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: '2px' }}>{section.desc}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <div onClick={e => e.stopPropagation()}>
                    <Button onClick={() => onReset(section.key)} icon={<RotateCcw size={10} />}>
                      默认
                    </Button>
                  </div>
                  <ChevronRight size={14} style={{
                    color: isOpen ? 'var(--accent)' : 'var(--text-muted)',
                    transform: isOpen ? 'rotate(90deg)' : 'none',
                    transition: 'transform 0.15s, color 0.15s',
                  }} />
                </div>
              </div>
              {isOpen && (
                <div style={{ padding: '0 16px 16px' }}>
                  <TextArea
                    value={value}
                    onChange={v => onChange(section.key, v)}
                    placeholder={`请输入 ${section.label}`}
                    rows={10}
                    mono
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

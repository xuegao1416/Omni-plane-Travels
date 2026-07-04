// 预设导入/导出工具 — 兼容 SillyTavern JSON 格式
import { v4 as uuid } from 'uuid';
import type { PresetPack, PresetPromptEntry } from '@/data/builtinPresets';
import type { RegexScript } from '@/utils/regexScripts';
export { downloadJSON } from './download';

// ─── 导出 ───

interface ExportEnvelope<T> {
  type: string;
  version: string;
  exportedAt: number;
  data: T;
}

export function exportPresetJSON(pack: PresetPack): string {
  // 导出为 SillyTavern 兼容格式
  const exportData: Record<string, unknown> = {
    name: pack.name,
    // 模型参数（如果有）
    ...(pack.temperature != null && { temperature: pack.temperature }),
    ...(pack.top_p != null && { top_p: pack.top_p }),
    ...(pack.max_tokens != null && { max_tokens: pack.max_tokens }),
    ...(pack.max_context != null && { max_context: pack.max_context }),
    // 提示词条目
    prompts: (pack.prompts || []).map(p => ({
      identifier: p.identifier,
      name: p.name,
      role: p.role,
      content: p.content,
      injection_position: 0,
      injection_depth: 4,
      enabled: p.enabled,
      marker: false,
    })),
    // 排序
    prompt_order: [{
      character_id: 100001,
      order: (pack.prompts || [])
        .filter(p => p.enabled)
        .sort((a, b) => a.order - b.order)
        .map(p => p.identifier),
    }],
    // 正则脚本 — 同时写入 v1 和 v2 路径
    extensions: {
      SPreset: {
        RegexBinding: {
          regexes: normalizeRegexForExport(pack.regexScripts || []),
        },
      },
      regex_scripts: normalizeRegexForExport(pack.regexScripts || []),
    },
  };

  return JSON.stringify(exportData, null, 2);
}

function normalizeRegexForExport(scripts: RegexScript[]): Record<string, unknown>[] {
  return scripts.map(s => ({
    id: s.id,
    scriptName: s.scriptName,
    findRegex: s.findRegex,
    replaceString: s.replaceString,
    trimStrings: [],
    placement: s.placement,
    disabled: s.disabled,
    markdownOnly: s.markdownOnly || false,
    promptOnly: s.promptOnly || false,
    runOnEdit: false,
    substituteRegex: 0,
    minDepth: s.minDepth ?? null,
    maxDepth: s.maxDepth ?? null,
  }));
}

// ─── 导入 ───

type ValidateResult<T> = { ok: true; data: T } | { ok: false; error: string };

function isStr(v: unknown): v is string { return typeof v === 'string'; }
function isObj(v: unknown): v is Record<string, unknown> { return typeof v === 'object' && v !== null && !Array.isArray(v); }

/** 解析并校验预设 JSON（兼容 SillyTavern 格式 + 项目自有格式） */
export function parsePresetJSON(jsonStr: string): ValidateResult<PresetPack> {
  let raw: unknown;
  try { raw = JSON.parse(jsonStr); } catch {
    return { ok: false, error: 'JSON 解析失败，请检查文件格式' };
  }

  if (!isObj(raw)) return { ok: false, error: 'JSON 根必须是对象' };

  const data = raw as Record<string, unknown>;

  // 提取 name
  const name = isStr(data.name) ? data.name.trim() : '导入的预设';
  if (!name) return { ok: false, error: '预设名称不能为空' };

  // 提取 prompts
  const prompts = parsePrompts(data.prompts);

  // 提取 regex_scripts — 尝试多个位置
  const regexScripts = parseRegexScripts(data);

  // 提取模型参数
  const temperature = typeof data.temperature === 'number' ? data.temperature : undefined;
  const top_p = typeof data.top_p === 'number' ? data.top_p : undefined;
  const max_tokens = typeof data.max_tokens === 'number' ? data.max_tokens : undefined;
  const max_context = typeof data.max_context === 'number' ? data.max_context : undefined;

  return {
    ok: true,
    data: {
      id: uuid(),
      name,
      description: isStr(data.description) ? data.description : undefined,
      temperature,
      top_p,
      max_tokens,
      max_context,
      prompts,
      regexScripts,
      builtin: false,
    },
  };
}

function parsePrompts(raw: unknown): PresetPromptEntry[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((p): p is Record<string, unknown> => isObj(p))
    .map((p, index) => ({
      identifier: isStr(p.identifier) ? p.identifier : `imported_${index}`,
      name: isStr(p.name) ? p.name : `条目 ${index + 1}`,
      role: (p.role === 'user' || p.role === 'assistant') ? p.role as 'user' | 'assistant' : 'system' as const,
      content: isStr(p.content) ? p.content : '',
      enabled: p.enabled !== false,
      order: typeof p.order === 'number' ? p.order : (index + 1) * 100,
    }))
    .filter(p => p.content); // 过滤空内容
}

function parseRegexScripts(data: Record<string, unknown>): RegexScript[] {
  // 尝试从多个位置提取正则脚本
  let rawScripts: unknown[] = [];

  // v1: extensions.SPreset.RegexBinding.regexes
  const ext = data.extensions;
  if (isObj(ext)) {
    const spreset = ext.SPreset;
    if (isObj(spreset)) {
      const binding = spreset.RegexBinding;
      if (isObj(binding) && Array.isArray(binding.regexes)) {
        rawScripts = binding.regexes;
      }
    }
    // v2: extensions.regex_scripts
    if (rawScripts.length === 0 && Array.isArray(ext.regex_scripts)) {
      rawScripts = ext.regex_scripts;
    }
  }

  // v3: 直接在根级别的 regex_scripts
  if (rawScripts.length === 0 && Array.isArray(data.regex_scripts)) {
    rawScripts = data.regex_scripts;
  }

  return rawScripts
    .filter((s): s is Record<string, unknown> => isObj(s))
    .map(s => normalizeRegexScript(s))
    .filter((s): s is RegexScript => s !== null);
}

function normalizeRegexScript(raw: Record<string, unknown>): RegexScript | null {
  const findRegex = isStr(raw.findRegex) ? raw.findRegex
    : isStr(raw.regex) ? raw.regex  // 兼容 legacy 命名
    : '';
  if (!findRegex) return null;

  const replaceString = isStr(raw.replaceString) ? raw.replaceString
    : isStr(raw.replacement) ? raw.replacement  // 兼容 legacy 命名
    : '';

  return {
    id: isStr(raw.id) ? raw.id : uuid(),
    scriptName: isStr(raw.scriptName) ? raw.scriptName : '导入的正则',
    findRegex,
    replaceString,
    placement: Array.isArray(raw.placement) ? raw.placement.filter((n): n is number => typeof n === 'number') : [2],
    disabled: raw.disabled === true,
    markdownOnly: raw.markdownOnly === true,
    promptOnly: raw.promptOnly === true,
    minDepth: typeof raw.minDepth === 'number' ? raw.minDepth : null,
    maxDepth: typeof raw.maxDepth === 'number' ? raw.maxDepth : null,
  };
}

// ─── 正则单独导入/导出 ───

export function exportRegexScriptsJSON(scripts: RegexScript[], name: string): string {
  return JSON.stringify(scripts.map(s => ({
    id: s.id,
    scriptName: s.scriptName,
    findRegex: s.findRegex,
    replaceString: s.replaceString,
    placement: s.placement,
    disabled: s.disabled,
    markdownOnly: s.markdownOnly,
    promptOnly: s.promptOnly,
    minDepth: s.minDepth ?? null,
    maxDepth: s.maxDepth ?? null,
  })), null, 2);
}

export function parseRegexScriptsJSON(jsonStr: string): ValidateResult<RegexScript[]> {
  let raw: unknown;
  try { raw = JSON.parse(jsonStr); } catch {
    return { ok: false, error: 'JSON 解析失败' };
  }

  // 支持单个对象或数组
  const arr = Array.isArray(raw) ? raw : [raw];
  const scripts = arr
    .filter((s): s is Record<string, unknown> => isObj(s))
    .map(s => normalizeRegexScript(s))
    .filter((s): s is RegexScript => s !== null);

  if (scripts.length === 0) return { ok: false, error: '未找到有效的正则脚本' };
  return { ok: true, data: scripts };
}

// 上下文管理器 - 负责清理发送给AI的消息上下文
// 使用正则脚本系统替代硬编码的标签清理逻辑

import type { ChatMessage } from './types';
import type { Message } from '../api/types';
import { processRegexScripts } from '../utils/regexScripts';
import { getBuiltinPromptScripts } from '../data/builtinPresets';
import { usePresetStore } from '../stores/presetStore';
import { extractContentForPrompt } from './responseExtractor';

/** 获取消息的原始文本 */
export function getMessageContent(msg: ChatMessage): string {
  return msg.rawText || '';
}

/** 核心函数：清理消息上下文用于发送给AI */
export function sanitizeForContext(messages: ChatMessage[], currentRound: number): Message[] {
  const MAX_HISTORY = 20;
  const SUMMARY_DEPTH_THRESHOLD = 10;
  // 内置 API 正则始终执行 + 预设正则叠加
  const activePreset = usePresetStore.getState().getActivePreset();
  const presetPromptScripts = (activePreset.regexScripts || []).filter(s => s.promptOnly && !s.disabled);
  const promptScripts = [...getBuiltinPromptScripts(), ...presetPromptScripts];

  // 取最近N条消息
  const recentMessages = messages
    .filter(m => m.round < currentRound)
    .slice(-MAX_HISTORY);

  return recentMessages.map(m => {
    // 从 rawText 提取纯正文（剥掉所有标签）
    let content = m.role === 'assistant'
      ? extractContentForPrompt(getMessageContent(m))
      : getMessageContent(m);

    if (m.role === 'assistant') {
      const depth = currentRound - m.round;

      // 用正则脚本清理所有元数据标签
      content = processRegexScripts(content, promptScripts, 'Output', depth);

      // 深度>10：只保留 summary
      if (depth > SUMMARY_DEPTH_THRESHOLD) {
        content = m.summary || content;
      }
    }

    // 清理多余空行
    content = content.replace(/\n{3,}/g, '\n\n').trim();

    return { role: m.role, content };
  }).filter(m => m.content.length > 0);
}

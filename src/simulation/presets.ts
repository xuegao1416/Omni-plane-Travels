/**
 * 后台世界推演 — 预设系统
 *
 * 将推演 prompt 拆分为可配置的条目，支持：
 * - 按 order 排序拼接
 * - 按 enabled 开关控制
 * - always/keyword 触发模式
 * - 导入/导出自定义预设
 */

import type { SimPreset, SimPresetEntry } from './types';

// ─── 内置默认预设 ───

const DEFAULT_ENTRIES: SimPresetEntry[] = [
  {
    id: 'identity',
    order: 10,
    title: '系统身份',
    enabled: true,
    triggerMode: 'always',
    content: '你是一个世界推演引擎，负责在玩家不在场时推进世界事件和角色故事。你的推演应基于世界设定的内在逻辑，保持因果链的连贯性。',
  },
  {
    id: 'cascade_rules',
    order: 20,
    title: '事件级联规则',
    enabled: true,
    triggerMode: 'always',
    content: `## 事件层级传导规则（补充）

上面已经给出了本世界的五层架构及其特化标签。这里补充通用规则：
- 每层事件应有内在因果链，不是孤立发生
- 上层事件应自然催生下层影响
- 每个事件都应至少产生 1-2 个子事件，形成级联
- 每个层级都必须生成至少 1 个玩家切入点（playerHooks）
- 切入点应该具体、生动，让玩家有强烈的参与动机
- 角色暗线应有内在逻辑：基于性格、目标、所处环境
- 暗线推进应受世界事件影响
- 保持世界设定的内部一致性
- 不要改变已有事件的 status（除非是自然发展）`,
  },
  {
    id: 'event_schema',
    order: 30,
    title: '事件 JSON Schema',
    enabled: true,
    triggerMode: 'always',
    content: `## 事件输出格式

请使用上文给出的本世界特化层级标签（如{{DOMAIN_MYTHIC}}、{{DOMAIN_POLITICAL}}等）。
可以用中文简写（如"天道·九重天劫"可直接用"天道"），但必须能让玩家一眼看出属于哪个层级。

\`\`\`json
{
  "id": "用 event_ 前缀的唯一ID",
  "title": "事件标题（简短有力）",
  "description": "事件详细叙事描述（2-3句，生动的中文）",
  "level": "事件层级: mythic/political/factional/economic/civilian",
  "region": "影响地域名称",
  "severity": "严重程度(0-10)",
  "status": "brewing 或 active",
  "childEventIds": ["子事件ID"],
  "affectedNpcIds": ["受影响NPC姓名"],
  "affectedFactions": ["受影响势力名称"],
  "playerHooks": [
    {
      "title": "切入点标题",
      "description": "切入点场景描述",
      "level": "切入点层级",
      "keyEntities": ["关键实体"],
      "suggestedActions": ["可选行动"],
      "urgency": "urgent/near_term/ongoing"
    }
  ],
  "lastUpdatedTick": 0
}
\`\`\``,
  },
  {
    id: 'storyline_rules',
    order: 40,
    title: '暗线推进规则',
    enabled: true,
    triggerMode: 'always',
    content: `## 角色暗线推进规则

每个离场重要角色应有一条独立的暗线。推进规则：
- npcId 必须使用角色名录中给出的精确 npcId，禁止自创或编造
- 每次推演为每个角色生成 1-3 个故事节拍（StoryBeat）
- 节拍应基于角色的性格、目标、当前处境和世界事件
- 节拍之间应有因果关系，不要跳跃式发展
- 关系变化（relationshipDelta）应有叙事依据
- 位置变化应合理（考虑距离、交通、动机）

## 暗线输出格式

\`\`\`json
{
  "npcId": "NPC姓名",
  "newBeats": [
    {
      "id": "beat_ 前缀唯一ID",
      "time": "游戏时间",
      "title": "节拍标题",
      "narrative": "叙事（1-2句）",
      "locationChange": "位置变化或null",
      "relationshipDelta": "好感度变化数值或null",
      "statusChange": "状态变化或null",
      "relatedEventIds": ["关联事件ID"]
    }
  ],
  "summary": "暗线总体概述（2-3句）",
  "chronicleOps": []
}
\`\`\``,
  },
  {
    id: 'chronicle_ops',
    order: 50,
    title: '事迹增量操作规则',
    enabled: true,
    triggerMode: 'always',
    content: `## 事迹增量操作（chronicleOps）

当需要修改 NPC 已有的人物事迹时，使用 chronicleOps 数组进行增量操作，而不是全量覆盖。

操作类型：
- **add**：追加新事迹。value 为新事迹文本。
- **replace**：替换旧事迹。通过 index 或 oldValue 定位，value 为新文本。
- **merge**：合并多条相似事迹为一条。通过 index 或 oldValue 定位所有目标，value 为合并后的文本（保留第一条位置，删除其余）。
- **remove**：删除事迹。通过 index 或 oldValue 定位。

示例：
\`\`\`json
"chronicleOps": [
  { "op": "replace", "oldValue": "正在寻找失踪的妹妹", "value": "已找到妹妹，正在返回家乡" },
  { "op": "add", "value": "在途中遭遇山贼，击退了3人" },
  { "op": "remove", "oldValue": "暂时在客栈落脚" }
]
\`\`\`

重要：
- 优先使用 oldValue 文本匹配而非 index，更稳健
- 只在需要修正或清理旧事迹时使用，正常推进用 newBeats 即可
- add 时如果事迹已存在（文本完全相同），不要重复添加`,
  },
  {
    id: 'proactive_contact',
    order: 60,
    title: 'NPC 主动联系规则',
    enabled: true,
    triggerMode: 'always',
    content: `## NPC 主动联系玩家

当满足以下条件时，离场 NPC 可以主动联系玩家（生成 npcInteractions）：
- NPC 达成了重要目标，想告知玩家
- NPC 遭遇重大变故，需要玩家帮助
- NPC 发现了紧急情报（与核心冲突或玩家危机相关）
- NPC 经过长时间分离后，有合理的重逢动机
- NPC 的处境与玩家当前所在地产生交集

不要让 NPC 随意联系玩家，每次联系都应有强烈的叙事动机。

## NPC 交互输出格式

\`\`\`json
"npcInteractions": [
  {
    "id": "interact_ 前缀唯一ID",
    "npcId": "NPC姓名",
    "npcName": "NPC姓名",
    "contactReason": "联系原因简述",
    "priority": 50,
    "innerThoughts": "NPC此刻的内心想法（第一人称）",
    "reply": "NPC对玩家说的话或采取的行动",
    "dedupeKey": "去重key（用npcId+核心原因的简写）",
    "variableChanges": ["此交互可能引发的变量变更说明"]
  }
]
\`\`\`

priority 范围 0-999：
- 0-100：紧急（生命威胁、重大危机）
- 100-300：重要（达成目标、发现情报）
- 300-600：一般（日常联系、分享见闻）
- 600-999：低优先级（闲聊、问候）`,
  },
  {
    id: 'stale_management',
    order: 70,
    title: '陈旧事件管理规则',
    enabled: true,
    triggerMode: 'always',
    content: `## 陈旧事件管理

对于已经存在多个推演周期但没有变化的事件：
- 如果事件仍有现实意义，尝试推进它（产生新的子事件或状态变化）
- 如果事件已经自然消退，在 updatedEvents 中将其 status 设为 "resolved"
- 不要让事件无限期停留在 "active" 状态却不产生任何变化
- 每次推演都应该更新事件的 lastUpdatedTick 为当前 tick

对于离场角色：
- 如果角色的暗线长期没有推进（超过 5 个 tick），考虑给他们安排新的目标或遭遇
- 如果角色已经完成了所有目标，考虑让他们重新出现在某个地点`,
  },
  {
    id: 'output_format',
    order: 80,
    title: '输出格式要求',
    enabled: true,
    triggerMode: 'always',
    content: `## 输出格式

请以 JSON 格式返回推演结果，顶层结构：

\`\`\`json
{
  "newEvents": [],
  "updatedEvents": [],
  "storylineUpdates": [],
  "npcInteractions": [],
  "worldNews": "全局世界新闻摘要（3-5句）"
}
\`\`\`

只返回 JSON，不要附加任何解释文字。`,
  },
];

/** 内置默认预设 */
export const DEFAULT_SIM_PRESET: SimPreset = {
  id: 'default',
  name: '默认推演预设',
  description: '内置的标准世界推演规则集',
  version: '2026-06-30.1',
  entries: DEFAULT_ENTRIES,
};

// ─── 预设工具函数 ───

/** 获取所有内置预设 */
export function getBuiltinPresets(): SimPreset[] {
  return [DEFAULT_SIM_PRESET];
}

/** 从预设构建完整 prompt */
export function buildPromptFromPreset(preset: SimPreset, vars: Record<string, string>): string {
  const enabledEntries = preset.entries
    .filter(e => e.enabled)
    .sort((a, b) => a.order - b.order);

  const parts: string[] = [];
  for (const entry of enabledEntries) {
    let content = entry.content;
    // 替换占位符
    for (const [key, value] of Object.entries(vars)) {
      content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    parts.push(content);
  }
  return parts.join('\n\n');
}

/** 根据关键词过滤条目（keyword 模式） */
export function filterKeywordEntries(
  entries: SimPresetEntry[],
  contextText: string,
): SimPresetEntry[] {
  const lower = contextText.toLowerCase();
  return entries.filter(e => {
    if (!e.enabled) return false;
    if (e.triggerMode === 'always') return true;
    // keyword 模式：至少匹配一个关键词
    return Array.isArray(e.keywords) && e.keywords.some(kw => lower.includes(kw.toLowerCase()));
  });
}

/** 导出预设为 JSON 字符串 */
export function exportPreset(preset: SimPreset): string {
  return JSON.stringify(preset, null, 2);
}

/** 从 JSON 字符串导入预设 */
export function importPreset(json: string): SimPreset | null {
  try {
    const parsed = JSON.parse(json);
    if (!parsed.id || !parsed.name || !Array.isArray(parsed.entries)) return null;
    return parsed as SimPreset;
  } catch {
    return null;
  }
}

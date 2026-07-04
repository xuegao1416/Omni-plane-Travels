# Prompt 管理系统

集中管理所有 AI prompt，方便维护和复用。

## 目录结构

```
src/utils/prompts/
├── index.ts              # 统一导出
├── editor-prompts.ts     # 编辑器 AI 相关 prompt
└── README.md             # 本文档
```

## 导出内容

### 类型

| 类型 | 说明 |
|------|------|
| `CharacterFillOptions` | 角色补全选项接口 |

### 函数

| 函数 | 说明 | 使用位置 |
|------|------|----------|
| `buildCharacterFillPrompt` | 构建角色 AI 补全的 System Prompt | `useAiFill.ts` |
| `buildVariableExtractionPrompt` | 构建变量提取的 System Prompt | `variableExtraction.ts` |

## 使用方式

```typescript
import {
  type CharacterFillOptions,
  buildCharacterFillPrompt,
  buildVariableExtractionPrompt,
} from '../utils/prompts';
```

### 角色补全

```typescript
const prompt = buildCharacterFillPrompt({
  worldSetting: '世界设定...',
  playerName: '玩家姓名',
  playerGender: '男',
  playerAge: '25',
  playerBackground: '背景描述...',
});
```

生成的 prompt 会指导 AI 补全角色的：
- 年龄、背景描述、职业、阶层
- 所属组织、特殊身份、性格、外貌
- 技能（1-3个）、物品（1-3个）、关联NPC（1-2个）

### 变量提取

```typescript
const prompt = buildVariableExtractionPrompt(worldSystem);
```

生成的 prompt 会指导 AI 从对话中提取：
- 人物档案更新（每轮必须）
- 玩家变量变化
- 世界变量变化
- 笔记本更新
- 世界系统模块数据更新（如果启用了模块系统）

## 添加新的 Prompt

1. 在 `editor-prompts.ts` 中添加新函数
2. 在 `index.ts` 中导出
3. 更新本文档

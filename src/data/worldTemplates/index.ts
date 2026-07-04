// ============================================================
//  世界模板系统 — 公共 API
//
//  设计理念：
//  不是所有东西都需要 AI 生成。很多内容可以用模板 + 变量替换来完成。
//  模板预定义 80% 的内容，变量替换补全 15%，AI 只需处理最后 5%。
//  这样将原来 10+ 次 AI 调用减少到 0-2 次，大幅提升移动端成功率。
//
//  模板如何减轻 AI 负担：
//  ┌─────────────────────────────────────────────────────┐
//  │  阶段    │ 原管线（纯 AI）  │ 模板模式              │
//  ├─────────────────────────────────────────────────────┤
//  │ 阶段0    │ 1次 AI 调用      │ 模板直接提供 seed     │
//  │ 阶段1    │ 1次 AI 调用      │ 模板直接提供 skeleton  │
//  │ 阶段2    │ 5-7次 AI 调用    │ 模板直接提供 7 个维度  │
//  │ 阶段3    │ 1次 AI 调用      │ 模板已内置一致性      │
//  │ 阶段4    │ 2-3次 AI 调用    │ 模板已内置深度细节    │
//  │ 阶段5    │ 纯代码           │ 纯代码（相同）        │
//  │ 阶段6    │ 0-6次 AI 调用    │ 模板直接提供模块配置  │
//  ├─────────────────────────────────────────────────────┤
//  │ 总计     │ 10-19次 AI 调用  │ 0次（纯模板模式）     │
//  │          │                  │ 1-2次（AI 增强模式）  │
//  └─────────────────────────────────────────────────────┘
// ============================================================

// ── 类型导出 ──
export type {
  WorldTemplate,
  VariableDefinition,
  VariableValues,
  TemplateBuildResult,
  TemplatePipelineConfig,
  DimensionFragments,
  FactionFragment,
  NPCFragment,
  EventFragment,
  LocationFragment,
} from './types';

// ── 引擎导出 ──
export { buildWorldFromTemplate } from './engine';

// ── 模板导出 ──
export {
  WORLD_TEMPLATES,
  getTemplateById,
  getTemplatesByCategory,
} from './templates';

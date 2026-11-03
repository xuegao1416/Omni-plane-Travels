import { z } from 'zod';
import { customGameplayModuleV3Schema } from './manifestSchema';
import { buildCustomModuleCapabilityCatalog } from './capabilities';
import { validateCustomGameplayModule } from './validator';
import { createDefaultGameState } from '../schema/variables';
import { buildCustomModuleHostContext } from './context';
import { simulateCustomModule } from './preview';
import { commitWorkshopRevision, currentWorkshopDraft, patchWorkshopDraft, type WorkshopSession } from './workshopSession';

const baseRevision = z.number().int().min(0).describe('readDraft 返回的当前 revision；必须匹配才能提交修改');
export const workshopToolSchemas = {
  capabilities: z.object({}).strict(),
  readDraft: z.object({}).strict(),
  createDraft: z.object({ baseRevision, summary: z.string().min(1).max(300), module: customGameplayModuleV3Schema }).strict(),
  patchDraft: z.object({
    baseRevision, summary: z.string().min(1).max(300),
    operations: z.array(z.object({ op: z.enum(['add', 'replace', 'remove']), path: z.string().min(2).max(500), value: z.unknown().optional() }).strict()).min(1).max(100),
  }).strict(),
  validateDraft: z.object({}).strict(),
  simulate: z.object({
    lifecycle: z.enum(['onGameStart', 'onTurnEnd', 'onTick', 'onChoice', 'onButton']),
    currency: z.number().min(0).optional(),
    items: z.record(z.string().max(64), z.number().int().min(0)).optional(),
    survival: z.record(z.string().max(64), z.number().min(0)).optional(),
    buttonEvent: z.string().max(120).optional(),
    round: z.number().int().min(0).optional(),
  }).strict(),
};
export type WorkshopToolName = keyof typeof workshopToolSchemas;
// Complex module data travels inside a named tool argument. Recursive JSON
// Schema is not accepted by every OpenAI-compatible gateway; the canonical
// schemas above still validate decoded input before any revision can be saved.
export const workshopWireSchemas = {
  capabilities: workshopToolSchemas.capabilities,
  readDraft: workshopToolSchemas.readDraft,
  createDraft: z.object({ baseRevision, summary: z.string().min(1).max(300), moduleJson: z.string().min(2).describe('完整 V3 模块的 JSON 字符串；结构见 capabilities 返回的 moduleSchemaJson（JSON Schema 文本）') }).strict(),
  patchDraft: z.object({ baseRevision, summary: z.string().min(1).max(300), operations: z.array(z.object({
    op: z.enum(['add', 'replace', 'remove']), path: z.string().min(2).max(500),
    valueJson: z.string().optional().describe('add/replace 的值，编码为 JSON 字符串；如数字 20 为 "20"，字符串为带引号的 JSON。remove 时省略'),
  }).strict()).min(1).max(100) }).strict(),
  validateDraft: workshopToolSchemas.validateDraft,
  simulate: z.object({
    lifecycle: z.enum(['onGameStart', 'onTurnEnd', 'onTick', 'onChoice', 'onButton']), currency: z.number().min(0).optional(),
    itemAmounts: z.array(z.object({ itemId: z.string().max(64), amount: z.number().int().min(0) }).strict()).optional(),
    survivalAmounts: z.array(z.object({ resourceId: z.string().max(64), amount: z.number().min(0) }).strict()).optional(),
    buttonEvent: z.string().max(120).optional(), round: z.number().int().min(0).optional(),
  }).strict(),
};

export function decodeWorkshopToolInput(name: WorkshopToolName, rawInput: unknown): unknown {
  if (name === 'createDraft') {
    const { moduleJson, ...input } = workshopWireSchemas.createDraft.parse(rawInput);
    return { ...input, module: JSON.parse(moduleJson) };
  }
  if (name === 'patchDraft') {
    const input = workshopWireSchemas.patchDraft.parse(rawInput);
    return { ...input, operations: input.operations.map(({ valueJson, ...operation }) => ({
      ...operation, ...(valueJson === undefined ? {} : { value: JSON.parse(valueJson) }),
    })) };
  }
  if (name === 'simulate') {
    const { itemAmounts, survivalAmounts, ...input } = workshopWireSchemas.simulate.parse(rawInput);
    return { ...input,
      ...(itemAmounts ? { items: Object.fromEntries(itemAmounts.map(item => [item.itemId, item.amount])) } : {}),
      ...(survivalAmounts ? { survival: Object.fromEntries(survivalAmounts.map(item => [item.resourceId, item.amount])) } : {}),
    };
  }
  return rawInput;
}

// Gemini-compatible gateways interpret structured $ref fields in tool results
// as attachment references. Keep the complete authoring schema as text data.
const moduleAuthoringSchemaJson = JSON.stringify(z.toJSONSchema(customGameplayModuleV3Schema, { unrepresentable: 'any' }));
export const workshopToolDescriptions: Record<WorkshopToolName, string> = {
  capabilities: '读取当前世界允许的输入、宿主能力、动作与界面组件。创作前先查询，不臆造能力。',
  readDraft: '读取当前有效模块和基础版本号。删除聊天不会删除模块，修订前以此为准。',
  createDraft: '首次创建完整 V3 模块。已有草稿时使用 patchDraft；校验通过才创建版本，不安装到游戏。',
  patchDraft: '用 JSON Pointer add/replace/remove 局部修改现有模块，基础版本必须匹配。校验失败保留有效草稿。数组 add 会插入，/- 表示末尾。',
  validateDraft: '校验当前有效草稿并返回具体问题。',
  simulate: '在独立测试状态中执行模块，返回资源与模块状态变化；不会改变实际游戏或草稿。测试资源可指定，物品使用模块声明的 itemId。',
};

export interface WorkshopToolOutcome { session: WorkshopSession; output: Record<string, unknown> }

export function executeWorkshopTool(session: WorkshopSession, name: WorkshopToolName, rawInput: unknown, eventId: string): WorkshopToolOutcome {
  const current = currentWorkshopDraft(session);
  switch (name) {
    case 'capabilities':
      workshopToolSchemas.capabilities.parse(rawInput);
      return { session, output: {
        ...buildCustomModuleCapabilityCatalog(session.world), world: session.world,
        moduleSchemaJson: moduleAuthoringSchemaJson,
        protocol: 'V3：每条规则使用稳定 id；宿主消耗与奖励在同一规则原子结算。inputs 别名指向能力目录路径；物品动作使用 items 的 itemId。',
        authoring: '先理解目标，再创建草稿；修改使用 patchDraft。创建或修改后校验并模拟，最终说明结果及需要用户决定的问题。',
      } };
    case 'readDraft':
      workshopToolSchemas.readDraft.parse(rawInput);
      return { session, output: { revision: session.currentRevision, module: current ?? null } };
    case 'createDraft': {
      const input = workshopToolSchemas.createDraft.parse(rawInput);
      if (current) throw new Error('当前会话已有模块，请读取草稿并使用 patchDraft 局部修改。');
      const next = commitWorkshopRevision(session, input.module, input.baseRevision, input.summary);
      return { session: next, output: { revision: next.currentRevision, module: currentWorkshopDraft(next), valid: true } };
    }
    case 'patchDraft': {
      const input = workshopToolSchemas.patchDraft.parse(rawInput);
      const next = patchWorkshopDraft(session, input.operations, input.baseRevision, input.summary);
      return { session: next, output: { revision: next.currentRevision, moduleVersion: currentWorkshopDraft(next)?.version, valid: true, summary: input.summary } };
    }
    case 'validateDraft': {
      workshopToolSchemas.validateDraft.parse(rawInput);
      if (!current) throw new Error('还没有模块草稿');
      const result = validateCustomGameplayModule(current);
      return { session, output: { valid: result.valid, errors: result.errors, warnings: result.warnings, revision: session.currentRevision } };
    }
    case 'simulate': {
      const input = workshopToolSchemas.simulate.parse(rawInput);
      if (!current) throw new Error('还没有模块草稿');
      if (current.schemaVersion !== 3) throw new Error('请先将草稿转换到 V3');
      const game = createDefaultGameState();
      game.玩家.货币资源.主货币.数量 = input.currency ?? 100;
      game.玩家.物品栏 = {};
      for (const [id, definition] of Object.entries(current.items)) {
        game.玩家.物品栏[definition.name] = { 数量: input.items?.[id] ?? 0, 类型: definition.category ?? '物品', 品质: '普通', 备注: definition.description ?? '' };
      }
      game.玩家.生存资源 = Object.fromEntries((session.world.survivalResourceIds ?? []).map(id => [id, { 数量: input.survival?.[id] ?? 100, 最大值: 100 }]));
      const options = {
        eventId, now: 0,
        context: buildCustomModuleHostContext(game, {
          round: input.round ?? 1, items: current.items,
          event: input.lifecycle === 'onButton' ? { type: 'button', moduleId: current.id, event: input.buttonEvent ?? 'test' }
            : input.lifecycle === 'onChoice' ? { type: 'choice', label: '测试选项', selectedIndex: 0 } : undefined,
        }),
      };
      const result = simulateCustomModule(current, game, input.lifecycle, options);
      return { session, output: {
        applied: result.applied, warnings: result.warnings,
        before: { currency: game.玩家.货币资源.主货币.数量, items: game.玩家.物品栏, survival: game.玩家.生存资源 },
        after: { currency: result.gameState.玩家.货币资源.主货币.数量, items: result.gameState.玩家.物品栏, survival: result.gameState.玩家.生存资源, state: result.gameState.customModules?.[current.id]?.values },
      } };
    }
  }
}

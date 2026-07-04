// 格式归一化工具 — 统一处理关键词解析和配方格式
import type { SurvivalRecipe } from '../modules/schema';

/**
 * 解析关键词输入，支持中文逗号、英文逗号、换行
 */
export function parseKeywordInput(input: string | string[] | undefined): string[] {
  if (!input) return [];
  if (Array.isArray(input)) return input.filter(Boolean);
  return input
    .split(/[,，\n]/)
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * 归一化配方输入（inputs）
 * 兼容 AI 返回的两种格式：
 * - 对象格式（正确）：{ "wood": 2, "stone": 1 }
 * - 数组格式：[{ id: "wood", amount: 2 }, { id: "stone", amount: 1 }]
 */
export function normalizeRecipeInputs(raw: unknown): Record<string, number> {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const result: Record<string, number> = {};
    for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
      const num = typeof val === 'number' ? val : Number(val);
      if (key && num > 0) result[key] = num;
    }
    return result;
  }
  if (Array.isArray(raw)) {
    const result: Record<string, number> = {};
    for (const item of raw) {
      if (typeof item === 'object' && item !== null) {
        const id = (item as any).id || (item as any).resourceId || (item as any).key;
        const amount = (item as any).amount || (item as any).count || (item as any).qty || 1;
        const num = typeof amount === 'number' ? amount : Number(amount);
        if (id && num > 0) result[id] = num;
      }
    }
    return result;
  }
  return {};
}

/**
 * 归一化配方输出（output）
 * 兼容多种字段名：resourceId / id / product / result
 * 兼容多种数量字段：amount / count / qty
 */
export function normalizeRecipeOutput(raw: unknown): { resourceId: string; amount: number } {
  if (!raw || typeof raw !== 'object') return { resourceId: '', amount: 0 };
  const obj = raw as Record<string, unknown>;
  const resourceId = String(
    obj.resourceId || obj.id || obj.product || obj.result || ''
  );
  const rawAmount = obj.amount || obj.count || obj.qty || 1;
  const amount = typeof rawAmount === 'number' ? rawAmount : Number(rawAmount) || 0;
  return { resourceId, amount };
}

/**
 * 归一化完整配方对象
 */
export function normalizeRecipe(raw: unknown): SurvivalRecipe | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const recipe: SurvivalRecipe = {
    id: String(obj.id || `recipe_${Date.now()}`),
    name: String(obj.name || '未知配方'),
    inputs: normalizeRecipeInputs(obj.inputs),
    output: normalizeRecipeOutput(obj.output),
    description: String(obj.description || ''),
  };
  if (!recipe.output.resourceId || recipe.output.amount <= 0) return null;
  return recipe;
}

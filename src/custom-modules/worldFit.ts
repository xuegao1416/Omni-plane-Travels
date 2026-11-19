/**
 * 自创模块与当前世界的契合检查：模块读的宿主输入、用的生存资源与宿主能力，都要在这个世界的能力目录里。
 *
 * 结构校验（validator.ts）只看模块本身，不知道世界；这里按 buildCustomModuleCapabilityCatalog 给出的
 * 本世界目录再查一遍。工坊提交草稿时报错会作为工具结果交回 Agent，作为修正依据。
 * 世界上下文没有能力信息（旧会话、测试桩）时不检查。
 */
import type { CustomModuleAgentWorldContext } from './agentSession';
import { buildCustomModuleCapabilityCatalog } from './capabilities';
import type { CustomGameplayModuleV3, ModuleValidationIssue } from './schema';

const INVENTORY_INPUT = /^player\.inventory\.[A-Za-z][A-Za-z0-9_]*\.amount$/;

function preview(items: readonly string[], limit = 12): string {
  if (!items.length) return '无';
  return items.length > limit ? `${items.slice(0, limit).join('、')} 等 ${items.length} 项` : items.join('、');
}

export function checkCustomModuleWorldFit(module: CustomGameplayModuleV3, world: CustomModuleAgentWorldContext): ModuleValidationIssue[] {
  if (!world.availability) return [];
  const catalog = buildCustomModuleCapabilityCatalog(world);
  const available = Object.keys(catalog.safeInputPaths);
  const issues: ModuleValidationIssue[] = [];
  const error = (path: string[], code: string, message: string) => issues.push({ path, code, message, severity: 'error' });
  const warn = (path: string[], code: string, message: string) => issues.push({ path, code, message, severity: 'warning' });

  const reads = new Map<string, string[]>();
  for (const [alias, binding] of Object.entries(module.inputs ?? {})) {
    const path = typeof binding === 'string' ? binding : (binding as { path: string }).path;
    reads.set(path, ['inputs', alias]);
  }
  module.permissions.read.forEach((path, index) => { if (!reads.has(path)) reads.set(path, ['permissions', 'read', String(index)]); });
  for (const [path, at] of reads) {
    if (INVENTORY_INPUT.test(path) || catalog.safeInputPaths[path]) continue;
    error(at, 'world-input-unavailable', `本世界没有宿主输入「${path}」。可用：${preview(available)}`);
  }

  const resources = catalog.world.survivalResourceIds;
  if (module.capabilities.includes('survival') && !catalog.world.availability.survival) {
    error(['capabilities'], 'world-capability-unavailable', '本世界没有启用生存资源模块，不能声明 survival 能力');
  }
  for (const lifecycle of Object.keys(module.logic) as Array<keyof CustomGameplayModuleV3['logic']>) {
    module.logic[lifecycle].forEach((rule, ruleIndex) => rule.actions.forEach((action, actionIndex) => {
      const at = ['logic', lifecycle, String(ruleIndex), 'actions', String(actionIndex)];
      if ((action.type === 'survival.consume' || action.type === 'survival.grant') && 'resourceId' in action && !resources.includes(action.resourceId)) {
        error(at, 'world-resource-unavailable', `生存资源「${action.resourceId}」在本世界不存在。可用：${preview(resources)}`);
      }
      if ((action.type === 'currency.consume' || action.type === 'currency.grant') && !catalog.world.availability.currency) {
        warn(at, 'world-currency-managed', '本世界的钱由经营模块管理，currency 动作会直接增减钱袋，请确认这是想要的');
      }
    }));
  }
  return issues;
}

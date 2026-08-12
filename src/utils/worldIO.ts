// 世界导出工具 —— 将完整 WorldDef 导出为可编辑的 JSON 文件
import type { WorldDef } from '../data/worlds-schema';
import { downloadJSON } from './download';

/**
 * 导出世界为 JSON 文件，供玩家下载后微调。
 *
 * - 导出内容为完整 WorldDef（worldBookEntries / eventPacks / modules 等全部叙事与配置都在内）。
 * - 去掉运行期字段 source，使重新导入时被当作「内部世界」（走 9-tab 详情），而非外部世界书。
 * - 重新导入时若保留原 id（如 japanese_school），依据 findWorldDef 的「自建优先」规则会覆盖内置版本，
 *   从而实现对内置世界的微调。也可改 id 作为全新自定义世界保留原版。
 */
export function exportWorld(world: WorldDef): void {
  const { source, ...clean } = world;
  const filename = `${world.id || 'world'}.json`;
  downloadJSON(JSON.stringify(clean, null, 2), filename);
}

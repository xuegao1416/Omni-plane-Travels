/**
 * 变量 AI 可以调用的模块命令（白名单）：新格式写成 command 意图，旧格式写进事务的 commands 数组。
 *
 * 买卖、订单、物资增减等需要本地规则计算（行情价格、库存上限、状态效果）的变化，
 * 让 AI 发命令而不是直接改数值；命令在本地按规则结算，失败的命令只记警告。
 */
import type { GameplayHost } from './host';
import type { JsonRecord } from './ops';

export interface AiCommandSpec {
  command: string;
  description: string;
  args: string;
  example: JsonRecord;
}

export const AI_COMMANDS: readonly AiCommandSpec[] = [
  { command: 'economy.sell', description: '正文里卖出仓库里的货（价格按本地行情计算，不要自己写钱数）', args: '{market, goods, quantity}', example: { market: 'local', goods: '羽绒服', quantity: 2 } },
  { command: 'economy.buy', description: '正文里进货（价格按本地行情计算）', args: '{market, goods, quantity}', example: { market: 'local', goods: '方便面', quantity: 10 } },
  { command: 'economy.offerContract', description: '正文里有人委托一笔订单（酬金由本地估价）', args: '{client, title, goods, quantity, days}', example: { client: '伊万', title: '冬装急单', goods: '羽绒服', quantity: 8, days: 5 } },
  { command: 'resources.consume', description: '正文里用掉物资（不足时不会执行）', args: '{id, amount, reason}', example: { id: 'water', amount: 1, reason: '煮饭' } },
  { command: 'resources.grant', description: '正文里得到物资（超过上限会被截断）', args: '{id, amount, reason}', example: { id: 'wood', amount: 3, reason: '捡到浮木' } },
  { command: 'resources.discover', description: '正文里第一次出现一种新物资', args: '{id, name, amount, description}', example: { id: 'coconut', name: '椰子', amount: 2, description: '可以解渴充饥' } },
  { command: 'resources.applyStatus', description: '正文里明确陷入某种已定义的状态（如受伤、缺水）', args: '{id, days}', example: { id: 'wounded', days: 3 } },
  { command: 'resources.clearStatus', description: '正文里状态得到处理', args: '{id}', example: { id: 'wounded' } },
];

const ALLOWED = new Set(AI_COMMANDS.map(item => item.command));

export function isAiCommand(command: unknown): command is string {
  return typeof command === 'string' && ALLOWED.has(command);
}

/** 当前世界实际可用的命令（模块未启用的命令不列出）。 */
export function aiCommandsFor(host: GameplayHost): AiCommandSpec[] {
  const available = new Set(host.commandNames());
  return AI_COMMANDS.filter(item => available.has(item.command));
}

/** 提示词里的命令说明；世界没有可用命令时返回空串。 */
export function formatAiCommands(host: GameplayHost): string {
  const commands = aiCommandsFor(host);
  if (!commands.length) return '';
  return [
    '【可用命令】需要本地规则计算的变化写成 command 意图，不要直接改对应数值：',
    ...commands.map(item => `- ${item.command} ${item.args}：${item.description}。例：{"command":"${item.command}","args":${JSON.stringify(item.example)},"because":"…"}`),
  ].join('\n');
}

import { version } from '../../package.json';

/** Application release version; content and save schemas version independently. */
export const APP_VERSION = version;

/**
 * 玩法数据版本：存档里玩法相关数据（模块分区、事件导演、钱袋等）的格式代数，与 SAVE_SCHEMA_VERSION（存储外壳）独立。
 * 1 = 重构前（没有这个字段的存档都视为 1）；2 = 玩法宿主内核（资源账本 v2、经营 v2、事件导演、统一钱袋）。
 * 导出与本地存档都会带上它；读到比本机更新的版本时拒绝读取，避免旧客户端把新存档读错后再写回。
 */
export const ENGINE_VERSION = 2;

/** 存档的玩法数据版本是否比本机支持的更新。 */
export function isNewerEngine(value: unknown): boolean {
  const version = Number(value);
  return Number.isFinite(version) && version > ENGINE_VERSION;
}

export function newerEngineMessage(value: unknown): string {
  return `这个存档来自更新版本的游戏（玩法数据版本 ${String(value)}，本机支持到 ${ENGINE_VERSION}），请先升级应用再读取。`;
}

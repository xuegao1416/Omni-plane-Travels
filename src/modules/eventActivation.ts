/**
 * 库 UI 的「启用」显示态：仅看全局安装态 rec.enabled。
 * 事件包的启用/禁用是全局操作（rec.enabled），不再有存档级绑定。
 */
export function isEventActive(
  entryEnabled: boolean | null | undefined,
): boolean {
  return !!entryEnabled;
}

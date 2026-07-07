/**
 * 规范化资产状态值
 * AI 通过 UpdateVariable 更新时可能写入中文状态（如"营业中"、"正常"），
 * 需要映射为 BusinessAsset.status 要求的英文枚举值。
 */
export function normalizeAssetStatus(
  raw: string | undefined,
): 'active' | 'idle' | 'damaged' | 'destroyed' {
  if (!raw) return 'active';
  const s = String(raw).trim();

  // 已是合法英文枚举，直接返回
  if (s === 'active' || s === 'idle' || s === 'damaged' || s === 'destroyed') {
    return s;
  }

  // 中文 → 英文映射
  if (/营业|正常|运行|运转|活跃|开启|开放/.test(s)) return 'active';
  if (/闲置|空闲|休眠|暂停|关闭/.test(s)) return 'idle';
  if (/损坏|受损|破损|故障|维修/.test(s)) return 'damaged';
  if (/摧毁|毁灭|废弃|报废|已毁/.test(s)) return 'destroyed';

  // 无法识别时默认 active（有资产总比没有好）
  return 'active';
}

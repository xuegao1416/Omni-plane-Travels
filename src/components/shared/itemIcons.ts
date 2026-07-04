/**
 * 物品类型 → Lucide 图标映射（共享层）
 * 供 profilePanel、wizard 身份页等多处复用
 */
import {
  Swords, Shield, Wrench, Beaker, Wheat, Gem, BookOpen, ScrollText,
  Crosshair, Crown, Shirt, Package, FlaskConical, Fish, Compass, Key,
  CircleDot, type LucideIcon,
} from 'lucide-react';

// ─── 物品类型 → Lucide 图标映射 ───
export const ITEM_TYPE_ICON: Record<string, LucideIcon> = {
  '武器': Swords,
  '防具': Shield,
  '护甲': Shield,
  '盾牌': Shield,
  '工具': Wrench,
  '药品': Beaker,
  '药水': FlaskConical,
  '药剂': FlaskConical,
  '食物': Wheat,
  '食材': Wheat,
  '材料': Gem,
  '矿石': Gem,
  '宝石': Gem,
  '书籍': BookOpen,
  '卷轴': ScrollText,
  '弹药': Crosshair,
  '饰品': Crown,
  '衣服': Shirt,
  '容器': Package,
  '鱼': Fish,
  '鱼获': Fish,
  '钥匙': Key,
  '导航': Compass,
};

/**
 * 获取物品图标
 * 优先精确匹配类型，其次模糊匹配，兜底返回 CircleDot
 */
export function getItemIcon(item: { 类型?: string }): LucideIcon {
  const t = item.类型;
  if (t && ITEM_TYPE_ICON[t]) return ITEM_TYPE_ICON[t];
  // 模糊匹配
  if (t) {
    for (const [key, icon] of Object.entries(ITEM_TYPE_ICON)) {
      if (t.includes(key) || key.includes(t)) return icon;
    }
  }
  return CircleDot;
}

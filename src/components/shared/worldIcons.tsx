/**
 * 世界图标统一解析
 * icon 字段直接存 Lucide 图标名称（如 "Cpu"、"Swords"），一步解析到位
 */
import {
  Globe, Compass, BookOpen, Flame, Mountain, Ship, Castle, Skull, Crown,
  Rocket, Star, Shield, Zap, Brain, Gem, Ghost, Snowflake, Sun, Moon,
  Wind, Waves, Anchor, Eye, Heart, Target, Wand2, Fish, Bug,
  Flower, TreePine, Cloud, Sunrise, Eclipse, Hexagon, Diamond, Atom,
  Cpu, Swords, GraduationCap, Flower2,
  ScrollText, MapPin, Clock, AlertTriangle, DollarSign, Flag, User,
  Sparkles, Check, Landmark, Scroll, Backpack, Dna, Lightbulb, Bookmark,
  Building2, Truck, Package, Store,
  type LucideIcon,
} from 'lucide-react';

/** Lucide 图标名称 → 组件映射 */
const ICON_NAME_MAP: Record<string, LucideIcon> = {
  Globe, Compass, BookOpen, Flame, Mountain, Ship, Castle, Skull, Crown,
  Rocket, Star, Shield, Zap, Brain, Gem, Ghost, Snowflake, Sun, Moon,
  Wind, Waves, Anchor, Eye, Heart, Target, Wand2, Fish, Bug,
  Flower, TreePine, Cloud, Sunrise, Eclipse, Hexagon, Diamond, Atom,
  Cpu, Swords, GraduationCap, Flower2,
  // 扩展图标（原 stepWorldDetail/iconMap 使用）
  ScrollText, MapPin, Clock, AlertTriangle, DollarSign, Flag, User,
  Sparkles, Check, Landmark, Scroll, Backpack, Dna, Lightbulb, Bookmark,
  Building2, Truck, Package, Store,
};

/** 全部世界图标列表（供图标选择器使用） */
export const ALL_WORLD_ICONS: Array<{ name: string; icon: LucideIcon }> =
  Object.entries(ICON_NAME_MAP).map(([name, icon]) => ({ name, icon }));

/**
 * 根据 icon 名称解析 Lucide 图标组件
 * @param iconName Lucide 图标名称，如 "Cpu"、"Swords"
 * @returns 对应的 LucideIcon 组件，未匹配则返回 Globe
 */
export function resolveWorldIcon(iconName?: string): LucideIcon {
  if (iconName && ICON_NAME_MAP[iconName]) {
    return ICON_NAME_MAP[iconName];
  }
  return Globe;
}

/**
 * 世界图标渲染组件（带颜色）
 * 用于世界概览等需要直接渲染的场景
 */
export function WorldIcon({ name, size = 28 }: { name: string; size?: number }) {
  const IconComp = ICON_NAME_MAP[name];
  const Comp = IconComp ?? Globe;
  return <Comp size={size} style={{ color: 'var(--accent)' }} />;
}

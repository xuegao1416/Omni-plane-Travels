import {
  FileText, Spline, BookOpen, Boxes, Repeat,
  Image, ScrollText, Gamepad2, Swords, Map, Sparkles, Star, Zap,
  Globe, Users, Package, Layers, Component, BookMarked, Library,
  Scroll, Wand2, Dices, Compass, Feather, Shield, Crown, Castle,
  TreePine, Flame, Droplet, Moon, Sun, Heart, Skull, Anchor, Flag,
  Tags, Gem, Coins, Landmark, Building2, BookOpenCheck, Newspaper,
  type LucideIcon,
} from 'lucide-react';
import type { EventType } from '../../modules/schema';

/**
 * manifest.icon 是自由字符串名（也可能直接是类型别名）。
 * 这里显式列出「名字 → Lucide 组件」映射，确保零 emoji、零运行时动态 import。
 */
const ICON_MAP: Record<string, LucideIcon> = {
  FileText, Spline, BookOpen, Boxes, Image, ScrollText, Gamepad2, Swords,
  Map, Sparkles, Star, Zap, Globe, Users, Package, Layers, Component,
  BookMarked, Library, Scroll, Wand2, Dices, Compass, Feather, Shield,
  Crown, Castle, TreePine, Flame, Droplet, Moon, Sun, Heart, Skull,
  Anchor, Flag, Tags, Gem, Coins, Landmark, Building2, BookOpenCheck, Newspaper,
  // 常见别名
  book: BookOpen, card: FileText, rule: Spline, worldbook: BookOpen, bundle: Boxes,
  image: Image, map: Map, sword: Swords, star: Star, gem: Gem, package: Package,
  Repeat,
};

/** 按 EventType 的兜底图标（与设计提示词 §页面5 一致） */
const TYPE_FALLBACK: Record<EventType, LucideIcon> = {
  card: FileText,
  rule: Spline,
  worldbook: BookOpen,
  bundle: Boxes,
  periodic: Repeat,
};

/** 由 manifest.icon 名解析 Lucide 组件；未命中则按类型兜底 */
export function resolveEventIcon(iconName: string | undefined, type: EventType): LucideIcon {
  if (iconName && ICON_MAP[iconName]) return ICON_MAP[iconName];
  return TYPE_FALLBACK[type];
}

/** 取类型对应的兜底图标 */
export function typeIcon(type: EventType): LucideIcon {
  return TYPE_FALLBACK[type];
}

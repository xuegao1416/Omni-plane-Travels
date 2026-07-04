/**
 * emoji → Lucide 图标映射
 * 集中管理所有替换关系，方便维护
 */
import {
  // 导航
  Home, User, Users, Landmark, BookOpen, Settings, ArrowLeft,
  // 操作
  Play, SkipForward, FolderOpen, Save, Pencil, Trash2, Copy,
  RotateCcw, ArrowLeftToLine, Send, X, Plus, Download,
  // 状态
  AlertTriangle, Check, CheckCircle, XCircle, Loader, Info, Clock, Star,
  // 区块图标
  Heart, Zap, Swords, Shield, MapPin, Cloud, Target, Newspaper,
  DollarSign, Bookmark, Flag, Tag, Anchor, Briefcase, Compass, Dna,
  MessageSquare, Brain, Sparkles, Backpack, ScrollText, BarChart3,
  Lightbulb, ClipboardList, Cpu, Globe, Palette, Type, Calendar,
  ChevronDown, ChevronRight, Eye, EyeOff, Lock, Unlock, RefreshCw,
  Search, Filter, Bell, Smartphone, Monitor, ChevronLeft,
  type LucideIcon,
} from 'lucide-react';

// ─── 通用映射表 ───
// key = 原来的 emoji 或语义标识，value = Lucide 图标组件
export const ICON_MAP: Record<string, LucideIcon> = {
  // 导航栏
  '🏠': Home,
  '👤': User,
  '👥': Users,
  '🏛': Landmark,
  '📝': BookOpen,
  '⚙': Settings,
  '⚙️': Settings,

  // 主菜单
  '🚀': Play,
  '▶️': SkipForward,
  '▶': SkipForward,
  '💾': Save,
  '📂': FolderOpen,

  // 操作
  '✏️': Pencil,
  '✏': Pencil,
  '🗑': Trash2,
  '🗑️': Trash2,
  '📋': ClipboardList,
  '🔄': RefreshCw,
  '⏪': ArrowLeftToLine,
  '✕': X,
  '✕️': X,
  '✓': Check,

  // 状态
  '⚠️': AlertTriangle,
  '⚠': AlertTriangle,
  '✅': CheckCircle,
  '❌': XCircle,
  '⏳': Loader,
  '💡': Lightbulb,
  '🕐': Clock,
  '⏰': Clock,
  '⭐': Star,
  '★': Star,
  '🌟': Star,

  // 区块/分区
  '❤️': Heart,
  '⚡': Zap,
  '⚔️': Swords,
  '⚔': Swords,
  '🛡': Shield,
  '🛡️': Shield,
  '📍': MapPin,
  '🌤': Cloud,
  '🌤️': Cloud,
  '🎭': Globe,
  '💭': Brain,
  '🎮': Target,
  '📖': ScrollText,
  '📜': ScrollText,
  '🎒': Backpack,
  '📊': BarChart3,
  '🎯': Target,
  '📰': Newspaper,
  '💰': DollarSign,
  '🌍': Globe,
  '🌐': Globe,
  '🎨': Palette,
  '🔤': Type,
  '🔧': Cpu,
  '🤖': Cpu,
  '⚓': Anchor,
  '💼': Briefcase,
  '🧭': Compass,
  '🧬': Dna,
  '🤝': MessageSquare,
  '✨': Sparkles,
  '🏴': Flag,
  '🏷': Tag,
  '🏷️': Tag,
  '💬': MessageSquare,
  '🔍': Search,
  '📌': Bookmark,
  '🗓': Calendar,
  '🔑': Lock,
  '🔔': Bell,
};

// ─── 获取图标组件 ───
export function getIcon(emoji: string): LucideIcon | null {
  return ICON_MAP[emoji] ?? null;
}

// ─── 图标尺寸预设 ───
export const ICON_SIZE = {
  xs: 12,   // 内联标签
  sm: 14,   // 按钮内
  md: 16,   // 默认
  lg: 20,   // 导航栏
  xl: 24,   // 大图标
} as const;

import { create } from 'zustand';
import type { ApiConfig } from '@/api/types';
import { STORAGE_KEYS } from '@/config/storageKeys';
import { seal, unseal, isSealed } from '@/security/keyVault';

// ─── 类型 ───

export type Theme = 'light' | 'dark' | 'metal' | 'green';
export type FontFamily = 'yahei' | 'source' | 'menglong' | 'hanchan' | 'shanggu'; // 保留旧值以兼容存档
export type FontSize = '小' | '中' | '大';
export type LineHeight = '紧凑' | '舒适' | '宽松';
export type Language = 'zh-CN' | 'en';

export interface UISettings {
  language: Language;
  theme: Theme;
  font: FontFamily;
  uiFontSize: FontSize;
  bodyFontSize: FontSize;
  lineHeight: LineHeight;
  autoScroll: boolean;
}

// ─── 常量 ───

const STORAGE_KEY = STORAGE_KEYS.UI_SETTINGS;
const API_STORAGE_KEY = STORAGE_KEYS.API_CONFIG;

const DEFAULT_SETTINGS: UISettings = {
  language: 'zh-CN',
  theme: 'light',
  font: 'yahei',
  uiFontSize: '中',
  bodyFontSize: '中',
  lineHeight: '舒适',
  autoScroll: true,
};

const FONT_MAP: Record<FontFamily, string> = {
  yahei: "'Microsoft YaHei', 'PingFang SC', sans-serif",
  source: "'Source Han Sans SC', 'Noto Sans SC', sans-serif",
  // 以下为兼容旧存档的回退值
  menglong: "'Microsoft YaHei', 'PingFang SC', sans-serif",
  hanchan: "'Microsoft YaHei', 'PingFang SC', sans-serif",
  shanggu: "'Microsoft YaHei', 'PingFang SC', sans-serif",
};

const UI_FONT_SIZE_MAP: Record<FontSize, string> = { '小': '12px', '中': '14px', '大': '16px' };
const BODY_FONT_SIZE_MAP: Record<FontSize, string> = { '小': '13px', '中': '15px', '大': '17px' };
const LINE_HEIGHT_MAP: Record<LineHeight, string> = { '紧凑': '1.4', '舒适': '1.6', '宽松': '1.8' };

// ─── 翻译 ───

const translations: Record<Language, Record<string, string>> = {
  'zh-CN': {
    'settings.title': '设置', 'settings.back': '← 返回', 'settings.save': '保存并返回',
    'settings.test': '测试连接', 'settings.testing': '测试中...', 'settings.ui': '界面设置', 'settings.api': 'API 设置',
    'settings.language': '语言', 'settings.theme': '主题', 'settings.font': '字体',
    'settings.uiFontSize': '界面字体', 'settings.uiFontSize.desc': 'UI 元素的字体大小',
    'settings.bodyFontSize': '正文字体', 'settings.bodyFontSize.desc': '聊天消息的字体大小',
    'settings.lineHeight': '正文行距', 'settings.autoScroll': '正文自动滚动',
    'theme.light': '拂晓', 'theme.dark': '玄夜', 'theme.metal': '银灰', 'theme.green': '翠林',
    'font.yahei': '雅黑', 'font.source': '思源黑体', 'font.menglong': '朦胧黑体',
    'font.hanchan': '寒蝉半圆', 'font.shanggu': '尚古圆体',
    'settings.provider': 'Provider', 'settings.baseUrl': 'Base URL', 'settings.baseUrl.desc': 'API 端点地址',
    'settings.apiKey': 'API Key', 'settings.apiKey.desc': '密钥',
    'settings.model': 'Model', 'settings.model.desc': '模型名称', 'settings.selectModel': '选择模型',
    'settings.temperature': 'Temperature', 'settings.temperature.desc': '生成随机性', 'settings.fetchModels': '获取',
    'chat.empty': '发送消息开始你的穿越之旅...', 'chat.thinking': '思考中...',
    'chat.actions': '可选行动：', 'chat.reasoning': '思维链',
    'input.placeholder': '输入你的行动... (Enter发送, Shift+Enter换行)',
    'input.send': '发送', 'input.stop': '停止',
    'common.small': '小', 'common.medium': '中', 'common.large': '大',
    'common.compact': '紧凑', 'common.comfortable': '舒适', 'common.loose': '宽松',
    'common.cancel': '取消', 'common.confirm': '确定', 'common.save': '保存',
    'dialog.confirm': '确认', 'dialog.alert': '提示', 'dialog.info': '信息', 'dialog.gotIt': '知道了',
    'worldEditor.saveWorld': '保存世界',
    'npcEditor.saveChanges': '保存修改', 'npcEditor.createNpc': '创建NPC',
    'nav.home': '主页', 'nav.profile': '档案', 'nav.characters': '人物',
    'nav.notebook': '笔记', 'nav.business': '商业', 'nav.variables': '变量管理', 'nav.worldbook': '世界书', 'nav.dynamics': '世界动态', 'nav.memory': '记忆系统',
    'nav.saves': '存档', 'nav.save': '存档', 'nav.settings': '设置',
    'saves.title': '存档管理', 'saves.select': '选择存档', 'saves.empty': '暂无存档',
    'saves.save': '保存当前', 'saves.saving': '保存中...', 'saves.delete': '删除',
    'saves.load': '读取', 'saves.name': '存档名称（可选）', 'saves.confirm.delete': '确定删除此存档？',
    'saves.current': '保存当前进度', 'saves.current_save': '当前存档', 'saves.list': '存档列表',
    'saves.messages': '条消息', 'saves.rename': '重命名', 'saves.export': '导出存档',
    'saves.import': '导入存档', 'saves.save_as': '另存为', 'saves.manage': '存档管理',
    'saves.saved': '已保存', 'saves.imported': '导入成功',
    'start.title': '世界漫游指南', 'start.subtitle': '探索未知世界，书写你的故事',
    'start.world': '选择世界', 'start.world.dev': '开发中', 'start.world.default': '默认世界（自由模式）',
    'start.begin': '开始游戏', 'start.continue': '继续游戏', 'start.settings': '设置',
  },
  'en': {
    'settings.title': 'Settings', 'settings.back': '← Back', 'settings.save': 'Save & Return',
    'settings.test': 'Test Connection', 'settings.testing': 'Testing...', 'settings.ui': 'Interface', 'settings.api': 'API Settings',
    'settings.language': 'Language', 'settings.theme': 'Theme', 'settings.font': 'Font',
    'settings.uiFontSize': 'UI Font Size', 'settings.uiFontSize.desc': 'Font size for UI elements',
    'settings.bodyFontSize': 'Body Font Size', 'settings.bodyFontSize.desc': 'Font size for chat messages',
    'settings.lineHeight': 'Line Height', 'settings.autoScroll': 'Auto Scroll',
    'theme.light': 'Dawn', 'theme.dark': 'Nocturne', 'theme.metal': 'Silver', 'theme.green': 'Forest',
    'font.yahei': 'YaHei', 'font.source': 'Source Han', 'font.menglong': 'Menglong',
    'font.hanchan': 'Hanchan', 'font.shanggu': 'Shanggu',
    'settings.provider': 'Provider', 'settings.baseUrl': 'Base URL', 'settings.baseUrl.desc': 'API endpoint URL',
    'settings.apiKey': 'API Key', 'settings.apiKey.desc': 'Secret key',
    'settings.model': 'Model', 'settings.model.desc': 'Model name', 'settings.selectModel': 'Select Model',
    'settings.temperature': 'Temperature', 'settings.temperature.desc': 'Generation randomness', 'settings.fetchModels': 'Fetch',
    'chat.empty': 'Send a message to begin your journey...', 'chat.thinking': 'Thinking...',
    'chat.actions': 'Available actions:', 'chat.reasoning': 'Reasoning',
    'input.placeholder': 'Type your action... (Enter to send, Shift+Enter for newline)',
    'input.send': 'Send', 'input.stop': 'Stop',
    'common.small': 'S', 'common.medium': 'M', 'common.large': 'L',
    'common.compact': 'Compact', 'common.comfortable': 'Comfortable', 'common.loose': 'Loose',
    'common.cancel': 'Cancel', 'common.confirm': 'Confirm', 'common.save': 'Save',
    'dialog.confirm': 'Confirm', 'dialog.alert': 'Alert', 'dialog.info': 'Info', 'dialog.gotIt': 'Got it',
    'worldEditor.saveWorld': 'Save World',
    'npcEditor.saveChanges': 'Save Changes', 'npcEditor.createNpc': 'Create NPC',
    'nav.home': 'Home', 'nav.profile': 'Profile', 'nav.characters': 'Characters',
    'nav.notebook': 'Notes', 'nav.business': 'Business', 'nav.variables': 'Variables', 'nav.worldbook': 'World Book', 'nav.dynamics': 'World Dynamics', 'nav.memory': 'Memory',
    'nav.saves': 'Saves', 'nav.save': 'Save', 'nav.settings': 'Settings',
    'saves.title': 'Save Manager', 'saves.select': 'Select Save', 'saves.empty': 'No saves yet',
    'saves.save': 'Save Current', 'saves.saving': 'Saving...', 'saves.delete': 'Delete',
    'saves.load': 'Load', 'saves.name': 'Save name (optional)', 'saves.confirm.delete': 'Delete this save?',
    'saves.current': 'Save Current Progress', 'saves.current_save': 'Current Save', 'saves.list': 'Save List',
    'saves.messages': 'messages', 'saves.rename': 'Rename', 'saves.export': 'Export Save',
    'saves.import': 'Import Save', 'saves.save_as': 'Save As', 'saves.manage': 'Save Manager',
    'saves.saved': 'Saved', 'saves.imported': 'Imported',
    'start.title': 'Multi-Realm Traversal Simulator', 'start.subtitle': 'Realms converge, your destiny awaits',
    'start.world': 'Select World', 'start.world.dev': 'In Development', 'start.world.default': 'Default World (Free Mode)',
    'start.begin': 'Start Game', 'start.continue': 'Continue Game', 'start.settings': 'Settings',
  },
};

// ─── CSS 变量应用 ───

function applySettings(settings: UISettings) {
  const root = document.documentElement;

  // 主题切换：设置 data-theme 属性，由 tokens.css [data-theme] 选择器驱动
  root.dataset.theme = settings.theme;

  // 字体 & 排版（JS-only，CSS 无法用 CSS 变量引用另一个变量）
  root.style.setProperty('--font-family', FONT_MAP[settings.font]);
  root.style.setProperty('--font-display', "'Noto Serif SC', 'Source Han Serif SC', 'STSong', serif");
  root.style.setProperty('--font-body', FONT_MAP[settings.font]);
  root.style.setProperty('--ui-font-size', UI_FONT_SIZE_MAP[settings.uiFontSize]);
  root.style.setProperty('--body-font-size', BODY_FONT_SIZE_MAP[settings.bodyFontSize]);
  root.style.setProperty('--body-line-height', LINE_HEIGHT_MAP[settings.lineHeight]);

  root.lang = settings.language;
}

// ─── 持久化读取 ───

function loadUISettings(): UISettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
  } catch (e) {
    console.warn('[configStore] loadUISettings 解析失败，使用默认值:', e);
  }
  return DEFAULT_SETTINGS;
}

/**
 * 异步加载 API 配置：若 apiKey 为遗留明文，则重新加密落库（迁移）。
 * 内存中始终保存明文 apiKey 供请求使用；localStorage 中只存密文。
 */
async function loadApiConfig(): Promise<ApiConfig | null> {
  try {
    const saved = localStorage.getItem(API_STORAGE_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved) as ApiConfig;
    if (!parsed || typeof parsed !== 'object') return null;
    const storedKey = parsed.apiKey ?? '';
    // 迁移：遗留明文 → 密文
    if (storedKey && !isSealed(storedKey)) {
      const sealed = await seal(storedKey);
      localStorage.setItem(API_STORAGE_KEY, JSON.stringify({ ...parsed, apiKey: sealed }));
    }
    return { ...parsed, apiKey: await unseal(storedKey) };
  } catch (e) {
    console.warn('[configStore] loadApiConfig 解析失败:', e);
    return null;
  }
}

// ─── Store ───

interface ConfigState {
  // UI 设置
  settings: UISettings;
  // API 配置
  apiConfig: ApiConfig | null;
  // Actions
  updateSettings: <K extends keyof UISettings>(key: K, value: UISettings[K]) => void;
  setApiConfig: (config: ApiConfig) => void;
  /** 应用启动时异步加载（解密）已持久化的 API 配置 */
  initApiConfig: () => void;
  t: (key: string) => string;
  // 初始化（应用 CSS 变量）
  initialize: () => void;
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  settings: loadUISettings(),
  apiConfig: null, // 由 initApiConfig 异步加载（解密）

  updateSettings: (key, value) => {
    set(state => {
      const newSettings = { ...state.settings, [key]: value };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
      applySettings(newSettings);
      return { settings: newSettings };
    });
  },

  setApiConfig: async (config) => {
    // 落库前加密 apiKey（明文仅保留在内存）
    const sealed: ApiConfig = { ...config, apiKey: await seal(config.apiKey) };
    localStorage.setItem(API_STORAGE_KEY, JSON.stringify(sealed));
    set({ apiConfig: config });
  },

  initApiConfig: () => {
    loadApiConfig()
      .then((cfg) => { if (cfg) set({ apiConfig: cfg }); })
      .catch((err) => console.warn('[configStore] 初始化 API 配置失败:', err));
  },

  t: (key) => {
    const { settings } = get();
    return translations[settings.language]?.[key] ?? key;
  },

  initialize: () => {
    const { settings } = get();
    applySettings(settings);
  },
}));

// 应用启动时异步加载（解密）已持久化的 API 配置
useConfigStore.getState().initApiConfig();

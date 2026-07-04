// 配置存储 key 常量 - 统一命名规范（所有 localStorage 键的唯一来源）
export const STORAGE_KEYS = {
  // UI 设置
  UI_SETTINGS: 'world_travel_guide_ui_settings',
  API_CONFIG: 'world_travel_guide_api_config',

  // 记忆系统
  MEMORY_CONFIG: 'world_travel_guide_memory_config',

  // 管线配置 + 子键
  PIPELINE_CONFIG: 'world_travel_guide_pipeline',
  PIPELINE_VARIABLE_ENABLED: 'world_travel_guide_pipeline_variable_enabled',
  PIPELINE_VARIABLE_DELAY: 'world_travel_guide_pipeline_variable_delay',
  PIPELINE_VARIABLE_RETRIES: 'world_travel_guide_pipeline_variable_retries',
  PIPELINE_VARIABLE_MODEL: 'world_travel_guide_pipeline_variable_model',
  PIPELINE_MEMORY_ENABLED: 'world_travel_guide_pipeline_memory_enabled',

  // 模板存储
  PLAYER_PRESETS: 'world_travel_guide_player_presets',
  HISTORY_PRESETS: 'world_travel_guide_history_presets',
  NPC_TEMPLATES: 'world_travel_guide_npc_templates',
  CUSTOM_WORLDS: 'world_travel_guide_custom_worlds',

  // 存档系统
  ACTIVE_SAVE: 'world_travel_guide_active_save_id',

  // 生图配置
  IMAGE_CONFIG: 'world_travel_guide_image_config',

  // 代理设置
  PROXY_URL: 'world_travel_guide_proxy_url',

  // 预设管理
  PRESET_PACKS: 'world_travel_guide_preset_packs',
  ACTIVE_PRESET_ID: 'world_travel_guide_active_preset_id',
  BUILTIN_OVERRIDES: 'world_travel_guide_builtin_overrides',

  // API 预设（不同"预设"概念 — 此为 API 配置模板，非提示词预设包）
  API_PRESETS: 'world_travel_guide_api_presets',

  // 变量 API 预设
  VARIABLE_API_PRESET: 'world_travel_guide_variable_api_preset',
  VARIABLE_ENABLED: 'world_travel_guide_variable_enabled',

  // 模拟引擎
  SIMULATION_STATE: 'world_travel_guide_simulation',
  SIM_API_PRESET: 'world_travel_guide_sim_api_preset',

  // 音频
  AUDIO_MUTED: 'world_travel_guide_audio_muted',
} as const

export type StorageKey = keyof typeof STORAGE_KEYS

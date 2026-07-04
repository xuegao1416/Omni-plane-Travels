// 文本着色 - 对话文本的颜色标记和着色

export const DEFAULT_TEXT_COLORIZATION_RULE_COLOR = '#8a4b00'
export const DEFAULT_TEXT_COLORIZATION_PRESET_ID = 'default_dialogue_quotes'
export const DEFAULT_TEXT_COLORIZATION_PREVIEW_TEXT = '她轻声说："欢迎来到异世界。" 「今晚月色真美。」 "Hello, traveler." 『命运之书』静静躺在桌上。'

const LEGACY_TEXT_COLORIZATION_RULE_COLOR = '#f3d56b'
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

// ─── 类型定义 ──────────────────────────────────────────────

export interface TextColorizationRule {
  id: string
  name: string
  startMarker: string
  endMarker: string
  color: string
  enabled?: boolean
}

export interface TextColorizationPreset {
  id: string
  name: string
  rules: TextColorizationRule[]
}

export interface TextColorizationSettings {
  textColorizationEnabled: boolean
  activeTextColorizationPresetId: string
  textColorizationPresets: TextColorizationPreset[]
}

export interface TextColorizedSegment {
  text: string
  color: string | null
}

// 内部类型
interface InternalRule extends TextColorizationRule {
  _index: number
}

interface RuleNode {
  type: 'rule'
  startMarker: string
  endMarker: string
  color: string
  matched: boolean
  children: Array<TextNode | RuleNode>
}

interface TextNode {
  type: 'text'
  text: string
}

// ─── 工具函数 ──────────────────────────────────────────────

function toSafeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

export function sanitizeHexColor(value: unknown, fallback = DEFAULT_TEXT_COLORIZATION_RULE_COLOR): string {
  const safeValue = typeof value === 'string' ? value.trim() : ''
  if (HEX_COLOR_RE.test(safeValue)) return safeValue
  return fallback
}

export function generateTextColorizationId(prefix = 'text_color'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function createTextColorizationRuleDraft(overrides: Partial<TextColorizationRule> = {}): TextColorizationRule {
  return {
    id: toSafeString(overrides.id).trim() || generateTextColorizationId('text_color_rule'),
    name: toSafeString(overrides.name, '新规则').trim() || '新规则',
    startMarker: toSafeString(overrides.startMarker),
    endMarker: toSafeString(overrides.endMarker),
    color: sanitizeHexColor(overrides.color),
    enabled: overrides.enabled !== false
  }
}

export function createDefaultTextColorizationRules(): TextColorizationRule[] {
  return [
    {
      id: 'text_color_rule_cn_double_quotes',
      name: '中文引号 “ ”',
      startMarker: '“',
      endMarker: '”',
      color: DEFAULT_TEXT_COLORIZATION_RULE_COLOR,
      enabled: true
    },
    {
      id: 'text_color_rule_en_double_quotes',
      name: '英文双引号 " "',
      startMarker: '"',
      endMarker: '"',
      color: DEFAULT_TEXT_COLORIZATION_RULE_COLOR,
      enabled: true
    },
    {
      id: 'text_color_rule_cn_corner_quotes',
      name: '直角引号 「 」',
      startMarker: '「',
      endMarker: '」',
      color: DEFAULT_TEXT_COLORIZATION_RULE_COLOR,
      enabled: true
    },
    {
      id: 'text_color_rule_cn_book_quotes',
      name: '书名号 『 』',
      startMarker: '『',
      endMarker: '』',
      color: DEFAULT_TEXT_COLORIZATION_RULE_COLOR,
      enabled: true
    }
  ].map((rule, index) => normalizeTextColorizationRule(rule, index))
}

export function createDefaultTextColorizationPreset(): TextColorizationPreset {
  return {
    id: DEFAULT_TEXT_COLORIZATION_PRESET_ID,
    name: '默认对话染色',
    rules: createDefaultTextColorizationRules()
  }
}

export function createTextColorizationPresetDraft(overrides: Partial<TextColorizationPreset> = {}): TextColorizationPreset {
  const sourceRules = Array.isArray(overrides.rules) ? overrides.rules : [createTextColorizationRuleDraft()]
  return {
    id: toSafeString(overrides.id).trim() || generateTextColorizationId('text_color_preset'),
    name: toSafeString(overrides.name, '新染色方案').trim() || '新染色方案',
    rules: sourceRules.map((rule, index) => createTextColorizationRuleDraft({
      ...rule,
      id: toSafeString(rule?.id).trim() || undefined,
      name: toSafeString(rule?.name, `规则 ${index + 1}`).trim() || `规则 ${index + 1}`
    }))
  }
}

export function createDefaultTextColorizationSettings(): TextColorizationSettings {
  return {
    textColorizationEnabled: true,
    activeTextColorizationPresetId: DEFAULT_TEXT_COLORIZATION_PRESET_ID,
    textColorizationPresets: [createDefaultTextColorizationPreset()]
  }
}

export function normalizeTextColorizationRule(rule: Partial<TextColorizationRule> = {}, index = 0): TextColorizationRule {
  const normalizedRule = createTextColorizationRuleDraft({
    ...rule,
    id: toSafeString(rule?.id).trim() || `text_color_rule_${index + 1}`,
    name: toSafeString(rule?.name, `规则 ${index + 1}`).trim() || `规则 ${index + 1}`
  })

  const ruleColor = sanitizeHexColor(rule?.color, LEGACY_TEXT_COLORIZATION_RULE_COLOR)
  const shouldUpgradeLegacyDefaultColor = (
    ruleColor.toLowerCase() === LEGACY_TEXT_COLORIZATION_RULE_COLOR
  )

  return {
    ...normalizedRule,
    color: shouldUpgradeLegacyDefaultColor ? DEFAULT_TEXT_COLORIZATION_RULE_COLOR : normalizedRule.color,
    startMarker: toSafeString(rule?.startMarker),
    endMarker: toSafeString(rule?.endMarker)
  }
}

export function normalizeTextColorizationPreset(preset: Partial<TextColorizationPreset> = {}, index = 0): TextColorizationPreset {
  const sourceRules = Array.isArray(preset?.rules) ? preset.rules : []
  return {
    id: toSafeString(preset?.id).trim() || `text_color_preset_${index + 1}`,
    name: toSafeString(preset?.name, `方案 ${index + 1}`).trim() || `方案 ${index + 1}`,
    rules: sourceRules
      .map((rule, ruleIndex) => normalizeTextColorizationRule(rule, ruleIndex))
      .filter(rule => rule.startMarker.length > 0 && rule.endMarker.length > 0)
  }
}

export function normalizeTextColorizationSettings(theme: Partial<TextColorizationSettings> = {}): TextColorizationSettings {
  const defaults = createDefaultTextColorizationSettings()
  const sourcePresets = Array.isArray(theme?.textColorizationPresets)
    ? theme.textColorizationPresets
    : defaults.textColorizationPresets

  const normalizedPresets = sourcePresets
    .map((preset, index) => normalizeTextColorizationPreset(preset, index))
    .filter(preset => preset && typeof preset === 'object')

  const textColorizationPresets = normalizedPresets.length > 0
    ? normalizedPresets
    : defaults.textColorizationPresets

  const preferredPresetId = toSafeString(theme?.activeTextColorizationPresetId).trim()
  const activeTextColorizationPresetId = textColorizationPresets.some(preset => preset.id === preferredPresetId)
    ? preferredPresetId
    : textColorizationPresets[0].id

  return {
    textColorizationEnabled: theme?.textColorizationEnabled !== false,
    activeTextColorizationPresetId,
    textColorizationPresets
  }
}

export function getActiveTextColorizationPreset(theme: Partial<TextColorizationSettings> = {}): TextColorizationPreset | null {
  const settings = normalizeTextColorizationSettings(theme)
  return settings.textColorizationPresets.find(
    preset => preset.id === settings.activeTextColorizationPresetId
  ) || settings.textColorizationPresets[0] || null
}

// === 缓存：避免每次渲染都重新构建规则 ===
let _enabledRulesCache: TextColorizationRule[] | null = null
let _enabledRulesCacheThemeRef: Partial<TextColorizationSettings> | null = null

export function getEnabledTextColorizationRules(theme: Partial<TextColorizationSettings> = {}): TextColorizationRule[] {
  // 浅引用比较：如果 theme 对象引用未变则复用缓存
  if (_enabledRulesCache !== null && _enabledRulesCacheThemeRef === theme) {
    return _enabledRulesCache
  }

  const settings = normalizeTextColorizationSettings(theme)
  if (settings.textColorizationEnabled === false) {
    _enabledRulesCache = []
    _enabledRulesCacheThemeRef = theme
    return _enabledRulesCache
  }

  const activePreset = getActiveTextColorizationPreset(settings)
  if (!activePreset) {
    _enabledRulesCache = []
    _enabledRulesCacheThemeRef = theme
    return _enabledRulesCache
  }

  _enabledRulesCache = activePreset.rules.filter(
    rule => rule.enabled !== false && rule.startMarker.length > 0 && rule.endMarker.length > 0
  )
  _enabledRulesCacheThemeRef = theme
  return _enabledRulesCache
}

export function invalidateTextColorizationRulesCache(): void {
  _enabledRulesCache = null
  _enabledRulesCacheThemeRef = null
}

export function isLikelyPlainTextContent(content: unknown): boolean {
  const text = typeof content === 'string' ? content : String(content ?? '')
  if (!text.trim()) return true

  return !(
    /<!DOCTYPE|<html[\s>]|<head[\s>]|<body[\s>]/i.test(text) ||
    /<\/?[a-z][^>\n]*>/i.test(text)
  )
}

// ─── 段落构建 ──────────────────────────────────────────────

function pushSegment(segments: TextColorizedSegment[], text: string, color: string | null = null): void {
  if (!text) return

  const normalizedColor = color || null
  const lastSegment = segments[segments.length - 1]

  if (lastSegment && lastSegment.color === normalizedColor) {
    lastSegment.text += text
    return
  }

  segments.push({
    text,
    color: normalizedColor
  })
}

function appendTextNode(nodes: Array<TextNode | RuleNode>, text: string): void {
  if (!text) return

  const lastNode = nodes[nodes.length - 1]
  if (lastNode && lastNode.type === 'text') {
    lastNode.text += text
    return
  }

  nodes.push({
    type: 'text',
    text
  })
}

function findMarkerAt(text: string, index: number, markers: string[]): string {
  for (const marker of markers) {
    if (marker && text.startsWith(marker, index)) {
      return marker
    }
  }
  return ''
}

function getEscapedToken(text: string, index: number, markers: string[]): string | null {
  if (text[index] !== '\\') return null
  if (index + 1 >= text.length) return null

  if (text[index + 1] === '\\') {
    return '\\'
  }

  return findMarkerAt(text, index + 1, markers) || null
}

function emitNodes(nodes: Array<TextNode | RuleNode>, segments: TextColorizedSegment[], inheritedColor: string | null = null): void {
  for (const node of nodes) {
    if (!node) continue

    if (node.type === 'text') {
      pushSegment(segments, node.text, inheritedColor)
      continue
    }

    if (node.type === 'rule') {
      pushSegment(segments, node.startMarker, inheritedColor)
      emitNodes(node.children || [], segments, node.matched ? sanitizeHexColor(node.color) : inheritedColor)
      if (node.matched) {
        pushSegment(segments, node.endMarker, inheritedColor)
      }
    }
  }
}

export function buildTextColorizedSegments(content: string, rules: TextColorizationRule[] = [], options: { plainTextOnly?: boolean } = {}): TextColorizedSegment[] {
  const text = typeof content === 'string' ? content : String(content ?? '')
  if (!text) return []

  const safeRules: InternalRule[] = Array.isArray(rules)
    ? rules
      .filter(rule => rule && rule.enabled !== false && rule.startMarker && rule.endMarker)
      .map((rule, index) => ({
        ...rule,
        color: sanitizeHexColor(rule.color),
        _index: index
      }))
    : []

  if (!safeRules.length) {
    return [{ text, color: null }]
  }

  if (options.plainTextOnly && !isLikelyPlainTextContent(text)) {
    return [{ text, color: null }]
  }

  const sortedRules = [...safeRules].sort((left, right) => {
    if (right.startMarker.length !== left.startMarker.length) {
      return right.startMarker.length - left.startMarker.length
    }
    return left._index - right._index
  })

  const markerCandidates = [...new Set(
    sortedRules.flatMap(rule => [rule.startMarker, rule.endMarker]).filter(Boolean)
  )].sort((left, right) => right.length - left.length)

  const rootNodes: Array<TextNode | RuleNode> = []
  const stack: Array<{ rule: InternalRule | null; node: RuleNode | null; children: Array<TextNode | RuleNode> }> = [{
    rule: null,
    node: null,
    children: rootNodes
  }]
  let buffer = ''
  let position = 0

  const flushBuffer = () => {
    if (!buffer) return
    appendTextNode(stack[stack.length - 1].children, buffer)
    buffer = ''
  }

  while (position < text.length) {
    const escapedToken = getEscapedToken(text, position, markerCandidates)
    if (escapedToken !== null) {
      buffer += escapedToken
      position += escapedToken === '\\' ? 2 : escapedToken.length + 1
      continue
    }

    const currentFrame = stack[stack.length - 1]
    const currentRule = currentFrame.rule
    if (currentRule && text.startsWith(currentRule.endMarker, position)) {
      flushBuffer()
      currentFrame.node!.matched = true
      stack.pop()
      position += currentRule.endMarker.length
      continue
    }

    const nextRule = sortedRules.find(rule => text.startsWith(rule.startMarker, position))
    if (nextRule) {
      flushBuffer()

      const nextNode: RuleNode = {
        type: 'rule',
        startMarker: nextRule.startMarker,
        endMarker: nextRule.endMarker,
        color: sanitizeHexColor(nextRule.color),
        matched: false,
        children: []
      }

      stack[stack.length - 1].children.push(nextNode)
      stack.push({
        rule: nextRule,
        node: nextNode,
        children: nextNode.children
      })
      position += nextRule.startMarker.length
      continue
    }

    buffer += text[position]
    position += 1
  }

  flushBuffer()

  const segments: TextColorizedSegment[] = []
  emitNodes(rootNodes, segments, null)

  return segments.length > 0 ? segments : [{ text, color: null }]
}

// ─── HTML 着色 ──────────────────────────────────────────────

const HTML_TEXT_COLORIZATION_SKIP_TAGS = [
  'script',
  'style',
  'code',
  'pre',
  'textarea',
  'button',
  'select',
  'option'
]

function hasColorizedSegments(segments: TextColorizedSegment[] = []): boolean {
  return Array.isArray(segments) && segments.some(segment => segment?.color)
}

function createTextColorizationPlaceholder(index: number): string {
  return `__TEXT_COLORIZATION_PLACEHOLDER_${index}__`
}

function pushHtmlPlaceholder(placeholders: Array<{ token: string; value: string }>, value: string): string {
  const token = createTextColorizationPlaceholder(placeholders.length)
  placeholders.push({ token, value })
  return token
}

function replaceHtmlPlaceholders(text: string, placeholders: Array<{ token: string; value: string }> = []): string {
  let result = typeof text === 'string' ? text : String(text ?? '')
  placeholders.forEach(({ token, value }) => {
    result = result.split(token).join(value)
  })
  return result
}

function protectSkippedHtmlBlocks(html: string, placeholders: Array<{ token: string; value: string }>): string {
  let protectedHtml = html

  HTML_TEXT_COLORIZATION_SKIP_TAGS.forEach(tagName => {
    const regex = new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`, 'gi')
    protectedHtml = protectedHtml.replace(regex, match => pushHtmlPlaceholder(placeholders, match))
  })

  protectedHtml = protectedHtml.replace(/<input\b[^>]*\/?>/gi, match => pushHtmlPlaceholder(placeholders, match))

  return protectedHtml
}

function tokenizeHtmlTags(html: string, placeholders: Array<{ token: string; value: string }>): string {
  return html.replace(/<[^>]+>/g, match => pushHtmlPlaceholder(placeholders, match))
}

function wrapColorizedHtmlSegment(html: string, color: string): string {
  if (!html) return ''
  return `<span class="text-colorized-fragment" style="color: ${sanitizeHexColor(color)};">${html}</span>`
}

// === LRU缓存：避免重复的文本染色计算 ===
const _textColorizationHtmlCache = new Map<string, string>()
const _TEXT_COLORIZATION_HTML_CACHE_MAX = 300

function _hashColorizationText(text: string): string {
  let hash = 2166136261
  const source = typeof text === 'string' ? text : String(text ?? '')
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function _buildColorizationCacheKey(html: string, rules: TextColorizationRule[]): string {
  const htmlKey = `${html.length}:${_hashColorizationText(html)}`
  const rulesKey = rules.map(r => `${r.startMarker}|${r.endMarker}|${r.color}`).join(';;')
  return `${htmlKey}|||${rulesKey}`
}

export function applyTextColorizationToHtml(html: string, rules: TextColorizationRule[] = []): string {
  const safeHtml = typeof html === 'string' ? html : String(html ?? '')
  const safeRules = Array.isArray(rules)
    ? rules.filter(rule => rule && rule.enabled !== false && rule.startMarker && rule.endMarker)
    : []

  if (!safeHtml || safeRules.length === 0) {
    return safeHtml
  }

  // LRU 缓存查找
  const cacheKey = _buildColorizationCacheKey(safeHtml, safeRules)
  const cached = _textColorizationHtmlCache.get(cacheKey)
  if (cached !== undefined) {
    return cached
  }

  const placeholders: Array<{ token: string; value: string }> = []
  const protectedHtml = protectSkippedHtmlBlocks(safeHtml, placeholders)
  const tokenizedHtml = tokenizeHtmlTags(protectedHtml, placeholders)
  const segments = buildTextColorizedSegments(tokenizedHtml, safeRules, { plainTextOnly: false })

  if (!hasColorizedSegments(segments)) {
    _textColorizationHtmlCache.set(cacheKey, safeHtml)
    if (_textColorizationHtmlCache.size > _TEXT_COLORIZATION_HTML_CACHE_MAX) {
      const firstKey = _textColorizationHtmlCache.keys().next().value
      _textColorizationHtmlCache.delete(firstKey!)
    }
    return safeHtml
  }

  const result = segments.map(segment => {
    const restoredSegment = replaceHtmlPlaceholders(segment.text, placeholders)
    if (!restoredSegment) return ''
    return segment.color
      ? wrapColorizedHtmlSegment(restoredSegment, segment.color)
      : restoredSegment
  }).join('')

  _textColorizationHtmlCache.set(cacheKey, result)
  if (_textColorizationHtmlCache.size > _TEXT_COLORIZATION_HTML_CACHE_MAX) {
    const firstKey = _textColorizationHtmlCache.keys().next().value
    _textColorizationHtmlCache.delete(firstKey!)
  }

  return result
}

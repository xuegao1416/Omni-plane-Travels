// Markdown 渲染工具
//
// 功能：
// 1. 使用 marked (v17) 解析 Markdown 为 HTML
// 2. 使用 highlight.js 对代码块进行语法高亮
// 3. 使用 DOMPurify 进行 XSS 防护
// 4. 检测完整 HTML 页面内容（用于 iframe 渲染）
// 5. 流式渲染时自动补全未闭合的代码块

import { marked, Renderer, type Tokens } from 'marked'
import hljs from 'highlight.js/lib/core'
import DOMPurify from 'dompurify'
import { applyTextColorizationToHtml, type TextColorizationRule } from './text-colorization'

// 按需注册常用语言（减少包体积）
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml' // html 包含在 xml 中
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import markdown from 'highlight.js/lib/languages/markdown'
import java from 'highlight.js/lib/languages/java'
import csharp from 'highlight.js/lib/languages/csharp'
import cpp from 'highlight.js/lib/languages/cpp'
import sql from 'highlight.js/lib/languages/sql'
import yaml from 'highlight.js/lib/languages/yaml'
import plaintext from 'highlight.js/lib/languages/plaintext'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('py', python)
hljs.registerLanguage('css', css)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('json', json)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('md', markdown)
hljs.registerLanguage('java', java)
hljs.registerLanguage('csharp', csharp)
hljs.registerLanguage('cs', csharp)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('c', cpp)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('yml', yaml)
hljs.registerLanguage('plaintext', plaintext)
hljs.registerLanguage('text', plaintext)

// highlight.js 样式（内联，避免额外 CSS 文件加载问题）
import 'highlight.js/styles/atom-one-dark.min.css'

// ============ 自定义 marked 渲染器 ============
const renderer = new Renderer()

// 自定义链接渲染
renderer.link = function({ href, title, tokens }: Tokens.Link) {
  const text = this.parser.parseInline(tokens)
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : ''
  return `<a href="${escapeHtml(href || '')}" target="_blank" rel="noopener noreferrer"${titleAttr}>${text}</a>`
}

// 自定义代码块渲染
renderer.code = function({ text, lang }: Tokens.Code) {
  const language = lang && hljs.getLanguage(lang) ? lang : null
  let highlighted: string

  if (language) {
    try {
      highlighted = hljs.highlight(text, { language }).value
    } catch (e) {
      highlighted = escapeHtml(text)
    }
  } else {
    // 尝试自动检测
    try {
      highlighted = hljs.highlightAuto(text).value
    } catch (e) {
      highlighted = escapeHtml(text)
    }
  }

  const langLabel = language || 'code'
  return `<div class="code-block-wrapper">
    <div class="code-block-header">
      <span class="code-lang">${escapeHtml(langLabel)}</span>
      <button class="code-copy-btn" data-action="copy-code">复制</button>
    </div>
    <pre><code class="hljs${language ? ' language-' + escapeHtml(language) : ''}">${highlighted}</code></pre>
  </div>`
}

// 自定义行内代码
renderer.codespan = function({ text }: Tokens.Codespan) {
  return `<code class="inline-code">${escapeHtml(text)}</code>`
}

// 自定义图片渲染（懒加载 + 错误处理）
renderer.image = function({ href, title, text }: Tokens.Image) {
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : ''
  return `<img src="${escapeHtml(href || '')}" alt="${escapeHtml(text || '')}"${titleAttr} loading="lazy" />`
}

// 自定义引用块
renderer.blockquote = function({ tokens }: Tokens.Blockquote) {
  const body = this.parser.parse(tokens)
  return `<blockquote class="md-blockquote">${body}</blockquote>`
}

// 自定义表格 (marked v18: table 接收完整 token)
renderer.table = function(token: Tokens.Table) {
  let header = ''
  let body = ''

  // 构建表头
  header += '<tr>'
  for (const cell of token.header) {
    const cellContent = this.parser.parseInline(cell.tokens)
    const align = cell.align ? ` style="text-align:${cell.align}"` : ''
    header += `<th${align}>${cellContent}</th>`
  }
  header += '</tr>'

  // 构建表体
  for (const row of token.rows) {
    body += '<tr>'
    for (const cell of row) {
      const cellContent = this.parser.parseInline(cell.tokens)
      const align = cell.align ? ` style="text-align:${cell.align}"` : ''
      body += `<td${align}>${cellContent}</td>`
    }
    body += '</tr>'
  }

  return `<div class="table-wrapper"><table class="md-table"><thead>${header}</thead><tbody>${body}</tbody></table></div>`
}

// ============ DOMPurify 配置 ============
// 允许安全的 HTML 标签和属性
const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    // 文本格式
    'p', 'br', 'hr', 'b', 'i', 'em', 'strong', 'u', 's', 'del', 'ins',
    'sub', 'sup', 'mark', 'small', 'abbr', 'cite', 'q',
    // 标题
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    // 列表
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    // 链接和媒体
    'a', 'img',
    // 代码
    'pre', 'code', 'kbd', 'samp', 'var',
    // 表格
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    // 块级
    'div', 'span', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'main',
    'figure', 'figcaption', 'details', 'summary', 'blockquote',
    // 自定义元素（用于代码块的包装）
    'button',
    // 允许 font/center 等旧标签（AI 可能输出）
    'font', 'center'
  ],
  ALLOWED_ATTR: [
    'href', 'target', 'rel', 'title', 'alt', 'src', 'loading',
    'class', 'id', 'lang', 'dir',
    'colspan', 'rowspan', 'scope', 'headers',
    'open', 'name',
    // onclick/onerror 已移除，防止 XSS。代码复制改为事件委托（见 initCodeCopyDelegate）
    'data-action',
    'data-highlighted',
    // font 标签属性
    'color', 'face', 'size',
    // 通用
    'align', 'width', 'height'
  ],
  ALLOW_DATA_ATTR: true,
  ADD_ATTR: ['target'],
  // 禁止危险标签
  FORBID_TAGS: ['script', 'object', 'embed', 'applet'],
  FORBID_ATTR: ['onload', 'onmouseover', 'onfocus', 'onblur']
}

// iframe 专用净化配置（L-02）
// iframe 已由 sandbox="allow-scripts"（不含 allow-same-origin）隔离，无法访问父页面，
// 因此允许 <script>/<style>/<canvas> 等保持功能；但仍须：
// - 禁止嵌套 iframe / frame / object / embed / base（防止二次帧攻击与 URL 劫持）
// - 禁止 form / 输入类标签（防止钓鱼提交）
// - 禁止 javascript: URI 与 on* 内联事件（DOMPurify 默认已拦截）
const PURIFY_CONFIG_IFRAME = {
  ADD_TAGS: ['script', 'style', 'canvas', 'svg'],
  FORBID_TAGS: ['iframe', 'frame', 'frameset', 'object', 'embed', 'base', 'form', 'input', 'button', 'link', 'meta'],
  // 仍保留默认对 javascript: 与内联事件处理器的拦截
  ALLOW_DATA_ATTR: false,
}

// ============ 检测完整 HTML 页面 ============
export function isFullHtmlPage(content: string): boolean {
  if (!content || typeof content !== 'string') return false
  const trimmed = content.trim()
  return (
    trimmed.includes('<!DOCTYPE') ||
    trimmed.includes('<!doctype') ||
    trimmed.includes('<html') ||
    (trimmed.includes('<head>') && trimmed.includes('<body'))
  )
}

/**
 * 检测内容是否包含 HTML 标签（不是完整页面，但有 HTML 元素）
 */
export function containsHtmlTags(content: string): boolean {
  if (!content || typeof content !== 'string') return false
  return /<(?:div|span|p|h[1-6]|ul|ol|table|form|input|button|style|section|article|header|footer|nav|main|aside|figure|canvas|svg|video|audio)[\s>]/i.test(content)
}

/**
 * 从 markdown 代码块中提取完整 HTML
 * 匹配 ```html ... ``` 格式
 */
export function extractHtmlFromCodeBlock(content: string): string | null {
  if (!content || typeof content !== 'string') return null
  const match = content.match(/```html\s*\n([\s\S]*?)\n```/)
  if (match && match[1]) {
    const html = match[1].trim()
    if (html) {
      return html
    }
  }
  return null
}

// ============ 流式内容预处理 ============
/**
 * 预处理流式传输中的内容，补全未闭合的标记
 */
export function preprocessStreamingContent(text: string): string {
  if (!text) return text

  // 1. 补全未闭合的代码块
  const codeBlockCount = (text.match(/```/g) || []).length
  if (codeBlockCount % 2 !== 0) {
    text += '\n```'
  }

  // 2. 补全未闭合的行内代码
  const inlineCodeCount = (text.match(/(?<!`)(`(?!`))/g) || []).length
  if (inlineCodeCount % 2 !== 0) {
    text += '`'
  }

  // 3. 补全未闭合的粗体/斜体
  const boldCount = (text.match(/\*\*/g) || []).length
  if (boldCount % 2 !== 0) {
    text += '**'
  }

  const italicMatches = text.match(/(?<!\*)\*(?!\*)/g) || []
  if (italicMatches.length % 2 !== 0) {
    text += '*'
  }

  return text
}

// ============ 主解析函数 ============

export interface ParseContentOptions {
  isStreaming?: boolean
  textColorizationRules?: TextColorizationRule[]
}

export interface ParsedContentResult {
  type: 'html' | 'iframe'
  content: string
}

/**
 * 处理内联选项标记
 * 将 [选项文本] 或 【选项文本】 转换为可点击的 span 元素
 * 只处理 HTML 标签外的文本，避免破坏已有 HTML 属性（如 data-option-text）
 */
function processInlineOptions(html: string): string {
  // 按 HTML 标签拆分，只处理标签外的纯文本部分
  const parts = html.split(/(<[^>]+>)/)
  for (let i = 0; i < parts.length; i++) {
    // 跳过 HTML 标签（奇数索引）
    if (i % 2 === 1) continue
    // 跳过空文本
    if (!parts[i].trim()) continue

    parts[i] = parts[i]
      // 匹配 [选项] 格式，排除 markdown 链接语法 [...](...)
      .replace(
        /(?<!!)\[(?!\])([^\[\]]{1,100})\](?!\()/g,
        (match, optionText) => {
          const trimmed = optionText.trim()
          if (!trimmed) return match
          if (/^\d+$/.test(trimmed)) return match
          return `<span class="inline-option" data-option-text="${escapeHtml(trimmed)}">${escapeHtml(trimmed)}</span>`
        }
      )
      // 匹配 【选项】 格式
      .replace(
        /【([^【】]{1,100})】/g,
        (match, optionText) => {
          const trimmed = optionText.trim()
          if (!trimmed) return match
          return `<span class="inline-option" data-option-text="${escapeHtml(trimmed)}">${escapeHtml(trimmed)}</span>`
        }
      )
  }
  return parts.join('')
}

/**
 * 解析内容并返回渲染结果
 */
export function parseContent(text: string, options: ParseContentOptions = {}): ParsedContentResult {
  if (!text) return { type: 'html', content: '' }

  const { isStreaming = false, textColorizationRules = [] } = options

  // 1. 检测是否为完整 HTML 页面
  if (isFullHtmlPage(text)) {
    return {
      type: 'iframe',
      content: DOMPurify.sanitize(text, PURIFY_CONFIG_IFRAME)
    }
  }

  // 2. 检测 ```html``` 代码块中的完整 HTML
  const extractedHtml = extractHtmlFromCodeBlock(text)
  if (extractedHtml) {
    const trimmed = text.trim()
    const isOnlyCodeBlock = trimmed.startsWith('```html') && trimmed.endsWith('```')

    if (isOnlyCodeBlock) {
      // 如果是完整 HTML 页面，用 iframe 渲染
      if (isFullHtmlPage(extractedHtml)) {
        return {
          type: 'iframe',
          content: DOMPurify.sanitize(extractedHtml, PURIFY_CONFIG_IFRAME)
        }
      }

      // 如果是 HTML 片段，通过 DOMPurify 清理后直接渲染
      const sanitized = DOMPurify.sanitize(extractedHtml, PURIFY_CONFIG)
      return {
        type: 'html',
        content: applyTextColorizationToHtml(sanitized, textColorizationRules)
      }
    }
    // 如果代码块不是唯一内容，继续走 marked 解析（代码块会被高亮显示）
  }

  // 3. 流式内容预处理
  let processedText = text
  if (isStreaming) {
    processedText = preprocessStreamingContent(processedText)
  }

  // 4. 使用 marked 解析 Markdown（marked 本身能正确处理混合 HTML + Markdown）
  try {
    let html = marked(processedText, { renderer, breaks: false, gfm: true }) as string

    // 5. 使用 DOMPurify 清理 HTML（防止 XSS，但保留安全的 HTML 标签）
    html = DOMPurify.sanitize(html, PURIFY_CONFIG)
    html = applyTextColorizationToHtml(html, textColorizationRules)

    // 6. 处理内联选项（在 DOMPurify 之后，因为需要保留 data 属性）
    html = processInlineOptions(html)

    return {
      type: 'html',
      content: html
    }
  } catch (e) {
    console.error('Markdown parsing error:', e)
    return {
      type: 'html',
      content: applyTextColorizationToHtml(`<p>${escapeHtml(text)}</p>`, textColorizationRules)
    }
  }
}

/**
 * 简单解析 Markdown 为 HTML（向后兼容）
 */
export function parseMarkdown(text: string): string {
  const result = parseContent(text)
  return result.content
}

/**
 * 清理 AI 响应文本中的特殊标记
 */
export function cleanAIResponse(text: string): string {
  if (!text) return ''

  // 移除 <think>...</think> 标签及其内容（AI思考过程）
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '')

  // 移除 <details> 思考块
  text = text.replace(/<details>\s*<summary>思考过程<\/summary>[\s\S]*?<\/details>/gi, '')

  // 清理多余的空行
  text = text.replace(/\n{3,}/g, '\n\n')

  return text.trim()
}

/**
 * 转义 HTML 特殊字符
 */
export function escapeHtml(text: string): string {
  if (!text) return ''
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * 初始化代码复制按钮的事件委托
 * 在组件挂载时调用，自动处理 data-action="copy-code" 的点击事件
 * @param container - 容器 DOM 元素
 * @returns 清理函数（用于 useEffect cleanup）
 */
export function initCodeCopyDelegate(container: HTMLElement): () => void {
  const handler = async (e: Event) => {
    const btn = (e.target as HTMLElement).closest?.('[data-action="copy-code"]') as HTMLButtonElement | null
    if (!btn) return
    e.preventDefault()
    e.stopPropagation()
    const wrapper = btn.closest('.code-block-wrapper')
    const code = wrapper?.querySelector('code')
    if (!code) return
    try {
      await navigator.clipboard.writeText(code.textContent || '')
      btn.textContent = '已复制!'
      setTimeout(() => { btn.textContent = '复制' }, 2000)
    } catch {
      btn.textContent = '失败'
      setTimeout(() => { btn.textContent = '复制' }, 2000)
    }
  }
  container.addEventListener('click', handler)
  return () => container.removeEventListener('click', handler)
}

/**
 * 为 iframe 创建完整的 HTML 文档
 */
export function createIframeSrcDoc(content: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
*, *::before, *::after { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: transparent;
  color: #e0d6c8;
  font-family: 'Noto Serif SC', 'Georgia', serif;
}
</style>
</head>
<body>
${content}
<script>
// 自动调整 iframe 高度
function adjustHeight() {
  var height = Math.max(
    document.body.scrollHeight,
    document.body.offsetHeight,
    document.documentElement.scrollHeight,
    document.documentElement.offsetHeight
  );
  window.parent.postMessage({ type: 'iframe-resize', height: height }, window.location.origin);
}
window.addEventListener('load', adjustHeight);
new MutationObserver(adjustHeight).observe(document.body, { childList: true, subtree: true, attributes: true });
setTimeout(adjustHeight, 100);
setTimeout(adjustHeight, 500);
<\/script>
</body>
</html>`
}

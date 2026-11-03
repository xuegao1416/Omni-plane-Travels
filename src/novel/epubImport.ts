import JSZip from 'jszip';
import { v4 as uuid } from 'uuid';
import { buildNovelSegments, hashNovelText } from './segmentation';
import type { NovelChapter, NovelDataset } from './types';

function decodeEntities(source: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return source.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (_match, entity: string) => {
    if (entity.startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return named[entity.toLowerCase()] ?? _match;
  });
}

function stripHtml(source: string): string {
  return decodeEntities(source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|section|article|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function attr(source: string, name: string): string {
  const match = source.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return decodeEntities(match?.[1] ?? '').trim();
}

function dirname(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(0, slash + 1) : '';
}

function resolvePath(baseFile: string, href: string): string {
  href = decodeURIComponent(href.split('#')[0].split('?')[0]);
  if (/^[a-z][a-z\d+.-]*:/i.test(href)) throw new Error(`EPUB 不支持外部资源 ${href}`);
  const stack = dirname(baseFile).split('/').filter(Boolean);
  for (const part of href.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!stack.length) throw new Error(`EPUB 资源越出档案根目录 ${href}`); stack.pop(); }
    else stack.push(part);
  }
  return stack.join('/');
}

function readTagText(source: string, names: string[]): string {
  for (const name of names) {
    const match = source.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
    const value = match ? stripHtml(match[1]) : '';
    if (value) return value.split('\n')[0].trim();
  }
  return '';
}

function chapterFromHtml(html: string): { title: string; content: string } | null {
  const title = readTagText(html, ['h1', 'h2', 'h3', 'title']);
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  let content = stripHtml(body);
  if (title && content.startsWith(title)) content = content.slice(title.length).trim();
  if (!content || /^(?:目录|contents?)$/i.test(content.replace(/\s+/g, ''))) return null;
  return { title: title || '未命名章节', content };
}

export async function createNovelDatasetFromEpub(
  fileName: string,
  source: ArrayBuffer | Uint8Array,
): Promise<NovelDataset> {
  const zip = await JSZip.loadAsync(source);
  const issues: NonNullable<NovelDataset['importIssues']> = [];
  const issue = (code: string, message: string, resource?: string, severity: 'warning' | 'error' = 'warning') => {
    issues.push({ code, message, resource, severity });
  };
  const container = await zip.file('META-INF/container.xml')?.async('string');
  if (!container) throw new Error('EPUB 缺少 META-INF/container.xml');
  const opfPath = attr(container.match(/<rootfile\b[^>]*>/i)?.[0] ?? '', 'full-path');
  if (!opfPath) throw new Error('EPUB 未声明 OPF 内容文件');
  const opf = await zip.file(opfPath)?.async('string');
  if (!opf) throw new Error(`EPUB 无法读取 ${opfPath}`);

  const manifest = new Map<string, { href: string; mediaType: string; properties: string }>();
  for (const match of opf.matchAll(/<item\b[^>]*>/gi)) {
    const id = attr(match[0], 'id');
    const href = attr(match[0], 'href');
    if (id && href) manifest.set(id, {
      href,
      mediaType: attr(match[0], 'media-type'),
      properties: attr(match[0], 'properties'),
    });
  }
  const spineIds = Array.from(opf.matchAll(/<itemref\b[^>]*>/gi)).map(match => attr(match[0], 'idref')).filter(Boolean);
  if (!spineIds.length) issue('missing_spine', '未找到阅读顺序，按 manifest 顺序导入，请核对章节。');
  const ordered = (spineIds.length > 0 ? spineIds : [...manifest.keys()])
    .map(id => {
      const item = manifest.get(id);
      if (!item) issue('missing_manifest_item', `阅读顺序引用了不存在的资源 ${id}`, id, 'error');
      else if (!/(?:xhtml|html)/i.test(item.mediaType) && !/\bnav\b/i.test(item.properties)) issue('unsupported_spine_resource', '阅读顺序包含非文本内容，无法分析其正文。', item.href, 'error');
      return item;
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .filter(item => /(?:xhtml|html)/i.test(item.mediaType) && !/\bnav\b/i.test(item.properties));

  const id = uuid();
  const rawParts: string[] = [];
  const provisional: Array<Omit<NovelChapter, 'startOffset' | 'endOffset' | 'contentHash' | 'wordCount'>> = [];
  const navigation = new Map<string, Array<{ anchor: string; title: string }>>();
  const addNavigation = (base: string, href: string, title: string) => {
    if (!href || !title) return;
    try {
      const path = resolvePath(base, href);
      const anchor = decodeURIComponent(href.split('#')[1] ?? '');
      const entries = navigation.get(path) ?? [];
      if (!entries.some(entry => entry.anchor === anchor)) entries.push({ anchor, title });
      navigation.set(path, entries);
    } catch (error) { issue('invalid_navigation_path', String(error), href); }
  };
  for (const item of manifest.values()) {
    if (!/\bnav\b/i.test(item.properties) && !/ncx/i.test(item.mediaType)) continue;
    let navPath: string;
    try { navPath = resolvePath(opfPath, item.href); }
    catch (error) { issue('invalid_navigation_path', String(error), item.href); continue; }
    const nav = await zip.file(navPath)?.async('string');
    if (!nav) { issue('missing_navigation', '目录资源无法读取，使用正文标题。', navPath); continue; }
    if (/ncx/i.test(item.mediaType)) {
      // Stop at the next navPoint so nested entries cannot consume their parent label.
      for (const match of nav.matchAll(/<navPoint\b[^>]*>([\s\S]*?)(?=<navPoint\b|<\/navPoint>)/gi)) {
        const label = readTagText(match[1], ['text']);
        const href = attr(match[1].match(/<content\b[^>]*>/i)?.[0] ?? '', 'src');
        addNavigation(navPath, href, label);
      }
    } else {
      const sections = [...nav.matchAll(/<nav\b([^>]*)>([\s\S]*?)<\/nav>/gi)];
      const toc = sections.find(section => /(?:epub:type|role)\s*=\s*["'][^"']*(?:toc|doc-toc)/i.test(section[1]));
      const content = toc?.[2] ?? sections[0]?.[2] ?? nav;
      for (const match of content.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) addNavigation(navPath, attr(match[1], 'href'), stripHtml(match[2]));
    }
  }
  const encrypted = await zip.file('META-INF/encryption.xml')?.async('string');
  const encryptedPaths = new Set<string>();
  for (const match of (encrypted ?? '').matchAll(/<CipherReference\b[^>]*>/gi)) {
    try { encryptedPaths.add(resolvePath('', attr(match[0], 'URI'))); } catch { /* diagnosed when referenced */ }
  }
  const seenPaths = new Set<string>();
  for (const item of ordered) {
    let path: string;
    try { path = resolvePath(opfPath, item.href); }
    catch (error) { issue('invalid_resource_path', String(error), item.href, 'error'); continue; }
    if (seenPaths.has(path)) { issue('duplicate_spine_resource', '阅读顺序中的重复正文资源仅导入一次。', path); continue; }
    seenPaths.add(path);
    if (encryptedPaths.has(path)) { issue('encrypted_body', '正文已加密，无法分析。', path, 'error'); continue; }
    let html: string | undefined;
    try { html = await zip.file(path)?.async('string'); }
    catch (error) { issue('damaged_resource', `正文资源损坏：${String(error)}`, path, 'error'); continue; }
    if (!html) { issue('missing_resource', '正文资源无法读取，导入内容不完整。', path, 'error'); continue; }
    const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
    const boundaries: Array<{ start: number; title: string }> = [];
    for (const entry of navigation.get(path) ?? []) {
      if (!entry.anchor) { boundaries.push({ start: 0, title: entry.title }); continue; }
      const match = [...body.matchAll(/<[^>]+>/g)].find(tag => attr(tag[0], 'id') === entry.anchor || attr(tag[0], 'name') === entry.anchor);
      if (!match) { issue('missing_anchor', `目录定位 ${entry.anchor} 未找到，保留正文。`, path); continue; }
      boundaries.push({ start: match.index!, title: entry.title });
    }
    boundaries.sort((a, b) => a.start - b.start);
    const unique = boundaries.filter((boundary, index) => index === 0 || boundary.start !== boundaries[index - 1].start);
    if (!unique.length || unique[0].start > 0) unique.unshift({ start: 0, title: '' });
    for (let index = 0; index < unique.length; index++) {
      const boundary = unique[index];
      const fragment = body.slice(boundary.start, unique[index + 1]?.start ?? body.length);
      const parsed = chapterFromHtml(fragment);
      if (!parsed) {
        if (/<(?:img|svg|image)\b/i.test(fragment)) issue('image_only_body', '正文区间只有图片，尚未提取图中文字。', path, 'error');
        continue;
      }
      const title = boundary.title || (index === 0 && unique.length > 1 ? '卷前文' : parsed.title);
      provisional.push({ id: uuid(), datasetId: id, index: provisional.length, ...parsed, title, sourceResource: path, included: true });
      rawParts.push(`${title}\n${parsed.content}`);
    }
  }
  if (provisional.length === 0) throw new Error('EPUB 中没有可识别的正文章节');

  const rawText = rawParts.join('\n\n');
  const sourceVersion = hashNovelText(rawText);
  let cursor = 0;
  const chapters: NovelChapter[] = provisional.map((chapter, index) => {
    const header = `${chapter.title}\n`;
    const partStart = cursor;
    const startOffset = partStart + header.length;
    const endOffset = startOffset + chapter.content.length;
    cursor += rawParts[index].length + (index < rawParts.length - 1 ? 2 : 0);
    return {
      ...chapter,
      startOffset,
      endOffset,
      wordCount: chapter.content.replace(/\s+/g, '').length,
      contentHash: hashNovelText(chapter.content),
      sourceVersion,
    };
  });
  const title = readTagText(opf, ['dc:title', 'title']) || fileName.replace(/\.epub$/i, '').trim() || '未命名小说';
  const now = Date.now();
  return {
    id, title, sourceType: 'epub', schemaVersion: 2,
    sourceVersion, sourceVerified: !issues.some(item => item.severity === 'error'), importIssues: issues,
    rawTextLength: rawText.length, rawText, chapters, staticMaterial: {},
    segments: buildNovelSegments(id, chapters),
    analysisStatus: 'draft', analysisVersion: 1,
    createdAt: now, updatedAt: now,
  };
}

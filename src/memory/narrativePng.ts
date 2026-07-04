// ============================================================
// 记忆系统 PNG 导出/导入
// 移植自 yijiekkk/src/utils/memory-png.js
// 将记忆运行态数据嵌入 PNG tEXt 块
// ============================================================

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const MEMORY_PNG_TEXT_KEY = 'omni-plane-travels-memory-runtime-pack';
const DEFAULT_ACCENT = '#d4a853';
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
    table[index] = crc >>> 0;
  }
  return table;
})();

// ─── 工具函数 ───

function clampText(value: unknown, fallback = ''): string {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function numberOrZero(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function bytesToAsciiString(bytes: Uint8Array): string {
  let result = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    result += String.fromCharCode(...chunk);
  }
  return result;
}

function utf8ToBase64(text: string): string {
  const bytes = textEncoder.encode(String(text ?? ''));
  return btoa(bytesToAsciiString(bytes));
}

function base64ToUtf8(base64Text: string): string {
  const binary = atob(String(base64Text ?? ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return textDecoder.decode(bytes);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) >>> 0) +
    ((bytes[offset + 1] << 16) >>> 0) +
    ((bytes[offset + 2] << 8) >>> 0) +
    (bytes[offset + 3] >>> 0)
  ) >>> 0;
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatUint8Arrays(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, item) => sum + item.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const item of arrays) {
    merged.set(item, offset);
    offset += item.length;
  }
  return merged;
}

function isPngBytes(bytes: Uint8Array): boolean {
  if (!(bytes instanceof Uint8Array) || bytes.length < PNG_SIGNATURE.length) return false;
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) return false;
  }
  return true;
}

function createPngChunk(type: string, dataBytes: Uint8Array): Uint8Array {
  const typeBytes = textEncoder.encode(type);
  const chunk = new Uint8Array(12 + dataBytes.length);
  writeUint32(chunk, 0, dataBytes.length);
  chunk.set(typeBytes, 4);
  chunk.set(dataBytes, 8);
  const crcInput = concatUint8Arrays(typeBytes, dataBytes);
  writeUint32(chunk, 8 + dataBytes.length, crc32(crcInput));
  return chunk;
}

function createTextChunk(keyword: string, text: string): Uint8Array {
  const keywordBytes = textEncoder.encode(keyword);
  const textBytes = textEncoder.encode(text);
  const dataBytes = new Uint8Array(keywordBytes.length + 1 + textBytes.length);
  dataBytes.set(keywordBytes, 0);
  dataBytes[keywordBytes.length] = 0;
  dataBytes.set(textBytes, keywordBytes.length + 1);
  return createPngChunk('tEXt', dataBytes);
}

function insertChunkBeforeIend(pngBytes: Uint8Array, chunkBytes: Uint8Array): Uint8Array {
  if (!isPngBytes(pngBytes)) {
    throw new Error('无效的 PNG 文件头。');
  }

  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= pngBytes.length) {
    const dataLength = readUint32(pngBytes, offset);
    const type = bytesToAsciiString(pngBytes.subarray(offset + 4, offset + 8));
    const nextOffset = offset + 12 + dataLength;
    if (nextOffset > pngBytes.length) {
      throw new Error('PNG 数据不完整。');
    }
    if (type === 'IEND') {
      return concatUint8Arrays(
        pngBytes.subarray(0, offset),
        chunkBytes,
        pngBytes.subarray(offset),
      );
    }
    offset = nextOffset;
  }

  throw new Error('PNG 中缺少 IEND 结束块。');
}

async function readInputBytes(input: Uint8Array | ArrayBuffer | Blob): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (input && typeof (input as Blob).arrayBuffer === 'function') {
    return new Uint8Array(await (input as Blob).arrayBuffer());
  }
  throw new Error('不支持的 PNG 输入类型。');
}

// ─── Canvas 渲染辅助 ───

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  const safeR = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeR, y);
  ctx.arcTo(x + w, y, x + w, y + h, safeR);
  ctx.arcTo(x + w, y + h, x, y + h, safeR);
  ctx.arcTo(x, y + h, x, y, safeR);
  ctx.arcTo(x, y, x + w, y, safeR);
  ctx.closePath();
}

function fillRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number, fillStyle: string,
): void {
  ctx.save();
  drawRoundedRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = fillStyle;
  ctx.fill();
  ctx.restore();
}

function strokeRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number, strokeStyle: string, lineWidth = 1,
): void {
  ctx.save();
  drawRoundedRectPath(ctx, x, y, w, h, r);
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.restore();
}

function splitTextIntoLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines = 4): string[] {
  const normalized = clampText(text, '').replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const chars = Array.from(normalized);
  const lines: string[] = [];
  let currentLine = '';

  for (const char of chars) {
    const nextLine = currentLine + char;
    if (ctx.measureText(nextLine).width <= maxWidth || !currentLine) {
      currentLine = nextLine;
    } else {
      lines.push(currentLine);
      currentLine = char;
    }
  }
  if (currentLine) lines.push(currentLine);

  if (lines.length <= maxLines) return lines;

  const truncated = lines.slice(0, maxLines);
  let lastLine = truncated[maxLines - 1];
  while (lastLine.length > 1 && ctx.measureText(`${lastLine}…`).width > maxWidth) {
    lastLine = lastLine.slice(0, -1);
  }
  truncated[maxLines - 1] = `${lastLine}…`;
  return truncated;
}

function formatDateTime(value: unknown): string {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '未记录';
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

interface MemoryPackMeta {
  title?: string;
  description?: string;
  saveName?: string;
  exportedAt?: number;
  accent?: string;
}

interface MemoryPack {
  meta?: MemoryPackMeta;
  runtime?: {
    memoryRuntime?: Record<string, unknown>;
    vectorMemory?: unknown[];
  };
}

function collectSummaryItems(memoryPack: MemoryPack): Array<{ label: string; value: string }> {
  const runtime = memoryPack?.runtime && typeof memoryPack.runtime === 'object' ? memoryPack.runtime : {};
  const mr = runtime.memoryRuntime && typeof runtime.memoryRuntime === 'object'
    ? runtime.memoryRuntime as Record<string, unknown>
    : {};

  const sceneCount = mr.sceneAnchor ? 1 : 0;
  const threadCount = numberOrZero((mr.activeThreads as unknown[])?.length);
  const stateCount = numberOrZero((mr.stateSlots as unknown[])?.length);
  const relationCount = numberOrZero((mr.relationEdges as unknown[])?.length);
  const eventCount = numberOrZero((mr.eventCards as unknown[])?.length);
  const entityCount = numberOrZero((mr.entityCards as unknown[])?.length);
  const archiveCount = numberOrZero((mr.archiveCards as unknown[])?.length);
  const vectorCount = numberOrZero(runtime.vectorMemory?.length);
  const summaryCount = numberOrZero((mr.summarySaveHistory as unknown[])?.length);
  const logCount = numberOrZero((mr.writeDebugLogs as unknown[])?.length)
    + numberOrZero((mr.retrieveDebugLogs as unknown[])?.length)
    + numberOrZero((mr.compileDebugLogs as unknown[])?.length);

  return [
    { label: '场景', value: String(sceneCount) },
    { label: '线程', value: String(threadCount) },
    { label: '状态', value: String(stateCount) },
    { label: '关系', value: String(relationCount) },
    { label: '事件', value: String(eventCount) },
    { label: '实体', value: String(entityCount) },
    { label: '归档', value: String(archiveCount) },
    { label: '向量', value: String(vectorCount) },
    { label: '摘要', value: String(summaryCount) },
    { label: '日志', value: String(logCount) },
  ];
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('生成 PNG 文件失败。'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });
}

async function renderPosterBlob(memoryPack: MemoryPack): Promise<Blob> {
  const contentW = 1132;
  const contentH = 572;
  const canvas = document.createElement('canvas');
  canvas.width = contentW;
  canvas.height = contentH;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('浏览器当前无法创建导出画布。');
  }

  const title = clampText(memoryPack?.meta?.title, '记忆运行态');
  const subtitle = 'MEMORY DATA PNG';
  const description = clampText(
    memoryPack?.meta?.description,
    '这个 PNG 文件中嵌入了当前存档的完整记忆运行态、向量事实、摘要历史与调试日志，可在记忆系统中重新导入恢复。',
  );
  const saveName = clampText(memoryPack?.meta?.saveName, '当前存档');
  const exportedAt = formatDateTime(memoryPack?.meta?.exportedAt);
  const accent = clampText(memoryPack?.meta?.accent, DEFAULT_ACCENT);
  const summaryItems = collectSummaryItems(memoryPack);

  // 绘制背景
  ctx.save();
  drawRoundedRectPath(ctx, 0, 0, contentW, contentH, 32);
  ctx.clip();

  const gradient = ctx.createLinearGradient(0, 0, contentW, contentH);
  gradient.addColorStop(0, '#141822');
  gradient.addColorStop(0.46, '#232131');
  gradient.addColorStop(1, accent);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, contentW, contentH);

  const overlay = ctx.createLinearGradient(0, 0, 0, contentH);
  overlay.addColorStop(0, 'rgba(10, 12, 18, 0.18)');
  overlay.addColorStop(0.55, 'rgba(10, 12, 18, 0.38)');
  overlay.addColorStop(1, 'rgba(10, 12, 18, 0.84)');
  ctx.fillStyle = overlay;
  ctx.fillRect(0, 0, contentW, contentH);

  // 装饰圆
  ctx.save();
  ctx.globalAlpha = 0.18;
  for (let i = 0; i < 10; i += 1) {
    ctx.beginPath();
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.14)' : 'rgba(240,216,154,0.11)';
    ctx.arc(66 + i * 118, 36 + (i % 4) * 150, 96 + (i % 5) * 16, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.fillStyle = 'rgba(16, 18, 28, 0.54)';
  ctx.fillRect(0, 0, contentW, contentH);
  ctx.restore();

  strokeRoundedRect(ctx, 0, 0, contentW, contentH, 32, 'rgba(240, 216, 154, 0.22)', 1.5);

  // 标签
  fillRoundedRect(ctx, 26, 34, 224, 42, 21, 'rgba(18, 22, 34, 0.72)');
  strokeRoundedRect(ctx, 26, 34, 224, 42, 21, 'rgba(240, 216, 154, 0.28)', 1);
  ctx.fillStyle = '#f0d89a';
  ctx.font = '600 18px "Microsoft YaHei", sans-serif';
  ctx.fillText('MEMORY DATA PNG', 54, 62);

  // 标题
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 60px "Microsoft YaHei", sans-serif';
  const titleLines = splitTextIntoLines(ctx, title, 660, 3);
  titleLines.forEach((line, index) => {
    ctx.fillText(line, 28, 154 + index * 72);
  });

  const subtitleY = 154 + Math.max(titleLines.length - 1, 0) * 72 + 36;
  ctx.fillStyle = '#f0d89a';
  ctx.font = '600 19px "Microsoft YaHei", sans-serif';
  ctx.fillText(subtitle, 30, subtitleY);

  fillRoundedRect(ctx, 26, subtitleY + 24, 302, 42, 21, 'rgba(255,255,255,0.06)');
  strokeRoundedRect(ctx, 26, subtitleY + 24, 302, 42, 21, 'rgba(255,255,255,0.14)', 1);
  ctx.fillStyle = '#ffffff';
  ctx.font = '500 17px "Microsoft YaHei", sans-serif';
  ctx.fillText(`存档  ${saveName}`, 48, subtitleY + 51);

  fillRoundedRect(ctx, 344, subtitleY + 24, 430, 42, 21, 'rgba(212,168,83,0.12)');
  strokeRoundedRect(ctx, 344, subtitleY + 24, 430, 42, 21, 'rgba(212,168,83,0.28)', 1);
  ctx.fillText(`导出时间  ${exportedAt}`, 366, subtitleY + 51);

  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.font = '400 22px "Microsoft YaHei", sans-serif';
  const descLines = splitTextIntoLines(ctx, description, 734, 4);
  descLines.forEach((line, index) => {
    ctx.fillText(line, 30, subtitleY + 128 + index * 34);
  });

  // 右侧面板
  fillRoundedRect(ctx, 788, 32, 306, 460, 26, 'rgba(255,255,255,0.05)');
  strokeRoundedRect(ctx, 788, 32, 306, 460, 26, 'rgba(255,255,255,0.14)', 1);

  fillRoundedRect(ctx, 812, 58, 124, 34, 17, 'rgba(12,16,28,0.45)');
  strokeRoundedRect(ctx, 812, 58, 124, 34, 17, 'rgba(240,216,154,0.24)', 1);
  ctx.fillStyle = '#f0d89a';
  ctx.font = '600 14px "Microsoft YaHei", sans-serif';
  ctx.fillText('运行态记忆包', 842, 80);

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 32px "Microsoft YaHei", sans-serif';
  ctx.fillText('当前记忆概览', 814, 140);

  const saveNameLines = splitTextIntoLines(ctx, `存档：${saveName}`, 236, 3);
  ctx.fillStyle = 'rgba(255,255,255,0.74)';
  ctx.font = '400 16px "Microsoft YaHei", sans-serif';
  saveNameLines.forEach((line, index) => {
    ctx.fillText(line, 814, 178 + index * 24);
  });

  let chipX = 814;
  let chipY = 244;
  for (const item of summaryItems) {
    const chipText = `${clampText(item.label, '字段')} · ${clampText(item.value, '0')}`;
    ctx.font = '500 17px "Microsoft YaHei", sans-serif';
    const chipWidth = Math.max(102, ctx.measureText(chipText).width + 32);
    if (chipX + chipWidth > 1064) {
      chipX = 814;
      chipY += 54;
    }

    fillRoundedRect(ctx, chipX, chipY, chipWidth, 38, 19, 'rgba(18,22,34,0.66)');
    strokeRoundedRect(ctx, chipX, chipY, chipWidth, 38, 19, 'rgba(240,216,154,0.22)', 1);
    ctx.fillStyle = '#f5e3b0';
    ctx.fillText(chipText, chipX + 16, chipY + 25);
    chipX += chipWidth + 10;
  }

  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.font = '400 15px "Microsoft YaHei", sans-serif';
  ctx.fillText('该 PNG 内嵌完整记忆运行态，可直接在记忆系统设置页再次导入。', 28, 536);

  return await canvasToPngBlob(canvas);
}

// ─── 公开 API ───

export async function createMemoryDataPngBlob(memoryPack: MemoryPack): Promise<Blob> {
  if (!memoryPack || typeof memoryPack !== 'object') {
    throw new Error('缺少可写入 PNG 的记忆包数据。');
  }

  const posterBlob = await renderPosterBlob(memoryPack);
  const posterBytes = new Uint8Array(await posterBlob.arrayBuffer());
  const payloadText = utf8ToBase64(JSON.stringify(memoryPack));
  const chunkBytes = createTextChunk(MEMORY_PNG_TEXT_KEY, payloadText);
  const mergedBytes = insertChunkBeforeIend(posterBytes, chunkBytes);
  return new Blob([mergedBytes as BlobPart], { type: 'image/png' });
}

export async function extractMemoryPackFromPng(input: Uint8Array | ArrayBuffer | Blob): Promise<MemoryPack> {
  const pngBytes = await readInputBytes(input);
  if (!isPngBytes(pngBytes)) {
    throw new Error('文件不是有效的 PNG 格式。');
  }

  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= pngBytes.length) {
    const dataLength = readUint32(pngBytes, offset);
    const type = bytesToAsciiString(pngBytes.subarray(offset + 4, offset + 8));
    const dataStart = offset + 8;
    const dataEnd = dataStart + dataLength;
    const nextOffset = dataEnd + 4;

    if (nextOffset > pngBytes.length) {
      throw new Error('PNG 数据块结构损坏。');
    }

    if (type === 'tEXt') {
      const chunkData = pngBytes.subarray(dataStart, dataEnd);
      const separatorIndex = chunkData.indexOf(0);
      if (separatorIndex > 0) {
        const keyword = bytesToAsciiString(chunkData.subarray(0, separatorIndex));
        if (keyword === MEMORY_PNG_TEXT_KEY) {
          const payloadBase64 = bytesToAsciiString(chunkData.subarray(separatorIndex + 1));
          const jsonText = base64ToUtf8(payloadBase64);
          const parsed = JSON.parse(jsonText) as MemoryPack;
          if (!parsed || typeof parsed !== 'object') {
            throw new Error('PNG 中的记忆包数据不是有效对象。');
          }
          return parsed;
        }
      }
    }

    if (type === 'IEND') break;
    offset = nextOffset;
  }

  throw new Error('未在 PNG 中找到可导入的记忆包数据。');
}

export function isMemoryPngFile(file: File): boolean {
  const fileName = clampText(file?.name, '').toLowerCase();
  return file?.type === 'image/png' || fileName.endsWith('.png');
}

export function getMemoryExportFileName(baseName = 'memory_runtime', extension = 'json'): string {
  const safeName = clampText(baseName, 'memory_runtime').replace(/[\\/:*?"<>|]/g, '_');
  const normalizedExtension = clampText(extension, 'json').replace(/^\./, '');
  return `${safeName}.${normalizedExtension}`;
}

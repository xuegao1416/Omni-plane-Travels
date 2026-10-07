/** The ZIP container is independent from the save envelope's JSON protocol version. */
export const SAVE_FILE_EXTENSION = '.save.zip';
export const SAVE_FILE_ACCEPT = '.json,.zip,application/json,application/zip';
const ENTRY_NAME = 'save.json';
const ASSET_MANIFEST = 'assets/manifest.json';

/** Keep exportSave's JSON contract intact for cloud saves and other consumers. */
export async function encodeSaveFile(json: Blob): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const inputBytes = await json.arrayBuffer();
  let input: { save?: { assets?: unknown } };
  try { input = JSON.parse(new TextDecoder().decode(inputBytes).replace(/^\uFEFF/, '')); } catch { throw new Error('存档 JSON 无法解析，无法生成完整备份。'); }
  if (input?.save?.assets !== undefined) {
    const { decodePortableAssets } = await import('./saveAssets');
    const records = decodePortableAssets(input.save.assets);
    const manifest = { version: 1, assets: [] as Array<Record<string, unknown>> };
    for (const [index, record] of records.entries()) {
      const path = `assets/blobs/${index}.bin`, { blob, ...metadata } = record;
      zip.file(path, await blob.arrayBuffer()); manifest.assets.push({ ...metadata, path });
    }
    delete input.save.assets;
    zip.file(ENTRY_NAME, JSON.stringify(input)); zip.file(ASSET_MANIFEST, JSON.stringify(manifest));
  } else zip.file(ENTRY_NAME, inputBytes);
  const bytes = await zip.generateAsync({
    type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 },
  });
  return new Blob([new Uint8Array(bytes)], { type: 'application/zip' });
}

/** Detect bytes, not extensions: old JSON and compressed saves share one import path. */
export async function decodeSaveFile(file: Blob): Promise<unknown> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b
    && ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06));
  let json: string;
  let zipAssets: Array<Record<string, unknown>> | undefined;
  if (isZip) {
    const { default: JSZip } = await import('jszip');
    let zip;
    try {
      zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
    } catch {
      throw new Error('压缩存档已损坏，无法解压。请重新导出或使用完整备份。');
    }
    const entry = zip.file(ENTRY_NAME);
    if (!entry) throw new Error('此 ZIP 不是 App 导出的压缩存档：缺少 save.json。交付包请先解压，再选择其中的存档 JSON。');
    try {
      json = await entry.async('string');
    } catch {
      throw new Error('压缩存档已损坏，无法读取 save.json。');
    }
    const manifestEntry = zip.file(ASSET_MANIFEST);
    if (manifestEntry) {
      try {
        const manifest = JSON.parse(await manifestEntry.async('string'));
        if (manifest?.version !== 1 || !Array.isArray(manifest.assets)) throw new Error('图片清单版本或格式无效');
        const paths = new Set<string>(); zipAssets = [];
        for (const value of manifest.assets) {
          if (!value || typeof value !== 'object' || typeof value.path !== 'string' || !/^assets\/blobs\/\d+\.bin$/.test(value.path)
            || paths.has(value.path) || typeof value.mimeType !== 'string' || 'blob' in value || 'base64' in value) throw new Error('图片清单资源路径无效');
          paths.add(value.path);
          const assetEntry = zip.file(value.path); if (!assetEntry) throw new Error(`图片 ${value.key ?? value.path} 文件缺失`);
          const { path: _, ...metadata } = value;
          zipAssets.push({ ...metadata, blob: new Blob([new Uint8Array(await assetEntry.async('uint8array'))], { type: value.mimeType }) });
        }
        const { decodePortableAssets } = await import('./saveAssets'); decodePortableAssets(zipAssets);
      } catch (error) { throw new Error(`压缩存档图片备份损坏，未导入：${error instanceof Error ? error.message : String(error)}`); }
    }
  } else {
    json = new TextDecoder().decode(bytes);
  }
  let input;
  try {
    input = JSON.parse(json.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('存档 JSON 无法解析，请选择完整的存档文件。');
  }
  if (zipAssets) {
    if (!input?.save || typeof input.save !== 'object' || Array.isArray(input.save) || input.save.assets !== undefined) throw new Error('图片备份存在重复或无效清单，未导入。');
    input.save.assets = zipAssets;
  }
  return input;
}

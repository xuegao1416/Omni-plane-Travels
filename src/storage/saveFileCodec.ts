/** The ZIP container is independent from the save envelope's JSON protocol version. */
export const SAVE_FILE_EXTENSION = '.save.zip';
export const SAVE_FILE_ACCEPT = '.json,.zip,application/json,application/zip';
const ENTRY_NAME = 'save.json';

/** Keep exportSave's JSON contract intact for cloud saves and other consumers. */
export async function encodeSaveFile(json: Blob): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file(ENTRY_NAME, await json.arrayBuffer());
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
  } else {
    json = new TextDecoder().decode(bytes);
  }
  try {
    return JSON.parse(json.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('存档 JSON 无法解析，请选择完整的存档文件。');
  }
}

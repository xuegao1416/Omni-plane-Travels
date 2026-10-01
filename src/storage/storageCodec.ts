import JSZip from 'jszip';

/** Internal-only lossless JSON envelope. External save exports remain canonical JSON. */
export interface StorageEncoding {
  version: 1;
  type: 'zip-json';
  data: Uint8Array;
}

export async function encodeStorageValue(value: unknown): Promise<StorageEncoding | undefined> {
  const json = JSON.stringify(value);
  if (json === undefined || json.length < 4096) return undefined;
  const zip = new JSZip();
  zip.file('value.json', json);
  const data = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  if (data.byteLength >= new TextEncoder().encode(json).byteLength) return undefined;
  return { version: 1, type: 'zip-json', data };
}

export async function decodeStorageValue(encoded: StorageEncoding): Promise<unknown> {
  if (!encoded || encoded.version !== 1 || encoded.type !== 'zip-json' || !(encoded.data instanceof Uint8Array)) {
    throw new Error('不支持的存储压缩格式');
  }
  const zip = await JSZip.loadAsync(encoded.data, { checkCRC32: true });
  const entry = zip.file('value.json');
  if (!entry || Object.keys(zip.files).length !== 1) throw new Error('存储压缩数据损坏');
  return JSON.parse(await entry.async('string'));
}

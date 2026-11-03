// 设备绑定的 API Key 加密存储
//
// 降低静态存储暴露；不防御能够调用同源保险库的脚本。
//
// 方案：
// - 用 Web Crypto 生成 non-extractable 的 AES-GCM 256 密钥，持久化在 IndexedDB（IndexedDB 支持结构化克隆 CryptoKey）。
// - 加密 apiKey 得到 `enc:v1:<base64(iv|cipher)>` 后落库；读取时解密到内存（内存中保持明文供请求使用）。
// - 密钥不可导出（extractable:false）；同源脚本仍可调用 decrypt，因此这不是同源脚本隔离边界。
// - 密钥按源（origin）独立生成；Tauri webview / 浏览器 / 不同源各自一套。

import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'omni-plane-travels-keyvault';
const STORE_NAME = 'keys';
const KEY_ID = 'api-encryption-key';

export const ENC_PREFIX = 'enc:v1:';
const IV_LENGTH = 12;

let dbPromise: Promise<IDBPDatabase> | null = null;
let keyPromise: Promise<CryptoKey> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      },
    }).catch(error => { dbPromise = null; throw error; });
  }
  return dbPromise;
}

async function loadOrCreateKey(): Promise<CryptoKey> {
  if (keyPromise) return keyPromise;
  keyPromise = (async () => {
    const db = await getDB();
    const record = await db.get(STORE_NAME, KEY_ID);
    if (record && record.key) {
      return record.key as CryptoKey;
    }
    // 生成不可导出的 AES-GCM 256 密钥，避免直接导出原始密钥字节。
    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    await db.put(STORE_NAME, { id: KEY_ID, key });
    return key;
  })();
  return keyPromise;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 判断值是否已是本保险库密文 */
export function isSealed(value: string | undefined | null): boolean {
  return !!value && value.startsWith(ENC_PREFIX);
}

/**
 * 加密明文，返回 `enc:v1:<base64(iv|cipher)>`。
 * - 空字符串原样返回。
 * - 已是密文则原样返回。
 * - Web Crypto 不可用时（非安全上下文）回退明文并告警，避免阻断保存流程。
 */
export type SealResult = { status: 'empty' | 'encrypted'; value: string } | { status: 'degraded'; value: string; warning: string } | { status: 'error'; message: string };
export type UnsealResult = { status: 'empty' | 'plaintext' | 'ok'; value: string } | { status: 'error'; message: string };

export async function sealResult(plaintext: string): Promise<SealResult> {
  if (!plaintext) return { status: 'empty', value: '' };
  if (isSealed(plaintext)) return { status: 'encrypted', value: plaintext };
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    return { status: 'degraded', value: plaintext, warning: '当前环境不支持 Web Crypto，密钥以明文保存；请使用 HTTPS 或 localhost。' };
  }
  try {
    const key = await loadOrCreateKey();
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const data = new TextEncoder().encode(plaintext);
    const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
    const cipher = new Uint8Array(cipherBuf);
    const combined = new Uint8Array(iv.length + cipher.length);
    combined.set(iv, 0);
    combined.set(cipher, iv.length);
    return { status: 'encrypted', value: ENC_PREFIX + bytesToBase64(combined) };
  } catch (err) {
    keyPromise = null;
    return { status: 'error', message: '密钥加密失败，未保存。请检查此设备的本地存储权限。' };
  }
}

/**
 * 解密密文。非密文（遗留明文）原样返回。
 * 解密失败（如密钥丢失）返回明确 error，绝不把错误伪装成空密钥。
 */
export async function unsealResult(sealed: string): Promise<UnsealResult> {
  if (!sealed) return { status: 'empty', value: '' };
  if (!isSealed(sealed)) return { status: 'plaintext', value: sealed };
  try {
    const key = await loadOrCreateKey();
    const combined = base64ToBytes(sealed.slice(ENC_PREFIX.length));
    const iv = combined.slice(0, IV_LENGTH);
    const cipher = combined.slice(IV_LENGTH);
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
    return { status: 'ok', value: new TextDecoder().decode(plainBuf) };
  } catch (err) {
    keyPromise = null;
    return { status: 'error', message: '无法解密此设备的连接密钥，原记录已保留。请恢复原设备/来源的密钥保险库后重试。' };
  }
}

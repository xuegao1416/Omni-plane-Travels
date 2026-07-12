// 设备绑定的 API Key 加密存储
//
// 安全目标（L-01）：localStorage / Tauri store 中只存密文，同源脚本无法直接读出明文 Key。
//
// 方案：
// - 用 Web Crypto 生成 non-extractable 的 AES-GCM 256 密钥，持久化在 IndexedDB（IndexedDB 支持结构化克隆 CryptoKey）。
// - 加密 apiKey 得到 `enc:v1:<base64(iv|cipher)>` 后落库；读取时解密到内存（内存中保持明文供请求使用）。
// - 密钥不可导出（extractable:false），即便同源脚本读取到 localStorage 密文，无密钥也无法解密。
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
    });
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
    // 生成 non-extractable 的 AES-GCM 256 密钥（关键：不可导出，同源脚本无法 extract）
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
export async function seal(plaintext: string): Promise<string> {
  if (!plaintext) return plaintext;
  if (isSealed(plaintext)) return plaintext;
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    console.warn('[keyVault] Web Crypto 不可用，API Key 将以明文存储（不安全，请使用 https 或 localhost）');
    return plaintext;
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
    return ENC_PREFIX + bytesToBase64(combined);
  } catch (err) {
    console.warn('[keyVault] 加密失败，回退明文存储:', err);
    return plaintext;
  }
}

/**
 * 解密密文。非密文（遗留明文）原样返回。
 * 解密失败（如密钥丢失）返回空字符串，避免泄露异常信息。
 */
export async function unseal(sealed: string): Promise<string> {
  if (!sealed) return sealed;
  if (!isSealed(sealed)) return sealed;
  try {
    const key = await loadOrCreateKey();
    const combined = base64ToBytes(sealed.slice(ENC_PREFIX.length));
    const iv = combined.slice(0, IV_LENGTH);
    const cipher = combined.slice(IV_LENGTH);
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
    return new TextDecoder().decode(plainBuf);
  } catch (err) {
    console.warn('[keyVault] 解密失败，返回空字符串（密钥可能已丢失）:', err);
    return '';
  }
}

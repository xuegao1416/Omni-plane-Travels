/**
 * crypto.ts — 纯 Web Crypto 实现的工具：base64url、随机字节、SHA-256、HMAC。
 * 不依赖任何外部库，兼容 Cloudflare Workers / Pages Functions 运行时。
 */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function b64Lookup(ch: string): number {
  return B64.indexOf(ch);
}

/** 字节数组 -> 标准 base64 字符串（无填充处理，调用方自行替换）。 */
function bytesToB64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const e0 = b0 >> 2;
    const e1 = ((b0 & 3) << 4) | (b1 >> 4);
    const e2 = ((b1 & 15) << 2) | (b2 >> 6);
    const e3 = b2 & 63;
    out += B64[e0] + B64[e1];
    if (i + 1 < bytes.length) out += B64[e2];
    if (i + 2 < bytes.length) out += B64[e3];
  }
  return out;
}

/** 字节数组 -> base64url（RFC 4648 §5，无 padding）。 */
export function bytesToB64url(bytes: Uint8Array): string {
  return bytesToB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url -> 字节数组。 */
export function b64urlToBytes(s: string): Uint8Array {
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const len = Math.floor((b64.length * 3) / 4);
  const out = new Uint8Array(len);
  let p = 0;
  for (let i = 0; i < b64.length; i += 4) {
    const c0 = b64Lookup(b64[i]);
    const c1 = b64Lookup(b64[i + 1]);
    const c2 = b64Lookup(b64[i + 2]);
    const c3 = b64Lookup(b64[i + 3]);
    const n = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    if (p < out.length) out[p++] = (n >> 16) & 255;
    if (p < out.length) out[p++] = (n >> 8) & 255;
    if (p < out.length) out[p++] = n & 255;
  }
  return out;
}

/** 字符串 -> base64url。 */
export function strToB64url(s: string): string {
  return bytesToB64url(new TextEncoder().encode(s));
}

/** 生成 n 字节的密码学安全随机值。 */
export function randomBytes(n: number): Uint8Array {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}

/** 生成 base64url 编码的随机令牌（默认 32 字节）。 */
export function randomToken(n = 32): string {
  return bytesToB64url(randomBytes(n));
}

/** SHA-256，返回十六进制字符串。 */
export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256，返回 base64url 字符串（用于 PKCE code_challenge）。 */
export async function sha256B64url(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return bytesToB64url(new Uint8Array(buf));
}

/** HMAC-SHA-256，返回字节数组。 */
export async function hmacSha256(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
}

/** 恒定时间字符串比较，避免时序侧信道。 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

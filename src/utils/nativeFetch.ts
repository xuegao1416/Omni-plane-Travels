/**
 * Tauri 原生 HTTP Helper
 *
 * 用途：在 Tauri 桌面端绕过 WebView 的 CORS 限制，使用原生 HTTP 客户端发起请求。
 *
 * 背景：
 *   - Tauri WebView 中直接 fetch 外部 API 会因 CORS 失败
 *   - tauri-plugin-http 提供原生 HTTP 能力，绕过浏览器限制
 *
 * 设计：
 *   - 仅用于「无需流式」的请求（模型列表、测试连接、embedding、非流式聊天等）
 *   - 自动检测平台，非 Tauri 时退回普通 fetch（保持浏览器端一致行为）
 *   - 返回标准 Response 对象，调用侧无感知
 *
 * 安全：
 *   - 绝不使用第三方 CORS 代理，避免泄露玩家 API Key
 */

let isTauriEnv: boolean | null = null;

/** 是否运行在 Tauri 环境 */
export function isTauri(): boolean {
  if (isTauriEnv !== null) return isTauriEnv;
  try {
    isTauriEnv = Boolean(
      typeof window !== 'undefined' &&
      (window as any).__TAURI_INTERNALS__
    );
  } catch {
    isTauriEnv = false;
  }
  return isTauriEnv;
}

/**
 * 原生 fetch：在 Tauri 环境下使用 tauri-plugin-http 绕过 CORS；
 * 其他环境退回标准 fetch。
 */
export async function nativeFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!isTauri()) {
    return fetch(url, init);
  }

  let tauriFetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  try {
    ({ fetch: tauriFetch } = await import('@tauri-apps/plugin-http'));
  } catch (err) {
    // 只有模块本身取不到才算插件不可用；此时降级后的请求仍受 WebView CORS 限制。
    console.warn('[nativeFetch] Tauri HTTP 插件不可用，降级为普通 fetch:', err);
    return fetch(url, init);
  }

  try {
    return await tauriFetch(url, init);
  } catch (err) {
    // 请求被拒与网络故障要分开报：scope 未放行时提示去查 capabilities，
    // 否则容易被误读成插件没装而掩盖真实原因。
    const text = err instanceof Error ? err.message : String(err);
    const denied = /url not allowed|not allowed on the configured scope|scope|permission/i.test(text);
    console.warn(
      denied
        ? '[nativeFetch] 请求被 http 插件的 scope 拒绝，降级为普通 fetch：请检查 capabilities 中 http:default 的 allow 列表'
        : '[nativeFetch] 原生请求失败，降级为普通 fetch',
      err,
    );
    return fetch(url, init);
  }
}

export default nativeFetch;

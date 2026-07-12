import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')!).render(<App />);

// PWA Service Worker 注册（L-18）
// - 仅标准浏览器环境注册，Tauri 桌面端（__TAURI_INTERNALS__）跳过，避免自定义协议异常
// - 仅生产构建注册，开发模式避免 SW 缓存干扰 HMR
// - sw.js 仅处理同源请求（network-first 导航 + cache-first 静态），不触及 Tauri/IPC
if (
  process.env.NODE_ENV === 'production' &&
  !('__TAURI_INTERNALS__' in window) &&
  'serviceWorker' in navigator
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[SW] 注册失败（不影响主流程）:', err);
    });
  });
}

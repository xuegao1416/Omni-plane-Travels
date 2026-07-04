import { useState, useCallback } from 'react';
import { HelpCircle } from 'lucide-react';
import { STORAGE_KEYS } from '@/config/storageKeys';
import ProxyTutorialOverlay from '../ProxyTutorialOverlay';
import { rowStyle } from './types';

export default function ProxySettings() {
  const [proxyUrl, setProxyUrl] = useState<string>(() => {
    try { return localStorage.getItem(STORAGE_KEYS.PROXY_URL) || ''; } catch { return ''; }
  });
  const [showTutorial, setShowTutorial] = useState(false);

  const handleChange = useCallback((url: string) => {
    setProxyUrl(url);
    try { localStorage.setItem(STORAGE_KEYS.PROXY_URL, url); } catch {}
  }, []);

  const handleApplyProxy = useCallback((url: string) => {
    setProxyUrl(url);
    try { localStorage.setItem(STORAGE_KEYS.PROXY_URL, url); } catch {}
  }, []);

  return (
    <>
      <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'stretch', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 'var(--font-size-md)', fontWeight: '500' }}>代理地址（可选）</div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: '2px' }}>
              解决网页端 CORS 跨域问题，桌面版无需设置
            </div>
          </div>
          <button
            onClick={() => setShowTutorial(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              background: 'rgba(99, 102, 241, 0.1)',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              borderRadius: '6px',
              color: '#818cf8',
              fontSize: 'var(--font-size-xs)',
              fontWeight: '500',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99, 102, 241, 0.2)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(99, 102, 241, 0.1)'; }}
          >
            <HelpCircle size={14} />
            如何部署？
          </button>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            className="input-field"
            value={proxyUrl}
            onChange={e => handleChange(e.target.value)}
            placeholder="https://你的worker名字.workers.dev"
            style={{ flex: 1, fontSize: 'var(--font-size-base)', padding: '5px 10px' }}
          />
        </div>
        {proxyUrl && (
          <div style={{
            fontSize: 'var(--font-size-xs)',
            color: 'var(--text-muted)',
            padding: '8px 10px',
            background: 'var(--bg-tertiary)',
            borderRadius: '6px',
          }}>
            ✅ 代理已启用：{proxyUrl}
          </div>
        )}
      </div>
      {showTutorial && (
        <ProxyTutorialOverlay
          onClose={() => setShowTutorial(false)}
          onApplyProxy={handleApplyProxy}
        />
      )}
    </>
  );
}

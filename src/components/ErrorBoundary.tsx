import { Component,type ReactNode,type ErrorInfo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { isQuotaExceededError,releaseRegenerableCache } from '../storage/safeStorage';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      // 配额耗尽不是"渲染坏了一次"，重新挂载组件无法修复：
      // 底层存储仍是满的，下一次写入会再次抛错。这里必须给出可执行的动作。
      if (isQuotaExceededError(this.state.error)) {
        return (
          <div
            className="full-height"
            style={{
              padding: '2rem',
              color: 'var(--text-primary)',
              background: 'var(--bg-primary)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              gap: '0.75rem',
            }}
          >
            <AlertTriangle size={28} style={{ color: 'var(--warning)' }} />
            <h2 style={{ margin: 0 }}>本地存储空间已满</h2>
            <p style={{ maxWidth: 520, color: 'var(--text-muted)', margin: 0, lineHeight: 1.7 }}>
              浏览器给本站划分的存储额度已经用完，新的数据写不进去。
              可以先清理缓存再试；如果仍然提示已满，请清理不再需要的存档或自建世界后重新打开本页。
            </p>
            <button
              onClick={() => {
                releaseRegenerableCache();
                this.setState({ hasError: false, error: null });
              }}
              style={{
                marginTop: '0.5rem',
                padding: '0.5rem 1.5rem',
                background: 'var(--accent)',
                color: 'var(--color-on-accent)',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              清理缓存并重试
            </button>
          </div>
        );
      }
      return (
        <div
          className="full-height"
          style={{
            padding: '2rem',
            color: 'var(--danger)',
            background: 'var(--bg-primary)',
            fontFamily: 'monospace',
          }}
        >
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><AlertTriangle size={20} /> 渲染出错</h2>
          <pre style={{
            whiteSpace: 'pre-wrap',
            background: 'var(--bg-deep)',
            padding: '1rem',
            borderRadius: '8px',
            fontSize: 'var(--font-size-md)',
            overflow: 'auto',
            maxHeight: '60vh',
          }}>
            {this.state.error?.message}
            {process.env.NODE_ENV !== 'production' && this.state.error?.stack && (
              <>{'\n\n'}{this.state.error.stack}</>
            )}
          </pre>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); }}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1.5rem',
              background: 'var(--accent)',
              color: 'var(--color-on-accent)',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

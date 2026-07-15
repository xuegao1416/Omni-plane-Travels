import { Component, type ReactNode, type ErrorInfo } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
  onBack: () => void;
}
interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * 事件子树局部错误边界（P0-3 下沉）。
 * 与全局 ErrorBoundary 不同：捕获错误后**显示错误文案**并给出「返回事件中心」，
 * 而非静默整屏白屏——损坏数据导致的渲染失败对用户可见且可恢复。
 */
export default class EventErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // 上报到控制台（开发期可见），同时保留组件栈用于定位
    console.error('[EventErrorBoundary]', error, info.componentStack);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-8)',
            textAlign: 'center',
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 'var(--radius-lg)',
              background: 'var(--danger-bg-soft)',
              color: 'var(--danger)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <AlertTriangle size={26} />
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-lg)', fontWeight: 600 }}>
            该面板渲染出错
          </div>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              maxWidth: 520,
              background: 'var(--bg-deep)',
              color: 'var(--danger)',
              padding: 'var(--space-3)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--font-size-sm)',
              overflow: 'auto',
              maxHeight: '40vh',
            }}
          >
            {this.state.error?.message}
          </pre>
          <button
            className="btn-primary btn-sm"
            onClick={() => this.props.onBack()}
          >
            返回事件中心
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

import type { ApiConfig } from '../../../api/types';
import { Toggle } from '../SettingsUIComponents';
import { rowStyle,REASONING_OPTIONS,warningStyle } from './types';

interface Props {
  config: ApiConfig;
  set: <K extends keyof ApiConfig>(key: K, val: ApiConfig[K]) => void;
}

export default function AdvancedSettings({ config, set }: Props) {
  const defaultTimeoutSeconds = config.provider === 'deepseek' ? 300 : 120;
  const timeoutSeconds = Math.max(1, Math.round((config.requestTimeoutMs ?? defaultTimeoutSeconds * 1000) / 1000));
  return (
    <>
      <div className="settings-api-section-title">
        高级参数
      </div>

      {/* 流式响应 - 强烈建议关闭（开启会导致各种奇怪显示问题）*/}
      <div style={warningStyle}>
        <strong>强烈建议关闭流式响应。</strong>
        开启会导致行动选项错位、正文截断、思考块残留、变量刷新异常等显示问题。
        如果遇到正文末尾被截断、行动选项出不来等异常，请先检查此项是否已关闭。
      </div>
      <div style={rowStyle}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 'var(--font-size-md)', fontWeight: '500' }}>流式响应</div>
        </div>
        <Toggle value={config.stream !== false} onChange={v => set('stream', v)} />
      </div>

      {/* 上下文大小 */}
      <div style={rowStyle}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 'var(--font-size-md)', fontWeight: '500' }}>上下文大小 (Context Size)</div>
        </div>
        <input
          type="number"
          value={config.contextSize ?? 2000000}
          onChange={e => set('contextSize', parseInt(e.target.value) || 0)}
          style={{ width: '110px', fontSize: 'var(--font-size-base)', padding: '5px 10px', textAlign: 'right', border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', outline: 'none' }}
        />
      </div>

      {/* 最大响应 */}
      <div style={rowStyle}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 'var(--font-size-md)', fontWeight: '500' }}>最大响应 (Response Tokens)</div>
        </div>
        <input
          type="number"
          value={config.maxTokens ?? 60000}
          onChange={e => set('maxTokens', parseInt(e.target.value) || 0)}
          style={{ width: '110px', fontSize: 'var(--font-size-base)', padding: '5px 10px', textAlign: 'right', border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', outline: 'none' }}
        />
      </div>

      {/* 随机性 */}
      <div style={rowStyle}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 'var(--font-size-md)', fontWeight: '500' }}>随机性 (Temperature)</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="range" min="0" max="2" step="0.05"
            value={config.temperature ?? 1.2}
            onChange={e => set('temperature', parseFloat(e.target.value))}
            style={{ width: '100px' }}
          />
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', width: '32px', textAlign: 'right' }}>
            {(config.temperature ?? 1.2).toFixed(2)}
          </span>
        </div>
      </div>

      {/* 核采样 */}
      <div style={rowStyle}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 'var(--font-size-md)', fontWeight: '500' }}>核采样 (Top P)</div>
        </div>
        <input
          type="number"
          step="0.01"
          value={config.topP ?? 0.65}
          onChange={e => set('topP', parseFloat(e.target.value) || 0)}
          style={{ width: '110px', fontSize: 'var(--font-size-base)', padding: '5px 10px', textAlign: 'right', border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', outline: 'none' }}
        />
      </div>

      {/* Top K */}
      <div style={rowStyle}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 'var(--font-size-md)', fontWeight: '500' }}>Top K</div>
        </div>
        <input
          type="number"
          value={config.topK ?? 45}
          onChange={e => set('topK', parseInt(e.target.value) || 0)}
          style={{ width: '110px', fontSize: 'var(--font-size-base)', padding: '5px 10px', textAlign: 'right', border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', outline: 'none' }}
        />
      </div>

      {/* 推理强度 */}
      <div style={rowStyle}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 'var(--font-size-md)', fontWeight: '500' }}>推理强度 (Reasoning Effort)</div>
        </div>
        <select
          value={config.reasoningEffort ?? '关闭'}
          onChange={e => set('reasoningEffort', e.target.value)}
          style={{
            padding: '5px 10px', border: '1px solid var(--border)', borderRadius: '6px',
            background: 'var(--bg-primary)', color: 'var(--text-primary)',
            fontSize: 'var(--font-size-base)', cursor: 'pointer', outline: 'none',
          }}
        >
          {REASONING_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      </div>

      {/* API 限流间隔 */}
      <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 'var(--font-size-md)', fontWeight: '500' }}>API 限流间隔</div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: '2px' }}>
              每次 API 调用之间的最小间隔，避免触发 429 限流错误
            </div>
          </div>
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--accent)', fontWeight: '600' }}>
            {config.rateLimitMs ?? 10000}ms
          </span>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="range"
            min="1000"
            max="30000"
            step="1000"
            value={config.rateLimitMs ?? 10000}
            onChange={e => set('rateLimitMs', parseInt(e.target.value))}
            style={{ flex: 1 }}
          />
          <button
            onClick={async () => {
              const { detectOptimalRateLimit } = await import('../../../api/rateLimiter');
              const { requestCompletion } = await import('../../../api/client');
              const testCall = async () => {
                await requestCompletion(
                  { ...config, provider: 'openai' },
                  [{ role: 'user', content: 'Hi' }],
                  { maxTokens: 5 }
                );
              };
              const recommended = await detectOptimalRateLimit(testCall);
              set('rateLimitMs', recommended);
            }}
            style={{
              padding: '5px 12px', fontSize: 'var(--font-size-sm)', whiteSpace: 'nowrap',
              border: '1px solid var(--accent)', borderRadius: '6px', cursor: 'pointer',
              background: 'var(--accent-dim)', color: 'var(--accent)',
            }}
          >
            自动调试
          </button>
        </div>
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {[1000, 2000, 5000, 10000, 15000, 20000].map(ms => (
            <button
              key={ms}
              onClick={() => set('rateLimitMs', ms)}
              style={{
                padding: '3px 10px', fontSize: 'var(--font-size-xs)',
                border: `1px solid ${(config.rateLimitMs ?? 10000) === ms ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: '12px', cursor: 'pointer',
                background: (config.rateLimitMs ?? 10000) === ms ? 'var(--accent-dim)' : 'var(--bg-primary)',
                color: (config.rateLimitMs ?? 10000) === ms ? 'var(--accent)' : 'var(--text-muted)',
              }}
            >
              {ms >= 1000 ? `${ms / 1000}s` : `${ms}ms`}
            </button>
          ))}
        </div>
      </div>

      {/* 请求超时 */}
      <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 'var(--font-size-md)', fontWeight: '500' }}>请求超时</div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: '2px' }}>
              单次模型请求的最长等待时间。共创、剧情整理等耗时较长的任务若超过该值会被判定为超时中断。
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input
              type="number"
              min={30}
              max={3600}
              step={30}
              value={timeoutSeconds}
              onChange={e => {
                const seconds = parseInt(e.target.value, 10);
                set('requestTimeoutMs', Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined);
              }}
              style={{ width: '100px', fontSize: 'var(--font-size-base)', padding: '5px 10px', textAlign: 'right', border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', outline: 'none' }}
            />
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>秒</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {[60, 120, 300, 600, 900].map(seconds => {
            const active = timeoutSeconds === seconds;
            return (
              <button
                key={seconds}
                onClick={() => set('requestTimeoutMs', seconds * 1000)}
                style={{
                  padding: '3px 10px', fontSize: 'var(--font-size-xs)',
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: '12px', cursor: 'pointer',
                  background: active ? 'var(--accent-dim)' : 'var(--bg-primary)',
                  color: active ? 'var(--accent)' : 'var(--text-muted)',
                }}
              >
                {seconds >= 60 ? `${seconds / 60} 分钟` : `${seconds} 秒`}
              </button>
            );
          })}
          <button
            onClick={() => set('requestTimeoutMs', undefined)}
            style={{
              padding: '3px 10px', fontSize: 'var(--font-size-xs)',
              border: `1px solid ${config.requestTimeoutMs === undefined ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: '12px', cursor: 'pointer',
              background: config.requestTimeoutMs === undefined ? 'var(--accent-dim)' : 'var(--bg-primary)',
              color: config.requestTimeoutMs === undefined ? 'var(--accent)' : 'var(--text-muted)',
            }}
          >
            按模型默认（{defaultTimeoutSeconds}s）
          </button>
        </div>
      </div>
    </>
  );
}

import { ExternalLink, Copy, Check, Lightbulb, CheckCircle, XCircle } from 'lucide-react';
import type { TutorialStep } from './data';
import { PROXY_CODE } from './constants';

export function StepContent({ step, copiedCode, onCopyCode }: {
  step: TutorialStep;
  copiedCode: boolean;
  onCopyCode: () => void;
}) {
  if (step.id === 'intro' && step.content) {
    return (
      <>
        {step.content.problem && (
          <div style={{ background: 'var(--danger-bg-soft)', border: '1px solid var(--danger-bg)', borderRadius: '8px', padding: '12px 14px' }}>
            <div style={{ fontWeight: '500', marginBottom: '6px', color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '8px' }}><XCircle size={14} /> 问题</div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>{step.content.problem}</div>
          </div>
        )}
        {step.content.solution && (
          <div style={{ background: 'var(--success-bg-soft)', border: '1px solid var(--success-bg)', borderRadius: '8px', padding: '12px 14px' }}>
            <div style={{ fontWeight: '500', marginBottom: '6px', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '8px' }}><CheckCircle size={14} /> 解决方案</div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>{step.content.solution}</div>
          </div>
        )}
        {step.content.diagram && (
          <div style={{ background: 'var(--bg-tertiary)', borderRadius: '8px', padding: '12px', fontFamily: 'monospace', fontSize: 'var(--font-size-sm)', overflow: 'auto', whiteSpace: 'pre', lineHeight: 1.4 }}>{step.content.diagram}</div>
        )}
        {step.content.safety && (
          <div style={{ background: 'rgba(99, 102, 241, 0.1)', border: '1px solid rgba(99, 102, 241, 0.2)', borderRadius: '8px', padding: '12px 14px', fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
            {step.content.safety.split('\n').map((item, i, arr) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: i < arr.length - 1 ? '6px' : 0 }}>
                <CheckCircle size={14} color="var(--success)" /><span>{item}</span>
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      {step.content.steps?.map((s, i) => (
        <div key={i} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
          <div style={{ width: '24px', height: '24px', borderRadius: 'var(--radius-md)', background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--font-size-xs)', fontWeight: '600', flexShrink: 0, marginTop: '2px' }}>{i + 1}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 'var(--font-size-sm)', lineHeight: 1.6 }}>
              {s.text}
              {s.link && <> {' '}<a href={s.link} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>打开链接 <ExternalLink size={12} /></a></>}
            </div>
            {s.tip && (
              <div style={{ marginTop: '6px', padding: '8px 10px', background: 'var(--warning-bg-soft)', border: '1px solid var(--warning-bg)', borderRadius: '6px', fontSize: 'var(--font-size-xs)', color: 'var(--warning)', whiteSpace: 'pre-line', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                <Lightbulb size={14} style={{ flexShrink: 0, marginTop: '2px' }} /><span>{s.tip}</span>
              </div>
            )}
            {s.example && (
              <div style={{ marginTop: '6px', padding: '8px 10px', background: 'var(--bg-tertiary)', borderRadius: '6px', fontSize: 'var(--font-size-xs)', fontFamily: 'monospace', color: 'var(--text-muted)' }}>{s.example}</div>
            )}
            {s.code && (
              <div style={{ marginTop: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: '8px 8px 0 0', border: '1px solid var(--border)', borderBottom: 'none' }}>
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>代理代码（点击复制）</span>
                  <button onClick={onCopyCode} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: copiedCode ? 'var(--success-bg)' : 'var(--accent)', border: 'none', borderRadius: '6px', color: copiedCode ? 'var(--success)' : '#fff', fontSize: 'var(--font-size-xs)', fontWeight: '500', cursor: 'pointer' }}>
                    {copiedCode ? <><Check size={14} /> 已复制！</> : <><Copy size={14} /> 复制代码</>}
                  </button>
                </div>
                <pre style={{ margin: 0, padding: '12px', background: '#1a1a2e', border: '1px solid var(--border)', borderRadius: '0 0 8px 8px', fontSize: 'var(--font-size-xs)', fontFamily: 'monospace', overflow: 'auto', maxHeight: '300px', lineHeight: 1.5, color: '#e8e6e3' }}><code>{PROXY_CODE}</code></pre>
              </div>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

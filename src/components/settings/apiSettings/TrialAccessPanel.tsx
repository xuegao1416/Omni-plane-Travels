import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { fetchTrialStatus, type TrialStatus } from '../../../api/trial';

interface Props { onSelect?: () => void }

/** API 设置页中的免费体验入口；状态失败不阻断 BYOK 配置。 */
export default function TrialAccessPanel({ onSelect }: Props) {
  const [status, setStatus] = useState<TrialStatus | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    fetchTrialStatus().then(value => { if (active) setStatus(value); }).catch(() => { /* 部署未配置时保持可见 */ }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const configured = status?.configured === true;
  const remaining = status?.remaining ?? 0;
  return (
    <section style={{ margin: '0 0 18px', padding: '14px 16px', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--bg-secondary)' }} aria-label="免费体验">
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}><Sparkles size={16} /> 免费体验</div>
      <p style={{ margin: '7px 0 10px', color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', lineHeight: 1.5 }}>
        {loading ? '正在查询体验额度…' : configured ? `无需填写 API Key，还可进行 ${remaining} 次主对话请求。` : '当前部署未配置免费体验服务，请使用下方自己的 API。'}
      </p>
      {configured && remaining > 0 && <button type="button" className="btn-secondary" onClick={onSelect}>使用免费体验（剩余 {remaining} 次）</button>}
      {configured && remaining === 0 && <small style={{ color: 'var(--text-muted)' }}>体验次数已用完，请填写自己的 API Key。</small>}
    </section>
  );
}

import { Shield, CheckCircle } from 'lucide-react';

const OVERVIEW_ITEMS = [
  { bold: '完全免费', desc: 'Cloudflare 提供每天 10 万次请求的免费额度' },
  { bold: '绝对安全', desc: '代码开源，你自己部署，API Key 不经过任何人' },
  { bold: '永久有效', desc: '部署后就不用管了，不会过期' },
  { bold: '零维护', desc: '不需要服务器，不需要域名，Cloudflare 全托管' },
];

export function OverviewCard() {
  return (
    <div
      style={{
        background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(168, 85, 247, 0.1))',
        border: '1px solid rgba(99, 102, 241, 0.3)',
        borderRadius: '12px',
        padding: '16px 20px',
        marginBottom: '20px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
        <Shield size={20} color="var(--accent)" />
        <span style={{ fontWeight: '600', fontSize: 'var(--font-size-md)' }}>为什么推荐自己部署？</span>
      </div>
      <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
        {OVERVIEW_ITEMS.map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: i < OVERVIEW_ITEMS.length - 1 ? '4px' : 0 }}>
            <CheckCircle size={14} color="var(--success)" />
            <span><strong>{item.bold}</strong> — {item.desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

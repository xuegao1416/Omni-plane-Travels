import { useState } from 'react';
import { ChevronDown, ChevronRight, HelpCircle } from 'lucide-react';

export function FAQItem({ question, answer }: { question: string; answer: string }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
      <button onClick={() => setIsOpen(!isOpen)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg-tertiary)', border: 'none', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 'var(--font-size-sm)', fontWeight: '500', textAlign: 'left' }}>
        <span>{question}</span>
        {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      {isOpen && <div style={{ padding: '10px 14px', fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', lineHeight: 1.6, animation: 'fadeIn 0.2s ease' }}>{answer}</div>}
    </div>
  );
}

export const FAQ_ITEMS = [
  { question: '部署后多久生效？', answer: '立即生效！保存并部署后就可以使用了。' },
  { question: '免费额度够用吗？', answer: '完全够用！免费额度是每天 10 万次请求，就算每秒发 1 条消息，也只能用 2.7 万次。' },
  { question: 'API Key 会被泄露吗？', answer: '不会！代码只做透明转发，不会存储任何数据。而且是你自己部署的，完全可控。' },
  { question: '需要维护吗？', answer: '基本不需要！Worker 是无服务器架构，Cloudflare 负责运维。如果代码需要更新，应用会提示你。' },
  { question: '手机能部署吗？', answer: '可以！Cloudflare Dashboard 是网页版的，手机浏览器也能操作。' },
];

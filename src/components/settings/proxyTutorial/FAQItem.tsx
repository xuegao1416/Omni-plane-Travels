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
  { question: 'DeepSeek 公益站获取不到模型怎么办？', answer: '部分公益站不开放 /models 或 /v1/models，所以模型列表可能拉取失败。先确认 API 端点、Key 和模型 ID 正确，再直接在「模型名称」里手动填写公益站公布的模型名；只要「测试连接」成功，就不影响正常聊天。' },
  { question: '代理返回 401 或 403 是 CORS 问题吗？', answer: '不是。401 通常是 API Key 无效或缺失，403 通常是站点权限、模型权限或公益站限制。请重新部署教程里的最新代理代码：旧代码会把浏览器的 Origin/Referer/Sec-Fetch-* 一并转发，部分公益站会因此返回空 403。代理只能解决浏览器跨域，不能绕过目标 API 的鉴权和访问策略。' },
  { question: '需要维护吗？', answer: '基本不需要！Worker 是无服务器架构，Cloudflare 负责运维。如果代码需要更新，应用会提示你。' },
  { question: '手机能部署吗？', answer: '可以！Cloudflare Dashboard 是网页版的，手机浏览器也能操作。' },
];

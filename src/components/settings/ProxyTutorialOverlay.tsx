import { useState, useCallback } from 'react';
import { X, Rocket, HelpCircle } from 'lucide-react';
import { TUTORIAL_STEPS } from './proxyTutorial/data';
import { PROXY_CODE } from './proxyTutorial/constants';
import { OverviewCard } from './proxyTutorial/OverviewCard';
import { ImageTutorialCard } from './proxyTutorial/ImageTutorialCard';
import { TutorialStepCard } from './proxyTutorial/TutorialStepCard';
import { ProxyInput } from './proxyTutorial/ProxyInput';
import { FAQItem, FAQ_ITEMS } from './proxyTutorial/FAQItem';

interface Props {
  onClose: () => void;
  onApplyProxy: (url: string) => void;
}

export default function ProxyTutorialOverlay({ onClose, onApplyProxy }: Props) {
  const [expandedStep, setExpandedStep] = useState<string | null>('intro');
  const [copiedCode, setCopiedCode] = useState(false);
  const [proxyUrl, setProxyUrl] = useState('');

  const handleCopyCode = useCallback(() => {
    navigator.clipboard.writeText(PROXY_CODE).then(() => {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    });
  }, []);

  const handleApply = useCallback(() => {
    if (proxyUrl.trim()) {
      onApplyProxy(proxyUrl.trim());
      onClose();
    }
  }, [proxyUrl, onApplyProxy, onClose]);

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(8px)', animation: 'fadeIn 0.2s ease' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--bg-primary, #0f0f1a)', border: '1px solid var(--border, rgba(255,255,255,0.1))', borderRadius: '16px', width: '95%', maxWidth: '700px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)', animation: 'dialogSlideIn 0.3s ease' }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', borderRadius: '16px 16px 0 0' }}>
          <div>
            <h2 style={{ fontSize: 'var(--font-size-xl)', fontWeight: '600', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Rocket size={20} /> 代理部署教程
            </h2>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', margin: '4px 0 0' }}>
              解决网页端 CORS 问题，5 分钟搞定！
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
          <OverviewCard />

          <ImageTutorialCard />

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {TUTORIAL_STEPS.map((step, index) => (
              <TutorialStepCard
                key={step.id}
                step={step}
                index={index}
                isExpanded={expandedStep === step.id}
                onToggle={() => setExpandedStep(expandedStep === step.id ? null : step.id)}
                copiedCode={copiedCode}
                onCopyCode={handleCopyCode}
              />
            ))}
          </div>

          <ProxyInput proxyUrl={proxyUrl} onProxyUrlChange={setProxyUrl} onApply={handleApply} />

          {/* FAQ */}
          <div style={{ marginTop: '20px', padding: '16px 20px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '12px' }}>
            <div style={{ fontWeight: '600', fontSize: 'var(--font-size-md)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <HelpCircle size={16} /> 常见问题
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {FAQ_ITEMS.map((faq, i) => (
                <FAQItem key={i} question={faq.question} answer={faq.answer} />
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', background: 'var(--bg-secondary)', borderRadius: '0 0 16px 16px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button onClick={onClose} style={{ padding: '10px 20px', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', cursor: 'pointer' }}>
            关闭教程
          </button>
        </div>
      </div>
    </div>
  );
}

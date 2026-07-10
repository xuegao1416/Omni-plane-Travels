import { useState } from 'react';
import { Images, ChevronDown, ChevronRight } from 'lucide-react';

const IMAGE_STEPS = [
  { src: '/proxy-tutorial-images/step1.png', label: '第一步：改中文' },
  { src: '/proxy-tutorial-images/step2.png', label: '第二步：进 Workers' },
  { src: '/proxy-tutorial-images/step3.png', label: '第三步：开始创建' },
  { src: '/proxy-tutorial-images/step4.png', label: '第四步：选 Hello World' },
  { src: '/proxy-tutorial-images/step5.png', label: '第五步：取名并保存' },
  { src: '/proxy-tutorial-images/step6.png', label: '第六步：复制代理代码' },
  { src: '/proxy-tutorial-images/step7.png', label: '第七步：编辑代码' },
  { src: '/proxy-tutorial-images/step8.png', label: '第八步：保存并部署' },
  { src: '/proxy-tutorial-images/step9.jpg', label: '第九步：复制代理链接' },
];

export function ImageTutorialCard() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        marginBottom: '20px',
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '14px 20px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-primary)',
          fontSize: 'var(--font-size-md)',
          fontWeight: '600',
          textAlign: 'left',
        }}
      >
        <Images size={18} color="var(--accent)" />
        <span style={{ flex: 1 }}>📷 图片教程（9 步截图）</span>
        {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
      </button>
      {expanded && (
        <div style={{ padding: '0 20px 20px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {IMAGE_STEPS.map((step, i) => (
              <div key={i}>
                <div style={{
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: '500',
                  color: 'var(--accent)',
                  marginBottom: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}>
                  <span style={{
                    width: '22px',
                    height: '22px',
                    borderRadius: '50%',
                    background: 'var(--accent)',
                    color: '#fff',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 'var(--font-size-xs)',
                    fontWeight: '600',
                  }}>{i + 1}</span>
                  {step.label}
                </div>
                <img
                  src={step.src}
                  alt={step.label}
                  style={{
                    width: '100%',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

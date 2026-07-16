import { useState, useCallback } from 'react';

interface Props {
  avatarUrl: string;
  name: string;
  title: string;
  text: string;
  action: string;
}

/**
 * 内联对话头像卡片 — 渲染 [SPEAK] 格式的对话
 * 气泡式布局：头像嵌入名称标签，对话内容在下方
 */
export default function InlineDialogueCard({ avatarUrl, name, title, text, action }: Props) {
  const [imgError, setImgError] = useState(false);
  const handleImgError = useCallback(() => setImgError(true), []);

  const showAvatar = avatarUrl && !imgError;
  const initial = name ? name.charAt(0) : '?';

  return (
    <div style={{
      margin: '20px 0',
      fontFamily: 'var(--font-family)',
    }}>
      {/* 名称标签区 */}
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '10px',
        marginBottom: '8px',
      }}>
        {/* 头像（圆形，嵌入名称左侧） */}
        <div style={{
          width: '36px',
          height: '36px',
          borderRadius: '50%',
          overflow: 'hidden',
          flexShrink: 0,
          border: '2px solid var(--accent, #5b8def)',
          boxShadow: '0 2px 8px rgba(91, 141, 239, 0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: showAvatar ? 'transparent' : 'var(--accent, #5b8def)',
        }}>
          {showAvatar ? (
            <img
              src={avatarUrl}
              alt={`${name}头像`}
              onError={handleImgError}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
          ) : (
            <span style={{
              color: '#fff',
              fontSize: '16px',
              fontWeight: 700,
              lineHeight: 1,
            }}>
              {initial}
            </span>
          )}
        </div>

        {/* 名称 + 称号 */}
        <div style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '8px',
        }}>
          <span style={{
            fontSize: '15px',
            fontWeight: 700,
            color: 'var(--accent, #5b8def)',
            letterSpacing: '0.5px',
          }}>
            {name}
          </span>
          {title && (
            <span style={{
              fontSize: '12px',
              color: 'var(--text-muted, #8492a6)',
              opacity: 0.8,
            }}>
              {title}
            </span>
          )}
        </div>
      </div>

      {/* 对话气泡 */}
      <div style={{
        position: 'relative',
        marginLeft: '18px',
        padding: '12px 16px',
        background: 'var(--bg-secondary, #f5f5f5)',
        borderRadius: '4px 12px 12px 12px',
        border: '1px solid var(--border, rgba(0,0,0,0.08))',
        maxWidth: '85%',
      }}>
        {/* 气泡尖角 */}
        <div style={{
          position: 'absolute',
          top: '0',
          left: '-8px',
          width: '0',
          height: '0',
          borderTop: '8px solid var(--border, rgba(0,0,0,0.08))',
          borderRight: '8px solid transparent',
        }} />
        <div style={{
          position: 'absolute',
          top: '1px',
          left: '-6px',
          width: '0',
          height: '0',
          borderTop: '7px solid var(--bg-secondary, #f5f5f5)',
          borderRight: '7px solid transparent',
        }} />

        {/* 对话文本 */}
        <div style={{
          fontSize: 'var(--body-font-size, 15px)',
          color: 'var(--text-primary, #2e3440)',
          lineHeight: 'var(--body-line-height, 1.7)',
          whiteSpace: 'pre-wrap',
        }}>
          {text}
        </div>

        {/* 动作描述 */}
        {action && (
          <div style={{
            marginTop: '8px',
            paddingTop: '8px',
            borderTop: '1px solid var(--border, rgba(0,0,0,0.06))',
            fontSize: '13px',
            color: 'var(--text-muted, #8492a6)',
            fontStyle: 'italic',
            lineHeight: '1.5',
          }}>
            {action}
          </div>
        )}
      </div>
    </div>
  );
}

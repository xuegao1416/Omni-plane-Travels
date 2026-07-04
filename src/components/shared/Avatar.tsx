import { useMemo, useState } from 'react';
import s from './Avatar.module.css';

interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** 可选的头像图片 URL */
  imageSrc?: string | null;
}

const SIZE_MAP = { sm: 28, md: 36, lg: 48 } as const;
const FONT_MAP = { sm: '0.7rem', md: '0.9rem', lg: '1.2rem' } as const;

// 6 种暗色渐变，名字哈希选择，保证同一人颜色一致
const GRADIENTS = [
  'linear-gradient(135deg, #2d4a6e, #1a3050)',
  'linear-gradient(135deg, #4a2d6e, #301a50)',
  'linear-gradient(135deg, #6e2d4a, #501a30)',
  'linear-gradient(135deg, #2d6e4a, #1a5030)',
  'linear-gradient(135deg, #6e5a2d, #503e1a)',
  'linear-gradient(135deg, #2d5a6e, #1a3e50)',
];

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export default function Avatar({ name, size = 'md', className, imageSrc }: AvatarProps) {
  const px = SIZE_MAP[size];
  const [imgFailed, setImgFailed] = useState(false);

  const initial = useMemo(() => {
    if (!name) return '?';
    const first = name.trim()[0] || '?';
    return first;
  }, [name]);

  const gradient = useMemo(() => GRADIENTS[hashCode(name) % GRADIENTS.length], [name]);

  const showImage = imageSrc && !imgFailed;

  return (
    <div
      className={`${s.avatar}${className ? ` ${className}` : ''}`}
      style={{
        width: px, height: px, minWidth: px,
        background: showImage ? 'none' : gradient,
        fontSize: FONT_MAP[size],
      }}
    >
      {showImage ? (
        <img src={imageSrc} alt={name} className={s.image} onError={() => setImgFailed(true)} />
      ) : (
        initial
      )}
    </div>
  );
}

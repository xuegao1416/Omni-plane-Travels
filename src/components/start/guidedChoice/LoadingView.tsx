import { X } from 'lucide-react';
import {
  overlayStyle, headerBarStyle, closeBtnStyle, titleStyle, subtitleStyle,
  centerContentStyle, spinnerStyle,
} from './styles';

interface LoadingViewProps {
  title: string;
  subtitle: string;
  spinnerMessage: string;
  onClose: () => void;
}

export function LoadingView({ title, subtitle, spinnerMessage, onClose }: LoadingViewProps) {
  return (
    <div style={overlayStyle}>
      <div style={headerBarStyle}>
        <button onClick={onClose} style={closeBtnStyle}><X size={16} /></button>
        <div style={{ textAlign: 'center' }}>
          <h1 style={titleStyle}>{title}</h1>
          <p style={subtitleStyle}>{subtitle}</p>
        </div>
      </div>
      <div style={centerContentStyle}>
        <div style={spinnerStyle} />
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '1rem' }}>
          {spinnerMessage}
        </p>
      </div>
    </div>
  );
}

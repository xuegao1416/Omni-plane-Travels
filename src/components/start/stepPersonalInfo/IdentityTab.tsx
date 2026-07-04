import React from 'react';
import type { PlayerProfile } from './types';

interface IdentityTabProps {
  personalInfo: PlayerProfile;
  set: <K extends keyof PlayerProfile>(key: K, val: PlayerProfile[K]) => void;
}

export default function IdentityTab({ personalInfo, set }: IdentityTabProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div className="form-group">
        <label>职业</label>
        <input type="text" value={personalInfo.career} onChange={e => set('career', e.target.value)} placeholder="学生, 佣兵..." />
      </div>
    </div>
  );
}

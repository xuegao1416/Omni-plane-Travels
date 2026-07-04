import React from 'react';
import type { WorldModule } from './types';
import type { PlayerProfile } from './types';

interface StatsTabProps {
  worldModules?: WorldModule[];
  personalInfo: PlayerProfile;
  setPersonalInfo: (info: PlayerProfile) => void;
}

const _inputStyle: React.CSSProperties = {
  background: 'var(--bg-secondary)', border: '1px solid var(--border)',
  borderRadius: 4, padding: '5px 8px', color: 'var(--text-primary)',
  fontSize: 'var(--font-size-xs)', width: '100%', boxSizing: 'border-box',
};
const _labelStyle: React.CSSProperties = {
  fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginBottom: 2, display: 'block',
};

function ModuleInitEditor({ worldModules, initData, onChange }: {
  worldModules?: WorldModule[];
  initData: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}) {
  if (!worldModules || worldModules.length === 0) {
    return <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', fontStyle: 'italic' }}>此世界未启用任何模块</div>;
  }

  const statMod = worldModules.find(m => m.moduleId === 'stat' && m.enabled);
  const progMod = worldModules.find(m => m.moduleId === 'progression' && m.enabled);
  const statData = statMod?.moduleConfig as any;
  const progData = progMod?.moduleConfig as any;

  const set = (path: string, value: unknown) => {
    const next = { ...initData };
    const parts = path.split('.');
    let obj: any = next;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!obj[parts[i]]) obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = value;
    onChange(next);
  };

  const get = (path: string, fallback: unknown = undefined): unknown => {
    const parts = path.split('.');
    let obj: any = initData;
    for (const p of parts) {
      if (!obj) return fallback;
      obj = obj[p];
    }
    if (obj == null || (typeof obj === 'number' && isNaN(obj))) return fallback;
    return obj;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {statData && (
        <div>
          <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, marginBottom: 8, color: 'var(--accent)', letterSpacing: '0.03em' }}>
            {statMod!.name}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[{ key: 'attrA', fallback: 80, tag: '生命' }, { key: 'attrB', fallback: 60, tag: '能量' }].map(({ key, fallback, tag }) => {
                const attr = statData[key];
                if (!attr) return null;
                return (
                  <div key={key}>
                    <span style={_labelStyle}>{attr.name}<span style={{ opacity: 0.5, marginLeft: 3 }}>{tag}</span></span>
                    <input style={{ ..._inputStyle, width: 56, textAlign: 'center' }} type="number"
                      value={get(`数值属性.${key}.current`, attr.current ?? fallback) as number}
                      onChange={e => set(`数值属性.${key}.current`, Number(e.target.value) || 0)} />
                  </div>
                );
              })}
            </div>
            {['dim1','dim2','dim3','dim4','dim5','dim6'].filter(k => statData[k]).length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {(['dim1','dim2','dim3','dim4','dim5','dim6'] as const).map(key => {
                  const dim = statData[key];
                  if (!dim) return null;
                  return (
                    <div key={key}>
                      <span style={_labelStyle}>{dim.name}</span>
                      <input style={{ ..._inputStyle, textAlign: 'center' }} type="number"
                        value={get(`数值属性.${key}.value`, dim.value ?? 0) as number}
                        onChange={e => set(`数值属性.${key}.value`, Number(e.target.value) || 0)} />
                    </div>
                  );
                })}
              </div>
            )}
            {statData.special?.length > 0 && (
              <div>
                <span style={{ ..._labelStyle, marginBottom: 4, display: 'block' }}>属性</span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {statData.special.map((sp: any) => (
                    <div key={sp.id}>
                      <span style={_labelStyle}>{sp.name}</span>
                      <input style={{ ..._inputStyle, textAlign: 'center' }} type="number"
                        value={get(`数值属性.special.${sp.id}.value`, sp.value ?? 0) as number}
                        onChange={e => set(`数值属性.special.${sp.id}.value`, Number(e.target.value) || 0)} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {progData?.tiers?.length > 0 && (
        <div>
          <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, marginBottom: 8, color: 'var(--accent)', letterSpacing: '0.03em' }}>
            {progMod!.name}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {progData.tiers.map((tier: any, i: number) => (
              <label key={i} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
                borderRadius: 6, cursor: 'pointer', fontSize: 'var(--font-size-sm)',
                background: (get('成长体系.currentTierIndex', 0) === i) ? 'var(--accent-dim)' : 'transparent',
                border: `1px solid ${(get('成长体系.currentTierIndex', 0) === i) ? 'var(--accent)' : 'var(--border)'}`,
                transition: 'all 0.12s',
              }}>
                <input type="radio" name="initTier"
                  checked={(get('成长体系.currentTierIndex', 0) === i)}
                  onChange={() => set('成长体系.currentTierIndex', i)}
                  style={{ display: 'none' }} />
                <span style={{ fontWeight: 600, color: (get('成长体系.currentTierIndex', 0) === i) ? 'var(--accent)' : 'var(--text-primary)', minWidth: '1.5em' }}>
                  {i + 1}.
                </span>
                <span style={{ fontWeight: 600, color: (get('成长体系.currentTierIndex', 0) === i) ? 'var(--accent)' : 'var(--text-primary)' }}>
                  {tier.name}
                </span>
                {tier.description && <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tier.description}</span>}
              </label>
            ))}
          </div>
        </div>
      )}

      {!statData && !progData && (
        <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', fontStyle: 'italic' }}>
          此世界的模块没有可配置的初始数据
        </div>
      )}
    </div>
  );
}

export default function StatsTab({ worldModules, personalInfo, setPersonalInfo }: StatsTabProps) {
  return (
    <ModuleInitEditor
      worldModules={worldModules}
      initData={personalInfo.moduleInitData || {}}
      onChange={(data) => setPersonalInfo({ ...personalInfo, moduleInitData: data })}
    />
  );
}

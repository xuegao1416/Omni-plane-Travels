import { Shield, Swords } from 'lucide-react';
import type { CombatRulesetBinding } from '../../../modules/schema';
import { BUILTIN_COMBAT_RULESETS } from '../../../gameplay/combatRulesets';

export default function CombatModuleEditor({ data, onChange }: {
  data: CombatRulesetBinding | Record<string, unknown>;
  onChange: (data: CombatRulesetBinding) => void;
}) {
  const selectedId = typeof (data as CombatRulesetBinding)?.rulesetId === 'string'
    ? (data as CombatRulesetBinding).rulesetId
    : 'narrative';
  return (
    <div className="profession-library__binding">
      <header>
        <div>
          <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Swords size={15} />战斗规则模板</strong>
          <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 3 }}>三个模板都会进入同一套图形化战斗界面；这里只调整本地结算节奏与风险倾向，不会把战斗改成纯正文。</div>
        </div>
      </header>
      <div style={{ display: 'grid', gap: 7 }}>
        {BUILTIN_COMBAT_RULESETS.map(ruleset => (
          <label key={ruleset.id} style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr)', gap: 8, alignItems: 'start', padding: 9, border: `1px solid ${selectedId === ruleset.id ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 8, background: selectedId === ruleset.id ? 'var(--accent-dim)' : 'transparent', cursor: 'pointer' }}>
            <input type="radio" name="combat-ruleset" checked={selectedId === ruleset.id} onChange={() => onChange({ rulesetId: ruleset.id })} />
            <span>
              <strong style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Shield size={13} />{ruleset.name}</strong>
              <small style={{ display: 'block', marginTop: 3, color: 'var(--text-muted)', lineHeight: 1.5 }}>{ruleset.description}</small>
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                {ruleset.details.map(detail => <em key={detail} style={{ padding: '2px 6px', border: '1px solid var(--border)', borderRadius: 999, color: 'var(--text-muted)', fontSize: 9, fontStyle: 'normal' }}>{detail}</em>)}
              </span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

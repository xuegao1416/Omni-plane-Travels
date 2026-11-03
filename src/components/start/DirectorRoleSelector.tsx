import { useEffect, useId, useState } from 'react';
import type { WorldDef } from '../../data/worlds-schema';
import type { PlayerProfile } from '../../storage/db';
import type { DirectorDefinition } from '../../director/definitionTypes';
import { getDirectorDefinition } from '../../director/definitionStore';

export default function DirectorRoleSelector({ world, profile, onChange, onReady }: {
  world?: WorldDef; profile: PlayerProfile; onChange: (profile: PlayerProfile) => void; onReady: (ready: boolean) => void;
}) {
  const id = useId();
  const [definition, setDefinition] = useState<DirectorDefinition>();
  const [error, setError] = useState('');
  const binding = world?.directorSource;
  useEffect(() => {
    let active = true;
    setDefinition(undefined); setError(''); onReady(!binding);
    if (binding) void getDirectorDefinition(binding.definitionId, binding.version).then(value => {
      if (!active) return;
      setDefinition(value);
      if (!value) setError('剧情版本缺失，请返回世界编辑页补全主线资料。');
      onReady(Boolean(value));
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, [binding?.definitionId, binding?.version, onReady]);
  if (!binding) return null;
  if (!definition) return <p role={error ? 'alert' : 'status'}>{error || '正在读取主线角色与起点…'}</p>;
  const saved = profile.directorRole;
  const selection = saved?.definitionId === definition.id && saved.version === definition.version ? saved : { definitionId: definition.id, version: definition.version, mode: 'custom' as const, startStageId: binding.startStageId };
  const choose = (value: string) => {
    const actor = definition.characters.find(character => character.id === value);
    onChange({ ...profile, ...(actor ? { name: actor.name } : {}), directorRole: { ...selection, mode: actor ? 'original' : 'custom', actorId: actor?.id } });
  };
  return <fieldset className="ritual-fieldset">
    <legend>主线身份与起点</legend>
    <label className="form-group" htmlFor={`${id}-actor`}><span>扮演身份</span>
      <select id={`${id}-actor`} value={selection.mode === 'original' ? selection.actorId : ''} onChange={event => choose(event.target.value)}>
        <option value="">自创角色</option>
        {definition.characters.map(actor => <option key={actor.id} value={actor.id}>{actor.name}</option>)}
      </select>
    </label>
    <label className="form-group" htmlFor={`${id}-stage`}><span>剧情起点</span>
      <select id={`${id}-stage`} value={selection.startStageId} onChange={event => onChange({ ...profile, directorRole: { ...selection, startStageId: event.target.value } })}>
        {definition.stages.map(stage => <option key={stage.id} value={stage.id}>{stage.title}</option>)}
      </select>
    </label>
    <p className="ritual-identity-note">{selection.mode === 'original' ? '你将成为这个原角色，世界中不会再创建同一角色的 NPC。' : '你以自己的身份进入主线，原角色仍属于这个世界。'}主线版本与起点在开局后固定。</p>
  </fieldset>;
}

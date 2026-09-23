import { useState } from 'react';
import { useSimulationStore } from '../../../../stores/simulationStore';
import { mutateBackgroundState } from '../../../../simulation/SimulationApi';
import { loadPresets } from '../../../settings/apiPresetUtils';
import { SIM_API_PRESET_KEY } from './constants';

export function SimSettings() {
  const simState = useSimulationStore(state => state.simState);
  const presets = loadPresets();
  const [presetId, setPresetId] = useState(() => {
    try { return localStorage.getItem(SIM_API_PRESET_KEY) || ''; } catch { return ''; }
  });
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span>启用剧情导演</span>
      {/* config 的权威副本在推演引擎里（director/review 读 engine.state.config）。
          只改 UI store 会在下一次引擎同步时被旧值顶回去，开关看起来"自己又勾上了"。 */}
      <input type="checkbox" checked={simState.config.enabled} onChange={event => {
        const enabled = event.target.checked;
        mutateBackgroundState(state => { state.config = { ...state.config, enabled }; });
      }}/>
    </label>
    <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.8 }}>启用后，每轮正文前整理指导，正文及变量、记忆处理完成后核对落实结果。关闭后暂停主线安排和幕后发展，游戏规则仍正常结算。</p>
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span>剧情导演 API</span>
      <select className="input-field" value={presetId} onChange={event => {
        setPresetId(event.target.value);
        try { localStorage.setItem(SIM_API_PRESET_KEY, event.target.value); } catch { /* unavailable storage */ }
      }}>
        <option value="">跟随主 API</option>
        {presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
      </select>
    </label>
    <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.8 }}>导演使用非流式请求，选择的 API 将用于下一次指导和落实审查。固定主线版本与角色身份在开局时绑定。</p>
  </div>;
}

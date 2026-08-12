import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowUpRight, Check, ChevronDown, Code2, GitBranch, Globe2, Link2,
  Loader2, Send, SlidersHorizontal, Sparkles, Square, Target, X, Zap,
} from 'lucide-react';
import { useConfigStore } from '../../stores/configStore';
import { findWorldDef, getAllWorlds } from '../../data/worldLoader';
import { WorldIcon } from '../shared/worldIcons';
import DawnFrameV4 from '../shared/dawn/DawnFrameV4';
import {
  parseCustomModuleDraft,
  runCustomModuleAgentTurn,
  type CustomModuleAgentTurnResult,
  type CustomModuleConversationMessage,
} from '../../custom-modules/agent';
import { bindCustomGameplayModule, saveCustomGameplayModule } from '../../custom-modules/storage';
import '../../styles/custom-modules.css';

interface Props {
  onClose: () => void;
}

const WELCOME_MESSAGE = '你好，我是自定义模块 Agent。先告诉我你想让这个模块解决什么问题；如果信息还不够，我会继续追问。';

const BLUEPRINT_ITEMS = [
  { label: '目标', detail: '模块要解决什么问题', Icon: Target },
  { label: '触发', detail: '何时开始或推进', Icon: Zap },
  { label: '输入', detail: '需要哪些状态字段', Icon: SlidersHorizontal },
  { label: '规则', detail: '如何安全地改变自身状态', Icon: GitBranch },
  { label: '输出', detail: '前端卡片或后台结果', Icon: ArrowUpRight },
  { label: '冲突 / 绑定', detail: '校验与目标世界', Icon: Link2 },
];

export default function CustomModuleAgentWorkspace({ onClose }: Props) {
  const apiConfig = useConfigStore((state) => state.apiConfig);
  const worlds = useMemo(() => getAllWorlds(), []);
  const [selectedWorldId, setSelectedWorldId] = useState(() => worlds[0]?.id || '');
  const [conversation, setConversation] = useState<CustomModuleConversationMessage[]>([{ role: 'assistant', content: WELCOME_MESSAGE }]);
  const [input, setInput] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [draft, setDraft] = useState<CustomModuleAgentTurnResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [mobileTab, setMobileTab] = useState<'conversation' | 'blueprint'>('conversation');
  const abortRef = useRef<AbortController | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const world = selectedWorldId ? findWorldDef(selectedWorldId) : undefined;
  const draftModule = draft?.ok ? draft.module : undefined;
  const stateEntries = draftModule ? Object.entries(draftModule.state) : [];
  const activeRules = draftModule ? Object.entries(draftModule.logic).filter(([, rules]) => rules.length > 0) : [];
  const workspaceStatus = busy ? '生成中' : notice ? '已保存' : draft?.ok ? '草案就绪' : draft ? '需要修正' : '等待描述';

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); abortRef.current?.abort(); onClose(); } };
    window.addEventListener('keydown', handleKeyDown);
    closeButtonRef.current?.focus();
    return () => { window.removeEventListener('keydown', handleKeyDown); abortRef.current?.abort(); };
  }, [onClose]);

  const appendAssistantMessage = (message: string) => setConversation((current) => [...current, { role: 'assistant', content: message }]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || busy || !world) return;
    const userMessage: CustomModuleConversationMessage = { role: 'user', content: text };
    const nextConversation = [...conversation, userMessage];
    setConversation(nextConversation); setInput(''); setNotice(''); setDraft(null);

    // 开发者可以直接粘贴 JSON，走本地协议校验，不依赖 API。
    if (text.startsWith('{')) {
      const local = parseCustomModuleDraft(text);
      if (local.ok) {
        const localTurn: CustomModuleAgentTurnResult = { ok: true, message: 'JSON 草案已通过本地校验，可以确认安装。', status: 'draft_ready', module: local.module, raw: text };
        setDraft(localTurn); appendAssistantMessage(localTurn.message);
      } else { setDraft({ ok: false, errors: local.errors, raw: text }); appendAssistantMessage('这份 JSON 还不能安装，我已经把具体校验错误列在右侧。'); }
      return;
    }
    if (!apiConfig) { appendAssistantMessage('当前还没有配置 API。你可以先到设置里配置，或者直接粘贴符合协议的 JSON。'); return; }

    const controller = new AbortController(); abortRef.current = controller; setBusy(true); setStreamingText('');
    try {
      const result = await runCustomModuleAgentTurn(apiConfig, { id: world.id, name: world.name, description: world.description }, nextConversation, { signal: controller.signal, onText: setStreamingText });
      setDraft(result); appendAssistantMessage(result.ok ? result.message : '我收到了一份无法通过本地协议校验的回复，请换一种描述或重新尝试。');
    } catch (error) { if (error instanceof Error && error.name === 'AbortError') return; appendAssistantMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); setStreamingText(''); abortRef.current = null; }
  };

  const handleInstall = async () => {
    if (!draft?.ok || !draft.module || !world) return;
    setBusy(true); setNotice('');
    try {
      await saveCustomGameplayModule(draft.module); await bindCustomGameplayModule(draft.module.id, world.id); window.dispatchEvent(new Event('custom-modules-changed'));
      setNotice(`“${draft.module.name}” 已安装并绑定到「${world.name}」。`); appendAssistantMessage('安装完成。开始这个世界的新游戏后，它会按照模块规则运行。');
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  return <div className="entry-default-theme custom-module-workspace" role="dialog" aria-modal="true" aria-label="模块工坊">
    <div className="custom-module-workspace-backdrop" onClick={onClose} />
    <div className="custom-module-workspace-shell">
      <DawnFrameV4 mode="panel" withFill className="custom-module-workspace-frame" ariaLabel="晨光模块工坊">
        <div className="custom-module-workspace-inner">
          <header className="custom-module-workspace-header">
            <div className="custom-module-workspace-title"><Sparkles size={20} /><div><span>DAWN WORKSHOP · CUSTOM MODULES</span><h2>模块工坊</h2><p>和 Agent 一起把想法编织成可审查、可绑定的玩法模块</p></div></div>
            <div className="custom-module-workspace-header-actions">
              <label className="custom-module-world-picker"><WorldIcon name={world?.icon || 'Globe'} size={18} /><span>绑定世界</span><select value={selectedWorldId} onChange={(event) => setSelectedWorldId(event.target.value)} disabled={busy}>{worlds.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <button ref={closeButtonRef} type="button" className="custom-module-icon-button" onClick={onClose} aria-label="关闭模块工坊"><X size={19} /></button>
            </div>
          </header>
          <div className="custom-module-workshop-tabs" role="tablist" aria-label="模块工坊视图">
            <button type="button" role="tab" aria-selected={mobileTab === 'conversation'} onClick={() => setMobileTab('conversation')}>共创对话</button>
            <button type="button" role="tab" aria-selected={mobileTab === 'blueprint'} onClick={() => setMobileTab('blueprint')}>模块蓝图{draftModule ? ' · 1' : ''}</button>
          </div>
          <main className="custom-module-workspace-body">
            <section className={`custom-module-chat-column${mobileTab === 'blueprint' ? ' mobile-hidden' : ''}`} aria-label="共创对话">
              <div className="custom-module-column-heading"><div><span className="custom-module-kicker">CO-CREATION</span><h3>共创对话</h3></div><span className={`custom-module-state custom-module-state--${busy ? 'busy' : draft?.ok ? 'ready' : draft ? 'error' : 'idle'}`}>{workspaceStatus}</span></div>
              <div className="custom-module-suggestion-row" aria-label="建议提示"><button type="button" onClick={() => setInput('做一个记录每日目标的可视模块')}>每日目标</button><button type="button" onClick={() => setInput('做一个后台累计资源变化的模块')}>后台累计</button><button type="button" onClick={() => setInput('直接粘贴 JSON 草案进行校验')}>校验 JSON</button></div>
              <div className="custom-module-chat-history" aria-live="polite">
                {!conversation.length && <div className="custom-module-chat-empty"><Sparkles size={22} /><strong>从一个玩法意图开始</strong><p>你可以描述目标、触发方式，或直接粘贴模块 JSON。</p></div>}
                {conversation.map((message, index) => <div key={`${message.role}-${index}`} className={`custom-module-chat-message ${message.role}`}><div className="custom-module-chat-role">{message.role === 'assistant' ? 'MODULE AGENT' : '你'}</div><div className="custom-module-chat-bubble">{message.content}</div></div>)}
                {streamingText && <div className="custom-module-chat-message assistant"><div className="custom-module-chat-role">MODULE AGENT</div><div className="custom-module-chat-bubble streaming">{streamingText}<Loader2 size={13} className="spin" /></div></div>}
              </div>
              <div className="custom-module-composer"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void handleSend(); } }} placeholder="告诉 Agent 你想做什么……也可以直接粘贴 JSON" rows={3} disabled={busy} aria-label="模块描述输入" /><div className="custom-module-composer-footer"><span>Ctrl/⌘ + Enter 发送 · 先追问，再生成</span><div>{busy && <button type="button" className="custom-module-ghost-button" onClick={() => abortRef.current?.abort()}><Square size={13} />停止</button>}<button type="button" className="custom-module-send-button" onClick={() => void handleSend()} disabled={busy || !input.trim() || !world}><Send size={14} />发送</button></div></div></div>
            </section>
            <aside className={`custom-module-draft-column${mobileTab === 'conversation' ? ' mobile-hidden' : ''}`} aria-label="模块蓝图">
              <div className="custom-module-column-heading"><div><span className="custom-module-kicker">BLUEPRINT</span><h3>模块蓝图</h3></div>{draft?.ok && <span className="custom-module-draft-status"><Check size={13} /> 已通过校验</span>}</div>
              {!draft && <div className="custom-module-draft-empty"><div className="custom-module-blueprint-list">{BLUEPRINT_ITEMS.map(({ label, detail, Icon }, index) => <div className="custom-module-blueprint-item" key={label}><span className="custom-module-blueprint-index">0{index + 1}</span><Icon size={16} /><div><strong>{label}</strong><span>{detail}</span></div></div>)}</div><p>对话推进后，Agent 会把这六项整理成一份模块草案。</p></div>}
              {draft && !draft.ok && <div className="custom-module-agent-errors"><strong><AlertTriangle size={15} /> 需要修正</strong>{draft.errors.map((error, index) => <div key={index}>{error.path.join('.') || '模块'}：{error.message}</div>)}</div>}
              {draftModule && <div className="custom-module-blueprint-content"><div className="custom-module-draft-summary"><span className="custom-module-kicker">DRAFT READY</span><strong>{draftModule.name}</strong><span>{draftModule.view ? '可视模块' : '后台模块'} · v{draftModule.version}</span><small>{draftModule.description || '暂无描述'}</small></div><div className="custom-module-flow"><div><span>触发</span><strong>{activeRules.map(([name]) => name.replace('on', '')).join(' · ') || '等待游戏事件'}</strong></div><div><span>规则</span><strong>{activeRules.reduce((total, [, rules]) => total + rules.length, 0)} 条自有状态规则</strong></div><div><span>输出</span><strong>{draftModule.view ? draftModule.view.title || '右侧模块卡片' : '后台状态变化'}</strong></div></div><div className="custom-module-blueprint-sections"><section><span>参数</span>{stateEntries.length ? stateEntries.map(([key, field]) => <div key={key}><strong>{key}</strong><small>{field.type} · 默认值 {String(field.default)}</small></div>) : <p>无需额外参数</p>}</section><section><span>冲突 / 绑定</span><p>仅读写自身状态 · 当前世界：{world?.name || '未选择'}</p></section></div><details className="custom-module-json-details"><summary>查看原始 JSON <ChevronDown size={14} /></summary><pre>{draft?.raw || ''}</pre></details><button type="button" className="custom-module-install-button custom-module-button" onClick={() => void handleInstall()} disabled={busy}><Check size={14} />保存并绑定</button></div>}
              {notice && <div className="custom-module-agent-message" role="status">{notice}</div>}
            </aside>
          </main>
        </div>
      </DawnFrameV4>
    </div>
  </div>;
}

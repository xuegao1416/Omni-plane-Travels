import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowUpRight, Check, ChevronDown, GitBranch, Link2,
  Loader2, Send, SlidersHorizontal, Sparkles, Square, Target, X, Zap,
} from 'lucide-react';
import { useConfigStore } from '../../stores/configStore';
import { findWorldDef, getAllWorlds } from '../../data/worldLoader';
import { WorldIcon } from '../shared/worldIcons';
import DawnFrameV4 from '../shared/dawn/DawnFrameV4';
import {
  parseCustomModuleDraft,
  runCustomModuleAgentTurn,
  type CustomModuleConversationMessage,
} from '../../custom-modules/agent';
import {
  applyCustomModuleAgentTurn,
  createCustomModuleAgentSession,
  type CustomModuleAgentQuestion,
  type CustomModuleAgentSession,
} from '../../custom-modules/agentSession';
import { buildCustomModuleAgentWorldContext } from '../../custom-modules/capabilities';
import {
  bindCustomGameplayModule,
  loadCustomModuleAgentSession,
  saveCustomGameplayModule,
  saveCustomModuleAgentSession,
} from '../../custom-modules/storage';
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
  const world = useMemo(() => selectedWorldId ? findWorldDef(selectedWorldId) : undefined, [selectedWorldId]);
  const [conversation, setConversation] = useState<CustomModuleConversationMessage[]>([{ role: 'assistant', content: WELCOME_MESSAGE }]);
  const [input, setInput] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [session, setSession] = useState<CustomModuleAgentSession>(() => createCustomModuleAgentSession(
    buildCustomModuleAgentWorldContext(worlds[0] ?? { id: '', name: '', modules: [] }),
  ));
  const [activeQuestion, setActiveQuestion] = useState<CustomModuleAgentQuestion>();
  const [requestError, setRequestError] = useState<{ errors: Array<{ path: string[]; message: string }>; raw?: string } | null>(null);
  const [lastRaw, setLastRaw] = useState('');
  const [revisionSummary, setRevisionSummary] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [mobileTab, setMobileTab] = useState<'conversation' | 'blueprint'>('conversation');
  const abortRef = useRef<AbortController | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const draftModule = session.lastValidDraft;
  const stateEntries = draftModule ? Object.entries(draftModule.state) : [];
  const activeRules = draftModule ? Object.entries(draftModule.logic).filter(([, rules]) => rules.length > 0) : [];
  const workspaceStatus = busy ? '生成中' : notice ? '已保存' : requestError ? '本轮未应用' : draftModule ? (session.revision > 1 ? '修订中' : '草案就绪') : session.brief.goal ? '需求探索' : '等待描述';

  useEffect(() => {
    if (!selectedWorldId) return;
    const worldContext = buildCustomModuleAgentWorldContext(world ?? {
      id: selectedWorldId, name: selectedWorldId, modules: [],
    });
    setSession((current) => current.world.id === selectedWorldId
      ? { ...current, world: worldContext }
      : createCustomModuleAgentSession(worldContext));
    setActiveQuestion(undefined);
  }, [selectedWorldId, world]);

  useEffect(() => {
    void loadCustomModuleAgentSession().then((saved) => {
      if (saved && saved.world.id === selectedWorldId) {
        const restoredWorld = findWorldDef(saved.world.id);
        setSession({
          ...saved,
          world: buildCustomModuleAgentWorldContext(restoredWorld ?? {
            id: saved.world.id, name: saved.world.name, description: saved.world.description, modules: [],
          }),
        });
      }
    }).catch(() => undefined);
  }, [selectedWorldId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); abortRef.current?.abort(); onClose(); } };
    window.addEventListener('keydown', handleKeyDown);
    closeButtonRef.current?.focus();
    return () => { window.removeEventListener('keydown', handleKeyDown); abortRef.current?.abort(); };
  }, [onClose]);

  const appendAssistantMessage = (message: string) => setConversation((current) => [...current, { role: 'assistant', content: message }]);

  const applyEnvelope = (envelope: Parameters<typeof applyCustomModuleAgentTurn>[1], raw: string) => {
    const before = session.lastValidDraft;
    const applied = applyCustomModuleAgentTurn(session, envelope);
    if (!applied.accepted) {
      setRequestError({ errors: applied.errors, raw });
      return false;
    }
    setSession(applied.session);
    setRequestError(null);
    setLastRaw(raw);
    if (before && applied.session.lastValidDraft) {
      const changed = Object.keys(applied.session.lastValidDraft).filter((key) => JSON.stringify((before as unknown as Record<string, unknown>)[key]) !== JSON.stringify((applied.session.lastValidDraft as unknown as Record<string, unknown>)[key]));
      setRevisionSummary(changed.length ? changed.map((key) => `已更新 ${key}`) : ['保留现有设计，仅应用本轮要求']);
    } else setRevisionSummary([]);
    void saveCustomModuleAgentSession(applied.session);
    return true;
  };

  const updateRevisionSummary = (before: CustomModuleAgentSession['lastValidDraft'], after: CustomModuleAgentSession['lastValidDraft']) => {
    if (!before || !after) {
      setRevisionSummary([]);
      return;
    }
    const changed = Object.keys(after).filter((key) => JSON.stringify((before as unknown as Record<string, unknown>)[key]) !== JSON.stringify((after as unknown as Record<string, unknown>)[key]));
    setRevisionSummary(changed.length ? changed.map((key) => `已更新 ${key}`) : ['保留现有设计，仅应用本轮要求']);
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || busy || !world) return;
    const userMessage: CustomModuleConversationMessage = { role: 'user', content: text };
    const nextConversation = [...conversation, userMessage];
    setConversation(nextConversation); setInput(''); setNotice(''); setRequestError(null); setActiveQuestion(undefined);

    // 开发者可以直接粘贴 JSON，走本地协议校验，不依赖 API。
    if (text.startsWith('{')) {
      const local = parseCustomModuleDraft(text);
      if (local.ok) {
        applyEnvelope({ message: 'JSON 草案已通过本地校验，可以确认安装。', phase: 'draft_ready', brief: session.brief, module: local.module }, text);
        appendAssistantMessage('JSON 草案已通过本地校验，可以确认安装。');
      } else { setRequestError({ errors: local.errors, raw: text }); setLastRaw(text); appendAssistantMessage('这份 JSON 还不能安装；上一份有效草案已保留。'); }
      return;
    }
    if (!apiConfig) { appendAssistantMessage('当前还没有配置 API。你可以先到设置里配置，或者直接粘贴符合协议的 JSON。'); return; }

    const controller = new AbortController(); abortRef.current = controller; setBusy(true); setStreamingText('');
    try {
      const result = await runCustomModuleAgentTurn(apiConfig, session, text, { signal: controller.signal, conversation: nextConversation, onText: setStreamingText });
      if (result.ok) {
        if (result.session) {
          updateRevisionSummary(session.lastValidDraft, result.session.lastValidDraft);
          setSession(result.session);
        }
        setLastRaw(result.raw);
        setRequestError(null);
        if (result.session) void saveCustomModuleAgentSession(result.session);
        const nextQuestion = result.phase === 'draft_ready' ? undefined : result.question;
        setActiveQuestion(nextQuestion);
        const questionText = nextQuestion?.text.trim();
        const sameText = questionText?.replace(/\s+/g, ' ') === result.message.trim().replace(/\s+/g, ' ');
        appendAssistantMessage(questionText && !sameText ? `${result.message}\n\n${questionText}` : result.message);
      } else {
        setActiveQuestion(undefined);
        setRequestError({ errors: result.errors, raw: result.raw });
        appendAssistantMessage('这轮回复没有通过本地校验；上一份有效草案未应用。');
      }
    } catch (error) { if (error instanceof Error && error.name === 'AbortError') return; appendAssistantMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); setStreamingText(''); abortRef.current = null; }
  };

  const handleInstall = async () => {
    if (!session.lastValidDraft || !world) return;
    setBusy(true); setNotice('');
    try {
      await saveCustomGameplayModule(session.lastValidDraft); await bindCustomGameplayModule(session.lastValidDraft.id, world.id); window.dispatchEvent(new Event('custom-modules-changed'));
      setNotice(`“${session.lastValidDraft.name}” 已安装并绑定到「${world.name}」。`); appendAssistantMessage('安装完成。开始这个世界的新游戏后，它会按照模块规则运行。');
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
              <div className="custom-module-column-heading"><div><span className="custom-module-kicker">CO-CREATION</span><h3>共创对话</h3></div><span className={`custom-module-state custom-module-state--${busy ? 'busy' : draftModule ? 'ready' : requestError ? 'error' : 'idle'}`}>{workspaceStatus}</span></div>
              <div className="custom-module-suggestion-row" aria-label="建议提示"><button type="button" onClick={() => setInput('做一个记录每日目标的可视模块')}>每日目标</button><button type="button" onClick={() => setInput('做一个后台累计资源变化的模块')}>后台累计</button><button type="button" onClick={() => setInput('直接粘贴 JSON 草案进行校验')}>校验 JSON</button></div>
              <div className="custom-module-chat-history" aria-live="polite">
                {!conversation.length && <div className="custom-module-chat-empty"><Sparkles size={22} /><strong>从一个玩法意图开始</strong><p>你可以描述目标、触发方式，或直接粘贴模块 JSON。</p></div>}
                {conversation.map((message, index) => <div key={`${message.role}-${index}`} className={`custom-module-chat-message ${message.role}`}><div className="custom-module-chat-role">{message.role === 'assistant' ? 'MODULE AGENT' : '你'}</div><div className="custom-module-chat-bubble">{message.content}</div></div>)}
                {streamingText && <div className="custom-module-chat-message assistant"><div className="custom-module-chat-role">MODULE AGENT</div><div className="custom-module-chat-bubble streaming">{streamingText}<Loader2 size={13} className="spin" /></div></div>}
              </div>
              {activeQuestion?.choices && activeQuestion.choices.length > 0 && <div className="custom-module-suggestion-row custom-module-question-choices" aria-label="追问快捷选项">{activeQuestion.choices.map((choice) => <button type="button" key={choice} onClick={() => setInput(choice)}>{choice}</button>)}</div>}
              <div className="custom-module-composer"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void handleSend(); } }} placeholder="告诉 Agent 你想做什么……也可以直接粘贴 JSON" rows={3} disabled={busy} aria-label="模块描述输入" /><div className="custom-module-composer-footer"><span>Ctrl/⌘ + Enter 发送 · 先追问，再生成</span><div>{busy && <button type="button" className="custom-module-ghost-button" onClick={() => abortRef.current?.abort()}><Square size={13} />停止</button>}<button type="button" className="custom-module-send-button" onClick={() => void handleSend()} disabled={busy || !input.trim() || !world}><Send size={14} />发送</button></div></div></div>
            </section>
            <aside className={`custom-module-draft-column${mobileTab === 'conversation' ? ' mobile-hidden' : ''}`} aria-label="模块蓝图">
              <div className="custom-module-column-heading"><div><span className="custom-module-kicker">BLUEPRINT</span><h3>模块蓝图</h3></div>{draftModule && <span className="custom-module-draft-status"><Check size={13} /> 已通过校验</span>}</div>
              {!draftModule && <div className="custom-module-draft-empty"><div className="custom-module-blueprint-list">{BLUEPRINT_ITEMS.map(({ label, detail, Icon }, index) => <div className="custom-module-blueprint-item" key={label}><span className="custom-module-blueprint-index">0{index + 1}</span><Icon size={16} /><div><strong>{label}</strong><span>{detail}</span></div></div>)}</div><p>{session.brief.goal ? '需求正在收敛；右侧蓝图会在确认后变为可安装模块。' : '对话推进后，Agent 会把结构化需求整理成一份模块草案。'}</p><div className="custom-module-brief-preview"><strong>已理解</strong><p>{session.brief.goal || '尚未记录目标'}</p>{session.brief.unresolved.length > 0 && <><strong>仍待确认</strong><p>{session.brief.unresolved.join('、')}</p></>}{session.brief.assumptions.length > 0 && <><strong>Agent 假设</strong><p>{session.brief.assumptions.join('、')}</p></>}</div></div>}
              {requestError && <div className="custom-module-agent-errors"><strong><AlertTriangle size={15} /> 本轮未应用</strong>{requestError.errors.map((error, index) => <div key={index}>{error.path.join('.') || '模块'}：{error.message}</div>)}{draftModule && <p>上一份有效草案仍在上方，可继续修订或保存。</p>}</div>}
              {draftModule && <div className="custom-module-blueprint-content"><div className="custom-module-draft-summary"><span className="custom-module-kicker">{session.revision > 1 ? 'REVISION READY' : 'DRAFT READY'}</span><strong>{draftModule.name}</strong><span>{draftModule.view ? '可视模块' : '后台模块'} · V{draftModule.schemaVersion} · revision {session.revision}</span><small>{draftModule.description || '暂无描述'}</small></div><div className="custom-module-flow"><div><span>触发</span><strong>{activeRules.map(([name]) => name.replace('on', '')).join(' · ') || '等待游戏事件'}</strong></div><div><span>规则</span><strong>{activeRules.reduce((total, [, rules]) => total + rules.length, 0)} 条自有状态规则</strong></div><div><span>输出</span><strong>{draftModule.view ? draftModule.view.title || '右侧模块卡片' : '后台状态变化'}</strong></div></div><div className="custom-module-blueprint-sections"><section><span>输入与状态</span>{session.brief.inputs.map((item) => <p key={item}>{item}</p>)}{stateEntries.length ? stateEntries.map(([key, field]) => <div key={key}><strong>{key}</strong><small>{field.type} · 默认值 {String(field.default)}</small></div>) : <p>无需额外参数</p>}</section><section><span>冲突 / 绑定</span><p>仅读写自身状态 · 当前世界：{world?.name || '未选择'}</p>{revisionSummary.map((item) => <small key={item}>{item}</small>)}</section></div><details className="custom-module-json-details"><summary>查看原始 JSON <ChevronDown size={14} /></summary><pre>{lastRaw || JSON.stringify(draftModule, null, 2)}</pre></details><button type="button" className="custom-module-install-button custom-module-button" onClick={() => void handleInstall()} disabled={busy}><Check size={14} />保存并绑定</button></div>}
              {notice && <div className="custom-module-agent-message" role="status">{notice}</div>}
            </aside>
          </main>
        </div>
      </DawnFrameV4>
    </div>
  </div>;
}

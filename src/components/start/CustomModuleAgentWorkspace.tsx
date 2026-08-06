import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Code2, Globe2, Loader2, Send, Sparkles, X } from 'lucide-react';
import { useConfigStore } from '../../stores/configStore';
import { findWorldDef, getAllWorlds } from '../../data/worldLoader';
import {
  getMissingCustomModuleRequestFields,
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

export default function CustomModuleAgentWorkspace({ onClose }: Props) {
  const apiConfig = useConfigStore((state) => state.apiConfig);
  const worlds = useMemo(() => getAllWorlds(), []);
  const [selectedWorldId, setSelectedWorldId] = useState(() => worlds[0]?.id ?? '');
  const [conversation, setConversation] = useState<CustomModuleConversationMessage[]>([
    { role: 'assistant', content: WELCOME_MESSAGE },
  ]);
  const [input, setInput] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [draft, setDraft] = useState<CustomModuleAgentTurnResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const world = selectedWorldId ? findWorldDef(selectedWorldId) : undefined;

  useEffect(() => () => abortRef.current?.abort(), []);

  const appendAssistantMessage = (message: string) => {
    setConversation((current) => [...current, { role: 'assistant', content: message }]);
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || busy || !world) return;
    const userMessage: CustomModuleConversationMessage = { role: 'user', content: text };
    const nextConversation = [...conversation, userMessage];
    setConversation(nextConversation);
    setInput('');
    setNotice('');
    setDraft(null);

    // 开发者可以直接粘贴 JSON，走本地协议校验，不依赖 API。
    if (text.startsWith('{')) {
      const local = parseCustomModuleDraft(text);
      if (local.ok) {
        const localTurn: CustomModuleAgentTurnResult = {
          ok: true,
          message: 'JSON 草案已通过本地校验，可以确认安装。',
          status: 'draft_ready',
          module: local.module,
          raw: text,
        };
        setDraft(localTurn);
        appendAssistantMessage(localTurn.message);
      } else {
        setDraft({ ok: false, errors: local.errors, raw: text });
        appendAssistantMessage('这份 JSON 还不能安装，我已经把具体校验错误列在右侧。');
      }
      return;
    }

    const missingFields = getMissingCustomModuleRequestFields(nextConversation);
    if (missingFields.length > 0) {
      const clarification: CustomModuleAgentTurnResult = {
        ok: true,
        message: '请先告诉我这个模块要解决什么问题，以及它是前端卡片还是后台运行模块。当前绑定世界已由上方世界选择器确定。',
        status: 'needs_input',
        raw: text,
      };
      setDraft(clarification);
      appendAssistantMessage(clarification.message);
      return;
    }

    if (!apiConfig) {
      appendAssistantMessage('当前还没有配置 API。你可以先到设置里配置，或者直接粘贴符合协议的 JSON。');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setStreamingText('');
    try {
      const result = await runCustomModuleAgentTurn(apiConfig, {
        id: world.id,
        name: world.name,
        description: world.description,
      }, nextConversation, {
        signal: controller.signal,
        onText: setStreamingText,
      });
      setDraft(result);
      if (result.ok) {
        appendAssistantMessage(result.message);
      } else {
        appendAssistantMessage('我收到了一份无法通过本地协议校验的回复，请换一种描述或重新尝试。');
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      appendAssistantMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      setStreamingText('');
      abortRef.current = null;
    }
  };

  const handleInstall = async () => {
    if (!draft?.ok || !draft.module || !world) return;
    setBusy(true);
    setNotice('');
    try {
      await saveCustomGameplayModule(draft.module);
      await bindCustomGameplayModule(draft.module.id, world.id);
      window.dispatchEvent(new Event('custom-modules-changed'));
      setNotice(`“${draft.module.name}” 已安装并绑定到「${world.name}」。`);
      appendAssistantMessage('安装完成。开始这个世界的新游戏后，它会按照模块规则运行。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const handleClose = () => {
    abortRef.current?.abort();
    onClose();
  };

  return <div className="custom-module-workspace" role="dialog" aria-modal="true" aria-label="自定义模块 Agent">
    <div className="custom-module-workspace-backdrop" onClick={handleClose} />
    <div className="custom-module-workspace-shell">
      <header className="custom-module-workspace-header">
        <div className="custom-module-workspace-title"><Sparkles size={19} /><div><h2>自定义模块 Agent</h2><p>在开始游戏前，和 Agent 一起设计你的玩法</p></div></div>
        <div className="custom-module-workspace-header-actions">
          <label className="custom-module-world-picker"><Globe2 size={14} /><span>绑定世界</span><select value={selectedWorldId} onChange={(event) => setSelectedWorldId(event.target.value)} disabled={busy}>{worlds.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <button type="button" className="custom-module-icon-button" onClick={handleClose} aria-label="关闭"><X size={18} /></button>
        </div>
      </header>

      <main className="custom-module-workspace-body">
        <section className="custom-module-chat-column">
          <div className="custom-module-chat-history">
            {conversation.map((message, index) => <div key={`${message.role}-${index}`} className={`custom-module-chat-message ${message.role}`}><div className="custom-module-chat-role">{message.role === 'assistant' ? 'Agent' : '你'}</div><div className="custom-module-chat-bubble">{message.content}</div></div>)}
            {streamingText && <div className="custom-module-chat-message assistant"><div className="custom-module-chat-role">Agent</div><div className="custom-module-chat-bubble streaming">{streamingText}<Loader2 size={13} className="spin" /></div></div>}
          </div>
          <div className="custom-module-composer">
            <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void handleSend(); } }} placeholder="告诉 Agent 你想做什么……也可以直接粘贴 JSON" rows={4} disabled={busy} />
            <div className="custom-module-composer-footer"><span>Ctrl/⌘ + Enter 发送 · Agent 会先追问再生成</span><div>{busy && <button type="button" className="custom-module-ghost-button" onClick={() => abortRef.current?.abort()}>停止</button>}<button type="button" className="custom-module-send-button" onClick={() => void handleSend()} disabled={busy || !input.trim() || !world}><Send size={14} />发送</button></div></div>
          </div>
        </section>

        <aside className="custom-module-draft-column">
          <div className="custom-module-draft-header"><div><Code2 size={15} /><strong>模块草案</strong></div>{draft?.ok && draft.module && <span className="custom-module-draft-status"><Check size={12} />已通过校验</span>}</div>
          {!draft && <div className="custom-module-draft-empty"><Code2 size={28} /><p>对话过程中，Agent 生成的模块草案会显示在这里。</p></div>}
          {draft && !draft.ok && <div className="custom-module-agent-errors">{draft.errors.map((error, index) => <div key={index}>· {error.path.join('.') || '模块'}：{error.message}</div>)}</div>}
          {draft?.ok && draft.module && <><div className="custom-module-draft-summary"><strong>{draft.module.name}</strong><span>{draft.module.view ? '可视模块' : '后台模块'} · v{draft.module.version}</span><small>{draft.module.description || '暂无描述'}</small></div><pre className="custom-module-workspace-json">{JSON.stringify(draft.module, null, 2)}</pre><button type="button" className="custom-module-install-button custom-module-button" onClick={() => void handleInstall()} disabled={busy}><Check size={14} />确认安装到当前世界</button></>}
          {notice && <div className="custom-module-agent-message">{notice}</div>}
        </aside>
      </main>
    </div>
  </div>;
}


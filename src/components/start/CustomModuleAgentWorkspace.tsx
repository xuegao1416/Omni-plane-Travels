import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, History, Loader2, MessageSquare, Pencil, Plus, RotateCcw, Save, Send, Sparkles, Square, Trash2, Upload, X } from 'lucide-react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useConfigStore } from '../../stores/configStore';
import { useWorkshopStore } from '../../stores/workshopStore';
import { findWorldDef, getAllWorlds } from '../../data/worldLoader';
import DawnFrameV4 from '../shared/dawn/DawnFrameV4';
import { WorldIcon } from '../shared/worldIcons';
import { buildCustomModuleAgentWorldContext } from '../../custom-modules/capabilities';
import { useModuleWorkshopStore } from '../../custom-modules/workshopStore';
import type { WorkshopMessage } from '../../custom-modules/workshopSession';
import { bindCustomGameplayModule, saveCustomGameplayModule } from '../../custom-modules/storage';
import { WorkshopModulePanel } from './WorkshopModulePanel';
import '../../styles/custom-modules.css';

interface Props { onClose: () => void }

function messageText(message: WorkshopMessage): string {
  return message.parts.flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n');
}

function Markdown({ text }: { text: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false }), {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a'],
    ALLOWED_ATTR: ['href', 'title'],
  }), [text]);
  return <div className="mws-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}

const toolLabels: Record<string, string> = {
  capabilities: '查询可用能力', getCapabilities: '查询可用能力', readDraft: '读取当前草稿',
  createDraft: '创建模块草稿', patchDraft: '修改模块草稿', validateDraft: '校验模块', simulate: '模拟运行',
};

export default function CustomModuleAgentWorkspace({ onClose }: Props) {
  const apiConfig = useConfigStore((state) => state.apiConfig);
  const publish = useWorkshopStore((state) => state.createItem);
  const workshop = useModuleWorkshopStore();
  const worlds = useMemo(() => getAllWorlds(), []);
  const [worldId, setWorldId] = useState(() => worlds[0]?.id ?? '');
  const world = useMemo(() => findWorldDef(worldId), [worldId]);
  const session = workshop.sessions.find((item) => item.id === workshop.activeSessionId);
  const revision = session?.revisions.find((item) => item.number === session.currentRevision);
  const [input, setInput] = useState('');
  const [editId, setEditId] = useState<string>();
  const [editText, setEditText] = useState('');
  const [renameId, setRenameId] = useState<string>();
  const [renameText, setRenameText] = useState('');
  const [deleteId, setDeleteId] = useState<string>();
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [mobilePane, setMobilePane] = useState<'sessions' | 'chat' | 'module'>('chat');
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const scopeRef = useRef(0);

  useEffect(() => {
    if (world) void workshop.openWorld(buildCustomModuleAgentWorldContext(world));
    return () => useModuleWorkshopStore.getState().stop();
  }, [world, workshop.openWorld]);

  useEffect(() => {
    scopeRef.current += 1;
    setInput(''); setEditId(undefined); setDeleteId(undefined); setRenameId(undefined);
    setNotice(''); setActionError(''); setImportOpen(false); setImportText('');
    stickToBottom.current = true;
  }, [worldId, workshop.activeSessionId]);

  useEffect(() => {
    const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); useModuleWorkshopStore.getState().stop(); onClose(); }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), summary, a[href], [tabindex="0"]') ?? []).filter((element) => element.getClientRects().length > 0);
      const first = focusable[0]; const last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => { window.removeEventListener('keydown', handleKey); scopeRef.current += 1; useModuleWorkshopStore.getState().stop(); priorFocus?.focus(); };
  }, [onClose]);

  useEffect(() => {
    if (stickToBottom.current && historyRef.current) historyRef.current.scrollTop = historyRef.current.scrollHeight;
  }, [session?.messages]);

  const runAction = async (action: () => Promise<unknown>, success?: string) => {
    if (actionBusy) return;
    const scope = scopeRef.current;
    setActionBusy(true); setNotice(''); setActionError('');
    try { await action(); if (scope === scopeRef.current && success) setNotice(success); }
    catch (error) { if (scope === scopeRef.current) setActionError(error instanceof Error ? error.message : String(error)); }
    finally { setActionBusy(false); }
  };
  const disabled = workshop.loading || actionBusy;
  const send = () => {
    const text = input.trim();
    if (!text || workshop.busy || disabled || !apiConfig || !session) return;
    setInput(''); stickToBottom.current = true;
    void runAction(() => workshop.send(text, apiConfig));
  };
  const exportModule = () => {
    if (!revision) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(revision.module, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${revision.module.id}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('模块已导出。');
  };
  const install = () => {
    if (!revision || !world) return;
    const module = revision.module;
    void runAction(async () => {
      await saveCustomGameplayModule(module); await bindCustomGameplayModule(module.id, world.id);
      window.dispatchEvent(new Event('custom-modules-changed'));
    }, `已保存并绑定到「${world.name}」，新游戏将使用此版本。`);
  };
  const publishModule = () => {
    if (!revision) return;
    const module = revision.module;
    void runAction(() => publish({
      type: 'gameplay_module', contentType: 'gameplay_module', title: module.name,
      description: module.description || '通过玩法模块工坊创作的模块。', tags: ['玩法模块'], data: module,
      version: module.version, category: 'gameplay', dependencies: module.dependencies ?? [], compatibility: { moduleSchema: module.schemaVersion },
    }), '模块已发布到创意工坊。');
  };

  return <div className="entry-default-theme custom-module-workspace" role="dialog" aria-modal="true" aria-labelledby="module-workshop-title" ref={dialogRef}>
    <div className="custom-module-workspace-backdrop" />
    <div className="custom-module-workspace-shell">
      <DawnFrameV4 mode="panel" withFill className="custom-module-workspace-frame" ariaLabel="玩法模块工坊">
        <div className="custom-module-workspace-inner">
          <header className="mws-header">
            <div className="mws-title"><Sparkles size={23} /><div><span>DAWN · GAMEPLAY WORKSHOP</span><h2 id="module-workshop-title">玩法模块工坊</h2><p>聊出想法，修改规则，亲手试玩。</p></div></div>
            <div className="mws-header-actions"><label className="mws-world"><WorldIcon name={world?.icon || 'Globe'} size={17} /><span className="mws-sr-only">创作世界</span><select aria-label="创作世界" value={worldId} onChange={(event) => { workshop.stop(); setWorldId(event.target.value); }} disabled={workshop.loading || actionBusy && !workshop.busy}>{worlds.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button ref={closeRef} type="button" className="mws-icon" onClick={() => { workshop.stop(); onClose(); }} aria-label="关闭玩法模块工坊"><X size={20} /></button></div>
          </header>
          <nav className="mws-mobile-nav" aria-label="工坊区域">{([['sessions', '会话'], ['chat', '对话'], ['module', '模块']] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={mobilePane === id} onClick={() => setMobilePane(id)}>{label}</button>)}</nav>
          <div className="mws-body" data-pane={mobilePane}>
            <aside className="mws-sessions" aria-label="创作会话">
              <div className="mws-section-heading"><h3>创作会话</h3><button type="button" className="mws-icon" aria-label="新建会话" disabled={disabled && !workshop.busy || !world} onClick={() => { workshop.stop(); void workshop.createSession().catch((error: unknown) => setActionError(String(error))); }}><Plus size={18} /></button></div>
              <div className="mws-session-list">{workshop.loading ? <p className="mws-muted"><Loader2 className="spin" size={15} /> 正在加载…</p> : workshop.sessions.length === 0 ? <p className="mws-muted">为这个世界新建一个创作会话。</p> : workshop.sessions.map((item) => <div className={`mws-session ${item.id === session?.id ? 'is-active' : ''}`} key={item.id}>
                {renameId === item.id ? <form className="mws-rename" onSubmit={(event) => { event.preventDefault(); if (renameText.trim()) void runAction(async () => { await workshop.renameSession(item.id, renameText.trim()); setRenameId(undefined); }); }}><input aria-label="会话名称" autoFocus value={renameText} maxLength={80} onChange={(event) => setRenameText(event.target.value)} /><button type="submit" className="mws-icon" aria-label="保存名称" disabled={disabled || !renameText.trim()}><Check size={15} /></button><button type="button" className="mws-icon" aria-label="取消重命名" onClick={() => setRenameId(undefined)}><X size={15} /></button></form> : <><button className="mws-session-select" type="button" aria-current={item.id === session?.id ? 'true' : undefined} onClick={() => { workshop.stop(); void workshop.selectSession(item.id).catch((error: unknown) => setActionError(String(error))); setMobilePane('chat'); }}><MessageSquare size={15} /><span>{item.title}</span></button><div className="mws-session-actions"><small>{item.revisions.length ? `${item.revisions.length} 个版本` : '尚无草稿'}</small><button className="mws-icon" type="button" aria-label={`重命名会话 ${item.title}`} disabled={disabled} onClick={() => { setRenameId(item.id); setRenameText(item.title); }}><Pencil size={13} /></button><button className="mws-icon" type="button" aria-label={`删除会话 ${item.title}`} disabled={disabled || workshop.busy} onClick={() => setDeleteId(item.id)}><Trash2 size={13} /></button></div></>}
                {deleteId === item.id && <div className="mws-confirm"><p>删除此会话及其草稿历史？已安装的模块会保留。</p><button type="button" disabled={disabled} onClick={() => void runAction(() => workshop.deleteSession(item.id))}>确认删除</button><button type="button" onClick={() => setDeleteId(undefined)}>取消</button></div>}
              </div>)}</div>
              <button className="mws-button" type="button" disabled={disabled || workshop.busy || !session} onClick={() => { setImportOpen(!importOpen); setMobilePane('chat'); }}><Upload size={15} /> 导入模块</button>
              <p className="mws-footnote">聊天记录与模块版本分别保存。删除消息不会撤销草稿修改。</p>
            </aside>
            <section className="mws-chat" aria-label="与 Agent 对话">
              <div className="mws-section-heading"><h3>{session?.title || '开始创作'}</h3><span className="mws-status" role="status">{workshop.busy ? <><Loader2 size={13} className="spin" /> 正在创作</> : revision ? `草稿 v${revision.number}` : '准备就绪'}</span></div>
              {importOpen && <section className="mws-import" aria-label="导入模块 JSON"><div className="mws-section-heading"><h4>导入模块</h4><button className="mws-icon" type="button" aria-label="关闭导入" onClick={() => setImportOpen(false)}><X size={16} /></button></div><label>选择 JSON 文件<input type="file" accept=".json,application/json" disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; if (file) { if (file.size > 1024 * 1024) { setActionError('模块文件不能超过 1 MB。'); return; } void file.text().then(setImportText).catch((error: unknown) => setActionError(String(error))); } }} /></label><textarea aria-label="模块 JSON" value={importText} onChange={(event) => setImportText(event.target.value)} rows={5} placeholder="或在这里粘贴模块 JSON" /><button type="button" className="mws-button" disabled={disabled || !importText.trim()} onClick={() => void runAction(async () => { await workshop.importModule(importText); setImportOpen(false); setImportText(''); }, '模块已导入为新草稿版本。')}>校验并导入</button></section>}
              <div className="mws-chat-history" ref={historyRef} onScroll={() => { const element = historyRef.current; if (element) stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 70; }}>
                {!session?.messages.length && <div className="mws-empty-chat"><Sparkles size={30} /><h3>把一个玩法想法变成现实</h3><p>描述玩家要做什么、需要付出什么，以及会获得什么。Agent 会通过工具逐步创建和校验模块。</p><button type="button" className="mws-suggestion" onClick={() => setInput('帮我做一个制作台：消耗金币和材料获得物品，显示资源和制作按钮。')}>制作台：消耗金币和材料，获得物品 <Send size={14} /></button></div>}
                {session?.messages.map((message) => <article className={`mws-message ${message.role}`} key={message.id}>
                  <header><span>{message.role === 'user' ? '你' : '共创 Agent'}</span><small>{message.status === 'stopped' ? '已停止' : message.status === 'failed' ? '未完成' : message.status === 'running' ? '进行中' : ''}</small></header>
                  {editId === message.id ? <div className="mws-edit-message"><textarea aria-label="编辑消息" autoFocus rows={4} value={editText} onChange={(event) => setEditText(event.target.value)} /><p className="mws-footnote">从这条消息重建后续对话，现有模块版本会保留。</p><div className="mws-actions"><button className="mws-button" type="button" disabled={disabled || workshop.busy || !editText.trim() || !apiConfig} onClick={() => { if (apiConfig) { setEditId(undefined); void runAction(() => workshop.editMessage(message.id, editText.trim(), apiConfig)); } }}>编辑并重发</button><button className="mws-button" type="button" onClick={() => setEditId(undefined)}>取消</button></div></div> : message.parts.map((part, index) => part.type === 'text' ? <Markdown key={index} text={part.text} /> : <details className={`mws-tool ${part.status}`} key={part.toolCallId}><summary>{part.status === 'running' ? <Loader2 size={14} className="spin" /> : part.status === 'failed' ? <X size={14} /> : <Check size={14} />}<span>{toolLabels[part.name] ?? part.name}</span><small>{part.status === 'running' ? '执行中' : part.status === 'failed' ? '失败' : '完成'}</small></summary><h5>参数</h5><pre>{JSON.stringify(part.input, null, 2)}</pre>{part.output !== undefined && <><h5>结果</h5><pre>{JSON.stringify(part.output, null, 2)}</pre></>}</details>)}
                  {message.status !== 'running' && editId !== message.id && <div className="mws-message-actions">{message.role === 'user' ? <button type="button" disabled={disabled || workshop.busy} onClick={() => { setEditId(message.id); setEditText(messageText(message)); }}><Pencil size={13} /> 编辑重发</button> : <button type="button" disabled={disabled || workshop.busy || !apiConfig} onClick={() => { if (apiConfig) void runAction(() => workshop.regenerate(message.id, apiConfig)); }}><RotateCcw size={13} /> 重新生成</button>}<button type="button" disabled={disabled || workshop.busy} onClick={() => void runAction(() => workshop.deleteMessage(message.id))}><Trash2 size={13} /> 删除</button></div>}
                </article>)}
              </div>
              {(workshop.error || actionError) && <div className="mws-error" role="alert">{actionError || workshop.error}</div>}
              {notice && <div className="mws-notice" role="status"><Check size={15} />{notice}</div>}
              <form className="mws-composer" onSubmit={(event) => { event.preventDefault(); send(); }}><label className="mws-sr-only" htmlFor="workshop-message">描述你的玩法或修改要求</label><textarea id="workshop-message" value={input} onChange={(event) => setInput(event.target.value)} placeholder="描述你的玩法，或告诉 Agent 想修改哪里…" rows={3} disabled={workshop.loading || !session} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} /><div className="mws-composer-footer"><span>{!apiConfig ? '请先在设置中配置支持工具调用的模型。' : 'Enter 发送 · Shift + Enter 换行'}</span>{workshop.busy ? <button type="button" className="mws-button" onClick={workshop.stop}><Square size={14} /> 停止</button> : <button type="submit" className="mws-primary" disabled={disabled || !input.trim() || !apiConfig || !session}><Send size={15} />发送</button>}</div></form>
            </section>
            <section className="mws-module" aria-label="模块草稿">
              <div className="mws-section-heading"><h3><History size={16} /> 模块草稿</h3>{revision && <span className="mws-status">v{revision.number}</span>}</div>
              <WorkshopModulePanel key={`${session?.id}:${revision?.id}`} worldId={worldId} revision={revision} revisions={session?.revisions ?? []} disabled={disabled || workshop.busy} onRestore={(id) => void runAction(() => workshop.restoreRevision(id), '已生成回退版本。')} />
              <footer className="mws-module-footer"><button type="button" className="mws-primary" disabled={!revision || disabled || workshop.busy} onClick={install}><Save size={15} />保存并绑定世界</button><div className="mws-actions"><button type="button" className="mws-button" disabled={!revision || disabled} onClick={exportModule}><Download size={14} />导出</button><button type="button" className="mws-button" disabled={!revision || disabled || workshop.busy} onClick={publishModule}><Upload size={14} />发布到创意工坊</button></div></footer>
            </section>
          </div>
        </div>
      </DawnFrameV4>
    </div>
  </div>;
}

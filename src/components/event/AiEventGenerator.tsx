// ============================================================
//  AI 合集生成器 — 选世界后一键生成事件+规则合集
// ============================================================
import { useCallback,useEffect,useRef,useState,useMemo } from 'react';
import '../../ui/screens/event-workbench.css';
import {
ArrowLeft,Sparkles,Loader2,Check,AlertTriangle,
RefreshCw,Wand2,BookOpen,ChevronDown,
} from 'lucide-react';
import { useIsPhone } from '../../hooks/useIsMobile';
import { useConfigStore } from '../../stores/configStore';
import { requestStreamWithRetry } from '../../api/client';
import { generateWithRepair, parseJsonObject } from '../../api/generateWithRepair';
import { getAllWorlds,findWorldDef } from '../../data/worldLoader';
import type { WorldDef } from '../../data/worlds-schema';
import type { EventIndexEntry,Manifest,CardWorkflowDefinition } from '../../modules/schema';
import { putWebEvent } from '../../modules/eventDb';
import type { WebEventRecord } from '../../modules/eventDb';
import { buildGeneratedBundle, buildRepairMessage, generatorReference, validateGeneratedBundle, type GeneratedBundle } from '../../events/generatedBundle';
import type { EventIssue } from '../../events/validate';
import {
buildEventGeneratorPrompt,
buildEventGeneratorUserMessage,
} from '../../utils/prompts/event-generator';

type GenState = 'input' | 'generating' | 'preview' | 'error';

interface GeneratedPreview {
  bundleName: string;
  eventCount: number;
  ruleCount: number;
  nodeCount: number;
  /** 修复后仍未解决的校验问题。 */
  issues: string[];
}

export interface AiEventGeneratorProps {
  onBack: () => void;
  onSaved: (packId: string, type: 'card' | 'rule') => void;
}

export default function AiEventGenerator({ onBack, onSaved }: AiEventGeneratorProps) {
  const isPhone = useIsPhone();
  const apiConfig = useConfigStore(s => s.apiConfig);

  // ── 表单状态 ──
  const [selectedWorldId, setSelectedWorldId] = useState<string>('');
  const [extraRequest, setExtraRequest] = useState('');

  // ── 生成状态 ──
  const [genState, setGenState] = useState<GenState>('input');
  const [streamText, setStreamText] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [preview, setPreview] = useState<GeneratedPreview | null>(null);
  const [savedCardPackId, setSavedCardPackId] = useState<string | null>(null);
  const [savedRulePackId, setSavedRulePackId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // ── 世界列表 ──
  const worlds = useMemo(() => getAllWorlds(), []);
  const selectedWorld = useMemo(() => selectedWorldId ? findWorldDef(selectedWorldId) : undefined, [selectedWorldId]);

  // ── 自动选中第一个世界 ──
  useEffect(() => {
    if (worlds.length > 0 && !selectedWorldId) {
      setSelectedWorldId(worlds[0].id);
    }
  }, [worlds, selectedWorldId]);

  // ── 清理 ──
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  // ── 取消生成 ──
  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    setGenState('input');
    setStreamText('');
  }, []);

  // ── 开始生成 ──
  const handleGenerate = useCallback(async () => {
    if (!apiConfig) {
      setErrorMsg('请先在设置中配置 API');
      setGenState('error');
      return;
    }
    if (!selectedWorldId) {
      setErrorMsg('请选择一个世界');
      setGenState('error');
      return;
    }

    const world = findWorldDef(selectedWorldId);
    if (!world) {
      setErrorMsg('未找到选定的世界');
      setGenState('error');
      return;
    }

    setGenState('generating');
    setStreamText('');
    setErrorMsg('');

    const controller = new AbortController();
    abortRef.current = controller;

    const wbEntries = (world.worldBookEntries ?? []).map(e => ({
      comment: e.comment,
      content: e.content,
    }));

    const moduleNames = (world.modules ?? []).filter(m => m.enabled).map(m => m.name);

    // ── 从世界定义中提取实际可选值 ──
    const statKeys = ['attrA', 'attrB', 'dim1', 'dim2', 'dim3', 'dim4', 'dim5', 'dim6'];
    const statNames: Record<string, string> = {};
    const resources: Array<{ id: string; name: string }> = [];
    const assets: Array<{ id: string; name: string }> = [];
    const npcNames: string[] = [];
    const factionNames: string[] = [];

    // 从模块提取属性名、资源、资产
    for (const mod of world.modules ?? []) {
      if (!mod.enabled || !mod.moduleConfig) continue;
      const cfg = mod.moduleConfig;

      // 数值属性模块
      if (mod.moduleId === 'stat') {
        if (cfg.attrA && typeof cfg.attrA === 'object') {
          const a = cfg.attrA as Record<string, unknown>;
          if (a.name) statNames['attrA'] = String(a.name);
        }
        if (cfg.attrB && typeof cfg.attrB === 'object') {
          const b = cfg.attrB as Record<string, unknown>;
          if (b.name) statNames['attrB'] = String(b.name);
        }
        for (let i = 1; i <= 6; i++) {
          const key = `dim${i}`;
          const dim = cfg[key];
          if (dim && typeof dim === 'object' && (dim as Record<string, unknown>).name) {
            statNames[key] = String((dim as Record<string, unknown>).name);
          }
        }
      }

      // 生存资源模块
      if (mod.moduleId === 'survival' && Array.isArray(cfg.resources)) {
        for (const r of cfg.resources as Array<Record<string, unknown>>) {
          if (r.id && r.name) resources.push({ id: String(r.id), name: String(r.name) });
        }
      }

      // 经营资产模块
      if (mod.moduleId === 'business' && Array.isArray(cfg.assets)) {
        for (const a of cfg.assets as Array<Record<string, unknown>>) {
          if (a.id && a.name) assets.push({ id: String(a.id), name: String(a.name) });
        }
      }
    }

    // 从世界书条目提取 NPC 和势力
    for (const entry of world.worldBookEntries ?? []) {
      if (entry.entryType === 'npcs' && entry.meta?.npcs) {
        for (const npc of entry.meta.npcs) {
          if (npc.name) npcNames.push(npc.name);
        }
      }
      if (entry.entryType === 'factions' && entry.meta?.factions) {
        for (const f of entry.meta.factions) {
          if (f.name) factionNames.push(f.name);
        }
      }
    }

    const reference = generatorReference(world);
    for (const special of ((world.modules ?? []).find(item => item.moduleId === 'stat' && item.enabled)?.moduleConfig as { special?: Array<{ id?: string; name?: string }> } | undefined)?.special ?? []) {
      if (special?.id && !statKeys.includes(special.id)) { statKeys.push(special.id); statNames[special.id] = special.name || special.id; }
    }
    const options = {
      variables: reference.variables,
      commands: reference.commands,
      domainEvents: reference.domainEvents,
      worldName: world.name,
      worldDescription: world.description,
      worldBookEntries: wbEntries,
      moduleNames,
      extraRequest: extraRequest.trim() || undefined,
      statKeys,
      statNames,
      resources,
      assets,
      npcNames,
      factionNames,
    };

    const systemPrompt = buildEventGeneratorPrompt(options);
    const userMessage = buildEventGeneratorUserMessage(options);

    try {
      const stamp = Date.now();
      const ids = { card: `ai-card-${stamp}`, rule: `ai-rule-${stamp}` };
      // 生成 → 校验 → 修复：格式坏了或引用了本世界没有的东西，就把原因交回 AI 修一次，取错误更少的版本。
      const { value: bundle, issues } = await generateWithRepair({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        request: async messages => (await requestStreamWithRetry(apiConfig, messages, {
          signal: controller.signal,
          onDelta: (_delta, accumulated) => setStreamText(accumulated),
          maxTokens: 32768,
          responseFormat: 'json',
        })).text,
        parse: text => buildGeneratedBundle(parseJsonObject(text), world, ids),
        validate: candidate => validateGeneratedBundle(candidate, world),
        repairPrompt: buildRepairMessage,
        onRepair: ({ reason, detail }) => setStreamText(previous => `${previous}\n\n——${reason === 'format' ? `格式无法解析（${detail}）` : `校验发现 ${detail}`}，正在请 AI 修正……`),
      });
      await saveBundle(bundle, issues);

    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        setGenState('input');
        return;
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[AI生成] 失败:', err);
      setErrorMsg(errMsg);
      setGenState('error');
    }
  }, [apiConfig, selectedWorldId, extraRequest]);

  // ── 保存合集（事件包 + 规则包各一个） ──
  const saveBundle = useCallback(async (bundle: GeneratedBundle, issues: EventIssue[]) => {
    try {
      await putWebEvent({
        id: bundle.card.id, manifest: bundle.card.manifest, enabled: false, status: 'installed',
        installedAt: new Date().toISOString(), files: bundle.card.files,
      } as WebEventRecord);
      setSavedCardPackId(bundle.card.id);
      if (bundle.rule) {
        await putWebEvent({
          id: bundle.rule.id, manifest: bundle.rule.manifest, enabled: false, status: 'installed',
          installedAt: new Date().toISOString(), files: bundle.rule.files,
        } as WebEventRecord);
        setSavedRulePackId(bundle.rule.id);
      }
      setPreview({
        bundleName: bundle.bundleName,
        eventCount: bundle.eventCount,
        ruleCount: bundle.ruleCount,
        nodeCount: bundle.nodeCount,
        issues: issues.slice(0, 12).map(issue => `${issue.level === 'error' ? '错误' : '提示'}：${issue.key.split('/').pop()}${issue.option !== undefined ? ` 第${issue.option + 1}个选项` : ''} ${issue.message}`),
      });
      setGenState('preview');
    } catch (err) {
      console.error('[AI生成] 保存失败:', err);
      setErrorMsg('保存失败：' + (err instanceof Error ? err.message : String(err)));
      setGenState('error');
    }
  }, []);

  // ── 重新生成 ──
  const handleRegenerate = useCallback(() => {
    setGenState('input');
    setStreamText('');
    setPreview(null);
    setSavedCardPackId(null);
    setSavedRulePackId(null);
  }, []);

  // ── 确认使用 ──
  const handleConfirm = useCallback(() => {
    // 优先打开事件包编辑器
    if (savedCardPackId) {
      onSaved(savedCardPackId, 'card');
    } else if (savedRulePackId) {
      onSaved(savedRulePackId, 'rule');
    }
  }, [savedCardPackId, savedRulePackId, onSaved]);

  // ── 渲染 ──
  return (
    <div className="pk-workbench" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 顶部栏 */}
      <div className="pk-workbench__bar" style={{
        padding: isPhone ? 'var(--space-2) var(--space-3)' : 'var(--space-3) var(--space-4)',
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        flexShrink: 0,
      }}>
        <button onClick={onBack} className="btn-ghost btn-sm" title="返回">
          <ArrowLeft size={16} />
        </button>
        <Sparkles size={18} style={{ color: 'var(--accent)' }} />
        <span className="pk-workbench__title" style={{ fontWeight: 600, fontSize: isPhone ? 'var(--font-size-md)' : 'var(--font-size-lg)' }}>
          AI 合集生成器
        </span>
      </div>

      {/* 内容区 */}
      <div style={{ flex: 1, overflow: 'auto', padding: isPhone ? 'var(--space-4)' : 'var(--space-6)' }}>
        {/* 输入状态 */}
        {genState === 'input' && (
          <div className="event-fade-in" style={{ maxWidth: 640, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {/* 说明 */}
            <div className="pk-workbench__intro" style={{
              padding: 'var(--space-3) var(--space-4)',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--text-secondary)',
              lineHeight: 1.6,
            }}>
              <div style={{ fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Wand2 size={14} /> AI 合集生成器
              </div>
              选择一个世界，AI 会根据世界书自动生成一套包含事件和规则的完整内容合集。生成后可以直接导入使用，也可以在编辑器中修改。
            </div>

            {/* 选择世界 */}
            <div>
              <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <BookOpen size={14} /> 选择世界
              </label>
              <div style={{ position: 'relative' }}>
                <select
                  value={selectedWorldId}
                  onChange={e => setSelectedWorldId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    paddingRight: 36,
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--text-primary)',
                    fontSize: 'var(--font-size-base)',
                    appearance: 'none',
                    cursor: 'pointer',
                  }}
                >
                  {worlds.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
                <ChevronDown size={16} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
              </div>
              {selectedWorld && (
                <div style={{ marginTop: 6, fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  {selectedWorld.description}
                  {selectedWorld.worldBookEntries && selectedWorld.worldBookEntries.length > 0 && (
                    <span style={{ marginLeft: 8, color: 'var(--accent)' }}>
                      · {selectedWorld.worldBookEntries.length} 条世界书
                    </span>
                  )}
                  {selectedWorld.modules && selectedWorld.modules.filter(m => m.enabled).length > 0 && (
                    <span style={{ marginLeft: 8, color: 'var(--accent)' }}>
                      · {selectedWorld.modules.filter(m => m.enabled).length} 个模块
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* 额外要求（可选） */}
            <div>
              <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8, display: 'block' }}>
                额外要求 <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(可选)</span>
              </label>
              <textarea
                value={extraRequest}
                onChange={e => setExtraRequest(e.target.value)}
                placeholder="例如：侧重战斗和探索、多加一些随机事件、要有商人交易系统..."
                rows={3}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  fontSize: 'var(--font-size-base)',
                  fontFamily: 'var(--font-body)',
                  resize: 'vertical',
                  lineHeight: 1.6,
                }}
              />
            </div>

            {/* 生成按钮 */}
            <button
              className="btn-primary"
              onClick={handleGenerate}
              disabled={!apiConfig || !selectedWorldId}
              style={{
                width: '100%',
                padding: '14px',
                fontSize: 'var(--font-size-md)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <Sparkles size={18} /> 一键生成合集
            </button>

            {!apiConfig && (
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--danger)', textAlign: 'center' }}>
                请先在设置中配置 API
              </div>
            )}
          </div>
        )}

        {/* 生成中状态 */}
        {genState === 'generating' && (
          <div className="event-fade-in" style={{ maxWidth: 640, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              color: 'var(--accent)', fontWeight: 600,
              fontSize: 'var(--font-size-md)',
            }}>
              <Loader2 size={20} className="animate-spin" />
              AI 正在根据世界书生成内容...
            </div>

            <div style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-3) var(--space-4)',
              maxHeight: 400,
              overflow: 'auto',
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 'var(--font-size-xs)',
              lineHeight: 1.6,
              color: 'var(--text-secondary)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}>
              {streamText || '等待 AI 响应...'}
            </div>

            <button
              className="btn-secondary"
              onClick={handleCancel}
              style={{ width: '100%', padding: '10px' }}
            >
              取消生成
            </button>
          </div>
        )}

        {/* 预览状态 */}
        {genState === 'preview' && preview && (
          <div className="event-fade-in" style={{ maxWidth: 640, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              color: 'var(--success)', fontWeight: 600,
              fontSize: 'var(--font-size-md)',
            }}>
              <Check size={20} /> 生成完成
            </div>

            <div style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--space-4)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)',
            }}>
              <div style={{ fontWeight: 600, fontSize: 'var(--font-size-lg)', color: 'var(--text-primary)' }}>
                {preview.bundleName}
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-4)', fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
                <span>📦 事件 <b>{preview.eventCount}</b> 个</span>
                <span>⚡ 规则 <b>{preview.ruleCount}</b> 条</span>
                <span>🔧 节点 <b>{preview.nodeCount}</b> 个</span>
              </div>
              {preview.issues.length > 0 ? (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', lineHeight: 1.6 }} aria-label="校验问题">
                  {preview.issues.map(issue => <li key={issue}>{issue}</li>)}
                </ul>
              ) : (
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--success)' }}>已通过校验：属性、物资、命令与后续事件都能在这个世界找到。</div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button
                className="btn-secondary"
                onClick={handleRegenerate}
                style={{ flex: 1, padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <RefreshCw size={16} /> 重新生成
              </button>
              <button
                className="btn-primary"
                onClick={handleConfirm}
                style={{ flex: 1, padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <Check size={16} /> 使用合集
              </button>
            </div>

            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', textAlign: 'center' }}>
              事件包和规则包将自动导入到事件中心，并打开编辑器供你修改
            </div>
          </div>
        )}

        {/* 错误状态 */}
        {genState === 'error' && (
          <div className="event-fade-in" style={{ maxWidth: 640, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              color: 'var(--danger)', fontWeight: 600,
              fontSize: 'var(--font-size-md)',
            }}>
              <AlertTriangle size={20} /> 生成失败
            </div>

            <div style={{
              background: 'var(--danger-bg-soft, var(--bg-secondary))',
              border: '1px solid var(--danger)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-3) var(--space-4)',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--danger)',
              lineHeight: 1.6,
            }}>
              {errorMsg}
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button
                className="btn-secondary"
                onClick={() => { setGenState('input'); setErrorMsg(''); }}
                style={{ flex: 1, padding: '10px' }}
              >
                返回
              </button>
              <button
                className="btn-primary"
                onClick={handleGenerate}
                style={{ flex: 1, padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <RefreshCw size={16} /> 重试
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

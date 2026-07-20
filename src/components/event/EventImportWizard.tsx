import { useCallback, useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import {
  ArrowLeft, Upload, FileCheck, ShieldCheck, AlertTriangle, Check, X, FileWarning, Package,
} from 'lucide-react';
import type { Manifest, ValidationResult, ValidationIssue, EventPackType } from '../../modules/schema';
import type { UseEventsResult } from './useEvents';
import { StatusBadge, EventTypeBadge } from './StatusBadge';
import { EmptyState } from './EmptyState';
import { resolveEventIcon } from './eventIcons';
import { textOn } from './colorUtils';

/* 导入导出向导：选文件 → 校验 → 冲突 → 预览确认。
   校验优先调用 eventApi.validate（Rust validate_event）；非 Tauri 环境下回退到本地结构化校验，
   二者合并展示。错误码沿用 API 文档的 EventErrorCode（MANIFEST_* 等）。 */

const APP_VERSION = '2.6.5';
const ID_RE = /^[a-z0-9][a-z0-9_-]{2,63}$/;
const VER_RE = /^\d+\.\d+\.\d+$/;

const STEPS = ['选文件', '校验', '冲突', '预览'] as const;

function semverGte(have: string, need: string): boolean {
  const a = have.split('.').map(Number);
  const b = need.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return true;
}

/** 本地结构化校验（Rust 不可用时回退） */
function localValidate(m: Manifest): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  if (!m.id) errors.push({ code: 'MANIFEST_MISSING_FIELD', field: 'id', message: '缺少必需字段 id' });
  else if (!ID_RE.test(m.id)) errors.push({ code: 'MANIFEST_INVALID', field: 'id', message: `id 不符合 ^[a-z0-9][a-z0-9_-]{2,63}$（${m.id}）` });
  if (!m.version) errors.push({ code: 'MANIFEST_MISSING_FIELD', field: 'version', message: '缺少必需字段 version' });
  else if (!VER_RE.test(m.version)) errors.push({ code: 'MANIFEST_INVALID', field: 'version', message: `version 需为 主.次.修（${m.version}）` });
  if (!m.name) errors.push({ code: 'MANIFEST_MISSING_FIELD', field: 'name', message: '缺少必需字段 name' });
  if (!m.type) errors.push({ code: 'MANIFEST_MISSING_FIELD', field: 'type', message: '缺少必需字段 type' });
  if (!m.coverColor) warnings.push({ code: 'WARNING', field: 'coverColor', message: '未设置封面色（建议补充）' });
  else if (/gradient|linear|radial/i.test(m.coverColor)) errors.push({ code: 'MANIFEST_INVALID', field: 'coverColor', message: '封面色禁止为渐变，必须为实色块' });
  if (!m.icon) warnings.push({ code: 'WARNING', field: 'icon', message: '未设置图标' });
  if (m.engine && m.engine !== 'opt-event') errors.push({ code: 'MANIFEST_INVALID', field: 'engine', message: `engine 必须为 opt-event（${m.engine}）` });
  return { ok: errors.length === 0, errors, warnings };
}

export interface EventImportWizardProps {
  eventApi: UseEventsResult;
  eventPackId: string | null;
  onClose: () => void;
}

export default function EventImportWizard({ eventApi, onClose }: EventImportWizardProps) {
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [cardCount, setCardCount] = useState(0);
  const [ruleCount, setRuleCount] = useState(0);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [conflictAction, setConflictAction] = useState<'overwrite' | 'rename' | 'cancel'>('overwrite');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const existing = manifest ? eventApi.packs.find((m) => m.meta.id === manifest.id) : undefined;
  const missingDeps = manifest?.dependencies?.filter((d) => !eventApi.packs.some((m) => m.meta.id === d)) ?? [];
  const versionIncompatible = manifest ? !semverGte(APP_VERSION, manifest.minAppVersion) : false;

  const readFile = useCallback(async (f: File) => {
    setFile(f);
    setResult(null);
    setValidation(null);
    try {
      const zip = await JSZip.loadAsync(f);
      const mFile = zip.file('manifest.json');
      if (!mFile) throw new Error('压缩包内缺少 manifest.json');
      const manifestText = await mFile.async('string');
      const m = JSON.parse(manifestText) as Manifest;
      const card = zip.file('schema/card.json');
      const rules = zip.file('schema/rules.json');
      setCardCount(card ? 1 : 0);
      setRuleCount(rules ? 1 : 0);
      setManifest(m);
      setStep(1);
    } catch (e) {
      setManifest(null);
      setResult({ ok: false, message: '文件无法解析，请确认是有效的 .opt-event 包：' + (e instanceof Error ? e.message : String(e)) });
    }
  }, []);

  // 进入校验步骤：优先 Rust 校验，回退本地校验
  useEffect(() => {
    if (step !== 1 || !manifest) return;
    let cancelled = false;
    setValidating(true);
    setValidation(null);
    (async () => {
      const local = localValidate(manifest);
      let merged: ValidationResult = local;
      try {
        const remote = await eventApi.validate(manifest);
        if (remote) {
          merged = {
            ok: local.ok && remote.ok,
            errors: [...local.errors, ...remote.errors],
            warnings: [...local.warnings, ...remote.warnings],
          };
        }
      } catch {
        // 非 Tauri 环境：仅用本地校验
      }
      if (!cancelled) {
        setValidation(merged);
        setValidating(false);
      }
    })();
    return () => { cancelled = true; };
  }, [step, manifest, eventApi]);

  const canNext = step === 0 ? !!manifest && !result : step === 1 ? (validation?.ok ?? false) : step === 2 ? conflictAction !== 'cancel' : true;

  const handleImport = async () => {
    setImporting(true);
    setResult(null);
    try {
      const meta = await eventApi.importPack({ file: file ?? undefined });
      // import 在桌面端无文件 / 失败时会返回 null（useEvents 内部已吞掉错误并写入 error）
      if (!meta) {
        const reason = eventApi.error ?? '导入未完成，请重试。';
        setResult({
          ok: false,
          message: `导入未完成：${reason}`,
        });
        return;
      }
      setResult({ ok: true, message: '导入成功，已加入本地事件库。' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setResult({ ok: false, message: `导入失败：${msg}` });
    } finally {
      setImporting(false);
    }
  };

  const Icon = manifest ? resolveEventIcon(manifest.icon, manifest.type as EventPackType) : Package;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-6)' }}>
      <div className="event-fade-in" onClick={(e) => e.stopPropagation()} style={{ width: 'min(620px, var(--overlay-max))', maxHeight: '88vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', color: 'var(--text-primary)', overflow: 'hidden' }}>
        {/* 头部 + 步骤条 */}
        <div style={{ padding: 'var(--space-4)', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
            <h2 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600, fontFamily: 'var(--font-display)', margin: 0 }}>导入 .opt-event 向导</h2>
            <button className="btn-ghost btn-sm" onClick={onClose} aria-label="关闭" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}><X size={18} /></button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {STEPS.map((label, i) => {
              const active = i === step;
              const done = i < step;
              return (
                <div key={label} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 22, height: 22, borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--font-size-xs)', fontWeight: 700, background: done ? 'var(--success)' : active ? 'var(--accent)' : 'var(--bg-tertiary)', color: done || active ? 'var(--color-on-accent)' : 'var(--text-muted)' }}>
                      {done ? <Check size={13} /> : i + 1}
                    </span>
                    <span style={{ fontSize: 'var(--font-size-sm)', color: active ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: active ? 600 : 400 }}>{label}</span>
                  </div>
                  {i < STEPS.length - 1 && <div style={{ flex: 1, height: 1, background: done ? 'var(--success)' : 'var(--border)', margin: '0 8px' }} />}
                </div>
              );
            })}
          </div>
        </div>

        {/* 内容 */}
        <div style={{ flex: 1, overflow: 'auto', padding: 'var(--space-5)' }}>
          {result && (
            <div style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: result.ok ? 'var(--success-bg-soft)' : 'var(--danger-bg-soft)', border: `1px solid ${result.ok ? 'var(--success)' : 'var(--danger)'}`, color: result.ok ? 'var(--success)' : 'var(--danger)', fontSize: 'var(--font-size-sm)', display: 'flex', gap: 8 }}>
              {result.ok ? <Check size={16} style={{ flexShrink: 0, marginTop: 2 }} /> : <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />}
              <span>{result.message}</span>
            </div>
          )}

          {/* Step 1 选文件 */}
          {step === 0 && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) void readFile(f); }}
              onClick={() => inputRef.current?.click()}
              style={{ border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 'var(--radius-lg)', background: dragOver ? 'var(--accent-dim)' : 'var(--bg-secondary)', padding: 'var(--space-10)', textAlign: 'center', cursor: 'pointer', transition: 'background var(--duration-fast) var(--ease-out)' }}
            >
              <div style={{ width: 64, height: 64, borderRadius: 'var(--radius-lg)', background: 'var(--accent-dim)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto var(--space-3)' }}>
                <Upload size={28} />
              </div>
              <div style={{ fontWeight: 600, fontSize: 'var(--font-size-md)' }}>拖入或点击选择 .opt-event 文件</div>
              <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginTop: 'var(--space-2)' }}>仅本地导入，无在线/评分/发布</div>
              <input ref={inputRef} type="file" accept=".opt-event,.zip" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); }} />
            </div>
          )}

          {/* Step 2 校验 */}
          {step === 1 && (
            <div>
              {validating && <EmptyState icon={FileWarning} title="正在校验…" description="比对 manifest 结构、字段与依赖" />}
              {!validating && validation && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                    {validation.ok ? <FileCheck size={18} style={{ color: 'var(--success)' }} /> : <AlertTriangle size={18} style={{ color: 'var(--danger)' }} />}
                    {validation.ok ? '校验通过，可继续' : `发现 ${validation.errors.length} 个阻塞问题`}
                  </div>
                  {validation.errors.map((i, k) => (
                    <div key={'e' + k} style={{ display: 'flex', gap: 8, fontSize: 'var(--font-size-sm)', color: 'var(--danger)', background: 'var(--danger-bg-soft)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)' }}>
                      <span style={{ fontFamily: 'var(--font-body)', fontWeight: 700 }}>[{i.code}]</span><span>{i.field ? `${i.field}：` : ''}{i.message}</span>
                    </div>
                  ))}
                  {validation.warnings.map((i, k) => (
                    <div key={'w' + k} style={{ display: 'flex', gap: 8, fontSize: 'var(--font-size-sm)', color: 'var(--warning)', background: 'var(--warning-bg-soft)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)' }}>
                      <span style={{ fontFamily: 'var(--font-body)', fontWeight: 700 }}>[{i.code}]</span><span>{i.field ? `${i.field}：` : ''}{i.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 3 冲突 */}
          {step === 2 && manifest && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {existing ? (
                <div style={{ background: 'var(--warning-bg-soft)', border: '1px solid var(--warning)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', fontSize: 'var(--font-size-sm)', color: 'var(--warning)' }}>
                  <div style={{ fontWeight: 600, display: 'flex', gap: 6 }}><AlertTriangle size={15} /> 已存在同 id 事件：{manifest.id}</div>
                  <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {(['overwrite', 'rename', 'cancel'] as const).map((a) => (
                      <label key={a} style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                        <input type="radio" name="conflict" checked={conflictAction === a} onChange={() => setConflictAction(a)} />
                        {a === 'overwrite' ? '覆盖现有事件' : a === 'rename' ? '另存为新版本（保留原事件）' : '取消导入'}
                      </label>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, fontSize: 'var(--font-size-sm)', color: 'var(--success)' }}><Check size={16} /> 无 id 冲突，可安全导入</div>
              )}

              {missingDeps.length > 0 && (
                <div style={{ background: 'var(--warning-bg-soft)', border: '1px solid var(--warning)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', fontSize: 'var(--font-size-sm)', color: 'var(--warning)' }}>
                  <div style={{ fontWeight: 600 }}>缺失依赖：需先安装</div>
                  <div style={{ marginTop: 4 }}>{missingDeps.join('、')}</div>
                </div>
              )}
              {versionIncompatible && (
                <div style={{ background: 'var(--warning-bg-soft)', border: '1px solid var(--warning)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', fontSize: 'var(--font-size-sm)', color: 'var(--warning)' }}>
                  版本不兼容：本应用 {APP_VERSION}，事件要求 ≥ {manifest.minAppVersion}（仍允许导入，但启用可能受限）
                </div>
              )}
              {!existing && missingDeps.length === 0 && !versionIncompatible && (
                <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>未发现依赖或版本冲突。</div>
              )}
            </div>
          )}

          {/* Step 4 预览 */}
          {step === 3 && manifest && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', padding: 'var(--space-3)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                <span style={{ width: 56, height: 56, borderRadius: 'var(--radius-md)', background: manifest.coverColor, display: 'flex', alignItems: 'center', justifyContent: 'center', color: textOn(manifest.coverColor || '#333'), flexShrink: 0 }}><Icon size={26} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 'var(--font-size-lg)', fontFamily: 'var(--font-display)' }}>{manifest.name}</div>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>v{manifest.version} · {manifest.author}</div>
                  {manifest.description && <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.5 }}>{manifest.description}</div>}
                </div>
                <EventTypeBadge type={manifest.type as EventPackType} />
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                <StatusBadge tone="neutral">id: {manifest.id}</StatusBadge>
                <StatusBadge tone="accent">卡片 {cardCount}</StatusBadge>
                <StatusBadge tone="accent">规则 {ruleCount}</StatusBadge>
                {(manifest.permissions ?? []).map((p) => <StatusBadge key={p} tone="success">{p}</StatusBadge>)}
              </div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                确认无误后点击「完成导入」。导入仅写入本地 appData，无在线同步。
              </div>
            </div>
          )}
        </div>

        {/* 底部 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-5)', borderTop: '1px solid var(--border)' }}>
          <button className="btn-ghost btn-sm" onClick={onClose} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><ArrowLeft size={15} /> 取消</button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-2)' }}>
            {step > 0 && <button className="btn-secondary btn-sm" onClick={() => setStep((s) => s - 1)}>上一步</button>}
            {step < 3 ? (
              <button className="btn-primary btn-sm" disabled={!canNext} onClick={() => setStep((s) => s + 1)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>下一步</button>
            ) : (
              <button className="btn-primary btn-sm" disabled={importing || (result?.ok ?? false)} onClick={handleImport} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{importing ? '导入中…' : '完成导入'}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { FileJson, Loader, Plus, Search, Upload, X } from 'lucide-react';
import { PUBLIC_WORKSHOP_TYPES, type PublicWorkshopType } from '../../workshopCatalog';
import { workshopApi, type WorkshopPublishInput } from '../../workshop/api';
import { listPublishableAssets, portableAssetData, type PublishableAsset } from '../../workshop/localAssets';
import { WORKSHOP_LIMITS, isVersion, nextPatchVersion, type WorkshopDependency, type WorkshopItemSummary } from '../../workshop/protocol';
import { localAssetKey, publishLocalAsset, rememberPublication } from '../../workshop/publish';
import { FeedbackNotice, TYPE_META, formatSize, useWorkshopAction } from './shared';

export type PublishMode = 'create' | 'edit' | 'version';

interface Props {
  mode: PublishMode;
  item?: WorkshopItemSummary;
  onDone: (message: string) => void;
  onCancel: () => void;
}

const CATEGORY_OF: Record<PublicWorkshopType, string> = {
  world_package: 'world',
  npc_template: 'character',
  gameplay_module: 'gameplay',
  event_pack: 'story',
  workflow_pack: 'story',
  adventure_pack: 'story',
  visual_theme: 'visual',
};

const MODE_TITLES: Record<PublishMode, string> = {
  create: '发布新作品',
  edit: '编辑作品信息',
  version: '发布新版本',
};

function splitList(value: string, pattern: RegExp): string[] {
  return value.split(pattern).map(entry => entry.trim()).filter(Boolean);
}

interface RefEditorProps {
  label: string;
  kind: 'dependency' | 'recommendation';
  refs: WorkshopDependency[];
  excludeId?: string;
  onChange: (refs: WorkshopDependency[]) => void;
}

/** 依赖 / 推荐编辑：搜索工坊条目添加，或直接粘贴条目 id。 */
function RefEditor({ label, kind, refs, excludeId, onChange }: RefEditorProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WorkshopItemSummary[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const requested = useRef(new Set<string>());

  useEffect(() => {
    // 每个 id 只查一次标题；查不到的保持显示 id。
    const ids = refs.map(ref => ref.id).filter(id => !requested.current.has(id));
    if (!ids.length) return;
    for (const id of ids) requested.current.add(id);
    workshopApi.updates(ids)
      .then(items => setTitles(current => ({ ...current, ...Object.fromEntries(items.map(entry => [entry.id, entry.title])) })))
      .catch(() => {});
  }, [refs]);

  useEffect(() => {
    const text = query.trim();
    if (!text) { setResults([]); return; }
    const timer = setTimeout(() => {
      workshopApi.list({ q: text, pageSize: 6 })
        .then(result => setResults(result.items.filter(entry => entry.id !== excludeId && !refs.some(ref => ref.id === entry.id))))
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, excludeId, refs]);

  const add = (ref: WorkshopDependency, title?: string) => {
    if (refs.some(entry => entry.id === ref.id) || ref.id === excludeId) return;
    onChange([...refs, ref]);
    if (title) setTitles(current => ({ ...current, [ref.id]: title }));
    setQuery('');
    setResults([]);
  };
  const update = (index: number, patch: Partial<WorkshopDependency>) => onChange(refs.map((ref, position) => (position === index ? { ...ref, ...patch } : ref)));
  const pastedId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query.trim()) ? query.trim().toLowerCase() : null;

  return (
    <div className="registry-field ws-refs">
      <span>{label}</span>
      {refs.length > 0 && (
        <ul className="ws-refs__list">
          {refs.map((ref, index) => (
            <li key={ref.id}>
              <b title={ref.id}>{titles[ref.id] ?? ref.id}</b>
              {kind === 'dependency' ? (
                <>
                  <input className="pk-input" value={ref.version ?? ''} onChange={event => update(index, { version: event.target.value || undefined })} placeholder="最低版本" aria-label="最低版本" />
                  <label className="ws-check"><input type="checkbox" checked={Boolean(ref.optional)} onChange={event => update(index, { optional: event.target.checked || undefined })} />可选</label>
                </>
              ) : (
                <input className="pk-input" value={ref.reason ?? ''} maxLength={160} onChange={event => update(index, { reason: event.target.value || undefined })} placeholder="推荐理由（可选）" aria-label="推荐理由" />
              )}
              <button type="button" className="ws-icon-btn" onClick={() => onChange(refs.filter((_, position) => position !== index))} aria-label="移除"><X size={13} /></button>
            </li>
          ))}
        </ul>
      )}
      <label className="ws-search ws-refs__search">
        <Search size={14} aria-hidden="true" />
        <input className="pk-input" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索工坊作品，或粘贴作品 id" />
      </label>
      {(results.length > 0 || pastedId) && (
        <ul className="ws-refs__results">
          {pastedId && !refs.some(ref => ref.id === pastedId) && (
            <li><button type="button" onClick={() => add({ id: pastedId })}><Plus size={13} />按 id 添加 {pastedId.slice(0, 8)}…</button></li>
          )}
          {results.map(result => (
            <li key={result.id}>
              <button type="button" onClick={() => add({ id: result.id, type: result.type, ...(kind === 'dependency' ? { version: result.version } : {}) }, result.title)}>
                <Plus size={13} />{result.title}<small>{TYPE_META[result.type as PublicWorkshopType]?.label ?? result.type} · v{result.version} · {result.author.name}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 发布 / 编辑 / 发新版本的表单（“我的发布”页内联展开）。 */
export default function WorkshopPublishForm({ mode, item, onDone, onCancel }: Props) {
  const [type, setType] = useState<PublicWorkshopType>((item?.type as PublicWorkshopType) ?? 'world_package');
  const [title, setTitle] = useState(item?.title ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [tags, setTags] = useState(item?.tags.join('，') ?? '');
  const [screenshots, setScreenshots] = useState(item?.screenshots.join('\n') ?? '');
  const [version, setVersion] = useState(mode === 'version' && item ? nextPatchVersion(item.version) : '1.0.0');
  const [changelog, setChangelog] = useState('');
  const [minAppVersion, setMinAppVersion] = useState(item?.minAppVersion ?? '');
  const [visibility, setVisibility] = useState<'published' | 'unlisted'>('published');
  const [source, setSource] = useState<'local' | 'file'>('local');
  const [assets, setAssets] = useState<PublishableAsset[] | null>(null);
  const [localId, setLocalId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dependencies, setDependencies] = useState<WorkshopDependency[]>(item?.dependencies ?? []);
  const [recommendations, setRecommendations] = useState<WorkshopDependency[]>(item?.recommendations ?? []);
  const { busy, feedback, setFeedback, run } = useWorkshopAction();
  const needsData = mode !== 'edit';
  const showMeta = mode !== 'version';

  useEffect(() => {
    if (!needsData) return;
    let cancelled = false;
    setAssets(null);
    setLocalId('');
    listPublishableAssets(type).then(list => {
      if (cancelled) return;
      setAssets(list);
      if (list.length === 0) setSource('file');
    }).catch(() => { if (!cancelled) setAssets([]); });
    return () => { cancelled = true; };
  }, [type, needsData]);

  // 从本地资产选择时，标题与说明默认取资产自己的。
  const selected = useMemo(() => assets?.find(asset => asset.id === localId), [assets, localId]);
  useEffect(() => {
    if (mode !== 'create' || !selected) return;
    setTitle(current => current || selected.name);
    setDescription(current => current || selected.desc);
  }, [mode, selected]);

  const problems: string[] = [];
  if (showMeta && !title.trim()) problems.push('请填写标题');
  if (needsData && !isVersion(version)) problems.push('版本号格式应为 x.y.z');
  if (needsData && minAppVersion.trim() && !isVersion(minAppVersion.trim())) problems.push('最低应用版本格式应为 x.y.z');
  if (needsData && source === 'local' && !localId) problems.push('请选择要发布的本地资产');
  if (needsData && source === 'file' && !file) problems.push('请选择 JSON 文件');
  if (needsData && dependencies.some(ref => ref.version && !isVersion(ref.version))) problems.push('依赖的最低版本格式应为 x.y.z');

  const readData = async (): Promise<unknown> => {
    if (source === 'local') {
      if (!selected) throw new Error('请选择要发布的本地资产');
      return portableAssetData(type, selected.raw);
    }
    if (!file) throw new Error('请选择 JSON 文件');
    try {
      return JSON.parse(await file.text());
    } catch {
      throw new Error('文件不是有效的 JSON');
    }
  };

  const submit = async () => {
    const message = await run('submit', async () => {
      const shared = {
        title: title.trim(),
        description: description.trim() || null,
        tags: splitList(tags, /[,，、]/),
        screenshots: splitList(screenshots, /[\n,，]/),
        recommendations,
      };
      if (mode === 'edit' && item) {
        await workshopApi.update(item.id, { ...shared, expectedVersion: item.version });
        return '作品信息已保存';
      }
      const data = await readData();
      const release = { version, changelog: changelog.trim() || null, data, dependencies, minAppVersion: minAppVersion.trim() || null };
      if (mode === 'version' && item) {
        const result = await workshopApi.update(item.id, { ...release, expectedVersion: item.version });
        if (source === 'local' && localId) await rememberPublication(localAssetKey(item.type as PublicWorkshopType, localId), { id: item.id, type: item.type as PublicWorkshopType, title: item.title }, result.version);
        return `已发布新版本 v${result.version}`;
      }
      const input: WorkshopPublishInput = { ...shared, ...release, type, category: CATEGORY_OF[type], status: visibility };
      if (source === 'local') {
        const outcome = await publishLocalAsset(localAssetKey(type, localId), input);
        return outcome.created ? `已发布「${input.title}」v${outcome.version}` : `这个本地资产之前发布过，已作为新版本 v${outcome.version} 更新原作品`;
      }
      const created = await workshopApi.create(input);
      return `已发布「${input.title}」v${created.version}`;
    });
    if (message) onDone(message);
  };

  return (
    <section className="ws-form" aria-label={MODE_TITLES[mode]}>
      <header className="ws-form__head">
        <strong>{MODE_TITLES[mode]}{item ? `：${item.title}` : ''}</strong>
        <button type="button" className="ws-icon-btn" onClick={onCancel} aria-label="关闭表单"><X size={15} /></button>
      </header>

      {mode === 'create' && (
        <div className="registry-field">
          <span>类型</span>
          <div className="registry-type-tabs ws-type-picker" role="radiogroup" aria-label="作品类型">
            {PUBLIC_WORKSHOP_TYPES.map(entry => (
              <button type="button" key={entry} role="radio" aria-checked={type === entry} aria-pressed={type === entry} onClick={() => setType(entry)}>{TYPE_META[entry].label}</button>
            ))}
          </div>
          <small className="ws-hint">{TYPE_META[type].hint}</small>
        </div>
      )}

      {needsData && (
        <div className="registry-field">
          <span>内容来源</span>
          <div className="ws-segment" role="radiogroup" aria-label="内容来源">
            <label><input type="radio" checked={source === 'local'} onChange={() => setSource('local')} disabled={assets?.length === 0} />本地资产</label>
            <label><input type="radio" checked={source === 'file'} onChange={() => setSource('file')} />JSON 文件</label>
          </div>
          {source === 'local' ? (
            assets === null ? <small className="ws-hint"><Loader size={12} className="animate-spin" />正在读取本地资产…</small>
              : assets.length === 0 ? <small className="ws-hint">本机还没有{TYPE_META[type].label}，可以改用 JSON 文件。</small>
                : (
                  <select className="pk-input" value={localId} onChange={event => setLocalId(event.target.value)}>
                    <option value="">选择一个{TYPE_META[type].label}</option>
                    {assets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
                  </select>
                )
          ) : (
            <label className={`registry-file${file ? ' has-file' : ''}`}>
              <input type="file" accept=".json,application/json" onChange={event => setFile(event.target.files?.[0] ?? null)} />
              <FileJson aria-hidden="true" />
              <b>{file ? file.name : '选择 JSON 文件'}</b>
              <small>{file ? formatSize(file.size) : `不超过 ${formatSize(WORKSHOP_LIMITS.dataBytes)}`}</small>
            </label>
          )}
        </div>
      )}

      {showMeta && (
        <>
          <label className="registry-field"><span>标题 *</span>
            <input className="pk-input" value={title} maxLength={WORKSHOP_LIMITS.title} onChange={event => setTitle(event.target.value)} placeholder="给作品起个名字" />
          </label>
          <label className="registry-field"><span>说明</span>
            <textarea className="pk-input" rows={4} maxLength={WORKSHOP_LIMITS.description} value={description} onChange={event => setDescription(event.target.value)} placeholder="玩法、适用的世界、注意事项……" />
          </label>
          <div className="ws-form__grid">
            <label className="registry-field"><span>标签（逗号分隔）</span>
              <input className="pk-input" value={tags} onChange={event => setTags(event.target.value)} placeholder="奇幻，冒险" />
            </label>
            {mode === 'create' && (
              <label className="registry-field"><span>可见性</span>
                <select className="pk-input" value={visibility} onChange={event => setVisibility(event.target.value as 'published' | 'unlisted')}>
                  <option value="published">公开（出现在发现页）</option>
                  <option value="unlisted">不公开列出（只能凭链接或依赖安装）</option>
                </select>
              </label>
            )}
          </div>
          <label className="registry-field"><span>截图链接（最多 {WORKSHOP_LIMITS.screenshots} 张，每行一个 https 链接）</span>
            <textarea className="pk-input" rows={2} value={screenshots} onChange={event => setScreenshots(event.target.value)} placeholder="https://example.com/shot.webp" />
          </label>
          <RefEditor label="推荐搭配（只展示，不会自动安装）" kind="recommendation" refs={recommendations} excludeId={item?.id} onChange={setRecommendations} />
        </>
      )}

      {needsData && (
        <>
          <div className="ws-form__grid">
            <label className="registry-field"><span>版本号 *</span>
              <input className="pk-input" value={version} onChange={event => setVersion(event.target.value)} placeholder="1.0.0" />
            </label>
            <label className="registry-field"><span>最低应用版本</span>
              <input className="pk-input" value={minAppVersion} onChange={event => setMinAppVersion(event.target.value)} placeholder="不限制" />
            </label>
          </div>
          {mode === 'version' && item && <small className="ws-hint">当前版本 v{item.version}，新版本号必须更高。</small>}
          <label className="registry-field"><span>更新说明</span>
            <textarea className="pk-input" rows={2} maxLength={WORKSHOP_LIMITS.changelog} value={changelog} onChange={event => setChangelog(event.target.value)} placeholder={mode === 'version' ? '这一版改了什么' : '首个版本可以不写'} />
          </label>
          <RefEditor label="依赖（安装时会先装好这些作品）" kind="dependency" refs={dependencies} excludeId={item?.id} onChange={setDependencies} />
        </>
      )}

      <FeedbackNotice feedback={feedback} onDismiss={() => setFeedback(null)} />
      {problems.length > 0 && <small className="ws-hint is-warn">{problems[0]}</small>}
      <div className="ws-row-actions">
        <button type="button" className="pk-btn pk-btn--ghost pk-btn--sm" onClick={onCancel} disabled={busy !== null}>取消</button>
        <button type="button" className="pk-btn pk-btn--primary pk-btn--sm" onClick={() => void submit()} disabled={busy !== null || problems.length > 0}>
          {busy ? <Loader size={14} className="animate-spin" /> : <Upload size={14} />}{mode === 'edit' ? '保存' : '发布'}
        </button>
      </div>
    </section>
  );
}

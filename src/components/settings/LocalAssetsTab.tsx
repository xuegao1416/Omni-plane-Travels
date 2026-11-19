/**
 * 本地资产：公开工坊类型与本地独占预设的统一资产目录。
 */
import { lazy,Suspense,useCallback,useEffect,useMemo,useState } from 'react';
import { createPortal } from 'react-dom';
import {
BookOpen,CalendarDays,Compass,Download,Globe,Layers,Loader,
Package,Palette,Pencil,Puzzle,Trash2,TrendingUp,Upload,User,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { STORAGE_KEYS } from '../../config/storageKeys';
import { safeSetItem } from '../../storage/safeStorage';
import { useAuthStore } from '../../stores/authStore';
import { useConfigStore } from '../../stores/configStore';
import { useDialog } from '../shared/Dialog';
import type { WorldDef } from '../../data/worlds-schema';
import type { CustomNpc } from '../../storage/db';
import { anonymizePlayerPresetAsNpc,type NpcTemplate,type PlayerPreset } from '../../storage/templateStore';
import {
LOCAL_ASSET_TYPES,
isPublicWorkshopType,
type WorkshopAssetType,
} from '../../workshopCatalog';
import {
deleteCustomGameplayModule,
listCustomGameplayModules,
saveCustomGameplayModule,
} from '../../custom-modules/storage';
import { allWebEvents,deleteWebEvent,type WebEventRecord } from '../../modules/eventDb';
import {
deleteWorkshopRuntimeAsset,
listWorkshopRuntimeAssets,
updateWorkshopRuntimeAsset,
} from '../../workshop/runtimeAssets';
import { adventureEventPackId } from '../../workshop/adventure';
import { forgetLocalTarget, type InstallTargetKind } from '../../workshop/installs';
import { localAssetKey, publishLocalAsset } from '../../workshop/publish';
import { describeWorkshopError } from '../../workshop/api';
import { adventureCompiledPackIds, isWorkflowRecord, portableAssetData } from '../../workshop/localAssets';
import StructuredAssetEditor from './StructuredAssetEditor';

const WorldEditorForm = lazy(() => import('../start/WorldEditorForm'));
const NpcEditorModal = lazy(() => import('../start/NpcEditorModal'));
const CardEditor = lazy(() => import('../event/CardEditor'));
const WorkflowEditor = lazy(() => import('../workflow/WorkflowEditor'));

interface AssetTypeInfo {
  label: string;
  icon: LucideIcon;
  storageKey?: string;
  getName?: (item: any) => string;
  getDesc?: (item: any) => string;
  publishable?: boolean;
  category: string;
}

interface LocalAsset {
  id: string;
  name: string;
  desc: string;
  raw: any;
}

interface AssetEditorDraft {
  type: WorkshopAssetType;
  asset: LocalAsset;
  name: string;
  data: Record<string, any>;
}

type AssetGroups = Record<WorkshopAssetType, LocalAsset[]>;

const ASSET_TYPES: Record<WorkshopAssetType, AssetTypeInfo> = {
  world_package: {
    label: '世界包', icon: Globe, category: 'world', storageKey: STORAGE_KEYS.CUSTOM_WORLDS,
    getName: (item: WorldDef) => item.name || '未命名世界', getDesc: (item: WorldDef) => item.description || '',
  },
  npc_template: {
    label: 'NPC 模板', icon: BookOpen, category: 'character', storageKey: STORAGE_KEYS.NPC_TEMPLATES,
    getName: item => item.name || item.npc?.name || '未命名 NPC', getDesc: item => item.npc?.background || item.npc?.occupation || '',
  },
  gameplay_module: { label: '玩法模块', icon: Puzzle, category: 'gameplay' },
  event_pack: { label: '事件包', icon: CalendarDays, category: 'story' },
  workflow_pack: { label: '工作流包', icon: TrendingUp, category: 'story' },
  adventure_pack: { label: '冒险包', icon: Compass, category: 'story' },
  visual_theme: { label: '视觉主题', icon: Palette, category: 'visual' },
  character_preset: {
    label: '人物预设', icon: User, category: 'character', storageKey: STORAGE_KEYS.PLAYER_PRESETS,
    getName: item => item.name || '未命名预设', getDesc: item => item.background || '', publishable: false,
  },
  history_preset: {
    label: '人生经历', icon: Layers, category: 'character', storageKey: STORAGE_KEYS.HISTORY_PRESETS,
    getName: item => item.name || '未命名经历', getDesc: item => item.description || '', publishable: false,
  },
};

function emptyGroups(): AssetGroups {
  const groups = {} as AssetGroups;
  for (const type of LOCAL_ASSET_TYPES) groups[type] = [];
  return groups;
}

function readLocalStorageAssets(type: WorkshopAssetType): LocalAsset[] {
  const info = ASSET_TYPES[type];
  if (!info.storageKey || !info.getName || !info.getDesc) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(info.storageKey) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.map((item: any, index: number) => ({
      id: item.id || `${type}_${index}`,
      name: info.getName!(item),
      desc: info.getDesc!(item),
      raw: item,
    }));
  } catch {
    return [];
  }
}

function normalizeNpcTemplate(template: NpcTemplate): CustomNpc {
  const npc = template.npc;
  return {
    id: npc.id || template.id,
    name: npc.name || template.name || '',
    gender: npc.gender || '', age: npc.age || '', race: npc.race || '', relationshipType: npc.relationshipType || '',
    occupation: npc.occupation || '', socialStatus: npc.socialStatus || '',
    personality: npc.personality || '', hiddenPersonality: npc.hiddenPersonality || '', currentThought: npc.currentThought || '',
    appearance: npc.appearance || '', currentOutfit: npc.currentOutfit || '',
    currentAction: npc.currentAction || '', currentLocation: npc.currentLocation || '', currentState: npc.currentState || '',
    shortTermGoal: npc.shortTermGoal || '', longTermGoal: npc.longTermGoal || '', background: npc.background || '',
    chronicles: Array.isArray(npc.chronicles) ? npc.chronicles : [],
    skillsList: npc.skillsList || {}, itemsList: npc.itemsList || {},
    ...(npc.survivalStats ? { survivalStats: npc.survivalStats } : {}),
    ...(npc.tierIndex != null ? { tierIndex: npc.tierIndex } : {}),
  };
}

const LOCAL_TARGET_KINDS: Partial<Record<WorkshopAssetType, InstallTargetKind>> = {
  world_package: 'world',
  npc_template: 'npc',
  gameplay_module: 'module',
  event_pack: 'event',
  workflow_pack: 'event',
  adventure_pack: 'asset',
  visual_theme: 'asset',
};

export default function LocalAssetsTab() {
  const { isAuthenticated } = useAuthStore();
  const apiConfig = useConfigStore(state => state.apiConfig);
  const { DialogUI, confirm, alert: showAlert } = useDialog();
  const [activeType, setActiveType] = useState<WorkshopAssetType>('world_package');
  const [assetGroups, setAssetGroups] = useState<AssetGroups>(() => emptyGroups());
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [editor, setEditor] = useState<AssetEditorDraft | null>(null);
  const [savingEditor, setSavingEditor] = useState(false);
  const refresh = useCallback(() => setRefreshKey(key => key + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const next = emptyGroups();
      for (const type of ['world_package', 'npc_template', 'character_preset', 'history_preset'] as const) {
        next[type] = readLocalStorageAssets(type);
      }

      try {
        next.gameplay_module = (await listCustomGameplayModules()).map(record => ({
          id: record.module.id,
          name: record.module.name || '未命名玩法模块',
          desc: record.module.description || '',
          raw: record,
        }));
      } catch { next.gameplay_module = []; }

      try {
        // 冒险包编译出的事件卡包跟着冒险包原件走，不单独列出。
        const compiled = await adventureCompiledPackIds();
        const records = (await allWebEvents()).filter(record => !record.builtin && !compiled.has(record.id));
        for (const record of records) {
          const type = isWorkflowRecord(record) ? 'workflow_pack' : 'event_pack';
          next[type].push({
            id: record.id,
            name: record.manifest.name || record.id,
            desc: record.manifest.description || '',
            raw: record,
          });
        }
      } catch {
        next.event_pack = [];
        next.workflow_pack = [];
      }

      try {
        for (const asset of await listWorkshopRuntimeAssets()) {
          next[asset.type].push({ id: asset.id, name: asset.title || asset.id, desc: '', raw: asset });
        }
      } catch {
        next.adventure_pack = [];
        next.visual_theme = [];
      }

      if (!cancelled) {
        setAssetGroups(next);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  const items = useMemo(() => assetGroups[activeType] || [], [activeType, assetGroups]);

  const handleEdit = async (asset: LocalAsset) => {
    try {
      const rawData = activeType === 'event_pack' || activeType === 'workflow_pack'
        ? {}
        : await portableAssetData(activeType as Parameters<typeof portableAssetData>[0], asset.raw);
      if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) throw new Error('该资产缺少可编辑的结构化数据');
      const editableData = JSON.parse(JSON.stringify(rawData)) as Record<string, any>;
      setEditor({
        type: activeType,
        asset,
        name: asset.name,
        data: editableData,
      });
    } catch (error) {
      await showAlert(`无法打开编辑器：${(error as Error).message}`, { title: '编辑失败', danger: true });
    }
  };

  const replaceLocalStorageAsset = (type: WorkshopAssetType, assetId: string, next: Record<string, any>) => {
    const info = ASSET_TYPES[type];
    if (!info.storageKey) throw new Error('该资产没有可写入的本地存储');
    const list: any[] = JSON.parse(localStorage.getItem(info.storageKey) || '[]');
    const index = list.findIndex((item, itemIndex) => (item.id || `${type}_${itemIndex}`) === assetId);
    if (index < 0) throw new Error('找不到要编辑的本地资产');
    list[index] = next;
    safeSetItem(info.storageKey, JSON.stringify(list));
  };

  const handleStructuredSave = async () => {
    if (!editor || savingEditor) return;
    setSavingEditor(true);
    try {
      const name = editor.name.trim();
      if (!name) throw new Error('资产名称不能为空');
      if (editor.type === 'gameplay_module') {
        await saveCustomGameplayModule({ ...editor.data, id: editor.asset.id, name });
        window.dispatchEvent(new Event('custom-modules-changed'));
      } else if (editor.type === 'adventure_pack' || editor.type === 'visual_theme') {
        await updateWorkshopRuntimeAsset(editor.asset.id, { title: name, data: editor.data });
      } else if (editor.type === 'character_preset' || editor.type === 'history_preset') {
        replaceLocalStorageAsset(editor.type, editor.asset.id, { ...editor.data, id: editor.asset.id, name });
      } else {
        throw new Error('请使用该资产的专用编辑器');
      }
      setEditor(null);
      refresh();
      await showAlert('本地资产已保存。', { title: '保存成功' });
    } catch (error) {
      await showAlert(`保存失败：${(error as Error).message}`, { title: '保存失败', danger: true });
    } finally {
      setSavingEditor(false);
    }
  };

  const handleWorldSave = async (world: WorldDef) => {
    if (!editor || editor.type !== 'world_package') return;
    try {
      replaceLocalStorageAsset('world_package', editor.asset.id, { ...world, id: editor.asset.id });
      window.dispatchEvent(new Event('custom-worlds-changed'));
      setEditor(null);
      refresh();
      await showAlert('世界包已保存。', { title: '保存成功' });
    } catch (error) {
      await showAlert(`保存失败：${(error as Error).message}`, { title: '保存失败', danger: true });
    }
  };

  const handleNpcSave = async (npc: NpcTemplate['npc']) => {
    if (!editor || editor.type !== 'npc_template') return;
    try {
      const current = editor.asset.raw as NpcTemplate;
      replaceLocalStorageAsset('npc_template', editor.asset.id, { ...current, id: editor.asset.id, name: npc.name, npc });
      setEditor(null);
      refresh();
      await showAlert('NPC 模板已保存。', { title: '保存成功' });
    } catch (error) {
      await showAlert(`保存失败：${(error as Error).message}`, { title: '保存失败', danger: true });
    }
  };

  const handleUpload = async (asset: LocalAsset) => {
    if (!isPublicWorkshopType(activeType)) return;
    if (!isAuthenticated) {
      await showAlert('请先登录后再发布到创意工坊', { title: '需要登录' });
      return;
    }
    setUploadingId(asset.id);
    try {
      const data = await portableAssetData(activeType as Parameters<typeof portableAssetData>[0], asset.raw);
      // 同一个本地资产再次发布时作为新版本更新原条目，不会产生重复条目。
      const outcome = await publishLocalAsset(localAssetKey(activeType, asset.id), {
        type: activeType, title: asset.name, description: asset.desc || null,
        category: ASSET_TYPES[activeType].category, data,
      });
      await showAlert(outcome.created
        ? `「${asset.name}」已发布到创意工坊（v${outcome.version}）。可以在「创意工坊 · 我的发布」里补充说明、截图和依赖。`
        : `「${asset.name}」已作为新版本 v${outcome.version} 更新到创意工坊。`, { title: outcome.created ? '发布成功' : '更新成功' });
    } catch (error) {
      await showAlert(`发布失败：${describeWorkshopError(error)}`, { title: '发布失败', danger: true });
    } finally {
      setUploadingId(null);
    }
  };

  const handleDelete = async (asset: LocalAsset) => {
    const ok = await confirm(`确定删除「${asset.name}」吗？此操作不可撤销。`, { danger: true, confirmText: '删除' });
    if (!ok) return;
    try {
      if (activeType === 'gameplay_module') {
        await deleteCustomGameplayModule(asset.id);
        window.dispatchEvent(new Event('custom-modules-changed'));
      } else if (activeType === 'event_pack' || activeType === 'workflow_pack') {
        await deleteWebEvent(asset.id);
      } else if (activeType === 'adventure_pack' || activeType === 'visual_theme') {
        await deleteWorkshopRuntimeAsset(asset.id);
        if (activeType === 'adventure_pack') await forgetLocalTarget('event', adventureEventPackId(asset.raw?.data));
      } else {
        const info = ASSET_TYPES[activeType];
        const list: any[] = JSON.parse(localStorage.getItem(info.storageKey!) || '[]');
        const index = list.findIndex((item, itemIndex) => (item.id || `${activeType}_${itemIndex}`) === asset.id);
        if (index >= 0) list.splice(index, 1);
        safeSetItem(info.storageKey!, JSON.stringify(list));
      }
      // 手动删掉的工坊资产不再算“已安装”。
      const kind = LOCAL_TARGET_KINDS[activeType];
      if (kind) await forgetLocalTarget(kind, asset.id);
      refresh();
    } catch {
      await showAlert('删除失败', { title: '删除失败', danger: true });
    }
  };

  const handleExport = async (asset: LocalAsset) => {
    try {
      const data = await portableAssetData(activeType as Parameters<typeof portableAssetData>[0], asset.raw);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${asset.name}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      await showAlert(`导出失败：${(error as Error).message}`, { title: '导出失败', danger: true });
    }
  };

  const handleAnonymize = async (asset: LocalAsset) => {
    anonymizePlayerPresetAsNpc(asset.raw as PlayerPreset);
    refresh();
    await showAlert('已生成“匿名角色模板”。姓名、组织、位置和私人经历均未复制，请在 NPC 模板中检查后再发布。', { title: '转换完成' });
  };

  return (
    <div className="registry-settings-page registry-local-assets-page">
      {DialogUI}
      <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: '600' }}>本地资产</h3>
      <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginTop: 'calc(-1 * var(--space-2))' }}>
        管理本地世界、NPC、玩法与事件资产；人物预设和人生经历仅保存在本地
      </p>

      <div className="registry-type-tabs registry-local-type-tabs">
        {LOCAL_ASSET_TYPES.map(type => {
          const info = ASSET_TYPES[type];
          const Icon = info.icon;
          return (
            <button type="button" key={type} aria-pressed={activeType === type} onClick={() => setActiveType(type)}>
              <Icon size={14} />{info.label}<span className="registry-type-tabs__count">({assetGroups[type].length})</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="registry-assets-empty"><Loader size={22} className="animate-spin" /><span>正在读取本地资产…</span></div>
      ) : items.length === 0 ? (
        <div className="registry-assets-empty"><Package size={44} /><p>暂无本地{ASSET_TYPES[activeType].label}</p><small>创建或安装后会自动出现在这里</small></div>
      ) : (
        <div className="registry-asset-list" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {items.map(asset => {
            const info = ASSET_TYPES[activeType];
            const Icon = info.icon;
            return (
              <article key={asset.id} className="registry-asset-card">
                <div className="registry-asset-card-heading"><Icon size={15} /><span>{info.label}</span></div>
                <strong>{asset.name}</strong>
                {asset.desc && <p>{asset.desc}</p>}
                <div className="registry-card-actions">
                  {info.publishable !== false && <button onClick={() => void handleUpload(asset)} disabled={uploadingId === asset.id} className="registry-action-primary">{uploadingId === asset.id ? <Loader size={14} className="animate-spin" /> : <Upload size={14} />}发布到工坊</button>}
                  {activeType === 'character_preset' && <button onClick={() => void handleAnonymize(asset)} className="registry-action-primary"><User size={14} />匿名化为 NPC</button>}
                  <button onClick={() => void handleEdit(asset)}><Pencil size={14} />编辑</button>
                  <button onClick={() => void handleExport(asset)}><Download size={14} />导出</button>
                  <button onClick={() => void handleDelete(asset)} className="registry-action-danger"><Trash2 size={14} />删除</button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {editor?.type === 'world_package' && typeof document !== 'undefined' && createPortal(
        <Suspense fallback={<div className="local-asset-native-overlay registry-assets-empty"><Loader size={24} className="animate-spin" />正在打开世界编辑器…</div>}>
          <WorldEditorForm initialWorld={editor.asset.raw as WorldDef} onSave={world => void handleWorldSave(world)} onCancel={() => setEditor(null)} apiConfig={apiConfig} previewMode="edit" />
        </Suspense>,
        document.body,
      )}

      {editor?.type === 'npc_template' && (
        <Suspense fallback={null}>
          <NpcEditorModal initial={normalizeNpcTemplate(editor.asset.raw as NpcTemplate)} onSave={npc => void handleNpcSave(npc)} onCancel={() => setEditor(null)} apiConfig={apiConfig} />
        </Suspense>
      )}

      {editor?.type === 'event_pack' && typeof document !== 'undefined' && createPortal(
        <div className="local-asset-native-overlay">
          <Suspense fallback={<div className="registry-assets-empty"><Loader size={24} className="animate-spin" />正在打开事件编辑器…</div>}>
            <CardEditor eventPackId={editor.asset.id} onBack={() => { setEditor(null); refresh(); }} onSaved={refresh} />
          </Suspense>
        </div>,
        document.body,
      )}

      {editor?.type === 'workflow_pack' && typeof document !== 'undefined' && createPortal(
        <div className="local-asset-native-overlay">
          <Suspense fallback={<div className="registry-assets-empty"><Loader size={24} className="animate-spin" />正在打开工作流编辑器…</div>}>
            <WorkflowEditor eventPackId={editor.asset.id} onBack={() => { setEditor(null); refresh(); }} onSaved={refresh} />
          </Suspense>
        </div>,
        document.body,
      )}

      {editor && ['gameplay_module', 'adventure_pack', 'visual_theme', 'character_preset', 'history_preset'].includes(editor.type) && (
        <StructuredAssetEditor
          typeLabel={ASSET_TYPES[editor.type].label}
          name={editor.name}
          value={editor.data}
          saving={savingEditor}
          onNameChange={name => setEditor(current => current ? { ...current, name } : current)}
          onValueChange={data => setEditor(current => current ? { ...current, data } : current)}
          onSave={() => void handleStructuredSave()}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}

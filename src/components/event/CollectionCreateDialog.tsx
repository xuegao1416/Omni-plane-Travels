// ============================================================
// 创建合集弹窗 — 两步流程：
//   Step 1: 名称 + 封面色 + 图标
//   Step 2: 多选已安装的事件包/规则包
// ============================================================
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft,
  ChevronRight,
  FolderPlus,
  Check,
  X,
  FileText,
  Spline,
  BookOpen,
  Boxes,
  Package,
  Layers,
  Star,
  Zap,
  Shield,
  Crown,
  Heart,
  Gem,
  Compass,
  Feather,
  Globe,
  Map,
  Swords,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import type { EventRegistryEntry } from '../../modules/schema';
import { textOn } from './colorUtils';
import { useIsPhone } from '../../hooks/useIsMobile';

// ─── 图标选项（与 eventIcons.tsx ICON_MAP 同源，仅列出适合合集的子集） ───

const ICON_OPTIONS: { name: string; Icon: LucideIcon }[] = [
  { name: 'FolderPlus', Icon: FolderPlus },
  { name: 'Package', Icon: Package },
  { name: 'Boxes', Icon: Boxes },
  { name: 'Layers', Icon: Layers },
  { name: 'Star', Icon: Star },
  { name: 'Zap', Icon: Zap },
  { name: 'Shield', Icon: Shield },
  { name: 'Crown', Icon: Crown },
  { name: 'Heart', Icon: Heart },
  { name: 'Gem', Icon: Gem },
  { name: 'Compass', Icon: Compass },
  { name: 'Feather', Icon: Feather },
  { name: 'Globe', Icon: Globe },
  { name: 'Map', Icon: Map },
  { name: 'Swords', Icon: Swords },
  { name: 'Wand2', Icon: Wand2 },
];

// ─── 预设色板 ───

const COLOR_PRESETS = [
  '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7',
  '#ec4899', '#f43f5e', '#ef4444', '#f97316',
  '#eab308', '#84cc16', '#22c55e', '#14b8a6',
  '#06b6d4', '#0ea5e9', '#64748b', '#78716c',
];

interface CollectionCreateDialogProps {
  installedPacks: EventRegistryEntry[];
  onConfirm: (data: { name: string; coverColor: string; icon: string; memberIds: string[] }) => void;
  onCancel: () => void;
}

export default function CollectionCreateDialog({
  installedPacks,
  onConfirm,
  onCancel,
}: CollectionCreateDialogProps) {
  const isPhone = useIsPhone();
  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 状态
  const [name, setName] = useState('');
  const [coverColor, setCoverColor] = useState(COLOR_PRESETS[0]);
  const [iconName, setIconName] = useState(ICON_OPTIONS[0].name);

  // Step 2 状态
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const canProceed = name.trim().length > 0;
  const SelectedIcon = ICON_OPTIONS.find((o) => o.name === iconName)?.Icon ?? FolderPlus;

  // 按 type 分组
  const grouped = useMemo(() => {
    const groups: Record<string, EventRegistryEntry[]> = {};
    for (const p of installedPacks) {
      const t = p.meta.type;
      if (!groups[t]) groups[t] = [];
      groups[t].push(p);
    }
    return groups;
  }, [installedPacks]);

  const groupLabels: Record<string, string> = {
    card: '事件包',
    rule: '规则',
    worldbook: '世界书',
    bundle: '混合包',
  };

  const toggleMember = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConfirm = () => {
    onConfirm({
      name: name.trim(),
      coverColor,
      icon: iconName,
      memberIds: Array.from(selectedIds),
    });
  };

  const content = (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)',
        padding: isPhone ? 'var(--space-2)' : 'var(--space-4)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          width: isPhone ? '100%' : '480px',
          maxHeight: isPhone ? '90vh' : '80vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-primary)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
        }}
      >
        {/* 头部 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: isPhone ? 'var(--space-3)' : 'var(--space-4)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <FolderPlus size={18} style={{ color: 'var(--accent)' }} />
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'var(--font-size-md)' }}>
              创建合集
            </span>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
              步骤 {step}/2
            </span>
          </div>
          <button className="btn-ghost btn-icon-sm" onClick={onCancel} aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        {/* 内容区 */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: isPhone ? 'var(--space-3)' : 'var(--space-4)',
          }}
        >
          {step === 1 ? (
            <Step1
              name={name}
              setName={setName}
              coverColor={coverColor}
              setCoverColor={setCoverColor}
              iconName={iconName}
              setIconName={setIconName}
              SelectedIcon={SelectedIcon}
              isPhone={isPhone}
            />
          ) : (
            <Step2
              grouped={grouped}
              groupLabels={groupLabels}
              selectedIds={selectedIds}
              toggleMember={toggleMember}
              isPhone={isPhone}
            />
          )}
        </div>

        {/* 底部按钮 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 'var(--space-2)',
            padding: isPhone ? 'var(--space-3)' : 'var(--space-4)',
            borderTop: '1px solid var(--border)',
          }}
        >
          {step === 2 ? (
            <button className="btn-secondary" onClick={() => setStep(1)} style={{ minHeight: isPhone ? 44 : undefined }}>
              <ChevronLeft size={16} /> 上一步
            </button>
          ) : (
            <div />
          )}
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button className="btn-secondary" onClick={onCancel} style={{ minHeight: isPhone ? 44 : undefined }}>
              取消
            </button>
            {step === 1 ? (
              <button
                className="btn-primary"
                disabled={!canProceed}
                onClick={() => setStep(2)}
                style={{ minHeight: isPhone ? 44 : undefined, opacity: canProceed ? 1 : 0.5 }}
              >
                下一步 <ChevronRight size={16} />
              </button>
            ) : (
              <button className="btn-primary" onClick={handleConfirm} style={{ minHeight: isPhone ? 44 : undefined }}>
                <Check size={16} /> 创建合集
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

// ─── Step 1: 基本信息 ───

function Step1({
  name,
  setName,
  coverColor,
  setCoverColor,
  iconName,
  setIconName,
  SelectedIcon,
  isPhone,
}: {
  name: string;
  setName: (v: string) => void;
  coverColor: string;
  setCoverColor: (v: string) => void;
  iconName: string;
  setIconName: (v: string) => void;
  SelectedIcon: LucideIcon;
  isPhone: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* 预览 */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 'var(--radius-lg)',
            background: coverColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: textOn(coverColor),
            boxShadow: 'var(--shadow-md)',
          }}
        >
          <SelectedIcon size={28} strokeWidth={1.75} />
        </div>
      </div>

      {/* 名称 */}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-secondary)' }}>合集名称</span>
        <input
          className="input-field"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="输入合集名称"
          maxLength={32}
          autoFocus
          style={{ minHeight: isPhone ? 44 : undefined }}
        />
      </label>

      {/* 封面色 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-secondary)' }}>封面色</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          {COLOR_PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCoverColor(c)}
              aria-label={`选择颜色 ${c}`}
              style={{
                width: isPhone ? 32 : 28,
                height: isPhone ? 32 : 28,
                borderRadius: 'var(--radius-md)',
                background: c,
                border: coverColor === c ? '2px solid var(--text-primary)' : '2px solid transparent',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            />
          ))}
          <input
            type="color"
            value={coverColor}
            onChange={(e) => setCoverColor(e.target.value)}
            aria-label="自定义颜色"
            style={{
              width: isPhone ? 32 : 28,
              height: isPhone ? 32 : 28,
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              padding: 0,
            }}
          />
        </div>
      </div>

      {/* 图标 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-secondary)' }}>图标</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          {ICON_OPTIONS.map(({ name: n, Icon }) => (
            <button
              key={n}
              type="button"
              onClick={() => setIconName(n)}
              aria-label={`选择图标 ${n}`}
              style={{
                width: isPhone ? 40 : 36,
                height: isPhone ? 40 : 36,
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: iconName === n ? 'var(--accent-dim)' : 'var(--bg-secondary)',
                color: iconName === n ? 'var(--accent)' : 'var(--text-secondary)',
                border: iconName === n ? '1px solid var(--accent)' : '1px solid var(--border)',
                cursor: 'pointer',
                transition: 'background var(--duration-fast) var(--ease-out)',
              }}
            >
              <Icon size={18} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Step 2: 选择成员 ───

function Step2({
  grouped,
  groupLabels,
  selectedIds,
  toggleMember,
  isPhone,
}: {
  grouped: Record<string, EventRegistryEntry[]>;
  groupLabels: Record<string, string>;
  selectedIds: Set<string>;
  toggleMember: (id: string) => void;
  isPhone: boolean;
}) {
  const groupKeys = Object.keys(grouped);

  if (groupKeys.length === 0) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)', textAlign: 'center', padding: 'var(--space-8)' }}>
        暂无已安装的事件包可选
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
        已选择 {selectedIds.size} 个包
      </div>
      {groupKeys.map((type) => {
        const list = grouped[type];
        if (!list || list.length === 0) return null;
        return (
          <div key={type}>
            <div
              style={{
                fontSize: 'var(--font-size-xs)',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                marginBottom: 'var(--space-2)',
              }}
            >
              {groupLabels[type] ?? type}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              {list.map((p) => {
                const checked = selectedIds.has(p.meta.id);
                return (
                  <label
                    key={p.meta.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-2)',
                      padding: isPhone ? 'var(--space-2) var(--space-3)' : 'var(--space-2)',
                      borderRadius: 'var(--radius-md)',
                      background: checked ? 'var(--accent-dim)' : 'var(--bg-secondary)',
                      border: '1px solid',
                      borderColor: checked ? 'var(--accent)' : 'var(--border)',
                      cursor: 'pointer',
                      transition: 'background var(--duration-fast) var(--ease-out)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleMember(p.meta.id)}
                      style={{ width: 18, height: 18, accentColor: 'var(--accent)', flexShrink: 0 }}
                    />
                    <span
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 'var(--radius-md)',
                        background: p.meta.coverColor,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: textOn(p.meta.coverColor || '#333'),
                        flexShrink: 0,
                        fontSize: 'var(--font-size-xs)',
                      }}
                    >
                      {p.meta.name.charAt(0)}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 'var(--font-size-sm)',
                          fontWeight: 600,
                          color: 'var(--text-primary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {p.meta.name}
                      </div>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                        {p.meta.author} · v{p.meta.version}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

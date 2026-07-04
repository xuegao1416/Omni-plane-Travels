// 模块卡片组件 — 旧格式存档兼容渲染器
import {
  BarChart3, TrendingUp, Swords, Leaf, Briefcase, Calendar, Dice6, FileText,
} from 'lucide-react';
import type { WorldModuleRuntime } from '../../../schema/variables';
import type { ModuleRenderType } from '../../../data/modules';
import { Collapsible } from '../../shared/Collapsible';

interface ModuleCardProps {
  module: WorldModuleRuntime;
  moduleKey: string;
  renderType: ModuleRenderType;
}

const MODULE_ICONS: Record<string, React.ReactNode> = {
  stat: <BarChart3 size={15} />,
  progression: <TrendingUp size={15} />,
  combat: <Swords size={15} />,
  survival: <Leaf size={15} />,
  business: <Briefcase size={15} />,
  event: <Calendar size={15} />,
  dice: <Dice6 size={15} />,
  custom_prompt: <FileText size={15} />,
};

function getModuleIcon(moduleKey: string): React.ReactNode {
  const prefix = moduleKey.split('_')[0];
  return MODULE_ICONS[prefix] || <BarChart3 size={15} />;
}

export default function ModuleCard({ module, moduleKey, renderType }: ModuleCardProps) {
  const icon = getModuleIcon(moduleKey);

  return (
    <Collapsible icon={icon} title={module.名称} defaultOpen={true}>
      {module.描述 && (
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginBottom: '8px' }}>
          {module.描述}
        </div>
      )}
      <ModuleDataRenderer renderType={renderType} data={module.数据} />
    </Collapsible>
  );
}

function ModuleDataRenderer({ renderType, data }: { renderType: ModuleRenderType; data: Record<string, unknown> }) {
  if (!data || Object.keys(data).length === 0) {
    return <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', fontStyle: 'italic' }}>暂无数据</div>;
  }

  switch (renderType) {
    case 'stats':
      return <StatsRenderer data={data} />;
    case 'progression':
      return <ProgressionRenderer data={data} />;
    case 'resource_list':
      return <ResourceListRenderer data={data} />;
    case 'tags':
      return <TagsRenderer data={data} />;
    case 'event_list':
      return <EventListRenderer data={data} />;
    case 'dice':
      return <DiceRenderer data={data} />;
    case 'text':
      return <TextRenderer data={data} />;
    default:
      return <GenericRenderer data={data} />;
  }
}

function StatsRenderer({ data }: { data: Record<string, unknown> }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {Object.entries(data).map(([key, val]) => {
        if (val && typeof val === 'object' && '当前' in (val as any)) {
          const v = val as { 当前: number; 上限: number };
          const pct = Math.max(0, Math.min(100, (v.当前 / (v.上限 || 100)) * 100));
          return (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 0' }}>
              <span style={{ minWidth: '48px', fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>{key}</span>
              <div style={{ flex: 1, height: '10px', background: 'var(--bg-tertiary)', borderRadius: '5px', overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: '#60a5fa', borderRadius: '4px', transition: 'width 0.3s' }} />
              </div>
              <span style={{ fontSize: 'var(--font-size-sm)', textAlign: 'right', color: 'var(--text-secondary)', minWidth: '60px' }}>{v.当前}/{v.上限}</span>
            </div>
          );
        }
        if (typeof val === 'number') {
          return (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 'var(--font-size-sm)' }}>
              <span style={{ color: 'var(--text-muted)' }}>{key}</span>
              <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>{val}</span>
            </div>
          );
        }
        return (
          <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 'var(--font-size-sm)' }}>
            <span style={{ color: 'var(--text-muted)' }}>{key}</span>
            <span style={{ color: 'var(--text-secondary)' }}>{String(val)}</span>
          </div>
        );
      })}
    </div>
  );
}

function ProgressionRenderer({ data }: { data: Record<string, unknown> }) {
  const 当前段位 = data['当前段位'] as string || '';
  const 进度 = typeof data['进度'] === 'number' ? (data['进度'] as number) : 0;
  const 下一段位 = data['下一段位'] as string || '';
  const pct = Math.max(0, Math.min(100, 进度 * 100));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {当前段位 && (
        <div style={{ fontSize: 'var(--font-size-md)', fontWeight: '600', color: 'var(--accent)' }}>
          {当前段位}
        </div>
      )}
      {下一段位 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ flex: 1, height: '10px', background: 'var(--bg-tertiary)', borderRadius: '5px', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: '#a78bfa', borderRadius: '4px', transition: 'width 0.3s' }} />
          </div>
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>→ {下一段位}</span>
        </div>
      )}
      {Object.entries(data).filter(([k]) => !['当前段位', '进度', '下一段位'].includes(k)).map(([key, val]) => (
        <div key={key} style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
          <span style={{ color: 'var(--text-muted)' }}>{key}：</span>{String(val)}
        </div>
      ))}
    </div>
  );
}

function ResourceListRenderer({ data }: { data: Record<string, unknown> }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {Object.entries(data).map(([key, val]) => (
        <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', fontSize: 'var(--font-size-sm)' }}>
          <span style={{ color: 'var(--text-muted)' }}>{key}</span>
          <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>
            {typeof val === 'object' ? JSON.stringify(val) : String(val)}
          </span>
        </div>
      ))}
    </div>
  );
}

function TagsRenderer({ data }: { data: Record<string, unknown> }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {Object.entries(data).map(([key, val]) => {
        if (Array.isArray(val)) {
          return (
            <div key={key}>
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginRight: '6px' }}>{key}：</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                {val.map((item, i) => (
                  <span key={i} style={{
                    fontSize: '11px', padding: '2px 8px', borderRadius: '10px',
                    background: 'var(--accent)15', color: 'var(--accent)', fontWeight: '500',
                  }}>{String(item)}</span>
                ))}
              </div>
            </div>
          );
        }
        return (
          <div key={key} style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
            <span style={{ color: 'var(--text-muted)' }}>{key}：</span>{String(val)}
          </div>
        );
      })}
    </div>
  );
}

function EventListRenderer({ data }: { data: Record<string, unknown> }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {Object.entries(data).map(([key, val]) => {
        if (val && typeof val === 'object') {
          const v = val as Record<string, unknown>;
          return (
            <div key={key} style={{ padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: '600', fontSize: 'var(--font-size-sm)' }}>{key}</span>
                {String(v['significance'] || '') && (
                  <span style={{
                    fontSize: '10px', padding: '1px 6px', borderRadius: '8px',
                    background: v['significance'] === 'major' ? '#ef444420' : '#6b728020',
                    color: v['significance'] === 'major' ? '#ef4444' : '#6b7280',
                  }}>{v['significance'] === 'major' ? '重大' : '日常'}</span>
                )}
              </div>
              {String(v['状态'] || '') && <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--accent)' }}>状态：{String(v['状态'])}</div>}
              {String(v['影响'] || '') && <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>{String(v['影响'])}</div>}
            </div>
          );
        }
        return (
          <div key={key} style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>{key}：{String(val)}</div>
        );
      })}
    </div>
  );
}

function DiceRenderer({ data }: { data: Record<string, unknown> }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
        {String(data['规则'] || '掷1d20 + 修正值 vs DC')}
      </div>
      {String(data['最近结果'] || '') && (
        <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>
          最近：{String(data['最近结果'])}
        </div>
      )}
    </div>
  );
}

function TextRenderer({ data }: { data: Record<string, unknown> }) {
  const text = data['内容'] || data['text'] || data['prompt'] || '';
  return (
    <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
      {String(text)}
    </div>
  );
}

function GenericRenderer({ data }: { data: Record<string, unknown> }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {Object.entries(data).map(([key, val]) => (
        <div key={key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-sm)' }}>
          <span style={{ color: 'var(--text-muted)' }}>{key}</span>
          <span style={{ color: 'var(--text-secondary)' }}>{typeof val === 'object' ? JSON.stringify(val) : String(val)}</span>
        </div>
      ))}
    </div>
  );
}

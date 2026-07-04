export const RUNTIME_TABS = [
  { key: 'scene', label: '场景' },
  { key: 'threads', label: '线程' },
  { key: 'states', label: '状态' },
  { key: 'relations', label: '关系' },
  { key: 'relationNetwork', label: '关系网' },
  { key: 'events', label: '事件' },
  { key: 'entities', label: '实体' },
  { key: 'archives', label: '归档' },
  { key: 'vector', label: '向量' },
  { key: 'summary', label: '摘要' },
  { key: 'mutations', label: '变更' },
  { key: 'checkpoints', label: '检查点' },
];

export const pillStyle: React.CSSProperties = {
  padding: '12px', borderRadius: 'var(--radius-md)',
  background: 'var(--bg-secondary)', border: '1px solid var(--border)',
  transition: 'border-color 0.15s, transform 0.15s',
};

export const cardStyle: React.CSSProperties = {
  background: 'var(--bg-secondary)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', overflow: 'hidden',
};

export const metaLineStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '5px 0', borderBottom: '1px dashed var(--border)', fontSize: 'var(--font-size-sm)',
};

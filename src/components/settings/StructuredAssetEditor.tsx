import { Plus, Save, Trash2, X } from 'lucide-react';
import OverlayPortal from '../shared/OverlayPortal';

type EditableValue = null | boolean | number | string | EditableValue[] | { [key: string]: EditableValue };

interface Props {
  typeLabel: string;
  name: string;
  value: Record<string, any>;
  saving?: boolean;
  onNameChange: (name: string) => void;
  onValueChange: (value: Record<string, any>) => void;
  onSave: () => void;
  onClose: () => void;
}

const LABELS: Record<string, string> = {
  version: '版本', description: '说明', author: '作者', tags: '标签', category: '分类',
  gender: '性别', age: '年龄', background: '背景经历', personality: '性格', appearance: '外貌',
  career: '职业', socialClass: '社会阶层', organization: '所属组织', specialIdentity: '特殊身份',
  perspective: '叙事视角', initialSkills: '初始技能', initialItems: '初始物品',
  includeAgeStages: '包含年龄阶段', segments: '人生阶段',
  triggers: '触发条件', inputs: '输入', state: '状态', behavior: '运行规则', outputs: '输出',
  dependencies: '依赖模块', permissions: '权限', ui: '界面', lifecycle: '生命周期',
  name: '名称', type: '类型', quality: '品质', count: '数量', amount: '数量', notes: '备注',
  stage_0: '序章', stage_1: '第一阶段', stage_2: '第二阶段', stage_3: '第三阶段',
  stage_4: '第四阶段', prologue: '序章', content: '内容', title: '标题', enabled: '启用',
};

const HIDDEN_ROOT_KEYS = new Set(['id', 'name', 'createdAt', 'installedAt', 'updatedAt']);

function labelFor(key: string): string {
  if (LABELS[key]) return LABELS[key];
  if (/^[\u3400-\u9fff]/.test(key)) return key;
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
}

function blankLike(value: EditableValue): EditableValue {
  if (Array.isArray(value)) return [];
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, blankLike(child)]));
  }
  if (typeof value === 'boolean') return false;
  if (typeof value === 'number') return 0;
  return '';
}

function PrimitiveField({ fieldKey, value, onChange }: { fieldKey: string; value: null | boolean | number | string; onChange: (value: EditableValue) => void }) {
  const label = labelFor(fieldKey);
  if (typeof value === 'boolean') {
    return <label className="structured-asset-toggle"><span>{label}</span><input type="checkbox" checked={value} onChange={event => onChange(event.target.checked)} /><i aria-hidden="true" /></label>;
  }
  if (typeof value === 'number') {
    return <label className="structured-asset-field"><span>{label}</span><input type="number" value={value} onChange={event => onChange(Number(event.target.value) || 0)} /></label>;
  }
  const text = value ?? '';
  const multiline = text.length > 72 || /description|background|personality|appearance|content|prompt|rule|story/i.test(fieldKey);
  return <label className={`structured-asset-field${multiline ? ' is-wide' : ''}`}><span>{label}</span>{multiline ? <textarea rows={3} value={text} onChange={event => onChange(event.target.value)} /> : <input value={text} onChange={event => onChange(event.target.value)} />}</label>;
}

function StructuredNode({ fieldKey, value, depth, onChange }: { fieldKey: string; value: EditableValue; depth: number; onChange: (value: EditableValue) => void }) {
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return <PrimitiveField fieldKey={fieldKey} value={value as null | boolean | number | string} onChange={onChange} />;
  }

  if (Array.isArray(value)) {
    return (
      <details className="structured-asset-section" open={depth < 1}>
        <summary><span>{labelFor(fieldKey)}</span><em>{value.length} 项</em></summary>
        <div className="structured-asset-list">
          {value.map((item, index) => (
            <div className="structured-asset-list-item" key={`${fieldKey}-${index}`}>
              <StructuredNode fieldKey={`第 ${index + 1} 项`} value={item} depth={depth + 1} onChange={next => onChange(value.map((entry, itemIndex) => itemIndex === index ? next : entry))} />
              <button type="button" className="structured-asset-remove" onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))} aria-label={`删除第 ${index + 1} 项`}><Trash2 size={14} /></button>
            </div>
          ))}
          <button type="button" className="structured-asset-add" onClick={() => onChange([...value, value.length ? blankLike(value[0]) : ''])}><Plus size={14} />添加一项</button>
        </div>
      </details>
    );
  }

  const entries = Object.entries(value);
  return (
    <details className="structured-asset-section" open={depth < 1}>
      <summary><span>{labelFor(fieldKey)}</span><em>{entries.length} 项</em></summary>
      <div className="structured-asset-grid">
        {entries.map(([key, child]) => <StructuredNode key={key} fieldKey={key} value={child} depth={depth + 1} onChange={next => onChange({ ...value, [key]: next })} />)}
      </div>
    </details>
  );
}

export default function StructuredAssetEditor({ typeLabel, name, value, saving, onNameChange, onValueChange, onSave, onClose }: Props) {
  const entries = Object.entries(value).filter(([key]) => !HIDDEN_ROOT_KEYS.has(key));
  return (
    <OverlayPortal className="structured-asset-overlay" ariaLabel={`编辑${typeLabel}`} onClose={onClose}>
      <section className="structured-asset-editor" onPointerDown={event => event.stopPropagation()}>
        <header>
          <div><span>LOCAL ARCHIVE · ASSET EDITOR</span><h2>编辑{typeLabel}</h2><p>按字段修改本地内容，保存后立即替换当前资产。</p></div>
          <button type="button" onClick={onClose} aria-label="关闭编辑器"><X size={19} /></button>
        </header>
        <main>
          <section className="structured-asset-primary">
            <label className="structured-asset-field is-wide"><span>资产名称</span><input value={name} onChange={event => onNameChange(event.target.value)} /></label>
          </section>
          <div className="structured-asset-fields">
            {entries.map(([key, child]) => <StructuredNode key={key} fieldKey={key} value={child as EditableValue} depth={0} onChange={next => onValueChange({ ...value, [key]: next })} />)}
          </div>
        </main>
        <footer><button type="button" onClick={onClose}>取消</button><button type="button" className="is-primary" onClick={onSave} disabled={saving || !name.trim()}><Save size={15} />{saving ? '保存中…' : '保存修改'}</button></footer>
      </section>
    </OverlayPortal>
  );
}

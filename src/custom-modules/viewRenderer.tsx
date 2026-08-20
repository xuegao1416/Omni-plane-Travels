import type { ReactNode } from 'react';
import type { Condition, JsonValue, ModuleView, ViewComponent } from './schema';

export type CustomModuleViewModel =
  | { type: 'section'; title?: string; children: CustomModuleViewModel[] }
  | { type: 'card'; title?: string; body?: string; children: CustomModuleViewModel[]; actions: Array<{ label: string; event: string }> }
  | { type: 'text'; label?: string; value: string }
  | { type: 'number'; label?: string; value: number; format?: 'integer' | 'decimal' }
  | { type: 'progress'; label?: string; value: number; min: number; max: number; color?: string }
  | { type: 'badge'; label?: string; value: string; tone?: string }
  | { type: 'list'; label?: string; value: JsonValue[]; emptyText?: string }
  | { type: 'table'; label?: string; value: JsonValue; columns: Array<{ key: string; label: string }> }
  | { type: 'divider' }
  | { type: 'button'; label: string; event: string };

function readPath(values: Record<string, JsonValue>, path: string): JsonValue | undefined {
  const parts = path.split('.');
  if (parts.some((part) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(part))) return undefined;
  let current: unknown = values;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current as JsonValue;
}

function equal(a: JsonValue, b: JsonValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function conditionMatches(condition: Condition, values: Record<string, JsonValue>): boolean {
  if (condition.type === 'all') return condition.conditions.every((item) => conditionMatches(item, values));
  if (condition.type === 'any') return condition.conditions.some((item) => conditionMatches(item, values));
  if (condition.type === 'not') return !conditionMatches(condition.condition, values);
  const current = readPath(values, condition.path);
  if (current === undefined) return false;
  switch (condition.operator) {
    case 'eq': return equal(current, condition.value);
    case 'neq': return !equal(current, condition.value);
    case 'gt': return typeof current === 'number' && typeof condition.value === 'number' && current > condition.value;
    case 'gte': return typeof current === 'number' && typeof condition.value === 'number' && current >= condition.value;
    case 'lt': return typeof current === 'number' && typeof condition.value === 'number' && current < condition.value;
    case 'lte': return typeof current === 'number' && typeof condition.value === 'number' && current <= condition.value;
    case 'in': return Array.isArray(condition.value) && condition.value.some((item) => equal(item, current));
    case 'contains':
      return typeof current === 'string'
        ? typeof condition.value === 'string' && current.includes(condition.value)
        : Array.isArray(current) && current.some((item) => equal(item, condition.value));
  }
}

function asText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function componentToModel(component: ViewComponent, values: Record<string, JsonValue>): CustomModuleViewModel[] {
  switch (component.type) {
    case 'section':
      return [{ type: 'section', title: component.title, children: component.children.flatMap((child) => componentToModel(child, values)) }];
    case 'card':
      return [{
        type: 'card',
        title: component.title,
        body: component.body,
        children: (component.children ?? []).flatMap((child) => componentToModel(child, values)),
        actions: (component.actions ?? []).map((action) => ({ label: action.label, event: action.event })),
      }];
    case 'text':
      return [{ type: 'text', label: component.label, value: component.text ?? asText(readPath(values, component.path!)) }];
    case 'number': {
      const value = readPath(values, component.path);
      return [{ type: 'number', label: component.label, value: typeof value === 'number' ? value : 0, format: component.format }];
    }
    case 'progress': {
      const value = readPath(values, component.path);
      return [{ type: 'progress', label: component.label, value: typeof value === 'number' ? value : 0, min: component.min ?? 0, max: component.max ?? 100, color: component.color }];
    }
    case 'badge':
      return [{ type: 'badge', label: component.label, value: asText(readPath(values, component.path)), tone: component.tone }];
    case 'list': {
      const value = readPath(values, component.path);
      return [{ type: 'list', label: component.label, value: Array.isArray(value) ? value : [], emptyText: component.emptyText }];
    }
    case 'table':
      return [{ type: 'table', label: component.label, value: readPath(values, component.path) ?? [], columns: component.columns }];
    case 'divider': return [{ type: 'divider' }];
    case 'conditional':
      return conditionMatches(component.when, values)
        ? component.children.flatMap((child) => componentToModel(child, values))
        : [];
    case 'button': return [{ type: 'button', label: component.label, event: component.event }];
    default: return [];
  }
}

export function buildCustomModuleViewModel(view: ModuleView | undefined, values: Record<string, JsonValue>): CustomModuleViewModel[] {
  return view?.components.flatMap((component) => componentToModel(component, values)) ?? [];
}

function labelFor(label: string | undefined, children: ReactNode): ReactNode {
  return label ? <div className="custom-module-field"><span className="custom-module-label">{label}</span>{children}</div> : children;
}

function renderModel(item: CustomModuleViewModel, index: number, onEvent?: (event: string) => void): ReactNode {
  switch (item.type) {
    case 'section':
      return <div key={index} className="custom-module-section">{item.title && <h5>{item.title}</h5>}{item.children.map((child, childIndex) => renderModel(child, childIndex, onEvent))}</div>;
    case 'card':
      return <article key={index} className="custom-module-card">
        {item.title && <h5>{item.title}</h5>}
        {item.body && <p className="custom-module-card-body">{item.body}</p>}
        {item.children.map((child, childIndex) => renderModel(child, childIndex, onEvent))}
        {item.actions.length > 0 && <div className="custom-module-card-actions">{item.actions.map((action) => <button key={action.event} type="button" className="custom-module-button" onClick={() => onEvent?.(action.event)}>{action.label}</button>)}</div>}
      </article>;
    case 'text': return <div key={index}>{labelFor(item.label, <span className="custom-module-text">{item.value}</span>)}</div>;
    case 'number': return <div key={index}>{labelFor(item.label, <span className="custom-module-number">{item.format === 'integer' ? Math.round(item.value) : item.value}</span>)}</div>;
    case 'progress': {
      const range = item.max - item.min || 1;
      const percent = Math.max(0, Math.min(100, ((item.value - item.min) / range) * 100));
      return <div key={index}>{labelFor(item.label, <div className="custom-module-progress"><div className="custom-module-progress-track"><div className={`custom-module-progress-fill tone-${item.color ?? 'accent'}`} style={{ width: `${percent}%` }} /></div><span>{item.value}</span></div>)}</div>;
    }
    case 'badge': return <div key={index}>{labelFor(item.label, <span className={`custom-module-badge tone-${item.tone ?? 'neutral'}`}>{item.value || '—'}</span>)}</div>;
    case 'list': return <div key={index}>{labelFor(item.label, item.value.length ? <ul className="custom-module-list">{item.value.map((value, valueIndex) => <li key={valueIndex}>{asText(value)}</li>)}</ul> : <span className="custom-module-empty">{item.emptyText ?? '暂无'}</span>)}</div>;
    case 'table': {
      const rows = Array.isArray(item.value) ? item.value : [item.value];
      return <div key={index}>{labelFor(item.label, <div className="custom-module-table-wrap"><table><thead><tr>{item.columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.filter((row): row is Record<string, JsonValue> => Boolean(row && typeof row === 'object' && !Array.isArray(row))).map((row, rowIndex) => <tr key={rowIndex}>{item.columns.map((column) => <td key={column.key}>{asText(row[column.key])}</td>)}</tr>)}</tbody></table></div>)}</div>;
    }
    case 'divider': return <hr key={index} className="custom-module-divider" />;
    case 'button': return <button key={index} type="button" className="custom-module-button" onClick={() => onEvent?.(item.event)}>{item.label}</button>;
  }
}

export interface CustomModuleViewProps {
  view?: ModuleView;
  values: Record<string, JsonValue>;
  onEvent?: (event: string) => void;
}

export function CustomModuleView({ view, values, onEvent }: CustomModuleViewProps) {
  if (!view) return null;
  const model = buildCustomModuleViewModel(view, values);
  return <section className="custom-module-view">{view.title && <h4>{view.title}</h4>}{model.map((item, index) => renderModel(item, index, onEvent))}</section>;
}


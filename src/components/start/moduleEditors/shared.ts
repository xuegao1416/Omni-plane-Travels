import type React from 'react';

/** 模块编辑器共享样式 */
export const inputStyle: React.CSSProperties = {
  background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
  borderRadius: 4, padding: '4px 6px', color: 'var(--text-primary)',
  fontSize: 'var(--font-size-xs)', width: '100%',
};

export const labelStyle: React.CSSProperties = {
  fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginBottom: 2, display: 'block',
};

/** 深拷贝并设置嵌套路径值的通用工具 */
export function setPathInClone<T extends Record<string, unknown>>(data: T, path: string, value: unknown): T {
  const next = JSON.parse(JSON.stringify(data));
  const parts = path.split('.');
  let obj: any = next;
  for (let i = 0; i < parts.length - 1; i++) {
    if (obj[parts[i]] == null || typeof obj[parts[i]] !== 'object') obj[parts[i]] = {};
    obj = obj[parts[i]];
  }
  obj[parts[parts.length - 1]] = value;
  return next;
}

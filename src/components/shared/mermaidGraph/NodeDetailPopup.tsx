import { X } from 'lucide-react';
import type { NodeDetail } from './types';
import s from './NodeDetailPopup.module.css';

export function NodeDetailPopup({ detail, onClose }: {
  detail: NodeDetail;
  onClose: () => void;
}) {
  const fields = detail.fields?.filter(f => f.value) || [];

  return (
    <div className={s.popup} onClick={e => e.stopPropagation()}>
      <div className={s.header}>
        <div className={s.headerInfo}>
          {detail.typeLabel && (
            <span className={s.typeBadge}>{detail.typeLabel}</span>
          )}
          <div className={s.title}>{detail.title}</div>
        </div>
        <button type="button" className={s.closeBtn} onClick={onClose} aria-label="关闭节点详情">
          <X size={14} />
        </button>
      </div>

      <div className={s.body}>
        {detail.summary && (
          <p className={s.summary}>{detail.summary}</p>
        )}

        {fields.length > 0 && (
          <div className={s.fieldList}>
            {fields.map((field, i) => (
              <div
                key={i}
                className={`${s.fieldRow}${i % 2 === 0 ? ` ${s.fieldRowEven}` : ''}`}
              >
                <span className={s.fieldLabel}>{field.label}</span>
                <span className={s.fieldValue}>{field.value}</span>
              </div>
            ))}
          </div>
        )}

        {fields.length === 0 && !detail.summary && (
          <div className={s.empty}>暂无详细信息</div>
        )}
      </div>
    </div>
  );
}

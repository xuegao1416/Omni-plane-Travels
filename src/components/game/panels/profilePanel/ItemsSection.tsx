import { useState } from 'react';
import { Backpack } from 'lucide-react';
import { Collapsible } from '../../../shared/Collapsible';
import { getQualityColor } from '../../../shared/qualityUtils';
import { DetailModal, DetailRow } from './shared';
import { getItemIcon } from '../../../shared/itemIcons';
import type { InventoryItem, ItemSelection } from './types';

interface Props {
  items: Record<string, InventoryItem>;
}

export function ItemsSection({ items }: Props) {
  const [selectedItem, setSelectedItem] = useState<ItemSelection | null>(null);

  return (
    <>
      <Collapsible icon={<Backpack size={15} />} title="物品栏">
        <div className="inventory-grid grid-fixed-6">
          {/* 生成 48 格 (6×8) */}
          {Array.from({ length: 48 }).map((_, i) => {
            const entry = Object.entries(items)[i];
            if (entry) {
              const [name, item] = entry;
              if (item == null) return null;
              const qColor = getQualityColor(item?.品质 ?? '普通');
              const IconComp = getItemIcon(item);
              return (
                <div
                  key={name}
                  onClick={() => setSelectedItem({ name, data: item })}
                  style={{
                    aspectRatio: '1',
                    padding: '6px 4px',
                    border: `1px solid ${qColor}40`,
                    borderRadius: 'var(--radius-sm)',
                    background: `linear-gradient(135deg, ${qColor}08, ${qColor}03)`,
                    cursor: 'pointer',
                    transition: 'all 0.12s',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                    minWidth: 0,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = qColor; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = `${qColor}40`; }}
                >
                  {item.数量 > 1 && (
                    <span style={{
                      position: 'absolute', top: '2px', right: '3px',
                      fontSize: '9px', fontWeight: '700', color: qColor,
                      lineHeight: 1,
                    }}>×{item.数量}</span>
                  )}
                  <IconComp size={16} color={qColor} />
                  <div style={{
                    fontSize: '9px', fontWeight: '500', marginTop: '2px',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', textAlign: 'center',
                  }}>{name}</div>
                </div>
              );
            }
            // 空格子
            return (
              <div
                key={`empty-${i}`}
                style={{
                  aspectRatio: '1',
                  border: '1px dashed var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-primary)',
                }}
              />
            );
          })}
        </div>
      </Collapsible>

      {/* 物品详情弹窗 */}
      {selectedItem && (
        <DetailModal title={selectedItem.name} quality={selectedItem.data?.品质 ?? '普通'} onClose={() => setSelectedItem(null)}>
          <DetailRow label="数量" value={selectedItem.data?.数量 ?? 1} />
          {selectedItem.data?.类型 && <DetailRow label="类型" value={selectedItem.data.类型} />}
          {selectedItem.data?.备注 && <DetailRow label="备注" value={selectedItem.data.备注} />}
        </DetailModal>
      )}
    </>
  );
}

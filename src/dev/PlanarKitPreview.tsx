import { HelpCircle, Trash2, X } from 'lucide-react';
import PlanarFrame from '../ui/planar/PlanarFrame';
import { Ribbon, Seal } from '../ui/planar/Ornaments';

/** Localhost-only visual QA sheet for the planar kit (`?plshot=kit`). */
export default function PlanarKitPreview() {
  return (
    <div style={{ minHeight: '100vh', padding: 48, boxSizing: 'border-box', background: 'radial-gradient(ellipse at 50% 0%, #1a2244, #04060d 70%)', display: 'grid', gridTemplateColumns: '460px 1fr', gap: 56, alignItems: 'start', fontFamily: 'var(--pl-font-ui)' }}>
      <PlanarFrame className="pk-dialog" style={{ animation: 'none' }}>
        <Seal size={68}><HelpCircle /></Seal>
        <h2 className="pk-title pk-dialog__title">确认操作</h2>
        <p className="pk-dialog__message">重新创建将替换尚未完成的角色资料。已填写的内容不会保留，确定继续吗？</p>
        <div className="pk-dialog__actions">
          <button type="button" className="pk-btn pk-btn--secondary">取消</button>
          <button type="button" className="pk-btn pk-btn--primary">确认</button>
        </div>
      </PlanarFrame>
      <div style={{ display: 'grid', gap: 40, justifyItems: 'start' }}>
        <Ribbon>启程契约</Ribbon>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <button type="button" className="pk-btn pk-btn--primary">开始旅程</button>
          <button type="button" className="pk-btn pk-btn--secondary">读取存档</button>
          <button type="button" className="pk-btn pk-btn--danger"><Trash2 />删除</button>
          <button type="button" className="pk-icon-btn pk-icon-btn--close" aria-label="关闭"><X /></button>
        </div>
        <PlanarFrame variant="plate" style={{ width: 360 }}>
          <span className="pk-kicker">World Seed</span>
          <h3 className="pk-title" style={{ fontSize: 20, margin: '8px 0 12px' }}>武侠世界</h3>
          <label className="pk-field"><span className="pk-field__label">角色名</span><input className="pk-input" defaultValue="沈砚" /></label>
        </PlanarFrame>
        <Seal tone="danger" size={56}><Trash2 /></Seal>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Megaphone, X } from 'lucide-react';
import DawnFrameV4 from '../shared/dawn/DawnFrameV4';
import { EntrySlicedButton } from './EntrySurface';

const UPDATE_LOG_STORAGE_KEY = 'omni.update-notice.2.7.5.seen';

export default function UpdateLogOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (window.localStorage.getItem(UPDATE_LOG_STORAGE_KEY) !== 'true') {
      setOpen(true);
    }
  }, []);

  const dismiss = () => {
    window.localStorage.setItem(UPDATE_LOG_STORAGE_KEY, 'true');
    setOpen(false);
  };

  const trigger = (
    <button type="button" className="entry-home-update-log-button" onClick={event => { event.stopPropagation(); setOpen(true); }}>
      <Megaphone size={15} aria-hidden="true" />更新日志
    </button>
  );

  if (!open) return trigger;

  return (
    <>
      {trigger}
      <div className="entry-update-log-overlay" role="dialog" aria-modal="true" aria-labelledby="entry-update-log-title" onClick={event => event.stopPropagation()}>
      <button type="button" className="entry-update-log-backdrop" aria-label="关闭更新日志" onClick={dismiss} />
      <DawnFrameV4 mode="panel" withFill className="entry-update-log-frame" ariaLabel="2.7.5 更新日志">
        <div className="entry-update-log-content">
          <button type="button" className="entry-update-log-close" onClick={dismiss} aria-label="关闭更新日志"><X size={20} /></button>
          <span className="entry-update-log-kicker">版本更新</span>
          <h2 id="entry-update-log-title">2.7.5 更新日志</h2>
          <p className="entry-update-log-lead">这次更新主要完善长期游玩所依赖的底层系统，让玩法模块、记忆、共创助手与事件系统能够稳定协同。</p>
          <div className="entry-update-log-list">
            <div><strong>统一玩法内核</strong><span>六类玩法模块拥有独立运行状态、迁移和检查点，减少长存档中的状态互相污染。</span></div>
            <div><strong>记忆系统升级</strong><span>补强长期记忆召回、记忆管线与检查点，并加入可选的本地语义向量检索。</span></div>
            <div><strong>自定义模块共创助手</strong><span>从一次性生成改为理解需求、澄清、设计、修订的对话式共创流程。</span></div>
            <div><strong>事件系统隔离</strong><span>事件包按世界绑定，避免不同世界的事件和工作流互相串台。</span></div>
            <div><strong>长期稳定性修复</strong><span>修复长会话、预设兼容、记忆保存和事件工作流中的多项边界问题。</span></div>
          </div>
          <div className="entry-update-log-next">
            <span className="entry-update-log-kicker">下次大版本更新预告</span>
            <p>请到 Discord 讨论区为帖子点赞。<strong>点赞突破 200</strong> 后，我们就推进职业系统与战斗系统：独立职业典藏、职业树、技能成长，以及与职业技能联动的独立战斗界面。</p>
          </div>
          <EntrySlicedButton frame="dawn-v4-compact" tone="primary" emblemSrc="/art/theme/emblems/emblem-44-v2.png" icon={Megaphone} onClick={dismiss}>知道了，继续使用</EntrySlicedButton>
        </div>
      </DawnFrameV4>
      </div>
    </>
  );
}

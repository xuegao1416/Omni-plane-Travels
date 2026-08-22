import { useEffect, useState } from 'react';
import { Megaphone, X } from 'lucide-react';
import DawnFrameV4 from '../shared/dawn/DawnFrameV4';
import { EntrySlicedButton } from './EntrySurface';

const UPDATE_LOG_STORAGE_KEY = 'omni.update-notice.2.7.6.seen';

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
      <DawnFrameV4 mode="panel" withFill className="entry-update-log-frame" ariaLabel="2.7.6 更新日志">
        <div className="entry-update-log-content">
          <button type="button" className="entry-update-log-close" onClick={dismiss} aria-label="关闭更新日志"><X size={20} /></button>
          <span className="entry-update-log-kicker">版本更新</span>
          <h2 id="entry-update-log-title">2.7.6 更新日志</h2>
          <p className="entry-update-log-lead">这是 3.0 前的维护补丁，集中修复世界时间、正文解析与世界动态交互，不提前混入职业或战斗系统。</p>
          <div className="entry-update-log-list">
            <div><strong>世界时间同步</strong><span>低算力模型漏写时间变量时，可从正文中的次日、时段、日期和经过时长保守校正，不再只机械增加一小时。</span></div>
            <div><strong>手动时间修正</strong><span>变量面板修改纪年与时间后会同步结构化时钟，保存后不再被旧值覆盖。</span></div>
            <div><strong>世界动态可用性</strong><span>明确后台动态与正文的边界，建议行动可一键填入主输入框，效果记录中的系统英文改为中文。</span></div>
            <div><strong>正文与卡片修复</strong><span>兼容多个正文标签与空标签响应，并修正局内骰子卡片的框体对齐。</span></div>
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

import { useEffect, useState } from 'react';
import { Megaphone, X } from 'lucide-react';
import DawnFrameV4 from '../shared/dawn/DawnFrameV4';
import { EntrySlicedButton } from './EntrySurface';

const UPDATE_LOG_STORAGE_KEY = 'omni.update-notice.2.8.0.seen';

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
      <DawnFrameV4 mode="panel" withFill className="entry-update-log-frame" ariaLabel="2.8.0 更新日志">
        <div className="entry-update-log-content">
          <button type="button" className="entry-update-log-close" onClick={dismiss} aria-label="关闭更新日志"><X size={20} /></button>
          <span className="entry-update-log-kicker">版本更新</span>
          <h2 id="entry-update-log-title">2.8.0 更新日志</h2>
          <p className="entry-update-log-lead">职业、技能与图形化战斗正式进入同一套可选玩法内核：需要时才出现，不会强塞进不适合战斗的世界。</p>
          <div className="entry-update-log-list">
            <div><strong>十二种基准职业</strong><span>西式奇幻与东方幻想两套职业包，包含四阶职业树、互斥专精、终极能力、天赋与自由技能。</span></div>
            <div><strong>独立卡片战场</strong><span>最多 4v4，攻击、技能、道具、防御与逃跑全部本地确定性结算，整场结束后才由 AI 承接剧情。</span></div>
            <div><strong>本地策略 AI</strong><span>敌方与自动友方可选择进攻、均衡、防守或支援倾向，不会在每个回合消耗 API。</span></div>
            <div><strong>战斗风险</strong><span>普通、困难、炼狱三档独立于世界展示难度；炼狱死亡封存存档，但仍可浏览与导出。</span></div>
            <div><strong>可靠恢复</strong><span>战前完整检查点、刷新续战、幂等结算与待叙述结果，避免断网、空回或重复点击造成重复奖励和数据污染。</span></div>
          </div>
          <div className="entry-update-log-next">
            <span className="entry-update-log-kicker">可选，而不是强制</span>
            <p>只有挂载职业或战斗模块的世界才会显示相应创建步骤与界面。旧世界、旧存档和纯叙事玩法会保持原样。</p>
            <p>当前图形化战斗仍处于开发阶段，内容仅供参考，不代表最终成品。</p>
          </div>
          <div className="entry-update-log-next">
            <span className="entry-update-log-kicker">下个目标</span>
            <p>帖子点赞突破 <strong>300</strong>，将更新地图系统。</p>
          </div>
          <EntrySlicedButton frame="dawn-v4-compact" tone="primary" emblemSrc="/art/theme/emblems/emblem-44-v2.png" icon={Megaphone} onClick={dismiss}>知道了，继续使用</EntrySlicedButton>
        </div>
      </DawnFrameV4>
      </div>
    </>
  );
}

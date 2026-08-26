import { useEffect, useState } from 'react';
import { Megaphone, X } from 'lucide-react';
import DawnFrameV4 from '../shared/dawn/DawnFrameV4';
import { EntrySlicedButton } from './EntrySurface';

const UPDATE_LOG_STORAGE_KEY = 'omni.update-notice.2.8.1.seen';

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
      <DawnFrameV4 mode="panel" withFill className="entry-update-log-frame" ariaLabel="2.8.1 更新日志">
        <div className="entry-update-log-content">
          <button type="button" className="entry-update-log-close" onClick={dismiss} aria-label="关闭更新日志"><X size={20} /></button>
          <span className="entry-update-log-kicker">版本更新</span>
          <h2 id="entry-update-log-title">2.8.1 更新日志</h2>
          <p className="entry-update-log-lead">职业、技能与图形化战斗正式进入同一套可选玩法内核：需要时才出现，不会强塞进不适合战斗的世界。</p>
          <div className="entry-update-log-list">
            <div><strong>可扩展职业典藏</strong><span>内置职业包可复制、编辑、导入导出；每个世界可按自己的设定配置任意数量的职业道路。</span></div>
            <div><strong>独立卡片战场</strong><span>最多 4v4，攻击、技能、道具、防御与逃跑全部本地确定性结算，整场结束后才由 AI 承接剧情。</span></div>
            <div><strong>本地策略 AI</strong><span>敌方与自动友方可选择进攻、均衡、防守或支援倾向，不会在每个回合消耗 API。</span></div>
            <div><strong>战斗风险</strong><span>简单、普通、困难、炼狱四档独立于世界展示难度；炼狱死亡封存存档，但仍可浏览与导出。</span></div>
            <div><strong>可靠恢复</strong><span>战前完整检查点、刷新续战、幂等结算与待叙述结果，避免断网、空回或重复点击造成重复奖励和数据污染。</span></div>
            <div><strong>降临难度与点数</strong><span>四档难度在第一步一次选定，同时决定战斗风险与可分配的降临点数池。</span></div>
            <div><strong>命运牌阵</strong><span>当前职业典藏中的道路会以塔罗牌阵展开，数量随配置变化；翻开牌面即可查看定位、徽记与成长阶位。</span></div>
            <div><strong>点数加点与抽卡</strong><span>属性每点约提升上限的 5%；天赋可直选或命运抽卡，神技仅可通过命运抽取。</span></div>
            <div><strong>行囊纯化</strong><span>第三步专注行囊、初始段位与同行者，职业世界不再重复选择自由技能和属性。</span></div>
          </div>
          <div className="entry-update-log-next">
            <span className="entry-update-log-kicker">可选，而不是强制</span>
            <p>只有挂载职业或战斗模块的世界才会显示相应创建步骤与界面。旧世界、旧存档和纯叙事玩法会保持原样。</p>
            <p>当前图形化战斗仍处于开发阶段，内容仅供参考，不代表最终成品。</p>
          </div>
          <div className="entry-update-log-next">
            <span className="entry-update-log-kicker">后续计划</span>
            <p>职业与先天天赋将拆分为独立系统，减少创建阶段的耦合，并保留各自的世界配置能力。</p>
            <p>数值平衡与世界系数算法会继续校准，让不同世界的创建体验更稳定。</p>
            <p>地图与其他仍在推进的内容会逐步完善；本次更新是阶段成果，不代表全部计划完成。</p>
          </div>
          <EntrySlicedButton frame="dawn-v4-compact" tone="primary" emblemSrc="/art/theme/emblems/emblem-44-v2.png" icon={Megaphone} onClick={dismiss}>知道了，继续使用</EntrySlicedButton>
        </div>
      </DawnFrameV4>
      </div>
    </>
  );
}

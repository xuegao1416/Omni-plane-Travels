import { useEffect,useState } from 'react';
import { Megaphone,X } from 'lucide-react';
import DawnFrameV4 from '../shared/dawn/DawnFrameV4';
import { EntrySlicedButton } from './EntrySurface';
import { APP_VERSION } from '../../config/version';

const UPDATE_LOG_STORAGE_KEY = `omni.update-notice.${APP_VERSION}.seen`;

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
      <DawnFrameV4 mode="panel" withFill className="entry-update-log-frame" ariaLabel={`${APP_VERSION} 更新日志`}>
        <div className="entry-update-log-content">
          <button type="button" className="entry-update-log-close" onClick={dismiss} aria-label="关闭更新日志"><X size={20} /></button>
          <span className="entry-update-log-kicker">版本更新</span>
          <h2 id="entry-update-log-title">{APP_VERSION} 更新日志</h2>
          <p className="entry-update-log-lead">小说拆解台与剧情导演正式接通：把原文整理成世界与主线，让人物行动、玩家选择和幕后变化共同推动旅程。</p>
          <div className="entry-update-log-list">
            <div><strong>小说拆解与世界创建</strong><span>导入 TXT、EPUB 或拆解资料，提取人物、地点、势力、物品和剧情证据；支持暂停续作、可选向量检索与世界资料包导入导出。</span></div>
            <div><strong>可编辑的固定主线</strong><span>原创原稿和小说剧情都可整理、人工修订并保存版本；开局支持自创角色、扮演原角色和选择起始阶段。</span></div>
            <div><strong>剧情导演</strong><span>根据主线方向、人物行动和玩家选择安排剧情，核对正文落实结果；前提被破坏时调整计划，主线耗尽后仍可自由续玩。</span></div>
            <div><strong>幕后变化与玩家认知</strong><span>人物可以在幕后行动，普通面板保留玩家上次获知的资料；只有实际见闻或披露才更新，查看幕后不会让角色自动知道秘密。</span></div>
            <div><strong>存档与跨设备续玩</strong><span>保存并携带固定剧情版本、导演阶段与相关状态；导入其他设备后可以继续小说主线，刷新和回滚同步恢复变量与记忆。</span></div>
            <div><strong>世界、NPC 与物品管理</strong><span>支持从内置世界派生编辑草稿，完善人物资料、头像及生图操作，支持删除 NPC、丢弃玩家物品和查看 NPC 物品栏。</span></div>
            <div><strong>世界书与运行稳定性</strong><span>统一世界书导入，修复空关键词条目意外全量注入；完善变量请求超时、幕后重试和手动审查保存，保留玩法与战斗结算边界。</span></div>
            <div><strong>移动端与阅读体验</strong><span>整理文风预设，优化设置导航、人物档案、状态条、世界书详情、变量快照及导演控制台的窄屏布局。</span></div>
          </div>
          <div className="entry-update-log-next">
            <span className="entry-update-log-kicker">开始新的旅程</span>
            <p>小说世界需先整理并保存主线版本，再创建世界。主线在开局时绑定，后续修改世界模板不会替换已开始旅程的剧情版本。</p>
            <p>原世界演化的独立剧情推进已由导演接管，时间与机械规则继续由玩法系统结算。本次包含 2.8.2 之后的累计更新。</p>
          </div>
          <EntrySlicedButton frame="dawn-v4-compact" tone="primary" emblemSrc="/art/theme/emblems/emblem-44-v2.png" icon={Megaphone} onClick={dismiss}>知道了，继续使用</EntrySlicedButton>
        </div>
      </DawnFrameV4>
      </div>
    </>
  );
}

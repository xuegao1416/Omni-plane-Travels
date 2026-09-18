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
          <p className="entry-update-log-lead">玩法模块工坊升级为原生工具调用共创 Agent，并集中修复桌面请求、数据库升级、剧情导演与设置页性能问题。</p>
          <div className="entry-update-log-list">
            <div><strong>新共创 Agent</strong><span>通过能力查询、草稿创建与局部修改、校验和真实试玩共同制作玩法模块；聊天、执行记录和模块版本分别管理。</span></div>
            <div><strong>真实玩法能力</strong><span>模块可原子消耗或增加金币、背包物品和生存资源；资源不足、重复事件或规则失败不会产生部分结算。</span></div>
            <div><strong>版本与存档</strong><span>支持版本差异、显式回退、绑定世界，以及对既有存档预览影响、手动应用和恢复点还原。</span></div>
            <div><strong>旧共创迁移</strong><span>旧 V2 会话首次打开时保留聊天与有效草稿并迁入新工坊；无法转换的数据保留原件并给出提示。</span></div>
            <div><strong>数据库升级</strong><span>数据库 v4～v9 可直接无损补齐到 v10，修复旧用户导入 TXT 时被版本门槛拦截的问题。</span></div>
            <div><strong>请求与导演稳定性</strong><span>修复兼容接口鉴权头、短流式回答、工具 Schema 和导演降级提示等问题。</span></div>
            <div><strong>设置页性能</strong><span>设置界面打开后暂停被遮挡页面的动画并移除大面积双层模糊，降低浏览器持续渲染负担。</span></div>
            <div><strong>角色与界面细节</strong><span>完善人物迷雾、物品展示、世界大厅和玩法模块界面，并继续优化移动端布局。</span></div>
          </div>
          <div className="entry-update-log-next">
            <span className="entry-update-log-kicker">开始新的旅程</span>
            <p>旧共创会话会在首次打开对应世界的工坊时迁移；已有存档继续固定原模块定义，只有手动预览并应用后才会更新。</p>
            <p>数据库升级会保留原有记录；若遇到早于 v4 的数据库，系统仍会停止升级并保留原数据，避免不安全改写。</p>
          </div>
          <EntrySlicedButton frame="dawn-v4-compact" tone="primary" emblemSrc="/art/theme/emblems/emblem-44-v2.png" icon={Megaphone} onClick={dismiss}>知道了，继续使用</EntrySlicedButton>
        </div>
      </DawnFrameV4>
      </div>
    </>
  );
}

import { useEffect,useState } from 'react';
import { Megaphone } from 'lucide-react';
import PlaneDialog from './orrery/PlaneDialog';
import { APP_VERSION } from '../../config/version';
import { trySetItem } from '../../storage/safeStorage';

const UPDATE_LOG_STORAGE_KEY = `omni.update-notice.${APP_VERSION}.seen`;

const ITEMS: Array<[string, string]> = [
  ['位面星仪界面', '首页、大厅、游戏外壳、二级界面与事件工作台全部重绘；大厅六枚位面透镜环绕星盘，世界详情展开为全屏位面档案。'],
  ['晨雾琉璃主题', '在设置「通常 → 主题」切换。首页与大厅是代码绘制的 3D 圆厅：水晶环绕的篝火与体积丁达尔光，进入大厅时镜头穿过光柱升空。'],
  ['星仪战场', '战场随世界换景，单位改为立牌立绘，带行动轨迹、命中特效、行动顺序条与指令转盘（1–5 快捷键）。'],
  ['玩法新内核', '变量、效果、事件、加成与周期统一结算；随机数随存档保存，回滚后结果一致。'],
  ['资源与商号', '物资按世界时钟每日消耗，必需品见底进入匮乏；经营改为商号，有多市场行情、仓库、产业与订单，钱统一进钱袋。'],
  ['事件导演', '事件卡的每个选项有自己的后果和 d20 检定，按节奏出卡（默认「偶尔」）；40 张内置卡接上物资、订单等联动。'],
  ['成长与能力', '经验来自检定、事件、任务、订单与制作，关卡需手动突破；骰子结果可复现；天赋、技能与职业能力统一结算。'],
  ['AI 生成更可靠', '变量提取改为逐条校验的意图格式；事件、规则包与模块数据生成后自动校验并修复一次。'],
  ['创意工坊重建', '新增版本历史、评分、收藏与举报；按依赖安装、更新和卸载，失败整体回滚；冒险包与视觉主题可直接使用。'],
  ['存档更轻', '账本与流水不再写进玩法日志，长局存档体积约减半。'],
];

export default function UpdateLogOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (window.localStorage.getItem(UPDATE_LOG_STORAGE_KEY) !== 'true') setOpen(true);
  }, []);

  const dismiss = () => {
    // 已读标记属于尽力而为：存储写不进去也不该让这个动作直接失败。
    trySetItem(UPDATE_LOG_STORAGE_KEY, 'true');
    setOpen(false);
  };

  return (
    <>
      <button type="button" className="pl-chip" onClick={event => { event.stopPropagation(); setOpen(true); }}>
        <Megaphone size={14} aria-hidden="true" />更新日志
      </button>
      {open && (
        <PlaneDialog
          titleId="pl-update-log-title"
          kicker="版本更新"
          title={`${APP_VERSION} 更新日志`}
          onClose={dismiss}
          size="md"
          footer={<button type="button" className="pl-button pl-button--primary" onClick={dismiss}>知道了，继续使用</button>}
        >
          <p className="pl-lead">3.0.0 是一次大版本更新：界面整体重铺为「位面星仪」，新增亮色主题「晨雾琉璃」，玩法逻辑按新内核重写，创意工坊重建。</p>
          <ul className="pl-changelog">
            {ITEMS.map(([name, text]) => <li key={name}><strong>{name}</strong><span>{text}</span></li>)}
          </ul>
          <p className="pl-note">旧存档读取时自动迁移：生存物资迁入资源模块，旧「经营资金」并入钱袋。3.0.0 写出的存档带新的玩法数据版本，2.8.4 及更早版本无法正确读取，请先把桌面端与安卓端升级到 3.0.0 再导入存档。</p>
        </PlaneDialog>
      )}
    </>
  );
}

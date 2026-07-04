import { User, DollarSign } from 'lucide-react';
import { Collapsible } from '../../../shared/Collapsible';
import { ExcelRow } from '../../../shared/ExcelRow';
import type { GameState } from './types';

interface Props {
  player: GameState['玩家'];
  hasBusinessModule?: boolean;
}

export function IdentitySection({ player, hasBusinessModule }: Props) {
  return (
    <>
      {/* 角色基本信息 */}
      <Collapsible icon={<User size={15} />} title="基本信息">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <ExcelRow label="姓名" value={player.姓名} />
          <ExcelRow label="性别" value={player.性别} />
          <ExcelRow label="年龄" value={String(player.年龄)} />
          {player.性格 && <ExcelRow label="性格" value={player.性格} />}
          {player.外貌 && <ExcelRow label="外貌" value={player.外貌} />}
          <ExcelRow label="职业" value={player.身份信息.职业} />
        </div>
      </Collapsible>

      {/* 货币资源（经营模块启用时隐藏，资金已在右侧经营卡片显示） */}
      {!hasBusinessModule && (
        <Collapsible icon={<DollarSign size={15} />} title="货币资源">
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 'var(--font-size-md)' }}>
            <span style={{ color: 'var(--accent)' }}>{player.货币资源.主货币.名称 || '金币'}</span>
            <span style={{ fontWeight: '600' }}>{player.货币资源.主货币.数量}</span>
          </div>
        </Collapsible>
      )}
    </>
  );
}

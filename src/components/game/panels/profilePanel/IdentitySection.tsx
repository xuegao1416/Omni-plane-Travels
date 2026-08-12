import { useState, useEffect } from 'react';
import { User, DollarSign } from 'lucide-react';
import { Collapsible } from '../../../shared/Collapsible';
import { ExcelRow } from '../../../shared/ExcelRow';
import { getDefaultPortraitSource } from '../../../start/PortraitEditor';
import { useSaveStore } from '../../../../stores/saveStore';
import type { GameState } from './types';
import type { PlayerProfile } from '../../../../storage/db';

interface Props {
  player: GameState['玩家'];
  hasBusinessModule?: boolean;
}

export function IdentitySection({ player, hasBusinessModule }: Props) {
  const [portraitUrl, setPortraitUrl] = useState<string>('');
  const currentSaveId = useSaveStore(s => s.currentSaveId);

  useEffect(() => {
    let cancelled = false;
    // 从默认性别剪影开始
    const defaultSrc = getDefaultPortraitSource(player.性别 || '');
    setPortraitUrl(defaultSrc);

    // 异步查找自定义头像
    if (currentSaveId) {
      (async () => {
        try {
          const { loadSave } = useSaveStore.getState();
          const save = await loadSave(currentSaveId);
          if (cancelled || !save?.personalInfo?.portrait) return;
          const { getPortraitSource } = await import('../../../start/PortraitEditor');
          const customUrl = getPortraitSource(save.personalInfo as PlayerProfile);
          if (customUrl && customUrl !== defaultSrc) {
            setPortraitUrl(customUrl);
          }
        } catch {
          // 使用默认剪影
        }
      })();
    }

    return () => { cancelled = true; };
  }, [player.性别, currentSaveId]);

  return (
    <>
      {/* 玩家头像 */}
      {portraitUrl && (
        <div style={{
          display: 'flex', justifyContent: 'center', padding: '0 0 12px',
        }}>
          <div style={{
            width: '80px', height: '107px', borderRadius: '50% 50% 44% 44%',
            overflow: 'hidden', border: '2px solid var(--accent)',
            boxShadow: '0 0 0 4px var(--bg-secondary), 0 4px 16px rgba(0,0,0,0.12)',
          }}>
            <img
              src={portraitUrl}
              alt={player.姓名 || '玩家'}
              style={{
                width: '100%', height: '100%',
                objectFit: 'cover', objectPosition: 'center',
              }}
            />
          </div>
        </div>
      )}

      {/* 角色基本信息 */}
      <Collapsible icon={<User size={15} />} title="基本信息">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <ExcelRow label="姓名" value={player.姓名} />
          <ExcelRow label="性别" value={player.性别} />
          <ExcelRow label="年龄" value={String(player.年龄)} />
          {player.性格 && <ExcelRow label="性格" value={player.性格} />}
          {player.外貌 && <ExcelRow label="外貌" value={player.外貌} />}
          <ExcelRow label="职业" value={player.身份信息?.职业 ?? ''} />
        </div>
      </Collapsible>

      {/* 货币资源（经营模块启用时隐藏，资金已在右侧经营卡片显示） */}
      {!hasBusinessModule && (
        <Collapsible icon={<DollarSign size={15} />} title="货币资源">
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 'var(--font-size-md)' }}>
            <span style={{ color: 'var(--accent)' }}>{player.货币资源?.主货币?.名称 || '金币'}</span>
            <span style={{ fontWeight: '600' }}>{player.货币资源?.主货币?.数量 ?? 0}</span>
          </div>
        </Collapsible>
      )}
    </>
  );
}

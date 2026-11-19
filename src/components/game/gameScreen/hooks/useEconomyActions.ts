import { useCallback, useMemo, useRef } from 'react';
import type { GameEngine } from '../../../../engine/types';
import type { WorldDef } from '../../../../data/worlds-schema';
import type { JsonRecord } from '../../../../core/ops';
import { runPlayerCommand } from '../../../../core/playerCommands';
import type { EconomyLedgerActions } from '../../panels/EconomyLedger';

/** 商号面板的玩家操作：全部交给经营模块结算，成功后一次性提交。 */
export function useEconomyActions(
  engine: GameEngine,
  worldDef: WorldDef | undefined,
  setNotification: (msg: string | null) => void,
  bumpVersion: () => void,
): Required<EconomyLedgerActions> {
  const current = useRef({ engine, worldDef, setNotification, bumpVersion });
  current.current = { engine, worldDef, setNotification, bumpVersion };
  const run = useCallback((command: string, args: JsonRecord, label: string) => {
    const { engine: activeEngine, worldDef: world } = current.current;
    const result = runPlayerCommand(activeEngine, world, command, args, label);
    current.current.setNotification(result.feedback);
    if (result.ok) current.current.bumpVersion();
  }, []);
  return useMemo(() => ({
    buy: (market: string, goods: string, quantity: number) => run('economy.buy', { market, goods, quantity }, '买入'),
    sell: (market: string, goods: string, quantity: number) => run('economy.sell', { market, goods, quantity }, '卖出'),
    acquire: (id: string) => run('economy.acquire', { id }, '购置产业'),
    upgrade: (id: string) => run('economy.upgrade', { id }, '升级产业'),
    repair: (id: string) => run('economy.repair', { id }, '修缮产业'),
    staff: (id: string, count: number) => run('economy.staff', { id, count }, '调整人手'),
    setActive: (id: string, active: boolean) => run('economy.setActive', { id, active }, active ? '重新开张' : '暂停营业'),
    deliver: (id: string) => run('economy.deliver', { id }, '交付订单'),
    abandon: (id: string) => run('economy.abandonContract', { id }, '放弃订单'),
  }), [run]);
}

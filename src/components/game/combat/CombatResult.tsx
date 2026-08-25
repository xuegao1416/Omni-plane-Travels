import { RotateCcw, Sparkles } from 'lucide-react';
import type { CombatSessionV2 } from '../../../gameplay/protocols';

export default function CombatResult({ session, saving, readOnly, onContinueNarration, onRetry }: { session: CombatSessionV2; saving: boolean; readOnly: boolean; onContinueNarration: () => void; onRetry: () => void }) {
  if (!session.result) return null;
  const title = session.result.status === 'victory' ? '战斗胜利' : session.result.status === 'escaped' ? '已脱离战斗' : session.result.status === 'defeat' ? '战斗失败' : '战斗结束';
  const copy = session.result.narration.status === 'pending' ? '机械结算与奖励已安全保存，正在生成承接正文。' : session.result.narration.status === 'failed' ? `机械结算已保存；承接正文失败：${session.result.narration.error ?? '模型未返回正文'}。可以安全重试，不会重复结算。` : '承接正文已完成。';
  return <footer className="combat-wireframe__result" role="status"><div><strong>{title}</strong><span>{copy}</span></div><div>{session.result.narration.status !== 'succeeded' && <button type="button" className="combat-wireframe__primary" onClick={onContinueNarration} disabled={saving}><Sparkles size={15} />重试承接正文</button>}{session.result.narration.status !== 'succeeded' && session.riskMode !== 'inferno' && <button type="button" className="combat-wireframe__secondary" onClick={onRetry} disabled={readOnly}><RotateCcw size={15} />{saving ? '中止承接并恢复战前' : '恢复战前检查点'}</button>}</div></footer>;
}

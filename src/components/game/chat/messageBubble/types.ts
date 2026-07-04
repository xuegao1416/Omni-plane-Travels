import type { ChatMessage } from '../../../../engine/types';
import type { WorldSystemData, DiceRoll } from '../../../../modules/schema';

export interface Props {
  message: ChatMessage;
  onDelete: (id: string) => void;
  onEdit: (id: string, content: string) => void;
  onResend: (id: string) => void;
  onResendFromHere: (id: string) => void;
  onCopy: (text: string) => void;
  onOptionClick?: (optionText: string) => void;
  /** 世界系统数据（用于内联骰子卡片） */
  worldSystem?: WorldSystemData | null;
  /** 骰子掷骰结果回调 */
  onDiceRoll?: (roll: DiceRoll) => void;
}

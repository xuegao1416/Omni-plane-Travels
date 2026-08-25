const OPTION_BLOCK_RE = /\s*\[OPTION_START\][\s\S]*?\[OPTION_END\]/gi;
const TIME_ADVANCE_RE = /\s*<TimeAdvance\s*>[\s\S]*?<\/TimeAdvance>/gi;

const ACTIVE_PURSUIT_RE = /(?:正(?:在)?|仍(?:在)?|一路)?被.{0,8}(?:追杀|追捕|围堵)|(?:追杀者|追兵|敌人).{0,18}(?:逼近|搜寻|堵住|追来|包围)/;
const ACTIVE_ASSAULT_RE = /(?:遭(?:到|遇)(?:伏击|围攻|包围|袭击)|被.{0,6}(?:伏击|围攻|包围|袭击)|(?:伏击者|埋伏者|袭击者|追杀者|追兵|敌人|敌军|守卫|士兵|怪物).{0,20}(?:现身|发动|扑向|冲来|逼近|堵住|拔(?:刀|剑)|举枪|瞄准)|(?:遭遇|撞见|碰上).{0,12}(?:敌人|敌军|仇敌|怪物|袭击者|追杀者)|(?:双方|彼此).{0,16}(?:剑拔弩张|一触即发|即将(?:开战|交战|交锋)|进入战斗姿态)|(?:战斗|交锋|交战).{0,8}(?:一触即发|即将开始)|(?:即将|马上|眼看就要|准备).{0,8}(?:开战|交战|交锋|迎击)|扑向|冲向|堵住.{0,8}出口|拔(?:刀|剑)|举枪|开枪|射击|挥.{0,4}(?:刀|剑|拳)|朝(?:着)?你.{0,12}(?:砍|劈|刺|射|扑)|向你.{0,12}(?:砍|劈|刺|射|扑)|子弹.{0,10}(?:飞来|袭来))/;
const PLAYER_ASSAULT_RE = /(?:^|[，。！？!?\n])\s*(?:我|玩家|<user>)?(?:立刻|直接|马上|当即)?\s*(?:准备)?\s*(?:攻击|开枪|射击|拔(?:刀|剑)(?:迎战)?|挥刀|挥剑|砍向|劈向|刺向|扑向|杀向|迎战|迎击|反击|开战|投入战斗)/;

// These are already-resolved exchanges. With graphical combat enabled they
// belong exclusively to the post-combat continuation, never the setup turn.
const RESOLVED_EXCHANGE_RE = /(?:刀锋|剑锋|枪尖|拳头|攻击|子弹|箭矢).{0,20}(?:撞|命中|击中|刺入|刺穿|贯穿|砍中|劈中|射中|擦过)|(?:命中|击中|砍中|刺中|射中|中弹|贯穿|刺入|刺穿|劈开|砍断|流血|受伤|伤口|倒地|毙命|身亡|死亡|断气|失去战斗能力|格挡|挡下|闪开|躲开|反击|还击|交锋数招|缠斗|厮杀|激战|战成一团|扭打)/;
const HOSTILE_EXCHANGE_CONTEXT_RE = /(?:敌人|敌军|仇敌|对手|袭击者|埋伏者|伏击者|追杀者|追兵|守卫|卫士|士兵|怪物|杀手|匪徒|双方|彼此|战斗|交锋|交战|冲突|袭击|伏击|围攻|追杀)/;

export interface CombatOnsetSignals {
  activePursuit: boolean;
  activeAssault: boolean;
  playerAssault: boolean;
  resolvedExchange: boolean;
}

/** The prose boundary and encounter builder must agree on the same onset. */
export function detectCombatOnset(userText: string, aiText: string): CombatOnsetSignals {
  const user = userText.replace(/<[^>]+>/g, ' ').trim();
  const narrative = aiText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const combined = `${user}\n${narrative}`;
  return {
    activePursuit: ACTIVE_PURSUIT_RE.test(combined),
    activeAssault: ACTIVE_ASSAULT_RE.test(narrative),
    playerAssault: PLAYER_ASSAULT_RE.test(user),
    // A bare word such as “格挡”“受伤” also appears in training,回忆和状态说明。
    // Only treat a resolved exchange as combat evidence when the same prose
    // identifies a hostile counterpart or an actual conflict context.
    resolvedExchange: RESOLVED_EXCHANGE_RE.test(narrative) && HOSTILE_EXCHANGE_CONTEXT_RE.test(narrative),
  };
}

export interface CombatNarrativeBoundaryResult {
  text: string;
  triggered: boolean;
  truncated: boolean;
}

function previousSentenceBoundary(text: string, index: number): number {
  let boundary = -1;
  for (const marker of ['。', '！', '？', '!', '?', '\n']) {
    boundary = Math.max(boundary, text.lastIndexOf(marker, Math.max(0, index - 1)));
  }
  return boundary + 1;
}

function removePostNarrativeControls(text: string): string {
  return text.replace(OPTION_BLOCK_RE, '').replace(TIME_ADVANCE_RE, '').trimEnd();
}

/**
 * Enforces a single source of truth for combat narration. The setup turn may
 * establish an ambush or imminent attack, but all exchanges and outcomes are
 * reserved for the deterministic combat result continuation.
 */
export function constrainPreCombatNarrative(rawText: string, userText: string): CombatNarrativeBoundaryResult {
  if (!rawText.trim()) return { text: rawText, triggered: false, truncated: false };

  const open = rawText.match(/<contenttext>/i);
  const openStart = open?.index ?? -1;
  const bodyStart = open ? openStart + open[0].length : 0;
  const close = open ? rawText.slice(bodyStart).match(/<\/contenttext>/i) : null;
  const bodyEnd = close?.index === undefined ? rawText.length : bodyStart + close.index;
  const body = rawText.slice(bodyStart, bodyEnd);
  const visible = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const triggered = Object.values(detectCombatOnset(userText, visible)).some(Boolean);
  if (!triggered) return { text: rawText, triggered: false, truncated: false };

  const signals = detectCombatOnset(userText, visible);
  const exchange = signals.resolvedExchange ? RESOLVED_EXCHANGE_RE.exec(body) : null;
  const truncated = Boolean(exchange);
  const setup = truncated
    ? body.slice(0, previousSentenceBoundary(body, exchange!.index)).trim()
    : body.trim();
  const boundedBody = truncated
    ? `${setup ? `${setup}\n\n` : ''}敌人已经逼近并发动袭击，双方即将正面交锋，胜负尚未决定。`
    : setup;

  if (open) {
    const prefix = rawText.slice(0, bodyStart);
    const suffixStart = close ? bodyEnd + close[0].length : rawText.length;
    const suffix = removePostNarrativeControls(rawText.slice(suffixStart));
    return {
      text: `${prefix}${boundedBody}</contenttext>${suffix ? `\n${suffix}` : ''}`,
      triggered: true,
      truncated,
    };
  }

  return {
    text: removePostNarrativeControls(boundedBody),
    triggered: true,
    truncated,
  };
}

// 轻量宏引擎 —— 支持 {{variable}}, {{random::}}, {{#if::}}, {{roll}} 等宏语法

/** 宏引擎配置 */
export interface MacroEngineOptions {
  /** 可选的随机数生成器（默认 Math.random） */
  rng?: () => number;
}

/**
 * 轻量宏引擎
 * 支持嵌套解析（最多 10 层），支持以下宏：
 * - {{getvar::key}}              读取变量
 * - {{setvar::key::value}}       写入变量（副作用，返回空字符串）
 * - {{incvar::key}}              变量 +1
 * - {{decvar::key}}              变量 -1
 * - {{#if::condition::true::false}} 条件判断
 * - {{random::opt1::opt2::...}}  随机选择
 * - {{roll NdM+K}}               骰子投掷
 * - {{key}}                      通用变量查找（兜底）
 */
export class MacroEngine {
  private variables = new Map<string, string>();
  private context: Record<string, string> = {};
  private rng: () => number;

  constructor(options?: MacroEngineOptions) {
    this.rng = options?.rng ?? Math.random;
  }

  // ── 变量操作 ──

  /** 设置变量 */
  setVar(key: string, value: string): void {
    this.variables.set(key.toLowerCase(), String(value));
  }

  /** 读取变量 */
  getVar(key: string): string {
    const lower = key.toLowerCase();
    // 优先从 session variables 查找
    if (this.variables.has(lower)) {
      return this.variables.get(lower)!;
    }
    // 然后从 context 查找
    if (lower in this.context) {
      return this.context[lower];
    }
    return '';
  }

  /** 批量更新上下文变量 */
  updateContext(data: Record<string, string>): void {
    for (const [key, value] of Object.entries(data)) {
      this.context[key.toLowerCase()] = value;
    }
  }

  // ── 核心解析 ──

  /**
   * 解析模板中的所有宏
   * 最多执行 10 轮嵌套解析直到没有变化
   */
  resolve(template: string): string {
    let result = template;
    for (let depth = 0; depth < 10; depth++) {
      const prev = result;
      result = this.processPass(result);
      if (result === prev) break; // 没有更多宏需要解析
    }
    return result;
  }

  /** 单轮宏处理 */
  private processPass(text: string): string {
    let result = text;

    // 1. {{setvar::key::value}} — 写入变量
    result = result.replace(/\{\{setvar::([^:}]+)::([\s\S]*?)\}\}/gi, (_, key, value) => {
      this.setVar(key.trim(), value);
      return '';
    });

    // 2. {{incvar::key}} — 变量 +1
    result = result.replace(/\{\{incvar::([^}]+)\}\}/gi, (_, key) => {
      const current = parseInt(this.getVar(key.trim()), 10) || 0;
      this.setVar(key.trim(), String(current + 1));
      return '';
    });

    // 3. {{decvar::key}} — 变量 -1
    result = result.replace(/\{\{decvar::([^}]+)\}\}/gi, (_, key) => {
      const current = parseInt(this.getVar(key.trim()), 10) || 0;
      this.setVar(key.trim(), String(current - 1));
      return '';
    });

    // 4. {{getvar::key}} — 显式读取变量
    result = result.replace(/\{\{getvar::([^}]+)\}\}/gi, (_, key) => {
      return this.getVar(key.trim());
    });

    // 5. {{random::opt1::opt2::...}} 或 {{random::opt1,opt2,...}} — 随机选择
    result = result.replace(/\{\{random::([^}]+)\}\}/gi, (_, options) => {
      const opts = options.split(/::|,/).map((s: string) => s.trim()).filter(Boolean);
      if (opts.length === 0) return '';
      const idx = Math.floor(this.rng() * opts.length);
      return opts[idx];
    });

    // 6. {{roll NdM+K}} — 骰子投掷
    result = result.replace(/\{\{roll\s+(\d+)d(\d+)(?:([+-])(\d+))?\}\}/gi,
      (_, diceCount, diceFaces, sign, modifier) => {
        const count = parseInt(diceCount, 10);
        const faces = parseInt(diceFaces, 10);
        let total = 0;
        for (let i = 0; i < count; i++) {
          total += Math.floor(this.rng() * faces) + 1;
        }
        if (sign === '+') total += parseInt(modifier, 10);
        if (sign === '-') total -= parseInt(modifier, 10);
        return String(Math.max(0, total));
      }
    );

    // 7. {{#if::condition::true_text::false_text}} — 条件判断
    result = result.replace(/\{\{#if::([^:}]+)::([^:}]*?)(?:::([^}]*))?\}\}/gi,
      (_, condition, trueText, falseText) => {
        const cond = condition.trim();
        // 支持简单的 == 和 != 比较
        const eqMatch = cond.match(/^(.+?)\s*==\s*(.+)$/);
        const neqMatch = cond.match(/^(.+?)\s*!=\s*(.+)$/);
        let isTrue = false;
        if (eqMatch) {
          isTrue = eqMatch[1].trim() === eqMatch[2].trim();
        } else if (neqMatch) {
          isTrue = neqMatch[1].trim() !== neqMatch[2].trim();
        } else {
          // 非空即为 true
          isTrue = cond !== '' && cond !== '0' && cond.toLowerCase() !== 'false';
        }
        return isTrue ? (trueText ?? '') : (falseText ?? '');
      }
    );

    // 8. {{VAR_SNAPSHOT}} — 保留占位符（运行时延迟绑定）
    // 不做处理，留给 PromptAssembler 在最后替换

    // 9. {{key}} — 通用变量查找（兜底，排除已知命令关键字）
    const knownCommands = new Set([
      'setvar', 'getvar', 'incvar', 'decvar', 'random', 'roll', '#if', 'var_snapshot',
    ]);
    result = result.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
      const trimmed = key.trim().toLowerCase();
      // 跳过已知命令
      if (knownCommands.has(trimmed) || trimmed.startsWith('setvar') || trimmed.startsWith('getvar')
        || trimmed.startsWith('incvar') || trimmed.startsWith('decvar')
        || trimmed.startsWith('random') || trimmed.startsWith('roll')
        || trimmed.startsWith('#if')) {
        return match;
      }
      const value = this.getVar(trimmed);
      return value !== '' ? value : match; // 找不到就保留原文
    });

    return result;
  }
}

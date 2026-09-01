import { describe, expect, test } from 'bun:test';
import { constrainPreCombatNarrative } from './combatNarrativeBoundary';
import { inferImmediateCombatEncounterRequest } from '../engine/variableExtraction';
import type { GameState } from '../schema/variables';

const combatState = {
  人物档案: {},
  v3: {
    schemaVersion: 3,
    featureFlags: { professionsEnabled: true, combatEnabled: true, combatRiskMode: 'normal' },
  },
} as unknown as GameState;

describe('graphical combat narrative boundary', () => {
  test('keeps only the hostile setup and removes model-written combat resolution and stale options', () => {
    const raw = `<contenttext>暴雨封住了巷口，缉鹰司领头卫士拔刀逼近。\n\n刀锋撞在一起，李默格挡后反手刺穿了他的胸口，卫士当场毙命。</contenttext>\n[OPTION_START]\n[OPTION]{t: "搜身", d: "检查尸体"}\n[OPTION_END]\n<TimeAdvance>{"minutes":15,"reason":"战斗"}</TimeAdvance>`;
    const result = constrainPreCombatNarrative(raw, '我迎战');

    expect(result.triggered).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain('缉鹰司领头卫士拔刀逼近');
    expect(result.text).toContain('胜负尚未决定');
    expect(result.text).not.toContain('刺穿');
    expect(result.text).not.toContain('毙命');
    expect(result.text).not.toContain('[OPTION_START]');
    expect(result.text).not.toContain('<TimeAdvance>');
  });

  test('recognizes an unresolved ambush without rewriting its setup prose', () => {
    const raw = '<contenttext>屋顶传来弓弦震响，埋伏者从两侧现身，箭尖已经对准了你。</contenttext>\n[OPTION_START]\n[OPTION]{t: "迎战", d: "拔剑"}\n[OPTION_END]';
    const result = constrainPreCombatNarrative(raw, '观察四周');

    expect(result.triggered).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.text).toContain('埋伏者从两侧现身');
    expect(result.text).not.toContain('[OPTION_START]');
  });

  test('does not touch ordinary narrative', () => {
    const raw = '<contenttext>你推开旅店木门，向老板询问今晚还有没有空房。</contenttext>\n[OPTION_START]\n[OPTION]{t: "住店", d: "付钱"}\n[OPTION_END]';
    expect(constrainPreCombatNarrative(raw, '询问房间')).toEqual({
      text: raw,
      triggered: false,
      truncated: false,
    });
  });

  test('does not treat non-hostile movement or ordinary tool use as an assault', () => {
    const greeting = '<contenttext>少女笑着扑向你，给了你一个久别重逢的拥抱。</contenttext>';
    const cooking = '<contenttext>厨师拔刀切开案板上的南瓜，招呼你坐下吃饭。</contenttext>';

    expect(constrainPreCombatNarrative(greeting, '张开双臂').triggered).toBe(false);
    expect(constrainPreCombatNarrative(cooking, '在桌边坐下').triggered).toBe(false);
    expect(inferImmediateCombatEncounterRequest('张开双臂', greeting, combatState, 13)).toBeUndefined();
    expect(inferImmediateCombatEncounterRequest('在桌边坐下', cooking, combatState, 14)).toBeUndefined();
  });

  test('does not mistake training, memories, or status prose for a new encounter', () => {
    const training = '<contenttext>教官示范了格挡与反击的要领，你照着练习，手臂有些酸痛。</contenttext>';
    const memory = '<contenttext>你想起旧伤留下的疼痛，但眼前的庭院十分安静。</contenttext>';

    expect(constrainPreCombatNarrative(training, '继续训练').triggered).toBe(false);
    expect(constrainPreCombatNarrative(memory, '回忆往事').triggered).toBe(false);
    expect(inferImmediateCombatEncounterRequest('继续训练', training, combatState, 12, { allowResolved: true })).toBeUndefined();
  });

  test('can recover an encounter even when a weak model already wrote the enemy death', () => {
    const request = inferImmediateCombatEncounterRequest(
      '我拔刀迎战',
      '我与袭击者交锋数招，随后一刀将他斩杀。',
      combatState,
      8,
      { allowResolved: true },
    );
    expect(request?.proposal.enemies[0]?.identity).toBe('袭击者');
    expect(request?.hostileAction?.occurred).toBe(true);
  });

  test('uses the same automatic trigger for imminent combat wording and player interception', () => {
    const imminent = '<contenttext>你在巷口撞见追来的敌人，双方剑拔弩张，战斗一触即发。</contenttext>';
    expect(constrainPreCombatNarrative(imminent, '停下脚步').triggered).toBe(true);
    expect(inferImmediateCombatEncounterRequest('停下脚步', imminent, combatState, 9)?.hostileAction?.subjectId).not.toBe('player');

    const intercept = inferImmediateCombatEncounterRequest('我立刻迎击敌人', '敌人堵在面前，双方即将交锋。', combatState, 10);
    expect(intercept?.hostileAction).toMatchObject({ occurred: true, subjectId: 'player' });
  });

  test('recognizes an enemy swinging a weapon as an immediate assault', () => {
    const assault = '<contenttext>敌人挥起长刀冲了过来。</contenttext>';

    expect(constrainPreCombatNarrative(assault, '后退半步').triggered).toBe(true);
    expect(inferImmediateCombatEncounterRequest('后退半步', assault, combatState, 15)).toBeDefined();
  });

  test('does not turn a distant plan to fight into an immediate encounter', () => {
    expect(inferImmediateCombatEncounterRequest('先做准备', '我们计划明天再与敌人开战。', combatState, 11)).toBeUndefined();
  });
});

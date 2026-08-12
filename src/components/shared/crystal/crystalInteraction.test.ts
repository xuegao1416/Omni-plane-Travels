import { describe, expect, test } from 'bun:test';
import { getChoiceCardVisualState, isAriaDisabled } from './crystalInteraction';

describe('getChoiceCardVisualState', () => {
  test('dims siblings when a choice is selected', () => {
    expect(getChoiceCardVisualState({ index: 0, selectedIndex: 1, disabled: false })).toEqual('dimmed');
  });

  test('prioritizes disabled over selection', () => {
    expect(getChoiceCardVisualState({ index: 0, selectedIndex: 0, disabled: true })).toEqual('disabled');
  });

  test('normalizes Booleanish aria-disabled values', () => {
    expect(isAriaDisabled(true)).toBe(true);
    expect(isAriaDisabled('true')).toBe(true);
    expect(isAriaDisabled('false')).toBe(false);
  });
});

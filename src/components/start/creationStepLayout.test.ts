import { describe, expect, test } from 'bun:test';
import { getCreationStepLayout } from './creationStepLayout';

describe('creation step layout', () => {
  test('keeps ordinary worlds at four steps and profession worlds at five', () => {
    expect(getCreationStepLayout(false)).toMatchObject({ professionStep: -1, loadoutStep: 2, historyStep: 3, confirmStep: 4 });
    expect(getCreationStepLayout(false).labels).toHaveLength(4);
    expect(getCreationStepLayout(true)).toMatchObject({ professionStep: 2, loadoutStep: 3, historyStep: 4, confirmStep: 5 });
    expect(getCreationStepLayout(true).labels).toHaveLength(5);
  });
});

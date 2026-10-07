import { expect, test } from 'bun:test';
import { directorLabel, directorTitle, isSupplementaryRecord, participantName, turnTitle } from './directorDisplay';

test('reconstructed titles remain concise without claiming original runtime provenance', () => {
  expect(directorTitle('[本档排程重建，非原存档运行日志]【nid_1：钟楼来客】原著证据：旧文字；本档安排：新文字')).toBe('钟楼来客');
  expect(directorTitle('【wake：R48/R49 圣森醒来】原著证据：旧文字；本档安排：新文字')).toBe('第48轮/第49轮 圣森醒来');
  expect(directorTitle('【公告：标题】这是一句普通的话')).toBe('【公告：标题】这是一句普通的话');
  expect(directorTitle('去钟楼见面')).toBe('去钟楼见面');
  expect(directorTitle('[本档排程重建，非原存档运行日志]缺少标题')).toBe('存档补记');
});

test('display labels preserve uncertainty and never invent turn numbers or person names', () => {
  expect(directorLabel('realized')).toBe('已落实');
  expect(directorLabel('unrecognized')).toBe('未知状态');
  expect(turnTitle('msg_0060_asst')).toBe('第60轮');
  expect(turnTitle('uuid-60')).toBe('回合记录');
  expect(participantName('NPC_格林')).toBe('格林');
  expect(participantName('NPC_123')).toBe('未知人物');
  expect(participantName('actor_1', { actor_1: '伊丽莎白' })).toBe('伊丽莎白');
  expect(isSupplementaryRecord('reconstruction:v3:R60:hyena')).toBe(true);
  expect(isSupplementaryRecord('external:reconstruction:v3:R1:wake')).toBe(true);
  expect(isSupplementaryRecord('reconstruction:directive:R60:player_hyena_kill')).toBe(true);
  expect(isSupplementaryRecord('custom:reconstruction:v4:some_event')).toBe(false);
});

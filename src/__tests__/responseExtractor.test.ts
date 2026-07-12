import { describe, it, expect } from 'bun:test';
import { extractContentForPrompt } from '../engine/responseExtractor';

describe('responseExtractor.extractContentForPrompt — 剥标签', () => {
  it('提取 <contenttext> 内部正文并剥除内部子标签', () => {
    const raw = '<contenttext>你走在街上。<details>思考过程</details><Auto>旁白</Auto>天气晴朗。</contenttext>';
    expect(extractContentForPrompt(raw)).toBe('你走在街上。天气晴朗。');
  });

  it('兜底模式剥除所有已知标签', () => {
    const raw = '开头<thinking>内心独白</thinking>中间<UpdateVariable>{}</UpdateVariable>结尾';
    expect(extractContentForPrompt(raw)).toBe('开头中间结尾');
  });

  it('移除 <image> 标签', () => {
    const raw = '看这张图<image>https://example.com/a.png</image>不错';
    expect(extractContentForPrompt(raw)).toBe('看这张图不错');
  });

  it('剥离 <thinking> 与 reasoning 标签', () => {
    const raw = '正文<thinking>不应出现</thinking>继续';
    expect(extractContentForPrompt(raw)).toBe('正文继续');
  });

  it('空输入返回空字符串', () => {
    expect(extractContentForPrompt('')).toBe('');
  });

  it('无标签的纯文本原样返回', () => {
    expect(extractContentForPrompt('今天天气真好。')).toBe('今天天气真好。');
  });
});

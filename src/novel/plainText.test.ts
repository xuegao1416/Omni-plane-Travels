import { describe, expect, test } from 'bun:test';
import { createNovelDatasetFromText, splitNovelChapters } from './plainText';

describe('plain-text novel import', () => {
  test('recognizes sequential headings glued to prose without losing source offsets', () => {
    const text = '第1章起点\n第一段结尾第2章旅途\n第二段结尾第3章归来\n末段';
    const chapters = splitNovelChapters(text);
    expect(chapters.map(chapter => chapter.title)).toEqual(['第1章起点', '第2章旅途', '第3章归来']);
    expect(chapters.map(chapter => chapter.content)).toEqual(['第一段结尾', '第二段结尾', '末段']);
    for (const chapter of chapters) expect(text.slice(chapter.startOffset, chapter.endOffset)).toBe(chapter.content);
    expect(splitNovelChapters('第1章起点\n他说我们看到第9章答案\n故事继续')).toHaveLength(1);
  });
  const sampledHeadingFormat = `第501章 起始标题\n第一段正文。\n\n第502章 后续标题\n第二段正文。\n\n第503章 再次切换\n第三段正文。`;

  test('splits the real-file heading shape without retaining novel content in the repository', () => {
    expect(splitNovelChapters(sampledHeadingFormat).map(chapter => chapter.title)).toEqual([
      '第501章 起始标题', '第502章 后续标题', '第503章 再次切换',
    ]);
  });

  test('creates pending semantic segments instead of pretending excerpts are summaries', () => {
    const dataset = createNovelDatasetFromText('导入测试', sampledHeadingFormat);
    expect(dataset.segments).toHaveLength(1);
    expect(dataset.segments[0]).toMatchObject({
      chapterIds: dataset.chapters.map(chapter => chapter.id), status: 'pending', summary: '',
    });
  });

  test('recognizes volume and special headings while preserving source offsets', () => {
    const raw = `第一卷 江湖初见\n序章 雨夜\n风雨入城。\n\n第一章 客栈\n少年推门。\n\n番外 故人\n旧友重逢。`;
    const chapters = splitNovelChapters(raw, 'novel-a');

    expect(chapters.map(chapter => [chapter.volumeTitle, chapter.title])).toEqual([
      ['第一卷 江湖初见', '序章 雨夜'],
      ['第一卷 江湖初见', '第一章 客栈'],
      ['第一卷 江湖初见', '番外 故人'],
    ]);
    expect(chapters.every(chapter => raw.slice(chapter.startOffset, chapter.endOffset).trim() === chapter.content)).toBe(true);
    expect(chapters.every(chapter => Boolean(chapter.contentHash))).toBe(true);
  });

  test('does not turn a table of contents into empty chapters', () => {
    const raw = `目录\n第一章 起点\n第二章 风波\n第三章 决断\n\n第一章 起点\n正文一。\n\n第二章 风波\n正文二。`;
    const chapters = splitNovelChapters(raw, 'novel-b');
    expect(chapters.map(chapter => chapter.title)).toEqual(['第一章 起点', '第二章 风波']);
    expect(chapters.map(chapter => chapter.content)).toEqual(['正文一。', '正文二。']);
  });
});

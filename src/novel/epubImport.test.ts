import { describe, expect, test } from 'bun:test';
import JSZip from 'jszip';
import { createNovelDatasetFromEpub } from './epubImport';

describe('EPUB novel import', () => {
  test('uses EPUB 3 anchor ranges once and reports missing spine resources', async () => {
    const zip = new JSZip();
    zip.file('META-INF/container.xml', '<container><rootfile full-path="OPS/book.opf"/></container>');
    zip.file('OPS/book.opf', '<package><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="body" href="text%20one.xhtml" media-type="application/xhtml+xml"/><item id="missing" href="gone.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="body"/><itemref idref="body"/><itemref idref="missing"/></spine></package>');
    zip.file('OPS/nav.xhtml', '<html><nav epub:type="toc"><a href="text%20one.xhtml#a">第一章</a><a href="text%20one.xhtml#a">重复链接</a><a href="text%20one.xhtml#b">第二章</a></nav></html>');
    zip.file('OPS/text one.xhtml', '<html><body><h1 id="a">第一章</h1><p>甲段。</p><h1 id="b">第二章</h1><p>乙段。</p><script>坏代码</script></body></html>');
    const data = await createNovelDatasetFromEpub('book.epub', await zip.generateAsync({ type: 'uint8array' }));
    expect(data.chapters.map(chapter => chapter.title)).toEqual(['第一章', '第二章']);
    expect(data.chapters.map(chapter => chapter.content)).toEqual(['甲段。', '乙段。']);
    expect(data.importIssues?.some(issue => issue.code === 'missing_resource' && issue.severity === 'error')).toBe(true);
  });
  test('uses NCX chapter labels and retains untitled preface before anchors', async () => {
    const zip = new JSZip();
    zip.file('META-INF/container.xml', '<container><rootfile full-path="book.opf"/></container>');
    zip.file('book.opf', '<package><manifest><item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="body" href="body.xhtml" media-type="application/xhtml+xml"/></manifest><spine toc="toc"><itemref idref="body"/></spine></package>');
    zip.file('toc.ncx', '<ncx><navMap><navPoint><navLabel><text>起航</text></navLabel><content src="body.xhtml#start"/></navPoint></navMap></ncx>');
    zip.file('body.xhtml', '<html><body><p>卷前记。</p><p id="start">登船。</p></body></html>');
    const data = await createNovelDatasetFromEpub('book.epub', await zip.generateAsync({ type: 'uint8array' }));
    expect(data.chapters.map(chapter => chapter.content)).toEqual(['卷前记。', '登船。']);
    expect(data.chapters[1].title).toBe('起航');
  });
  test('reads body documents in spine order and ignores navigation files', async () => {
    const zip = new JSZip();
    zip.file('META-INF/container.xml', `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/content.opf"/></rootfiles></container>`);
    zip.file('OPS/content.opf', `<?xml version="1.0"?><package><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">江湖录</dc:title></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="one.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c2"/><itemref idref="c1"/></spine></package>`);
    zip.file('OPS/nav.xhtml', '<html><body><nav>目录</nav></body></html>');
    zip.file('OPS/one.xhtml', '<html><body><h1>第一章 起点</h1><p>第一段正文。</p></body></html>');
    zip.file('OPS/two.xhtml', '<html><body><h1>第二章 风波</h1><p>第二段正文。</p></body></html>');

    const dataset = await createNovelDatasetFromEpub('fallback.epub', await zip.generateAsync({ type: 'uint8array' }));

    expect(dataset.title).toBe('江湖录');
    expect(dataset.sourceType).toBe('epub');
    expect(dataset.chapters.map(chapter => chapter.title)).toEqual(['第二章 风波', '第一章 起点']);
    expect(dataset.chapters.map(chapter => chapter.content)).toEqual(['第二段正文。', '第一段正文。']);
  });
});

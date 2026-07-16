// 生产构建脚本 - 打包 + 复制静态资源
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const DIST = './dist';

console.log('🔨 开始生产构建...');

// 1. 确保 dist 目录存在
if (!existsSync(DIST)) {
  mkdirSync(DIST, { recursive: true });
}

// 2. 打包 JS（Bun 会把 JS 中 import 的 .css 抽取为独立 asset 输出）
console.log('📦 打包 JavaScript...');
const jsResult = await Bun.build({
  entrypoints: ['./src/main.tsx'],
  target: 'browser',
  format: 'esm',
  // splitting 暂时关闭：Bun 1.3.14 在 Linux 上 splitting 行为与 Windows 不一致
  // （Linux 产出 130+ chunk 且部分损坏，Windows 只有 5 个），待 Bun 修复后重新开启。
  splitting: false,
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
});

if (!jsResult.success) {
  console.error('❌ JS 打包失败:');
  for (const log of jsResult.logs) {
    console.error(log);
  }
  process.exit(1);
}

// 遍历全部输出：
// - entry-point → 主入口 main.js
// - chunk       → 动态 import 的代码分片（InlineDiceCard / InlineImageGenButton / mermaid / jszip 等），
//                 必须原样写入 dist/ 且文件名保持不变，main.js 通过相对路径 import 这些分片
// - asset(.css) → JS 抽取的组件 CSS，稍后合并进 main.css
// 旧脚本对非 asset 输出一律 jsContent = text，会静默丢弃除最后一个 chunk 外的所有分片，
// 导致运行时动态 import 失败。这里区分 entry-point 与 chunk，分别落盘。
let jsContent = '';
const jsExtractedCssChunks: string[] = [];
for (const output of jsResult.outputs) {
  const text = await output.text();
  if (output.kind === 'asset' && output.path.endsWith('.css')) {
    jsExtractedCssChunks.push(text);
    console.log(`   🧩 JS 抽取 CSS: ${output.path} (${(text.length / 1024).toFixed(1)} KB)`);
  } else if (output.kind === 'entry-point') {
    jsContent = text;
  } else {
    // chunk：动态分片，原样落盘（保留文件名，main.js 引用它）
    const baseName = output.path.split(/[\\/]/).pop() || 'chunk.js';
    writeFileSync(join(DIST, baseName), text);
    console.log(`   📦 JS 分片: ${baseName} (${(text.length / 1024 / 1024).toFixed(2)} MB)`);
  }
}
writeFileSync(join(DIST, 'main.js'), jsContent);
console.log(`   ✅ main.js (${(jsContent.length / 1024 / 1024).toFixed(2)} MB)`);

// 3. 打包 CSS（从 index.css 作为入口，含 tokens/base/layout/responsive 等全局样式）
console.log('🎨 打包 CSS...');
const cssResult = await Bun.build({
  entrypoints: ['./src/index.css'],
  target: 'browser',
  minify: true,
});

if (!cssResult.success) {
  console.error('❌ CSS 打包失败:');
  for (const log of cssResult.logs) {
    console.error(log);
  }
  process.exit(1);
}

// 合并 CSS：全局入口 CSS 在前，JS 抽取的组件 CSS 在后
// 顺序保证组件样式可使用 tokens.css 定义的 CSS 变量，且能覆盖全局默认值
const globalCss = await cssResult.outputs[0].text();
const componentCss = jsExtractedCssChunks.join('\n');
const cssContent = globalCss + (componentCss ? '\n' + componentCss : '');
writeFileSync(join(DIST, 'main.css'), cssContent);
console.log(`   ✅ main.css (${(cssContent.length / 1024).toFixed(1)} KB)`
  + (componentCss ? ` [全局 ${(globalCss.length / 1024).toFixed(1)} KB + 组件 ${(componentCss.length / 1024).toFixed(1)} KB]` : ''));

// 4. 生成生产用 index.html
console.log('📝 生成 index.html...');
const htmlTemplate = readFileSync('./index.html', 'utf-8');
const prodHtml = htmlTemplate
  .replace('/src/index.css', '/main.css')
  .replace('/src/main.tsx', '/main.js');
writeFileSync(join(DIST, 'index.html'), prodHtml);
console.log('   ✅ index.html');

// 5. 复制 PWA 资源
console.log('📱 复制 PWA 资源...');
if (existsSync('./manifest.json')) {
  copyFileSync('./manifest.json', join(DIST, 'manifest.json'));
  console.log('   ✅ manifest.json');
}
if (existsSync('./sw.js')) {
  copyFileSync('./sw.js', join(DIST, 'sw.js'));
  console.log('   ✅ sw.js');
}
if (existsSync('./icon.png')) {
  copyFileSync('./icon.png', join(DIST, 'icon.png'));
  console.log('   ✅ icon.png');
}
if (existsSync('./scarborough-fair.mp3')) {
  copyFileSync('./scarborough-fair.mp3', join(DIST, 'scarborough-fair.mp3'));
  console.log('   ✅ scarborough-fair.mp3');
}

console.log('\n✨ 构建完成！dist/ 目录结构：');
console.log('   dist/');
console.log('   ├── index.html');
console.log('   ├── main.js');
console.log('   ├── main.css');
console.log('   ├── manifest.json (PWA 配置)');
console.log('   ├── sw.js (Service Worker)');
console.log('   └── icon.png (应用图标)');

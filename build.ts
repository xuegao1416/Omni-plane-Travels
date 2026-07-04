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

// 遍历全部输出：entry-point → JS，asset(.css) → 组件 CSS
// 旧脚本只取 outputs[0]，导致 JS 中 import 的 CSS（覆盖层/弹窗/按钮等）
// 被静默丢弃，组件样式全部丢失。这里把 JS 抽取的 CSS 收集起来，稍后合并进 main.css。
let jsContent = '';
const jsExtractedCssChunks: string[] = [];
for (const output of jsResult.outputs) {
  const text = await output.text();
  if (output.kind === 'asset' && output.path.endsWith('.css')) {
    jsExtractedCssChunks.push(text);
    console.log(`   🧩 JS 抽取 CSS: ${output.path} (${(text.length / 1024).toFixed(1)} KB)`);
  } else {
    jsContent = text;
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
  .replace('/app.js', '/main.js');
writeFileSync(join(DIST, 'index.html'), prodHtml);
console.log('   ✅ index.html');

// 5. 复制 PWA 资源
console.log('📱 复制 PWA 资源...');
if (existsSync('./manifest.json')) {
  copyFileSync('./manifest.json', join(DIST, 'manifest.json'));
  console.log('   ✅ manifest.json');
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

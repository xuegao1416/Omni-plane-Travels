// Bun开发服务器 - 整体打包 + 静态文件 + 测试控制API
const PORT = 3456;

interface DevBundle {
  js: any;       // Bun BuildArtifact — 打包后的 JS
  css: string;   // JS 中 import 的 CSS Module / 普通 CSS，Bun 抽取后合并的字符串
}

async function buildApp(): Promise<DevBundle> {
  const result = await Bun.build({
    entrypoints: ['./src/main.tsx'],
    target: 'browser',
    format: 'esm',
    define: { 'process.env.NODE_ENV': '"development"' },
  });
  if (!result.success || result.outputs.length === 0) {
    const errors = result.logs?.filter(l => l.level === 'error').map(l => l.message).join('\n') || '未知构建错误';
    throw new Error(`构建失败:\n${errors}`);
  }

  // 遍历全部输出：entry-point → JS，asset(.css) → CSS Module / 组件 CSS
  // 旧代码只取 outputs[0]，导致 JS 中 import 的 .module.css 被静默丢弃
  let js: any = null;
  const cssChunks: string[] = [];
  for (const output of result.outputs) {
    if (output.kind === 'asset' && output.path.endsWith('.css')) {
      cssChunks.push(await output.text());
    } else {
      js = output;
    }
  }
  return { js, css: cssChunks.join('\n') };
}

// 缓存构建结果
let cachedBundle: DevBundle | null = null;
let lastBuild = 0;
let building = false;
let buildPromise: Promise<DevBundle> | null = null;

async function getBundle(): Promise<DevBundle> {
  const now = Date.now();
  if (cachedBundle && now - lastBuild < 5000) {
    return cachedBundle;
  }
  if (building && buildPromise) {
    return buildPromise;
  }
  building = true;
  buildPromise = buildApp().then(bundle => {
    cachedBundle = bundle;
    lastBuild = Date.now();
    building = false;
    buildPromise = null;
    return bundle;
  }).catch(err => {
    building = false;
    buildPromise = null;
    if (cachedBundle) {
      console.error('[构建出错，使用缓存]', err.message);
      return cachedBundle;
    }
    throw err;
  });
  return buildPromise;
}

/** 为 index.html 注入 CSS Module link，让组件样式在 dev 下也能加载 */
function injectCssModuleLink(html: string): string {
  if (html.includes('/app.css')) return html; // 已注入，幂等
  return html.replace('</head>', '<link rel="stylesheet" href="/app.css">\n</head>');
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    let pathname = url.pathname;

    if (pathname === '/') pathname = '/index.html';

    // 角色卡JSON（世界书数据源）
    if (pathname === '/card.json') {
      const cardFile = Bun.file('./世界漫游指南.json');
      if (await cardFile.exists()) {
        return new Response(cardFile, {
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // JS 入口 — 返回打包后的 JS（禁止缓存）
    if (pathname === '/app.js' || pathname === '/src/main.tsx') {
      try {
        const bundle = await getBundle();
        if (bundle.js) {
          return new Response(bundle.js, {
            headers: {
              'Content-Type': 'application/javascript',
              'Cache-Control': 'no-store, no-cache, must-revalidate',
            },
          });
        }
        return new Response(`console.error("构建输出为空")`, {
          headers: { 'Content-Type': 'application/javascript' },
        });
      } catch (err: any) {
        console.error('[app.js 构建错误]', err.message);
        return new Response(`document.body.innerHTML='<pre style="color:red">构建失败: ${err.message.replace(/'/g, "\\'")}</pre>'`, {
          headers: { 'Content-Type': 'application/javascript' },
        });
      }
    }

    // CSS Module — JS 中 import 的 .module.css / 组件 .css 被 Bun 抽取后的合并内容
    if (pathname === '/app.css') {
      try {
        const bundle = await getBundle();
        return new Response(bundle.css, {
          headers: {
            'Content-Type': 'text/css',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
          },
        });
      } catch (err: any) {
        console.error('[app.css 错误]', err.message);
        return new Response('/* CSS Module 构建失败 */', {
          headers: { 'Content-Type': 'text/css' },
        });
      }
    }

    // 静态文件（禁止缓存）。index.html 需要注入 CSS Module link
    const file = Bun.file(`.${pathname}`);
    if (await file.exists()) {
      if (pathname === '/index.html') {
        let html = await file.text();
        html = injectCssModuleLink(html);
        return new Response(html, {
          headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' },
        });
      }
      return new Response(file, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    // SPA fallback — 也需要注入 CSS Module link
    let html = await Bun.file('./index.html').text();
    html = injectCssModuleLink(html);
    return new Response(html, {
      headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' },
    });
  },
});

console.log(`🚀 世界漫游指南运行在 http://localhost:${PORT}`);

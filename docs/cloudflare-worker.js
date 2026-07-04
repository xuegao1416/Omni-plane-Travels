/**
 * API Proxy Worker - 用于绕过浏览器 CORS 限制
 *
 * 部署步骤：
 * 1. 登录 https://dash.cloudflare.com
 * 2. 左侧菜单 → Workers & Pages → Create Application → Create Worker
 * 3. 把这段代码粘贴进去，替换默认代码
 * 4. 点击 Save and Deploy
 * 5. 复制你的 Worker URL（格式：https://xxx.xxx.workers.dev）
 *
 * 使用方式：
 * 在应用设置中填入 Worker URL 作为代理地址
 *
 * 安全说明：
 * - 此 Worker 仅做请求转发，不存储任何数据
 * - API Key 通过请求头传递，不会被记录或泄露
 * - 代码完全开源，可自行审查
 */

export default {
  async fetch(request) {
    // 处理 CORS 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // 从请求头获取目标 URL
    const targetUrl = request.headers.get('X-Target-URL');

    if (!targetUrl) {
      return new Response(
        JSON.stringify({
          error: 'Missing X-Target-URL header',
          usage: 'Set X-Target-URL header to the target API endpoint',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // 构建转发请求
    const headers = new Headers();
    for (const [key, value] of request.headers) {
      // 跳过 Worker 相关的头
      if (key.startsWith('cf-') || key === 'x-target-url' || key === 'host') {
        continue;
      }
      headers.set(key, value);
    }

    try {
      // 转发请求到目标 API
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: headers,
        body: request.body,
      });

      // 构建响应，添加 CORS 头
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      responseHeaders.set('Access-Control-Allow-Headers', '*');

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: 'Proxy request failed',
          message: error.message,
        }),
        {
          status: 502,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }
  },
};

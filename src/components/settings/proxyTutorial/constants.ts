// Cloudflare Worker proxy code template
export const PROXY_CODE = `export default {
  async fetch(request) {
    const timestamp = new Date().toISOString();
    const method = request.method;
    const url = new URL(request.url);

    // 处理 CORS 预检请求
    if (method === 'OPTIONS') {
      console.log(\`[\${timestamp}] OPTIONS \${url.pathname}\`);
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
    const hasAuth = request.headers.has('Authorization');
    const contentType = request.headers.get('Content-Type') || '';

    // 日志：记录收到的请求
    console.log(\`[\${timestamp}] → \${method} \${url.pathname}\`);
    console.log(\`  Target-URL: \${targetUrl || '(缺失! 未设置 X-Target-URL)'}\`);
    console.log(\`  Authorization: \${hasAuth ? '✓ 已设置' : '✗ 未设置'}\`);
    console.log(\`  Content-Type: \${contentType}\`);

    if (!targetUrl) {
      console.error(\`[\${timestamp}] ✗ 错误: 缺少 X-Target-URL 请求头\`);
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

    // 检查目标 URL 是否合法
    try {
      new URL(targetUrl);
    } catch {
      console.error(\`[\${timestamp}] ✗ 错误: X-Target-URL 不是有效 URL → \${targetUrl}\`);
      return new Response(
        JSON.stringify({
          error: 'Invalid X-Target-URL',
          message: \`"\${targetUrl}" 不是有效的 URL，必须包含 http:// 或 https://\`,
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
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

    const start = Date.now();
    try {
      // 转发请求到目标 API
      console.log(\`[\${timestamp}] → 转发到: \${targetUrl}\`);
      const response = await fetch(targetUrl, {
        method: method,
        headers: headers,
        body: request.body,
      });
      const elapsed = Date.now() - start;

      // 日志：记录响应
      console.log(\`[\${timestamp}] ← 响应: \${response.status} \${response.statusText} (\${elapsed}ms)\`);

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        console.warn(\`[\${timestamp}] ⚠ 响应异常: \${errBody.slice(0, 500)}\`);
        // 重新构造 body（因为已经读取过了）
        return new Response(errBody, {
          status: response.status,
          statusText: response.statusText,
          headers: {
            'Content-Type': response.headers.get('Content-Type') || 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*',
          },
        });
      }

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
      const elapsed = Date.now() - start;
      console.error(\`[\${timestamp}] ✗ 请求失败 (\${elapsed}ms): \${error.message}\`);
      console.error(\`  目标: \${targetUrl}\`);
      console.error(\`  可能原因: 目标地址不可达 / DNS 解析失败 / 超时\`);
      return new Response(
        JSON.stringify({
          error: 'Proxy request failed',
          message: error.message,
          target: targetUrl,
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
};`;

/**
 * api/[[route]].ts — Pages Functions 入口（仅捕获 /api/* 路径）。
 *
 * 放在 functions/api/ 下（而非 functions/ 根 catch-all），确保只有 /api/* 进入 Hono，
 * 其余前端 SPA 客户端路由（/saves、/workshop、/login …）仍由 Pages 静态托管 + SPA 回退处理，
 * 不会被 Functions 拦截成 404。
 *
 * 运行时即 Workers 运行时，env 即 wrangler.toml 的绑定。
 */
import app from '../../src/server/index';
import type { Bindings } from '../../src/server/types';

export interface PagesFunctionContext {
  request: Request;
  env: Bindings;
  executionCtx: ExecutionContext;
  waitUntil(promise: Promise<unknown>): void;
}

export const onRequest = async (context: PagesFunctionContext): Promise<Response> => {
  return app.fetch(context.request, context.env, context.executionCtx);
};

/**
 * fakeD1.ts — 用 bun:sqlite 内存库模拟 Cloudflare D1（prepare/bind/first/all/run/batch/exec），
 * 并按顺序执行 migrations/*.sql，让服务端路由能在测试里跑真实 SQL。
 */
import { Database } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { D1Database } from '@cloudflare/workers-types';

type Value = string | number | bigint | boolean | null | Uint8Array;

function toValue(value: unknown): Value {
  if (value === undefined) throw new Error('D1_TYPE_ERROR: undefined 不能作为绑定参数');
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value as Value;
}

class FakeStatement {
  constructor(private readonly db: Database, readonly sql: string, private readonly params: Value[] = []) {}

  bind(...values: unknown[]): FakeStatement {
    return new FakeStatement(this.db, this.sql, values.map(toValue));
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.db.query(this.sql).get(...this.params) as Record<string, unknown> | null;
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }

  async all<T = Record<string, unknown>>() {
    return { results: this.db.query(this.sql).all(...this.params) as T[], success: true, meta: {} };
  }

  async run() {
    return this.runSync();
  }

  allSync() {
    return { success: true, results: this.db.query(this.sql).all(...this.params), meta: {} };
  }

  runSync() {
    const result = this.db.query(this.sql).run(...this.params);
    return { success: true, results: [], meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } };
  }

  async raw<T = unknown[]>() {
    return this.db.query(this.sql).values(...this.params) as T[];
  }
}

export interface FakeD1 {
  db: D1Database;
  sqlite: Database;
}

export const MIGRATIONS_DIR = join(import.meta.dir, '../../../migrations');

export function createFakeD1(migrationsDir = MIGRATIONS_DIR): FakeD1 {
  const sqlite = new Database(':memory:');
  const files = readdirSync(migrationsDir).filter(name => name.endsWith('.sql')).sort();
  for (const name of files) sqlite.exec(readFileSync(join(migrationsDir, name), 'utf8'));
  const db = {
    prepare: (sql: string) => new FakeStatement(sqlite, sql),
    batch: async (statements: FakeStatement[]) => {
      const run = sqlite.transaction(() => statements.map(statement => (/^\s*select/i.test(statement.sql) ? statement.allSync() : statement.runSync())));
      return run();
    },
    exec: async (sql: string) => {
      sqlite.exec(sql);
      return { count: 1, duration: 0 };
    },
    dump: async () => new ArrayBuffer(0),
  };
  return { db: db as unknown as D1Database, sqlite };
}

// scripts/test-localStorage-shim.ts
//
// 测试环境 localStorage 内存垫片 —— 纯测试基础设施，不改动任何业务代码。
//
// 背景：
//   浏览器运行时原生提供 localStorage；但 `bun test` 运行在 Node 环境，
//   不存在 localStorage。桥接修复后，webEventStore 经 eventDb 动态引入
//   saveStore.ts，而 saveStore 在 create() 初始化时（src/stores/saveStore.ts:72）
//   读取 localStorage.getItem(ACTIVE_SAVE_KEY)，导致 Node 测试环境抛
//   "ReferenceError: localStorage is not defined"。
//   （测试里引入的 fake-indexeddb/auto 只补 IndexedDB，不补 localStorage。）
//
// 方案：
//   在任意测试文件 / 业务模块加载之前，于 globalThis 上安装一份最小化的
//   in-memory localStorage 实现（支持 getItem/setItem/removeItem/clear/key/length），
//   从而使整个测试套件在 Node 环境下也能恢复全绿。
//   仅当 localStorage 尚未定义时才安装（浏览器/已有环境不受影响）。

class MemoryStorage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  getItem(key: string): string | null {
    if (!this.store.has(key)) return null;
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(String(key), String(value));
  }

  removeItem(key: string): void {
    this.store.delete(String(key));
  }

  clear(): void {
    this.store.clear();
  }

  key(index: number): string | null {
    const keys = Array.from(this.store.keys());
    return keys[index] ?? null;
  }
}

const g = globalThis as unknown as { localStorage?: Storage };
if (typeof g.localStorage === "undefined") {
  g.localStorage = new MemoryStorage() as unknown as Storage;
}

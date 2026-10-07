export type JourneyDestination = 'start' | 'settings';

/** Owns the leave transaction; a page can change only after an unchanged complete capture is durable. */
export class LeaveJourney {
  private pending: Promise<'left' | 'cancelled'> | null = null;
  private epoch = 0;
  constructor(private readonly ports: {
    busy(): boolean;
    blocked?(): boolean;
    version(): string;
    identity?(): string;
    confirmStop(): Promise<boolean>;
    stop(): void | Promise<void>;
    flush(): Promise<void>;
    navigate(target: JourneyDestination): void;
  }) {}
  cancel(): void { this.epoch++; }
  run(target: JourneyDestination): Promise<'left' | 'cancelled'> {
    if (this.pending) return this.pending;
    const operation = this.leave(target);
    this.pending = operation;
    void operation.finally(() => { if (this.pending === operation) this.pending = null; }).catch(() => {});
    return operation;
  }
  private async leave(target: JourneyDestination): Promise<'left' | 'cancelled'> {
    // Settings cover the mounted journey; they do not release its writers.
    if (target === 'settings') {
      this.ports.navigate(target);
      return 'left';
    }
    const epoch = this.epoch, identity = this.ports.identity?.();
    const assertOwner = () => { if (epoch !== this.epoch || this.ports.identity?.() !== identity) throw new Error('离开操作已停止或当前旅程已变更，请重新操作。'); };
    if (this.ports.busy()) {
      if (!await this.ports.confirmStop()) return 'cancelled';
      assertOwner();
      await this.ports.stop();
      assertOwner();
      // Cancellation may still be settling; never silently leave with an active writer.
      if (this.ports.busy()) throw new Error('当前操作正在停止，请等待停止完成后再保存离开。');
    }
    if (this.ports.blocked?.()) throw new Error('当前行动正在处理或保存，请等待完成后再保存离开。');
    const version = this.ports.version();
    await this.ports.flush();
    assertOwner();
    if (this.ports.busy() || this.ports.blocked?.() || this.ports.version() !== version) throw new Error('保存期间旅程有新的变化，请再次保存离开。');
    this.ports.navigate(target);
    return 'left';
  }
}

/** Reading does not activate a save. Restoration must succeed before UI and metadata change. */
export class LoadJourney<T> {
  private pending = false;
  private epoch = 0;
  constructor(private readonly ports: { read(id: string): Promise<T | null>; restore(save: T): void; activate(save: T): void }) {}
  cancel(): void { this.epoch++; }
  async run(id: string): Promise<void> {
    if (this.pending) throw new Error('正在读取旅程，请等待当前读取完成。');
    this.pending = true;
    const epoch = this.epoch;
    try {
      const save = await this.ports.read(id);
      if (epoch !== this.epoch) throw new Error('读取已停止，当前旅程没有切换。');
      if (!save) throw new Error('这个存档已不存在。请刷新存档列表，或重新导入备份。');
      this.ports.restore(save);
      this.ports.activate(save);
    } finally { this.pending = false; }
  }
}

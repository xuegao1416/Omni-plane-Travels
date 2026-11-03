export interface ImageUrlRecord { blob: Blob; generation?: { sourcePrompt?: string } }
export interface ImageUrlLease { readonly url: string; readonly record: ImageUrlRecord; release(): void }
interface Entry { url: string; record: ImageUrlRecord; refs: number }

/** Blob persistence belongs to imageDb; this owner manages only mounted displays. */
export class ImageUrlPool {
  private entries = new Map<string, Entry>();
  private reads = new Map<string, Promise<ImageUrlRecord | null>>();
  private revisions = new Map<string, number>();
  private listeners = new Set<() => void>();
  private version = 0;
  constructor(private readonly read: (key: string) => Promise<ImageUrlRecord | null>,
    private readonly urls = { create: (blob: Blob) => URL.createObjectURL(blob), revoke: (url: string) => URL.revokeObjectURL(url) }) {}

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.version;
  invalidate(keys?: readonly string[]): void {
    for (const key of keys ?? new Set([...this.entries.keys(), ...this.reads.keys()])) {
      this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1);
      this.entries.delete(key); this.reads.delete(key);
    }
    this.version++;
    this.listeners.forEach(listener => listener());
  }
  async acquire(key: string): Promise<ImageUrlLease | null> {
    if (!key) return null;
    const revision = this.revisions.get(key) ?? 0;
    let entry = this.entries.get(key);
    if (!entry) {
      let pending = this.reads.get(key);
      if (!pending) {
        pending = this.read(key).finally(() => { if (this.reads.get(key) === pending) this.reads.delete(key); });
        this.reads.set(key, pending);
      }
      const record = await pending;
      if ((this.revisions.get(key) ?? 0) !== revision) return this.acquire(key);
      entry = this.entries.get(key);
      if (!entry && record) {
        entry = { record, url: this.urls.create(record.blob), refs: 0 };
        this.entries.set(key, entry);
      }
    }
    if (!entry) return null;
    const held = entry; held.refs++;
    let released = false;
    return { url: held.url, record: held.record, release: () => {
      if (released) return; released = true;
      if (--held.refs === 0) {
        if (this.entries.get(key) === held) this.entries.delete(key);
        this.urls.revoke(held.url);
      }
    } };
  }
}

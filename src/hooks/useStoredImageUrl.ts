import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { imageDb, imageUrls } from '../storage/imageDb';
import type { ImageUrlLease } from '../storage/imageUrls';

/** URLs are borrowed by displays, never saved in gameplay state or global caches. */
export function useStoredImageUrl(key?: string | null, fallbackName?: string, expectedPrompt?: string): string {
  const revision = useSyncExternalStore(imageUrls.subscribe, imageUrls.getSnapshot, imageUrls.getSnapshot);
  const identity = JSON.stringify([key ?? '', fallbackName ?? '', expectedPrompt ?? null]);
  const [display, setDisplay] = useState({ identity: '', url: '' });
  const held = useRef<ImageUrlLease | null>(null);
  const retired = useRef<ImageUrlLease[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let lease = key ? await imageUrls.acquire(key) : null;
      if (lease && expectedPrompt !== undefined && lease.record.generation?.sourcePrompt !== undefined
        && lease.record.generation.sourcePrompt !== expectedPrompt) { lease.release(); lease = null; }
      if (!lease && fallbackName) {
        const fallback = await imageDb.findPortraitKeyByName(fallbackName);
        if (fallback) lease = await imageUrls.acquire(fallback);
      }
      if (cancelled) { lease?.release(); return; }
      if (held.current) retired.current.push(held.current);
      held.current = lease;
      setDisplay({ identity, url: lease?.url ?? '' });
    })().catch(error => { if (!cancelled) console.warn('[画像] 图片读取失败:', error); });
    return () => { cancelled = true; };
  }, [key, fallbackName, expectedPrompt, identity, revision]);
  useLayoutEffect(() => { retired.current.forEach(lease => lease.release()); retired.current = []; }, [display]);
  useEffect(() => () => {
    held.current?.release(); held.current = null;
    retired.current.forEach(lease => lease.release()); retired.current = [];
  }, []);
  return display.identity === identity ? display.url : '';
}

export function useStoredImageUrls(keys: Record<string, string>): Record<string, string> {
  const revision = useSyncExternalStore(imageUrls.subscribe, imageUrls.getSnapshot, imageUrls.getSnapshot);
  const identity = JSON.stringify(keys);
  const [display, setDisplay] = useState<{ identity: string; urls: Record<string, string> }>({ identity: '', urls: {} });
  const held = useRef<ImageUrlLease[]>([]), retired = useRef<ImageUrlLease[]>([]);
  useEffect(() => {
    let cancelled = false;
    const leases: ImageUrlLease[] = [];
    void (async () => {
      const urls: Record<string, string> = {};
      for (const [id, key] of Object.entries(JSON.parse(identity) as Record<string, string>)) {
        if (cancelled) break;
        const lease = await imageUrls.acquire(key);
        if (lease) { leases.push(lease); urls[id] = lease.url; }
      }
      if (cancelled) { leases.forEach(lease => lease.release()); return; }
      retired.current.push(...held.current); held.current = leases;
      setDisplay({ identity, urls });
    })().catch(error => {
      leases.forEach(lease => lease.release());
      if (!cancelled) console.warn('[画像] 人物图片读取失败:', error);
    });
    return () => { cancelled = true; };
  }, [identity, revision]);
  useLayoutEffect(() => { retired.current.forEach(lease => lease.release()); retired.current = []; }, [display]);
  useEffect(() => () => {
    held.current.forEach(lease => lease.release()); held.current = [];
    retired.current.forEach(lease => lease.release()); retired.current = [];
  }, []);
  return display.identity === identity ? display.urls : {};
}

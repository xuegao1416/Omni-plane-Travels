/**
 * 玩法配置的版本号。异步加载的配置（如事件目录）变化时递增，缓存的玩法宿主据此重建。
 */
let generation = 0;

export function gameplayGeneration(): number {
  return generation;
}

export function bumpGameplayGeneration(): void {
  generation += 1;
}

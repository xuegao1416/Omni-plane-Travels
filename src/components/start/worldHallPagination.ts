export function getHallPageCount(customWorldCount: number): number {
  return 2 + Math.floor(customWorldCount / 6);
}

export function canAdvanceHallPage(hallPage: number, visibleWorldCount: number): boolean {
  return hallPage === 0 || visibleWorldCount >= 6;
}

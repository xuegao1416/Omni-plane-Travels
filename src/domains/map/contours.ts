/**
 * 等值线：在采样网格上跑 marching squares，按边编号把线段串成折线，再做 Chaikin 平滑。
 * 海岸线（海拔 0）、等高线、地区边界都用它；坐标为地图单位。
 */

export type Point = [number, number];
export interface Polyline { points: Point[]; closed: boolean }

interface Segment { a: number; b: number }

/**
 * values 为 cols × rows 的顶点值；返回值 > level 区域的边界。
 * include(col, row) 返回 false 的格子不出线（如只画陆地上的边界）。
 */
export function contourLines(
  values: ArrayLike<number>, cols: number, rows: number, level: number,
  size: { width: number; height: number },
  include?: (col: number, row: number) => boolean,
): Polyline[] {
  const dx = size.width / (cols - 1);
  const dy = size.height / (rows - 1);
  const value = (col: number, row: number) => values[row * cols + col]!;
  const hEdge = (col: number, row: number) => (row * cols + col) * 2;
  const vEdge = (col: number, row: number) => (row * cols + col) * 2 + 1;
  const segments: Segment[] = [];
  for (let row = 0; row < rows - 1; row++) {
    for (let col = 0; col < cols - 1; col++) {
      const tl = value(col, row);
      const tr = value(col + 1, row);
      const br = value(col + 1, row + 1);
      const bl = value(col, row + 1);
      const code = (tl > level ? 8 : 0) | (tr > level ? 4 : 0) | (br > level ? 2 : 0) | (bl > level ? 1 : 0);
      if (code === 0 || code === 15) continue;
      if (include && !include(col, row)) continue;
      const top = hEdge(col, row);
      const bottom = hEdge(col, row + 1);
      const left = vEdge(col, row);
      const right = vEdge(col + 1, row);
      const push = (a: number, b: number) => segments.push({ a, b });
      switch (code) {
        case 1: case 14: push(left, bottom); break;
        case 2: case 13: push(bottom, right); break;
        case 3: case 12: push(left, right); break;
        case 4: case 11: push(top, right); break;
        case 6: case 9: push(top, bottom); break;
        case 7: case 8: push(left, top); break;
        case 5: case 10: {
          const center = (tl + tr + br + bl) / 4 > level;
          if ((code === 5) === center) { push(left, top); push(bottom, right); }
          else { push(left, bottom); push(top, right); }
          break;
        }
      }
    }
  }
  const position = (edge: number): Point => {
    const vertical = edge & 1;
    const cell = edge >> 1;
    const col = cell % cols;
    const row = Math.floor(cell / cols);
    if (!vertical) {
      const a = value(col, row);
      const b = value(Math.min(cols - 1, col + 1), row);
      const t = b === a ? 0.5 : Math.min(1, Math.max(0, (level - a) / (b - a)));
      return [(col + t) * dx, row * dy];
    }
    const a = value(col, row);
    const b = value(col, Math.min(rows - 1, row + 1));
    const t = b === a ? 0.5 : Math.min(1, Math.max(0, (level - a) / (b - a)));
    return [col * dx, (row + t) * dy];
  };
  const byEdge = new Map<number, number[]>();
  segments.forEach((segment, index) => {
    for (const edge of [segment.a, segment.b]) {
      const list = byEdge.get(edge);
      if (list) list.push(index); else byEdge.set(edge, [index]);
    }
  });
  const used = new Uint8Array(segments.length);
  const lines: Polyline[] = [];
  const walk = (start: number): number[] => {
    const chain: number[] = [];
    let edge = start;
    for (;;) {
      const next = (byEdge.get(edge) ?? []).find(index => !used[index]);
      if (next === undefined) break;
      used[next] = 1;
      const segment = segments[next]!;
      edge = segment.a === edge ? segment.b : segment.a;
      chain.push(edge);
    }
    return chain;
  };
  for (let index = 0; index < segments.length; index++) {
    if (used[index]) continue;
    used[index] = 1;
    const segment = segments[index]!;
    const forward = walk(segment.b);
    const backward = walk(segment.a);
    const edges = [...backward.reverse(), segment.a, segment.b, ...forward];
    const closed = edges.length > 3 && edges[0] === edges[edges.length - 1];
    const points = (closed ? edges.slice(0, -1) : edges).map(position);
    if (points.length >= 2) lines.push({ points, closed });
  }
  return lines;
}

/**
 * 标签图的分界线（地区边界）：相邻两个网格点标签不同就在两点之间画一段，串成折线。
 * 每条分界只出一次；accept 决定哪些分界需要画（如只画陆地上、两侧都是地区的）。
 */
export function labelBoundaries(
  labels: ArrayLike<number>, cols: number, rows: number, size: { width: number; height: number },
  accept: (a: number, b: number, indexA: number, indexB: number) => boolean,
): Polyline[] {
  const dx = size.width / (cols - 1);
  const dy = size.height / (rows - 1);
  const key = (i: number, j: number) => j * (cols + 1) + i;
  const segments: Segment[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const index = row * cols + col;
      const a = labels[index]!;
      if (col + 1 < cols) {
        const right = index + 1;
        const b = labels[right]!;
        if (a !== b && accept(a, b, index, right)) segments.push({ a: key(col + 1, row), b: key(col + 1, row + 1) });
      }
      if (row + 1 < rows) {
        const below = index + cols;
        const b = labels[below]!;
        if (a !== b && accept(a, b, index, below)) segments.push({ a: key(col, row + 1), b: key(col + 1, row + 1) });
      }
    }
  }
  const byCorner = new Map<number, number[]>();
  segments.forEach((segment, index) => {
    for (const corner of [segment.a, segment.b]) {
      const list = byCorner.get(corner);
      if (list) list.push(index); else byCorner.set(corner, [index]);
    }
  });
  const used = new Uint8Array(segments.length);
  const walk = (start: number): number[] => {
    const chain: number[] = [];
    let corner = start;
    for (;;) {
      const next = (byCorner.get(corner) ?? []).find(index => !used[index]);
      if (next === undefined) break;
      used[next] = 1;
      const segment = segments[next]!;
      corner = segment.a === corner ? segment.b : segment.a;
      chain.push(corner);
      // 三条以上分界交汇的角点：在此断开，免得折线乱拐。
      if ((byCorner.get(corner)?.length ?? 0) > 2) break;
    }
    return chain;
  };
  const position = (corner: number): Point => {
    const i = corner % (cols + 1);
    const j = Math.floor(corner / (cols + 1));
    return [Math.min(size.width, Math.max(0, (i - 0.5) * dx)), Math.min(size.height, Math.max(0, (j - 0.5) * dy))];
  };
  const lines: Polyline[] = [];
  for (let index = 0; index < segments.length; index++) {
    if (used[index]) continue;
    used[index] = 1;
    const segment = segments[index]!;
    const forward = (byCorner.get(segment.b)?.length ?? 0) > 2 ? [] : walk(segment.b);
    const backward = (byCorner.get(segment.a)?.length ?? 0) > 2 ? [] : walk(segment.a);
    const corners = [...backward.reverse(), segment.a, segment.b, ...forward];
    const closed = corners.length > 3 && corners[0] === corners[corners.length - 1];
    lines.push({ points: (closed ? corners.slice(0, -1) : corners).map(position), closed });
  }
  return lines;
}

/** Chaikin 平滑（开放折线保留两端）。 */
export function smoothPolyline(line: Polyline, iterations = 2): Polyline {
  let points = line.points;
  for (let step = 0; step < iterations && points.length > 2; step++) {
    const next: Point[] = [];
    const count = points.length;
    if (!line.closed) next.push(points[0]!);
    for (let index = 0; index < (line.closed ? count : count - 1); index++) {
      const a = points[index]!;
      const b = points[(index + 1) % count]!;
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!line.closed) next.push(points[count - 1]!);
    points = next;
  }
  return { points, closed: line.closed };
}

/** 去掉过短的碎线（栅格噪点）。 */
export function lineLength(line: Polyline): number {
  let total = 0;
  for (let index = 1; index < line.points.length; index++) {
    const a = line.points[index - 1]!;
    const b = line.points[index]!;
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return total;
}

export function polylinePath(line: Polyline, precision = 1): string {
  if (!line.points.length) return '';
  const round = (value: number) => Number(value.toFixed(precision));
  const [first, ...rest] = line.points;
  return `M${round(first![0])},${round(first![1])}${rest.map(point => `L${round(point[0])},${round(point[1])}`).join('')}${line.closed ? 'Z' : ''}`;
}

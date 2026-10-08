import JSZip from 'jszip';

/** Internal-only lossless envelopes. External save exports remain canonical JSON. */
export type StorageEncoding =
  | { version: 1; type: 'zip-json'; data: Uint8Array }
  | { version: 2; type: 'zip-json-graph'; data: Uint8Array };

type GraphValue = null | boolean | number | string | [number];
type GraphNode = ['array', GraphValue[]] | ['object', Array<[string, GraphValue]>];
interface JsonGraph { root: GraphValue; nodes: GraphNode[] }

const MIN_ENCODING_LENGTH = 4096;

/** References live outside user objects, so every JSON key and array remains ordinary data. */
function createJsonGraph(value: unknown): { graph: JsonGraph; length: number } | undefined {
  const nodes: GraphNode[] = [];
  const lengths: number[] = [];
  const seen = new WeakMap<object, number>();
  const active = new WeakSet<object>();
  const lengthOf = (item: GraphValue): number => Array.isArray(item) ? lengths[item[0]]! : JSON.stringify(item).length;
  const cap = (length: number) => Math.min(MIN_ENCODING_LENGTH, length);

  const visit = (input: unknown, key: string): GraphValue | undefined => {
    let item = input;
    if (item && typeof item === 'object' && typeof (item as { toJSON?: unknown }).toJSON === 'function') {
      item = (item as { toJSON: (key: string) => unknown }).toJSON(key);
    }
    if (item instanceof Number || item instanceof String || item instanceof Boolean) item = item.valueOf();
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number') return Number.isFinite(item) ? item : null;
    if (typeof item === 'bigint') throw new TypeError('Cannot serialize BigInt');
    if (typeof item !== 'object') return undefined;
    if (active.has(item)) throw new TypeError('Cannot serialize cyclic storage data');
    const existing = seen.get(item);
    if (existing !== undefined) return [existing];

    const index = nodes.length;
    seen.set(item, index);
    active.add(item);
    nodes.push(['array', []]);
    let length = 2;
    if (Array.isArray(item)) {
      const items: GraphValue[] = [];
      for (let position = 0; position < item.length; position++) {
        const child = visit(item[position], String(position)) ?? null;
        items.push(child);
        length = cap(length + lengthOf(child) + (position ? 1 : 0));
      }
      nodes[index] = ['array', items];
    } else {
      const entries: Array<[string, GraphValue]> = [];
      for (const name of Object.keys(item)) {
        const child = visit((item as Record<string, unknown>)[name], name);
        if (child === undefined) continue;
        length = cap(length + JSON.stringify(name).length + 1 + lengthOf(child) + (entries.length ? 1 : 0));
        entries.push([name, child]);
      }
      nodes[index] = ['object', entries];
    }
    lengths[index] = length;
    active.delete(item);
    return [index];
  };

  const root = visit(value, '');
  return root === undefined ? undefined : { graph: { root, nodes }, length: lengthOf(root) };
}

function restoreJsonGraph(input: unknown): unknown {
  const corrupt = (): never => { throw new Error('存储压缩数据损坏'); };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return corrupt();
  const graph = input as JsonGraph;
  if (Object.keys(graph).length !== 2 || !Object.hasOwn(graph, 'root') || !Object.hasOwn(graph, 'nodes') || !Array.isArray(graph.nodes)) return corrupt();
  const values: unknown[] = [];
  const statuses = new Uint8Array(graph.nodes.length);

  const restore = (item: GraphValue): unknown => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) return item;
    if (!Array.isArray(item) || item.length !== 1 || !Number.isSafeInteger(item[0]) || item[0] < 0 || item[0] >= graph.nodes.length) return corrupt();
    const index = item[0];
    if (statuses[index] === 1) return corrupt();
    if (statuses[index] === 2) return values[index];
    const node = graph.nodes[index];
    if (!Array.isArray(node) || node.length !== 2 || !Array.isArray(node[1])) return corrupt();
    statuses[index] = 1;
    if (node[0] === 'array') {
      values[index] = node[1].map(child => restore(child));
    } else if (node[0] === 'object') {
      const output: Record<string, unknown> = {};
      for (const entry of node[1]) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || Object.hasOwn(output, entry[0])) return corrupt();
        Object.defineProperty(output, entry[0], { value: restore(entry[1]), writable: true, enumerable: true, configurable: true });
      }
      values[index] = output;
    } else return corrupt();
    statuses[index] = 2;
    return values[index];
  };

  const root = restore(graph.root);
  // Unreachable nodes are never emitted and could conceal invalid references or cycles.
  if (statuses.some(status => status !== 2)) return corrupt();
  return root;
}

export async function encodeStorageValue(value: unknown): Promise<StorageEncoding | undefined> {
  const serialized = createJsonGraph(value);
  if (!serialized || serialized.length < MIN_ENCODING_LENGTH) return undefined;
  // Serialize each unique immutable branch once. A plain stringify of value would
  // expand shared history back into a full copy of every checkpoint before ZIP.
  const json = JSON.stringify(serialized.graph);
  const zip = new JSZip();
  zip.file('value.json', json);
  const data = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  if (data.byteLength >= new TextEncoder().encode(json).byteLength) return undefined;
  return { version: 2, type: 'zip-json-graph', data };
}

export async function decodeStorageValue(encoded: StorageEncoding): Promise<unknown> {
  if (!encoded || !(encoded.version === 1 && encoded.type === 'zip-json' || encoded.version === 2 && encoded.type === 'zip-json-graph') || !(encoded.data instanceof Uint8Array)) {
    throw new Error('不支持的存储压缩格式');
  }
  const zip = await JSZip.loadAsync(encoded.data, { checkCRC32: true });
  const entry = zip.file('value.json');
  if (!entry || Object.keys(zip.files).length !== 1) throw new Error('存储压缩数据损坏');
  const value: unknown = JSON.parse(await entry.async('string'));
  return encoded.version === 1 ? value : restoreJsonGraph(value);
}

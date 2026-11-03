// Synchronous SHA-256 over canonical JSON, without retaining the serialized
// state. The hash owns one 64-byte block and one fixed-size message schedule.
const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

class StreamingSHA256 {
  private readonly state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private readonly block = new Uint8Array(64);
  private readonly schedule = new Uint32Array(64);
  private offset = 0;
  private bytes = 0;

  writeByte(value: number): void {
    this.block[this.offset++] = value;
    this.bytes++;
    if (this.offset === 64) {
      this.compress();
      this.offset = 0;
    }
  }

  writeASCII(value: string): void {
    for (let index = 0; index < value.length; index++) this.writeByte(value.charCodeAt(index));
  }

  writeCodePoint(value: number): void {
    if (value < 0x80) {
      this.writeByte(value);
    } else if (value < 0x800) {
      this.writeByte(0xc0 | (value >>> 6));
      this.writeByte(0x80 | (value & 0x3f));
    } else if (value < 0x10000) {
      this.writeByte(0xe0 | (value >>> 12));
      this.writeByte(0x80 | ((value >>> 6) & 0x3f));
      this.writeByte(0x80 | (value & 0x3f));
    } else {
      this.writeByte(0xf0 | (value >>> 18));
      this.writeByte(0x80 | ((value >>> 12) & 0x3f));
      this.writeByte(0x80 | ((value >>> 6) & 0x3f));
      this.writeByte(0x80 | (value & 0x3f));
    }
  }

  hexDigest(): string {
    const bitHigh = Math.floor(this.bytes / 0x20000000);
    const bitLow = (this.bytes * 8) >>> 0;
    this.writeByte(0x80);
    while (this.offset !== 56) this.writeByte(0);
    for (const word of [bitHigh, bitLow]) {
      this.writeByte(word >>> 24);
      this.writeByte(word >>> 16);
      this.writeByte(word >>> 8);
      this.writeByte(word);
    }
    return Array.from(this.state, word => word.toString(16).padStart(8, '0')).join('');
  }

  private compress(): void {
    const words = this.schedule;
    for (let index = 0; index < 16; index++) {
      const offset = index * 4;
      words[index] = (this.block[offset] << 24) | (this.block[offset + 1] << 16)
        | (this.block[offset + 2] << 8) | this.block[offset + 3];
    }
    for (let index = 16; index < 64; index++) {
      const a = words[index - 15], b = words[index - 2];
      const s0 = rotateRight(a, 7) ^ rotateRight(a, 18) ^ (a >>> 3);
      const s1 = rotateRight(b, 17) ^ rotateRight(b, 19) ^ (b >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let a = this.state[0], b = this.state[1], c = this.state[2], d = this.state[3];
    let e = this.state[4], f = this.state[5], g = this.state[6], h = this.state[7];
    for (let index = 0; index < 64; index++) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const first = (h + sum1 + choose + SHA256_CONSTANTS[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const second = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + first) >>> 0;
      d = c; c = b; b = a; a = (first + second) >>> 0;
    }
    this.state[0] = (this.state[0] + a) >>> 0;
    this.state[1] = (this.state[1] + b) >>> 0;
    this.state[2] = (this.state[2] + c) >>> 0;
    this.state[3] = (this.state[3] + d) >>> 0;
    this.state[4] = (this.state[4] + e) >>> 0;
    this.state[5] = (this.state[5] + f) >>> 0;
    this.state[6] = (this.state[6] + g) >>> 0;
    this.state[7] = (this.state[7] + h) >>> 0;
  }
}

function writeJSONString(hash: StreamingSHA256, value: string): void {
  hash.writeByte(0x22);
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c) {
      hash.writeByte(0x5c);
      hash.writeByte(code);
    } else if (code < 0x20) {
      const escape = code === 8 ? 'b' : code === 9 ? 't' : code === 10 ? 'n' : code === 12 ? 'f' : code === 13 ? 'r' : undefined;
      hash.writeASCII(escape ? `\\${escape}` : `\\u${code.toString(16).padStart(4, '0')}`);
    } else if (code >= 0xd800 && code <= 0xdfff) {
      const next = value.charCodeAt(index + 1);
      if (code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
        hash.writeCodePoint(0x10000 + ((code - 0xd800) << 10) + next - 0xdc00);
        index++;
      } else {
        hash.writeASCII(`\\u${code.toString(16).padStart(4, '0')}`);
      }
    } else {
      hash.writeCodePoint(code);
    }
  }
  hash.writeByte(0x22);
}

function prepareJSONValue(value: unknown, key: string): unknown {
  if (value !== null && (typeof value === 'object' || typeof value === 'bigint')) {
    const toJSON = (value as { toJSON?: (key: string) => unknown }).toJSON;
    if (typeof toJSON === 'function') return toJSON.call(value, key);
  }
  return value;
}

function isJSONValue(value: unknown): boolean {
  return value !== undefined && typeof value !== 'function' && typeof value !== 'symbol';
}

// JSON enumeration places integer index keys before other keys, including when
// the sorted properties were reconstructed by the old canonical replacer.
function arrayIndexKey(key: string): boolean {
  const value = Number(key);
  return Number.isInteger(value) && value >= 0 && value < 0xffffffff && String(value) === key;
}

function compareJSONKeys(left: string, right: string): number {
  const leftIndex = arrayIndexKey(left), rightIndex = arrayIndexKey(right);
  if (leftIndex || rightIndex) return leftIndex && rightIndex ? Number(left) - Number(right) : leftIndex ? -1 : 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Stable, fixed-size version of plain save data, excluding module revisions. */
export function stateFingerprint(value: unknown): string {
  const hash = new StreamingSHA256();
  const ancestors = new Set<object>();
  const write = (item: unknown): void => {
    if (item === null || !isJSONValue(item)) {
      hash.writeASCII('null');
    } else if (typeof item === 'string') {
      writeJSONString(hash, item);
    } else if (typeof item === 'number') {
      hash.writeASCII(Number.isFinite(item) ? String(item) : 'null');
    } else if (typeof item === 'boolean') {
      hash.writeASCII(item ? 'true' : 'false');
    } else if (typeof item === 'bigint') {
      throw new TypeError('Do not know how to serialize a BigInt');
    } else if (typeof item === 'object') {
      if (ancestors.has(item)) throw new TypeError('Converting circular structure to JSON');
      ancestors.add(item);
      if (Array.isArray(item)) {
        hash.writeByte(0x5b);
        const length = item.length;
        for (let index = 0; index < length; index++) {
          if (index) hash.writeByte(0x2c);
          write(prepareJSONValue(item[index], String(index)));
        }
        hash.writeByte(0x5d);
      } else {
        hash.writeByte(0x7b);
        let first = true;
        for (const key of Object.keys(item).sort(compareJSONKeys)) {
          if (key === 'moduleRevisions') continue;
          const child = prepareJSONValue((item as Record<string, unknown>)[key], key);
          if (!isJSONValue(child)) continue;
          if (!first) hash.writeByte(0x2c);
          first = false;
          writeJSONString(hash, key);
          hash.writeByte(0x3a);
          write(child);
        }
        hash.writeByte(0x7d);
      }
      ancestors.delete(item);
    }
  };
  const root = prepareJSONValue(value, '');
  // JSON.stringify returns undefined for unsupported roots; TextEncoder treats
  // that result as an empty input, matching the canonical JSON hash reference.
  if (isJSONValue(root)) write(root);
  return `sha256:${hash.hexDigest()}`;
}

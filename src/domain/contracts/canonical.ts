/**
 * Canonical serialization and stable digests.
 *
 * `canonicalJson` produces one deterministic string for a validated value by
 * sorting object keys, so payload equality can be decided by string equality.
 * `stableDigest` is a small non-cryptographic FNV-style digest used only to
 * bind confirmations to previews and to label operations; it is never a
 * security primitive.
 */

const ASCII_ZERO = '0'.charCodeAt(0);

function appendHex32(output: string[], value: number): void {
  const remaining = value >>> 0;
  for (let shift = 28; shift >= 0; shift -= 4) {
    const nibble = (remaining >>> shift) & 0xf;
    output.push(String.fromCharCode(ASCII_ZERO + (nibble <= 9 ? nibble : nibble + 39)));
  }
}

export function stableDigest(text: string): string {
  // Two simultaneous 32-bit FNV-1a rounds with distinct offset bases, over
  // UTF-16 code units. Deterministic integer math with no platform variance.
  const FNV_PRIME = 16777619;
  let laneA = 0x811c9dc5 | 0;
  let laneB = 0x9dc5811c | 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    laneA = Math.imul(laneA ^ code, FNV_PRIME);
    laneB = Math.imul(laneB ^ (code + index), FNV_PRIME);
  }
  const output: string[] = [];
  appendHex32(output, laneA);
  appendHex32(output, laneB);
  return output.join('');
}

/**
 * Deterministic JSON: object keys in sorted order, arrays in order, no
 * whitespace. Values must be JSON-safe with integer numbers only; anything
 * else throws instead of being silently coerced.
 */
export function canonicalJson(value: unknown): string {
  const pieces: string[] = [];
  writeCanonical(value, pieces, '$');
  return pieces.join('');
}

function writeCanonical(value: unknown, pieces: string[], path: string): void {
  if (value === null) {
    pieces.push('null');
    return;
  }
  switch (typeof value) {
    case 'string':
      pieces.push(JSON.stringify(value));
      return;
    case 'boolean':
      pieces.push(value ? 'true' : 'false');
      return;
    case 'number':
      if (!Number.isSafeInteger(value)) {
        throw new TypeError(`canonicalJson requires safe-integer numbers at ${path}`);
      }
      pieces.push(String(value));
      return;
    case 'object':
      break;
    default:
      throw new TypeError(`canonicalJson received unsupported ${typeof value} at ${path}`);
  }

  if (Array.isArray(value)) {
    pieces.push('[');
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) pieces.push(',');
      writeCanonical(value[index], pieces, `${path}[${index}]`);
    }
    pieces.push(']');
    return;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.some((key) => record[key] === undefined)) {
    throw new TypeError(`canonicalJson received an undefined field at ${path}`);
  }
  pieces.push('{');
  for (let index = 0; index < keys.length; index += 1) {
    if (index > 0) pieces.push(',');
    pieces.push(`${JSON.stringify(keys[index])}:`);
    writeCanonical(record[keys[index]], pieces, `${path}.${keys[index]}`);
  }
  pieces.push('}');
}

/**
 * Browser test runtime used only when esbuild aliases `vitest` for the
 * persistent conformance bundle. Assertions match the vitest matchers the
 * suite already calls; the in-memory runner still imports real vitest.
 */

type TestFn = () => void | Promise<void>;

interface CollectedTest {
  readonly name: string;
  readonly fn: TestFn;
}

const tests: CollectedTest[] = [];
let suitePrefix = '';

export function describe(name: string, fn: () => void): void {
  const previous = suitePrefix;
  suitePrefix = previous ? `${previous} > ${name}` : name;
  fn();
  suitePrefix = previous;
}

export function it(name: string, fn: TestFn): void {
  tests.push({ name: suitePrefix ? `${suitePrefix} > ${name}` : name, fn });
}

export async function runCollectedTests(): Promise<Array<{ name: string; ok: boolean; error?: string }>> {
  const results: Array<{ name: string; ok: boolean; error?: string }> = [];
  for (const test of tests) {
    try {
      await test.fn();
      results.push({ name: test.name, ok: true });
    } catch (error) {
      const stack = error instanceof Error ? error.stack ?? error.message : String(error);
      results.push({ name: test.name, ok: false, error: stack });
    }
  }
  return results;
}

class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}

interface ArrayContaining {
  readonly __arrayContaining: readonly unknown[];
}

function isArrayContaining(value: unknown): value is ArrayContaining {
  return typeof value === 'object' && value !== null && '__arrayContaining' in value;
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (isArrayContaining(right)) {
    if (!Array.isArray(left)) return false;
    return right.__arrayContaining.every((item) => left.some((candidate) => deepEqual(candidate, item)));
  }
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    return left.every((item, index) => deepEqual(item, right[index]));
  }
  const leftKeys = Object.keys(left as Record<string, unknown>);
  const rightKeys = Object.keys(right as Record<string, unknown>);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => deepEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function fail(message: string | undefined, detail: string): never {
  throw new AssertionError(message ? `${message}: ${detail}` : detail);
}

function matchThrow(error: unknown, expected: unknown, message?: string): void {
  if (typeof expected === 'function') {
    if (!(error instanceof (expected as new (...args: unknown[]) => Error))) {
      fail(message, `expected error to be instance of ${(expected as { name: string }).name}, got ${String(error)}`);
    }
    return;
  }
  if (typeof expected === 'string') {
    const text = error instanceof Error ? error.message : String(error);
    if (!text.includes(expected)) fail(message, `expected error message to include ${expected}, got ${text}`);
    return;
  }
  if (expected !== undefined) fail(message, `unsupported toThrow argument: ${stringify(expected)}`);
}

class Expectation {
  constructor(
    private readonly actual: unknown,
    private readonly negated: boolean,
    private readonly message?: string,
  ) {}

  get not(): Expectation {
    return new Expectation(this.actual, !this.negated, this.message);
  }

  get rejects(): { toThrow: (expected?: unknown) => Promise<void> } {
    return {
      toThrow: async (expected?: unknown) => {
        try {
          await this.actual;
        } catch (error) {
          if (this.negated) fail(this.message, `expected promise not to reject, but it rejected with ${String(error)}`);
          matchThrow(error, expected, this.message);
          return;
        }
        if (!this.negated) fail(this.message, 'expected promise to reject');
      },
    };
  }

  toBe(expected: unknown): void {
    const equal = Object.is(this.actual, expected);
    if (equal === this.negated) {
      fail(this.message, `expected ${stringify(this.actual)} ${this.negated ? 'not ' : ''}to be ${stringify(expected)}`);
    }
  }

  toEqual(expected: unknown): void {
    const equal = deepEqual(this.actual, expected);
    if (equal === this.negated) {
      fail(this.message, `expected ${stringify(this.actual)} ${this.negated ? 'not ' : ''}to equal ${stringify(expected)}`);
    }
  }

  toBeNull(): void {
    this.toBe(null);
  }

  toBeDefined(): void {
    const defined = this.actual !== undefined;
    if (defined === this.negated) {
      fail(this.message, `expected value ${this.negated ? 'not ' : ''}to be defined`);
    }
  }

  toBeTruthy(): void {
    const truthy = Boolean(this.actual);
    if (truthy === this.negated) {
      fail(this.message, `expected ${stringify(this.actual)} ${this.negated ? 'not ' : ''}to be truthy`);
    }
  }

  toBeGreaterThan(expected: number): void {
    const pass = typeof this.actual === 'number' && this.actual > expected;
    if (pass === this.negated) {
      fail(this.message, `expected ${stringify(this.actual)} ${this.negated ? 'not ' : ''}to be greater than ${expected}`);
    }
  }

  toHaveLength(expected: number): void {
    const length = (this.actual as { length?: unknown })?.length;
    const pass = length === expected;
    if (pass === this.negated) {
      fail(this.message, `expected length ${stringify(length)} ${this.negated ? 'not ' : ''}to be ${expected}`);
    }
  }

  toThrow(expected?: unknown): void {
    if (typeof this.actual !== 'function') fail(this.message, 'expected a function for toThrow');
    try {
      (this.actual as () => void)();
    } catch (error) {
      if (this.negated) fail(this.message, `expected function not to throw, but it threw ${String(error)}`);
      matchThrow(error, expected, this.message);
      return;
    }
    if (!this.negated) fail(this.message, 'expected function to throw');
  }
}

export function expect(actual: unknown, message?: string): Expectation {
  return new Expectation(actual, false, message);
}

expect.arrayContaining = (items: readonly unknown[]): ArrayContaining => ({ __arrayContaining: items });

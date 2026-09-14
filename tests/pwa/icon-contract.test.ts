import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';

const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as {
  icons?: Array<{ src: string; sizes: string; type: string; purpose: string }>;
};
const worker = readFileSync('public/rushd-pwa-sw.js', 'utf8');

const expectedIcons = [
  { src: '/icons/rushd-192.png', size: 192, purpose: 'any' },
  { src: '/icons/rushd-512.png', size: 512, purpose: 'any' },
  { src: '/icons/rushd-512-maskable.png', size: 512, purpose: 'maskable' },
] as const;

describe('P04-D5 PWA icon contract', () => {
  it('declares valid regular and maskable install icons', () => {
    expect(manifest.icons).toBeDefined();
    for (const expected of expectedIcons) {
      const icon = manifest.icons?.find((candidate) => candidate.src === expected.src);
      expect(icon).toMatchObject({
        sizes: `${expected.size}x${expected.size}`,
        type: 'image/png',
        purpose: expected.purpose,
      });
    }
  });

  it('keeps every declared icon a square PNG with a full-bleed background', () => {
    for (const expected of expectedIcons) {
      const png = PNG.sync.read(readFileSync(`public${expected.src}`));
      expect(png.width).toBe(expected.size);
      expect(png.height).toBe(expected.size);
      expect(png.colorType).toBe(2);
      for (const [x, y] of [[0, 0], [png.width - 1, 0], [0, png.height - 1], [png.width - 1, png.height - 1]]) {
        const offset = (png.width * y + x) * 4;
        expect([...png.data.subarray(offset, offset + 3)]).toEqual([9, 9, 11]);
      }
    }
  });

  it('precaches all install icons in the candidate service worker', () => {
    for (const expected of expectedIcons) expect(worker).toContain(`'${expected.src}'`);
    expect(worker).toMatch(/cache\.addAll\(REQUIRED_URLS\)/);
  });
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyFontLicenseProvenance } from '../scripts/font-license-guard.mjs';

const realProvenance = JSON.parse(readFileSync('public/fonts/PROVENANCE.json', 'utf8'));
assert.doesNotThrow(() => verifyFontLicenseProvenance(realProvenance));

const temporaryRoot = mkdtempSync(join(tmpdir(), 'rushd-font-license-'));
const publicFontsRoot = join(temporaryRoot, 'public', 'fonts');
const insidePath = join(publicFontsRoot, 'license.txt');
const outsidePath = join(temporaryRoot, 'license-outside.txt');
const contents = 'disposable license fixture\n';
const sha256 = createHash('sha256').update(contents).digest('hex');
const probeProvenance = {
  families: [{ family: 'Probe Font', license: { path: 'license.txt', sha256 } }],
  icon_font: { family: 'Probe Icons', license: { path: 'license.txt', sha256 } }
};

try {
  mkdirSync(publicFontsRoot, { recursive: true });
  writeFileSync(insidePath, contents);
  assert.doesNotThrow(() => verifyFontLicenseProvenance(probeProvenance, publicFontsRoot));

  writeFileSync(outsidePath, contents);
  unlinkSync(insidePath);
  symlinkSync(outsidePath, insidePath);
  assert.throws(
    () => verifyFontLicenseProvenance(probeProvenance, publicFontsRoot),
    (error) => {
      assert.match(error.message, /Probe Font/);
      assert.match(error.message, /license\.txt/);
      assert.match(error.message, new RegExp(sha256));
      assert.match(error.message, /outside public\/fonts|symlink is not allowed/);
      return true;
    }
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log('Rushd font license symlink regression passed.');

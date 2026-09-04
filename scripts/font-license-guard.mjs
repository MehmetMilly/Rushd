import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

function escapesRoot(root, target) {
  const relativePath = relative(root, target);
  return !relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
}

function declaredLicenses(provenance) {
  return [
    ...(provenance?.families || []).map((family) => ({ owner: family.family, ...family.license })),
    ...(provenance?.icon_font?.license
      ? [{ owner: provenance.icon_font.family, ...provenance.icon_font.license }]
      : [])
  ];
}

export function verifyFontLicenseProvenance(provenance, publicFontsPath = 'public/fonts') {
  const licenses = declaredLicenses(provenance);
  if (!licenses.length) throw new Error('Font provenance declares no licenses.');

  const licenseRoot = resolve(publicFontsPath);
  const realLicenseRoot = realpathSync(licenseRoot);
  for (const license of licenses) {
    if (!license.owner || !license.path || !license.sha256) {
      throw new Error(`Font provenance is missing a local license owner, path, or SHA-256 for ${license.owner || 'unknown'}.`);
    }

    const licensePath = resolve(licenseRoot, license.path);
    if (escapesRoot(licenseRoot, licensePath)) {
      throw new Error(`Font provenance license path escapes public/fonts for ${license.owner} (${license.path}): expected SHA-256 ${license.sha256}.`);
    }
    if (!existsSync(licensePath)) {
      throw new Error(`Font provenance license file is missing for ${license.owner}: ${license.path}.`);
    }

    const realLicensePath = realpathSync(licensePath);
    if (escapesRoot(realLicenseRoot, realLicensePath)) {
      throw new Error(`Font provenance license path resolves outside public/fonts for ${license.owner} (${license.path}): expected SHA-256 ${license.sha256}; resolved path ${realLicensePath}.`);
    }

    const licenseStats = lstatSync(licensePath);
    if (licenseStats.isSymbolicLink()) {
      throw new Error(`Font provenance license symlink is not allowed for ${license.owner} (${license.path}): expected SHA-256 ${license.sha256}; resolved path ${realLicensePath}.`);
    }
    if (!licenseStats.isFile()) {
      throw new Error(`Font provenance license is not a regular file for ${license.owner} (${license.path}): expected SHA-256 ${license.sha256}; resolved path ${realLicensePath}.`);
    }

    const actualLicenseHash = createHash('sha256').update(readFileSync(licensePath)).digest('hex');
    if (actualLicenseHash !== license.sha256) {
      throw new Error(`Font license SHA-256 mismatch for ${license.owner} (${license.path}): expected ${license.sha256}, got ${actualLicenseHash}.`);
    }
  }
}

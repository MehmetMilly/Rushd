import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';

const baseSha = 'b56c80bc2e2eb103ebe5bc258bfeeea60accf53c';
const requiredCases = ['empty', 'populated', 'paid-generated', 'plan-edit', 'legacy-vault', 'malformed', 'boundary', 'large-history'];
const expectedIssueIds = [
  'P0-01', 'P0-02', 'P0-03', 'P0-04', 'P0-05', 'P0-06', 'P0-07', 'P0-08',
  'P1-01', 'P1-02', 'P1-03', 'P1-04', 'P1-05', 'P1-06', 'P1-07', 'P1-08',
  'P1-09', 'P1-10', 'P1-11', 'P1-12'
];
const expectedPngNames = [
  'empty-dashboard.png', 'empty-statistics.png', 'empty-vault.png', 'empty-plans.png', 'empty-settings.png',
  'populated-dashboard.png', 'populated-statistics.png', 'populated-vault.png', 'populated-plans.png', 'populated-settings.png',
  'onboarding.png', 'add-modal.png', 'keyboard-focus-dashboard.png', 'edit-modal.png', 'profile-modal.png',
  'apply-plan-modal.png', 'confirm-reset-modal.png', 'error-toast.png', 'loading-onboarding.png'
];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const globRegex = (pattern) => {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*');
  return new RegExp(`^${escaped}$`);
};

const plan = await readJson('docs/implementation/phase-plan.json');
const phase = plan.phases.find((item) => item.id === 'P00');
const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (headSha !== baseSha) {
  const sealedAuthorityChain = [
    { commit: '1094b32a7056dc3cdb21c52ade57a0cea75f00a9', parent: baseSha },
    { commit: '8e5c4c31aea551920ff0b66785bc2b2c5e36c97d', parent: '1094b32a7056dc3cdb21c52ade57a0cea75f00a9' },
    { commit: '30191893cd585f25271aa4c0b5211813b0ad5003', parent: '4e898046659864e3b6bb51b1841ad3480224f889' },
    { commit: 'f0ae4240742f0213d5d68e8d7b878685fd64560c', parent: '30191893cd585f25271aa4c0b5211813b0ad5003' },
    { commit: '91472d4bd622f29eaf4610eacf2055f2f6a93434', parent: 'f0ae4240742f0213d5d68e8d7b878685fd64560c' },
    { commit: '3f83568f19cbb773bc3277ea698be35268dc6383', parent: '91472d4bd622f29eaf4610eacf2055f2f6a93434' }
  ];
  assert(headSha === sealedAuthorityChain.at(-1).commit, 'HEAD is not the approved external-continuation authority overlay');
  for (const overlay of sealedAuthorityChain) {
    const parent = execFileSync('git', ['rev-parse', `${overlay.commit}^`], { encoding: 'utf8' }).trim();
    const overlayPaths = execFileSync('git', ['diff', '--name-only', '--no-renames', overlay.parent, overlay.commit], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    assert(parent === overlay.parent && overlayPaths.length > 0 && overlayPaths.every((path) => plan.protected_paths.some((pattern) => globRegex(pattern).test(path))), `Invalid sealed authority overlay: ${overlay.commit}`);
  }
}
const changed = execFileSync('git', ['diff', '--name-only', '--no-renames', 'HEAD', '--', '.'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
for (const path of [...new Set([...changed, ...untracked])]) {
  assert(!plan.protected_paths.some((pattern) => globRegex(pattern).test(path)), `Protected path changed: ${path}`);
  assert(phase.allowed_paths.some((pattern) => globRegex(pattern).test(path)), `P00 path is outside the allowlist: ${path}`);
}

const authority = await readJson('docs/baseline/authority-baseline.json');
assert(authority.schema === 'rushd.p00-authority-baseline.v1', 'Authority evidence schema mismatch');
assert(authority.source_baseline_sha === 'ed45d83d235e230f9d530de6c421f68c3dd5020b', 'Source baseline SHA mismatch');
assert(authority.authority_commit_sha === '2af7468685a7ce3fd5db24ecaeda6d5534be42d3', 'Authority commit SHA mismatch');
assert(authority.phase_base_sha === baseSha && authority.relationships.base_matches_head, 'Authority evidence does not match P00 base');
assert(authority.relationships.authority_parent_matches_source_baseline && authority.relationships.authority_is_ancestor_of_base, 'Authority ancestry is invalid');
assert(authority.authority_files.length >= 8 && authority.authority_files.every((item) => /^[a-f0-9]{64}$/.test(item.sha256)), 'Authority file hashes are incomplete');
assert(authority.protected_inventory.length > 0 && authority.protected_inventory.every((item) => item.matches_base), 'Protected-path inventory drifted from base');
assert(authority.supersession_log.length >= 5, 'Supersession log is incomplete');

const storage = await readJson('docs/baseline/storage-inventory.json');
assert(JSON.stringify(storage.required_cases) === JSON.stringify(requiredCases), 'Storage case inventory mismatch');
for (const caseId of requiredCases) {
  const fixture = await readJson(`tests/fixtures/v1/${caseId}.json`);
  const backup = await readJson(`tests/fixtures/v1/backups/${caseId}.backup.json`);
  assert(fixture.sanitization?.marker === 'SYNTHETIC_P00_ONLY', `${caseId} fixture is not marked synthetic`);
  assert(backup.version === '3.1' || backup.case_id === caseId, `${caseId} raw backup has no stable version/case marker`);
}
for (const count of [0, 100, 1000]) assert(storage.performance_record_counts.includes(count), `Missing ${count}-record storage baseline`);
assert(storage.fixtures.length === 17 && storage.fixtures.every((item) => item.sanitized && /^[a-f0-9]{64}$/.test(item.sha256)), 'Fixture hash inventory is incomplete');

const reproduction = await readJson('tests/characterization/p0-p1-cases.json');
assert(JSON.stringify(reproduction.cases.map((item) => item.id)) === JSON.stringify(expectedIssueIds), 'P0/P1 inventory does not match the canonical 20 IDs');
for (const item of reproduction.cases) {
  assert(['automated', 'manual'].includes(item.reproduction_type), `${item.id} has no reproduction type`);
  assert(item.final_evidence_path === `docs/baseline/p0-p1/${item.id}.json`, `${item.id} has no stable final evidence path`);
  const finalEvidenceStat = await lstat(item.final_evidence_path);
  assert(finalEvidenceStat.isFile() && !finalEvidenceStat.isSymbolicLink(), `${item.id} final evidence is missing or unsafe`);
  const finalEvidence = await readJson(item.final_evidence_path);
  assert(finalEvidence.issue_id === item.id && finalEvidence.final_evidence_path === item.final_evidence_path && finalEvidence.result === 'reproduced', `${item.id} final evidence does not match its catalog record`);
  if (item.reproduction_type === 'manual') {
    assert(item.manual_justification?.length >= 20 && item.steps?.length > 0 && item.preconditions?.length > 0, `${item.id} manual reproduction is not justified`);
  } else {
    assert(item.steps?.some((step) => step.includes('npm test')) && item.expected_current_result?.length > 0 && item.captured_current_result?.length > 0, `${item.id} automated reproduction is not executable and evidence-backed`);
  }
}
const reproductionResults = await readJson('docs/baseline/p0-p1-reproduction-results.json');
assert(reproductionResults.inventory_count === 20 && reproductionResults.automated_count + reproductionResults.manual_count === 20, 'P0/P1 reproduction totals are invalid');

const visual = await readJson('docs/baseline/visual-manifest.json');
assert(visual.schema === 'rushd.p00-visual-manifest.v1' && visual.source_sha === baseSha, 'Visual manifest identity mismatch');
assert(visual.native_viewport_capture === true, 'Visual evidence was post-processed, dimension-forced, or padded');
assert(visual.matrix.length === 12 && visual.matrix.every((item) => item.result === 'pass' && item.png_count === 19 && item.motion.length === 2 && /^[a-f0-9]{64}$/.test(item.accessibility_sha256)), 'Visual matrix is incomplete');
assert(visual.artifact_count === 260 && visual.artifacts.length === 260, 'Visual artifact count mismatch');
const capture = await readJson(visual.capture_manifest_path);
assert(sha256(await readFile(visual.capture_manifest_path)) === visual.capture_manifest_sha256, 'Pinned capture manifest hash mismatch');
assert(capture.playwright_version === '1.62.1' && capture.chromium_version === '151.0.7922.34', 'Visual matrix was not captured by the pinned Playwright Chromium build');
assert(capture.runtime_connection?.mode === 'external-cdp' && new URL(capture.runtime_connection.endpoint).hostname === '127.0.0.1', 'Visual matrix lacks the authorized localhost-only external Chromium connection proof');
assert(capture.device_scale_factor === 1 && capture.post_capture_processing === false && capture.dimension_forcing === false && capture.padded_borders_added === false, 'Capture manifest permits viewport forcing or padding');
assert(capture.matrix.length === 12 && capture.matrix.every((item) => item.state_count === 19), 'Pinned capture state matrix is incomplete');
const artifactByPath = new Map(visual.artifacts.map((item) => [item.path, item]));
for (const language of ['ar', 'en']) for (const theme of ['dark', 'light']) for (const viewport of ['390x844', '1024x1366', '1440x900']) {
  const [width, height] = viewport.split('x').map(Number);
  const directory = `docs/baseline/current/${language}/${theme}/${viewport}`;
  for (const name of expectedPngNames) {
    const path = `${directory}/${name}`;
    const artifact = artifactByPath.get(path);
    assert(artifact?.width === width && artifact?.height === height, `Missing or mis-sized PNG: ${path}`);
  }
  for (const extension of ['webm', 'mp4']) {
    const path = `${directory}/motion-add-full.${extension}`;
    assert(artifactByPath.has(path), `Missing matrix motion: ${directory}`);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', path], { encoding: 'utf8' })).streams[0];
    assert(probe.width === width && probe.height === height, `Motion artifact was not recorded at native viewport: ${path}`);
  }
}
for (const profile of ['auto', 'full', 'balanced', 'lite']) for (const extension of ['webm', 'mp4']) {
  const path = `docs/baseline/current/motion-profiles/${profile}/motion-add-${profile}.${extension}`;
  assert(artifactByPath.has(path), `Missing ${profile} motion profile`);
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', path], { encoding: 'utf8' })).streams[0];
  assert(probe.width === 390 && probe.height === 844, `Motion profile was not recorded at native viewport: ${path}`);
}
for (const artifact of visual.artifacts) {
  const stat = await lstat(artifact.path);
  assert(stat.isFile() && !stat.isSymbolicLink(), `Visual artifact is not a regular file: ${artifact.path}`);
  const bytes = await readFile(artifact.path);
  assert(bytes.length === artifact.byte_length && sha256(bytes) === artifact.sha256, `Visual artifact hash mismatch: ${artifact.path}`);
  if (artifact.media_type === 'png') assert(bytes.subarray(1, 4).toString('ascii') === 'PNG', `Not a true PNG: ${artifact.path}`);
  if (artifact.media_type === 'webm') assert(bytes.subarray(0, 4).toString('hex') === '1a45dfa3', `Not a WebM container: ${artifact.path}`);
  if (artifact.media_type === 'mp4') assert(bytes.subarray(4, 8).toString('ascii') === 'ftyp', `Not an MP4 container: ${artifact.path}`);
}

const accessibilityPerformance = await readJson('docs/baseline/accessibility-performance.json');
assert(accessibilityPerformance.browser_versions.capture_runner.name === 'Playwright Chromium' && accessibilityPerformance.browser_versions.capture_runner.version === '151.0.7922.34' && accessibilityPerformance.browser_versions.pinned_playwright.package_version === '1.62.1', 'Pinned browser versions are incomplete');
assert(accessibilityPerformance.performance_runner.name === 'Playwright Chromium' && accessibilityPerformance.browser_performance.samples.length === 12, 'Pinned browser performance evidence is incomplete');
assert(accessibilityPerformance.accessibility_observations.activated_state_count === 228 && accessibilityPerformance.state_level_evidence.length === 12, 'State-level accessibility coverage is incomplete');
for (const evidence of accessibilityPerformance.state_level_evidence) {
  const stat = await lstat(evidence.path);
  const bytes = await readFile(evidence.path);
  const document = JSON.parse(bytes);
  assert(stat.isFile() && !stat.isSymbolicLink() && sha256(bytes) === evidence.sha256 && document.state_count === 19, `State-level accessibility evidence is missing or changed: ${evidence.path}`);
  for (const state of document.states) assert(artifactByPath.get(state.screenshot_path)?.sha256 === state.screenshot_sha256, `Accessibility state does not bind its screenshot: ${state.state_id}`);
}
assert(JSON.stringify(accessibilityPerformance.fixture_performance.results?.map((item) => item.record_count)) === JSON.stringify([0, 100, 1000]), '0/100/1000 performance cases are incomplete');

const attestation = await readJson('docs/baseline/P00-manual-qa.json');
assert(attestation.schema === 'rushd.human-attestation.v1' && attestation.gate_id === 'P00-M1' && attestation.result === 'pass', 'P00-M1 attestation is incomplete');
assert(attestation.requirement === phase.manual_qa[0] && attestation.actor === 'phase_implementer', 'P00-M1 attestation does not match the phase plan/template');
assert(attestation.evidence_root === `.codex/runs/${attestation.run_id}/evidence/human/P00-M1`, 'P00-M1 evidence root is not canonical');
assert(attestation.environment.browser === 'Playwright Chromium' && attestation.environment.browser_version === '151.0.7922.34', 'P00-M1 does not attest the pinned capture browser');
assert(attestation.timezone === 'Asia/Riyadh' && attestation.utc_offset === '+03:00' && /\+03:00$/.test(attestation.performed_local_at), 'P00-M1 local-time context is incomplete');

const packageJson = await readJson('package.json');
const lock = await readJson('package-lock.json');
assert(packageJson.devDependencies.playwright === '1.62.1' && packageJson.devDependencies['@axe-core/playwright'] === '4.12.1', 'Browser dependencies are not exactly pinned');
assert(lock.packages[''].devDependencies.playwright === '1.62.1' && lock.packages[''].devDependencies['@axe-core/playwright'] === '4.12.1', 'Lockfile pins do not match package.json');
const ignore = await readFile('.gitignore', 'utf8');
for (const entry of ['/node_modules/', '/dist/', '/coverage/', '/.codex/runs/', '/playwright-report/', '/test-results/', '/artifacts/']) assert(ignore.includes(entry), `Missing isolated artifact root: ${entry}`);
assert(!packageJson.scripts.test.includes('baseline:capture') && !packageJson.scripts.test.includes('baseline:package'), 'Normal tests must not rewrite baseline artifacts');
assert(packageJson.scripts.test.includes('p00-artifact-guards.test.mjs'), 'Normal tests do not execute the adversarial replacement guard');
for (const path of ['scripts/generate-p00-fixtures.mjs', 'scripts/capture-p00-baseline.cjs', 'scripts/normalize-p00-images.sh', 'scripts/encode-p00-motion.sh', 'scripts/package-p00-evidence.mjs']) {
  const source = await readFile(path, 'utf8');
  assert(source.includes('RUSHD_BASELINE_WRITE'), `${path} has no immutable-evidence write guard`);
}
const normalizerSource = await readFile('scripts/normalize-p00-images.sh', 'utf8');
assert(normalizerSource.includes('RUSHD_BASELINE_REPLACE') && normalizerSource.indexOf('RUSHD_BASELINE_REPLACE') < normalizerSource.indexOf('normalize_tree()'), 'Normalizer can reach an existing artifact without explicit replacement authorization');
assert((await readFile('scripts/browser-smoke.cjs', 'utf8')).includes('test-results/browser-smoke'), 'Browser smoke output is not isolated from source assets');

console.log('P00 immutable baseline verification passed: authority overlay separation, 17 sanitized fixtures, 20 stable reproductions, 260 native Chromium media artifacts, 228 state-level axe records, local attestation, pins, and replacement guards.');

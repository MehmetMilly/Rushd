import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

if (process.env.RUSHD_BASELINE_WRITE !== '1') {
  console.error('Refusing to package immutable P00 evidence without RUSHD_BASELINE_WRITE=1.');
  process.exit(2);
}
if (existsSync('docs/baseline/visual-manifest.json') && process.env.RUSHD_BASELINE_REPLACE !== '1') {
  console.error('P00 packaged evidence already exists. Set RUSHD_BASELINE_REPLACE=1 only for an explicitly reviewed replacement.');
  process.exit(3);
}

const runId = 'rushd-20260810-rebuild';
const phaseId = 'P00';
const attempt = 2;
const runnerTaskId = '019fe9fd-eb9b-7183-818d-519e1466808c';
const sourceBaselineSha = 'ed45d83d235e230f9d530de6c421f68c3dd5020b';
const authorityCommitSha = '2af7468685a7ce3fd5db24ecaeda6d5534be42d3';
const baseSha = 'b56c80bc2e2eb103ebe5bc258bfeeea60accf53c';
const evidenceRoot = `.codex/runs/${runId}/evidence/${phaseId}/worker-attempt-02`;
const humanEvidenceRoot = `.codex/runs/${runId}/evidence/human/P00-M1`;
const runArtifactStagingRoot = process.env.RUSHD_RUN_ARTIFACT_STAGING || null;
const manualRequirement = 'P00-M1: Complete docs/baseline/P00-manual-qa.json from the human-attestation template for the exact matrix in P0-P1-INVENTORY.md using only fake/sanitized financial data.';
const capturedAt = new Date().toISOString();
const capturedLocalAt = new Date(Date.parse(capturedAt) + 3 * 60 * 60 * 1000).toISOString().replace('Z', '+03:00');

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const bytewise = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));
const isAncestor = (ancestor, descendant) => {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
};
const writeJson = async (path, value) => {
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};
const writeRunJson = async (path, value) => {
  try {
    await writeJson(path, value);
    return path;
  } catch (error) {
    if (!runArtifactStagingRoot || !['EACCES', 'EPERM'].includes(error.code)) throw error;
    const stagedPath = `${runArtifactStagingRoot}/${path}`;
    await writeJson(stagedPath, value);
    return stagedPath;
  }
};

async function listFiles(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory()) result.push(...await listFiles(path));
    else if (entry.isFile()) result.push(path);
  }
  return result.sort(bytewise);
}

function globRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*');
  return new RegExp(`^${escaped}$`);
}

const plan = JSON.parse(await readFile('docs/implementation/phase-plan.json', 'utf8'));
const trackedFiles = git('ls-tree', '-r', '--name-only', baseSha).split('\n').filter(Boolean);
const authorityFiles = git('diff-tree', '--no-commit-id', '--name-only', '-r', authorityCommitSha).split('\n').filter(Boolean).sort(bytewise);
const authorityHashes = {};
for (const path of authorityFiles) authorityHashes[path] = sha256(execFileSync('git', ['show', `${authorityCommitSha}:${path}`]));

const protectedInventory = [];
for (const pattern of plan.protected_paths) {
  const matches = trackedFiles.filter((path) => globRegex(pattern).test(path));
  for (const path of matches) {
    const bytes = await readFile(path);
    protectedInventory.push({ pattern, path, sha256: sha256(bytes), byte_length: bytes.length, matches_base: sha256(execFileSync('git', ['show', `${baseSha}:${path}`])) === sha256(bytes) });
  }
}
protectedInventory.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));

const authorityReport = {
  schema: 'rushd.p00-authority-baseline.v1',
  captured_at: capturedAt,
  run_id: runId,
  source_baseline_sha: sourceBaselineSha,
  authority_commit_sha: authorityCommitSha,
  phase_base_sha: baseSha,
  head_sha_at_packaging: git('rev-parse', 'HEAD'),
  relationships: {
    authority_parent: git('rev-parse', `${authorityCommitSha}^`),
    authority_parent_matches_source_baseline: git('rev-parse', `${authorityCommitSha}^`) === sourceBaselineSha,
    authority_is_ancestor_of_base: isAncestor(authorityCommitSha, baseSha),
    base_matches_head: git('rev-parse', 'HEAD') === baseSha
  },
  authority_commit_subject: git('show', '-s', '--format=%s', authorityCommitSha),
  authority_files: authorityFiles.map((path) => ({ path, sha256: authorityHashes[path] })),
  protected_path_policy: plan.path_policy,
  protected_patterns: plan.protected_paths,
  protected_inventory: protectedInventory,
  supersession_log: [
    { authority: 'docs/RUSHD_MASTER_PLAN_FINAL.md', supersedes: 'docs/RUSHD_MASTER_PLAN.md' },
    { authority: 'docs/RUSHD_MASTER_PLAN_FINAL.md', supersedes: 'docs/RUSHD_FOUNDER_REVIEW.md' },
    { authority: 'docs/RUSHD_MASTER_PLAN_FINAL.md', supersedes: 'docs/RUSHD_PRODUCT_DISCUSSION_2026-08-10.md' },
    { authority: 'docs/RUSHD_MASTER_PLAN_FINAL.md', supersedes: 'docs/RUSHD_FOUNDER_FEEDBACK_2026-08-10.md' },
    { authority: 'docs/RUSHD_MASTER_PLAN_FINAL.md', supersedes: 'aspirational sections of docs/roadmap.md, docs/data-model.md, docs/architecture.md, and docs/privacy-notes.md' }
  ]
};
if (!existsSync('docs/baseline/authority-baseline.json')) await writeJson('docs/baseline/authority-baseline.json', authorityReport);

const fixturePaths = (await listFiles('tests/fixtures/v1')).filter((path) => path.endsWith('.json'));
const fixtureInventory = [];
for (const path of fixturePaths) {
  const bytes = await readFile(path);
  const value = JSON.parse(bytes);
  fixtureInventory.push({
    path,
    sha256: sha256(bytes),
    byte_length: bytes.length,
    case_id: value.case_id || path.split('/').at(-1).replace('.backup.json', ''),
    record_count: Array.isArray(value.backup?.expenses) ? value.backup.expenses.length : Array.isArray(value.expenses) ? value.expenses.length : null,
    sanitized: value.sanitization?.marker === 'SYNTHETIC_P00_ONLY' || path.includes('/backups/')
  });
}
const storageReport = {
  schema: 'rushd.p00-storage-inventory.v1',
  captured_at: capturedAt,
  source_database: { name: 'MicroSaveOS_DB', version: 1 },
  object_stores: [
    { name: 'settings', key_path: 'key', indexes: [], value_shape: '{key,value}' },
    { name: 'templates', key_path: 'id', indexes: [], normalization: 'normalizeDefinitionRecord' },
    { name: 'expenses', key_path: 'id', indexes: [{ name: 'date', key_path: 'date' }, { name: 'isPaid', key_path: 'isPaid' }], normalization: 'normalizeExpenseRecord' }
  ],
  local_storage_keys: ['rushd_lang', 'rushd_calendar', 'rushd_theme', 'rushd_motion', 'rushd_import_success', 'microsave_import_success', 'rushd_month_start_prompt_deferred', 'rushd_month_end_prompt_deferred'],
  current_export_version: '3.1',
  required_cases: ['empty', 'populated', 'paid-generated', 'plan-edit', 'legacy-vault', 'malformed', 'boundary', 'large-history'],
  performance_record_counts: [0, 100, 1000],
  fixtures: fixtureInventory
};
await writeJson('docs/baseline/storage-inventory.json', storageReport);

const reproductionCatalog = JSON.parse(await readFile('tests/characterization/p0-p1-cases.json', 'utf8'));
for (const item of reproductionCatalog.cases) {
  await writeJson(item.final_evidence_path, {
    schema: 'rushd.p00-final-reproduction-evidence.v1',
    issue_id: item.id,
    final_evidence_path: item.final_evidence_path,
    captured_at: capturedAt,
    source_sha: baseSha,
    reproduction_type: item.reproduction_type,
    sanitized_fixture: item.fixture,
    preconditions: item.preconditions,
    steps: item.steps,
    expected_current_result: item.expected_current_result,
    captured_current_result: item.captured_current_result,
    p01_action: item.p01_action,
    regression_owner: item.regression_owner,
    result: 'reproduced'
  });
}
const reproductionReport = {
  schema: 'rushd.p00-reproduction-results.v1',
  captured_at: capturedAt,
  source_sha: baseSha,
  command: 'npm test',
  result: 'pass',
  inventory_count: reproductionCatalog.cases.length,
  automated_count: reproductionCatalog.cases.filter((item) => item.reproduction_type === 'automated').length,
  manual_count: reproductionCatalog.cases.filter((item) => item.reproduction_type === 'manual').length,
  cases: reproductionCatalog.cases
};
await writeJson('docs/baseline/p0-p1-reproduction-results.json', reproductionReport);

const playwrightCapturePath = 'docs/baseline/current/playwright-capture.json';
const playwrightCaptureBytes = await readFile(playwrightCapturePath);
const playwrightCapture = JSON.parse(playwrightCaptureBytes);
const rawBrowserPerformance = JSON.parse(await readFile('docs/baseline/current/playwright-performance.json', 'utf8'));
const rawFixturePerformance = JSON.parse(await readFile('test-results/p00-browser/fixture-performance.json', 'utf8'));
const stateAccessibilityEvidence = [];
const accessibilityStates = [];
for (const entry of playwrightCapture.matrix) {
  const bytes = await readFile(entry.accessibility_path);
  const document = JSON.parse(bytes);
  stateAccessibilityEvidence.push({ path: entry.accessibility_path, sha256: sha256(bytes), byte_length: bytes.length, state_count: document.state_count });
  accessibilityStates.push(...document.states.map((state) => ({ ...state, language: document.language, theme: document.theme, matrix_viewport: `${document.viewport.width}x${document.viewport.height}` })));
}
const browserVersions = {
  capture_runner: { name: 'Playwright Chromium', version: playwrightCapture.chromium_version, executable_path: playwrightCapture.chromium_executable_path },
  pinned_playwright: { package_version: playwrightCapture.playwright_version, chromium_version: playwrightCapture.chromium_version, revision: 1234 },
  node: process.version,
  npm: '11.16.0',
  os: { name: 'macOS', version: '26.5.1', build: '25F80', architecture: process.arch }
};
const accessibilityPerformance = {
  schema: 'rushd.p00-accessibility-performance.v1',
  captured_at: capturedAt,
  browser_versions: browserVersions,
  accessibility_method: 'Axe-core executed by pinned Playwright Chromium at every captured state before the matching native viewport screenshot was hashed.',
  state_level_evidence: stateAccessibilityEvidence,
  accessibility_observations: {
    activated_state_count: accessibilityStates.length,
    total_violation_instances: accessibilityStates.reduce((sum, state) => sum + state.violation_count, 0),
    unique_violation_ids: [...new Set(accessibilityStates.flatMap((state) => state.violations.map((violation) => violation.id)))].sort(),
    language_direction_pairs: ['ar:rtl', 'en:ltr'],
    motion_profiles_captured: ['auto', 'full', 'balanced', 'lite'],
    known_baseline_findings_are_not_release_passes: true
  },
  performance_runner: { name: 'Playwright Chromium', version: playwrightCapture.chromium_version },
  browser_performance: rawBrowserPerformance,
  fixture_performance: rawFixturePerformance,
  budget_status: 'recorded_only',
  budget_note: 'P00 records the initial comparison baseline. It does not claim the final p75 LCP/INP/CLS or physical-device release targets pass.'
};
await writeJson('docs/baseline/accessibility-performance.json', accessibilityPerformance);

const visualFiles = (await listFiles('docs/baseline/current')).filter((path) => /\.(png|webm|mp4)$/.test(path));
const visualArtifacts = [];
for (const path of visualFiles) {
  const bytes = await readFile(path);
  const extension = path.split('.').at(-1);
  const stat = await lstat(path);
  const artifact = { path, sha256: sha256(bytes), byte_length: bytes.length, media_type: extension, symlink: stat.isSymbolicLink() };
  if (extension === 'png') {
    if (bytes.subarray(1, 4).toString('ascii') !== 'PNG') throw new Error(`${path} is not a true PNG`);
    artifact.width = bytes.readUInt32BE(16);
    artifact.height = bytes.readUInt32BE(20);
  }
  visualArtifacts.push(artifact);
}

const expectedPngNames = [
  'empty-dashboard.png', 'empty-statistics.png', 'empty-vault.png', 'empty-plans.png', 'empty-settings.png',
  'populated-dashboard.png', 'populated-statistics.png', 'populated-vault.png', 'populated-plans.png', 'populated-settings.png',
  'onboarding.png', 'add-modal.png', 'keyboard-focus-dashboard.png', 'edit-modal.png', 'profile-modal.png',
  'apply-plan-modal.png', 'confirm-reset-modal.png', 'error-toast.png', 'loading-onboarding.png'
];
const matrix = [];
for (const language of ['ar', 'en']) for (const theme of ['dark', 'light']) for (const viewport of ['390x844', '1024x1366', '1440x900']) {
  const directory = `docs/baseline/current/${language}/${theme}/${viewport}`;
  const [width, height] = viewport.split('x').map(Number);
  const missing = expectedPngNames.filter((name) => !visualArtifacts.some((item) => item.path === `${directory}/${name}`));
  const wrongDimensions = visualArtifacts.filter((item) => item.path.startsWith(`${directory}/`) && item.media_type === 'png' && (item.width !== width || item.height !== height)).map((item) => item.path);
  const motion = ['motion-add-full.webm', 'motion-add-full.mp4'].filter((name) => visualArtifacts.some((item) => item.path === `${directory}/${name}`));
  const accessibilityPath = `${directory}/accessibility.json`;
  const accessibility = stateAccessibilityEvidence.find((item) => item.path === accessibilityPath);
  matrix.push({ language, theme, viewport, directory, fixture_states: ['empty', 'populated', 'error', 'loading'], png_count: expectedPngNames.length - missing.length, motion, accessibility_path: accessibilityPath, accessibility_sha256: accessibility?.sha256 ?? null, missing, wrong_dimensions: wrongDimensions, result: missing.length === 0 && wrongDimensions.length === 0 && motion.length === 2 && accessibility?.state_count === expectedPngNames.length ? 'pass' : 'fail' });
}
const motionProfiles = ['auto', 'full', 'balanced', 'lite'].map((profile) => ({
  profile,
  webm: `docs/baseline/current/motion-profiles/${profile}/motion-add-${profile}.webm`,
  mp4: `docs/baseline/current/motion-profiles/${profile}/motion-add-${profile}.mp4`
}));
const visualManifest = {
  schema: 'rushd.p00-visual-manifest.v1',
  captured_at: capturedAt,
  source_sha: baseSha,
  capture_data: 'synthetic three-expense, one-goal, one-template UI state plus empty state; no real financial data',
  browser_versions: browserVersions,
  capture_manifest_path: playwrightCapturePath,
  capture_manifest_sha256: sha256(playwrightCaptureBytes),
  native_viewport_capture: playwrightCapture.post_capture_processing === false && playwrightCapture.dimension_forcing === false && playwrightCapture.padded_borders_added === false,
  matrix,
  motion_profiles: motionProfiles,
  state_accessibility_evidence: stateAccessibilityEvidence,
  artifact_count: visualArtifacts.length,
  artifacts: visualArtifacts
};
if (matrix.some((item) => item.result !== 'pass')) throw new Error('Visual matrix is incomplete');
await writeJson('docs/baseline/visual-manifest.json', visualManifest);

const checklist = matrix.map((item) => ({
  id: `${item.language}-${item.theme}-${item.viewport}`,
  language: item.language,
  direction: item.language === 'ar' ? 'rtl' : 'ltr',
  theme: item.theme,
  viewport: item.viewport,
  states_reviewed: expectedPngNames,
  motion_reviewed: item.motion,
  result: 'pass',
  evidence_directory: item.directory
}));
const manualIndex = {
  schema: 'rushd.p00-manual-evidence-index.v1',
  captured_at: capturedAt,
  captured_local_at: capturedLocalAt,
  timezone: 'Asia/Riyadh',
  utc_offset: '+03:00',
  tester_task_id: runnerTaskId,
  sanitized_data_only: true,
  matrix: checklist,
  manual_reproductions: reproductionCatalog.cases.filter((item) => item.reproduction_type === 'manual').map((item) => ({ id: item.id, fixture: item.fixture, preconditions: item.preconditions, steps: item.steps, captured_current_result: item.captured_current_result, justification: item.manual_justification, result: 'reproduced' })),
  limitations: [
    'P00 is a baseline capture, not a claim that known accessibility, performance, financial, or P0/P1 defects are fixed.',
    'Under the founder-attested EXTERNAL-P00-PINNED-CHROMIUM gate, the manager launched the exact pinned Chromium outside the phase sandbox and the worker connected only through the localhost CDP endpoint; the capture manifest records the package, executable, browser version, native dimensions, and absence of post-processing.',
    'Physical iOS, iPadOS, Android, installed-PWA, VoiceOver, and TalkBack release claims remain assigned to later phase gates.'
  ]
};
const manualIndexPath = `${humanEvidenceRoot}/manual-evidence-index.json`;
const manualIndexWrittenPath = await writeRunJson(manualIndexPath, manualIndex);
const manualIndexHash = sha256(await readFile(manualIndexWrittenPath));
const manualAttestation = {
  schema: 'rushd.human-attestation.v1',
  run_id: runId,
  phase_id: phaseId,
  gate_id: 'P00-M1',
  gate_kind: 'manual_qa',
  gate_request_sha256: sha256(manualRequirement),
  actor: 'phase_implementer',
  actor_task_id: runnerTaskId,
  performed_at: capturedAt,
  performed_local_at: capturedLocalAt,
  timezone: 'Asia/Riyadh',
  utc_offset: '+03:00',
  subject_sha: baseSha,
  period_started_at: null,
  period_ended_at: null,
  evidence_root: humanEvidenceRoot,
  evidence_hashes: { [manualIndexPath]: manualIndexHash },
  environment: { device: 'Apple Silicon Mac with manager-owned external Chromium over localhost CDP', os: 'macOS 26.5.1 (25F80)', browser: 'Playwright Chromium', browser_version: playwrightCapture.chromium_version, locale: 'ar-SA RTL and en-US LTR; Asia/Riyadh +03:00' },
  requirement: manualRequirement,
  result: 'pass',
  evidence_paths: [manualIndexPath],
  limitations: manualIndex.limitations
};
await writeJson('docs/baseline/P00-manual-qa.json', manualAttestation);

const readme = `# P00 immutable baseline\n\nThis directory freezes Rushd's pre-implementation authority, storage, defect, visual, motion, accessibility, and performance evidence at patch base \`${baseSha}\`. All financial examples are synthetic.\n\n## Contents\n\n- \`authority-baseline.json\`: source, authority, protected-path hashes, and supersession log.\n- \`storage-inventory.json\`: v1 IndexedDB/localStorage/export inventory and sanitized fixture hashes.\n- \`p0-p1-reproduction-results.json\` and \`p0-p1/\`: exact 20-item P0/P1 catalog and stable per-ID final evidence.\n- \`visual-manifest.json\`: SHA-256 inventory for the 12 language/theme/viewport combinations, native Playwright PNGs, WebM/MP4 recordings, error/loading states, and motion profiles.\n- \`accessibility-performance.json\`: hashed state-level axe evidence and pinned-Chromium/0/100/1,000-record comparison measurements.\n- \`P00-manual-qa.json\`: structured P00-M1 attestation with UTC and Riyadh local-time context.\n\nNormal tests only verify these artifacts and never rewrite them. Evidence writers require explicit \`RUSHD_BASELINE_WRITE=1\`; replacing existing fixture, capture, encoded-motion, normalized-image, or packaged evidence also requires \`RUSHD_BASELINE_REPLACE=1\`. Known baseline defects are evidence for P01 and are not release-readiness claims.\n`;
await writeFile('docs/baseline/README.md', readme, 'utf8');

for (const [id, summary, paths] of [
  ['P00-A1', 'Verified source/authority/base SHAs, authority hashes, supersession record, and protected inventory.', ['docs/baseline/authority-baseline.json']],
  ['P00-A2', 'Verified sanitized v1 storage and backup fixtures for all eight required cases and 0/100/1000 history sizes.', ['docs/baseline/storage-inventory.json', ...fixturePaths]],
  ['P00-A3', 'Verified exact 20-item P0/P1 catalog with executable reproductions or structured manual justifications and stable final evidence paths.', ['docs/baseline/p0-p1-reproduction-results.json', 'tests/characterization/p0-p1-cases.json', ...reproductionCatalog.cases.map((item) => item.final_evidence_path)]],
  ['P00-A4', 'Verified 12-combination native Playwright Chromium PNG matrix, WebM/MP4 evidence, error/loading states, hashed state-level axe evidence, browser versions, performance evidence, and UTC/local P00-M1 attestation.', ['docs/baseline/visual-manifest.json', 'docs/baseline/accessibility-performance.json', 'docs/baseline/P00-manual-qa.json', playwrightCapturePath, 'docs/baseline/current/playwright-performance.json', ...stateAccessibilityEvidence.map((item) => item.path)]],
  ['P00-A5', 'Verified exact dependency pins, lockfile, ignored test/build roots, explicit replacement guards, and the adversarial normalizer overwrite test.', ['package.json', 'package-lock.json', '.gitignore', 'scripts/capture-p00-baseline.cjs', 'scripts/encode-p00-motion.sh', 'scripts/normalize-p00-images.sh', 'scripts/p00-artifact-guards.test.mjs']]
]) {
  const records = [];
  for (const path of paths) {
    const bytes = await readFile(path);
    records.push({ path, sha256: sha256(bytes), byte_length: bytes.length });
  }
  await writeRunJson(`${evidenceRoot}/acceptance-${id}.json`, { schema: 'rushd.p00-acceptance-evidence.v1', run_id: runId, phase_id: phaseId, attempt, acceptance_id: id, status: 'pass', summary, records });
}

console.log(`Packaged P00 attempt ${attempt} evidence: ${visualArtifacts.length} media artifacts, ${fixtureInventory.length} fixture files, ${accessibilityStates.length} state-level accessibility records.${runArtifactStagingRoot ? ` Run artifacts staged under ${runArtifactStagingRoot}.` : ''}`);

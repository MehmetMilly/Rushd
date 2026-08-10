import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

export const RUN_STATUSES = [
  'not_started', 'worker_running', 'ready_for_review', 'reviewer_running',
  'needs_changes', 'escalated', 'passed_pending_commit', 'committed',
  'regression_review', 'human_required', 'final_audit', 'complete', 'failed'
];

export const RUN_TRANSITIONS = {
  not_started: ['worker_running'],
  worker_running: ['ready_for_review', 'human_required', 'failed'],
  ready_for_review: ['reviewer_running'],
  reviewer_running: ['needs_changes', 'escalated', 'passed_pending_commit', 'human_required', 'failed'],
  needs_changes: ['worker_running', 'escalated', 'human_required', 'failed'],
  escalated: ['worker_running', 'reviewer_running', 'human_required', 'failed'],
  passed_pending_commit: ['committed', 'failed'],
  committed: ['worker_running', 'regression_review', 'final_audit', 'human_required', 'failed'],
  regression_review: ['regression_review', 'worker_running', 'final_audit', 'human_required', 'failed'],
  human_required: ['worker_running', 'needs_changes', 'regression_review', 'final_audit', 'failed'],
  final_audit: ['final_audit', 'worker_running', 'human_required', 'complete', 'failed'],
  failed: [],
  complete: []
};

export const CANONICAL_AUDITS = [
  'finance_migration',
  'auth_sync_security_privacy',
  'ai',
  'bilingual_ux_accessibility_motion',
  'pwa_performance_operations'
];

export const FINAL_AUDIT_COMMANDS = {
  finance_migration: ['npm run ci', 'npm run test:property', 'npm run test:data'],
  auth_sync_security_privacy: ['npm run ci', 'npm run test:sync', 'npm run test:security'],
  ai: ['npm run ci', 'npm run test:ai', 'npm run eval:ai'],
  bilingual_ux_accessibility_motion: ['npm run ci', 'npm run test:e2e', 'npm run test:visual', 'npm run test:a11y'],
  pwa_performance_operations: ['npm run ci', 'npm run test:pwa', 'npm run test:performance', 'npm run build']
};

export const POST_DEPLOYMENT_CHECKS = [
  'root', 'direct-deep-link', 'api-health', 'install-update-offline', 'rollback-ready'
];

export const P13_BETA_REQUIREMENT = 'P13-BETA: Founder attests that the controlled beta evidence covers at least four complete weeks, includes the pre-registered tester/attrition and Momentum pressure/farming results, freezes any required reduced-scope rerun evidence, and is ready for independent release review.';

export const AUTHORITY_PATHS = [
  'docs/RUSHD_MASTER_PLAN_FINAL.md',
  'docs/RUSHD_EXECUTION_PROTOCOL.md',
  'docs/RUSHD_PHASE_PROMPTS.md',
  'docs/implementation/phase-plan.json',
  '.agents/skills/rushd-phase-orchestrator/**',
  '.codex/agents/*.toml'
];

export const REQUIRED_AUTHORITY_FILES = [
  'docs/RUSHD_MASTER_PLAN_FINAL.md',
  'docs/RUSHD_EXECUTION_PROTOCOL.md',
  'docs/RUSHD_PHASE_PROMPTS.md',
  'docs/implementation/phase-plan.json',
  '.agents/skills/rushd-phase-orchestrator/SKILL.md',
  '.agents/skills/rushd-phase-orchestrator/scripts/transition-state.mjs',
  '.agents/skills/rushd-phase-orchestrator/scripts/validate-artifact.mjs'
];

export const loadJson = (path) => JSON.parse(readFileSync(resolve(path), 'utf8'));
export const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
export const isSha1 = (value) => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
export const isSha256 = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
export const isIsoUtc = (value) => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  && !Number.isNaN(Date.parse(value));
export const isTemplateRun = (value) => value === 'REPLACE' || value === 'REPLACE_WITH_RUN_ID';
export const validRunId = (value) => typeof value === 'string'
  && /^rushd-\d{8}-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
export const unique = (items) => Array.isArray(items) && new Set(items).size === items.length;
export const sha256Bytes = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const sha256File = (path) => sha256Bytes(readFileSync(resolve(path)));
export const canonicalJsonSha256 = (value) => sha256Bytes(JSON.stringify(value));

export const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
export const gitBuffer = (...args) => execFileSync('git', args);
export const gitCommitExists = (sha) => {
  if (!isSha1(sha)) return false;
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
};
export const gitHead = () => git('rev-parse', 'HEAD').trim();
export const isAncestor = (ancestor, descendant) => {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
};

const nulList = (value) => value.split('\0').filter(Boolean);

export const manifestForCommitRange = (baseSha, commitSha) => {
  const base = git('rev-parse', `${baseSha}^{commit}`).trim();
  const commit = git('rev-parse', `${commitSha}^{commit}`).trim();
  const paths = nulList(git('diff', '--name-only', '-z', '--no-renames', base, commit, '--', '.'))
    .sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
  const files = paths.map((path) => {
    let entry;
    try {
      entry = git('ls-tree', commit, '--', path).trim();
    } catch {
      entry = '';
    }
    if (!entry) return { path, state: 'deleted' };
    const match = /^(\d{6})\s+(\w+)\s+([0-9a-f]{40})\t/.exec(entry);
    if (!match) throw new Error(`Could not parse tree entry for ${path}`);
    const [, mode, type, blobSha] = match;
    if (type !== 'blob') throw new Error(`Unsupported committed path type for ${path}: ${type}`);
    const bytes = gitBuffer('cat-file', '-p', blobSha);
    return {
      path,
      state: 'present',
      kind: mode === '120000' ? 'symlink' : 'file',
      executable: mode === '100755',
      size: bytes.length,
      sha256: sha256Bytes(bytes)
    };
  });
  const manifest = { schema: 'rushd.patch-manifest.v1', base_sha: base, files };
  return { ...manifest, patch_sha256: canonicalJsonSha256(manifest) };
};

export const isPathInside = (path, root) => {
  if (typeof path !== 'string' || typeof root !== 'string') return false;
  const rootResolved = resolve(root);
  const pathResolved = resolve(path);
  const lexical = relative(rootResolved, pathResolved);
  if (!(lexical === '' || (!lexical.startsWith('..') && !isAbsolute(lexical)))) return false;
  if (!existsSync(rootResolved) || !existsSync(pathResolved)) return false;
  try {
    const rootReal = realpathSync(rootResolved);
    const pathReal = realpathSync(pathResolved);
    const actual = relative(rootReal, pathReal);
    return actual === '' || (!actual.startsWith('..') && !isAbsolute(actual));
  } catch {
    return false;
  }
};

export const isNonEmptyRegularFile = (path) => {
  if (typeof path !== 'string' || !existsSync(resolve(path))) return false;
  const absolute = resolve(path);
  const lstat = lstatSync(absolute);
  if (lstat.isSymbolicLink()) return false;
  const stat = statSync(absolute);
  return stat.isFile() && stat.size > 0;
};

export const globRegex = (glob) => {
  let source = '^';
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === '*' && glob[index + 1] === '*') {
      index += 1;
      if (glob[index + 1] === '/') {
        index += 1;
        source += '(?:.*/)?';
      } else source += '.*';
    } else if (character === '*') source += '[^/]*';
    else if (character === '?') source += '[^/]';
    else source += character.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`${source}$`);
};
export const matchesAny = (path, globs) => Array.isArray(globs) && globs.some((glob) => globRegex(glob).test(path));

export const readPlan = () => loadJson('docs/implementation/phase-plan.json');
export const phaseFor = (plan, phaseId) => plan?.phases?.find((phase) => phase.id === phaseId);

export const artifactRecord = (artifactPath, fields = {}) => ({
  ...fields,
  artifact_path: artifactPath,
  artifact_sha256: sha256File(artifactPath)
});

export const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export const remediationAfterRegressionFailure = (remediation, failedRecord, ownerCommitCount) => ({
  ...remediation,
  status: 'implementing',
  round_base_sha: remediation.remediation_commit_sha,
  remediation_round: remediation.remediation_round + 1,
  owner_commit_count_before: ownerCommitCount,
  remediation_commit_sha: null,
  remediation_commit_artifact_path: null,
  passed_regression_phases: [],
  regression_results: [],
  failed_regression_results: [...remediation.failed_regression_results, failedRecord],
  active_regression_phase: null
});

export const assertJournalChain = (events, genesisStateSha256, verifyEvidence = true) => {
  if (!Array.isArray(events) || events.length === 0) throw new Error('Transition journal must contain events');
  if (!isSha256(genesisStateSha256)) throw new Error('Transition journal genesis hash is invalid');
  const eventIds = new Set();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!isObject(event) || event.schema !== 'rushd.state-transition-event.v1') throw new Error(`Journal event ${index + 1} has invalid schema`);
    if (typeof event.event_id !== 'string' || event.event_id.length < 8 || eventIds.has(event.event_id)) throw new Error(`Journal event ${index + 1} has invalid/duplicate event_id`);
    eventIds.add(event.event_id);
    if (event.state_revision !== index + 1) throw new Error(`Journal revision ${index + 1} is not contiguous`);
    if (!RUN_STATUSES.includes(event.from) || !RUN_TRANSITIONS[event.from]?.includes(event.to) || typeof event.transition_kind !== 'string' || event.transition_kind.length === 0 || !isIsoUtc(event.at)) throw new Error(`Journal event ${index + 1} has invalid transition metadata`);
    if (!isSha256(event.previous_state_sha256) || !isSha256(event.next_state_sha256) || !isSha256(event.request_sha256)) throw new Error(`Journal event ${index + 1} has invalid hashes`);
    const expectedPrevious = index === 0 ? genesisStateSha256 : events[index - 1].next_state_sha256;
    if (event.previous_state_sha256 !== expectedPrevious) throw new Error(`Journal event ${index + 1} breaks the state hash chain`);
    if (index > 0 && events[index - 1].to !== event.from) throw new Error(`Journal event ${index + 1} breaks the status chain`);
    if (!Array.isArray(event.evidence) || event.evidence.length === 0) throw new Error(`Journal event ${index + 1} has no evidence`);
    for (const evidence of event.evidence) {
      if (!isObject(evidence) || typeof evidence.path !== 'string' || !isSha256(evidence.sha256)) throw new Error(`Journal event ${index + 1} has malformed evidence`);
      if (verifyEvidence && (!isNonEmptyRegularFile(evidence.path) || sha256File(evidence.path) !== evidence.sha256)) throw new Error(`Journal event ${index + 1} evidence hash mismatch: ${String(evidence.path)}`);
    }
  }
  return events.at(-1);
};

export const strictKeys = (object, allowed, required = allowed) => {
  if (!isObject(object)) return { ok: false, message: 'changes must be an object' };
  const unknown = Object.keys(object).filter((key) => !allowed.includes(key));
  const missing = required.filter((key) => !Object.hasOwn(object, key));
  if (unknown.length) return { ok: false, message: `Unexpected transition changes: ${unknown.join(', ')}` };
  if (missing.length) return { ok: false, message: `Missing transition changes: ${missing.join(', ')}` };
  return { ok: true };
};

export const validHttpUrl = (value) => {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
};

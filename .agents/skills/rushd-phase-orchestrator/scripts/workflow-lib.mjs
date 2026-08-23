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
  worker_running: ['worker_running', 'ready_for_review', 'human_required', 'failed'],
  ready_for_review: ['reviewer_running'],
  reviewer_running: ['needs_changes', 'escalated', 'passed_pending_commit', 'human_required', 'failed'],
  needs_changes: ['worker_running', 'escalated', 'human_required', 'failed'],
  escalated: ['worker_running', 'reviewer_running', 'human_required', 'failed'],
  passed_pending_commit: ['worker_running', 'committed', 'failed'],
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

export const COMMIT_SANDBOX_ALLOWED_ACTIONS = [
  'recompute_reviewed_patch',
  'stage_exact_reviewed_paths',
  'create_single_parent_phase_commit',
  'report_commit_status'
];

export const COMMIT_SANDBOX_FORBIDDEN_ACTIONS = [
  'edit_product_or_authority_files',
  'stage_unreviewed_paths',
  'amend_or_rewrite_history',
  'push_publish_or_deploy'
];

export const P13_BETA_REQUIREMENT = 'P13-BETA: Founder attests that the controlled beta evidence covers at least four complete weeks, includes the pre-registered tester/attrition and Momentum pressure/farming results, freezes any required reduced-scope rerun evidence, and is ready for independent release review.';

export const AUTHORITY_PATHS = [
  'docs/RUSHD_MASTER_PLAN_FINAL.md',
  'docs/RUSHD_EXECUTION_PROTOCOL.md',
  'docs/RUSHD_PHASE_PROMPTS.md',
  'docs/implementation/phase-plan.json',
  'docs/implementation/PLAN_AMENDMENT_*.json',
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

export const phaseCommitOverlayRange = (reviewedBaseSha, commitSha) => {
  const parents = git('rev-list', '--parents', '-n', '1', commitSha).trim().split(/\s+/);
  if (parents.length !== 2) throw new Error('Phase commit must have exactly one parent');
  const parentSha = parents[1];
  if (!isAncestor(reviewedBaseSha, parentSha)) throw new Error('Phase commit parent is not descended from the reviewed base SHA');
  const committedProduct = manifestForCommitRange(parentSha, commitSha);
  const productCore = { schema: 'rushd.patch-manifest.v1', base_sha: reviewedBaseSha, files: committedProduct.files };
  const productManifest = { ...productCore, patch_sha256: canonicalJsonSha256(productCore) };
  if (parentSha === reviewedBaseSha) return { parent_sha: parentSha, authority_commits: [], authority_manifest: null, product_manifest: productManifest };
  const authorityCommits = [];
  let cursor = parentSha;
  while (cursor !== reviewedBaseSha) {
    const lineage = git('rev-list', '--parents', '-n', '1', cursor).trim().split(/\s+/);
    if (lineage.length !== 2) throw new Error('Phase commit authority overlay must be a contiguous single-parent chain');
    const changed = git('diff-tree', '--no-commit-id', '--name-only', '-r', cursor).split('\n').filter(Boolean);
    if (changed.length === 0 || changed.some((path) => !matchesAny(path, AUTHORITY_PATHS))) {
      throw new Error('Phase commit authority overlay contains a non-authority commit');
    }
    authorityCommits.unshift(cursor);
    cursor = lineage[1];
  }
  const authorityManifest = manifestForCommitRange(reviewedBaseSha, parentSha);
  if (authorityManifest.files.length === 0 || authorityManifest.files.some((file) => !matchesAny(file.path, AUTHORITY_PATHS))) {
    throw new Error('Phase commit parent overlay is not authority-only');
  }
  const authorityPaths = new Set(authorityManifest.files.map((file) => file.path));
  if (productManifest.files.some((file) => authorityPaths.has(file.path) || matchesAny(file.path, AUTHORITY_PATHS))) {
    throw new Error('Phase commit product manifest overlaps the sealed authority overlay');
  }
  return { parent_sha: parentSha, authority_commits: authorityCommits, authority_manifest: authorityManifest, product_manifest: productManifest };
};

export const manifestScopeMismatch = (priorFiles, replacementFiles, affectedPaths) => {
  if (!Array.isArray(priorFiles) || !Array.isArray(replacementFiles)) return 'patch manifests are malformed';
  if (!Array.isArray(affectedPaths) || affectedPaths.length === 0) return 'affected_paths is empty';
  const isAffected = (path) => affectedPaths.some((pattern) => matchesAny(path, [pattern]));
  const priorByPath = new Map(priorFiles.map((file) => [file?.path, file]));
  for (const replacement of replacementFiles) {
    if (!isObject(replacement) || typeof replacement.path !== 'string') return 'patch manifest entry is malformed';
    const prior = priorByPath.get(replacement.path);
    if (prior === undefined && !isAffected(replacement.path)) return `adds a path outside affected_paths: ${replacement.path}`;
    if (prior !== undefined && !sameJson(prior, replacement) && !isAffected(replacement.path)) return `changes a reviewed path outside affected_paths: ${replacement.path}`;
  }
  const replacementPaths = new Set(replacementFiles.map((file) => file?.path));
  for (const prior of priorFiles) {
    if (!replacementPaths.has(prior?.path) && !isAffected(prior?.path)) return `drops a reviewed path outside affected_paths: ${String(prior?.path)}`;
  }
  return null;
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

export const sealedAuthorityRule = (amendmentId, runId) => ({
  'RUSHD-20260811-WORKER-TURN-RECOVERY': {
    path: 'docs/implementation/PLAN_AMENDMENT_2026-08-11_WORKER_TURN_RECOVERY.json',
    approval: `.codex/runs/${runId}/controller/authority-amendment-approval.json`,
    paths: [
      '.agents/skills/rushd-phase-orchestrator/SKILL.md',
      '.agents/skills/rushd-phase-orchestrator/scripts/transition-self-test.mjs',
      '.agents/skills/rushd-phase-orchestrator/scripts/transition-state.mjs',
      '.agents/skills/rushd-phase-orchestrator/scripts/validate-artifact.mjs',
      '.agents/skills/rushd-phase-orchestrator/scripts/workflow-lib.mjs',
      'docs/RUSHD_EXECUTION_PROTOCOL.md',
      'docs/implementation/PLAN_AMENDMENT_2026-08-11_WORKER_TURN_RECOVERY.json',
      'docs/implementation/phase-plan.json'
    ],
    planChange: 'protect-amendments'
  },
  'RUSHD-20260811-EXTERNAL-WORKER-CONTINUATION': {
    path: 'docs/implementation/PLAN_AMENDMENT_2026-08-11_EXTERNAL_WORKER_CONTINUATION.json',
    approval: `.codex/runs/${runId}/controller/authority-amendment-external-continuation-approval.json`,
    paths: [
      '.agents/skills/rushd-phase-orchestrator/SKILL.md',
      '.agents/skills/rushd-phase-orchestrator/scripts/transition-self-test.mjs',
      '.agents/skills/rushd-phase-orchestrator/scripts/transition-state.mjs',
      '.agents/skills/rushd-phase-orchestrator/scripts/validate-artifact.mjs',
      'docs/RUSHD_EXECUTION_PROTOCOL.md',
      'docs/implementation/PLAN_AMENDMENT_2026-08-11_EXTERNAL_WORKER_CONTINUATION.json'
    ],
    planChange: 'none'
  },
  'RUSHD-20260811-SEALED-AUTHORITY-PHASE-COMMIT': {
    path: 'docs/implementation/PLAN_AMENDMENT_2026-08-11_SEALED_AUTHORITY_PHASE_COMMIT.json',
    approval: `.codex/runs/${runId}/controller/authority-amendment-sealed-phase-commit-approval.json`,
    paths: [
      '.agents/skills/rushd-phase-orchestrator/SKILL.md',
      '.agents/skills/rushd-phase-orchestrator/scripts/transition-self-test.mjs',
      '.agents/skills/rushd-phase-orchestrator/scripts/validate-artifact.mjs',
      '.agents/skills/rushd-phase-orchestrator/scripts/workflow-lib.mjs',
      'docs/RUSHD_EXECUTION_PROTOCOL.md',
      'docs/implementation/PLAN_AMENDMENT_2026-08-11_SEALED_AUTHORITY_PHASE_COMMIT.json'
    ],
    planChange: 'none'
  },
  'RUSHD-20260811-PHASE-COMMIT-SANDBOX-CONTINUATION': {
    path: 'docs/implementation/PLAN_AMENDMENT_2026-08-11_PHASE_COMMIT_SANDBOX_CONTINUATION.json',
    approval: `.codex/runs/${runId}/controller/authority-amendment-phase-commit-sandbox-approval.json`,
    correctionApproval: `.codex/runs/${runId}/controller/authority-amendment-phase-commit-sandbox-correction-01-approval.json`,
    paths: [
      '.agents/skills/rushd-phase-orchestrator/SKILL.md',
      '.agents/skills/rushd-phase-orchestrator/scripts/self-test.mjs',
      '.agents/skills/rushd-phase-orchestrator/scripts/transition-self-test.mjs',
      '.agents/skills/rushd-phase-orchestrator/scripts/validate-artifact.mjs',
      '.agents/skills/rushd-phase-orchestrator/scripts/workflow-lib.mjs',
      'docs/RUSHD_EXECUTION_PROTOCOL.md',
      'docs/implementation/PLAN_AMENDMENT_2026-08-11_PHASE_COMMIT_SANDBOX_CONTINUATION.json'
    ],
    planChange: 'none'
  },
  'RUSHD-20260822-PORTABLE-PRECOMMIT-RECONCILIATION': {
    path: 'docs/implementation/PLAN_AMENDMENT_2026-08-22_PORTABLE_PRECOMMIT_RECONCILIATION.json',
    correctionApproval: `.codex/runs/${runId}/controller/authority-amendment-portable-precommit-reconciliation-correction-01-approval.json`,
    paths: [
      '.agents/skills/rushd-phase-orchestrator/SKILL.md',
      '.agents/skills/rushd-phase-orchestrator/scripts/self-test.mjs',
      '.agents/skills/rushd-phase-orchestrator/scripts/transition-state.mjs',
      '.agents/skills/rushd-phase-orchestrator/scripts/validate-artifact.mjs',
      '.agents/skills/rushd-phase-orchestrator/scripts/workflow-lib.mjs',
      'docs/RUSHD_EXECUTION_PROTOCOL.md',
      'docs/implementation/PLAN_AMENDMENT_2026-08-22_PORTABLE_PRECOMMIT_RECONCILIATION.json'
    ],
    planChange: 'none'
  },
  'RUSHD-20260823-RECONCILIATION-MANIFEST-SCOPE': {
    path: 'docs/implementation/PLAN_AMENDMENT_2026-08-23_RECONCILIATION_MANIFEST_SCOPE.json',
    approval: `.codex/runs/${runId}/controller/authority-amendment-reconciliation-manifest-scope-approval.json`,
    paths: [
      '.agents/skills/rushd-phase-orchestrator/scripts/workflow-lib.mjs',
      '.agents/skills/rushd-phase-orchestrator/scripts/transition-state.mjs',
      '.agents/skills/rushd-phase-orchestrator/scripts/self-test.mjs',
      'docs/RUSHD_EXECUTION_PROTOCOL.md',
      'docs/implementation/PLAN_AMENDMENT_2026-08-23_RECONCILIATION_MANIFEST_SCOPE.json'
    ],
    planChange: 'none'
  }
}[amendmentId]);

export const canonicalCommitSandboxApprovalPath = (runId) =>
  `.codex/runs/${runId}/controller/authority-amendment-phase-commit-sandbox-approval.json`;

export const isStrictlyAfterIso = (later, earlier) =>
  isIsoUtc(later) && isIsoUtc(earlier) && Date.parse(later) > Date.parse(earlier);

export const sameInstant = (left, right) =>
  Number.isFinite(Date.parse(left)) && Number.isFinite(Date.parse(right)) && Date.parse(left) === Date.parse(right);

export const commitSandboxBlockerParentMismatch = (reportedParent, enablingCommitParent) =>
  reportedParent === enablingCommitParent ? null : 'commit sandbox blocker parent is not the authority tip that existed before the enabling amendment';

export const commitSandboxApprovalMismatch = (runId, approvalPath, approval, approvalManifest, seal) => {
  const canonicalPath = canonicalCommitSandboxApprovalPath(runId);
  if (approvalPath !== canonicalPath || seal?.rule?.approval !== canonicalPath) return 'commit sandbox enabling approval path is not canonical';
  if (!isObject(approval) || !sameJson(approval, seal?.approval)) return 'commit sandbox enabling approval content was substituted';
  if (!sameJson(approvalManifest, seal?.approvedManifest)) return 'commit sandbox enabling approval manifest was substituted';
  if (approval.run_id !== runId || approval.amendment_id !== 'RUSHD-20260811-PHASE-COMMIT-SANDBOX-CONTINUATION') return 'commit sandbox enabling approval identity changed';
  return null;
};

export const canonicalCommitSandboxPrompt = (authorization) => {
  const binding = {
    run_id: authorization.run_id,
    phase_id: authorization.phase_id,
    attempt: authorization.attempt,
    role: authorization.role,
    thread_id: authorization.thread_id,
    session_id: authorization.session_id,
    source_sha: authorization.source_sha,
    authority_parent_sha: authorization.authority_parent_sha,
    patch_sha256: authorization.patch_sha256,
    patch_manifest_path: authorization.patch_manifest_path,
    checkpoint_path: authorization.checkpoint_path,
    review_path: authorization.review_path,
    commit_subject: authorization.commit_subject,
    changed_files: authorization.changed_files,
    allowed_actions: COMMIT_SANDBOX_ALLOWED_ACTIONS,
    forbidden_actions: COMMIT_SANDBOX_FORBIDDEN_ACTIONS
  };
  return [
    'Rushd reviewed phase commit continuation v1.',
    `Canonical binding: ${JSON.stringify(binding)}`,
    'Perform the allowed_actions exactly in their listed order and no other action.',
    'Do not edit any product or authority file. Do not stage any path absent from changed_files. Do not amend, reset, rebase, merge, rewrite history, push, publish, deploy, or access unrelated data.',
    'Before staging, recompute and require the exact patch_sha256 and changed_files. Stage only changed_files with exact deletion handling; never use git add -A or git add .',
    'Create one single-parent commit with commit_subject whose parent is authority_parent_sha. Then verify the normalized committed product manifest is byte-identical to the reviewed manifest and report one JSON object containing run_id, phase_id, attempt, commit_sha, parent_sha, commit_subject, reviewed_base_sha, patch_sha256, manifest_path, manifest_sha256, changed_files, index_status set to clean, working_tree_status set to clean, unexplained_changes set to [], and committed_at. Do not use Markdown.'
  ].join('\n');
};

export const commitSandboxContinuationMismatch = (receipt, authorization, turnRequest) => {
  if (turnRequest?.params?.sandboxPolicy?.type !== 'dangerFullAccess') return 'commit continuation must use dangerFullAccess';
  if (!['phase_worker', 'remediation_worker'].includes(receipt?.role)) return 'commit continuation role is not phase-owned';
  if (receipt?.capability_scope !== 'reviewed_phase_commit') return 'commit continuation scope is not reviewed_phase_commit';
  if (typeof receipt?.capability_artifact_path !== 'string' || typeof receipt?.capability_artifact_sha256 !== 'string') return 'commit continuation capability evidence is missing';
  if (!isObject(authorization) || authorization.schema !== 'rushd.phase-commit-sandbox-authorization.v1') return 'commit continuation authorization schema is invalid';
  const identity = [
    ['run_id', receipt.run_id], ['phase_id', receipt.phase_id], ['attempt', receipt.attempt],
    ['role', receipt.role], ['thread_id', receipt.thread_id], ['session_id', receipt.session_id],
    ['source_sha', receipt.source_sha], ['model', receipt.model], ['thinking', receipt.thinking],
    ['prompt_sha256', receipt.prompt_sha256]
  ];
  for (const [key, expected] of identity) if (!sameJson(authorization[key], expected)) return `commit continuation ${key} mismatch`;
  if (!isStrictlyAfterIso(receipt?.created_at, authorization.issued_at)) return 'commit continuation does not start strictly after its authorization';
  if (authorization.sandbox_policy !== 'dangerFullAccess') return 'commit continuation authorization weakens sandbox binding';
  if (!sameJson(authorization.allowed_actions, COMMIT_SANDBOX_ALLOWED_ACTIONS)) return 'commit continuation allowed actions changed';
  if (!sameJson(authorization.forbidden_actions, COMMIT_SANDBOX_FORBIDDEN_ACTIONS)) return 'commit continuation forbidden actions changed';
  const canonicalInput = [{ type: 'text', text: canonicalCommitSandboxPrompt(authorization) }];
  if (!sameJson(turnRequest?.params?.input, canonicalInput)) return 'commit continuation prompt is not the canonical commit-only prompt';
  if (sha256Bytes(Buffer.from(JSON.stringify(canonicalInput))) !== authorization.prompt_sha256) return 'commit continuation canonical prompt hash mismatch';
  return null;
};

export const commitSandboxCompletionMismatch = (phaseCommit, authorization, receipt, report) => {
  if (!isObject(phaseCommit) || !isObject(authorization) || !isObject(receipt) || !isObject(report)) return 'commit continuation completion evidence is incomplete';
  const identity = ['run_id', 'phase_id', 'attempt', 'role', 'thread_id', 'session_id', 'source_sha', 'model', 'thinking'];
  for (const key of identity) if (!sameJson(receipt[key], authorization[key])) return `commit continuation completed receipt ${key} mismatch`;
  if (receipt.status !== 'completed' || receipt.source_diff_status !== 'clean') return 'commit continuation completed receipt is not clean and completed';
  if (receipt.capability_scope !== 'reviewed_phase_commit' || receipt.capability_artifact_path !== phaseCommit.commit_sandbox_authorization_path || receipt.capability_artifact_sha256 !== phaseCommit.commit_sandbox_authorization_sha256) return 'commit continuation completed receipt capability mismatch';
  if (!isStrictlyAfterIso(receipt.created_at, authorization.issued_at) || !isStrictlyAfterIso(phaseCommit.committed_at, receipt.created_at) || !isStrictlyAfterIso(receipt.completed_at, phaseCommit.committed_at)) return 'commit continuation completion timestamps are not strictly ordered';
  const expectedReport = {
    run_id: phaseCommit.run_id,
    phase_id: phaseCommit.phase_id,
    attempt: phaseCommit.attempt,
    commit_sha: phaseCommit.commit_sha,
    parent_sha: authorization.authority_parent_sha,
    commit_subject: phaseCommit.commit_subject,
    reviewed_base_sha: phaseCommit.base_sha,
    patch_sha256: phaseCommit.patch_sha256,
    manifest_path: authorization.patch_manifest_path,
    manifest_sha256: authorization.patch_manifest_sha256,
    changed_files: phaseCommit.changed_files,
    index_status: 'clean',
    working_tree_status: 'clean',
    unexplained_changes: [],
    committed_at: phaseCommit.committed_at
  };
  for (const [key, expected] of Object.entries(expectedReport)) if (!sameJson(report[key], expected)) return `commit continuation structured report ${key} mismatch`;
  return null;
};

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

#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  AUTHORITY_PATHS,
  COMMIT_SANDBOX_ALLOWED_ACTIONS,
  COMMIT_SANDBOX_FORBIDDEN_ACTIONS,
  canonicalCommitSandboxApprovalPath,
  canonicalCommitSandboxPrompt,
  commitSandboxApprovalMismatch,
  commitSandboxBlockerParentMismatch,
  commitSandboxCompletionMismatch,
  commitSandboxContinuationMismatch,
  isStrictlyAfterIso,
  manifestScopeMismatch,
  matchesAny,
  readPlan,
  remediationAfterRegressionFailure,
  sameInstant,
  sameJson,
  sealedAuthorityRule,
  sha256Bytes,
  sha256File,
  loadJson
} from './workflow-lib.mjs';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const runId = `rushd-20990101-hardening-selftest-${process.pid}`;
const runRelative = `.codex/runs/${runId}`;
const runRoot = resolve(root, runRelative);
const worktree = resolve('/tmp', `${runId}-worktree`);
const validator = resolve(root, '.agents/skills/rushd-phase-orchestrator/scripts/validate-artifact.mjs');
const transition = resolve(root, '.agents/skills/rushd-phase-orchestrator/scripts/transition-state.mjs');
const snapshotScript = resolve(root, '.agents/skills/rushd-phase-orchestrator/scripts/create-worktree-snapshot.mjs');

const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const run = (args) => spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
const expectRejected = (name, result, pattern) => {
  if (result.status === 0) throw new Error(`${name}: unexpectedly accepted`);
  const output = `${result.stdout}\n${result.stderr}`;
  if (pattern && !pattern.test(output)) throw new Error(`${name}: wrong rejection: ${output}`);
  console.log(`PASS reject ${name}`);
};

mkdirSync(runRoot, { recursive: true });
try {
  const plan = readPlan();
  const globCases = [
    ['docs/top.md', ['docs/**'], true],
    ['docs/nested/deep/file.md', ['docs/**'], true],
    ['src/secret.json', ['src/**/secret.json'], true],
    ['src/deep/nested/secret.json', ['src/**/secret.json'], true],
    ['docs/implementation/checkpoint-template.json', plan.protected_paths, true],
    ['docs/implementation/nested/checkpoint-template.json', ['docs/implementation/*-template.json'], false],
    ['.agents/skills/rushd-phase-orchestrator/scripts/deep/test.mjs', AUTHORITY_PATHS, true]
  ];
  for (const [path, globs, expected] of globCases) if (matchesAny(path, globs) !== expected) throw new Error(`Glob mismatch for ${path}`);
  const deniedPath = '.agents/skills/rushd-phase-orchestrator/scripts/deep/test.mjs';
  if (!matchesAny(deniedPath, ['.agents/**']) || !matchesAny(deniedPath, plan.protected_paths)) throw new Error('Deny-first recursive path policy test is invalid');
  console.log('PASS recursive allow/protect/authority glob policy');

  const commitReceipt = {
    run_id: runId, phase_id: 'P00', attempt: 2, role: 'phase_worker',
    thread_id: 'thread-p00', session_id: 'thread-p00', source_sha: head,
    model: 'gpt-5.6-sol', thinking: 'high', created_at: '2099-01-01T00:01:00Z',
    capability_scope: 'reviewed_phase_commit', capability_artifact_path: 'authorization.json', capability_artifact_sha256: 'b'.repeat(64)
  };
  const commitAuthorization = {
    schema: 'rushd.phase-commit-sandbox-authorization.v1',
    ...Object.fromEntries(['run_id', 'phase_id', 'attempt', 'role', 'thread_id', 'session_id', 'source_sha', 'model', 'thinking', 'prompt_sha256'].map((key) => [key, commitReceipt[key]])),
    sandbox_policy: 'dangerFullAccess',
    issued_at: '2099-01-01T00:00:00Z',
    authority_parent_sha: head, patch_sha256: 'c'.repeat(64), patch_manifest_path: 'patch.json', patch_manifest_sha256: 'e'.repeat(64), checkpoint_path: 'checkpoint.json', review_path: 'review.json', commit_subject: 'Rushd P00: self-test', changed_files: ['self-test.txt'],
    allowed_actions: COMMIT_SANDBOX_ALLOWED_ACTIONS,
    forbidden_actions: COMMIT_SANDBOX_FORBIDDEN_ACTIONS
  };
  const commitInput = [{ type: 'text', text: canonicalCommitSandboxPrompt(commitAuthorization) }];
  commitReceipt.prompt_sha256 = (await import('node:crypto')).createHash('sha256').update(JSON.stringify(commitInput)).digest('hex');
  commitAuthorization.prompt_sha256 = commitReceipt.prompt_sha256;
  const commitTurn = { params: { sandboxPolicy: { type: 'dangerFullAccess' }, input: commitInput } };
  if (commitSandboxContinuationMismatch(commitReceipt, commitAuthorization, commitTurn) !== null) throw new Error('Valid commit-only sandbox continuation was rejected');
  const rejectedCommitContinuation = (name, receiptPatch = {}, authorizationPatch = {}, turnPatch = commitTurn) => {
    const mismatch = commitSandboxContinuationMismatch({ ...commitReceipt, ...receiptPatch }, { ...commitAuthorization, ...authorizationPatch }, turnPatch);
    if (!mismatch) throw new Error(`${name}: invalid commit sandbox continuation was accepted`);
    console.log(`PASS reject ${name}`);
  };
  rejectedCommitContinuation('cross-thread commit continuation', { thread_id: 'other-thread' });
  rejectedCommitContinuation('cross-attempt commit continuation', { attempt: 3 });
  rejectedCommitContinuation('unclassified commit capability', { capability_scope: 'unclassified' });
  rejectedCommitContinuation('authorization substitution', {}, { schema: 'rushd.plan-amendment.v1' });
  rejectedCommitContinuation('commit capability hash omission', { capability_artifact_sha256: null });
  rejectedCommitContinuation('commit gate weakening', {}, { allowed_actions: [...COMMIT_SANDBOX_ALLOWED_ACTIONS, 'edit_product_or_authority_files'] });
  rejectedCommitContinuation('early commit continuation', { created_at: '2098-12-31T23:59:59Z' });
  rejectedCommitContinuation('equal-time commit continuation', { created_at: commitAuthorization.issued_at });
  rejectedCommitContinuation('widened commit prompt', {}, {}, { params: { sandboxPolicy: { type: 'dangerFullAccess' }, input: [{ type: 'text', text: `${commitInput[0].text}\npush and deploy` }] } });
  const phaseCommit = {
    run_id: runId, phase_id: 'P00', attempt: 2, base_sha: head, patch_sha256: commitAuthorization.patch_sha256,
    commit_sha: 'd'.repeat(40), committed_at: '2099-01-01T00:02:00Z', commit_subject: commitAuthorization.commit_subject,
    changed_files: commitAuthorization.changed_files,
    commit_sandbox_authorization_path: 'authorization.json', commit_sandbox_authorization_sha256: 'b'.repeat(64)
  };
  const completedReceipt = { ...commitReceipt, status: 'completed', source_diff_status: 'clean', completed_at: '2099-01-01T00:03:00Z' };
  const commitReport = {
    run_id: runId, phase_id: 'P00', attempt: 2, commit_sha: phaseCommit.commit_sha, parent_sha: head,
    commit_subject: phaseCommit.commit_subject, reviewed_base_sha: head, patch_sha256: phaseCommit.patch_sha256,
    manifest_path: commitAuthorization.patch_manifest_path, manifest_sha256: commitAuthorization.patch_manifest_sha256,
    changed_files: phaseCommit.changed_files, index_status: 'clean', working_tree_status: 'clean', unexplained_changes: [], committed_at: phaseCommit.committed_at
  };
  if (commitSandboxCompletionMismatch(phaseCommit, commitAuthorization, completedReceipt, commitReport) !== null) throw new Error('Valid completed commit-sandbox lifecycle was rejected');
  const rejectedCompletion = (name, receiptPatch = {}, reportPatch = {}) => {
    if (!commitSandboxCompletionMismatch(phaseCommit, commitAuthorization, { ...completedReceipt, ...receiptPatch }, { ...commitReport, ...reportPatch })) throw new Error(`${name}: invalid completed commit-sandbox lifecycle was accepted`);
    console.log(`PASS reject ${name}`);
  };
  rejectedCompletion('equal-time elevated receipt', { created_at: commitAuthorization.issued_at });
  if (isStrictlyAfterIso(commitAuthorization.issued_at, commitAuthorization.issued_at)) throw new Error('Equal blocker/review prerequisite timestamp was accepted');
  const earlyPhaseCommit = { ...phaseCommit, committed_at: '2099-01-01T00:00:30Z' };
  const earlyCommitReport = { ...commitReport, committed_at: earlyPhaseCommit.committed_at };
  if (!commitSandboxCompletionMismatch(earlyPhaseCommit, commitAuthorization, completedReceipt, earlyCommitReport)) throw new Error('Commit before elevated turn was accepted');
  console.log('PASS reject commit before elevated turn');
  const equalPhaseCommit = { ...phaseCommit, committed_at: completedReceipt.created_at };
  const equalCommitReport = { ...commitReport, committed_at: equalPhaseCommit.committed_at };
  if (!commitSandboxCompletionMismatch(equalPhaseCommit, commitAuthorization, completedReceipt, equalCommitReport)) throw new Error('Commit equal to elevated start was accepted');
  console.log('PASS reject commit equal to elevated start');
  rejectedCompletion('completed receipt equal to commit', { completed_at: phaseCommit.committed_at });
  rejectedCompletion('completed receipt before commit', { completed_at: '2099-01-01T00:01:59Z' });
  if (!sameInstant('2099-01-01T00:02:00Z', '2099-01-01T03:02:00+03:00') || sameInstant('2099-01-01T00:02:00Z', '2099-01-01T00:02:01Z')) throw new Error('Semantic Git commit timestamp comparison is invalid');
  console.log('PASS semantic Git commit timestamp binding');
  rejectedCompletion('substituted elevated capability', { capability_artifact_path: 'copied-authorization.json' });
  if (!commitSandboxCompletionMismatch(phaseCommit, commitAuthorization, undefined, commitReport)) throw new Error('Missing elevated receipt was accepted');
  rejectedCompletion('incomplete elevated receipt', { status: 'created', completed_at: null, source_diff_status: 'pending' });
  rejectedCompletion('mismatched elevated commit report', {}, { commit_sha: 'f'.repeat(40) });
  rejectedCompletion('dirty elevated commit report', {}, { index_status: 'dirty' });
  const canonicalApprovalPath = canonicalCommitSandboxApprovalPath(runId);
  const approval = { run_id: runId, amendment_id: 'RUSHD-20260811-PHASE-COMMIT-SANDBOX-CONTINUATION', candidate_manifest_path: 'candidate.json' };
  const approvalManifest = { schema: 'rushd.patch-manifest.v1', patch_sha256: 'a'.repeat(64) };
  const seal = { rule: { approval: canonicalApprovalPath }, approval, approvedManifest: approvalManifest };
  if (commitSandboxApprovalMismatch(runId, canonicalApprovalPath, approval, approvalManifest, seal) !== null) throw new Error('Canonical enabling approval was rejected');
  if (!commitSandboxApprovalMismatch(runId, 'copied-approval.json', approval, approvalManifest, seal)) throw new Error('Copied enabling approval path was accepted');
  if (!commitSandboxApprovalMismatch(runId, canonicalApprovalPath, { ...approval, candidate_manifest_path: 'other.json' }, approvalManifest, seal)) throw new Error('Different valid enabling approval was accepted');
  if (!commitSandboxApprovalMismatch(runId, canonicalApprovalPath, approval, { ...approvalManifest, patch_sha256: 'f'.repeat(64) }, seal)) throw new Error('Substituted enabling approval manifest was accepted');
  if (commitSandboxBlockerParentMismatch(head, head) !== null || !commitSandboxBlockerParentMismatch('f'.repeat(40), head)) throw new Error('Blocker-era authority parent binding is invalid');
  console.log('PASS blocker binds to pre-amendment authority parent');
  console.log('PASS exact reviewed-phase commit sandbox capability');

  const portablePrecommitScope = [
    '.agents/skills/rushd-phase-orchestrator/SKILL.md',
    '.agents/skills/rushd-phase-orchestrator/scripts/self-test.mjs',
    '.agents/skills/rushd-phase-orchestrator/scripts/transition-state.mjs',
    '.agents/skills/rushd-phase-orchestrator/scripts/validate-artifact.mjs',
    '.agents/skills/rushd-phase-orchestrator/scripts/workflow-lib.mjs',
    'docs/RUSHD_EXECUTION_PROTOCOL.md',
    'docs/implementation/PLAN_AMENDMENT_2026-08-22_PORTABLE_PRECOMMIT_RECONCILIATION.json'
  ];
  const portablePrecommitRule = sealedAuthorityRule('RUSHD-20260822-PORTABLE-PRECOMMIT-RECONCILIATION', runId);
  if (!portablePrecommitRule) throw new Error('RUSHD-20260822-PORTABLE-PRECOMMIT-RECONCILIATION is absent from the sealed-authority allowlist');
  if (portablePrecommitRule.path !== 'docs/implementation/PLAN_AMENDMENT_2026-08-22_PORTABLE_PRECOMMIT_RECONCILIATION.json'
    || portablePrecommitRule.correctionApproval !== `${runRelative}/controller/authority-amendment-portable-precommit-reconciliation-correction-01-approval.json`
    || !sameJson([...portablePrecommitRule.paths].sort(), [...portablePrecommitScope].sort())) throw new Error('Sealed-authority allowlist entry does not bind the exact seven-file correction scope');
  const portablePrecommitAmendment = loadJson(portablePrecommitRule.path);
  if (portablePrecommitAmendment.amendment_id !== 'RUSHD-20260822-PORTABLE-PRECOMMIT-RECONCILIATION'
    || portablePrecommitAmendment.correction_revision !== 1
    || !sameJson([...portablePrecommitAmendment.protected_paths_to_change].sort(), [...portablePrecommitScope].sort())) throw new Error('Portable precommit correction amendment does not match the allowlisted seven-file scope');
  for (const path of portablePrecommitScope) if (!matchesAny(path, plan.protected_paths)) throw new Error(`Portable precommit correction path is not protected: ${path}`);
  console.log('PASS sealed-authority allowlist binds the portable precommit correction scope');

  const manifestScopeAmendmentScope = [
    '.agents/skills/rushd-phase-orchestrator/scripts/workflow-lib.mjs',
    '.agents/skills/rushd-phase-orchestrator/scripts/transition-state.mjs',
    '.agents/skills/rushd-phase-orchestrator/scripts/self-test.mjs',
    'docs/RUSHD_EXECUTION_PROTOCOL.md',
    'docs/implementation/PLAN_AMENDMENT_2026-08-23_RECONCILIATION_MANIFEST_SCOPE.json'
  ];
  const manifestScopeRule = sealedAuthorityRule('RUSHD-20260823-RECONCILIATION-MANIFEST-SCOPE', runId);
  if (!manifestScopeRule) throw new Error('RUSHD-20260823-RECONCILIATION-MANIFEST-SCOPE is absent from the sealed-authority allowlist');
  if (manifestScopeRule.path !== 'docs/implementation/PLAN_AMENDMENT_2026-08-23_RECONCILIATION_MANIFEST_SCOPE.json'
    || manifestScopeRule.approval !== `${runRelative}/controller/authority-amendment-reconciliation-manifest-scope-approval.json`
    || manifestScopeRule.correctionApproval !== undefined
    || !sameJson([...manifestScopeRule.paths].sort(), [...manifestScopeAmendmentScope].sort())) throw new Error('Sealed-authority allowlist entry does not bind the exact five-file reconciliation manifest scope');
  const manifestScopeAmendment = loadJson(manifestScopeRule.path);
  if (manifestScopeAmendment.amendment_id !== 'RUSHD-20260823-RECONCILIATION-MANIFEST-SCOPE'
    || manifestScopeAmendment.correction_revision !== undefined
    || manifestScopeAmendment.founder_decision.actor !== 'founder'
    || manifestScopeAmendment.founder_decision.status !== 'approved'
    || !manifestScopeAmendment.founder_decision.exact_scope.includes('Development Master')
    || !sameJson([...manifestScopeAmendment.protected_paths_to_change].sort(), [...manifestScopeAmendmentScope].sort())) throw new Error('Reconciliation manifest scope amendment does not match the allowlisted five-file scope');
  for (const path of manifestScopeAmendmentScope) if (!matchesAny(path, plan.protected_paths)) throw new Error(`Reconciliation manifest scope path is not protected: ${path}`);
  console.log('PASS sealed-authority allowlist binds the reconciliation manifest scope amendment');

  const scopeAffectedPaths = ['scripts/verify-manifest-scope-fixture.mjs'];
  const scopeCarriedEntry = { path: 'docs/baseline/manifest-scope-carried.txt', state: 'present', kind: 'file', executable: false, size: 32, sha256: 'a'.repeat(64) };
  const scopeAffectedPrior = { path: scopeAffectedPaths[0], state: 'present', kind: 'file', executable: false, size: 24, sha256: 'b'.repeat(64) };
  const scopeAffectedReplacement = { ...scopeAffectedPrior, size: 40, sha256: 'c'.repeat(64) };
  const scopeExpectMismatch = (name, result, pattern) => {
    if (result === null) throw new Error(`${name}: out-of-scope manifest drift was accepted`);
    if (!pattern.test(result)) throw new Error(`${name}: wrong mismatch description: ${result}`);
  };
  if (manifestScopeMismatch([scopeCarriedEntry, scopeAffectedPrior], [scopeCarriedEntry, scopeAffectedReplacement], scopeAffectedPaths) !== null) throw new Error('Unchanged carried files plus an approved affected-path change were rejected');
  scopeExpectMismatch('outside-path addition', manifestScopeMismatch([scopeCarriedEntry, scopeAffectedPrior], [scopeCarriedEntry, scopeAffectedReplacement, { path: 'docs/baseline/rogue.txt', state: 'present', kind: 'file', executable: false, size: 8, sha256: 'd'.repeat(64) }], scopeAffectedPaths), /adds a path outside affected_paths/);
  scopeExpectMismatch('outside-path byte change', manifestScopeMismatch([scopeCarriedEntry, scopeAffectedPrior], [{ ...scopeCarriedEntry, sha256: 'e'.repeat(64) }, scopeAffectedReplacement], scopeAffectedPaths), /changes a reviewed path outside affected_paths/);
  scopeExpectMismatch('outside-path size change', manifestScopeMismatch([scopeCarriedEntry, scopeAffectedPrior], [{ ...scopeCarriedEntry, size: 33 }, scopeAffectedReplacement], scopeAffectedPaths), /changes a reviewed path outside affected_paths/);
  scopeExpectMismatch('outside-path permission change', manifestScopeMismatch([scopeCarriedEntry, scopeAffectedPrior], [{ ...scopeCarriedEntry, executable: true }, scopeAffectedReplacement], scopeAffectedPaths), /changes a reviewed path outside affected_paths/);
  scopeExpectMismatch('outside-path metadata drift', manifestScopeMismatch([scopeCarriedEntry, scopeAffectedPrior], [{ ...scopeCarriedEntry, kind: 'symlink' }, scopeAffectedReplacement], scopeAffectedPaths), /changes a reviewed path outside affected_paths/);
  scopeExpectMismatch('missing expected reviewed file', manifestScopeMismatch([scopeCarriedEntry, scopeAffectedPrior], [scopeAffectedReplacement], scopeAffectedPaths), /drops a reviewed path outside affected_paths/);
  scopeExpectMismatch('empty affected paths', manifestScopeMismatch([scopeCarriedEntry], [scopeAffectedReplacement], []), /affected_paths is empty/);
  console.log('PASS reconciliation manifest-scope comparison regression cases');

  const priorRemediation = {
    status: 'regression_checking', remediation_round: 1, remediation_commit_sha: 'a'.repeat(40), remediation_commit_artifact_path: 'round-1.json', round_base_sha: 'b'.repeat(40), owner_commit_count_before: 1,
    required_regression_phases: ['P04', 'P05'], passed_regression_phases: ['P04'], regression_results: [{ artifact_path: 'p04-pass.json' }], failed_regression_results: [], active_regression_phase: 'P05'
  };
  const failedRecord = { artifact_path: 'p05-fail.json', artifact_sha256: 'c'.repeat(64), target_phase: 'P05', verdict: 'needs_changes', remediation_commit_sha: 'a'.repeat(40) };
  const retry = remediationAfterRegressionFailure(priorRemediation, failedRecord, 2);
  if (retry.status !== 'implementing' || retry.remediation_round !== 2 || retry.round_base_sha !== 'a'.repeat(40) || retry.owner_commit_count_before !== 2 || retry.remediation_commit_sha !== null || retry.remediation_commit_artifact_path !== null || retry.passed_regression_phases.length || retry.regression_results.length || retry.failed_regression_results.length !== 1 || retry.active_regression_phase !== null || retry.required_regression_phases.join(',') !== 'P04,P05') throw new Error('Regression correction did not preserve failure and reset the complete ordered gate');
  console.log('PASS failed regression starts additive remediation round and resets ordered gates');

  const evidencePath = `${runRelative}/evidence.txt`;
  writeFileSync(resolve(root, evidencePath), 'self-test evidence\n');
  const evidenceHash = sha256File(evidencePath);
  const statePath = `${runRelative}/state.json`;
  writeJson(resolve(root, statePath), {
    schema: 'rushd.run-state.v1',
    run_id: runId,
    plan_version: '2026-08-10-final',
    source_baseline_sha: head,
    authority_commit_sha: head,
    status: 'not_started',
    current_phase: 'P00',
    current_attempt: 0,
    active_worker: null,
    active_worker_receipt_path: null,
    active_reviewer: null,
    active_reviewer_receipt_path: null,
    active_final_audit_id: null,
    checkpoint_path: null,
    review_path: null,
    adjudication_path: null,
    worker_threads: {},
    review_attempts: {},
    escalations: {},
    base_sha: head,
    completed_phases: [],
    phase_commits: {},
    remediation: null,
    release_candidate_sha: null,
    final_audits: [],
    full_gate: null,
    publication_authority: null,
    post_deployment_verification: null,
    human_required: null,
    resume_state: null,
    paused_tasks: null,
    failure: null,
    unexplained_changes: [],
    state_revision: 0,
    genesis_state_sha256: null,
    previous_state_sha256: null,
    transition_journal_path: `${runRelative}/state.journal.jsonl`,
    updated_at: null
  });
  const stateValidation = run([validator, statePath]);
  if (stateValidation.status !== 0) throw new Error(`Initial state invalid: ${stateValidation.stderr}`);

  const wrongHashRequest = `${runRelative}/wrong-hash.json`;
  writeJson(resolve(root, wrongHashRequest), {
    schema: 'rushd.state-transition.v1', event_id: 'SELFTEST-WRONG-HASH', from: 'not_started', to: 'worker_running', transition_kind: 'start_phase', note: 'reject wrong hash',
    evidence: [evidencePath], evidence_hashes: { [evidencePath]: '0'.repeat(64) }, changes: {}
  });
  expectRejected('wrong transition evidence hash', run([validator, wrongHashRequest]), /hash mismatch/);

  const bulkRequest = `${runRelative}/bulk-forge.json`;
  writeJson(resolve(root, bulkRequest), {
    schema: 'rushd.state-transition.v1', event_id: 'SELFTEST-BULK-FORGE', from: 'not_started', to: 'worker_running', transition_kind: 'start_phase', note: 'reject bulk completion forge',
    evidence: [evidencePath], evidence_hashes: { [evidencePath]: evidenceHash },
    changes: { current_phase: 'P13', current_attempt: 1, active_worker: 'fake', active_worker_receipt_path: evidencePath, base_sha: head, completed_phases: ['P00'], phase_commits: {} }
  });
  expectRejected('bulk state mutation', run([transition, statePath, bulkRequest]), /Unexpected transition changes/);

  const attestationRoot = `${runRelative}/evidence/human/P99-M1`;
  mkdirSync(resolve(root, attestationRoot), { recursive: true });
  const attestationEvidence = `${attestationRoot}/proof.txt`;
  writeFileSync(resolve(root, attestationEvidence), 'fake human proof\n');
  const attestationPath = `${runRelative}/bad-attestation.json`;
  writeJson(resolve(root, attestationPath), {
    schema: 'rushd.human-attestation.v1', run_id: runId, phase_id: 'P99', gate_id: 'P99-M1', gate_kind: 'manual_qa', gate_request_sha256: '1'.repeat(64), actor: 'phase_implementer', actor_task_id: 'fake', performed_at: '2099-01-01T00:00:00Z', subject_sha: null,
    evidence_root: attestationRoot, evidence_hashes: { [attestationEvidence]: sha256File(attestationEvidence) }, environment: { device: 'fake', os: 'fake', browser: 'fake', browser_version: 'fake', locale: 'en' }, requirement: 'arbitrary', result: 'pass', evidence_paths: [attestationEvidence], limitations: []
  });
  expectRejected('unknown human gate', run([validator, attestationPath]), /phase is unknown|canonical phase gate/);

  const betaGate = plan.phases.find((phase) => phase.id === 'P13').mandatory_human_gates.find((gate) => gate.id === 'P13-BETA');
  const betaRoot = `${runRelative}/evidence/human/P13-BETA`;
  const betaProof = `${betaRoot}/proof.txt`;
  mkdirSync(resolve(root, betaRoot), { recursive: true });
  writeFileSync(resolve(root, betaProof), 'frozen synthetic beta evidence\n');
  const betaAttestationPath = `${betaRoot}/attestation.json`;
  const betaAttestation = {
    schema: 'rushd.human-attestation.v1', run_id: runId, phase_id: 'P13', gate_id: 'P13-BETA', gate_kind: 'external', gate_request_sha256: '2'.repeat(64), actor: 'founder', actor_task_id: 'founder-selftest', performed_at: '2099-02-01T00:00:00Z', subject_sha: null,
    period_started_at: '2099-01-01T00:00:00Z', period_ended_at: '2099-01-28T00:00:00Z', evidence_root: betaRoot, evidence_hashes: { [betaProof]: sha256File(betaProof) }, environment: { device: 'self-test', os: 'self-test', browser: 'self-test', browser_version: '1', locale: 'en' }, requirement: betaGate.requirement, result: 'pass', evidence_paths: [betaProof], limitations: []
  };
  writeJson(resolve(root, betaAttestationPath), betaAttestation);
  expectRejected('short P13 beta gate', run([validator, betaAttestationPath]), /duration is incomplete/);
  betaAttestation.period_ended_at = '2099-01-29T00:00:00Z';
  writeJson(resolve(root, betaAttestationPath), betaAttestation);
  const validBeta = run([validator, betaAttestationPath]);
  if (validBeta.status !== 0) throw new Error(`Valid four-week P13 beta gate rejected: ${validBeta.stderr}`);
  console.log('PASS mandatory four-week P13 beta gate');

  const publicationPath = `${runRelative}/bad-publication.json`;
  writeJson(resolve(root, publicationPath), {
    schema: 'rushd.publication-authority.v1', run_id: runId, release_sha: head, status: 'approved', actor: 'founder', actor_task_id: 'fake', approved_at: 'not-a-date', exact_scope: 'fake deployment', attestation_path: evidencePath, attestation_sha256: evidenceHash,
    evidence_root: runRelative, evidence_hashes: { [evidencePath]: evidenceHash }, deployment_targets: ['production'], evidence_paths: [evidencePath]
  });
  expectRejected('fabricated publication authority', run([validator, publicationPath]), /invalid|does not validate|must use/);

  const taskRoot = `${runRelative}/tasks`;
  mkdirSync(resolve(root, taskRoot), { recursive: true });
  const protocol = {
    threadRequest: { method: 'thread/start', id: 10, params: { model: 'gpt-5.6-sol', cwd: root, approvalPolicy: 'never', sandbox: 'workspace-write' } },
    threadResponse: { id: 10, result: { thread: { id: 'forged-other-thread', sessionId: 'forged-session' } } },
    turnRequest: { method: 'turn/start', id: 11, params: { threadId: 'forged-thread', input: [{ type: 'text', text: 'forged prompt' }], model: 'gpt-5.6-sol', effort: 'high', cwd: root, approvalPolicy: 'never', sandboxPolicy: { type: 'workspaceWrite' } } },
    turnResponse: { id: 11, result: { turn: { id: 'forged-turn', status: 'inProgress', items: [], error: null } } }
  };
  for (const [name, body] of Object.entries(protocol)) writeJson(resolve(root, `${taskRoot}/${name}.json`), body);
  const badReceiptPath = `${taskRoot}/bad-created-receipt.json`;
  writeJson(resolve(root, badReceiptPath), {
    schema: 'rushd.task-receipt.v1', run_id: runId, role: 'phase_worker', status: 'created', phase_id: 'P00', audit_id: null, attempt: 1,
    thread_id: 'forged-thread', session_id: 'forged-session', turn_id: 'forged-turn', model: 'gpt-5.6-sol', thinking: 'high', environment: 'local', adapter: 'app_server', thread_create_method: 'thread/start', source_sha: head,
    snapshot_patch_sha256: null, snapshot_manifest_path: null, worktree_path: null, created_at: '2099-01-01T00:00:00Z', completed_at: null, source_diff_status: 'pending',
    prompt_sha256: (await import('node:crypto')).createHash('sha256').update(JSON.stringify(protocol.turnRequest.params.input)).digest('hex'),
    thread_request_path: `${taskRoot}/threadRequest.json`, thread_request_sha256: sha256File(`${taskRoot}/threadRequest.json`),
    thread_response_path: `${taskRoot}/threadResponse.json`, thread_response_sha256: sha256File(`${taskRoot}/threadResponse.json`),
    turn_request_path: `${taskRoot}/turnRequest.json`, turn_request_sha256: sha256File(`${taskRoot}/turnRequest.json`),
    turn_response_path: `${taskRoot}/turnResponse.json`, turn_response_sha256: sha256File(`${taskRoot}/turnResponse.json`),
    lifecycle_parent_path: null, lifecycle_parent_sha256: null, turn_completed_path: null, turn_completed_sha256: null
  });
  expectRejected('forged App Server identity', run([validator, badReceiptPath]), /session\/start response does not match/);

  const portableProtocol = {
    sessionRequest: { method: 'session/start', id: 20, params: { model: 'glm-5.3', cwd: root, approvalPolicy: 'never', sandbox: 'workspace-write' } },
    sessionResponse: { id: 20, result: { session: { id: 'glm-thread', sessionId: 'glm-session' } } },
    turnRequest: { method: 'turn/start', id: 21, params: { sessionId: 'glm-thread', input: [{ type: 'text', text: 'Implement P00.' }], model: 'glm-5.3', effort: 'high', cwd: root, approvalPolicy: 'never', sandboxPolicy: { type: 'workspaceWrite' } } },
    turnResponse: { id: 21, result: { turn: { id: 'glm-turn', status: 'inProgress', items: [], error: null } } }
  };
  for (const [name, body] of Object.entries(portableProtocol)) writeJson(resolve(root, `${taskRoot}/portable-${name}.json`), body);
  const portablePromptHash = sha256Bytes(Buffer.from(JSON.stringify(portableProtocol.turnRequest.params.input)));
  const portableReceiptPath = `${taskRoot}/portable-created-receipt.json`;
  const portableReceiptFields = {
    schema: 'rushd.task-receipt.v1', run_id: runId, role: 'phase_worker', status: 'created', phase_id: 'P00', audit_id: null, attempt: 1,
    thread_id: 'glm-thread', session_id: 'glm-session', turn_id: 'glm-turn', model: 'glm-5.3', thinking: 'high', environment: 'local',
    adapter: 'zcode_glm', thread_create_method: 'session/start', source_sha: head, snapshot_patch_sha256: null, snapshot_manifest_path: null,
    worktree_path: null, created_at: '2099-01-01T00:04:00Z', completed_at: null, source_diff_status: 'pending', prompt_sha256: portablePromptHash,
    thread_request_path: `${taskRoot}/portable-sessionRequest.json`, thread_request_sha256: sha256File(resolve(root, `${taskRoot}/portable-sessionRequest.json`)),
    thread_response_path: `${taskRoot}/portable-sessionResponse.json`, thread_response_sha256: sha256File(resolve(root, `${taskRoot}/portable-sessionResponse.json`)),
    turn_request_path: `${taskRoot}/portable-turnRequest.json`, turn_request_sha256: sha256File(resolve(root, `${taskRoot}/portable-turnRequest.json`)),
    turn_response_path: `${taskRoot}/portable-turnResponse.json`, turn_response_sha256: sha256File(resolve(root, `${taskRoot}/portable-turnResponse.json`)),
    lifecycle_parent_path: null, lifecycle_parent_sha256: null, turn_completed_path: null, turn_completed_sha256: null
  };
  writeJson(resolve(root, portableReceiptPath), portableReceiptFields);
  const portableValidation = run([validator, portableReceiptPath]);
  if (portableValidation.status !== 0) throw new Error(`Valid ZCode/GLM receipt rejected: ${portableValidation.stderr}`);
  console.log('PASS exact ZCode/GLM lifecycle receipt');
  writeJson(resolve(root, portableReceiptPath), { ...portableReceiptFields, thread_id: 'other-thread' });
  expectRejected('forged ZCode/GLM identity', run([validator, portableReceiptPath]), /session\/start response does not match/);

  const reconciliationRoot = `${runRelative}/evidence/precommit-reconciliation`;
  mkdirSync(resolve(root, reconciliationRoot), { recursive: true });
  const failingLogPath = `${reconciliationRoot}/npm-test-failure.log`;
  const failureSignature = 'HEAD is not the approved external-continuation authority overlay';
  writeFileSync(resolve(root, failingLogPath), `${failureSignature}\n`);
  let priorCheckpointPath;
  let priorReviewPath;
  let portableRunId;
  let portableWorkerTaskRoot;
  let portableWorkerCompletedPath;
  let portableWorkerCreatedPath;
  let portableRoot;
  let patchedBytes;
  let carriedPath;
  let affectedPath;
  let affectedPriorBytes;
  let affectedReplacementBytes;
  let manifestEntryFor;
  {
  portableRunId = `rushd-20990101-portable-${process.pid}`;
  portableRoot = `.codex/runs/${portableRunId}`;
  mkdirSync(resolve(root, portableRoot), { recursive: true });
  mkdirSync(resolve(root, `${portableRoot}/phases/P00`), { recursive: true });
  carriedPath = `scripts/.verify-p00-baseline-selftest-${process.pid}.mjs`;
  patchedBytes = Buffer.from('self-contained P00 reconciliation fixture\n');
  affectedPath = 'scripts/verify-p00-baseline.mjs';
  affectedPriorBytes = Buffer.from('prior reviewed authority-chain assertion\n');
  affectedReplacementBytes = Buffer.from('reconciled authority-chain assertion v2\n');
  manifestEntryFor = (path, bytes) => ({ path, state: 'present', kind: 'file', executable: false, size: bytes.length, sha256: sha256Bytes(bytes) });
  const portableManifestCore = {
    schema: 'rushd.patch-manifest.v1', base_sha: head,
    files: [
      manifestEntryFor(carriedPath, patchedBytes),
      manifestEntryFor(affectedPath, affectedPriorBytes)
    ].sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)))
  };
  const portablePatchSha = sha256Bytes(Buffer.from(JSON.stringify(portableManifestCore)));
  const portableManifestPath = `${portableRoot}/patch.json`;
  writeJson(resolve(root, portableManifestPath), { ...portableManifestCore, patch_sha256: portablePatchSha });
  const workerEvidenceRoot = `${portableRoot}/evidence/P00/worker-attempt-01`;
  mkdirSync(resolve(root, workerEvidenceRoot), { recursive: true });
  const workerProtocolEvidence = `${workerEvidenceRoot}/gate-evidence.txt`;
  writeFileSync(resolve(root, workerProtocolEvidence), 'synthetic immutable P00 gate evidence\n');
  const workerCommandLog = `${workerEvidenceRoot}/npm-test.log`;
  writeFileSync(resolve(root, workerCommandLog), 'synthetic passing P00 command log\n');
  const workerTaskRoot = `${portableRoot}/tasks/portable-worker`;
  portableWorkerTaskRoot = workerTaskRoot;
  mkdirSync(resolve(root, workerTaskRoot), { recursive: true });
  const workerPrompt = [{ type: 'text', text: 'Implement the portable P00 fixture.' }];
  const workerProtocol = {
    sessionRequest: { method: 'session/start', id: 30, params: { model: 'glm-5.3', cwd: root, approvalPolicy: 'never', sandbox: 'workspace-write' } },
    sessionResponse: { id: 30, result: { session: { id: 'fixture-worker', sessionId: 'fixture-worker-session' } } },
    turnRequest: { method: 'turn/start', id: 31, params: { sessionId: 'fixture-worker', input: workerPrompt, model: 'glm-5.3', effort: 'high', cwd: root, approvalPolicy: 'never', sandboxPolicy: { type: 'workspaceWrite' } } },
    turnResponse: { id: 31, result: { turn: { id: 'fixture-worker-turn', status: 'inProgress', items: [], error: null } } }
  };
  for (const [name, body] of Object.entries(workerProtocol)) writeJson(resolve(root, `${workerTaskRoot}/${name}.json`), body);
  const workerBase = {
    schema: 'rushd.task-receipt.v1', run_id: portableRunId, role: 'phase_worker', phase_id: 'P00', audit_id: null, attempt: 1,
    thread_id: 'fixture-worker', session_id: 'fixture-worker-session', turn_id: 'fixture-worker-turn', model: 'glm-5.3', thinking: 'high',
    environment: 'local', adapter: 'zcode_glm', thread_create_method: 'session/start', source_sha: head,
    snapshot_patch_sha256: null, snapshot_manifest_path: null, worktree_path: null, prompt_sha256: sha256Bytes(Buffer.from(JSON.stringify(workerPrompt))),
    thread_request_path: `${workerTaskRoot}/sessionRequest.json`, thread_response_path: `${workerTaskRoot}/sessionResponse.json`,
    turn_request_path: `${workerTaskRoot}/turnRequest.json`, turn_response_path: `${workerTaskRoot}/turnResponse.json`,
    thread_request_sha256: sha256File(`${workerTaskRoot}/sessionRequest.json`), thread_response_sha256: sha256File(`${workerTaskRoot}/sessionResponse.json`),
    turn_request_sha256: sha256File(`${workerTaskRoot}/turnRequest.json`), turn_response_sha256: sha256File(`${workerTaskRoot}/turnResponse.json`),
    capability_scope: 'none', capability_artifact_path: `${workerTaskRoot}/sessionRequest.json`, capability_artifact_sha256: sha256File(`${workerTaskRoot}/sessionRequest.json`)
  };
  const workerCreatedPath = `${workerTaskRoot}/created.json`;
  portableWorkerCreatedPath = workerCreatedPath;
  writeJson(resolve(root, workerCreatedPath), { ...workerBase, status: 'created', created_at: '2099-01-01T00:00:00Z', completed_at: null, source_diff_status: 'pending', lifecycle_parent_path: null, lifecycle_parent_sha256: null, turn_completed_path: null, turn_completed_sha256: null });
  const workerCompletionPath = `${workerTaskRoot}/completed-event.json`;
  writeJson(resolve(root, workerCompletionPath), { method: 'turn/completed', params: { sessionId: 'fixture-worker', turn: { id: 'fixture-worker-turn', status: 'completed' } } });
  const workerCompletedPath = `${workerTaskRoot}/completed.json`;
  portableWorkerCompletedPath = workerCompletedPath;
  writeJson(resolve(root, workerCompletedPath), {
    ...workerBase, status: 'completed', created_at: '2099-01-01T00:00:00Z', completed_at: '2099-01-01T00:01:00Z', source_diff_status: 'explained',
    lifecycle_parent_path: workerCreatedPath, lifecycle_parent_sha256: sha256File(workerCreatedPath),
    turn_completed_path: workerCompletionPath, turn_completed_sha256: sha256File(workerCompletionPath)
  });
  const humanRoot = `${portableRoot}/evidence/human/P00-M1`;
  mkdirSync(resolve(root, humanRoot), { recursive: true });
  const humanProof = `${humanRoot}/proof.txt`;
  writeFileSync(resolve(root, humanProof), 'synthetic fake-data manual QA proof\n');
  const planFixture = readPlan();
  const manualRequirement = planFixture.phases.find((phase) => phase.id === 'P00').manual_qa[0];
  const attestationPath = `${humanRoot}/attestation.json`;
  writeJson(resolve(root, attestationPath), {
    schema: 'rushd.human-attestation.v1', run_id: portableRunId, phase_id: 'P00', gate_id: 'P00-M1', gate_kind: 'manual_qa', gate_request_sha256: sha256Bytes(Buffer.from(manualRequirement)),
    actor: 'founder', actor_task_id: 'fixture-founder', performed_at: '2099-01-01T00:02:00Z', subject_sha: null, period_started_at: null, period_ended_at: null,
    evidence_root: humanRoot, evidence_hashes: { [humanProof]: sha256File(humanProof) },
    environment: { device: 'fixture', os: 'fixture', browser: 'fixture', browser_version: '1', locale: 'en' }, requirement: manualRequirement,
    result: 'pass', evidence_paths: [humanProof], limitations: []
  });
  const acceptanceIds = planFixture.phases.find((phase) => phase.id === 'P00').acceptance.map((item) => item.id);
  priorCheckpointPath = `${portableRoot}/phases/P00/checkpoint.json`;
  writeJson(resolve(root, priorCheckpointPath), {
    schema: 'rushd.phase-checkpoint.v1', run_id: portableRunId, phase_id: 'P00', attempt: 1, status: 'ready_for_review', base_sha: head,
    patch_sha256: portablePatchSha, patch_manifest_path: portableManifestPath, worker_receipt_path: workerCompletedPath, evidence_root: workerEvidenceRoot,
    evidence_hashes: { [workerProtocolEvidence]: sha256File(workerProtocolEvidence) },
    changed_files: [
      { path: carriedPath, change: 'modified', purpose: 'Carried reviewed reconciliation fixture.' },
      { path: affectedPath, change: 'modified', purpose: 'Prior reviewed authority-chain assertion.' }
    ],
    acceptance: acceptanceIds.map((id) => ({ id, status: 'pass', evidence: [workerProtocolEvidence] })),
    commands: [{ command: 'npm test', exit_code: 0, summary: 'Synthetic complete gate passed.', log_path: workerCommandLog, log_sha256: sha256File(workerCommandLog), started_at: '2099-01-01T00:00:30Z', finished_at: '2099-01-01T00:00:40Z', cwd: root, runner_task_id: 'fixture-worker' }],
    manual_qa: [{ requirement: manualRequirement, status: 'pass', attestation_path: attestationPath, attestation_sha256: sha256File(attestationPath) }],
    mandatory_human_gates: [], risks: [], deviations: [], blocking_questions: [], unrelated_changes_observed: []
  });
  const reviewEvidenceRoot = `${portableRoot}/evidence/P00/review-attempt-01`;
  mkdirSync(resolve(root, reviewEvidenceRoot), { recursive: true });
  const reviewCommandLog = `${reviewEvidenceRoot}/npm-test.log`;
  writeFileSync(resolve(root, reviewCommandLog), 'independent synthetic review gate passed\n');
  const planForReview = readPlan();
  const reviewAcceptanceIds = planForReview.phases.find((phase) => phase.id === 'P00').acceptance.map((item) => item.id);
  const reviewCheckEvidence = reviewAcceptanceIds.map((id) => {
    const path = `${reviewEvidenceRoot}/${id}.txt`;
    writeFileSync(resolve(root, path), `Independent synthetic evidence for ${id}\n`);
    return path;
  });
  const reviewerTaskRoot = `${portableRoot}/tasks/portable-reviewer`;
  mkdirSync(resolve(root, reviewerTaskRoot), { recursive: true });
  const reviewerPrompt = [{ type: 'text', text: 'Independently review the portable P00 fixture.' }];
  const reviewerWorktree = '/private/tmp/rushd-portable-fixture-review';
  const reviewerProtocol = {
    sessionRequest: { method: 'session/start', id: 32, params: { model: 'glm-5.3', cwd: reviewerWorktree, approvalPolicy: 'never', sandbox: 'workspace-write' } },
    sessionResponse: { id: 32, result: { session: { id: 'fixture-reviewer', sessionId: 'fixture-reviewer-session' } } },
    turnRequest: { method: 'turn/start', id: 33, params: { sessionId: 'fixture-reviewer', input: reviewerPrompt, model: 'glm-5.3', effort: 'high', cwd: reviewerWorktree, approvalPolicy: 'never', sandboxPolicy: { type: 'workspaceWrite' } } },
    turnResponse: { id: 33, result: { turn: { id: 'fixture-reviewer-turn', status: 'inProgress', items: [], error: null } } }
  };
  for (const [name, body] of Object.entries(reviewerProtocol)) writeJson(resolve(root, `${reviewerTaskRoot}/${name}.json`), body);
  const reviewerBase = {
    ...workerBase, role: 'phase_reviewer', thread_id: 'fixture-reviewer', session_id: 'fixture-reviewer-session', turn_id: 'fixture-reviewer-turn',
    environment: 'worktree', snapshot_patch_sha256: portablePatchSha, snapshot_manifest_path: portableManifestPath, worktree_path: reviewerWorktree,
    prompt_sha256: sha256Bytes(Buffer.from(JSON.stringify(reviewerPrompt))),
    thread_request_path: `${reviewerTaskRoot}/sessionRequest.json`, thread_response_path: `${reviewerTaskRoot}/sessionResponse.json`,
    turn_request_path: `${reviewerTaskRoot}/turnRequest.json`, turn_response_path: `${reviewerTaskRoot}/turnResponse.json`,
    thread_request_sha256: sha256File(`${reviewerTaskRoot}/sessionRequest.json`), thread_response_sha256: sha256File(`${reviewerTaskRoot}/sessionResponse.json`),
    turn_request_sha256: sha256File(`${reviewerTaskRoot}/turnRequest.json`), turn_response_sha256: sha256File(`${reviewerTaskRoot}/turnResponse.json`),
    capability_artifact_path: `${reviewerTaskRoot}/sessionRequest.json`, capability_artifact_sha256: sha256File(`${reviewerTaskRoot}/sessionRequest.json`)
  };
  const reviewerCreatedPath = `${reviewerTaskRoot}/created.json`;
  writeJson(resolve(root, reviewerCreatedPath), { ...reviewerBase, status: 'created', created_at: '2099-01-01T00:03:00Z', completed_at: null, source_diff_status: 'pending', lifecycle_parent_path: null, lifecycle_parent_sha256: null, turn_completed_path: null, turn_completed_sha256: null });
  const reviewerCompletionPath = `${reviewerTaskRoot}/completed-event.json`;
  writeJson(resolve(root, reviewerCompletionPath), { method: 'turn/completed', params: { sessionId: 'fixture-reviewer', turn: { id: 'fixture-reviewer-turn', status: 'completed' } } });
  const reviewerCompletedPath = `${reviewerTaskRoot}/completed.json`;
  writeJson(resolve(root, reviewerCompletedPath), {
    ...reviewerBase, status: 'completed', created_at: '2099-01-01T00:03:00Z', completed_at: '2099-01-01T00:04:00Z', source_diff_status: 'clean',
    lifecycle_parent_path: reviewerCreatedPath, lifecycle_parent_sha256: sha256File(reviewerCreatedPath), turn_completed_path: reviewerCompletionPath, turn_completed_sha256: sha256File(reviewerCompletionPath)
  });
  priorReviewPath = `${portableRoot}/phases/P00/review.json`;
  writeJson(resolve(root, priorReviewPath), {
    schema: 'rushd.phase-review.v1', run_id: portableRunId, phase_id: 'P00', attempt: 1, checkpoint_patch_sha256: portablePatchSha, verdict: 'pass',
    confidence: 'high', next_action: 'advance', reviewer_source_diff: 'clean', reviewer_receipt_path: reviewerCompletedPath, evidence_root: reviewEvidenceRoot,
    evidence_hashes: Object.fromEntries(reviewCheckEvidence.map((path) => [path, sha256File(path)])),
    commands: [{ command: 'npm test', exit_code: 0, summary: 'Independent synthetic gate passed.', log_path: reviewCommandLog, log_sha256: sha256File(reviewCommandLog), started_at: '2099-01-01T00:03:10Z', finished_at: '2099-01-01T00:03:20Z', cwd: root, runner_task_id: 'fixture-reviewer' }],
    checks: reviewAcceptanceIds.map((id, index) => ({ id, status: 'pass', evidence: [reviewCheckEvidence[index]] })),
    findings: [], non_blocking_suggestions: []
  });
  }
  const reconciliationFields = {
    schema: 'rushd.precommit-reconciliation.v1', run_id: portableRunId, phase_id: 'P00', amendment_id: 'RUSHD-20260822-PORTABLE-PRECOMMIT-RECONCILIATION',
    prior_attempt: 1, prior_checkpoint_path: priorCheckpointPath, prior_checkpoint_sha256: sha256File(priorCheckpointPath),
    prior_review_path: priorReviewPath, prior_review_sha256: sha256File(priorReviewPath), failing_log_path: failingLogPath,
    failing_log_sha256: sha256File(failingLogPath), failure_signature: 'HEAD is not the approved external-continuation authority overlay',
    failing_summary: 'The sealed later authority tip moved after the reviewed verifier froze an older authority chain.',
    affected_paths: ['scripts/verify-p00-baseline.mjs'], current_head_sha: head, created_at: '2099-01-01T00:05:00Z'
  };
  const reconciliationPath = `${reconciliationRoot}/record.json`;
  writeJson(resolve(root, reconciliationPath), reconciliationFields);
  const reconciliationValidation = run([validator, reconciliationPath]);
  if (reconciliationValidation.status !== 0) throw new Error(`Valid pre-commit reconciliation rejected: ${reconciliationValidation.stderr}`);
  console.log('PASS exact pre-commit reconciliation record');
  writeJson(resolve(root, reconciliationPath), { ...reconciliationFields, prior_review_sha256: '0'.repeat(64) });
  expectRejected('stale PASS substitution', run([validator, reconciliationPath]), /PASS artifact hash mismatch/);
  writeJson(resolve(root, reconciliationPath), { ...reconciliationFields, affected_paths: ['index.html'] });
  expectRejected('pre-commit scope expansion', run([validator, reconciliationPath]), /outside the phase allowlist/);

  writeJson(resolve(root, reconciliationPath), reconciliationFields);
  const reopenTaskRoot = `${portableRoot}/tasks/portable-worker-reopen`;
  const reopenCreatedPath = `${reopenTaskRoot}/created.json`;
  mkdirSync(resolve(root, reopenTaskRoot), { recursive: true });
  writeJson(resolve(root, reopenCreatedPath), { ...loadJson(portableWorkerCreatedPath), attempt: 2 });
  const pausedStatePath = `${portableRoot}/paused-state.json`;
  const pausedState = {
    schema: 'rushd.run-state.v1', run_id: portableRunId, plan_version: plan.plan_version,
    source_baseline_sha: execFileSync('git', ['rev-parse', 'HEAD^'], { encoding: 'utf8' }).trim(), authority_commit_sha: head,
    status: 'passed_pending_commit', current_phase: 'P00', current_attempt: 1, active_worker: 'fixture-worker',
    active_worker_receipt_path: portableWorkerCompletedPath, active_reviewer: null, active_reviewer_receipt_path: null,
    active_final_audit_id: null, checkpoint_path: priorCheckpointPath, review_path: priorReviewPath, adjudication_path: null,
    worker_threads: {}, review_attempts: {}, escalations: {}, phase_commits: {}, base_sha: head, completed_phases: [],
    remediation: null, release_candidate_sha: null, final_audits: [], full_gate: null, publication_authority: null,
    post_deployment_verification: null, human_required: null, resume_state: null, paused_tasks: null, failure: null,
    unexplained_changes: [], state_revision: 0, genesis_state_sha256: null, previous_state_sha256: null,
    transition_journal_path: `${portableRoot}/state.journal.jsonl`, updated_at: null
  };
  writeJson(resolve(root, pausedStatePath), pausedState);
  if (run([validator, pausedStatePath]).status !== 0) throw new Error('Portable passed-pending-commit fixture was rejected');
  const reopenReceipt = loadJson(reopenCreatedPath);
  const reconciliationEvidence = [reconciliationPath, reopenCreatedPath, portableWorkerCompletedPath, priorCheckpointPath, priorReviewPath, reopenReceipt.thread_request_path, reopenReceipt.thread_response_path, reopenReceipt.turn_request_path, reopenReceipt.turn_response_path];
  const reconciliationTransitionBase = {
    schema: 'rushd.state-transition.v1', event_id: 'SELFTEST-PRECOMMIT-RECONCILIATION', from: 'passed_pending_commit',
    to: 'worker_running', transition_kind: 'precommit_reconciliation', note: 'exercise exact precommit reopen',
    reconciliation_record_path: reconciliationPath,
    evidence: [...reconciliationEvidence], evidence_hashes: Object.fromEntries(reconciliationEvidence.map((path) => [path, sha256File(path)])),
    changes: {
      current_attempt: 2, active_worker_receipt_path: reopenCreatedPath, checkpoint_path: null, review_path: null,
      adjudication_path: null, precommit_reconciliation: { record_path: reconciliationPath, record_sha256: sha256File(reconciliationPath), affected_paths: reconciliationFields.affected_paths }
    }
  };
  expectRejected('precommit unexpected change', run([transition, pausedStatePath, (() => {
    const path = `${reconciliationRoot}/unexpected-change.json`;
    writeJson(path, { ...reconciliationTransitionBase, changes: { ...reconciliationTransitionBase.changes, current_attempt: 3 } });
    return path;
  })()]), /Unexpected transition changes|current_attempt/);
  expectRejected('precommit missing record evidence', run([transition, pausedStatePath, (() => {
    const path = `${reconciliationRoot}/missing-evidence.json`;
    writeJson(path, { ...reconciliationTransitionBase, evidence: reconciliationEvidence.slice(1), evidence_hashes: Object.fromEntries(reconciliationEvidence.slice(1).map((path) => [path, sha256File(path)])) });
    return path;
  })()]), /Transition evidence omits/);
  expectRejected('precommit substituted record', run([transition, pausedStatePath, (() => {
    const path = `${reconciliationRoot}/substituted-record.json`;
    const request = structuredClone(reconciliationTransitionBase);
    const substitutedPath = `${portableRoot}/tasks/portable-reviewer/created.json`;
    request.reconciliation_record_path = substitutedPath;
    request.evidence = request.evidence.map((item) => (item === reconciliationPath ? substitutedPath : item));
    request.evidence_hashes = Object.fromEntries(request.evidence.map((item) => [item, sha256File(item)]));
    request.changes.precommit_reconciliation.record_path = `${portableRoot}/tasks/portable-reviewer/created.json`;
    request.changes.precommit_reconciliation.record_sha256 = sha256File(substitutedPath);
    writeJson(path, request);
    return path;
  })()]), /must use rushd.precommit-reconciliation.v1|schema/);
  writeJson(resolve(root, reconciliationPath), { ...reconciliationFields, current_head_sha: execFileSync('git', ['rev-parse', 'HEAD^'], { encoding: 'utf8' }).trim() });
  const staleHeadPath = `${reconciliationRoot}/stale-head.json`;
  const staleHeadRequest = structuredClone(reconciliationTransitionBase);
  staleHeadRequest.evidence_hashes[reconciliationPath] = sha256File(reconciliationPath);
  staleHeadRequest.changes.precommit_reconciliation.record_sha256 = sha256File(reconciliationPath);
  writeJson(resolve(root, staleHeadPath), staleHeadRequest);
  expectRejected('precommit stale HEAD', run([transition, pausedStatePath, staleHeadPath]), /Reconciliation head is invalid|does not match the paused phase\/head/);
  writeJson(resolve(root, reconciliationPath), reconciliationFields);
  const wrongWorkerRequest = structuredClone(reconciliationTransitionBase);
  wrongWorkerRequest.event_id = 'SELFTEST-PRECOMMIT-WORKER';
  wrongWorkerRequest.changes.active_worker_receipt_path = `${portableRoot}/tasks/portable-reviewer/created.json`;
  expectRejected('precommit worker substitution', run([transition, pausedStatePath, (() => {
    const path = `${reconciliationRoot}/wrong-worker.json`;
    writeJson(path, wrongWorkerRequest);
    return path;
  })()]), /Pre-commit reconciliation must reuse|Receipt role phase_reviewer/);
  const reopenedTransitionPath = `${reconciliationRoot}/transition.json`;
  writeJson(resolve(root, reopenedTransitionPath), reconciliationTransitionBase);
  const reopenedResult = run([transition, pausedStatePath, reopenedTransitionPath]);
  if (reopenedResult.status !== 0) throw new Error(`Valid precommit reconciliation transition failed:\n${reopenedResult.stdout}\n${reopenedResult.stderr}`);
  const reopenedState = loadJson(pausedStatePath);
  if (reopenedState.current_attempt !== 2 || reopenedState.checkpoint_path !== null || reopenedState.review_path !== null || !reopenedState.precommit_reconciliation) throw new Error('Precommit reopen did not bind the replacement attempt');
  console.log('PASS journaled precommit reconciliation reopen');

  const followupTaskRoot = `${portableRunId.startsWith('.') ? '' : ''}.codex/runs/${portableRunId}/tasks/portable-worker-attempt-2`;
  const followupCreatedPath = `${followupTaskRoot}/created.json`;
  const followupCompletedPath = `${followupTaskRoot}/completed.json`;
  const followupCompletionPath = `${followupTaskRoot}/completed-event.json`;
  mkdirSync(resolve(root, followupTaskRoot), { recursive: true });
  writeJson(resolve(root, followupCreatedPath), { ...loadJson(portableWorkerCreatedPath), attempt: 2 });
  writeJson(resolve(root, followupCompletionPath), { method: 'turn/completed', params: { sessionId: 'fixture-worker', turn: { id: 'fixture-worker-turn', status: 'completed' } } });
  const originalWorkerCreated = loadJson(portableWorkerCreatedPath);
  writeJson(resolve(root, followupCompletedPath), {
    ...originalWorkerCreated, attempt: 2, status: 'completed', completed_at: '2099-01-01T00:06:00Z', source_diff_status: 'explained',
    lifecycle_parent_path: followupCreatedPath, lifecycle_parent_sha256: sha256File(followupCreatedPath),
    turn_completed_path: followupCompletionPath, turn_completed_sha256: sha256File(followupCompletionPath)
  });
  const carriedReplacementEntry = () => manifestEntryFor(carriedPath, patchedBytes);
  const rogueEntry = manifestEntryFor('docs/baseline/selftest-extra.txt', Buffer.from('unapproved phase-owned expansion fixture\n'));
  const replacementManifestFor = (variant) => {
    const files = [];
    if (variant !== 'drop-carried') {
      files.push(variant === 'carried-drift' ? { ...carriedReplacementEntry(), sha256: 'f'.repeat(64), size: 999 } : carriedReplacementEntry());
    }
    files.push(manifestEntryFor(affectedPath, affectedReplacementBytes));
    if (variant === 'rogue-add') files.push(rogueEntry);
    files.sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
    return { schema: 'rushd.patch-manifest.v1', base_sha: head, files };
  };
  const replacementCheckpointFor = (variant) => {
    const core = replacementManifestFor(variant);
    const patchSha = sha256Bytes(Buffer.from(JSON.stringify(core)));
    const manifestPath = `${portableRoot}/phases/P00/patch-attempt-02-${variant}.json`;
    writeJson(resolve(root, manifestPath), { ...core, patch_sha256: patchSha });
    const checkpoint = structuredClone(loadJson(priorCheckpointPath));
    const replacementEvidenceRoot = `${portableRoot}/evidence/P00/worker-attempt-02`;
    mkdirSync(resolve(root, replacementEvidenceRoot), { recursive: true });
    for (const name of ['gate-evidence.txt', 'npm-test.log']) {
      writeFileSync(resolve(root, replacementEvidenceRoot, name), readFileSync(resolve(root, portableRoot, 'evidence/P00/worker-attempt-01', name)));
    }
    checkpoint.evidence_root = replacementEvidenceRoot;
    checkpoint.evidence_hashes = Object.fromEntries(Object.keys(checkpoint.evidence_hashes).map((oldPath) => [
      `${replacementEvidenceRoot}/${oldPath.split('/').at(-1)}`,
      sha256File(`${replacementEvidenceRoot}/${oldPath.split('/').at(-1)}`)
    ]));
    checkpoint.acceptance = checkpoint.acceptance.map((item) => ({
      ...item,
      evidence: item.evidence.map((oldPath) => `${replacementEvidenceRoot}/${oldPath.split('/').at(-1)}`)
    }));
    checkpoint.commands = checkpoint.commands.map((command) => ({ ...command, log_path: `${replacementEvidenceRoot}/npm-test.log`, log_sha256: sha256File(`${replacementEvidenceRoot}/npm-test.log`) }));
    checkpoint.attempt = 2;
    checkpoint.patch_sha256 = patchSha;
    checkpoint.patch_manifest_path = manifestPath;
    checkpoint.worker_receipt_path = followupCompletedPath;
    checkpoint.changed_files = core.files.map((file) => ({
      path: file.path,
      change: file.path === affectedPath ? 'modified' : 'modified',
      purpose: file.path === affectedPath
        ? 'Approved reconciliation of the authority-chain assertion.'
        : `Carried reviewed patch file ${file.path}.`
    }));
    const path = `${portableRoot}/phases/P00/checkpoint-attempt-02-${variant}.json`;
    writeJson(resolve(root, path), checkpoint);
    return path;
  };
  const readyTransitionFor = (checkpointPath, eventId, clearLink = true) => {
    const changes = { checkpoint_path: checkpointPath, active_worker_receipt_path: followupCompletedPath };
    if (clearLink) changes.precommit_reconciliation = null;
    const followupReceipt = loadJson(followupCompletedPath);
    const evidence = [
      checkpointPath, loadJson(checkpointPath).patch_manifest_path, followupCompletedPath,
      followupReceipt.thread_request_path, followupReceipt.thread_response_path,
      followupReceipt.turn_request_path, followupReceipt.turn_response_path,
      followupCreatedPath, followupCompletionPath
    ];
    return {
      schema: 'rushd.state-transition.v1', event_id: eventId, from: 'worker_running', to: 'ready_for_review',
      transition_kind: 'checkpoint_ready', note: 'bind replacement checkpoint manifest scope',
      evidence, evidence_hashes: Object.fromEntries(evidence.map((path) => [path, sha256File(path)])),
      changes
    };
  };
  const rejectReady = (name, variant, pattern, eventId, clearLink = true) => {
    const checkpointPath = replacementCheckpointFor(variant);
    const requestPath = `${portableRoot}/phases/P00/ready-${variant}${clearLink ? '' : '-uncleared'}.json`;
    writeJson(resolve(root, requestPath), readyTransitionFor(checkpointPath, eventId, clearLink));
    expectRejected(name, run([transition, pausedStatePath, requestPath]), pattern);
  };
  rejectReady('reconciliation outside-path manifest addition', 'rogue-add', /adds a path outside affected_paths/, 'SELFTEST-PRECOMMIT-ROGUE-ADD');
  rejectReady('reconciliation carried-file byte drift', 'carried-drift', /changes a reviewed path outside affected_paths/, 'SELFTEST-PRECOMMIT-CARRIED-DRIFT');
  rejectReady('reconciliation missing reviewed carried file', 'drop-carried', /drops a reviewed path outside affected_paths/, 'SELFTEST-PRECOMMIT-DROP-CARRIED');
  rejectReady('reconciliation acceptance without clearing the state link', 'good', /must clear the hash-bound state link/, 'SELFTEST-PRECOMMIT-UNCLEARED', false);
  const carriedScopeCheckpointPath = replacementCheckpointFor('good');
  const carriedScopeRequestPath = `${portableRoot}/phases/P00/ready-carried-scope.json`;
  writeJson(resolve(root, carriedScopeRequestPath), readyTransitionFor(carriedScopeCheckpointPath, 'SELFTEST-PRECOMMIT-CARRIED-SCOPE'));
  const carriedScopeResult = run([transition, pausedStatePath, carriedScopeRequestPath]);
  if (carriedScopeResult.status === 0) throw new Error('Carried-patch checkpoint unexpectedly completed full validation in the shared checkout');
  if (/outside affected_paths|unapproved path/.test(`${carriedScopeResult.stdout}\n${carriedScopeResult.stderr}`)) throw new Error(`Carried reviewed files were rejected at the scope gate:\n${carriedScopeResult.stdout}\n${carriedScopeResult.stderr}`);
  console.log('PASS carried reviewed patch passes the manifest-scope gate');

  const scopeScratchRunId = `rushd-20990101-manifest-scope-${process.pid}`;
  const scopeTestRoot = mkdtempSync(join(tmpdir(), 'rushd-manifest-scope-'));
  try {
    const scopeRelative = `.codex/runs/${scopeScratchRunId}`;
    const scopeGit = (...args) => execFileSync('git', args, { cwd: scopeTestRoot, encoding: 'utf8' }).trim();
    const scopeNode = (args) => spawnSync(process.execPath, args, { cwd: scopeTestRoot, encoding: 'utf8' });
    const scopePath = (relative) => resolve(scopeTestRoot, relative);
    const scopeWriteFile = (relative, bytes) => {
      mkdirSync(dirname(scopePath(relative)), { recursive: true });
      writeFileSync(scopePath(relative), bytes);
    };
    const scopeWriteJson = (relative, value) => {
      mkdirSync(dirname(scopePath(relative)), { recursive: true });
      writeJson(scopePath(relative), value);
    };
    scopeGit('init', '--quiet');
    scopeGit('config', 'user.name', 'Rushd Workflow Self Test');
    scopeGit('config', 'user.email', 'workflow-selftest@example.invalid');
    scopeWriteFile('baseline.txt', 'baseline\n');
    scopeWriteFile('.gitignore', '.codex/runs/\n.DS_Store\n');
    scopeGit('add', 'baseline.txt', '.gitignore');
    scopeGit('commit', '--quiet', '-m', 'baseline');
    const scopeSourceBaseline = scopeGit('rev-parse', 'HEAD');
    const scopeAuthorityCopies = [
      'docs/RUSHD_MASTER_PLAN_FINAL.md',
      'docs/RUSHD_EXECUTION_PROTOCOL.md',
      'docs/RUSHD_PHASE_PROMPTS.md',
      'docs/implementation/phase-plan.json',
      '.agents/skills/rushd-phase-orchestrator',
      '.codex/agents'
    ];
    for (const entry of readdirSync(resolve(root, 'docs/implementation'))) {
      if (/^PLAN_AMENDMENT_.*\.json$/.test(entry)) scopeAuthorityCopies.push(`docs/implementation/${entry}`);
    }
    for (const relative of scopeAuthorityCopies) {
      mkdirSync(dirname(scopePath(relative)), { recursive: true });
      cpSync(resolve(root, relative), scopePath(relative), { recursive: true });
    }
    scopeGit('add', 'docs', '.agents', '.codex');
    scopeGit('commit', '--quiet', '-m', 'Rushd workflow authority');
    const scopeBase = scopeGit('rev-parse', 'HEAD');
    const scopeCanonicalRoot = scopeGit('rev-parse', '--show-toplevel');
    const scopeCarriedPath = 'docs/baseline/manifest-scope-carried.txt';
    const scopeAffectedPath = 'scripts/verify-manifest-scope-fixture.mjs';
    const scopeCarriedBytes = Buffer.from('carried reviewed manifest-scope fixture\n');
    const scopeAffectedPriorBytes = Buffer.from('affected fixture v1\n');
    const scopeAffectedReplacementBytes = Buffer.from('affected fixture v2 reconciled\n');
    mkdirSync(dirname(scopePath(scopeCarriedPath)), { recursive: true });
    mkdirSync(dirname(scopePath(scopeAffectedPath)), { recursive: true });
    scopeWriteFile(scopeCarriedPath, scopeCarriedBytes);
    scopeWriteFile(scopeAffectedPath, scopeAffectedPriorBytes);
    const scopePatchManifestPath = `${scopeRelative}/phases/P00/patch-attempt-01.json`;
    mkdirSync(dirname(scopePath(scopePatchManifestPath)), { recursive: true });
    const scopePriorManifest = JSON.parse(spawnSync(process.execPath, [resolve(root, '.agents/skills/rushd-phase-orchestrator/scripts/compute-patch-hash.mjs'), scopeBase, scopePatchManifestPath], { cwd: scopeTestRoot, encoding: 'utf8' }).stdout);
    const scopeEvidenceRoot = `${scopeRelative}/evidence/P00/worker-attempt-01`;
    scopeWriteFile(`${scopeEvidenceRoot}/gate-evidence.txt`, 'synthetic manifest-scope gate evidence\n');
    scopeWriteFile(`${scopeEvidenceRoot}/npm-test.log`, 'synthetic passing manifest-scope gate log\n');
    const scopeTaskRoot = `${scopeRelative}/tasks/manifest-scope-worker`;
    const scopeWorkerProtocol = (idBase, threadId, prompt) => {
      const files = {
        sessionRequest: { method: 'session/start', id: idBase, params: { model: 'glm-5.3', cwd: scopeCanonicalRoot, approvalPolicy: 'never', sandbox: 'workspace-write' } },
        sessionResponse: { id: idBase, result: { session: { id: threadId, sessionId: `${threadId}-session` } } },
        turnRequest: { method: 'turn/start', id: idBase + 1, params: { sessionId: threadId, input: prompt, model: 'glm-5.3', effort: 'high', cwd: scopeCanonicalRoot, approvalPolicy: 'never', sandboxPolicy: { type: 'workspaceWrite' } } },
        turnResponse: { id: idBase + 1, result: { turn: { id: `${threadId}-turn`, status: 'inProgress', items: [], error: null } } }
      };
      for (const [name, body] of Object.entries(files)) scopeWriteJson(`${scopeTaskRoot}/${name}.json`, body);
      return files;
    };
    const scopeWorkerPrompt = [{ type: 'text', text: 'Implement the manifest-scope P00 fixture.' }];
    scopeWorkerProtocol(40, 'scope-worker', scopeWorkerPrompt);
    const scopeWorkerBase = {
      schema: 'rushd.task-receipt.v1', run_id: scopeScratchRunId, role: 'phase_worker', phase_id: 'P00', audit_id: null, attempt: 1,
      thread_id: 'scope-worker', session_id: 'scope-worker-session', turn_id: 'scope-worker-turn', model: 'glm-5.3', thinking: 'high',
      environment: 'local', adapter: 'zcode_glm', thread_create_method: 'session/start', source_sha: scopeBase,
      snapshot_patch_sha256: null, snapshot_manifest_path: null, worktree_path: null,
      prompt_sha256: sha256Bytes(Buffer.from(JSON.stringify(scopeWorkerPrompt))),
      thread_request_path: `${scopeTaskRoot}/sessionRequest.json`, thread_response_path: `${scopeTaskRoot}/sessionResponse.json`,
      turn_request_path: `${scopeTaskRoot}/turnRequest.json`, turn_response_path: `${scopeTaskRoot}/turnResponse.json`,
      thread_request_sha256: sha256File(scopePath(`${scopeTaskRoot}/sessionRequest.json`)), thread_response_sha256: sha256File(scopePath(`${scopeTaskRoot}/sessionResponse.json`)),
      turn_request_sha256: sha256File(scopePath(`${scopeTaskRoot}/turnRequest.json`)), turn_response_sha256: sha256File(scopePath(`${scopeTaskRoot}/turnResponse.json`)),
      capability_scope: 'none', capability_artifact_path: `${scopeTaskRoot}/sessionRequest.json`, capability_artifact_sha256: sha256File(scopePath(`${scopeTaskRoot}/sessionRequest.json`))
    };
    const scopeWorkerCreatedPath = `${scopeTaskRoot}/created.json`;
    scopeWriteJson(scopeWorkerCreatedPath, { ...scopeWorkerBase, status: 'created', created_at: '2099-01-01T00:00:00Z', completed_at: null, source_diff_status: 'pending', lifecycle_parent_path: null, lifecycle_parent_sha256: null, turn_completed_path: null, turn_completed_sha256: null });
    scopeWriteJson(`${scopeTaskRoot}/completed-event.json`, { method: 'turn/completed', params: { sessionId: 'scope-worker', turn: { id: 'scope-worker-turn', status: 'completed' } } });
    const scopeWorkerCompletedPath = `${scopeTaskRoot}/completed.json`;
    scopeWriteJson(scopeWorkerCompletedPath, {
      ...scopeWorkerBase, status: 'completed', created_at: '2099-01-01T00:00:00Z', completed_at: '2099-01-01T00:01:00Z', source_diff_status: 'explained',
      lifecycle_parent_path: scopeWorkerCreatedPath, lifecycle_parent_sha256: sha256File(scopePath(scopeWorkerCreatedPath)),
      turn_completed_path: `${scopeTaskRoot}/completed-event.json`, turn_completed_sha256: sha256File(scopePath(`${scopeTaskRoot}/completed-event.json`))
    });
    const scopePlan = readPlan();
    const scopeManualRequirement = scopePlan.phases.find((phase) => phase.id === 'P00').manual_qa[0];
    const scopeHumanRoot = `${scopeRelative}/evidence/human/P00-M1`;
    scopeWriteFile(`${scopeHumanRoot}/proof.txt`, 'synthetic fake-data manifest-scope manual QA proof\n');
    const scopeAttestationPath = `${scopeHumanRoot}/attestation.json`;
    scopeWriteJson(scopeAttestationPath, {
      schema: 'rushd.human-attestation.v1', run_id: scopeScratchRunId, phase_id: 'P00', gate_id: 'P00-M1', gate_kind: 'manual_qa',
      gate_request_sha256: sha256Bytes(Buffer.from(scopeManualRequirement)), actor: 'founder', actor_task_id: 'fixture-founder',
      performed_at: '2099-01-01T00:02:00Z', subject_sha: null, period_started_at: null, period_ended_at: null,
      evidence_root: scopeHumanRoot, evidence_hashes: { [`${scopeHumanRoot}/proof.txt`]: sha256File(scopePath(`${scopeHumanRoot}/proof.txt`)) },
      environment: { device: 'fixture', os: 'fixture', browser: 'fixture', browser_version: '1', locale: 'en' }, requirement: scopeManualRequirement,
      result: 'pass', evidence_paths: [`${scopeHumanRoot}/proof.txt`], limitations: []
    });
    const scopeAcceptanceIds = scopePlan.phases.find((phase) => phase.id === 'P00').acceptance.map((item) => item.id);
    const scopePriorCheckpointPath = `${scopeRelative}/phases/P00/checkpoint-attempt-01.json`;
    scopeWriteJson(scopePriorCheckpointPath, {
      schema: 'rushd.phase-checkpoint.v1', run_id: scopeScratchRunId, phase_id: 'P00', attempt: 1, status: 'ready_for_review', base_sha: scopeBase,
      patch_sha256: scopePriorManifest.patch_sha256, patch_manifest_path: scopePatchManifestPath, worker_receipt_path: scopeWorkerCompletedPath, evidence_root: scopeEvidenceRoot,
      evidence_hashes: { [`${scopeEvidenceRoot}/gate-evidence.txt`]: sha256File(scopePath(`${scopeEvidenceRoot}/gate-evidence.txt`)) },
      changed_files: scopePriorManifest.files.map((file) => ({ path: file.path, change: 'modified', purpose: `Reviewed manifest-scope fixture ${file.path}.` })),
      acceptance: scopeAcceptanceIds.map((id) => ({ id, status: 'pass', evidence: [`${scopeEvidenceRoot}/gate-evidence.txt`] })),
      commands: [{ command: 'npm test', exit_code: 0, summary: 'Synthetic complete gate passed.', log_path: `${scopeEvidenceRoot}/npm-test.log`, log_sha256: sha256File(scopePath(`${scopeEvidenceRoot}/npm-test.log`)), started_at: '2099-01-01T00:00:30Z', finished_at: '2099-01-01T00:00:40Z', cwd: scopeTestRoot, runner_task_id: 'scope-worker' }],
      manual_qa: [{ requirement: scopeManualRequirement, status: 'pass', attestation_path: scopeAttestationPath, attestation_sha256: sha256File(scopePath(scopeAttestationPath)) }],
      mandatory_human_gates: [], risks: [], deviations: [], blocking_questions: [], unrelated_changes_observed: []
    });
    const scopeReviewEvidenceRoot = `${scopeRelative}/evidence/P00/review-attempt-01`;
    scopeWriteFile(`${scopeReviewEvidenceRoot}/npm-test.log`, 'independent synthetic manifest-scope review gate passed\n');
    for (const id of scopeAcceptanceIds) scopeWriteFile(`${scopeReviewEvidenceRoot}/${id}.txt`, `Independent synthetic evidence for ${id}\n`);
    const scopeReviewerWorktree = '/private/tmp/rushd-manifest-scope-review';
    const scopeReviewerTaskRoot = `${scopeRelative}/tasks/manifest-scope-reviewer`;
    const scopeReviewerPrompt = [{ type: 'text', text: 'Independently review the manifest-scope P00 fixture.' }];
    const scopeReviewerProtocolFiles = {
      sessionRequest: { method: 'session/start', id: 42, params: { model: 'glm-5.3', cwd: scopeReviewerWorktree, approvalPolicy: 'never', sandbox: 'workspace-write' } },
      sessionResponse: { id: 42, result: { session: { id: 'scope-reviewer', sessionId: 'scope-reviewer-session' } } },
      turnRequest: { method: 'turn/start', id: 43, params: { sessionId: 'scope-reviewer', input: scopeReviewerPrompt, model: 'glm-5.3', effort: 'high', cwd: scopeReviewerWorktree, approvalPolicy: 'never', sandboxPolicy: { type: 'workspaceWrite' } } },
      turnResponse: { id: 43, result: { turn: { id: 'scope-reviewer-turn', status: 'inProgress', items: [], error: null } } }
    };
    for (const [name, body] of Object.entries(scopeReviewerProtocolFiles)) scopeWriteJson(`${scopeReviewerTaskRoot}/${name}.json`, body);
    const scopeReviewerBase = {
      ...scopeWorkerBase, role: 'phase_reviewer', thread_id: 'scope-reviewer', session_id: 'scope-reviewer-session', turn_id: 'scope-reviewer-turn',
      environment: 'worktree', snapshot_patch_sha256: scopePriorManifest.patch_sha256, snapshot_manifest_path: scopePatchManifestPath, worktree_path: scopeReviewerWorktree,
      prompt_sha256: sha256Bytes(Buffer.from(JSON.stringify(scopeReviewerPrompt))),
      thread_request_path: `${scopeReviewerTaskRoot}/sessionRequest.json`, thread_response_path: `${scopeReviewerTaskRoot}/sessionResponse.json`,
      turn_request_path: `${scopeReviewerTaskRoot}/turnRequest.json`, turn_response_path: `${scopeReviewerTaskRoot}/turnResponse.json`,
      thread_request_sha256: sha256File(scopePath(`${scopeReviewerTaskRoot}/sessionRequest.json`)), thread_response_sha256: sha256File(scopePath(`${scopeReviewerTaskRoot}/sessionResponse.json`)),
      turn_request_sha256: sha256File(scopePath(`${scopeReviewerTaskRoot}/turnRequest.json`)), turn_response_sha256: sha256File(scopePath(`${scopeReviewerTaskRoot}/turnResponse.json`)),
      capability_artifact_path: `${scopeReviewerTaskRoot}/sessionRequest.json`, capability_artifact_sha256: sha256File(scopePath(`${scopeReviewerTaskRoot}/sessionRequest.json`))
    };
    const scopeReviewerCreatedPath = `${scopeReviewerTaskRoot}/created.json`;
    scopeWriteJson(scopeReviewerCreatedPath, { ...scopeReviewerBase, status: 'created', created_at: '2099-01-01T00:03:00Z', completed_at: null, source_diff_status: 'pending', lifecycle_parent_path: null, lifecycle_parent_sha256: null, turn_completed_path: null, turn_completed_sha256: null });
    scopeWriteJson(`${scopeReviewerTaskRoot}/completed-event.json`, { method: 'turn/completed', params: { sessionId: 'scope-reviewer', turn: { id: 'scope-reviewer-turn', status: 'completed' } } });
    const scopeReviewerCompletedPath = `${scopeReviewerTaskRoot}/completed.json`;
    scopeWriteJson(scopeReviewerCompletedPath, {
      ...scopeReviewerBase, status: 'completed', created_at: '2099-01-01T00:03:00Z', completed_at: '2099-01-01T00:04:00Z', source_diff_status: 'clean',
      lifecycle_parent_path: scopeReviewerCreatedPath, lifecycle_parent_sha256: sha256File(scopePath(scopeReviewerCreatedPath)),
      turn_completed_path: `${scopeReviewerTaskRoot}/completed-event.json`, turn_completed_sha256: sha256File(scopePath(`${scopeReviewerTaskRoot}/completed-event.json`))
    });
    const scopePriorReviewPath = `${scopeRelative}/phases/P00/review-attempt-01.json`;
    scopeWriteJson(scopePriorReviewPath, {
      schema: 'rushd.phase-review.v1', run_id: scopeScratchRunId, phase_id: 'P00', attempt: 1, checkpoint_patch_sha256: scopePriorManifest.patch_sha256, verdict: 'pass',
      confidence: 'high', next_action: 'advance', reviewer_source_diff: 'clean', reviewer_receipt_path: scopeReviewerCompletedPath, evidence_root: scopeReviewEvidenceRoot,
      evidence_hashes: Object.fromEntries(scopeAcceptanceIds.map((id) => [`${scopeReviewEvidenceRoot}/${id}.txt`, sha256File(scopePath(`${scopeReviewEvidenceRoot}/${id}.txt`))])),
      commands: [{ command: 'npm test', exit_code: 0, summary: 'Independent synthetic gate passed.', log_path: `${scopeReviewEvidenceRoot}/npm-test.log`, log_sha256: sha256File(scopePath(`${scopeReviewEvidenceRoot}/npm-test.log`)), started_at: '2099-01-01T00:03:10Z', finished_at: '2099-01-01T00:03:20Z', cwd: scopeTestRoot, runner_task_id: 'scope-reviewer' }],
      checks: scopeAcceptanceIds.map((id) => ({ id, status: 'pass', evidence: [`${scopeReviewEvidenceRoot}/${id}.txt`] })),
      findings: [], non_blocking_suggestions: []
    });
    const scopeStatePath = `${scopeRelative}/state.json`;
    scopeWriteJson(scopeStatePath, {
      schema: 'rushd.run-state.v1', run_id: scopeScratchRunId, plan_version: plan.plan_version,
      source_baseline_sha: scopeSourceBaseline, authority_commit_sha: scopeBase,
      status: 'passed_pending_commit', current_phase: 'P00', current_attempt: 1, active_worker: 'scope-worker',
      active_worker_receipt_path: scopeWorkerCompletedPath, active_reviewer: null, active_reviewer_receipt_path: null,
      active_final_audit_id: null, checkpoint_path: scopePriorCheckpointPath, review_path: scopePriorReviewPath, adjudication_path: null,
      worker_threads: {}, review_attempts: {}, escalations: {}, phase_commits: {}, base_sha: scopeBase, completed_phases: [],
      remediation: null, release_candidate_sha: null, final_audits: [], full_gate: null, publication_authority: null,
      post_deployment_verification: null, human_required: null, resume_state: null, paused_tasks: null, failure: null,
      unexplained_changes: [], state_revision: 0, genesis_state_sha256: null, previous_state_sha256: null,
      transition_journal_path: `${scopeRelative}/state.journal.jsonl`, updated_at: null
    });
    const scopeStateCheck = scopeNode([validator, scopeStatePath]);
    if (scopeStateCheck.status !== 0) throw new Error(`Scratch passed-pending-commit state invalid:\n${scopeStateCheck.stdout}\n${scopeStateCheck.stderr}`);
    const scopeFailingLogPath = `${scopeRelative}/evidence/precommit-reconciliation/failing-gate.log`;
    const scopeFailureSignature = 'HEAD is not the approved external-continuation authority overlay';
    scopeWriteFile(scopeFailingLogPath, `${scopeFailureSignature}\n`);
    const scopeReconciliationPath = `${scopeRelative}/controller/precommit-reconciliation.json`;
    scopeWriteJson(scopeReconciliationPath, {
      schema: 'rushd.precommit-reconciliation.v1', run_id: scopeScratchRunId, phase_id: 'P00', amendment_id: 'RUSHD-20260822-PORTABLE-PRECOMMIT-RECONCILIATION',
      prior_attempt: 1, prior_checkpoint_path: scopePriorCheckpointPath, prior_checkpoint_sha256: sha256File(scopePath(scopePriorCheckpointPath)),
      prior_review_path: scopePriorReviewPath, prior_review_sha256: sha256File(scopePath(scopePriorReviewPath)), failing_log_path: scopeFailingLogPath,
      failing_log_sha256: sha256File(scopePath(scopeFailingLogPath)), failure_signature: scopeFailureSignature,
      failing_summary: 'The sealed later authority tip moved after the reviewed verifier froze an older authority chain.',
      affected_paths: [scopeAffectedPath], current_head_sha: scopeBase, created_at: '2099-01-01T00:05:00Z'
    });
    const scopeReopenTaskRoot = `${scopeRelative}/tasks/manifest-scope-reopen`;
    const scopeReopenCreatedPath = `${scopeReopenTaskRoot}/created.json`;
    scopeWriteJson(scopeReopenCreatedPath, { ...loadJson(scopePath(scopeWorkerCreatedPath)), attempt: 2 });
    const scopeReopenReceipt = loadJson(scopePath(scopeReopenCreatedPath));
    const scopeReopenEvidence = [scopeReconciliationPath, scopeReopenCreatedPath, scopePriorCheckpointPath, scopePriorReviewPath, scopeReopenReceipt.thread_request_path, scopeReopenReceipt.thread_response_path, scopeReopenReceipt.turn_request_path, scopeReopenReceipt.turn_response_path];
    const scopeReopenRequestPath = `${scopeRelative}/controller/precommit-reconciliation-transition.json`;
    scopeWriteJson(scopeReopenRequestPath, {
      schema: 'rushd.state-transition.v1', event_id: 'SELFTEST-MANIFEST-SCOPE-REOPEN', from: 'passed_pending_commit',
      to: 'worker_running', transition_kind: 'precommit_reconciliation', note: 'reopen for manifest-scope reconciliation',
      reconciliation_record_path: scopeReconciliationPath,
      evidence: scopeReopenEvidence, evidence_hashes: Object.fromEntries(scopeReopenEvidence.map((path) => [path, sha256File(scopePath(path))])),
      changes: {
        current_attempt: 2, active_worker_receipt_path: scopeReopenCreatedPath, checkpoint_path: null, review_path: null,
        adjudication_path: null, precommit_reconciliation: { record_path: scopeReconciliationPath, record_sha256: sha256File(scopePath(scopeReconciliationPath)), affected_paths: [scopeAffectedPath] }
      }
    });
    const scopeReopenResult = scopeNode([transition, scopeStatePath, scopeReopenRequestPath]);
    if (scopeReopenResult.status !== 0) throw new Error(`Scratch precommit reconciliation reopen failed:\n${scopeReopenResult.stdout}\n${scopeReopenResult.stderr}`);
    const scopeFollowupTaskRoot = `${scopeRelative}/tasks/manifest-scope-worker-attempt-2`;
    const scopeFollowupCreatedPath = scopeReopenCreatedPath;
    const scopeFollowupCompletedPath = `${scopeFollowupTaskRoot}/completed.json`;
    scopeWriteJson(`${scopeFollowupTaskRoot}/completed-event.json`, { method: 'turn/completed', params: { sessionId: 'scope-worker', turn: { id: 'scope-worker-turn', status: 'completed' } } });
    scopeWriteJson(scopeFollowupCompletedPath, {
      ...loadJson(scopePath(scopeWorkerCreatedPath)), attempt: 2, status: 'completed', completed_at: '2099-01-01T00:06:00Z', source_diff_status: 'explained',
      lifecycle_parent_path: scopeFollowupCreatedPath, lifecycle_parent_sha256: sha256File(scopePath(scopeFollowupCreatedPath)),
      turn_completed_path: `${scopeFollowupTaskRoot}/completed-event.json`, turn_completed_sha256: sha256File(scopePath(`${scopeFollowupTaskRoot}/completed-event.json`))
    });
    const scopeReplacementManifestFor = (variant) => {
      const carriedEntry = scopePriorManifest.files.find((file) => file.path === scopeCarriedPath);
      const affectedEntry = scopePriorManifest.files.find((file) => file.path === scopeAffectedPath);
      const replacementAffectedEntry = { ...affectedEntry, size: scopeAffectedReplacementBytes.length, sha256: sha256Bytes(scopeAffectedReplacementBytes) };
      const files = [];
      if (variant !== 'drop-carried') files.push(variant === 'carried-drift' ? { ...carriedEntry, sha256: 'e'.repeat(64), size: carriedEntry.size + 1 } : carriedEntry);
      files.push(replacementAffectedEntry);
      if (variant === 'rogue-add') files.push({ path: 'docs/baseline/rogue-expansion.txt', state: 'present', kind: 'file', executable: false, size: 12, sha256: 'd'.repeat(64) });
      files.sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
      return { schema: 'rushd.patch-manifest.v1', base_sha: scopeBase, files };
    };
    const scopeReplacementCheckpointFor = (variant) => {
      const core = scopeReplacementManifestFor(variant);
      const patchSha = sha256Bytes(Buffer.from(JSON.stringify(core)));
      const manifestPath = `${scopeRelative}/phases/P00/patch-attempt-02-${variant}.json`;
      scopeWriteJson(manifestPath, { ...core, patch_sha256: patchSha });
      const checkpoint = structuredClone(loadJson(scopePath(scopePriorCheckpointPath)));
      const evidenceRoot = `${scopeRelative}/evidence/P00/worker-attempt-02`;
      scopeWriteFile(`${evidenceRoot}/gate-evidence.txt`, 'synthetic manifest-scope replacement gate evidence\n');
      scopeWriteFile(`${evidenceRoot}/npm-test.log`, 'synthetic passing manifest-scope replacement gate log\n');
      checkpoint.evidence_root = evidenceRoot;
      checkpoint.evidence_hashes = { [`${evidenceRoot}/gate-evidence.txt`]: sha256File(scopePath(`${evidenceRoot}/gate-evidence.txt`)) };
      checkpoint.acceptance = scopeAcceptanceIds.map((id) => ({ id, status: 'pass', evidence: [`${evidenceRoot}/gate-evidence.txt`] }));
      checkpoint.commands = [{ command: 'npm test', exit_code: 0, summary: 'Synthetic complete replacement gate passed.', log_path: `${evidenceRoot}/npm-test.log`, log_sha256: sha256File(scopePath(`${evidenceRoot}/npm-test.log`)), started_at: '2099-01-01T00:05:30Z', finished_at: '2099-01-01T00:05:40Z', cwd: scopeTestRoot, runner_task_id: 'scope-worker' }];
      checkpoint.attempt = 2;
      checkpoint.patch_sha256 = patchSha;
      checkpoint.patch_manifest_path = manifestPath;
      checkpoint.worker_receipt_path = scopeFollowupCompletedPath;
      checkpoint.changed_files = core.files.map((file) => ({ path: file.path, change: 'modified', purpose: `Replacement manifest-scope fixture ${file.path}.` }));
      const checkpointPath = `${scopeRelative}/phases/P00/checkpoint-attempt-02-${variant}.json`;
      scopeWriteJson(checkpointPath, checkpoint);
      return checkpointPath;
    };
    const scopeReadyRequestFor = (variant, eventId) => {
      const checkpointPath = scopeReplacementCheckpointFor(variant);
      const followupReceipt = loadJson(scopePath(scopeFollowupCompletedPath));
      const evidence = [
        checkpointPath, loadJson(scopePath(checkpointPath)).patch_manifest_path, scopeFollowupCompletedPath,
        followupReceipt.thread_request_path, followupReceipt.thread_response_path,
        followupReceipt.turn_request_path, followupReceipt.turn_response_path,
        scopeFollowupCreatedPath, followupReceipt.turn_completed_path
      ];
      return {
        path: `${scopeRelative}/controller/ready-${variant}.json`, checkpointPath,
        request: {
          schema: 'rushd.state-transition.v1', event_id: eventId, from: 'worker_running', to: 'ready_for_review',
          transition_kind: 'checkpoint_ready', note: `accept manifest-scope replacement (${variant})`,
          evidence, evidence_hashes: Object.fromEntries(evidence.map((path) => [path, sha256File(scopePath(path))])),
          changes: { checkpoint_path: checkpointPath, active_worker_receipt_path: scopeFollowupCompletedPath, precommit_reconciliation: null }
        }
      };
    };
    const scopeRejectReady = (name, variant, pattern, eventId) => {
      const ready = scopeReadyRequestFor(variant, eventId);
      scopeWriteJson(ready.path, ready.request);
      expectRejected(name, scopeNode([transition, scopeStatePath, ready.path]), pattern);
    };
    scopeRejectReady('scratch reconciliation outside-path addition', 'rogue-add', /adds a path outside affected_paths/, 'SELFTEST-SCOPE-ROGUE-ADD');
    scopeRejectReady('scratch reconciliation carried-file drift', 'carried-drift', /changes a reviewed path outside affected_paths/, 'SELFTEST-SCOPE-CARRIED-DRIFT');
    scopeRejectReady('scratch reconciliation missing reviewed file', 'drop-carried', /drops a reviewed path outside affected_paths/, 'SELFTEST-SCOPE-DROP-CARRIED');
    scopeWriteFile(scopeAffectedPath, scopeAffectedReplacementBytes);
    const scopeGoodReady = scopeReadyRequestFor('good', 'SELFTEST-SCOPE-GOOD-READY');
    scopeWriteJson(scopeGoodReady.path, scopeGoodReady.request);
    const scopeGoodResult = scopeNode([transition, scopeStatePath, scopeGoodReady.path]);
    if (scopeGoodResult.status !== 0) throw new Error(`Manifest-scope carried-patch checkpoint acceptance failed:\n${scopeGoodResult.stdout}\n${scopeGoodResult.stderr}`);
    const scopeAcceptedState = loadJson(scopePath(scopeStatePath));
    if (scopeAcceptedState.status !== 'ready_for_review' || scopeAcceptedState.checkpoint_path !== scopeGoodReady.checkpointPath
      || scopeAcceptedState.current_attempt !== 2 || scopeAcceptedState.precommit_reconciliation !== null) throw new Error('Manifest-scope acceptance did not bind the carried replacement checkpoint and clear the link');
    const scopeFinalStateCheck = scopeNode([validator, scopeStatePath]);
    if (scopeFinalStateCheck.status !== 0) throw new Error(`Accepted manifest-scope state failed full validation:\n${scopeFinalStateCheck.stdout}\n${scopeFinalStateCheck.stderr}`);
    console.log('PASS manifest-scope reconciliation accepts carried patch end to end');
  } finally {
    rmSync(scopeTestRoot, { recursive: true, force: true });
  }

  const unsafeManifestPath = `${runRelative}/unsafe-manifest.json`;
  const unsafeManifestBase = { schema: 'rushd.patch-manifest.v1', base_sha: head, files: [{ path: '../escape', state: 'deleted' }] };
  writeJson(resolve(root, unsafeManifestPath), { ...unsafeManifestBase, patch_sha256: (await import('node:crypto')).createHash('sha256').update(JSON.stringify(unsafeManifestBase)).digest('hex') });
  expectRejected('unsafe manifest path', run([validator, unsafeManifestPath]), /Unsafe manifest path/);

  const incompleteReviewPath = `${runRelative}/incomplete-review.json`;
  writeJson(resolve(root, incompleteReviewPath), {
    schema: 'rushd.phase-review.v1', run_id: runId, phase_id: 'P00', attempt: 1, checkpoint_patch_sha256: '0'.repeat(64), verdict: 'needs_changes', confidence: 'high', next_action: 'correct', reviewer_source_diff: 'clean', reviewer_receipt_path: `${runRelative}/missing-receipt.json`, evidence_root: `${runRelative}/missing-review-root`, evidence_hashes: {}, commands: [], checks: []
  });
  const incompleteReview = run([validator, incompleteReviewPath]);
  if (incompleteReview.status === 0 || /TypeError|at file:/.test(`${incompleteReview.stdout}\n${incompleteReview.stderr}`)) throw new Error(`Incomplete review did not fail cleanly: ${incompleteReview.stderr}`);
  console.log('PASS incomplete review fails cleanly');

  const emptyManifestPath = `${runRelative}/empty-manifest.json`;
  const manifestBase = { schema: 'rushd.patch-manifest.v1', base_sha: head, files: [] };
  const { createHash } = await import('node:crypto');
  writeJson(resolve(root, emptyManifestPath), { ...manifestBase, patch_sha256: createHash('sha256').update(JSON.stringify(manifestBase)).digest('hex') });
  const snapshot = spawnSync(process.execPath, [snapshotScript, head, emptyManifestPath, worktree], { cwd: root, encoding: 'utf8' });
  if (snapshot.status !== 0) throw new Error(`Worktree snapshot failed: ${snapshot.stderr}`);
  console.log('PASS exact worktree snapshot');

  const transitionSelfTest = run([resolve(root, '.agents/skills/rushd-phase-orchestrator/scripts/transition-self-test.mjs')]);
  if (transitionSelfTest.status !== 0) throw new Error(`Transition self-test failed:\n${transitionSelfTest.stdout}\n${transitionSelfTest.stderr}`);
  process.stdout.write(transitionSelfTest.stdout);

  console.log('Rushd workflow adversarial self-test passed');
} finally {
  try { execFileSync('git', ['worktree', 'remove', '--force', worktree], { cwd: root }); } catch { /* not created or already removed */ }
  rmSync(runRoot, { recursive: true, force: true });
}

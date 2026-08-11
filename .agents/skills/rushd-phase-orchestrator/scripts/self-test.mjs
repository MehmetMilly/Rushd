#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
  matchesAny,
  readPlan,
  remediationAfterRegressionFailure,
  sameInstant,
  sha256File
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
  expectRejected('forged App Server identity', run([validator, badReceiptPath]), /thread\/start response does not match/);

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

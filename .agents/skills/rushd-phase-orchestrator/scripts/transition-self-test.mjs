#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { sha256Bytes, sha256File } from './workflow-lib.mjs';

const sourceRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const validator = resolve(import.meta.dirname, 'validate-artifact.mjs');
const transition = resolve(import.meta.dirname, 'transition-state.mjs');
const testRoot = mkdtempSync(join(tmpdir(), 'rushd-transition-selftest-'));
const runId = 'rushd-20990101-pause-resume';
const runRelative = `.codex/runs/${runId}`;
const runRoot = resolve(testRoot, runRelative);
const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};
const git = (...args) => execFileSync('git', args, { cwd: testRoot, encoding: 'utf8' }).trim();
const node = (args) => spawnSync(process.execPath, args, { cwd: testRoot, encoding: 'utf8' });
const requireSuccess = (label, result) => {
  if (result.status !== 0) throw new Error(`${label} failed:\n${result.stdout}\n${result.stderr}`);
};
const expectRejected = (label, result, pattern) => {
  if (result.status === 0) throw new Error(`${label}: unexpectedly accepted`);
  const output = `${result.stdout}\n${result.stderr}`;
  if (pattern && !pattern.test(output)) throw new Error(`${label}: wrong rejection:\n${output}`);
  console.log(`PASS reject ${label}`);
};
let candidateRoot = null;

try {
  git('init', '--quiet');
  git('config', 'user.name', 'Rushd Workflow Self Test');
  git('config', 'user.email', 'workflow-selftest@example.invalid');
  const canonicalRoot = git('rev-parse', '--show-toplevel');
  writeFileSync(resolve(testRoot, 'baseline.txt'), 'baseline\n');
  writeFileSync(resolve(testRoot, '.gitignore'), '.codex/runs/\n');
  git('add', 'baseline.txt', '.gitignore');
  git('commit', '--quiet', '-m', 'baseline');
  const sourceBaseline = git('rev-parse', 'HEAD');

  const authorityPaths = [
    'docs/RUSHD_MASTER_PLAN_FINAL.md',
    'docs/RUSHD_EXECUTION_PROTOCOL.md',
    'docs/RUSHD_PHASE_PROMPTS.md',
    'docs/implementation/phase-plan.json',
    '.agents/skills/rushd-phase-orchestrator',
    '.codex/agents'
  ];
  for (const path of authorityPaths) {
    mkdirSync(dirname(resolve(testRoot, path)), { recursive: true });
    cpSync(resolve(sourceRoot, path), resolve(testRoot, path), { recursive: true });
  }
  const amendmentPaths = [
    '.agents/skills/rushd-phase-orchestrator/SKILL.md',
    '.agents/skills/rushd-phase-orchestrator/scripts/transition-self-test.mjs',
    '.agents/skills/rushd-phase-orchestrator/scripts/transition-state.mjs',
    '.agents/skills/rushd-phase-orchestrator/scripts/validate-artifact.mjs',
    '.agents/skills/rushd-phase-orchestrator/scripts/workflow-lib.mjs',
    'docs/RUSHD_EXECUTION_PROTOCOL.md',
    'docs/implementation/PLAN_AMENDMENT_2026-08-11_WORKER_TURN_RECOVERY.json',
    'docs/implementation/phase-plan.json'
  ];
  candidateRoot = mkdtempSync(join(tmpdir(), 'rushd-authority-candidate-'));
  for (const path of amendmentPaths) {
    const source = resolve(sourceRoot, path);
    if (existsSync(source)) {
      mkdirSync(dirname(resolve(candidateRoot, path)), { recursive: true });
      cpSync(source, resolve(candidateRoot, path));
    }
    if (path === 'docs/implementation/PLAN_AMENDMENT_2026-08-11_WORKER_TURN_RECOVERY.json') {
      rmSync(resolve(testRoot, path), { force: true });
    } else if (path === 'docs/implementation/phase-plan.json') {
      const bootstrapPlan = JSON.parse(readFileSync(resolve(candidateRoot, path), 'utf8'));
      bootstrapPlan.protected_paths = bootstrapPlan.protected_paths.filter((entry) => entry !== 'docs/implementation/PLAN_AMENDMENT_*.json');
      writeJson(resolve(testRoot, path), bootstrapPlan);
    } else {
      const candidateBytes = readFileSync(resolve(candidateRoot, path));
      writeFileSync(resolve(testRoot, path), Buffer.concat([candidateBytes, Buffer.from('\n// pre-amendment synthetic authority fixture\n')]));
    }
  }
  git('add', ...authorityPaths);
  git('commit', '--quiet', '-m', 'Rushd workflow authority');
  const authoritySha = git('rev-parse', 'HEAD');
  const currentBase = authoritySha;
  const phasePatchPath = 'phase-selftest.txt';
  writeFileSync(resolve(testRoot, phasePatchPath), 'preserved pre-amendment phase patch\n');
  const phaseManifest = JSON.parse(execFileSync(process.execPath, [resolve(sourceRoot, '.agents/skills/rushd-phase-orchestrator/scripts/compute-patch-hash.mjs'), currentBase], { cwd: testRoot, encoding: 'utf8' }));
  for (const path of amendmentPaths) {
    mkdirSync(dirname(resolve(testRoot, path)), { recursive: true });
    cpSync(resolve(candidateRoot, path), resolve(testRoot, path));
  }
  git('add', ...amendmentPaths);
  const combinedCandidate = JSON.parse(execFileSync(process.execPath, [resolve(sourceRoot, '.agents/skills/rushd-phase-orchestrator/scripts/compute-patch-hash.mjs'), authoritySha], { cwd: testRoot, encoding: 'utf8' }));
  const candidateCore = { schema: 'rushd.patch-manifest.v1', base_sha: authoritySha, files: combinedCandidate.files.filter((file) => file.path !== phasePatchPath) };
  const candidateManifest = { ...candidateCore, patch_sha256: sha256Bytes(Buffer.from(JSON.stringify(candidateCore))) };
  git('commit', '--quiet', '-m', 'Rushd authority: recover interrupted worker turn');
  const authorityAmendmentSha = git('rev-parse', 'HEAD');

  const taskRoot = `${runRelative}/tasks`;
  const candidateManifestPath = `${runRelative}/controller/authority-amendment-candidate.json`;
  writeJson(resolve(testRoot, candidateManifestPath), candidateManifest);
  const reviewerPrefix = `${taskRoot}/authority-review`;
  const reviewerPrompt = [{ type: 'text', text: 'Independently review the exact authority amendment candidate.' }];
  const reviewerProtocol = {
    threadRequest: { method: 'thread/start', id: 20, params: { model: 'gpt-5.6-sol', cwd: testRoot, approvalPolicy: 'never', sandbox: 'workspace-write' } },
    threadResponse: { id: 20, result: { thread: { id: 'authority-review-thread', sessionId: 'authority-review-session' } } },
    turnRequest: { method: 'turn/start', id: 21, params: { threadId: 'authority-review-thread', input: reviewerPrompt, model: 'gpt-5.6-sol', effort: 'high', cwd: testRoot, approvalPolicy: 'never', sandboxPolicy: { type: 'workspaceWrite' } } },
    turnResponse: { id: 21, result: { turn: { id: 'authority-review-turn', status: 'inProgress', items: [], error: null } } }
  };
  for (const [name, body] of Object.entries(reviewerProtocol)) writeJson(resolve(testRoot, `${reviewerPrefix}-${name}.json`), body);
  const reviewerCreatedPath = `${reviewerPrefix}-created.json`;
  const reviewerCompletedPath = `${reviewerPrefix}-completed.json`;
  const reviewerTurnCompletedPath = `${reviewerPrefix}-turn-completed.json`;
  const authorityReviewPath = `${runRelative}/controller/authority-amendment-review.json`;
  const reviewerCreated = {
    schema: 'rushd.task-receipt.v1', run_id: runId, role: 'phase_reviewer', status: 'created', phase_id: 'P00', audit_id: null, attempt: 1,
    thread_id: 'authority-review-thread', session_id: 'authority-review-session', turn_id: 'authority-review-turn', model: 'gpt-5.6-sol', thinking: 'high', environment: 'worktree', adapter: 'app_server', thread_create_method: 'thread/start', source_sha: authoritySha,
    snapshot_patch_sha256: candidateManifest.patch_sha256, snapshot_manifest_path: candidateManifestPath, worktree_path: testRoot, created_at: '2099-01-01T00:01:00Z', completed_at: null, source_diff_status: 'pending',
    prompt_sha256: sha256Bytes(Buffer.from(JSON.stringify(reviewerPrompt))),
    thread_request_path: `${reviewerPrefix}-threadRequest.json`, thread_request_sha256: sha256File(resolve(testRoot, `${reviewerPrefix}-threadRequest.json`)),
    thread_response_path: `${reviewerPrefix}-threadResponse.json`, thread_response_sha256: sha256File(resolve(testRoot, `${reviewerPrefix}-threadResponse.json`)),
    turn_request_path: `${reviewerPrefix}-turnRequest.json`, turn_request_sha256: sha256File(resolve(testRoot, `${reviewerPrefix}-turnRequest.json`)),
    turn_response_path: `${reviewerPrefix}-turnResponse.json`, turn_response_sha256: sha256File(resolve(testRoot, `${reviewerPrefix}-turnResponse.json`)),
    lifecycle_parent_path: null, lifecycle_parent_sha256: null, turn_completed_path: null, turn_completed_sha256: null
  };
  writeJson(resolve(testRoot, reviewerCreatedPath), reviewerCreated);
  const authorityReview = {
    schema: 'rushd.authority-amendment-review.v1', run_id: runId, amendment_id: 'RUSHD-20260811-WORKER-TURN-RECOVERY', candidate_patch_sha256: candidateManifest.patch_sha256,
    verdict: 'pass', confidence: 'high', reviewer_source_diff: 'clean_against_snapshot', checks: [{ id: 'exact-candidate', status: 'pass', evidence: 'synthetic self-test' }], commands: [], findings: [], risks: [], reviewed_at: '2099-01-01T00:02:00Z', reviewer_receipt_path: reviewerCompletedPath
  };
  writeJson(resolve(testRoot, reviewerTurnCompletedPath), { method: 'turn/completed', params: { threadId: 'authority-review-thread', turn: { id: 'authority-review-turn', status: 'completed', error: null, items: [{ type: 'agentMessage', text: JSON.stringify(authorityReview) }] } } });
  writeJson(resolve(testRoot, reviewerCompletedPath), {
    ...reviewerCreated, status: 'completed', completed_at: '2099-01-01T00:02:00Z', source_diff_status: 'clean',
    lifecycle_parent_path: reviewerCreatedPath, lifecycle_parent_sha256: sha256File(resolve(testRoot, reviewerCreatedPath)),
    turn_completed_path: reviewerTurnCompletedPath, turn_completed_sha256: sha256File(resolve(testRoot, reviewerTurnCompletedPath))
  });
  writeJson(resolve(testRoot, authorityReviewPath), authorityReview);
  const approvalPath = `${runRelative}/controller/authority-amendment-approval.json`;
  writeJson(resolve(testRoot, approvalPath), {
    schema: 'rushd.authority-amendment-approval.v1', run_id: runId, amendment_id: authorityReview.amendment_id,
    candidate_manifest_path: candidateManifestPath, candidate_manifest_sha256: sha256File(resolve(testRoot, candidateManifestPath)), candidate_patch_sha256: candidateManifest.patch_sha256,
    review_path: authorityReviewPath, review_sha256: sha256File(resolve(testRoot, authorityReviewPath)),
    reviewer_receipt_path: reviewerCompletedPath, reviewer_receipt_sha256: sha256File(resolve(testRoot, reviewerCompletedPath)), approved_at: '2099-01-01T00:03:00Z'
  });
  requireSuccess('exact reviewed authority amendment approval', node([validator, approvalPath]));
  const threadRequest = { method: 'thread/start', id: 10, params: { model: 'gpt-5.6-sol', cwd: canonicalRoot, approvalPolicy: 'never', sandbox: 'workspace-write' } };
  const threadResponse = { id: 10, result: { thread: { id: 'thread-p00', sessionId: 'session-p00' } } };
  const turnRequest = { method: 'turn/start', id: 11, params: { threadId: 'thread-p00', input: [{ type: 'text', text: 'Implement P00.' }], model: 'gpt-5.6-sol', effort: 'high', cwd: canonicalRoot, approvalPolicy: 'never', sandboxPolicy: { type: 'workspaceWrite' } } };
  const turnResponse = { id: 11, result: { turn: { id: 'turn-p00', status: 'inProgress', items: [], error: null } } };
  const protocol = { 'thread-request.json': threadRequest, 'thread-response.json': threadResponse, 'turn-request.json': turnRequest, 'turn-response.json': turnResponse };
  for (const [name, body] of Object.entries(protocol)) writeJson(resolve(testRoot, taskRoot, name), body);
  const receiptPath = `${taskRoot}/worker-created.json`;
  writeJson(resolve(testRoot, receiptPath), {
    schema: 'rushd.task-receipt.v1', run_id: runId, role: 'phase_worker', status: 'created', phase_id: 'P00', audit_id: null, attempt: 1,
    thread_id: 'thread-p00', session_id: 'session-p00', turn_id: 'turn-p00', model: 'gpt-5.6-sol', thinking: 'high', environment: 'local', adapter: 'app_server', thread_create_method: 'thread/start', source_sha: currentBase,
    snapshot_patch_sha256: null, snapshot_manifest_path: null, worktree_path: null, created_at: '2099-01-01T00:00:00Z', completed_at: null, source_diff_status: 'pending',
    prompt_sha256: sha256Bytes(Buffer.from(JSON.stringify(turnRequest.params.input))),
    thread_request_path: `${taskRoot}/thread-request.json`, thread_request_sha256: sha256File(resolve(testRoot, taskRoot, 'thread-request.json')),
    thread_response_path: `${taskRoot}/thread-response.json`, thread_response_sha256: sha256File(resolve(testRoot, taskRoot, 'thread-response.json')),
    turn_request_path: `${taskRoot}/turn-request.json`, turn_request_sha256: sha256File(resolve(testRoot, taskRoot, 'turn-request.json')),
    turn_response_path: `${taskRoot}/turn-response.json`, turn_response_sha256: sha256File(resolve(testRoot, taskRoot, 'turn-response.json')),
    lifecycle_parent_path: null, lifecycle_parent_sha256: null, turn_completed_path: null, turn_completed_sha256: null
  });

  const statePath = `${runRelative}/state.json`;
  writeJson(resolve(testRoot, statePath), {
    schema: 'rushd.run-state.v1', run_id: runId, plan_version: '2026-08-10-final', source_baseline_sha: sourceBaseline, authority_commit_sha: authoritySha,
    status: 'worker_running', current_phase: 'P00', current_attempt: 1, active_worker: 'thread-p00', active_worker_receipt_path: receiptPath, active_reviewer: null, active_reviewer_receipt_path: null, active_final_audit_id: null,
    checkpoint_path: null, review_path: null, adjudication_path: null, worker_threads: {}, review_attempts: {}, escalations: {}, base_sha: currentBase, completed_phases: [], phase_commits: {}, remediation: null,
    release_candidate_sha: null, final_audits: [], full_gate: null, publication_authority: null, post_deployment_verification: null, human_required: null, resume_state: null, paused_tasks: null, failure: null,
    unexplained_changes: [], state_revision: 0, genesis_state_sha256: null, previous_state_sha256: null, transition_journal_path: `${runRelative}/state.journal.jsonl`, updated_at: null
  });
  requireSuccess('initial worker state validation', node([validator, statePath]));
  console.log('PASS worker started before exact independently reviewed authority amendment commit');

  const failedTurnPath = `${taskRoot}/worker-failed-turn-completed.json`;
  writeJson(resolve(testRoot, failedTurnPath), {
    method: 'turn/completed',
    params: {
      threadId: 'thread-p00',
      turn: { id: 'turn-p00', status: 'failed', error: { message: 'usage limit', codexErrorInfo: 'usageLimitExceeded', additionalDetails: null } }
    }
  });
  const manifestPath = `${runRelative}/phases/P00/patch-attempt-01.json`;
  writeJson(resolve(testRoot, manifestPath), phaseManifest);
  const manifest = JSON.parse(readFileSync(resolve(testRoot, manifestPath), 'utf8'));
  const interruptionPath = `${runRelative}/controller/worker-interruption.json`;
  const writeInterruption = (path, overrides = {}) => writeJson(resolve(testRoot, path), {
    schema: 'rushd.controller-recovery.v1', run_id: runId, phase_id: 'P00', attempt: 1,
    classification: 'account_usage_limit_interruption', attempt_consumed: false, phase_relaunch_required: false,
    recovery_action: 'resume_same_phase_task_with_fresh_turn', thread_id: 'thread-p00', failed_turn_id: 'turn-p00',
    failure_code: 'usageLimitExceeded', failure_message: 'usage limit', failed_turn_completed_path: failedTurnPath,
    failed_turn_completed_sha256: sha256File(resolve(testRoot, failedTurnPath)), created_receipt_path: receiptPath,
    created_receipt_sha256: sha256File(resolve(testRoot, receiptPath)), patch_sha256: manifest.patch_sha256,
    base_sha: currentBase, state_revision: 0, state_status: 'worker_running', recorded_at: '2099-01-01T00:09:00Z',
    note: 'Preserved external usage-limit interruption.', ...overrides
  });
  writeInterruption(interruptionPath);

  const makeFollowup = (prefix, { threadId = 'thread-p00', attempt = 1 } = {}) => {
    const sessionId = threadId === 'thread-p00' ? 'session-p00' : `session-${prefix}`;
    const turnId = `turn-${prefix}`;
    const threadRequestPath = `${taskRoot}/${prefix}-thread-request.json`;
    const threadResponsePath = `${taskRoot}/${prefix}-thread-response.json`;
    const turnRequestPath = `${taskRoot}/${prefix}-turn-request.json`;
    const turnResponsePath = `${taskRoot}/${prefix}-turn-response.json`;
    const createdPath = `${taskRoot}/${prefix}-created.json`;
    const completedEventPath = `${taskRoot}/${prefix}-turn-completed.json`;
    const completedPath = `${taskRoot}/${prefix}-completed.json`;
    const promptInput = [{ type: 'text', text: `Recover ${prefix}.` }];
    writeJson(resolve(testRoot, threadRequestPath), { method: 'thread/start', id: `${prefix}-thread`, params: { model: 'gpt-5.6-sol', cwd: canonicalRoot, approvalPolicy: 'never', sandbox: 'workspace-write' } });
    writeJson(resolve(testRoot, threadResponsePath), { id: `${prefix}-thread`, result: { thread: { id: threadId, sessionId } } });
    writeJson(resolve(testRoot, turnRequestPath), { method: 'turn/start', id: `${prefix}-turn`, params: { threadId, input: promptInput, model: 'gpt-5.6-sol', effort: 'high', cwd: canonicalRoot, approvalPolicy: 'never', sandboxPolicy: { type: 'workspaceWrite' } } });
    writeJson(resolve(testRoot, turnResponsePath), { id: `${prefix}-turn`, result: { turn: { id: turnId, status: 'inProgress', items: [], error: null } } });
    const created = {
      schema: 'rushd.task-receipt.v1', run_id: runId, role: 'phase_worker', status: 'created', phase_id: 'P00', audit_id: null, attempt,
      thread_id: threadId, session_id: sessionId, turn_id: turnId, model: 'gpt-5.6-sol', thinking: 'high', environment: 'local', adapter: 'app_server', thread_create_method: 'thread/start', source_sha: currentBase,
      snapshot_patch_sha256: null, snapshot_manifest_path: null, worktree_path: null, created_at: '2099-01-01T00:10:00Z', completed_at: null, source_diff_status: 'pending',
      prompt_sha256: sha256Bytes(Buffer.from(JSON.stringify(promptInput))),
      thread_request_path: threadRequestPath, thread_request_sha256: sha256File(resolve(testRoot, threadRequestPath)),
      thread_response_path: threadResponsePath, thread_response_sha256: sha256File(resolve(testRoot, threadResponsePath)),
      turn_request_path: turnRequestPath, turn_request_sha256: sha256File(resolve(testRoot, turnRequestPath)),
      turn_response_path: turnResponsePath, turn_response_sha256: sha256File(resolve(testRoot, turnResponsePath)),
      lifecycle_parent_path: null, lifecycle_parent_sha256: null, turn_completed_path: null, turn_completed_sha256: null
    };
    writeJson(resolve(testRoot, createdPath), created);
    writeJson(resolve(testRoot, completedEventPath), { method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed', error: null } } });
    writeJson(resolve(testRoot, completedPath), {
      ...created, status: 'completed', completed_at: '2099-01-01T00:11:00Z', source_diff_status: 'explained',
      lifecycle_parent_path: createdPath, lifecycle_parent_sha256: sha256File(resolve(testRoot, createdPath)),
      turn_completed_path: completedEventPath, turn_completed_sha256: sha256File(resolve(testRoot, completedEventPath))
    });
    return { createdPath, completedPath, completedEventPath, threadRequestPath, threadResponsePath, turnRequestPath, turnResponsePath };
  };

  const evidenceFor = (followup, failedPath = failedTurnPath, interruption = interruptionPath) => [...new Set([
    receiptPath,
    `${taskRoot}/thread-request.json`, `${taskRoot}/thread-response.json`, `${taskRoot}/turn-request.json`, `${taskRoot}/turn-response.json`,
    failedPath, interruption, approvalPath,
    followup.createdPath, followup.completedPath, followup.completedEventPath,
    followup.threadRequestPath, followup.threadResponsePath, followup.turnRequestPath, followup.turnResponsePath,
    manifestPath
  ])];
  const recoveryFor = (followup, failedPath = failedTurnPath, interruption = interruptionPath) => {
    const preserved = evidenceFor(followup, failedPath, interruption);
    return {
      schema: 'rushd.worker-turn-recovery.v1', run_id: runId, phase_id: 'P00', attempt: 1, classification: 'external_usage_limit', thread_id: 'thread-p00', base_sha: currentBase,
      patch_sha256: manifest.patch_sha256,
      authority_amendment_approval_path: approvalPath, authority_amendment_approval_sha256: sha256File(resolve(testRoot, approvalPath)), authority_amendment_commit_sha: authorityAmendmentSha,
      interruption_record_path: interruption, interruption_record_sha256: sha256File(resolve(testRoot, interruption)),
      original_created_receipt_path: receiptPath, original_created_receipt_sha256: sha256File(resolve(testRoot, receiptPath)),
      failed_turn_completed_path: failedPath, failed_turn_completed_sha256: sha256File(resolve(testRoot, failedPath)),
      followup_created_receipt_path: followup.createdPath, followup_created_receipt_sha256: sha256File(resolve(testRoot, followup.createdPath)),
      followup_completed_receipt_path: followup.completedPath, followup_completed_receipt_sha256: sha256File(resolve(testRoot, followup.completedPath)),
      patch_manifest_path: manifestPath, patch_manifest_sha256: sha256File(resolve(testRoot, manifestPath)), recovered_at: '2099-01-01T00:12:00Z',
      preserved_evidence_paths: preserved,
      evidence_hashes: Object.fromEntries(preserved.map((path) => [path, sha256File(resolve(testRoot, path))]))
    };
  };
  const writeRecovery = (name, recovery) => {
    const path = `${runRelative}/${name}.json`;
    writeJson(resolve(testRoot, path), recovery);
    return path;
  };

  const followup = makeFollowup('recovered');
  const validRecovery = recoveryFor(followup);
  const recoveryPath = writeRecovery('recovery-valid', validRecovery);
  requireSuccess('valid worker-turn recovery artifact', node([validator, recoveryPath]));

  const badHash = { ...validRecovery, original_created_receipt_sha256: '0'.repeat(64) };
  expectRejected('worker recovery hash mismatch', node([validator, writeRecovery('recovery-bad-hash', badHash)]), /hash mismatch/);

  const otherFailurePath = `${taskRoot}/worker-other-failure.json`;
  writeJson(resolve(testRoot, otherFailurePath), { method: 'turn/completed', params: { threadId: 'thread-p00', turn: { id: 'turn-p00', status: 'failed', error: { codexErrorInfo: 'otherFailure' } } } });
  expectRejected('unclassified worker failure', node([validator, writeRecovery('recovery-unclassified', recoveryFor(followup, otherFailurePath))]), /usageLimitExceeded/);

  const crossThreadFailurePath = `${taskRoot}/worker-cross-thread-failure.json`;
  writeJson(resolve(testRoot, crossThreadFailurePath), { method: 'turn/completed', params: { threadId: 'thread-other', turn: { id: 'turn-p00', status: 'failed', error: { codexErrorInfo: 'usageLimitExceeded' } } } });
  const crossThreadInterruptionPath = `${runRelative}/controller/worker-cross-thread-interruption.json`;
  writeInterruption(crossThreadInterruptionPath, { failed_turn_completed_path: crossThreadFailurePath, failed_turn_completed_sha256: sha256File(resolve(testRoot, crossThreadFailurePath)) });
  expectRejected('cross-thread failed-event substitution', node([validator, writeRecovery('recovery-cross-thread-failure', recoveryFor(followup, crossThreadFailurePath, crossThreadInterruptionPath))]), /worker thread/);

  const crossThread = makeFollowup('cross-thread', { threadId: 'thread-other' });
  expectRejected('cross-thread worker recovery', node([validator, writeRecovery('recovery-cross-thread', recoveryFor(crossThread))]), /changed worker thread/);

  const crossAttempt = makeFollowup('cross-attempt', { attempt: 2 });
  expectRejected('cross-attempt worker recovery', node([validator, writeRecovery('recovery-cross-attempt', recoveryFor(crossAttempt))]), /changed worker thread, phase, attempt/);

  const substitute = makeFollowup('substitute');
  const substitutedRecovery = recoveryFor(followup);
  substitutedRecovery.followup_completed_receipt_path = substitute.completedPath;
  substitutedRecovery.followup_completed_receipt_sha256 = sha256File(resolve(testRoot, substitute.completedPath));
  substitutedRecovery.preserved_evidence_paths = [...new Set([...substitutedRecovery.preserved_evidence_paths, ...evidenceFor(substitute)])];
  substitutedRecovery.evidence_hashes = Object.fromEntries(substitutedRecovery.preserved_evidence_paths.map((path) => [path, sha256File(resolve(testRoot, path))]));
  expectRejected('worker recovery receipt substitution', node([validator, writeRecovery('recovery-substituted', substitutedRecovery)]), /substituted|does not extend/);

  const baseDriftInterruptionPath = `${runRelative}/controller/worker-base-drift-interruption.json`;
  writeInterruption(baseDriftInterruptionPath, { base_sha: sourceBaseline });
  const baseDriftRecovery = recoveryFor(followup, failedTurnPath, baseDriftInterruptionPath);
  baseDriftRecovery.base_sha = sourceBaseline;
  expectRejected('worker recovery base drift', node([validator, writeRecovery('recovery-base-drift', baseDriftRecovery)]), /original worker identity/);

  const recoveryEvidence = [...new Set([recoveryPath, ...validRecovery.preserved_evidence_paths])];
  const recoveryRequest = {
    schema: 'rushd.state-transition.v1', event_id: 'SELFTEST-WORKER-TURN-RECOVERY', from: 'worker_running', to: 'worker_running', transition_kind: 'recover_worker_turn', note: 'exercise same-task usage-limit recovery',
    evidence: recoveryEvidence, evidence_hashes: Object.fromEntries(recoveryEvidence.map((path) => [path, sha256File(resolve(testRoot, path))])),
    changes: { active_worker_receipt_path: followup.createdPath, recovery_record_path: recoveryPath, recovery_record_sha256: sha256File(resolve(testRoot, recoveryPath)) }
  };
  const weakenedPath = `${runRelative}/recovery-weakened-transition.json`;
  writeJson(resolve(testRoot, weakenedPath), { ...recoveryRequest, event_id: 'SELFTEST-WORKER-TURN-WEAKENED', changes: { ...recoveryRequest.changes, current_attempt: 2 } });
  expectRejected('worker recovery gate weakening', node([transition, statePath, weakenedPath]), /Unexpected transition changes/);

  writeFileSync(resolve(testRoot, 'drift.txt'), 'unmanifested patch drift\n');
  expectRejected('worker recovery patch manifest drift', node([transition, statePath, writeRecovery('recovery-patch-drift-transition', recoveryRequest)]), /phase patch plus sealed authority commit does not match/);
  rmSync(resolve(testRoot, 'drift.txt'));

  const recoveryRequestPath = `${runRelative}/recovery-transition.json`;
  writeJson(resolve(testRoot, recoveryRequestPath), recoveryRequest);
  requireSuccess('same-task worker-turn recovery transition', node([transition, statePath, recoveryRequestPath]));
  const recoveredState = JSON.parse(readFileSync(resolve(testRoot, statePath), 'utf8'));
  if (recoveredState.status !== 'worker_running' || recoveredState.state_revision !== 1 || recoveredState.current_attempt !== 1 || recoveredState.active_worker !== 'thread-p00' || recoveredState.active_worker_receipt_path !== followup.createdPath || recoveredState.base_sha !== currentBase) throw new Error('Worker-turn recovery weakened or changed phase identity');
  console.log('PASS journaled same-thread/same-phase/same-attempt worker-turn recovery');
  console.log('PASS preserved pre-amendment worker patch across sealed disjoint authority commit');

  const plan = JSON.parse(readFileSync(resolve(testRoot, 'docs/implementation/phase-plan.json'), 'utf8'));
  const exactRequest = plan.phases.find((phase) => phase.id === 'P00').manual_qa[0];
  const humanRequired = {
    gate_id: 'P00-M1', gate_kind: 'manual_qa', phase_id: 'P00', exact_request: exactRequest,
    safe_options: ['complete the matrix', 'stop the run'], evidence_required: ['structured fake-data attestation'],
    requested_at: '2099-01-02T00:00:00Z', requesting_task_id: 'thread-p00'
  };
  humanRequired.request_sha256 = sha256Bytes(Buffer.from(JSON.stringify({
    gate_id: humanRequired.gate_id,
    phase_id: humanRequired.phase_id,
    exact_request: humanRequired.exact_request,
    safe_options: humanRequired.safe_options,
    evidence_required: humanRequired.evidence_required,
    requested_at: humanRequired.requested_at,
    requesting_task_id: humanRequired.requesting_task_id
  })));
  const pausePath = `${runRelative}/pause.json`;
  writeJson(resolve(testRoot, pausePath), {
    schema: 'rushd.state-transition.v1', event_id: 'SELFTEST-PAUSE', from: 'worker_running', to: 'human_required', transition_kind: 'request_human', note: 'exercise canonical pause',
    evidence: [followup.createdPath], evidence_hashes: { [followup.createdPath]: sha256File(resolve(testRoot, followup.createdPath)) },
    changes: {
      human_required: humanRequired, resume_state: 'worker_running', active_worker: null, active_worker_receipt_path: null, active_reviewer: null, active_reviewer_receipt_path: null, active_final_audit_id: null,
      paused_tasks: { active_worker: 'thread-p00', active_worker_receipt_path: followup.createdPath, active_reviewer: null, active_reviewer_receipt_path: null, active_final_audit_id: null }, remediation: null
    }
  });
  requireSuccess('human pause transition', node([transition, statePath, pausePath]));

  const humanRoot = `${runRelative}/evidence/human/P00-M1`;
  const humanProof = `${humanRoot}/proof.txt`;
  mkdirSync(resolve(testRoot, humanRoot), { recursive: true });
  writeFileSync(resolve(testRoot, humanProof), 'structured fake-data manual QA proof\n');
  const attestationPath = `${humanRoot}/attestation.json`;
  writeJson(resolve(testRoot, attestationPath), {
    schema: 'rushd.human-attestation.v1', run_id: runId, phase_id: 'P00', gate_id: 'P00-M1', gate_kind: 'manual_qa', gate_request_sha256: humanRequired.request_sha256,
    actor: 'founder', actor_task_id: 'founder-selftest', performed_at: '2099-01-03T00:00:00Z', subject_sha: null, period_started_at: null, period_ended_at: null,
    evidence_root: humanRoot, evidence_hashes: { [humanProof]: sha256File(resolve(testRoot, humanProof)) }, environment: { device: 'self-test', os: 'self-test', browser: 'self-test', browser_version: '1', locale: 'en' },
    requirement: exactRequest, result: 'pass', evidence_paths: [humanProof], limitations: []
  });
  const resumePath = `${runRelative}/resume.json`;
  writeJson(resolve(testRoot, resumePath), {
    schema: 'rushd.state-transition.v1', event_id: 'SELFTEST-RESUME', from: 'human_required', to: 'worker_running', transition_kind: 'resume_human', note: 'exercise bound resume',
    evidence: [attestationPath], evidence_hashes: { [attestationPath]: sha256File(resolve(testRoot, attestationPath)) },
    changes: {
      human_attestation_path: attestationPath, human_attestation_sha256: sha256File(resolve(testRoot, attestationPath)), human_required: null, resume_state: null,
      active_worker: 'thread-p00', active_worker_receipt_path: followup.createdPath, active_reviewer: null, active_reviewer_receipt_path: null, active_final_audit_id: null, remediation: null
    }
  });
  requireSuccess('human resume transition', node([transition, statePath, resumePath]));
  requireSuccess('resumed state/full journal validation', node([validator, statePath]));
  const resumed = JSON.parse(readFileSync(resolve(testRoot, statePath), 'utf8'));
  if (resumed.status !== 'worker_running' || resumed.state_revision !== 3 || !/^[0-9a-f]{64}$/.test(resumed.genesis_state_sha256)) throw new Error('Pause/resume did not preserve canonical state/journal metadata');
  console.log('PASS full human pause/resume and journal chain');

  const journalPath = resolve(testRoot, resumed.transition_journal_path);
  const events = readFileSync(journalPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  events[1].from = 'needs_changes';
  writeFileSync(journalPath, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
  const corrupted = node([validator, statePath]);
  if (corrupted.status === 0 || !/breaks the status chain/.test(`${corrupted.stdout}\n${corrupted.stderr}`)) throw new Error('Corrupted middle journal link was not rejected cleanly');
  console.log('PASS reject broken middle journal link');
} finally {
  rmSync(testRoot, { recursive: true, force: true });
  if (candidateRoot) rmSync(candidateRoot, { recursive: true, force: true });
}

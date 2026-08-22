#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  CANONICAL_AUDITS,
  RUN_TRANSITIONS,
  assertJournalChain,
  artifactRecord,
  git,
  gitHead,
  isObject,
  matchesAny,
  isSha256,
  loadJson,
  manifestForCommitRange,
  phaseFor,
  readPlan,
  remediationAfterRegressionFailure,
  sameJson,
  sha256Bytes,
  sha256File,
  strictKeys
} from './workflow-lib.mjs';

const [stateInput, requestInput] = process.argv.slice(2);
if (!stateInput || !requestInput) {
  console.error('Usage: transition-state.mjs <state.json> <transition-request.json>');
  process.exit(2);
}

const statePath = resolve(stateInput);
const requestPath = resolve(requestInput);
const pendingPath = `${statePath}.pending`;
const validator = resolve(import.meta.dirname, 'validate-artifact.mjs');
const plan = readPlan();
const phaseIds = plan.phases.map((phase) => phase.id);

const validate = (path, related = null, pending = false, sealed = false) => {
  const args = [validator, path];
  if (related) args.push(related);
  execFileSync(process.execPath, args, {
    stdio: 'pipe',
    env: {
      ...process.env,
      RUSHD_PENDING_STATE: pending ? '1' : '0',
      RUSHD_SEALED_ARTIFACT: sealed ? '1' : '0'
    }
  });
};
const artifact = (path, schema, related = null, sealed = false) => {
  validate(path, related, false, sealed);
  const result = loadJson(path);
  if (result.schema !== schema) throw new Error(`${path} must use ${schema}`);
  return result;
};
const receipt = (path, roles, status = null) => {
  const result = artifact(path, 'rushd.task-receipt.v1');
  if (!roles.includes(result.role)) throw new Error(`Receipt role ${result.role} is not one of ${roles.join(', ')}`);
  if (status && result.status !== status) throw new Error(`Receipt must be ${status}`);
  return result;
};
const receiptProtocolEvidence = (task) => [
  task.thread_request_path,
  task.thread_response_path,
  task.turn_request_path,
  task.turn_response_path,
  ...(task.status === 'completed' ? [task.lifecycle_parent_path, task.turn_completed_path] : [])
];
const requireCompletedChild = (task, createdPath, label) => {
  if (task.status !== 'completed' || task.lifecycle_parent_path !== createdPath || task.lifecycle_parent_sha256 !== sha256File(createdPath)) throw new Error(`${label} completion receipt does not extend the active immutable receipt`);
};
const recordFor = (path, fields = {}) => artifactRecord(path, fields);
const requireRecord = (record, path, fields = {}) => {
  const expected = recordFor(path, fields);
  if (!sameJson(record, expected)) throw new Error(`Artifact summary for ${path} is not exact`);
};
const requireKeys = (changes, allowed, required = allowed) => {
  const result = strictKeys(changes, allowed, required);
  if (!result.ok) throw new Error(result.message);
};
const requireEvidence = (request, paths) => {
  for (const path of paths) {
    if (!request.evidence.includes(path)) throw new Error(`Transition evidence omits ${path}`);
    if (!isSha256(request.evidence_hashes[path]) || request.evidence_hashes[path] !== sha256File(path)) throw new Error(`Transition evidence hash mismatch for ${path}`);
  }
};
const requireSame = (actual, expected, message) => {
  if (!sameJson(actual, expected)) throw new Error(message);
};
const requireCleanTree = () => {
  const status = git('status', '--porcelain=v1', '--untracked-files=all').trim();
  if (status) throw new Error(`Working tree must be clean; found: ${status.split('\n').slice(0, 5).join(', ')}`);
};
const requestHash = (request) => sha256Bytes(Buffer.from(JSON.stringify(request)));
const journalHasEvidence = (path, hash, transitionKind) => {
  if (!existsSync(resolve(state.transition_journal_path))) return false;
  const events = readFileSync(resolve(state.transition_journal_path), 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  return events.some((event) => event.transition_kind === transitionKind && event.evidence?.some((evidence) => evidence.path === path && evidence.sha256 === hash));
};

const journalState = (state, stateBytes) => {
  const journalPath = resolve(state.transition_journal_path);
  const stateHash = sha256Bytes(stateBytes);
  const journalHasEvents = existsSync(journalPath) && readFileSync(journalPath, 'utf8').trim().length > 0;
  if (state.state_revision === 0 && !journalHasEvents) {
    if (state.genesis_state_sha256 !== null) throw new Error('Revision-zero state cannot have a genesis hash');
    if (existsSync(pendingPath)) rmSync(pendingPath);
    return;
  }
  if (!existsSync(journalPath)) throw new Error('Transition journal is missing');
  const lines = readFileSync(journalPath, 'utf8').trim().split('\n').filter(Boolean);
  const events = lines.map((line) => JSON.parse(line));
  const chainGenesis = state.state_revision === 0 ? events[0]?.previous_state_sha256 : state.genesis_state_sha256;
  const last = assertJournalChain(events, chainGenesis);
  if (last.state_revision === state.state_revision && last.next_state_sha256 === stateHash && last.to === state.status) {
    if (state.previous_state_sha256 !== last.previous_state_sha256) throw new Error('Run state previous hash does not match journal tail');
    if (existsSync(pendingPath)) rmSync(pendingPath);
    return;
  }
  if (last.state_revision === state.state_revision + 1 && existsSync(pendingPath)) {
    const priorHash = state.state_revision === 0 ? chainGenesis : events[state.state_revision - 1]?.next_state_sha256;
    if (priorHash !== stateHash || last.previous_state_sha256 !== stateHash) throw new Error('Journal-ahead event does not extend current state');
    const pendingBytes = readFileSync(pendingPath);
    if (sha256Bytes(pendingBytes) !== last.next_state_sha256) throw new Error('Pending state does not match journal-ahead recovery event');
    renameSync(pendingPath, statePath);
    return 'recovered';
  }
  throw new Error('State/journal gap is not safely recoverable');
};

let stateBytes = readFileSync(statePath);
let state = JSON.parse(stateBytes);
if (journalState(state, stateBytes) === 'recovered') {
  stateBytes = readFileSync(statePath);
  state = JSON.parse(stateBytes);
}
validate(statePath);
validate(requestPath);
const request = loadJson(requestPath);
if (existsSync(resolve(state.transition_journal_path))) {
  const existingIds = readFileSync(resolve(state.transition_journal_path), 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line).event_id);
  if (existingIds.includes(request.event_id)) throw new Error(`Duplicate transition event_id ${request.event_id}`);
}

if (request.from !== state.status || !RUN_TRANSITIONS[state.status]?.includes(request.to)) throw new Error(`Transition ${state.status} -> ${request.to} is not allowed`);
if (request.changes.status !== undefined || request.changes.state_revision !== undefined || request.changes.previous_state_sha256 !== undefined || request.changes.genesis_state_sha256 !== undefined || request.changes.updated_at !== undefined) throw new Error('Transition cannot directly set protected state fields');
if (!request.event_id || request.event_id.length < 8 || !request.note || request.evidence.length === 0) throw new Error('Transition requires a stable event ID, note, and evidence');

const changes = request.changes;
const currentPhase = phaseFor(plan, state.current_phase);
let expectedKind;

const validateWorkerStart = (roles, expectedPhase, expectedAttempt, expectedBase) => {
  const worker = receipt(changes.active_worker_receipt_path, roles, 'created');
  if (worker.thread_id !== changes.active_worker || worker.run_id !== state.run_id || worker.phase_id !== expectedPhase || worker.attempt !== expectedAttempt || worker.source_sha !== expectedBase) throw new Error('Worker receipt does not match phase start');
  requireEvidence(request, [changes.active_worker_receipt_path, ...receiptProtocolEvidence(worker)]);
  return worker;
};

if (state.status === 'not_started' && request.to === 'worker_running') {
  expectedKind = 'start_phase';
  requireKeys(changes, ['current_phase', 'current_attempt', 'active_worker', 'active_worker_receipt_path', 'base_sha']);
  if (changes.current_phase !== 'P00' || changes.current_attempt !== 1 || changes.base_sha !== gitHead()) throw new Error('Initial phase must start P00 attempt 1 at HEAD');
  requireCleanTree();
  validateWorkerStart(['phase_worker'], 'P00', 1, changes.base_sha);
}

if (state.status === 'worker_running' && request.to === 'worker_running') {
  expectedKind = 'recover_worker_turn';
  requireKeys(changes, ['active_worker_receipt_path', 'recovery_record_path', 'recovery_record_sha256']);
  const recovery = artifact(changes.recovery_record_path, 'rushd.worker-turn-recovery.v1');
  if (changes.recovery_record_sha256 !== sha256File(changes.recovery_record_path)) throw new Error('Worker-turn recovery record hash mismatch');
  const expectedRoles = state.remediation ? ['remediation_worker'] : ['phase_worker'];
  const original = receipt(recovery.original_created_receipt_path, expectedRoles, 'created');
  const followupCreated = receipt(changes.active_worker_receipt_path, expectedRoles, 'created');
  const followupCompleted = receipt(recovery.followup_completed_receipt_path, expectedRoles, 'completed');
  const recoveryManifest = artifact(recovery.patch_manifest_path, 'rushd.patch-manifest.v1');
  const authorityApproval = artifact(recovery.authority_amendment_approval_path, 'rushd.authority-amendment-approval.v1');
  const authorityManifest = artifact(authorityApproval.candidate_manifest_path, 'rushd.patch-manifest.v1');
  const currentManifest = JSON.parse(execFileSync(process.execPath, [resolve(import.meta.dirname, 'compute-patch-hash.mjs'), state.base_sha], { encoding: 'utf8' }));
  if (recovery.original_created_receipt_path !== state.active_worker_receipt_path || recovery.followup_created_receipt_path !== changes.active_worker_receipt_path) throw new Error('Worker-turn recovery attempted receipt substitution');
  if (recovery.run_id !== state.run_id || recovery.phase_id !== state.current_phase || recovery.attempt !== state.current_attempt || recovery.thread_id !== state.active_worker || recovery.base_sha !== state.base_sha) throw new Error('Worker-turn recovery changed run, phase, attempt, thread, or base identity');
  if (original.thread_id !== state.active_worker || followupCreated.thread_id !== state.active_worker || followupCompleted.thread_id !== state.active_worker) throw new Error('Worker-turn recovery changed the active writer thread');
  const authorityPaths = new Set(authorityManifest.files.map((file) => file.path));
  if (recoveryManifest.files.some((file) => authorityPaths.has(file.path))) throw new Error('Worker-turn recovery phase patch overlaps the approved authority amendment');
  const expectedCombinedFiles = [...authorityManifest.files, ...recoveryManifest.files].sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
  const committedAuthority = manifestForCommitRange(state.base_sha, recovery.authority_amendment_commit_sha);
  if (gitHead() !== recovery.authority_amendment_commit_sha || !sameJson(committedAuthority, authorityManifest) || currentManifest.base_sha !== state.base_sha || !sameJson(currentManifest.files, expectedCombinedFiles) || recoveryManifest.patch_sha256 !== recovery.patch_sha256) throw new Error('Worker-turn recovery phase patch plus sealed authority commit does not match the current checkout');
  requireCompletedChild(followupCompleted, changes.active_worker_receipt_path, 'Recovered worker');
  requireEvidence(request, [
    changes.recovery_record_path,
    ...recovery.preserved_evidence_paths,
    ...receiptProtocolEvidence(original),
    ...receiptProtocolEvidence(followupCompleted)
  ]);
}

if (state.status === 'worker_running' && request.to === 'ready_for_review') {
  expectedKind = 'checkpoint_ready';
  requireKeys(changes, ['checkpoint_path', 'active_worker_receipt_path']);
  if (state.precommit_reconciliation) {
    const pendingCheckpoint = loadJson(changes.checkpoint_path);
    if (pendingCheckpoint.schema === 'rushd.phase-checkpoint.v1' && pendingCheckpoint.phase_id === state.current_phase && pendingCheckpoint.attempt === state.current_attempt) {
      for (const change of pendingCheckpoint.changed_files ?? []) {
        if (!state.precommit_reconciliation.affected_paths.some((path) => matchesAny(change.path, [path]))) throw new Error(`Reconciliation checkpoint changes an unapproved path: ${change.path}`);
      }
    }
  }
  const checkpoint = artifact(changes.checkpoint_path, 'rushd.phase-checkpoint.v1');
  if (checkpoint.run_id !== state.run_id || checkpoint.phase_id !== state.current_phase || checkpoint.attempt !== state.current_attempt || checkpoint.base_sha !== state.base_sha || checkpoint.worker_receipt_path !== changes.active_worker_receipt_path) throw new Error('Checkpoint does not match active worker state');
  if (state.precommit_reconciliation && checkpoint.attempt === state.current_attempt) {
    const reconciliation = artifact(state.precommit_reconciliation.record_path, 'rushd.precommit-reconciliation.v1');
    for (const change of checkpoint.changed_files ?? []) {
      if (!state.precommit_reconciliation.affected_paths.some((path) => matchesAny(change.path, [path]))) throw new Error(`Reconciliation checkpoint changes an unapproved path: ${change.path}`);
    }
    if (!sameJson(state.precommit_reconciliation.affected_paths, reconciliation.affected_paths)) throw new Error('Reconciliation state/record affected paths drifted');
  }
  const worker = receipt(changes.active_worker_receipt_path, state.remediation ? ['remediation_worker'] : ['phase_worker'], 'completed');
  requireCompletedChild(worker, state.active_worker_receipt_path, 'Worker');
  if (worker.thread_id !== state.active_worker) throw new Error('Checkpoint worker identity changed');
  for (const gate of checkpoint.mandatory_human_gates ?? []) if (!journalHasEvidence(gate.attestation_path, gate.attestation_sha256, 'resume_human') && !journalHasEvidence(gate.attestation_path, gate.attestation_sha256, 'resume_external_worker')) throw new Error(`Checkpoint mandatory gate lacks a matching journaled human resume: ${gate.gate_id}`);
  requireEvidence(request, [changes.checkpoint_path, checkpoint.patch_manifest_path, checkpoint.worker_receipt_path, ...receiptProtocolEvidence(worker)]);
}

if (state.status === 'ready_for_review' && request.to === 'reviewer_running') {
  expectedKind = 'start_reviewer';
  requireKeys(changes, ['active_reviewer', 'active_reviewer_receipt_path']);
  const checkpoint = artifact(state.checkpoint_path, 'rushd.phase-checkpoint.v1');
  const reviewer = receipt(changes.active_reviewer_receipt_path, ['phase_reviewer'], 'created');
  if (reviewer.thread_id !== changes.active_reviewer || reviewer.thread_id === state.active_worker || reviewer.run_id !== state.run_id || reviewer.phase_id !== state.current_phase || reviewer.attempt !== state.current_attempt || reviewer.source_sha !== state.base_sha || reviewer.snapshot_patch_sha256 !== checkpoint.patch_sha256) throw new Error('Reviewer is not a fresh matching snapshot task');
  requireEvidence(request, [changes.active_reviewer_receipt_path, ...receiptProtocolEvidence(reviewer), reviewer.snapshot_manifest_path]);
}

if (state.status === 'reviewer_running' && ['needs_changes', 'passed_pending_commit'].includes(request.to)) {
  expectedKind = request.to === 'needs_changes' ? 'review_needs_changes' : 'review_pass';
  requireKeys(changes, ['review_path', 'active_reviewer', 'active_reviewer_receipt_path']);
  if (changes.active_reviewer !== null || changes.active_reviewer_receipt_path !== null) throw new Error('Completed review must clear active reviewer');
  const review = artifact(changes.review_path, 'rushd.phase-review.v1', state.checkpoint_path);
  const expectedVerdicts = request.to === 'passed_pending_commit' ? ['pass'] : ['needs_changes', 'blocked'];
  const completedReviewer = receipt(review.reviewer_receipt_path, ['phase_reviewer'], 'completed');
  requireCompletedChild(completedReviewer, state.active_reviewer_receipt_path, 'Reviewer');
  if (!expectedVerdicts.includes(review.verdict) || review.run_id !== state.run_id || review.phase_id !== state.current_phase || review.attempt !== state.current_attempt) throw new Error('Review verdict does not match transition');
  requireEvidence(request, [changes.review_path, review.reviewer_receipt_path, ...receiptProtocolEvidence(completedReviewer)]);
}

if (['reviewer_running', 'needs_changes'].includes(state.status) && request.to === 'escalated') {
  expectedKind = 'start_adjudication';
  const required = state.status === 'reviewer_running'
    ? ['review_path', 'active_reviewer', 'active_reviewer_receipt_path']
    : ['active_reviewer', 'active_reviewer_receipt_path'];
  requireKeys(changes, required);
  let review = loadJson(state.review_path ?? changes.review_path);
  if (state.status === 'reviewer_running') {
    review = artifact(changes.review_path, 'rushd.phase-review.v1', state.checkpoint_path);
    if (review.verdict !== 'escalate') throw new Error('Direct escalation requires escalate review verdict');
  } else if (state.current_attempt < 3) throw new Error('Correction-cycle escalation requires attempt 3 or later');
  const adjudicator = receipt(changes.active_reviewer_receipt_path, ['adjudicator'], 'created');
  if (adjudicator.thread_id !== changes.active_reviewer || adjudicator.thread_id === state.active_worker || adjudicator.run_id !== state.run_id || adjudicator.phase_id !== state.current_phase || adjudicator.source_sha !== state.base_sha) throw new Error('Adjudicator receipt does not match dispute');
  requireEvidence(request, [changes.active_reviewer_receipt_path, ...receiptProtocolEvidence(adjudicator), adjudicator.snapshot_manifest_path]);
}

if (state.status === 'needs_changes' && request.to === 'worker_running' && request.transition_kind === 'correction') {
  expectedKind = 'correction';
  requireKeys(changes, ['current_attempt', 'active_worker_receipt_path', 'checkpoint_path', 'review_path', 'adjudication_path']);
  if (changes.current_attempt !== state.current_attempt + 1 || changes.checkpoint_path !== null || changes.review_path !== null || changes.adjudication_path !== null) throw new Error('Correction must increment attempt and clear prior attempt artifacts');
  const review = artifact(state.review_path, 'rushd.phase-review.v1', state.checkpoint_path);
  if (review.findings.some((finding) => finding.severity === 'blocking' && finding.owner_phase !== state.current_phase)) throw new Error('Earlier-phase blocker must use committed-phase remediation');
  const worker = receipt(changes.active_worker_receipt_path, ['phase_worker'], 'created');
  if (worker.thread_id !== state.active_worker || worker.phase_id !== state.current_phase || worker.attempt !== changes.current_attempt || worker.source_sha !== state.base_sha) throw new Error('Correction must reuse the phase thread with a new attempt receipt');
  requireEvidence(request, [changes.active_worker_receipt_path, ...receiptProtocolEvidence(worker), state.review_path]);
}

if (state.status === 'passed_pending_commit' && request.to === 'worker_running' && request.transition_kind === 'precommit_reconciliation') {
  expectedKind = 'precommit_reconciliation';
  requireKeys(changes, ['current_attempt', 'active_worker_receipt_path', 'checkpoint_path', 'review_path', 'adjudication_path', 'precommit_reconciliation']);
  if (changes.current_attempt !== state.current_attempt + 1 || changes.checkpoint_path !== null || changes.review_path !== null || changes.adjudication_path !== null) throw new Error('Pre-commit reconciliation must increment the attempt and clear prior active artifacts');
  const reconciliation = artifact(request.reconciliation_record_path, 'rushd.precommit-reconciliation.v1');
  if (reconciliation.phase_id !== state.current_phase || reconciliation.prior_attempt !== state.current_attempt || reconciliation.current_head_sha !== gitHead()) throw new Error('Pre-commit reconciliation does not match the paused phase/head');
  if (reconciliation.prior_checkpoint_path !== state.checkpoint_path || reconciliation.prior_checkpoint_sha256 !== sha256File(state.checkpoint_path) || reconciliation.prior_review_path !== state.review_path || reconciliation.prior_review_sha256 !== sha256File(state.review_path)) throw new Error('Pre-commit reconciliation does not preserve the exact PASS artifacts');
  const reconciliationLink = { record_path: request.reconciliation_record_path, record_sha256: sha256File(request.reconciliation_record_path), affected_paths: reconciliation.affected_paths };
  requireSame(changes.precommit_reconciliation, reconciliationLink, 'Pre-commit reconciliation state link is not exact');
  const worker = receipt(changes.active_worker_receipt_path, ['phase_worker'], 'created');
  if (worker.thread_id !== state.active_worker || worker.phase_id !== state.current_phase || worker.attempt !== changes.current_attempt || worker.source_sha !== state.base_sha) throw new Error('Pre-commit reconciliation must reuse the phase worker with a new attempt receipt');
  requireEvidence(request, [
    request.reconciliation_record_path,
    changes.active_worker_receipt_path,
    state.checkpoint_path,
    state.review_path,
    ...receiptProtocolEvidence(worker)
  ]);
}

const startRemediation = () => {
  const triggerPath = state.status === 'final_audit' ? changes.remediation?.trigger_artifact_path : state.review_path;
  const triggerSchema = state.status === 'final_audit' ? 'rushd.final-audit.v1' : 'rushd.phase-review.v1';
  const trigger = artifact(triggerPath, triggerSchema, state.status === 'final_audit' ? null : state.checkpoint_path);
  let triggerTaskEvidence = [];
  if (state.status === 'final_audit') {
    const completedAuditor = receipt(trigger.auditor_receipt_path, ['final_auditor'], 'completed');
    requireCompletedChild(completedAuditor, state.active_reviewer_receipt_path, 'Blocking final auditor');
    if (trigger.audit_id !== state.active_final_audit_id || trigger.release_sha !== state.release_candidate_sha || trigger.verdict !== 'needs_changes') throw new Error('Final remediation trigger does not match the active audit/release');
    triggerTaskEvidence = [trigger.auditor_receipt_path, ...receiptProtocolEvidence(completedAuditor)];
  }
  const blockers = trigger.findings.filter((finding) => finding.severity === 'blocking');
  const owner = changes.remediation?.owner_phase;
  const owned = blockers.filter((finding) => finding.owner_phase === owner);
  if (!owned.length || !state.completed_phases.includes(owner)) throw new Error('Remediation must be owned by a committed phase with a trigger blocker');
  const expectedRequired = state.completed_phases.slice(state.completed_phases.indexOf(owner) + 1);
  const returnStatus = state.status === 'final_audit' ? 'final_audit' : 'worker_running';
  const expectedRemediation = {
    owner_phase: owner,
    trigger_artifact_path: triggerPath,
    trigger_artifact_sha256: sha256File(triggerPath),
    trigger_finding_ids: owned.map((finding) => finding.id),
    return_phase: state.current_phase,
    return_status: returnStatus,
    return_worker_task_id: returnStatus === 'worker_running' ? state.active_worker : null,
    return_worker_receipt_path: returnStatus === 'worker_running' ? state.active_worker_receipt_path : null,
    return_attempt: returnStatus === 'worker_running' ? state.current_attempt : null,
    return_snapshot_manifest_path: changes.remediation.return_snapshot_manifest_path,
    return_snapshot_manifest_sha256: changes.remediation.return_snapshot_manifest_sha256,
    return_patch_sha256: changes.remediation.return_patch_sha256,
    original_release_candidate_sha: returnStatus === 'final_audit' ? state.release_candidate_sha : null,
    pre_remediation_head_sha: gitHead(),
    round_base_sha: gitHead(),
    remediation_round: 1,
    owner_commit_count_before: state.phase_commits[owner].length,
    remediation_commit_sha: null,
    remediation_commit_artifact_path: null,
    required_regression_phases: expectedRequired,
    passed_regression_phases: [],
    regression_results: [],
    failed_regression_results: [],
    active_regression_phase: null,
    status: 'implementing'
  };
  requireSame(changes.remediation, expectedRemediation, 'Remediation state is not the exact canonical reopening record');
  const snapshot = artifact(changes.remediation.return_snapshot_manifest_path, 'rushd.patch-manifest.v1');
  if (changes.remediation.return_snapshot_manifest_sha256 !== sha256File(changes.remediation.return_snapshot_manifest_path) || snapshot.base_sha !== gitHead() || snapshot.patch_sha256 !== changes.remediation.return_patch_sha256) throw new Error('Interrupted patch snapshot does not match current HEAD');
  const worker = validateWorkerStart(['remediation_worker'], owner, changes.current_attempt, gitHead());
  if (worker.environment !== 'worktree') throw new Error('Committed-phase remediation must run in an isolated worktree');
  requireEvidence(request, [triggerPath, ...triggerTaskEvidence, changes.remediation.return_snapshot_manifest_path]);
};

if ((state.status === 'needs_changes' || state.status === 'final_audit') && request.to === 'worker_running' && request.transition_kind === 'start_remediation') {
  expectedKind = 'start_remediation';
  requireKeys(changes, ['current_phase', 'current_attempt', 'active_worker', 'active_worker_receipt_path', 'base_sha', 'checkpoint_path', 'review_path', 'adjudication_path', 'release_candidate_sha', 'final_audits', 'full_gate', 'publication_authority', 'post_deployment_verification', 'active_final_audit_id', 'remediation']);
  if (changes.current_phase !== changes.remediation.owner_phase || changes.base_sha !== gitHead() || changes.current_attempt < 1 || changes.checkpoint_path !== null || changes.review_path !== null || changes.adjudication_path !== null || changes.release_candidate_sha !== null || changes.final_audits.length || changes.full_gate !== null || changes.publication_authority !== null || changes.post_deployment_verification !== null || changes.active_final_audit_id !== null) throw new Error('Remediation must reset active/final artifacts and start at owner-phase HEAD');
  startRemediation();
}

if (state.status === 'escalated' && ['worker_running', 'reviewer_running'].includes(request.to)) {
  expectedKind = request.to === 'worker_running' ? 'adjudication_correction' : 'adjudication_fresh_review';
  const common = ['adjudication_path', 'active_reviewer', 'active_reviewer_receipt_path'];
  const extra = request.to === 'worker_running' ? ['current_attempt', 'active_worker_receipt_path', 'checkpoint_path', 'review_path'] : [];
  requireKeys(changes, [...common, ...extra]);
  const adjudication = artifact(changes.adjudication_path, 'rushd.phase-adjudication.v1');
  const completedAdjudicator = receipt(adjudication.adjudicator_receipt_path, ['adjudicator'], 'completed');
  requireCompletedChild(completedAdjudicator, state.active_reviewer_receipt_path, 'Adjudicator');
  if (adjudication.run_id !== state.run_id || adjudication.phase_id !== state.current_phase) throw new Error('Adjudication does not match active dispute');
  requireEvidence(request, [changes.adjudication_path, adjudication.adjudicator_receipt_path, ...receiptProtocolEvidence(completedAdjudicator)]);
  if (request.to === 'worker_running') {
    if (adjudication.verdict !== 'implementation_violation' || changes.current_attempt !== state.current_attempt + 1 || changes.active_reviewer !== null || changes.active_reviewer_receipt_path !== null || changes.checkpoint_path !== null || changes.review_path !== null) throw new Error('Adjudication correction fields are invalid');
    const worker = receipt(changes.active_worker_receipt_path, state.remediation ? ['remediation_worker'] : ['phase_worker'], 'created');
    if (worker.thread_id !== state.active_worker || worker.attempt !== changes.current_attempt) throw new Error('Adjudication correction must reuse worker thread');
  } else {
    if (adjudication.verdict !== 'finding_invalid') throw new Error('Fresh review requires finding_invalid adjudication');
    const reviewer = receipt(changes.active_reviewer_receipt_path, ['phase_reviewer'], 'created');
    if (reviewer.thread_id !== changes.active_reviewer || reviewer.thread_id === state.active_reviewer || reviewer.snapshot_patch_sha256 !== loadJson(state.checkpoint_path).patch_sha256) throw new Error('Fresh reviewer is not isolated or does not target unchanged checkpoint');
  }
}

const validateHumanGate = () => {
  const gate = changes.human_required;
  if (!isObject(gate) || !['manual_qa', 'external'].includes(gate.gate_kind) || gate.phase_id !== state.current_phase || !Array.isArray(gate.safe_options) || gate.safe_options.length < 2 || !Array.isArray(gate.evidence_required) || gate.evidence_required.length === 0) throw new Error('Human gate is incomplete');
  const canonical = currentPhase.manual_qa.find((item) => item.startsWith(`${gate.gate_id}:`));
  const mandatory = currentPhase.mandatory_human_gates?.find((item) => item.id === gate.gate_id);
  if (gate.gate_kind === 'manual_qa' && canonical !== gate.exact_request) throw new Error('Manual human gate must match phase plan exactly');
  if (mandatory && (gate.gate_kind !== mandatory.kind || gate.exact_request !== mandatory.requirement)) throw new Error('Mandatory phase human gate must match the phase plan exactly');
  if (gate.gate_kind === 'external' && !mandatory && !/^(ORCHESTRATOR-ADAPTER|PUBLICATION|EXTERNAL-[A-Z0-9-]+)$/.test(gate.gate_id)) throw new Error('External gate ID is not canonical');
  const canonicalHash = sha256Bytes(Buffer.from(JSON.stringify({ gate_id: gate.gate_id, phase_id: gate.phase_id, exact_request: gate.exact_request, safe_options: gate.safe_options, evidence_required: gate.evidence_required, requested_at: gate.requested_at, requesting_task_id: gate.requesting_task_id })));
  if (gate.request_sha256 !== canonicalHash) throw new Error('Human gate request hash is not canonical');
};

if (request.to === 'human_required') {
  expectedKind = request.transition_kind === 'request_publication' ? 'request_publication' : 'request_human';
  requireKeys(changes, ['human_required', 'resume_state', 'active_worker', 'active_worker_receipt_path', 'active_reviewer', 'active_reviewer_receipt_path', 'active_final_audit_id', 'paused_tasks', 'remediation', 'review_path', 'adjudication_path'], ['human_required', 'resume_state', 'active_worker', 'active_worker_receipt_path', 'active_reviewer', 'active_reviewer_receipt_path', 'active_final_audit_id', 'paused_tasks', 'remediation']);
  const completedDecisionTask = ['reviewer_running', 'escalated'].includes(state.status);
  const expectedResume = completedDecisionTask ? 'needs_changes' : state.status;
  if (changes.active_worker !== null || changes.active_worker_receipt_path !== null || changes.active_reviewer !== null || changes.active_reviewer_receipt_path !== null || changes.active_final_audit_id !== null || changes.resume_state !== expectedResume) throw new Error('Human gate must clear active tasks and record the canonical resume state');
  validateHumanGate();
  if (request.transition_kind === 'request_publication' && (state.status !== 'final_audit' || state.final_audits.length !== 5 || !state.full_gate || changes.human_required.gate_id !== 'PUBLICATION')) throw new Error('Publication gate requires five audits and full gate');
  const expectedPaused = {
    active_worker: state.active_worker,
    active_worker_receipt_path: state.active_worker_receipt_path,
    active_reviewer: completedDecisionTask ? null : state.active_reviewer,
    active_reviewer_receipt_path: completedDecisionTask ? null : state.active_reviewer_receipt_path,
    active_final_audit_id: completedDecisionTask ? null : state.active_final_audit_id
  };
  requireSame(changes.paused_tasks, expectedPaused, 'Human gate paused task record is not exact');
  if (state.remediation) {
    if (!isObject(changes.remediation) || changes.remediation.status !== 'paused' || changes.remediation.paused_status !== state.remediation.status) throw new Error('Human gate must preserve paused remediation status');
  } else if (changes.remediation !== null) throw new Error('Non-remediation gate cannot create remediation');
  if (state.status === 'reviewer_running') {
    if (typeof changes.review_path !== 'string') throw new Error('Reviewer human gate must persist the blocking review');
    const review = artifact(changes.review_path, 'rushd.phase-review.v1', state.checkpoint_path);
    const completedReviewer = receipt(review.reviewer_receipt_path, ['phase_reviewer'], 'completed');
    requireCompletedChild(completedReviewer, state.active_reviewer_receipt_path, 'Blocked reviewer');
    if (review.verdict !== 'blocked') throw new Error('Reviewer human gate requires a matching blocked review');
    requireEvidence(request, [changes.review_path, review.reviewer_receipt_path, ...receiptProtocolEvidence(completedReviewer)]);
  }
  if (state.status === 'escalated') {
    if (typeof changes.adjudication_path !== 'string') throw new Error('Escalated human gate must persist adjudication');
    const adjudication = artifact(changes.adjudication_path, 'rushd.phase-adjudication.v1');
    const completedAdjudicator = receipt(adjudication.adjudicator_receipt_path, ['adjudicator'], 'completed');
    requireCompletedChild(completedAdjudicator, state.active_reviewer_receipt_path, 'Human-gate adjudicator');
    if (adjudication.verdict !== 'human_required') throw new Error('Escalated human gate requires matching adjudication');
    requireEvidence(request, [changes.adjudication_path, adjudication.adjudicator_receipt_path, ...receiptProtocolEvidence(completedAdjudicator)]);
  }
}

if (state.status === 'human_required' && request.to !== 'failed') {
  const externalWorkerContinuation = request.transition_kind === 'resume_external_worker';
  expectedKind = state.human_required.gate_id === 'PUBLICATION' ? 'resume_publication' : externalWorkerContinuation ? 'resume_external_worker' : 'resume_human';
  const keys = ['human_attestation_path', 'human_attestation_sha256', 'human_required', 'resume_state', 'active_worker', 'active_worker_receipt_path', 'active_reviewer', 'active_reviewer_receipt_path', 'active_final_audit_id', 'remediation'];
  if (expectedKind === 'resume_publication') keys.push('publication_authority');
  if (externalWorkerContinuation) keys.push('external_worker_continuation_path', 'external_worker_continuation_sha256');
  requireKeys(changes, keys);
  if (request.to !== state.resume_state || changes.human_required !== null || changes.resume_state !== null) throw new Error('Human gate must resume its recorded state');
  const attestation = artifact(changes.human_attestation_path, 'rushd.human-attestation.v1');
  if (!isSha256(changes.human_attestation_sha256) || changes.human_attestation_sha256 !== sha256File(changes.human_attestation_path)) throw new Error('Human attestation hash mismatch');
  if (attestation.run_id !== state.run_id || attestation.phase_id !== state.human_required.phase_id || attestation.gate_id !== state.human_required.gate_id || attestation.gate_kind !== state.human_required.gate_kind || attestation.gate_request_sha256 !== state.human_required.request_sha256 || attestation.requirement !== state.human_required.exact_request || attestation.result !== 'pass') throw new Error('Human attestation does not satisfy the recorded gate');
  const paused = state.paused_tasks;
  if (externalWorkerContinuation) {
    if (state.human_required.gate_id !== 'EXTERNAL-P00-PINNED-CHROMIUM' || state.current_phase !== 'P00' || state.resume_state !== 'worker_running') throw new Error('External worker continuation is limited to the exact authorized P00 runtime gate');
    const continuation = artifact(changes.external_worker_continuation_path, 'rushd.external-worker-continuation.v1');
    if (!isSha256(changes.external_worker_continuation_sha256) || changes.external_worker_continuation_sha256 !== sha256File(changes.external_worker_continuation_path)) throw new Error('External worker continuation record hash mismatch');
    const followupCreated = receipt(changes.active_worker_receipt_path, ['phase_worker'], 'created');
    const followupCompleted = receipt(continuation.followup_completed_receipt_path, ['phase_worker'], 'completed');
    if (continuation.run_id !== state.run_id || continuation.phase_id !== state.current_phase || continuation.attempt !== state.current_attempt || continuation.thread_id !== paused.active_worker || continuation.base_sha !== state.base_sha || continuation.gate_id !== state.human_required.gate_id || continuation.gate_request_sha256 !== state.human_required.request_sha256 || continuation.human_attestation_path !== changes.human_attestation_path || continuation.prior_created_receipt_path !== paused.active_worker_receipt_path || continuation.followup_created_receipt_path !== changes.active_worker_receipt_path) throw new Error('External worker continuation changed gate, worker, phase, attempt, base, or receipt identity');
    if (changes.active_worker !== paused.active_worker || followupCreated.thread_id !== paused.active_worker || followupCompleted.thread_id !== paused.active_worker || changes.active_reviewer !== paused.active_reviewer || changes.active_reviewer_receipt_path !== paused.active_reviewer_receipt_path || changes.active_final_audit_id !== paused.active_final_audit_id) throw new Error('External worker continuation changed a paused task identity');
    requireCompletedChild(followupCompleted, changes.active_worker_receipt_path, 'External continuation worker');
    requireEvidence(request, [changes.external_worker_continuation_path, ...continuation.preserved_evidence_paths, ...receiptProtocolEvidence(followupCompleted)]);
  } else {
    for (const key of ['active_worker', 'active_worker_receipt_path', 'active_reviewer', 'active_reviewer_receipt_path', 'active_final_audit_id']) if (changes[key] !== paused[key]) throw new Error(`Human resume changed paused task field ${key}`);
  }
  if (state.remediation) {
    const restored = { ...state.remediation };
    restored.status = state.remediation.paused_status;
    delete restored.paused_status;
    requireSame(changes.remediation, restored, 'Human resume did not restore remediation exactly');
  } else if (changes.remediation !== null) throw new Error('Human resume cannot invent remediation');
  requireEvidence(request, [changes.human_attestation_path]);
  if (expectedKind === 'resume_publication') {
    const publication = artifact(changes.publication_authority.artifact_path, 'rushd.publication-authority.v1');
    requireRecord(changes.publication_authority, changes.publication_authority.artifact_path, { status: 'approved', actor: 'founder', release_sha: state.release_candidate_sha });
    if (publication.attestation_path !== changes.human_attestation_path || publication.release_sha !== state.release_candidate_sha) throw new Error('Publication artifact does not use resumed founder attestation');
    requireEvidence(request, [changes.publication_authority.artifact_path]);
  }
}

if (state.status === 'passed_pending_commit' && request.to === 'committed') {
  expectedKind = 'commit_phase';
  const commitKeys = ['phase_commit_record', 'completed_phases', 'phase_commits', 'active_worker', 'active_worker_receipt_path', 'checkpoint_path', 'review_path', 'adjudication_path', 'base_sha', 'remediation'];
  const reconciliationKeys = state.precommit_reconciliation ? ['precommit_reconciliation'] : [];
  requireKeys(changes, [...commitKeys, ...reconciliationKeys], [...commitKeys, ...reconciliationKeys]);
  const commitArtifact = artifact(changes.phase_commit_record.artifact_path, 'rushd.phase-commit.v1');
  requireRecord(changes.phase_commit_record, changes.phase_commit_record.artifact_path, {
    commit_sha: commitArtifact.commit_sha,
    patch_sha256: commitArtifact.patch_sha256,
    attempt: commitArtifact.attempt,
    committed_at: commitArtifact.committed_at,
    purpose: commitArtifact.commit_subject
  });
  if (commitArtifact.run_id !== state.run_id || commitArtifact.phase_id !== state.current_phase || commitArtifact.attempt !== state.current_attempt || commitArtifact.base_sha !== state.base_sha || commitArtifact.checkpoint_path !== state.checkpoint_path || commitArtifact.review_path !== state.review_path || commitArtifact.commit_sha !== gitHead()) throw new Error('Phase commit artifact does not match reviewed active phase or HEAD');
  if (commitArtifact.commit_kind !== (state.remediation ? 'remediation' : 'phase')) throw new Error('Phase commit kind does not match run state');
  if (changes.active_worker !== null || changes.active_worker_receipt_path !== null || changes.checkpoint_path !== null || changes.review_path !== null || changes.adjudication_path !== null || changes.base_sha !== commitArtifact.commit_sha) throw new Error('Commit transition did not clear active attempt or advance base SHA');
  if (state.precommit_reconciliation && changes.precommit_reconciliation !== null) throw new Error('Phase commit must clear its reconciliation link');
  const expectedCommits = structuredClone(state.phase_commits);
  expectedCommits[state.current_phase] = [...(expectedCommits[state.current_phase] ?? []), changes.phase_commit_record];
  requireSame(changes.phase_commits, expectedCommits, 'Commit transition must append exactly one phase commit record');
  if (state.remediation) {
    requireSame(changes.completed_phases, state.completed_phases, 'Remediation commit cannot change completed phases');
    if (state.phase_commits[state.current_phase].length !== state.remediation.owner_commit_count_before) throw new Error('Remediation owner history changed before additive commit');
    const returnManifest = artifact(state.remediation.return_snapshot_manifest_path, 'rushd.patch-manifest.v1');
    const current = JSON.parse(execFileSync(process.execPath, [resolve(import.meta.dirname, 'compute-patch-hash.mjs'), commitArtifact.commit_sha], { encoding: 'utf8' }));
    if (!sameJson(current.files, returnManifest.files)) throw new Error('Interrupted phase patch was not preserved across remediation integration');
    const remediation = { ...state.remediation, status: 'committed', remediation_commit_sha: commitArtifact.commit_sha, remediation_commit_artifact_path: changes.phase_commit_record.artifact_path };
    requireSame(changes.remediation, remediation, 'Remediation commit metadata is not exact');
  } else {
    requireSame(changes.completed_phases, [...state.completed_phases, state.current_phase], 'Normal commit must append exactly the current phase');
    if (state.completed_phases.includes(state.current_phase)) throw new Error('Normal phase is already completed');
    if (changes.remediation !== null) throw new Error('Normal commit cannot create remediation');
    requireCleanTree();
  }
  requireEvidence(request, [changes.phase_commit_record.artifact_path]);
}

if (state.status === 'committed' && request.to === 'worker_running') {
  expectedKind = 'start_next_phase';
  requireKeys(changes, ['current_phase', 'current_attempt', 'active_worker', 'active_worker_receipt_path', 'base_sha']);
  if (state.remediation) throw new Error('Remediation commit must enter regression review');
  const nextPhase = phaseIds[state.completed_phases.length];
  if (!nextPhase || changes.current_phase !== nextPhase || changes.current_attempt !== 1 || changes.base_sha !== gitHead()) throw new Error('Next phase start is out of dependency order');
  requireCleanTree();
  validateWorkerStart(['phase_worker'], nextPhase, 1, changes.base_sha);
}

if (state.status === 'committed' && request.to === 'regression_review') {
  expectedKind = 'start_regression';
  requireKeys(changes, ['current_phase', 'active_reviewer', 'active_reviewer_receipt_path', 'remediation']);
  if (!state.remediation || state.remediation.status !== 'committed') throw new Error('Regression review requires a completed remediation commit');
  const required = state.remediation.required_regression_phases;
  const remediation = { ...state.remediation };
  if (required.length === 0) {
    remediation.status = 'ready_to_resume';
    remediation.active_regression_phase = null;
    if (changes.current_phase !== remediation.owner_phase || changes.active_reviewer !== null || changes.active_reviewer_receipt_path !== null) throw new Error('Empty regression set must become ready without reviewer');
  } else {
    const next = required[0];
    remediation.status = 'regression_checking';
    remediation.active_regression_phase = next;
    const reviewer = receipt(changes.active_reviewer_receipt_path, ['regression_reviewer'], 'created');
    if (changes.current_phase !== next || reviewer.thread_id !== changes.active_reviewer || reviewer.phase_id !== next || reviewer.source_sha !== remediation.remediation_commit_sha) throw new Error('First regression reviewer does not match next phase');
    requireEvidence(request, [changes.active_reviewer_receipt_path, ...receiptProtocolEvidence(reviewer), reviewer.snapshot_manifest_path]);
  }
  requireSame(changes.remediation, remediation, 'Regression start remediation metadata is not exact');
}

if (state.status === 'regression_review' && request.to === 'regression_review') {
  expectedKind = 'record_regression';
  requireKeys(changes, ['current_phase', 'active_reviewer', 'active_reviewer_receipt_path', 'remediation']);
  if (state.remediation.status !== 'regression_checking') throw new Error('No active regression review to record');
  const phaseId = state.remediation.active_regression_phase;
  const resultPath = changes.remediation.regression_results.at(-1)?.artifact_path;
  const result = artifact(resultPath, 'rushd.regression-review.v1');
  const completedRegression = receipt(result.reviewer_receipt_path, ['regression_reviewer'], 'completed');
  requireCompletedChild(completedRegression, state.active_reviewer_receipt_path, 'Regression reviewer');
  if (result.verdict !== 'pass' || result.target_phase !== phaseId || result.remediation_owner_phase !== state.remediation.owner_phase || result.remediation_commit_sha !== state.remediation.remediation_commit_sha) throw new Error('Regression result does not match active review');
  const resultRecord = recordFor(resultPath, { target_phase: phaseId, verdict: 'pass', remediation_commit_sha: result.remediation_commit_sha });
  const passed = [...state.remediation.passed_regression_phases, phaseId];
  const results = [...state.remediation.regression_results, resultRecord];
  const nextPhase = state.remediation.required_regression_phases[passed.length];
  const remediation = { ...state.remediation, passed_regression_phases: passed, regression_results: results };
  if (nextPhase) {
    remediation.status = 'regression_checking';
    remediation.active_regression_phase = nextPhase;
    const reviewer = receipt(changes.active_reviewer_receipt_path, ['regression_reviewer'], 'created');
    if (changes.current_phase !== nextPhase || reviewer.thread_id !== changes.active_reviewer || reviewer.phase_id !== nextPhase || reviewer.source_sha !== remediation.remediation_commit_sha) throw new Error('Next regression reviewer does not match sequence');
    requireEvidence(request, [changes.active_reviewer_receipt_path, ...receiptProtocolEvidence(reviewer), reviewer.snapshot_manifest_path]);
  } else {
    remediation.status = 'ready_to_resume';
    remediation.active_regression_phase = null;
    if (changes.current_phase !== remediation.owner_phase || changes.active_reviewer !== null || changes.active_reviewer_receipt_path !== null) throw new Error('Finished regression must clear reviewer and become ready');
  }
  requireSame(changes.remediation, remediation, 'Regression append is not exact');
  requireEvidence(request, [resultPath, result.reviewer_receipt_path, ...receiptProtocolEvidence(completedRegression)]);
}

if (state.status === 'regression_review' && request.to === 'worker_running' && request.transition_kind === 'regression_correction') {
  expectedKind = 'regression_correction';
  requireKeys(changes, ['current_phase', 'current_attempt', 'active_worker', 'active_worker_receipt_path', 'active_reviewer', 'active_reviewer_receipt_path', 'base_sha', 'checkpoint_path', 'review_path', 'adjudication_path', 'remediation']);
  if (!state.remediation || state.remediation.status !== 'regression_checking') throw new Error('Regression correction requires an active downstream review');
  const phaseId = state.remediation.active_regression_phase;
  const failedRecord = changes.remediation?.failed_regression_results?.at(-1);
  const resultPath = failedRecord?.artifact_path;
  const result = artifact(resultPath, 'rushd.regression-review.v1');
  const completedRegression = receipt(result.reviewer_receipt_path, ['regression_reviewer'], 'completed');
  requireCompletedChild(completedRegression, state.active_reviewer_receipt_path, 'Failed regression reviewer');
  if (result.verdict !== 'needs_changes' || result.target_phase !== phaseId || result.remediation_owner_phase !== state.remediation.owner_phase || result.remediation_commit_sha !== state.remediation.remediation_commit_sha) throw new Error('Failed regression result does not match active remediation review');
  const record = recordFor(resultPath, { target_phase: phaseId, verdict: 'needs_changes', remediation_commit_sha: result.remediation_commit_sha });
  const remediation = remediationAfterRegressionFailure(state.remediation, record, state.phase_commits[state.remediation.owner_phase].length);
  requireSame(changes.remediation, remediation, 'Regression correction must persist the failure and reset the full ordered regression set');
  if (changes.current_phase !== remediation.owner_phase || changes.current_attempt !== state.current_attempt + 1 || changes.base_sha !== remediation.round_base_sha || changes.active_reviewer !== null || changes.active_reviewer_receipt_path !== null || changes.checkpoint_path !== null || changes.review_path !== null || changes.adjudication_path !== null || gitHead() !== remediation.round_base_sha) throw new Error('Regression correction did not reopen the remediation owner at the additive commit HEAD');
  const worker = validateWorkerStart(['remediation_worker'], remediation.owner_phase, changes.current_attempt, remediation.round_base_sha);
  if (worker.thread_id === state.active_reviewer || worker.environment !== 'worktree') throw new Error('Regression correction requires a fresh isolated remediation worker');
  requireEvidence(request, [resultPath, result.reviewer_receipt_path, ...receiptProtocolEvidence(completedRegression)]);
}

if (state.status === 'regression_review' && ['worker_running', 'final_audit'].includes(request.to) && request.transition_kind !== 'regression_correction') {
  expectedKind = request.to === 'worker_running' ? 'resume_interrupted' : 'resume_final_audits';
  if (!state.remediation || state.remediation.status !== 'ready_to_resume' || !sameJson(state.remediation.passed_regression_phases, state.remediation.required_regression_phases)) throw new Error('Cannot resume before every downstream regression passes');
  if (request.to !== state.remediation.return_status) throw new Error('Remediation return status changed');
  if (request.to === 'worker_running') {
    requireKeys(changes, ['current_phase', 'current_attempt', 'active_worker', 'active_worker_receipt_path', 'base_sha', 'remediation']);
    if (changes.current_phase !== state.remediation.return_phase || changes.current_attempt !== state.remediation.return_attempt || changes.active_worker !== state.remediation.return_worker_task_id || changes.base_sha !== state.remediation.remediation_commit_sha || changes.remediation !== null) throw new Error('Interrupted worker resume fields changed');
    const current = JSON.parse(execFileSync(process.execPath, [resolve(import.meta.dirname, 'compute-patch-hash.mjs'), changes.base_sha], { encoding: 'utf8' }));
    const saved = artifact(state.remediation.return_snapshot_manifest_path, 'rushd.patch-manifest.v1');
    if (!sameJson(current.files, saved.files)) throw new Error('Interrupted phase patch is not preserved at resume');
    const resumedWorker = receipt(changes.active_worker_receipt_path, ['phase_worker'], 'created');
    if (resumedWorker.thread_id !== changes.active_worker || resumedWorker.phase_id !== changes.current_phase || resumedWorker.attempt !== changes.current_attempt || resumedWorker.source_sha !== changes.base_sha) throw new Error('Interrupted phase must resume with a fresh App Server turn receipt');
    requireEvidence(request, [changes.active_worker_receipt_path, ...receiptProtocolEvidence(resumedWorker)]);
  } else {
    requireKeys(changes, ['current_phase', 'release_candidate_sha', 'final_audits', 'full_gate', 'publication_authority', 'post_deployment_verification', 'active_reviewer', 'active_reviewer_receipt_path', 'active_final_audit_id', 'remediation']);
    if (changes.current_phase !== 'P13' || changes.release_candidate_sha !== state.remediation.remediation_commit_sha || changes.release_candidate_sha === state.remediation.original_release_candidate_sha || changes.final_audits.length || changes.full_gate !== null || changes.publication_authority !== null || changes.post_deployment_verification !== null || changes.active_final_audit_id !== CANONICAL_AUDITS[0] || changes.remediation !== null) throw new Error('Final-audit remediation must create a new clean candidate and reset every release result');
    requireCleanTree();
    const auditor = receipt(changes.active_reviewer_receipt_path, ['final_auditor'], 'created');
    if (auditor.thread_id !== changes.active_reviewer || auditor.audit_id !== CANONICAL_AUDITS[0] || auditor.source_sha !== changes.release_candidate_sha) throw new Error('Restarted first final auditor is invalid');
  }
}

if (state.status === 'committed' && request.to === 'final_audit') {
  expectedKind = 'start_final_audits';
  requireKeys(changes, ['current_phase', 'release_candidate_sha', 'final_audits', 'full_gate', 'publication_authority', 'post_deployment_verification', 'active_reviewer', 'active_reviewer_receipt_path', 'active_final_audit_id']);
  if (!sameJson(state.completed_phases, phaseIds) || changes.current_phase !== 'P13' || changes.release_candidate_sha !== gitHead() || changes.final_audits.length || changes.full_gate !== null || changes.publication_authority !== null || changes.post_deployment_verification !== null || changes.active_final_audit_id !== CANONICAL_AUDITS[0]) throw new Error('Final audits require all phases and a fresh clean HEAD candidate');
  requireCleanTree();
  const auditor = receipt(changes.active_reviewer_receipt_path, ['final_auditor'], 'created');
  if (auditor.thread_id !== changes.active_reviewer || auditor.audit_id !== CANONICAL_AUDITS[0] || auditor.source_sha !== changes.release_candidate_sha) throw new Error('First final auditor is invalid');
}

if (state.status === 'final_audit' && request.to === 'final_audit' && request.transition_kind === 'record_final_audit') {
  expectedKind = 'record_final_audit';
  requireKeys(changes, ['final_audits', 'active_reviewer', 'active_reviewer_receipt_path', 'active_final_audit_id']);
  const expectedAudit = CANONICAL_AUDITS[state.final_audits.length];
  if (state.active_final_audit_id !== expectedAudit || !state.active_reviewer_receipt_path) throw new Error('No canonical active final auditor');
  const auditPath = changes.final_audits.at(-1)?.artifact_path;
  const audit = artifact(auditPath, 'rushd.final-audit.v1');
  const completedAuditor = receipt(audit.auditor_receipt_path, ['final_auditor'], 'completed');
  requireCompletedChild(completedAuditor, state.active_reviewer_receipt_path, 'Final auditor');
  if (audit.audit_id !== expectedAudit || audit.run_id !== state.run_id || audit.release_sha !== state.release_candidate_sha || audit.verdict !== 'pass') throw new Error('Final audit artifact does not match active auditor/candidate');
  const auditRecord = recordFor(auditPath, { audit_id: audit.audit_id, verdict: audit.verdict, release_sha: audit.release_sha });
  requireSame(changes.final_audits, [...state.final_audits, auditRecord], 'Final audit transition must append exactly one result');
  const nextAudit = CANONICAL_AUDITS[state.final_audits.length + 1] ?? null;
  if (nextAudit) {
    const next = receipt(changes.active_reviewer_receipt_path, ['final_auditor'], 'created');
    if (changes.active_final_audit_id !== nextAudit || next.thread_id !== changes.active_reviewer || next.thread_id === state.active_reviewer || next.audit_id !== nextAudit || next.source_sha !== state.release_candidate_sha) throw new Error('Next final auditor is not fresh or canonical');
    requireEvidence(request, [changes.active_reviewer_receipt_path, ...receiptProtocolEvidence(next), next.snapshot_manifest_path]);
  } else if (changes.active_reviewer !== null || changes.active_reviewer_receipt_path !== null || changes.active_final_audit_id !== null) throw new Error('Fifth audit must clear active auditor');
  requireEvidence(request, [auditPath, audit.auditor_receipt_path, ...receiptProtocolEvidence(completedAuditor)]);
}

if (state.status === 'final_audit' && request.to === 'final_audit' && request.transition_kind === 'record_full_gate') {
  expectedKind = 'record_full_gate';
  requireKeys(changes, ['full_gate']);
  if (state.final_audits.length !== CANONICAL_AUDITS.length || state.active_reviewer !== null || state.full_gate !== null) throw new Error('Full gate runs once after all five audits');
  const gate = artifact(changes.full_gate.artifact_path, 'rushd.full-gate.v1');
  requireRecord(changes.full_gate, changes.full_gate.artifact_path, { status: 'pass', release_sha: state.release_candidate_sha });
  if (gate.run_id !== state.run_id || gate.release_sha !== state.release_candidate_sha || gate.status !== 'pass') throw new Error('Full gate does not match run/release');
  requireEvidence(request, [changes.full_gate.artifact_path, gate.runner_receipt_path]);
}

if (state.status === 'final_audit' && request.to === 'final_audit' && request.transition_kind === 'record_post_deployment') {
  expectedKind = 'record_post_deployment';
  requireKeys(changes, ['post_deployment_verification']);
  if (!state.publication_authority || state.post_deployment_verification !== null) throw new Error('Post-deployment proof requires prior publication authority and runs once');
  const proof = artifact(changes.post_deployment_verification.artifact_path, 'rushd.post-deployment.v1');
  requireRecord(changes.post_deployment_verification, changes.post_deployment_verification.artifact_path, { status: 'pass', release_sha: state.release_candidate_sha });
  if (proof.run_id !== state.run_id || proof.release_sha !== state.release_candidate_sha || proof.status !== 'pass') throw new Error('Post-deployment proof does not match release');
  requireEvidence(request, [changes.post_deployment_verification.artifact_path, proof.launch_receipt_path]);
}

if (state.status === 'final_audit' && request.to === 'complete') {
  expectedKind = 'complete';
  requireKeys(changes, []);
  if (state.final_audits.length !== 5 || !state.full_gate || !state.publication_authority || !state.post_deployment_verification || state.remediation !== null || state.unexplained_changes.length || state.active_worker !== null || state.active_reviewer !== null) throw new Error('Run cannot complete before every release gate passes');
  requireCleanTree();
  requireEvidence(request, [...state.final_audits.map((item) => item.artifact_path), state.full_gate.artifact_path, state.publication_authority.artifact_path, state.post_deployment_verification.artifact_path]);
}

if (request.to === 'failed') {
  expectedKind = 'fail';
  requireKeys(changes, ['active_worker', 'active_worker_receipt_path', 'active_reviewer', 'active_reviewer_receipt_path', 'failure']);
  if (changes.active_worker !== null || changes.active_worker_receipt_path !== null || changes.active_reviewer !== null || changes.active_reviewer_receipt_path !== null || !isObject(changes.failure) || typeof changes.failure.code !== 'string' || typeof changes.failure.recovery !== 'string') throw new Error('Failed transition must preserve a structured recovery record and clear tasks');
}

if (!expectedKind || request.transition_kind !== expectedKind) throw new Error(`Expected transition_kind ${expectedKind ?? 'none'} for ${state.status} -> ${request.to}`);

const transientKeys = ['human_attestation_path', 'human_attestation_sha256', 'phase_commit_record', 'recovery_record_path', 'recovery_record_sha256', 'external_worker_continuation_path', 'external_worker_continuation_sha256'];
const persistedChanges = { ...changes };
for (const key of transientKeys) delete persistedChanges[key];
const previousHash = sha256Bytes(stateBytes);
const next = {
  ...state,
  ...persistedChanges,
  status: request.to,
  state_revision: state.state_revision + 1,
  genesis_state_sha256: state.state_revision === 0 ? previousHash : state.genesis_state_sha256,
  previous_state_sha256: previousHash,
  updated_at: new Date().toISOString()
};
if (state.status === 'human_required' || (request.to !== 'human_required' && !Object.hasOwn(changes, 'paused_tasks'))) next.paused_tasks = null;
const nextBytes = Buffer.from(`${JSON.stringify(next, null, 2)}\n`);
const nextHash = sha256Bytes(nextBytes);
writeFileSync(pendingPath, nextBytes);
const pendingFd = openSync(pendingPath, 'r');
fsyncSync(pendingFd);
closeSync(pendingFd);
validate(pendingPath, null, true);

const journalPath = resolve(next.transition_journal_path);
const event = {
  schema: 'rushd.state-transition-event.v1',
  event_id: request.event_id,
  at: next.updated_at,
  from: request.from,
  to: request.to,
  transition_kind: request.transition_kind,
  note: request.note,
  evidence: request.evidence.map((path) => ({ path, sha256: request.evidence_hashes[path] })),
  request_sha256: requestHash(request),
  previous_state_sha256: previousHash,
  next_state_sha256: nextHash,
  state_revision: next.state_revision
};
appendFileSync(journalPath, `${JSON.stringify(event)}\n`);
const journalFd = openSync(journalPath, 'r');
fsyncSync(journalFd);
closeSync(journalFd);
renameSync(pendingPath, statePath);
const directoryFd = openSync(dirname(statePath), 'r');
fsyncSync(directoryFd);
closeSync(directoryFd);
validate(statePath);

console.log(`${request.from} -> ${request.to} (${request.transition_kind}); revision ${next.state_revision}`);

#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

try {
  git('init', '--quiet');
  git('config', 'user.name', 'Rushd Workflow Self Test');
  git('config', 'user.email', 'workflow-selftest@example.invalid');
  const canonicalRoot = git('rev-parse', '--show-toplevel');
  writeFileSync(resolve(testRoot, 'baseline.txt'), 'baseline\n');
  git('add', 'baseline.txt');
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
  git('add', ...authorityPaths);
  git('commit', '--quiet', '-m', 'Rushd workflow authority');
  const authoritySha = git('rev-parse', 'HEAD');

  const taskRoot = `${runRelative}/tasks`;
  const threadRequest = { method: 'thread/start', id: 10, params: { model: 'gpt-5.6-sol', cwd: canonicalRoot, approvalPolicy: 'never', sandbox: 'workspace-write' } };
  const threadResponse = { id: 10, result: { thread: { id: 'thread-p00', sessionId: 'session-p00' } } };
  const turnRequest = { method: 'turn/start', id: 11, params: { threadId: 'thread-p00', input: [{ type: 'text', text: 'Implement P00.' }], model: 'gpt-5.6-sol', effort: 'high', cwd: canonicalRoot, approvalPolicy: 'never', sandboxPolicy: { type: 'workspaceWrite' } } };
  const turnResponse = { id: 11, result: { turn: { id: 'turn-p00', status: 'inProgress', items: [], error: null } } };
  const protocol = { 'thread-request.json': threadRequest, 'thread-response.json': threadResponse, 'turn-request.json': turnRequest, 'turn-response.json': turnResponse };
  for (const [name, body] of Object.entries(protocol)) writeJson(resolve(testRoot, taskRoot, name), body);
  const receiptPath = `${taskRoot}/worker-created.json`;
  writeJson(resolve(testRoot, receiptPath), {
    schema: 'rushd.task-receipt.v1', run_id: runId, role: 'phase_worker', status: 'created', phase_id: 'P00', audit_id: null, attempt: 1,
    thread_id: 'thread-p00', session_id: 'session-p00', turn_id: 'turn-p00', model: 'gpt-5.6-sol', thinking: 'high', environment: 'local', adapter: 'app_server', thread_create_method: 'thread/start', source_sha: authoritySha,
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
    checkpoint_path: null, review_path: null, adjudication_path: null, worker_threads: {}, review_attempts: {}, escalations: {}, base_sha: authoritySha, completed_phases: [], phase_commits: {}, remediation: null,
    release_candidate_sha: null, final_audits: [], full_gate: null, publication_authority: null, post_deployment_verification: null, human_required: null, resume_state: null, paused_tasks: null, failure: null,
    unexplained_changes: [], state_revision: 0, genesis_state_sha256: null, previous_state_sha256: null, transition_journal_path: `${runRelative}/state.journal.jsonl`, updated_at: null
  });
  requireSuccess('initial worker state validation', node([validator, statePath]));

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
    evidence: [receiptPath], evidence_hashes: { [receiptPath]: sha256File(resolve(testRoot, receiptPath)) },
    changes: {
      human_required: humanRequired, resume_state: 'worker_running', active_worker: null, active_worker_receipt_path: null, active_reviewer: null, active_reviewer_receipt_path: null, active_final_audit_id: null,
      paused_tasks: { active_worker: 'thread-p00', active_worker_receipt_path: receiptPath, active_reviewer: null, active_reviewer_receipt_path: null, active_final_audit_id: null }, remediation: null
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
      active_worker: 'thread-p00', active_worker_receipt_path: receiptPath, active_reviewer: null, active_reviewer_receipt_path: null, active_final_audit_id: null, remediation: null
    }
  });
  requireSuccess('human resume transition', node([transition, statePath, resumePath]));
  requireSuccess('resumed state/full journal validation', node([validator, statePath]));
  const resumed = JSON.parse(readFileSync(resolve(testRoot, statePath), 'utf8'));
  if (resumed.status !== 'worker_running' || resumed.state_revision !== 2 || !/^[0-9a-f]{64}$/.test(resumed.genesis_state_sha256)) throw new Error('Pause/resume did not preserve canonical state/journal metadata');
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
}

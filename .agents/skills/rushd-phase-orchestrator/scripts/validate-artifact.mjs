#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import {
  AUTHORITY_PATHS,
  CANONICAL_AUDITS,
  COMMIT_SANDBOX_ALLOWED_ACTIONS,
  COMMIT_SANDBOX_FORBIDDEN_ACTIONS,
  FINAL_AUDIT_COMMANDS,
  POST_DEPLOYMENT_CHECKS,
  P13_BETA_REQUIREMENT,
  REQUIRED_AUTHORITY_FILES,
  RUN_STATUSES,
  assertJournalChain,
  canonicalCommitSandboxPrompt,
  commitSandboxApprovalMismatch,
  commitSandboxBlockerParentMismatch,
  commitSandboxCompletionMismatch,
  commitSandboxContinuationMismatch,
  git,
  gitCommitExists,
  gitHead,
  isAncestor,
  isIsoUtc,
  isNonEmptyRegularFile,
  isObject,
  isPathInside,
  isSha1,
  isSha256,
  isStrictlyAfterIso,
  isTemplateRun,
  loadJson,
  manifestForCommitRange,
  matchesAny,
  phaseCommitOverlayRange,
  phaseFor,
  readPlan,
  sameJson,
  sameInstant,
  sealedAuthorityRule,
  sha256Bytes,
  sha256File,
  unique,
  validHttpUrl,
  validRunId
} from './workflow-lib.mjs';

const [input, relatedInput] = process.argv.slice(2);
if (!input) {
  console.error('Usage: validate-artifact.mjs <artifact.json> [related-artifact.json]');
  process.exit(2);
}

let value;
try {
  value = loadJson(input);
} catch (error) {
  console.error(`Invalid JSON: ${error.message}`);
  process.exit(1);
}

const failures = [];
const plan = readPlan();
const template = isTemplateRun(value.run_id);
const fail = (message) => failures.push(message);
const requireString = (object, key) => {
  if (typeof object?.[key] !== 'string' || object[key].length === 0) fail(`${key} must be a non-empty string`);
};
const requireArray = (object, key) => {
  if (!Array.isArray(object?.[key])) fail(`${key} must be an array`);
};
const requireObject = (object, key) => {
  if (!isObject(object?.[key])) fail(`${key} must be an object`);
};
const requireNullOrString = (object, key) => {
  if (object?.[key] !== null && (typeof object?.[key] !== 'string' || object[key].length === 0)) fail(`${key} must be null or a non-empty string`);
};
const requireArtifactHash = (path, hash, label) => {
  if (!isNonEmptyRegularFile(path)) fail(`${label} is missing, empty, or a symlink: ${String(path)}`);
  else if (!isSha256(hash) || sha256File(path) !== hash) fail(`${label} hash mismatch: ${path}`);
};
const requireEvidence = (paths, root, hashes, label) => {
  if (!Array.isArray(paths) || paths.length === 0) {
    fail(`${label} must contain evidence paths`);
    return;
  }
  if (!isObject(hashes)) {
    fail(`${label} evidence_hashes must be an object`);
    return;
  }
  for (const path of paths) {
    if (!isNonEmptyRegularFile(path)) fail(`${label} is missing, empty, or a symlink: ${String(path)}`);
    else {
      if (root && !isPathInside(path, root)) fail(`${label} is outside evidence_root: ${path}`);
      if (!isSha256(hashes[path]) || hashes[path] !== sha256File(path)) fail(`${label} hash mismatch: ${path}`);
    }
  }
};
const validateNested = (path, schema, related = null, sealed = false) => {
  if (typeof path !== 'string' || !existsSync(resolve(path))) {
    fail(`Missing related artifact: ${String(path)}`);
    return null;
  }
  try {
    const args = [resolve(import.meta.dirname, 'validate-artifact.mjs'), path];
    if (related) args.push(related);
    execFileSync(process.execPath, args, {
      encoding: 'utf8',
      env: { ...process.env, RUSHD_SEALED_ARTIFACT: sealed ? '1' : process.env.RUSHD_SEALED_ARTIFACT ?? '0' }
    });
    const artifact = loadJson(path);
    if (artifact.schema !== schema) fail(`Related artifact ${path} must use ${schema}`);
    return artifact;
  } catch (error) {
    fail(`Related artifact does not validate: ${path}: ${error.message}`);
    return null;
  }
};
const expectedRoot = (root, suffix, label) => {
  if (typeof root !== 'string' || !resolve(root).endsWith(suffix) || !existsSync(resolve(root)) || !statSync(resolve(root)).isDirectory() || lstatSync(resolve(root)).isSymbolicLink()) {
    fail(`${label} must be the existing non-symlink directory ending in ${suffix}`);
  }
};
const validateCommand = (command, root, runnerTaskId, label) => {
  if (!isObject(command) || typeof command.command !== 'string' || command.command.length === 0) {
    fail(`${label} command is malformed`);
    return;
  }
  if (command.exit_code !== 0) fail(`${label} command failed: ${command.command}`);
  if (typeof command.summary !== 'string' || command.summary.length < 8) fail(`${label} command summary is missing: ${command.command}`);
  if (!isNonEmptyRegularFile(command.log_path)) fail(`${label} command log is missing, empty, or a symlink: ${command.command}`);
  else {
    if (!isPathInside(command.log_path, root)) fail(`${label} command log is outside evidence_root: ${command.command}`);
    if (!isSha256(command.log_sha256) || sha256File(command.log_path) !== command.log_sha256) fail(`${label} command log hash mismatch: ${command.command}`);
  }
  if (!isIsoUtc(command.started_at) || !isIsoUtc(command.finished_at) || Date.parse(command.finished_at) < Date.parse(command.started_at)) fail(`${label} command timestamps are invalid: ${command.command}`);
  if (typeof command.cwd !== 'string' || !isAbsolute(command.cwd)) fail(`${label} command cwd must be absolute: ${command.command}`);
  if (typeof command.runner_task_id !== 'string' || command.runner_task_id !== runnerTaskId) fail(`${label} command runner does not match task receipt: ${command.command}`);
};
const validateExactCommands = (commands, required, root, runnerTaskId, label) => {
  if (!Array.isArray(commands)) {
    fail(`${label} commands must be an array`);
    return;
  }
  const names = commands.map((command) => command?.command);
  if (!sameJson([...names].sort(), [...required].sort())) fail(`${label} commands must exactly match the canonical command set`);
  if (!unique(names) || !unique(commands.map((command) => command?.log_path))) fail(`${label} commands and log paths must be unique`);
  for (const command of commands) validateCommand(command, root, runnerTaskId, label);
};
const validateChecks = (checks, requiredIds, verdict, root, hashes, label) => {
  if (!Array.isArray(checks)) {
    fail(`${label} checks must be an array`);
    return;
  }
  const ids = checks.map((check) => check?.id);
  if (!sameJson([...ids].sort(), [...requiredIds].sort())) fail(`${label} checks must exactly match canonical IDs`);
  if (!unique(ids)) fail(`${label} check IDs must be unique`);
  const allEvidence = checks.flatMap((check) => Array.isArray(check?.evidence) ? check.evidence : []);
  if (new Set(allEvidence).size < checks.length) fail(`${label} requires at least one distinct evidence artifact per check`);
  for (const check of checks) {
    if (!isObject(check) || !['pass', 'fail'].includes(check.status)) fail(`${label} check is malformed: ${String(check?.id)}`);
    else {
      requireEvidence(check.evidence, root, hashes, `${label} evidence for ${check.id}`);
      if (verdict === 'pass' && check.status !== 'pass') fail(`${label} PASS contains failed check ${check.id}`);
    }
  }
};
const loadReceipt = (path, expectedRole) => {
  const receipt = validateNested(path, 'rushd.task-receipt.v1');
  if (receipt && receipt.role !== expectedRole) fail(`Task receipt role must be ${expectedRole}`);
  return receipt;
};
const validateArtifactRecord = (record, schema, label, related = null) => {
  if (!isObject(record)) {
    fail(`${label} record is required`);
    return null;
  }
  requireArtifactHash(record.artifact_path, record.artifact_sha256, label);
  return validateNested(record.artifact_path, schema, related, true);
};
const requireSealedAuthorityCommit = (commit, runId, planVersion) => {
  const parents = git('rev-list', '--parents', '-n', '1', commit).trim().split(/\s+/);
  const changed = git('diff-tree', '--no-commit-id', '--name-only', '-r', commit).split('\n').filter(Boolean);
  if (parents.length !== 2 || changed.length === 0 || changed.some((path) => !matchesAny(path, AUTHORITY_PATHS))) throw new Error(`Authority overlay commit must be single-parented, nonempty, and authority-only: ${commit}`);
  const amendmentPaths = changed.filter((path) => /^docs\/implementation\/PLAN_AMENDMENT_[A-Z0-9_-]+\.json$/.test(path));
  if (amendmentPaths.length !== 1) throw new Error(`Authority overlay commit requires exactly one explicit plan amendment record: ${commit}`);
  const amendment = JSON.parse(git('show', `${commit}:${amendmentPaths[0]}`));
  const rule = sealedAuthorityRule(amendment.amendment_id, runId);
  const approvalPath = amendment.correction_revision === 1 ? rule?.correctionApproval : rule?.approval;
  const approval = approvalPath ? validateNested(approvalPath, 'rushd.authority-amendment-approval.v1') : null;
  const approvedManifest = approval ? validateNested(approval.candidate_manifest_path, 'rushd.patch-manifest.v1') : null;
  const parentPlan = JSON.parse(git('show', `${parents[1]}:docs/implementation/phase-plan.json`));
  const amendedPlan = JSON.parse(git('show', `${commit}:docs/implementation/phase-plan.json`));
  const expectedPlan = structuredClone(parentPlan);
  if (rule?.planChange === 'protect-amendments') {
    const index = expectedPlan.protected_paths.indexOf('docs/implementation/phase-plan.json');
    expectedPlan.protected_paths.splice(index + 1, 0, 'docs/implementation/PLAN_AMENDMENT_*.json');
  }
  const committedManifest = manifestForCommitRange(parents[1], commit);
  const subject = git('show', '-s', '--format=%s', commit).trim();
  if (!rule) throw new Error(`Authority overlay amendment is not allowlisted: ${commit}`);
  if (amendmentPaths[0] !== rule.path || amendment.schema !== 'rushd.plan-amendment.v1') throw new Error(`Authority overlay amendment record is not canonical: ${commit}`);
  if (amendment.founder_decision?.status !== 'approved' || amendment.founder_decision?.actor !== 'founder' || !isIsoUtc(amendment.founder_decision?.approved_at)) throw new Error(`Authority overlay lacks exact founder approval: ${commit}`);
  if (amendment.from_plan_version !== planVersion || amendment.to_plan_version !== planVersion || !sameJson(amendedPlan, expectedPlan)) throw new Error(`Authority overlay changes the plan version or unapproved plan content: ${commit}`);
  if (!sameJson([...changed].sort(), [...rule.paths].sort()) || !sameJson([...amendment.protected_paths_to_change].sort(), [...rule.paths].sort())) throw new Error(`Authority overlay changed paths differ from the allowlisted amendment scope: ${commit}; changed=${JSON.stringify([...changed].sort())}; expected=${JSON.stringify([...rule.paths].sort())}`);
  if (!subject.startsWith('Rushd authority: ')) throw new Error(`Authority overlay subject is invalid: ${commit}`);
  if (approval?.run_id !== runId || approval?.amendment_id !== amendment.amendment_id || !sameJson(committedManifest, approvedManifest)) throw new Error(`Authority overlay is unreviewed or differs from the exact approved candidate: ${commit}`);
  return { rule, approval, approvedManifest };
};

switch (value.schema) {
  case 'rushd.phase-plan.v1': {
    requireString(value, 'plan_version');
    requireString(value, 'repository_baseline');
    requireArray(value, 'protected_paths');
    requireArray(value, 'phases');
    requireObject(value, 'final_audit_checks');
    if (value.path_policy !== 'protected_paths_override_allowed_paths') fail('path_policy must make protected paths override allowed paths');
    if (!unique(value.protected_paths)) fail('protected_paths must be unique');
    const ids = [];
    const acceptanceIds = [];
    for (const phase of value.phases ?? []) {
      if (!isObject(phase) || typeof phase.id !== 'string' || !/^P\d{2}$/.test(phase.id)) fail('Every phase id must match PNN');
      ids.push(phase.id);
      if (!['medium', 'hard'].includes(phase.risk)) fail(`${phase.id}: invalid risk`);
      for (const key of ['depends_on', 'allowed_paths', 'acceptance', 'required_commands', 'manual_qa']) if (!Array.isArray(phase[key])) fail(`${phase.id}: ${key} must be an array`);
      if (phase.mandatory_human_gates !== undefined && !Array.isArray(phase.mandatory_human_gates)) fail(`${phase.id}: mandatory_human_gates must be an array`);
      if ((phase.allowed_paths ?? []).length === 0 || (phase.acceptance ?? []).length === 0) fail(`${phase.id}: allowed_paths and acceptance cannot be empty`);
      for (const item of phase.acceptance ?? []) {
        if (!isObject(item) || typeof item.id !== 'string' || !item.id.startsWith(`${phase.id}-A`) || typeof item.text !== 'string' || item.text.length === 0) fail(`${phase.id}: malformed acceptance item`);
        acceptanceIds.push(item.id);
      }
      for (const requirement of phase.manual_qa ?? []) if (typeof requirement !== 'string' || !requirement.startsWith(`${phase.id}-M`)) fail(`${phase.id}: manual QA IDs must be stable`);
      const mandatoryGateIds = [];
      for (const gate of phase.mandatory_human_gates ?? []) {
        if (!isObject(gate) || typeof gate.id !== 'string' || !gate.id.startsWith(`${phase.id}-`) || !['manual_qa', 'external'].includes(gate.kind) || typeof gate.requirement !== 'string' || !gate.requirement.startsWith(`${gate.id}:`) || !Number.isInteger(gate.minimum_duration_days) || gate.minimum_duration_days < 0) fail(`${phase.id}: malformed mandatory human gate`);
        else mandatoryGateIds.push(gate.id);
      }
      if (!unique(mandatoryGateIds)) fail(`${phase.id}: mandatory human gate IDs must be unique`);
      if (phase.id === 'P13') {
        const betaGate = phase.mandatory_human_gates?.find((gate) => gate.id === 'P13-BETA');
        if (!betaGate || betaGate.kind !== 'external' || betaGate.requirement !== P13_BETA_REQUIREMENT || betaGate.minimum_duration_days !== 28) fail('P13 must retain the exact mandatory 28-day P13-BETA gate');
      }
      for (const key of ['depends_on', 'allowed_paths', 'required_commands', 'manual_qa', 'required_skills']) if (phase[key] !== undefined && !unique(phase[key])) fail(`${phase.id}: ${key} must be unique`);
    }
    if (!unique(ids) || !unique(acceptanceIds)) fail('Phase and acceptance IDs must be unique');
    for (const phase of value.phases ?? []) for (const dependency of phase.depends_on ?? []) {
      if (!ids.includes(dependency) || ids.indexOf(dependency) >= ids.indexOf(phase.id)) fail(`${phase.id}: invalid dependency ${dependency}`);
    }
    if (!sameJson(Object.keys(value.final_audit_checks ?? {}).sort(), [...CANONICAL_AUDITS].sort())) fail('final_audit_checks must define the five canonical audits');
    for (const auditId of CANONICAL_AUDITS) {
      const checks = value.final_audit_checks?.[auditId];
      if (!Array.isArray(checks) || checks.length < 5 || !unique(checks) || checks.some((id) => typeof id !== 'string' || id.length === 0)) fail(`${auditId}: requires at least five unique checks`);
    }
    break;
  }

  case 'rushd.task-receipt.v1': {
    for (const key of ['run_id', 'role', 'status', 'thread_id', 'session_id', 'turn_id', 'model', 'thinking', 'environment', 'adapter', 'thread_create_method', 'source_sha', 'source_diff_status', 'prompt_sha256', 'thread_request_path', 'thread_request_sha256', 'thread_response_path', 'thread_response_sha256', 'turn_request_path', 'turn_request_sha256', 'turn_response_path', 'turn_response_sha256']) requireString(value, key);
    requireNullOrString(value, 'snapshot_manifest_path');
    requireNullOrString(value, 'lifecycle_parent_path');
    requireNullOrString(value, 'lifecycle_parent_sha256');
    requireNullOrString(value, 'turn_completed_path');
    requireNullOrString(value, 'turn_completed_sha256');
    if (value.capability_scope !== undefined || value.capability_artifact_path !== undefined || value.capability_artifact_sha256 !== undefined) {
      requireString(value, 'capability_scope');
      requireString(value, 'capability_artifact_path');
      requireString(value, 'capability_artifact_sha256');
    }
    if (!Number.isInteger(value.attempt) || value.attempt < 0) fail('Task receipt attempt must be a non-negative integer');
    if (!['manager', 'phase_worker', 'remediation_worker', 'phase_reviewer', 'adjudicator', 'regression_reviewer', 'final_auditor', 'launch_worker'].includes(value.role)) fail('Invalid task receipt role');
    if (!['created', 'completed'].includes(value.status)) fail('Invalid task receipt status');
    if (!['local', 'worktree'].includes(value.environment)) fail('Invalid task receipt environment');
    if (!['pending', 'clean', 'explained'].includes(value.source_diff_status)) fail('Invalid source_diff_status');
    const runtimeAdapters = { app_server: 'thread/start', zcode_glm: 'session/start' };
    if (runtimeAdapters[value.adapter] !== value.thread_create_method) fail('Task receipts must use a documented runtime adapter');
    if (template) break;
    if (!validRunId(value.run_id) || !gitCommitExists(value.source_sha)) fail('Task receipt requires a valid run and existing source commit');
    if (!isIsoUtc(value.created_at) || (value.completed_at !== null && !isIsoUtc(value.completed_at))) fail('Task receipt timestamps are invalid');
    if (value.status === 'created' && (value.completed_at !== null || value.source_diff_status !== 'pending' || value.lifecycle_parent_path !== null || value.lifecycle_parent_sha256 !== null || value.turn_completed_path !== null || value.turn_completed_sha256 !== null)) fail('Created receipt must be an immutable pending lifecycle root');
    if (value.status === 'completed' && (!isIsoUtc(value.completed_at) || value.source_diff_status === 'pending' || typeof value.lifecycle_parent_path !== 'string' || typeof value.lifecycle_parent_sha256 !== 'string' || typeof value.turn_completed_path !== 'string' || typeof value.turn_completed_sha256 !== 'string')) fail('Completed receipt needs a distinct immutable parent and completion event');
    const taskRoot = `.codex/runs/${value.run_id}/tasks`;
    const protocolFiles = [
      ['thread request', value.thread_request_path, value.thread_request_sha256],
      ['thread response', value.thread_response_path, value.thread_response_sha256],
      ['turn request', value.turn_request_path, value.turn_request_sha256],
      ['turn response', value.turn_response_path, value.turn_response_sha256]
    ];
    for (const [label, path, hash] of protocolFiles) {
      requireArtifactHash(path, hash, `Task ${label}`);
      if (isNonEmptyRegularFile(path) && !isPathInside(path, taskRoot)) fail(`Task ${label} must be under the run task root`);
    }
    try {
      const threadRequest = loadJson(value.thread_request_path);
      const threadResponse = loadJson(value.thread_response_path);
      const turnRequest = loadJson(value.turn_request_path);
      const turnResponse = loadJson(value.turn_response_path);
      const expectedCwd = value.environment === 'worktree' ? value.worktree_path : git('rev-parse', '--show-toplevel').trim();
      const sessionKey = value.adapter === 'app_server' ? 'threadId' : 'sessionId';
      const resultSessionKey = value.adapter === 'app_server' ? 'thread' : 'session';
      if (threadRequest.method !== value.thread_create_method || threadRequest.id === undefined || threadRequest.params?.model !== value.model || threadRequest.params?.cwd !== expectedCwd || threadRequest.params?.approvalPolicy !== 'never' || threadRequest.params?.sandbox !== 'workspace-write') fail(`${value.adapter} session/start request does not match receipt policy`);
      if (threadResponse.id !== threadRequest.id || threadResponse.error !== undefined || threadResponse.result?.[resultSessionKey]?.id !== value.thread_id || threadResponse.result?.[resultSessionKey]?.sessionId !== value.session_id) fail(`${value.adapter} session/start response does not match receipt identity`);
      if (turnRequest.method !== 'turn/start' || turnRequest.id === undefined || turnRequest.params?.[sessionKey] !== value.thread_id || turnRequest.params?.model !== value.model || turnRequest.params?.effort !== value.thinking || turnRequest.params?.cwd !== expectedCwd || turnRequest.params?.approvalPolicy !== 'never' || !Array.isArray(turnRequest.params?.input) || turnRequest.params.input.length === 0 || sha256Bytes(Buffer.from(JSON.stringify(turnRequest.params.input))) !== value.prompt_sha256) fail(`${value.adapter} turn/start request does not match receipt policy/prompt hash`);
      const sandboxType = turnRequest.params?.sandboxPolicy?.type;
      if (sandboxType === 'dangerFullAccess') {
        requireArtifactHash(value.capability_artifact_path, value.capability_artifact_sha256, 'Commit sandbox authorization');
        const authorization = validateNested(value.capability_artifact_path, 'rushd.phase-commit-sandbox-authorization.v1');
        const mismatch = commitSandboxContinuationMismatch(value, authorization, turnRequest);
        if (mismatch) fail(`${value.adapter} commit continuation is invalid: ${mismatch}`);
      } else if (sandboxType !== 'workspaceWrite') fail('App Server turn/start sandbox policy is not permitted');
      if (turnResponse.id !== turnRequest.id || turnResponse.error !== undefined || turnResponse.result?.turn?.id !== value.turn_id || turnResponse.result?.turn?.status !== 'inProgress') fail(`${value.adapter} turn/start response does not match receipt identity`);
    } catch (error) { fail(`Task ${value.adapter} transcript is invalid: ${error.message}`); }
    if (value.status === 'completed') {
      requireArtifactHash(value.lifecycle_parent_path, value.lifecycle_parent_sha256, 'Task lifecycle parent');
      const parent = validateNested(value.lifecycle_parent_path, 'rushd.task-receipt.v1');
      const stableKeys = ['run_id', 'role', 'phase_id', 'audit_id', 'attempt', 'thread_id', 'session_id', 'turn_id', 'model', 'thinking', 'environment', 'adapter', 'thread_create_method', 'source_sha', 'snapshot_patch_sha256', 'snapshot_manifest_path', 'worktree_path', 'created_at', 'prompt_sha256', 'thread_request_path', 'thread_request_sha256', 'thread_response_path', 'thread_response_sha256', 'turn_request_path', 'turn_request_sha256', 'turn_response_path', 'turn_response_sha256', 'capability_scope', 'capability_artifact_path', 'capability_artifact_sha256'];
      if (parent && (parent.status !== 'created' || stableKeys.some((key) => !sameJson(parent[key], value[key])))) fail('Completed task receipt does not extend its immutable created receipt');
      requireArtifactHash(value.turn_completed_path, value.turn_completed_sha256, 'Task completion event');
      if (isNonEmptyRegularFile(value.turn_completed_path) && !isPathInside(value.turn_completed_path, taskRoot)) fail('Task completion event must be under the run task root');
      try {
        const completed = loadJson(value.turn_completed_path);
        const completionSessionKey = value.adapter === 'app_server' ? 'threadId' : 'sessionId';
        if (completed.method !== 'turn/completed' || completed.params?.[completionSessionKey] !== value.thread_id || completed.params?.turn?.id !== value.turn_id || completed.params?.turn?.status !== 'completed') fail('Task completion event does not prove a completed turn in the receipt session');
      } catch (error) { fail(`Task completion event is invalid: ${error.message}`); }
    }
    const phase = value.phase_id === null ? null : phaseFor(plan, value.phase_id);
    if (value.phase_id !== null && !phase) fail('Task receipt phase_id is unknown');
    const routing = {
      phase_worker: [['gpt-5.6-sol', 'high'], ['glm-5.3', 'high']],
      remediation_worker: [['gpt-5.6-sol', 'high'], ['glm-5.3', 'high']],
      phase_reviewer: [['gpt-5.6-sol', phase?.risk === 'medium' ? 'medium' : 'high'], ['glm-5.3', phase?.risk === 'medium' ? 'medium' : 'high']],
      adjudicator: [['gpt-5.6-sol', 'xhigh'], ['glm-5.3', 'xhigh']],
      regression_reviewer: [['gpt-5.6-sol', 'high'], ['glm-5.3', 'high']],
      final_auditor: [['gpt-5.6-sol', 'high'], ['glm-5.3', 'high']],
      manager: [['gpt-5.6-sol', 'high'], ['glm-5.3', 'high']],
      launch_worker: [['gpt-5.6-sol', 'high'], ['glm-5.3', 'high']]
    }[value.role];
    if (!routing || !routing.some(([model, thinking]) => value.model === model && value.thinking === thinking) || value.environment !== (value.role === 'phase_worker' || value.role === 'manager' || value.role === 'launch_worker' ? 'local' : 'worktree')) fail(`${value.role} receipt has wrong model/effort/environment`);
    if (['phase_worker', 'remediation_worker', 'phase_reviewer', 'regression_reviewer'].includes(value.role) && (!phase || value.attempt < 1)) fail(`${value.role} requires a phase and positive attempt`);
    if (value.role === 'final_auditor' && !CANONICAL_AUDITS.includes(value.audit_id)) fail('Final auditor receipt requires canonical audit_id');
    if (value.environment === 'worktree') {
      if (!isSha256(value.snapshot_patch_sha256) || typeof value.worktree_path !== 'string' || !isAbsolute(value.worktree_path)) fail('Worktree receipt requires snapshot hash and absolute worktree path');
      const manifest = validateNested(value.snapshot_manifest_path, 'rushd.patch-manifest.v1');
      if (manifest && (manifest.base_sha !== value.source_sha || manifest.patch_sha256 !== value.snapshot_patch_sha256)) fail('Worktree snapshot manifest does not match receipt');
    } else if (value.snapshot_patch_sha256 !== null || value.snapshot_manifest_path !== null || value.worktree_path !== null) fail('Local receipt cannot claim worktree snapshot fields');
    if (['phase_reviewer', 'adjudicator', 'regression_reviewer', 'final_auditor'].includes(value.role) && value.status === 'completed' && value.source_diff_status !== 'clean') fail('Completed reviewer receipt must prove a clean source diff');
    break;
  }

  case 'rushd.worker-turn-recovery.v1': {
    for (const key of ['run_id', 'phase_id', 'classification', 'thread_id', 'base_sha', 'patch_sha256', 'authority_amendment_approval_path', 'authority_amendment_approval_sha256', 'authority_amendment_commit_sha', 'interruption_record_path', 'interruption_record_sha256', 'original_created_receipt_path', 'original_created_receipt_sha256', 'failed_turn_completed_path', 'failed_turn_completed_sha256', 'followup_created_receipt_path', 'followup_created_receipt_sha256', 'followup_completed_receipt_path', 'followup_completed_receipt_sha256', 'patch_manifest_path', 'patch_manifest_sha256', 'recovered_at']) requireString(value, key);
    requireArray(value, 'preserved_evidence_paths');
    requireObject(value, 'evidence_hashes');
    if (!Number.isInteger(value.attempt) || value.attempt < 1) fail('Worker-turn recovery attempt must be positive');
    if (value.classification !== 'external_usage_limit') fail('Worker-turn recovery is limited to external_usage_limit');
    if (template) break;
    if (!validRunId(value.run_id) || !phaseFor(plan, value.phase_id) || !gitCommitExists(value.base_sha) || !isSha256(value.patch_sha256) || !isIsoUtc(value.recovered_at)) fail('Worker-turn recovery run/phase/base/hash/time is invalid');
    const original = validateNested(value.original_created_receipt_path, 'rushd.task-receipt.v1');
    const followupCreated = validateNested(value.followup_created_receipt_path, 'rushd.task-receipt.v1');
    const followupCompleted = validateNested(value.followup_completed_receipt_path, 'rushd.task-receipt.v1');
    requireArtifactHash(value.original_created_receipt_path, value.original_created_receipt_sha256, 'Original worker receipt');
    requireArtifactHash(value.authority_amendment_approval_path, value.authority_amendment_approval_sha256, 'Worker recovery authority amendment approval');
    requireArtifactHash(value.interruption_record_path, value.interruption_record_sha256, 'Original interruption classification');
    requireArtifactHash(value.failed_turn_completed_path, value.failed_turn_completed_sha256, 'Failed worker turn event');
    requireArtifactHash(value.followup_created_receipt_path, value.followup_created_receipt_sha256, 'Follow-up created receipt');
    requireArtifactHash(value.followup_completed_receipt_path, value.followup_completed_receipt_sha256, 'Follow-up completed receipt');
    requireArtifactHash(value.patch_manifest_path, value.patch_manifest_sha256, 'Recovery patch manifest');
    const manifest = validateNested(value.patch_manifest_path, 'rushd.patch-manifest.v1');
    const approval = validateNested(value.authority_amendment_approval_path, 'rushd.authority-amendment-approval.v1');
    const workerRoles = ['phase_worker', 'remediation_worker'];
    if (original && (!workerRoles.includes(original.role) || original.status !== 'created')) fail('Original recovery receipt must be an immutable worker created receipt');
    if (followupCreated && (!workerRoles.includes(followupCreated.role) || followupCreated.status !== 'created')) fail('Follow-up recovery receipt must be an immutable worker created receipt');
    if (followupCompleted && (!workerRoles.includes(followupCompleted.role) || followupCompleted.status !== 'completed' || followupCompleted.source_diff_status !== 'explained')) fail('Follow-up recovery completion must be an explained worker receipt');
    const identityKeys = ['run_id', 'role', 'phase_id', 'attempt', 'thread_id', 'session_id', 'model', 'thinking', 'environment', 'adapter', 'thread_create_method', 'source_sha'];
    if (original && followupCreated && identityKeys.some((key) => !sameJson(original[key], followupCreated[key]))) fail('Follow-up recovery changed worker thread, phase, attempt, role, source, or routing identity');
    if (original && (original.run_id !== value.run_id || original.phase_id !== value.phase_id || original.attempt !== value.attempt || original.thread_id !== value.thread_id || original.source_sha !== value.base_sha)) fail('Recovery record does not match its original worker identity');
    if (followupCreated && followupCreated.turn_id === original?.turn_id) fail('Recovery follow-up must use a distinct turn in the same task');
    if (followupCreated && followupCompleted && (followupCompleted.lifecycle_parent_path !== value.followup_created_receipt_path || followupCompleted.lifecycle_parent_sha256 !== value.followup_created_receipt_sha256)) fail('Recovery completion receipt was substituted or does not extend the follow-up created receipt');
    if (manifest && (manifest.base_sha !== value.base_sha || manifest.patch_sha256 !== value.patch_sha256)) fail('Recovery patch manifest changed the worker base or patch');
    try {
      const commitParents = git('rev-list', '--parents', '-n', '1', value.authority_amendment_commit_sha).trim().split(/\s+/);
      const authorityManifest = approval ? validateNested(approval.candidate_manifest_path, 'rushd.patch-manifest.v1') : null;
      const committedManifest = manifestForCommitRange(value.base_sha, value.authority_amendment_commit_sha);
      if (commitParents.length !== 2 || commitParents[1] !== value.base_sha || approval?.run_id !== value.run_id || approval?.amendment_id !== 'RUSHD-20260811-WORKER-TURN-RECOVERY' || !sameJson(committedManifest, authorityManifest)) fail('Recovery authority amendment commit is not the exact approved direct child of the preserved worker base');
    } catch (error) { fail(`Recovery authority amendment commit is invalid: ${error.message}`); }
    try {
      const failed = loadJson(value.failed_turn_completed_path);
      if (failed.method !== 'turn/completed' || failed.params?.threadId !== original?.thread_id || failed.params?.turn?.id !== original?.turn_id || failed.params?.turn?.status !== 'failed' || failed.params?.turn?.error?.codexErrorInfo !== 'usageLimitExceeded') fail('Recovery requires the preserved original usageLimitExceeded turn/completed event in the worker thread');
    } catch (error) { fail(`Failed worker turn event is invalid: ${error.message}`); }
    try {
      const interruption = loadJson(value.interruption_record_path);
      if (interruption.schema !== 'rushd.controller-recovery.v1' || interruption.classification !== 'account_usage_limit_interruption' || interruption.attempt_consumed !== false || interruption.phase_relaunch_required !== false || interruption.recovery_action !== 'resume_same_phase_task_with_fresh_turn' || interruption.run_id !== value.run_id || interruption.phase_id !== value.phase_id || interruption.attempt !== value.attempt || interruption.thread_id !== value.thread_id || interruption.base_sha !== value.base_sha || interruption.patch_sha256 !== value.patch_sha256 || interruption.created_receipt_path !== value.original_created_receipt_path || interruption.created_receipt_sha256 !== value.original_created_receipt_sha256 || interruption.failed_turn_completed_path !== value.failed_turn_completed_path || interruption.failed_turn_completed_sha256 !== value.failed_turn_completed_sha256 || interruption.failure_code !== 'usageLimitExceeded') fail('Recovery does not match the preserved original interruption classification');
    } catch (error) { fail(`Original interruption classification is invalid: ${error.message}`); }
    const requiredEvidence = [
      value.interruption_record_path,
      value.authority_amendment_approval_path,
      value.original_created_receipt_path,
      value.failed_turn_completed_path,
      value.followup_created_receipt_path,
      value.followup_completed_receipt_path,
      value.patch_manifest_path
    ];
    if (!unique(value.preserved_evidence_paths) || requiredEvidence.some((path) => !value.preserved_evidence_paths.includes(path))) fail('Recovery preserved_evidence_paths omits a required lifecycle artifact');
    requireEvidence(value.preserved_evidence_paths, null, value.evidence_hashes, 'Worker-turn recovery evidence');
    break;
  }

  case 'rushd.external-runtime-evidence.v1': {
    for (const key of ['run_id', 'phase_id', 'gate_id', 'browser_name', 'browser_version', 'binary_path', 'endpoint_host', 'transport', 'version_proof_path', 'version_proof_sha256', 'recorded_at']) requireString(value, key);
    if (!Number.isInteger(value.endpoint_port) || value.endpoint_port < 1024 || value.endpoint_port > 65535) fail('External runtime endpoint_port is invalid');
    if (value.browser_name !== 'Playwright Chromium' || value.browser_version !== '151.0.7922.34' || value.endpoint_host !== '127.0.0.1' || value.transport !== 'cdp' || value.synthetic_data_only !== true || value.launched_outside_worker_sandbox !== true) fail('External runtime evidence weakens the authorized pinned-browser boundary');
    if (!isAbsolute(value.binary_path) || !isIsoUtc(value.recorded_at)) fail('External runtime binary path/time is invalid');
    if (template) break;
    if (!validRunId(value.run_id) || value.phase_id !== 'P00' || value.gate_id !== 'EXTERNAL-P00-PINNED-CHROMIUM') fail('External runtime evidence is not bound to the authorized P00 gate');
    requireArtifactHash(value.version_proof_path, value.version_proof_sha256, 'External runtime version proof');
    try {
      const proof = loadJson(value.version_proof_path);
      if (proof.Browser !== 'HeadlessChrome/151.0.7922.34' || typeof proof.webSocketDebuggerUrl !== 'string' || !proof.webSocketDebuggerUrl.startsWith(`ws://127.0.0.1:${value.endpoint_port}/`)) fail('External runtime version proof does not show the exact localhost-only pinned browser');
    } catch (error) { fail(`External runtime version proof is invalid: ${error.message}`); }
    break;
  }

  case 'rushd.external-worker-continuation.v1': {
    for (const key of ['run_id', 'phase_id', 'classification', 'gate_id', 'gate_request_sha256', 'thread_id', 'base_sha', 'patch_sha256', 'human_attestation_path', 'human_attestation_sha256', 'prior_authority_amendment_approval_path', 'prior_authority_amendment_approval_sha256', 'prior_authority_amendment_commit_sha', 'authority_amendment_approval_path', 'authority_amendment_approval_sha256', 'authority_amendment_commit_sha', 'prior_created_receipt_path', 'prior_created_receipt_sha256', 'prior_completed_receipt_path', 'prior_completed_receipt_sha256', 'prior_turn_completed_path', 'prior_turn_completed_sha256', 'followup_created_receipt_path', 'followup_created_receipt_sha256', 'followup_completed_receipt_path', 'followup_completed_receipt_sha256', 'runtime_evidence_path', 'runtime_evidence_sha256', 'patch_manifest_path', 'patch_manifest_sha256', 'continued_at']) requireString(value, key);
    requireArray(value, 'preserved_evidence_paths');
    requireObject(value, 'evidence_hashes');
    if (!Number.isInteger(value.attempt) || value.attempt < 1) fail('External continuation attempt must be positive');
    if (value.classification !== 'founder_attested_external_runtime') fail('External continuation classification is not authorized');
    if (template) break;
    if (!validRunId(value.run_id) || value.phase_id !== 'P00' || value.gate_id !== 'EXTERNAL-P00-PINNED-CHROMIUM' || !isSha256(value.gate_request_sha256) || !gitCommitExists(value.base_sha) || !isSha256(value.patch_sha256) || !isIsoUtc(value.continued_at)) fail('External continuation run/gate/base/hash/time is invalid');
    const attestation = validateNested(value.human_attestation_path, 'rushd.human-attestation.v1');
    const priorApproval = validateNested(value.prior_authority_amendment_approval_path, 'rushd.authority-amendment-approval.v1');
    const approval = validateNested(value.authority_amendment_approval_path, 'rushd.authority-amendment-approval.v1');
    const priorCreated = validateNested(value.prior_created_receipt_path, 'rushd.task-receipt.v1');
    const priorCompleted = validateNested(value.prior_completed_receipt_path, 'rushd.task-receipt.v1');
    const followupCreated = validateNested(value.followup_created_receipt_path, 'rushd.task-receipt.v1');
    const followupCompleted = validateNested(value.followup_completed_receipt_path, 'rushd.task-receipt.v1');
    const runtime = validateNested(value.runtime_evidence_path, 'rushd.external-runtime-evidence.v1');
    const manifest = validateNested(value.patch_manifest_path, 'rushd.patch-manifest.v1');
    for (const [path, hash, label] of [
      [value.human_attestation_path, value.human_attestation_sha256, 'External continuation human attestation'],
      [value.prior_authority_amendment_approval_path, value.prior_authority_amendment_approval_sha256, 'Prior authority approval'],
      [value.authority_amendment_approval_path, value.authority_amendment_approval_sha256, 'External continuation authority approval'],
      [value.prior_created_receipt_path, value.prior_created_receipt_sha256, 'Prior worker created receipt'],
      [value.prior_completed_receipt_path, value.prior_completed_receipt_sha256, 'Prior worker completed receipt'],
      [value.prior_turn_completed_path, value.prior_turn_completed_sha256, 'Prior worker turn completion'],
      [value.followup_created_receipt_path, value.followup_created_receipt_sha256, 'Follow-up worker created receipt'],
      [value.followup_completed_receipt_path, value.followup_completed_receipt_sha256, 'Follow-up worker completed receipt'],
      [value.runtime_evidence_path, value.runtime_evidence_sha256, 'External runtime evidence'],
      [value.patch_manifest_path, value.patch_manifest_sha256, 'External continuation patch manifest']
    ]) requireArtifactHash(path, hash, label);
    const workerRoles = ['phase_worker', 'remediation_worker'];
    if (priorCreated && (!workerRoles.includes(priorCreated.role) || priorCreated.status !== 'created')) fail('Prior continuation receipt must be an immutable worker created receipt');
    if (priorCompleted && (!workerRoles.includes(priorCompleted.role) || priorCompleted.status !== 'completed' || priorCompleted.source_diff_status !== 'explained' || priorCompleted.lifecycle_parent_path !== value.prior_created_receipt_path || priorCompleted.lifecycle_parent_sha256 !== value.prior_created_receipt_sha256 || priorCompleted.turn_completed_path !== value.prior_turn_completed_path)) fail('Prior completed receipt is substituted or does not extend the paused created receipt');
    if (followupCreated && (!workerRoles.includes(followupCreated.role) || followupCreated.status !== 'created')) fail('Follow-up continuation receipt must be an immutable worker created receipt');
    if (followupCompleted && (!workerRoles.includes(followupCompleted.role) || followupCompleted.status !== 'completed' || followupCompleted.source_diff_status !== 'explained' || followupCompleted.lifecycle_parent_path !== value.followup_created_receipt_path || followupCompleted.lifecycle_parent_sha256 !== value.followup_created_receipt_sha256)) fail('Follow-up completion is substituted or does not extend its created receipt');
    const identityKeys = ['run_id', 'role', 'phase_id', 'attempt', 'thread_id', 'session_id', 'model', 'thinking', 'environment', 'adapter', 'thread_create_method', 'source_sha'];
    if (priorCreated && followupCreated && identityKeys.some((key) => !sameJson(priorCreated[key], followupCreated[key]))) fail('External continuation changed worker thread, phase, attempt, role, source, or routing identity');
    if (priorCreated && (priorCreated.run_id !== value.run_id || priorCreated.phase_id !== value.phase_id || priorCreated.attempt !== value.attempt || priorCreated.thread_id !== value.thread_id || priorCreated.source_sha !== value.base_sha)) fail('External continuation does not match its paused worker identity');
    if (followupCreated && followupCreated.turn_id === priorCreated?.turn_id) fail('External continuation must use a distinct turn in the same task');
    if (manifest && (manifest.base_sha !== value.base_sha || manifest.patch_sha256 !== value.patch_sha256)) fail('External continuation changed the worker base or product patch');
    if (attestation && (attestation.run_id !== value.run_id || attestation.phase_id !== value.phase_id || attestation.gate_id !== value.gate_id || attestation.gate_request_sha256 !== value.gate_request_sha256 || attestation.actor !== 'founder' || attestation.result !== 'pass')) fail('External continuation lacks the exact founder-attested gate');
    if (runtime && (runtime.run_id !== value.run_id || runtime.phase_id !== value.phase_id || runtime.gate_id !== value.gate_id)) fail('External runtime evidence is not bound to the continuation');
    try {
      const priorTurn = loadJson(value.prior_turn_completed_path);
      const finalMessages = priorTurn.params?.turn?.items?.filter((item) => item?.type === 'agentMessage' && item?.phase === 'final_answer').map((item) => item.text) ?? [];
      if (priorTurn.method !== 'turn/completed' || priorTurn.params?.threadId !== value.thread_id || priorTurn.params?.turn?.id !== priorCreated?.turn_id || priorTurn.params?.turn?.status !== 'completed' || priorTurn.params?.turn?.error !== null || !finalMessages.some((text) => /pinned Chromium/i.test(text) && /sandbox/i.test(text) && /(?:no\b[^.]*\bcheckpoint was written|checkpoint was not written|not ready for review)/i.test(text))) fail('External continuation requires the preserved completed no-checkpoint sandbox-runtime blocker');
    } catch (error) { fail(`Prior worker completion evidence is invalid: ${error.message}`); }
    try {
      const priorParents = git('rev-list', '--parents', '-n', '1', value.prior_authority_amendment_commit_sha).trim().split(/\s+/);
      const parents = git('rev-list', '--parents', '-n', '1', value.authority_amendment_commit_sha).trim().split(/\s+/);
      const priorManifest = priorApproval ? validateNested(priorApproval.candidate_manifest_path, 'rushd.patch-manifest.v1') : null;
      const amendmentManifest = approval ? validateNested(approval.candidate_manifest_path, 'rushd.patch-manifest.v1') : null;
      if (priorParents.length !== 2 || priorParents[1] !== value.base_sha || priorApproval?.run_id !== value.run_id || priorApproval?.amendment_id !== 'RUSHD-20260811-WORKER-TURN-RECOVERY' || !sameJson(manifestForCommitRange(value.base_sha, value.prior_authority_amendment_commit_sha), priorManifest)) fail('Prior worker-recovery authority commit is not the exact sealed direct child of the worker base');
      if (parents.length !== 2 || parents[1] !== value.prior_authority_amendment_commit_sha || approval?.run_id !== value.run_id || approval?.amendment_id !== 'RUSHD-20260811-EXTERNAL-WORKER-CONTINUATION' || !sameJson(manifestForCommitRange(value.prior_authority_amendment_commit_sha, value.authority_amendment_commit_sha), amendmentManifest)) fail('External-continuation authority commit is not the exact sealed child of the prior amendment');
      const prerequisites = [attestation?.performed_at, priorApproval?.approved_at, approval?.approved_at, runtime?.recorded_at, git('show', '-s', '--format=%cI', value.prior_authority_amendment_commit_sha).trim(), git('show', '-s', '--format=%cI', value.authority_amendment_commit_sha).trim()];
      if (!isIsoUtc(followupCreated?.created_at) || !isIsoUtc(followupCompleted?.completed_at) || prerequisites.some((time) => typeof time !== 'string' || Number.isNaN(Date.parse(time))) || prerequisites.some((time) => Date.parse(time) > Date.parse(followupCreated.created_at)) || Date.parse(followupCompleted.completed_at) < Date.parse(followupCreated.created_at) || Date.parse(value.continued_at) < Date.parse(followupCompleted.completed_at)) fail('External continuation follow-up predates its founder, authority, runtime, or lifecycle prerequisite');
      const committedAuthority = manifestForCommitRange(value.base_sha, value.authority_amendment_commit_sha);
      const authorityPaths = new Set(committedAuthority.files.map((file) => file.path));
      const current = JSON.parse(execFileSync(process.execPath, [resolve(import.meta.dirname, 'compute-patch-hash.mjs'), value.base_sha], { encoding: 'utf8' }));
      const expectedFiles = [...committedAuthority.files, ...(manifest?.files ?? [])].sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
      if (gitHead() !== value.authority_amendment_commit_sha || manifest?.files?.some((file) => authorityPaths.has(file.path)) || !sameJson(current.files, expectedFiles)) fail('External continuation product patch plus sealed authority chain does not match the current checkout');
    } catch (error) { fail(`External continuation authority chain is invalid: ${error.message}`); }
    const requiredEvidence = [value.human_attestation_path, value.prior_authority_amendment_approval_path, value.authority_amendment_approval_path, value.prior_created_receipt_path, value.prior_completed_receipt_path, value.prior_turn_completed_path, value.followup_created_receipt_path, value.followup_completed_receipt_path, value.runtime_evidence_path, value.patch_manifest_path];
    if (!unique(value.preserved_evidence_paths) || requiredEvidence.some((path) => !value.preserved_evidence_paths.includes(path))) fail('External continuation omits required immutable evidence');
    requireEvidence(value.preserved_evidence_paths, null, value.evidence_hashes, 'External continuation evidence');
    break;
  }

  case 'rushd.authority-amendment-review.v1': {
    for (const key of ['run_id', 'amendment_id', 'candidate_patch_sha256', 'verdict', 'confidence', 'reviewer_source_diff', 'reviewed_at', 'reviewer_receipt_path']) requireString(value, key);
    for (const key of ['checks', 'commands', 'findings', 'risks']) requireArray(value, key);
    if (!['pass', 'needs_changes'].includes(value.verdict) || value.confidence !== 'high' || value.reviewer_source_diff !== 'clean_against_snapshot' || !isIsoUtc(value.reviewed_at) || value.checks.length === 0) fail('Authority amendment review verdict, confidence, source diff, checks, or time is invalid');
    if (value.verdict === 'pass' && (value.findings.length !== 0 || value.checks.some((check) => check?.status !== 'pass'))) fail('Passing authority amendment review must be unqualified');
    if (value.verdict === 'needs_changes' && (value.findings.length === 0 || !value.findings.some((finding) => finding?.severity === 'blocking') || !value.checks.some((check) => check?.status === 'fail'))) fail('needs_changes authority amendment review must preserve a blocking finding and failed check');
    if (template) break;
    const receipt = validateNested(value.reviewer_receipt_path, 'rushd.task-receipt.v1');
    if (receipt && (receipt.role !== 'phase_reviewer' || receipt.status !== 'completed' || receipt.run_id !== value.run_id || receipt.source_diff_status !== 'clean' || receipt.snapshot_patch_sha256 !== value.candidate_patch_sha256)) fail('Authority amendment review receipt does not match its clean approved snapshot');
    try {
      const completed = loadJson(receipt?.turn_completed_path);
      const messages = completed.params?.turn?.items?.filter((item) => item?.type === 'agentMessage').map((item) => {
        try { return JSON.parse(item.text); } catch { return null; }
      }).filter(Boolean) ?? [];
      if (!messages.some((message) => sameJson(message, value))) fail('Authority amendment review is not the reviewer turn final artifact');
    } catch (error) { fail(`Authority amendment review completion evidence is invalid: ${error.message}`); }
    break;
  }

  case 'rushd.authority-amendment-approval.v1': {
    for (const key of ['run_id', 'amendment_id', 'candidate_manifest_path', 'candidate_manifest_sha256', 'candidate_patch_sha256', 'review_path', 'review_sha256', 'reviewer_receipt_path', 'reviewer_receipt_sha256', 'approved_at']) requireString(value, key);
    if (!isIsoUtc(value.approved_at)) fail('Authority amendment approval time is invalid');
    if (template) break;
    requireArtifactHash(value.candidate_manifest_path, value.candidate_manifest_sha256, 'Authority amendment candidate manifest');
    requireArtifactHash(value.review_path, value.review_sha256, 'Authority amendment review');
    requireArtifactHash(value.reviewer_receipt_path, value.reviewer_receipt_sha256, 'Authority amendment reviewer receipt');
    const manifest = validateNested(value.candidate_manifest_path, 'rushd.patch-manifest.v1');
    const review = validateNested(value.review_path, 'rushd.authority-amendment-review.v1');
    const receipt = validateNested(value.reviewer_receipt_path, 'rushd.task-receipt.v1');
    if (manifest && manifest.patch_sha256 !== value.candidate_patch_sha256) fail('Authority amendment approval patch hash does not match its manifest');
    if (review && (review.verdict !== 'pass' || review.findings.length !== 0 || review.checks.some((check) => check?.status !== 'pass') || review.run_id !== value.run_id || review.amendment_id !== value.amendment_id || review.candidate_patch_sha256 !== value.candidate_patch_sha256 || review.reviewer_receipt_path !== value.reviewer_receipt_path)) fail('Authority amendment approval does not match an unqualified independent PASS review');
    if (receipt && (receipt.run_id !== value.run_id || receipt.snapshot_manifest_path !== value.candidate_manifest_path || receipt.snapshot_patch_sha256 !== value.candidate_patch_sha256)) fail('Authority amendment approval does not match its reviewer snapshot receipt');
    break;
  }

  case 'rushd.patch-manifest.v1': {
    requireString(value, 'base_sha');
    requireString(value, 'patch_sha256');
    requireArray(value, 'files');
    if (!isSha1(value.base_sha) && value.base_sha !== 'REPLACE') fail('Patch manifest base_sha is invalid');
    if (!isSha256(value.patch_sha256) && value.patch_sha256 !== 'REPLACE') fail('Patch manifest patch_sha256 is invalid');
    const manifestPaths = (value.files ?? []).map((file) => file?.path);
    if (!unique(manifestPaths)) fail('Patch manifest paths must be unique');
    if (!sameJson(manifestPaths, [...manifestPaths].sort((left, right) => Buffer.from(String(left)).compare(Buffer.from(String(right)))))) fail('Patch manifest paths must use canonical byte order');
    for (const file of value.files ?? []) {
      if (!isObject(file) || typeof file.path !== 'string' || !['present', 'deleted'].includes(file.state)) fail(`Malformed manifest entry ${String(file?.path)}`);
      else {
        if (isAbsolute(file.path) || file.path === '' || file.path.split('/').some((part) => part === '..' || part === '.') || file.path.startsWith('.git/')) fail(`Unsafe manifest path ${file.path}`);
        if (file.state === 'present' && (!['file', 'symlink'].includes(file.kind) || typeof file.executable !== 'boolean' || !Number.isInteger(file.size) || file.size < 0 || !isSha256(file.sha256))) fail(`Malformed present manifest entry ${file.path}`);
        if (file.state === 'deleted' && !sameJson(Object.keys(file).sort(), ['path', 'state'])) fail(`Deleted manifest entry has non-canonical fields ${file.path}`);
      }
    }
    if (!template && isSha1(value.base_sha)) {
      const canonical = { schema: 'rushd.patch-manifest.v1', base_sha: value.base_sha, files: value.files };
      if (sha256Bytes(Buffer.from(JSON.stringify(canonical))) !== value.patch_sha256) fail('Patch manifest hash is not canonical');
    }
    break;
  }

  case 'rushd.human-attestation.v1': {
    for (const key of ['run_id', 'phase_id', 'gate_id', 'gate_kind', 'gate_request_sha256', 'actor', 'actor_task_id', 'performed_at', 'requirement', 'evidence_root']) requireString(value, key);
    requireArray(value, 'evidence_paths');
    requireArray(value, 'limitations');
    requireObject(value, 'environment');
    requireObject(value, 'evidence_hashes');
    requireNullOrString(value, 'period_started_at');
    requireNullOrString(value, 'period_ended_at');
    if (!['manual_qa', 'external'].includes(value.gate_kind) || !['pass', 'fail'].includes(value.result)) fail('Invalid attestation gate_kind/result');
    if (template) break;
    if (!validRunId(value.run_id) || !isIsoUtc(value.performed_at) || !isSha256(value.gate_request_sha256)) fail('Attestation run/time/request hash is invalid');
    const phase = phaseFor(plan, value.phase_id);
    if (!phase) fail('Attestation phase is unknown');
    const mandatoryGate = phase?.mandatory_human_gates?.find((gate) => gate.id === value.gate_id);
    if (mandatoryGate) {
      if (value.gate_kind !== mandatoryGate.kind || value.requirement !== mandatoryGate.requirement) fail('Attestation does not match the mandatory phase human gate');
      if (!isIsoUtc(value.period_started_at) || !isIsoUtc(value.period_ended_at) || Date.parse(value.period_ended_at) < Date.parse(value.period_started_at) + mandatoryGate.minimum_duration_days * 86_400_000 || Date.parse(value.period_ended_at) > Date.parse(value.performed_at)) fail('Mandatory phase gate duration is incomplete');
      if (mandatoryGate.kind === 'external' && value.actor !== 'founder') fail('External mandatory phase gate must be founder-attested');
    } else if (value.gate_kind === 'manual_qa') {
      const requirement = phase?.manual_qa?.find((item) => item.startsWith(`${value.gate_id}:`));
      if (!requirement || requirement !== value.requirement) fail('Manual attestation does not match the canonical phase gate');
    } else {
      if (!/^(ORCHESTRATOR-ADAPTER|PUBLICATION|EXTERNAL-[A-Z0-9-]+)$/.test(value.gate_id)) fail('External attestation gate_id is not canonical');
      if (value.actor !== 'founder') fail('External attestation must be made by the founder');
    }
    if (value.subject_sha !== null && !isSha1(value.subject_sha)) fail('Attestation subject_sha must be null or a Git SHA');
    for (const key of ['device', 'os', 'browser', 'browser_version', 'locale']) requireString(value.environment, key);
    expectedRoot(value.evidence_root, `.codex/runs/${value.run_id}/evidence/human/${value.gate_id}`, 'Attestation evidence_root');
    requireEvidence(value.evidence_paths, value.evidence_root, value.evidence_hashes, 'Attestation evidence');
    break;
  }

  case 'rushd.phase-checkpoint.v1': {
    for (const key of ['run_id', 'phase_id', 'status', 'base_sha', 'patch_sha256', 'patch_manifest_path', 'worker_receipt_path', 'evidence_root']) requireString(value, key);
    for (const key of ['changed_files', 'acceptance', 'commands', 'manual_qa', 'mandatory_human_gates', 'risks', 'deviations', 'blocking_questions', 'unrelated_changes_observed']) requireArray(value, key);
    requireObject(value, 'evidence_hashes');
    if (!Number.isInteger(value.attempt) || value.attempt < 1 || value.status !== 'ready_for_review') fail('Checkpoint attempt/status is invalid');
    if (template) break;
    if (!validRunId(value.run_id) || !gitCommitExists(value.base_sha) || !isSha256(value.patch_sha256)) fail('Checkpoint run/base/hash is invalid');
    const phase = phaseFor(plan, value.phase_id);
    if (!phase) { fail('Checkpoint phase is unknown'); break; }
    expectedRoot(value.evidence_root, `.codex/runs/${value.run_id}/evidence/${value.phase_id}/worker-attempt-${String(value.attempt).padStart(2, '0')}`, 'Worker evidence_root');
    const receipt = validateNested(value.worker_receipt_path, 'rushd.task-receipt.v1');
    if (receipt && !['phase_worker', 'remediation_worker'].includes(receipt.role)) fail('Checkpoint worker receipt has invalid role');
    if (receipt && (receipt.status !== 'completed' || receipt.run_id !== value.run_id || receipt.phase_id !== value.phase_id || receipt.attempt !== value.attempt || receipt.source_sha !== value.base_sha || receipt.source_diff_status !== 'explained')) fail('Worker receipt does not match completed checkpoint attempt');
    const acceptance = new Map((value.acceptance ?? []).map((item) => [item?.id, item]));
    if (acceptance.size !== value.acceptance.length) fail('Checkpoint acceptance IDs must be unique');
    for (const expected of phase.acceptance) {
      const item = acceptance.get(expected.id);
      const allowedStatus = value.phase_id === 'P12' && expected.id === 'P12-A5' ? ['pending_independent_review'] : ['pass'];
      if (!item || !allowedStatus.includes(item.status)) fail(`${expected.id} has invalid checkpoint status`);
      else requireEvidence(item.evidence, value.evidence_root, value.evidence_hashes, `Acceptance evidence for ${expected.id}`);
    }
    for (const id of acceptance.keys()) if (!phase.acceptance.some((item) => item.id === id)) fail(`Unknown checkpoint acceptance ID ${id}`);
    validateExactCommands(value.commands, phase.required_commands, value.evidence_root, receipt?.thread_id, 'Checkpoint');
    for (const file of value.changed_files ?? []) {
      if (!isObject(file) || typeof file.path !== 'string' || !['added', 'modified', 'deleted', 'symlink'].includes(file.change) || typeof file.purpose !== 'string' || file.purpose.length < 8) fail(`Malformed changed file ${String(file?.path)}`);
      else {
        if (matchesAny(file.path, plan.protected_paths)) fail(`Protected path changed: ${file.path}`);
        if (!matchesAny(file.path, phase.allowed_paths)) fail(`Path not allowed for ${value.phase_id}: ${file.path}`);
      }
    }
    if (!unique(value.changed_files.map((file) => file?.path))) fail('Checkpoint changed files must be unique');
    for (const requirement of phase.manual_qa) {
      const result = value.manual_qa.find((item) => item?.requirement === requirement);
      if (!result || result.status !== 'pass' || typeof result.attestation_path !== 'string' || !isSha256(result.attestation_sha256)) fail(`Missing manual QA attestation: ${requirement}`);
      else {
        requireArtifactHash(result.attestation_path, result.attestation_sha256, `Manual QA attestation ${requirement}`);
        const attestation = validateNested(result.attestation_path, 'rushd.human-attestation.v1');
        const gateId = requirement.split(':')[0];
        if (attestation && (attestation.run_id !== value.run_id || attestation.phase_id !== value.phase_id || attestation.gate_id !== gateId || attestation.requirement !== requirement || attestation.result !== 'pass')) fail(`Manual QA attestation does not match ${gateId}`);
      }
    }
    if (value.manual_qa.length !== phase.manual_qa.length) fail('Checkpoint manual QA list must exactly match the phase');
    const requiredHumanGates = phase.mandatory_human_gates ?? [];
    for (const gate of requiredHumanGates) {
      const result = value.mandatory_human_gates.find((item) => item?.gate_id === gate.id);
      if (!result || result.status !== 'pass' || typeof result.attestation_path !== 'string' || !isSha256(result.attestation_sha256)) fail(`Missing mandatory human gate attestation: ${gate.id}`);
      else {
        requireArtifactHash(result.attestation_path, result.attestation_sha256, `Mandatory human gate attestation ${gate.id}`);
        const attestation = validateNested(result.attestation_path, 'rushd.human-attestation.v1');
        if (attestation && (attestation.run_id !== value.run_id || attestation.phase_id !== value.phase_id || attestation.gate_id !== gate.id || attestation.gate_kind !== gate.kind || attestation.requirement !== gate.requirement || attestation.result !== 'pass')) fail(`Mandatory human gate attestation does not match ${gate.id}`);
      }
    }
    if (value.mandatory_human_gates.length !== requiredHumanGates.length || !unique(value.mandatory_human_gates.map((item) => item?.gate_id))) fail('Checkpoint mandatory human gates must exactly match the phase');
    if (value.blocking_questions.length || value.deviations.length || value.unrelated_changes_observed.length) fail('Checkpoint cannot be ready with blockers, deviations, or unrelated changes');
    const manifest = validateNested(value.patch_manifest_path, 'rushd.patch-manifest.v1');
    if (manifest) {
      if (manifest.base_sha !== value.base_sha || manifest.patch_sha256 !== value.patch_sha256) fail('Checkpoint manifest base/hash mismatch');
      if (!Array.isArray(manifest.files) || manifest.files.length === 0) fail('Phase checkpoint patch cannot be empty');
      if (!sameJson(value.changed_files.map((file) => file.path).sort(), manifest.files.map((file) => file.path).sort())) fail('Checkpoint changed files do not match manifest');
      if (process.env.RUSHD_SEALED_ARTIFACT !== '1') {
        try {
          const output = execFileSync(process.execPath, [resolve(import.meta.dirname, 'compute-patch-hash.mjs'), value.base_sha], { encoding: 'utf8' });
          const current = JSON.parse(output);
          if (current.patch_sha256 !== value.patch_sha256 || !sameJson(current.files, manifest.files)) {
            const head = gitHead();
            const committedAuthority = manifestForCommitRange(value.base_sha, head);
            const authorityPaths = new Set(committedAuthority.files.map((file) => file.path));
            const disjoint = manifest.files.every((file) => !authorityPaths.has(file.path));
            const authorityOnly = committedAuthority.files.length > 0 && committedAuthority.files.every((file) => matchesAny(file.path, AUTHORITY_PATHS));
            const expectedFiles = [...committedAuthority.files, ...manifest.files].sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
            if (!authorityOnly || !disjoint || !sameJson(current.files, expectedFiles)) fail('Current working patch no longer matches checkpoint plus sealed authority amendment chain');
          }
        } catch (error) { fail(`Could not recompute working patch: ${error.message}`); }
      }
    }
    break;
  }

  case 'rushd.phase-review.v1': {
    for (const key of ['run_id', 'phase_id', 'checkpoint_patch_sha256', 'verdict', 'confidence', 'next_action', 'reviewer_source_diff', 'reviewer_receipt_path', 'evidence_root']) requireString(value, key);
    for (const key of ['commands', 'checks', 'findings', 'non_blocking_suggestions']) requireArray(value, key);
    requireObject(value, 'evidence_hashes');
    if (!Number.isInteger(value.attempt) || value.attempt < 1) fail('Review attempt is invalid');
    if (!['pass', 'needs_changes', 'blocked', 'escalate'].includes(value.verdict) || !['low', 'medium', 'high'].includes(value.confidence) || value.reviewer_source_diff !== 'clean') fail('Review verdict/confidence/source diff is invalid');
    if (template) break;
    const phase = phaseFor(plan, value.phase_id);
    if (!phase || !validRunId(value.run_id) || !isSha256(value.checkpoint_patch_sha256)) fail('Review run/phase/hash is invalid');
    expectedRoot(value.evidence_root, `.codex/runs/${value.run_id}/evidence/${value.phase_id}/review-attempt-${String(value.attempt).padStart(2, '0')}`, 'Review evidence_root');
    const receipt = loadReceipt(value.reviewer_receipt_path, 'phase_reviewer');
    if (receipt && (receipt.status !== 'completed' || receipt.run_id !== value.run_id || receipt.phase_id !== value.phase_id || receipt.attempt !== value.attempt || receipt.snapshot_patch_sha256 !== value.checkpoint_patch_sha256 || receipt.source_diff_status !== 'clean')) fail('Reviewer receipt does not match review attempt/snapshot');
    validateExactCommands(value.commands, phase?.required_commands ?? [], value.evidence_root, receipt?.thread_id, 'Review');
    validateChecks(value.checks, phase?.acceptance?.map((item) => item.id) ?? [], value.verdict, value.evidence_root, value.evidence_hashes, 'Review');
    const reviewFindings = Array.isArray(value.findings) ? value.findings : [];
    for (const finding of reviewFindings) {
      if (!isObject(finding) || typeof finding.id !== 'string' || !finding.id.startsWith(`${value.phase_id}-F`) || !['blocking', 'non_blocking'].includes(finding.severity) || !phaseFor(plan, finding.owner_phase) || typeof finding.location !== 'string' || typeof finding.required_change !== 'string' || finding.required_change.length < 8) fail(`Malformed review finding ${String(finding?.id)}`);
      else requireEvidence(finding.evidence, value.evidence_root, value.evidence_hashes, `Review finding evidence for ${finding.id}`);
    }
    if (!unique(reviewFindings.map((finding) => finding?.id))) fail('Review finding IDs must be unique');
    if (value.verdict === 'pass' && (value.confidence !== 'high' || reviewFindings.some((finding) => finding.severity === 'blocking'))) fail('PASS review requires high confidence and no blocker');
    if (value.verdict !== 'pass' && !reviewFindings.some((finding) => finding.severity === 'blocking')) fail('Non-PASS review requires a blocking finding');
    const next = { pass: 'advance', needs_changes: 'correct', blocked: 'classify_block', escalate: 'adjudicate' }[value.verdict];
    if (value.next_action !== next) fail(`Review next_action must be ${next}`);
    if (!relatedInput) fail('Review validation requires the checkpoint path');
    else {
      const checkpoint = validateNested(relatedInput, 'rushd.phase-checkpoint.v1', null, process.env.RUSHD_SEALED_ARTIFACT === '1');
      if (checkpoint && (checkpoint.run_id !== value.run_id || checkpoint.phase_id !== value.phase_id || checkpoint.attempt !== value.attempt || checkpoint.patch_sha256 !== value.checkpoint_patch_sha256)) fail('Review/checkpoint cross-link mismatch');
    }
    break;
  }

  case 'rushd.phase-adjudication.v1': {
    for (const key of ['run_id', 'phase_id', 'verdict', 'reviewer_source_diff', 'adjudicator_receipt_path', 'evidence_root', 'next_action']) requireString(value, key);
    for (const key of ['attempts_reviewed', 'evidence', 'findings']) requireArray(value, key);
    requireObject(value, 'evidence_hashes');
    if (!['implementation_violation', 'finding_invalid', 'human_required'].includes(value.verdict) || value.reviewer_source_diff !== 'clean') fail('Adjudication verdict/source diff is invalid');
    if (template) break;
    const phase = phaseFor(plan, value.phase_id);
    if (!phase || !validRunId(value.run_id) || !unique(value.attempts_reviewed) || value.attempts_reviewed.length < 2 || value.attempts_reviewed.some((attempt) => !Number.isInteger(attempt) || attempt < 1)) fail('Adjudication run/phase/attempts are invalid');
    const lastAttempt = Math.max(...value.attempts_reviewed);
    expectedRoot(value.evidence_root, `.codex/runs/${value.run_id}/evidence/${value.phase_id}/adjudication-attempt-${String(lastAttempt).padStart(2, '0')}`, 'Adjudication evidence_root');
    const receipt = loadReceipt(value.adjudicator_receipt_path, 'adjudicator');
    if (receipt && (receipt.status !== 'completed' || receipt.run_id !== value.run_id || receipt.phase_id !== value.phase_id || receipt.source_diff_status !== 'clean')) fail('Adjudicator receipt does not match adjudication');
    requireEvidence(value.evidence, value.evidence_root, value.evidence_hashes, 'Adjudication evidence');
    const next = { implementation_violation: 'correct', finding_invalid: 'fresh_review', human_required: 'human_gate' }[value.verdict];
    if (value.next_action !== next) fail(`Adjudication next_action must be ${next}`);
    for (const finding of value.findings ?? []) {
      if (!isObject(finding) || typeof finding.id !== 'string' || !finding.id.startsWith(`${value.phase_id}-X`) || typeof finding.location !== 'string' || typeof finding.required_action !== 'string' || finding.required_action.length < 8) fail(`Malformed adjudication finding ${String(finding?.id)}`);
      else requireEvidence(finding.evidence, value.evidence_root, value.evidence_hashes, `Adjudication finding evidence for ${finding.id}`);
    }
    if (value.verdict === 'implementation_violation' && value.findings.length === 0) fail('Implementation violation requires a finding');
    break;
  }

  case 'rushd.phase-commit.v1': {
    for (const key of ['run_id', 'phase_id', 'commit_kind', 'base_sha', 'patch_sha256', 'checkpoint_path', 'checkpoint_sha256', 'review_path', 'review_sha256', 'worker_receipt_path', 'worker_receipt_sha256', 'commit_sha', 'committed_at', 'commit_subject', 'working_tree_status']) requireString(value, key);
    requireArray(value, 'changed_files');
    requireArray(value, 'unexplained_changes');
    if (value.commit_sandbox_authorization_path !== undefined || value.commit_sandbox_authorization_sha256 !== undefined) {
      requireString(value, 'commit_sandbox_authorization_path');
      requireString(value, 'commit_sandbox_authorization_sha256');
    }
    if (!Number.isInteger(value.attempt) || value.attempt < 1) fail('Phase commit attempt is invalid');
    if (template) break;
    if (!validRunId(value.run_id) || !isIsoUtc(value.committed_at) || !gitCommitExists(value.base_sha) || !gitCommitExists(value.commit_sha)) fail('Phase commit run/time/Git identity is invalid');
    requireArtifactHash(value.checkpoint_path, value.checkpoint_sha256, 'Commit checkpoint');
    requireArtifactHash(value.review_path, value.review_sha256, 'Commit review');
    requireArtifactHash(value.worker_receipt_path, value.worker_receipt_sha256, 'Commit worker receipt');
    const checkpoint = validateNested(value.checkpoint_path, 'rushd.phase-checkpoint.v1', null, true);
    const review = validateNested(value.review_path, 'rushd.phase-review.v1', value.checkpoint_path, true);
    const receipt = validateNested(value.worker_receipt_path, 'rushd.task-receipt.v1');
    if (checkpoint && (checkpoint.run_id !== value.run_id || checkpoint.phase_id !== value.phase_id || checkpoint.attempt !== value.attempt || checkpoint.base_sha !== value.base_sha || checkpoint.patch_sha256 !== value.patch_sha256)) fail('Phase commit/checkpoint cross-link mismatch');
    if (review && (review.verdict !== 'pass' || review.run_id !== value.run_id || review.phase_id !== value.phase_id || review.attempt !== value.attempt || review.checkpoint_patch_sha256 !== value.patch_sha256)) fail('Phase commit requires matching PASS review');
    const expectedWorkerRole = value.commit_kind === 'remediation' ? 'remediation_worker' : 'phase_worker';
    if (!['phase', 'remediation'].includes(value.commit_kind)) fail('Phase commit commit_kind is invalid');
    if (receipt && (receipt.role !== expectedWorkerRole || receipt.run_id !== value.run_id || receipt.phase_id !== value.phase_id || receipt.attempt !== value.attempt || receipt.source_sha !== value.base_sha)) fail('Phase commit worker receipt mismatch');
    let commitRange = null;
    try {
      commitRange = phaseCommitOverlayRange(value.base_sha, value.commit_sha);
      for (const authorityCommit of commitRange.authority_commits) requireSealedAuthorityCommit(authorityCommit, value.run_id, plan.plan_version);
    } catch (error) { fail(`Phase commit parent/authority overlay is invalid: ${error.message}`); }
    if (!isAncestor(value.base_sha, value.commit_sha)) fail('Phase commit is not descended from base SHA');
    const expectedSubject = `Rushd ${value.phase_id}: `;
    let actualSubject = '';
    let actualCommittedAt = '';
    try { actualSubject = git('show', '-s', '--format=%s', value.commit_sha).trim(); } catch { /* already failed */ }
    try { actualCommittedAt = git('show', '-s', '--format=%cI', value.commit_sha).trim(); } catch { /* already failed */ }
    if (!value.commit_subject.startsWith(expectedSubject) || actualSubject !== value.commit_subject) fail('Phase commit subject is invalid');
    if (!sameInstant(value.committed_at, actualCommittedAt)) fail('Phase commit committed_at does not match the actual Git committer timestamp');
    const usesCommitSandboxAmendment = (commitRange?.authority_commits ?? []).some((authorityCommit) => {
      const changed = git('diff-tree', '--no-commit-id', '--name-only', '-r', authorityCommit).split('\n').filter(Boolean);
      const amendmentPath = changed.find((path) => /^docs\/implementation\/PLAN_AMENDMENT_[A-Z0-9_-]+\.json$/.test(path));
      if (!amendmentPath) return false;
      try { return JSON.parse(git('show', `${authorityCommit}:${amendmentPath}`)).amendment_id === 'RUSHD-20260811-PHASE-COMMIT-SANDBOX-CONTINUATION'; } catch { return false; }
    });
    if (usesCommitSandboxAmendment) {
      requireString(value, 'commit_sandbox_completed_receipt_path');
      requireString(value, 'commit_sandbox_completed_receipt_sha256');
      requireArtifactHash(value.commit_sandbox_authorization_path, value.commit_sandbox_authorization_sha256, 'Phase commit sandbox authorization');
      requireArtifactHash(value.commit_sandbox_completed_receipt_path, value.commit_sandbox_completed_receipt_sha256, 'Phase commit sandbox completed receipt');
      const authorization = validateNested(value.commit_sandbox_authorization_path, 'rushd.phase-commit-sandbox-authorization.v1');
      const completedReceipt = validateNested(value.commit_sandbox_completed_receipt_path, 'rushd.task-receipt.v1');
      if (authorization && (authorization.run_id !== value.run_id || authorization.phase_id !== value.phase_id || authorization.attempt !== value.attempt || authorization.source_sha !== value.base_sha || authorization.authority_parent_sha !== commitRange?.parent_sha || authorization.patch_sha256 !== value.patch_sha256 || authorization.commit_subject !== value.commit_subject || !sameJson(authorization.changed_files, value.changed_files))) fail('Phase commit does not match its exact commit-sandbox authorization');
      const taskRoot = `.codex/runs/${value.run_id}/tasks`;
      if (!isPathInside(value.commit_sandbox_completed_receipt_path, taskRoot)) fail('Phase commit sandbox completed receipt must be a canonical run task artifact');
      if (authorization && completedReceipt) {
        try {
          const completed = loadJson(completedReceipt.turn_completed_path);
          const reports = (completed.params?.turn?.items ?? []).filter((item) => item?.type === 'agentMessage').flatMap((item) => { try { return [JSON.parse(item.text)]; } catch { return []; } });
          if (!reports.some((report) => commitSandboxCompletionMismatch(value, authorization, completedReceipt, report) === null)) fail('Phase commit lacks the exact authorized completed-turn commit report');
        } catch (error) { fail(`Phase commit sandbox completed lifecycle is invalid: ${error.message}`); }
      }
    } else if ([value.commit_sandbox_authorization_path, value.commit_sandbox_authorization_sha256, value.commit_sandbox_completed_receipt_path, value.commit_sandbox_completed_receipt_sha256].some((item) => item !== undefined)) fail('Phase commit carries an unauthorized commit-sandbox capability');
    try {
      const manifest = commitRange?.product_manifest ?? manifestForCommitRange(value.base_sha, value.commit_sha);
      if (manifest.patch_sha256 !== value.patch_sha256) fail('Committed manifest hash does not match reviewed patch');
      if (!sameJson(manifest.files.map((file) => file.path), value.changed_files)) fail('Phase commit changed_files do not match committed tree');
    } catch (error) { fail(`Could not verify committed manifest: ${error.message}`); }
    if (!['clean', 'explained'].includes(value.working_tree_status) || value.unexplained_changes.length) fail('Phase commit must leave no unexplained working-tree changes');
    break;
  }

  case 'rushd.regression-review.v1': {
    for (const key of ['run_id', 'remediation_owner_phase', 'target_phase', 'remediation_commit_sha', 'verdict', 'reviewer_receipt_path', 'reviewer_source_diff', 'evidence_root']) requireString(value, key);
    for (const key of ['commands', 'checks', 'findings']) requireArray(value, key);
    requireObject(value, 'evidence_hashes');
    if (!['pass', 'needs_changes'].includes(value.verdict) || value.reviewer_source_diff !== 'clean') fail('Regression verdict/source diff is invalid');
    if (template) break;
    const target = phaseFor(plan, value.target_phase);
    if (!validRunId(value.run_id) || !phaseFor(plan, value.remediation_owner_phase) || !target || !gitCommitExists(value.remediation_commit_sha)) fail('Regression run/phase/commit is invalid');
    expectedRoot(value.evidence_root, `.codex/runs/${value.run_id}/evidence/remediation-${value.remediation_owner_phase}/${value.target_phase}`, 'Regression evidence_root');
    const receipt = loadReceipt(value.reviewer_receipt_path, 'regression_reviewer');
    if (receipt && (receipt.status !== 'completed' || receipt.run_id !== value.run_id || receipt.phase_id !== value.target_phase || receipt.source_sha !== value.remediation_commit_sha || receipt.source_diff_status !== 'clean')) fail('Regression reviewer receipt does not match target/remediation commit');
    validateExactCommands(value.commands, target?.required_commands ?? [], value.evidence_root, receipt?.thread_id, 'Regression');
    validateChecks(value.checks, target?.acceptance?.map((item) => item.id) ?? [], value.verdict, value.evidence_root, value.evidence_hashes, 'Regression');
    for (const finding of value.findings ?? []) {
      if (!isObject(finding) || typeof finding.id !== 'string' || !finding.id.startsWith(`${value.target_phase}-RF`) || !['blocking', 'non_blocking'].includes(finding.severity) || typeof finding.location !== 'string' || typeof finding.required_change !== 'string' || finding.required_change.length < 8) fail(`Malformed regression finding ${String(finding?.id)}`);
      else requireEvidence(finding.evidence, value.evidence_root, value.evidence_hashes, `Regression finding evidence for ${finding.id}`);
    }
    if (!unique(value.findings.map((finding) => finding?.id))) fail('Regression finding IDs must be unique');
    if (value.verdict === 'pass' && value.findings.some((finding) => finding.severity === 'blocking')) fail('PASS regression contains blocker');
    if (value.verdict === 'needs_changes' && !value.findings.some((finding) => finding.severity === 'blocking')) fail('Failed regression requires blocker');
    break;
  }

  case 'rushd.final-audit.v1': {
    for (const key of ['run_id', 'audit_id', 'release_sha', 'verdict', 'reviewer_source_diff', 'auditor_receipt_path', 'evidence_root']) requireString(value, key);
    for (const key of ['commands', 'checks', 'findings']) requireArray(value, key);
    requireObject(value, 'evidence_hashes');
    if (!CANONICAL_AUDITS.includes(value.audit_id) || !['pass', 'needs_changes'].includes(value.verdict) || value.reviewer_source_diff !== 'clean') fail('Final audit identity/verdict/source diff is invalid');
    if (template) break;
    if (!validRunId(value.run_id) || !gitCommitExists(value.release_sha)) fail('Final audit run/release SHA is invalid');
    expectedRoot(value.evidence_root, `.codex/runs/${value.run_id}/evidence/final-audits/${value.audit_id}`, 'Final audit evidence_root');
    const receipt = loadReceipt(value.auditor_receipt_path, 'final_auditor');
    if (receipt && (receipt.status !== 'completed' || receipt.run_id !== value.run_id || receipt.audit_id !== value.audit_id || receipt.source_sha !== value.release_sha || receipt.source_diff_status !== 'clean')) fail('Final auditor receipt does not match audit/release');
    validateExactCommands(value.commands, FINAL_AUDIT_COMMANDS[value.audit_id], value.evidence_root, receipt?.thread_id, 'Final audit');
    validateChecks(value.checks, plan.final_audit_checks[value.audit_id], value.verdict, value.evidence_root, value.evidence_hashes, 'Final audit');
    for (const finding of value.findings ?? []) {
      if (!isObject(finding) || typeof finding.id !== 'string' || !['blocking', 'non_blocking'].includes(finding.severity) || !phaseFor(plan, finding.owner_phase) || typeof finding.location !== 'string' || typeof finding.required_change !== 'string' || finding.required_change.length < 8) fail(`Malformed final audit finding ${String(finding?.id)}`);
      else requireEvidence(finding.evidence, value.evidence_root, value.evidence_hashes, `Final audit finding evidence for ${finding.id}`);
    }
    if (!unique(value.findings.map((finding) => finding?.id))) fail('Final audit finding IDs must be unique');
    if (value.verdict === 'pass' && value.findings.some((finding) => finding.severity === 'blocking')) fail('PASS final audit contains blocker');
    if (value.verdict === 'needs_changes' && !value.findings.some((finding) => finding.severity === 'blocking')) fail('Failed final audit requires blocker');
    break;
  }

  case 'rushd.full-gate.v1': {
    for (const key of ['run_id', 'release_sha', 'status', 'runner_receipt_path', 'working_tree_status', 'evidence_root']) requireString(value, key);
    for (const key of ['commands', 'evidence_paths', 'unexplained_changes']) requireArray(value, key);
    requireObject(value, 'evidence_hashes');
    if (!['pass', 'fail'].includes(value.status)) fail('Full gate status is invalid');
    if (template) break;
    if (!validRunId(value.run_id) || !gitCommitExists(value.release_sha)) fail('Full gate run/release is invalid');
    expectedRoot(value.evidence_root, `.codex/runs/${value.run_id}/evidence/full-gate`, 'Full-gate evidence_root');
    const receipt = loadReceipt(value.runner_receipt_path, 'manager');
    if (receipt && (receipt.status !== 'completed' || receipt.run_id !== value.run_id || receipt.source_sha !== value.release_sha)) fail('Full-gate runner receipt does not match release');
    validateExactCommands(value.commands, phaseFor(plan, 'P12').required_commands, value.evidence_root, receipt?.thread_id, 'Full gate');
    requireEvidence(value.evidence_paths, value.evidence_root, value.evidence_hashes, 'Full-gate evidence');
    if (value.status === 'pass' && (value.working_tree_status !== 'clean' || value.unexplained_changes.length)) fail('Passing full gate requires a clean tree and no unexplained changes');
    break;
  }

  case 'rushd.publication-authority.v1': {
    for (const key of ['run_id', 'release_sha', 'status', 'actor', 'actor_task_id', 'approved_at', 'exact_scope', 'attestation_path', 'attestation_sha256', 'evidence_root']) requireString(value, key);
    requireArray(value, 'deployment_targets');
    requireArray(value, 'evidence_paths');
    requireObject(value, 'evidence_hashes');
    if (value.status !== 'approved' || value.actor !== 'founder') fail('Publication authority must be founder-approved');
    if (template) break;
    if (!validRunId(value.run_id) || !gitCommitExists(value.release_sha) || !isIsoUtc(value.approved_at) || value.exact_scope.length < 8 || value.deployment_targets.length === 0) fail('Publication authority run/release/time/scope is invalid');
    expectedRoot(value.evidence_root, `.codex/runs/${value.run_id}/evidence/publication`, 'Publication evidence_root');
    requireArtifactHash(value.attestation_path, value.attestation_sha256, 'Publication attestation');
    const attestation = validateNested(value.attestation_path, 'rushd.human-attestation.v1');
    if (attestation && (attestation.run_id !== value.run_id || attestation.gate_id !== 'PUBLICATION' || attestation.gate_kind !== 'external' || attestation.actor !== 'founder' || attestation.actor_task_id !== value.actor_task_id || attestation.result !== 'pass' || attestation.subject_sha !== value.release_sha)) fail('Publication attestation does not authorize this release');
    requireEvidence(value.evidence_paths, value.evidence_root, value.evidence_hashes, 'Publication evidence');
    break;
  }

  case 'rushd.post-deployment.v1': {
    for (const key of ['run_id', 'release_sha', 'status', 'launch_receipt_path', 'deployment_id', 'deployment_url', 'checked_at', 'evidence_root']) requireString(value, key);
    requireArray(value, 'checks');
    requireArray(value, 'unexplained_changes');
    requireObject(value, 'evidence_hashes');
    if (!['pass', 'fail'].includes(value.status)) fail('Post-deployment status is invalid');
    if (template) break;
    if (!validRunId(value.run_id) || !gitCommitExists(value.release_sha) || !validHttpUrl(value.deployment_url) || !isIsoUtc(value.checked_at)) fail('Post-deployment run/release/URL/time is invalid');
    expectedRoot(value.evidence_root, `.codex/runs/${value.run_id}/evidence/post-deployment`, 'Post-deployment evidence_root');
    const receipt = loadReceipt(value.launch_receipt_path, 'launch_worker');
    if (receipt && (receipt.status !== 'completed' || receipt.run_id !== value.run_id || receipt.source_sha !== value.release_sha)) fail('Launch receipt does not match release');
    validateChecks(value.checks, POST_DEPLOYMENT_CHECKS, value.status, value.evidence_root, value.evidence_hashes, 'Post-deployment');
    if (value.status === 'pass' && (value.rollback_ready !== true || value.unexplained_changes.length)) fail('Passing post-deployment proof requires rollback readiness and no drift');
    break;
  }

  case 'rushd.phase-commit-sandbox-authorization.v1': {
    for (const key of ['run_id', 'phase_id', 'role', 'thread_id', 'session_id', 'source_sha', 'authority_parent_sha', 'enabling_authority_commit_sha', 'enabling_authority_approval_path', 'enabling_authority_approval_sha256', 'patch_sha256', 'patch_manifest_path', 'patch_manifest_sha256', 'checkpoint_path', 'checkpoint_sha256', 'review_path', 'review_sha256', 'worker_receipt_path', 'worker_receipt_sha256', 'blocked_commit_receipt_path', 'blocked_commit_receipt_sha256', 'commit_subject', 'model', 'thinking', 'prompt_sha256', 'sandbox_policy', 'issued_at']) requireString(value, key);
    requireArray(value, 'changed_files');
    requireArray(value, 'allowed_actions');
    requireArray(value, 'forbidden_actions');
    if (!Number.isInteger(value.attempt) || value.attempt < 1) fail('Commit sandbox authorization attempt is invalid');
    if (template) break;
    if (!validRunId(value.run_id) || !phaseFor(plan, value.phase_id) || !gitCommitExists(value.source_sha) || !gitCommitExists(value.authority_parent_sha) || !isIsoUtc(value.issued_at)) fail('Commit sandbox authorization run/phase/Git/time identity is invalid');
    if (!['phase_worker', 'remediation_worker'].includes(value.role) || value.sandbox_policy !== 'dangerFullAccess' || !sameJson(value.allowed_actions, COMMIT_SANDBOX_ALLOWED_ACTIONS) || !sameJson(value.forbidden_actions, COMMIT_SANDBOX_FORBIDDEN_ACTIONS)) fail('Commit sandbox authorization broadens the commit-only capability');
    if (!value.commit_subject.startsWith(`Rushd ${value.phase_id}: `) || !isSha256(value.prompt_sha256)) fail('Commit sandbox subject or prompt hash is invalid');
    requireArtifactHash(value.patch_manifest_path, value.patch_manifest_sha256, 'Commit sandbox patch manifest');
    requireArtifactHash(value.checkpoint_path, value.checkpoint_sha256, 'Commit sandbox checkpoint');
    requireArtifactHash(value.review_path, value.review_sha256, 'Commit sandbox review');
    requireArtifactHash(value.worker_receipt_path, value.worker_receipt_sha256, 'Commit sandbox worker receipt');
    requireArtifactHash(value.blocked_commit_receipt_path, value.blocked_commit_receipt_sha256, 'Commit sandbox blocked receipt');
    requireArtifactHash(value.enabling_authority_approval_path, value.enabling_authority_approval_sha256, 'Commit sandbox enabling authority approval');
    const manifest = validateNested(value.patch_manifest_path, 'rushd.patch-manifest.v1');
    const checkpoint = validateNested(value.checkpoint_path, 'rushd.phase-checkpoint.v1', null, true);
    const review = validateNested(value.review_path, 'rushd.phase-review.v1', value.checkpoint_path, true);
    const worker = validateNested(value.worker_receipt_path, 'rushd.task-receipt.v1');
    const blocked = validateNested(value.blocked_commit_receipt_path, 'rushd.task-receipt.v1');
    const enablingApproval = validateNested(value.enabling_authority_approval_path, 'rushd.authority-amendment-approval.v1');
    const taskRoot = `.codex/runs/${value.run_id}/tasks`;
    if (manifest && (manifest.base_sha !== value.source_sha || manifest.patch_sha256 !== value.patch_sha256 || !sameJson(manifest.files.map((file) => file.path), value.changed_files))) fail('Commit sandbox manifest identity changed');
    if (checkpoint && (checkpoint.run_id !== value.run_id || checkpoint.phase_id !== value.phase_id || checkpoint.attempt !== value.attempt || checkpoint.base_sha !== value.source_sha || checkpoint.patch_sha256 !== value.patch_sha256 || checkpoint.patch_manifest_path !== value.patch_manifest_path || checkpoint.worker_receipt_path !== value.worker_receipt_path)) fail('Commit sandbox checkpoint identity changed');
    if (review && (review.run_id !== value.run_id || review.phase_id !== value.phase_id || review.attempt !== value.attempt || review.verdict !== 'pass' || review.checkpoint_patch_sha256 !== value.patch_sha256)) fail('Commit sandbox review is not the exact PASS review');
    const expectedIdentity = (receipt) => receipt && receipt.run_id === value.run_id && receipt.phase_id === value.phase_id && receipt.attempt === value.attempt && receipt.role === value.role && receipt.thread_id === value.thread_id && receipt.session_id === value.session_id && receipt.source_sha === value.source_sha && receipt.model === value.model && receipt.thinking === value.thinking;
    if (!isPathInside(value.worker_receipt_path, taskRoot) || !isPathInside(value.blocked_commit_receipt_path, taskRoot)) fail('Commit sandbox receipts must be canonical run task artifacts');
    if (worker && (!expectedIdentity(worker) || worker.status !== 'completed')) fail('Commit sandbox worker receipt identity changed');
    if (blocked && (!expectedIdentity(blocked) || blocked.status !== 'completed' || blocked.source_diff_status !== 'explained')) fail('Commit sandbox blocker receipt identity changed');
    let reviewReceipt = null;
    if (review?.reviewer_receipt_path) reviewReceipt = validateNested(review.reviewer_receipt_path, 'rushd.task-receipt.v1');
    if (blocked && !isStrictlyAfterIso(value.issued_at, blocked.completed_at)) fail('Commit sandbox authorization must be issued strictly after the Git-metadata blocker');
    if (reviewReceipt && !isStrictlyAfterIso(value.issued_at, reviewReceipt.completed_at)) fail('Commit sandbox authorization must be issued strictly after the PASS review lifecycle');
    const canonicalInput = [{ type: 'text', text: canonicalCommitSandboxPrompt(value) }];
    if (sha256Bytes(Buffer.from(JSON.stringify(canonicalInput))) !== value.prompt_sha256) fail('Commit sandbox authorization prompt is not the canonical commit-only prompt');
    if (blocked) {
      try {
        const blockedRequest = loadJson(blocked.turn_request_path);
        const completed = loadJson(blocked.turn_completed_path);
        const messages = (completed.params?.turn?.items ?? []).filter((item) => item?.type === 'agentMessage').map((item) => item.text).filter((text) => typeof text === 'string');
        const reports = messages.flatMap((text) => { try { return [JSON.parse(text)]; } catch { return []; } });
        const enablingParents = git('rev-list', '--parents', '-n', '1', value.enabling_authority_commit_sha).trim().split(/\s+/);
        if (enablingParents.length !== 2) throw new Error('enabling authority commit is not single-parented');
        const exactBlocker = reports.some((report) => report.run_id === value.run_id && report.phase_id === value.phase_id && report.attempt === value.attempt && report.commit_sha === null && commitSandboxBlockerParentMismatch(report.parent_sha, enablingParents[1]) === null && report.commit_subject === value.commit_subject && report.reviewed_base_sha === value.source_sha && report.patch_sha256 === value.patch_sha256 && report.manifest_path === value.patch_manifest_path && report.checkpoint_path === value.checkpoint_path && report.review_path === value.review_path && sameJson(report.changed_files, value.changed_files) && /\.git/i.test(String(report.working_tree_status)) && /read-only|read only/i.test(String(report.working_tree_status)) && /index remains clean/i.test(String(report.working_tree_status)) && Array.isArray(report.unexplained_changes) && report.unexplained_changes.length === 0 && report.committed_at === null);
        if (blockedRequest.params?.sandboxPolicy?.type !== 'workspaceWrite' || !exactBlocker) fail('Commit sandbox authorization lacks the exact preserved workspace-write Git-metadata blocker');
      } catch (error) { fail(`Commit sandbox blocker evidence is invalid: ${error.message}`); }
    }
    try {
      if (!isAncestor(value.source_sha, value.authority_parent_sha)) throw new Error('authority parent is not descended from reviewed base');
      let cursor = value.authority_parent_sha;
      let foundEnablingCommit = false;
      let enablingSeal = null;
      while (cursor !== value.source_sha) {
        const seal = requireSealedAuthorityCommit(cursor, value.run_id, plan.plan_version);
        const changed = git('diff-tree', '--no-commit-id', '--name-only', '-r', cursor).split('\n').filter(Boolean);
        const amendmentPath = changed.find((path) => /^docs\/implementation\/PLAN_AMENDMENT_[A-Z0-9_-]+\.json$/.test(path));
        const amendment = amendmentPath ? JSON.parse(git('show', `${cursor}:${amendmentPath}`)) : null;
        if (amendment?.amendment_id === 'RUSHD-20260811-PHASE-COMMIT-SANDBOX-CONTINUATION' && amendment.correction_revision === undefined) {
          if (cursor !== value.enabling_authority_commit_sha) throw new Error('enabling authority commit identity changed');
          foundEnablingCommit = true;
          enablingSeal = seal;
        }
        const parents = git('rev-list', '--parents', '-n', '1', cursor).trim().split(/\s+/);
        if (parents.length !== 2) throw new Error('authority chain is not single-parented');
        cursor = parents[1];
      }
      const enablingManifest = enablingApproval ? validateNested(enablingApproval.candidate_manifest_path, 'rushd.patch-manifest.v1') : null;
      if (!foundEnablingCommit || commitSandboxApprovalMismatch(value.run_id, value.enabling_authority_approval_path, enablingApproval, enablingManifest, enablingSeal)) throw new Error('enabling authority commit/approval is absent or substituted');
      const children = git('rev-list', '--all', '--children').split('\n').map((line) => line.trim().split(/\s+/)).find((parts) => parts[0] === value.authority_parent_sha)?.slice(1) ?? [];
      const committedChild = children.find((child) => {
        const parents = git('rev-list', '--parents', '-n', '1', child).trim().split(/\s+/);
        if (parents.length !== 2 || parents[1] !== value.authority_parent_sha || git('show', '-s', '--format=%s', child).trim() !== value.commit_subject) return false;
        try { return phaseCommitOverlayRange(value.source_sha, child).product_manifest.patch_sha256 === value.patch_sha256; } catch { return false; }
      });
      if (gitHead() !== value.authority_parent_sha && !committedChild) throw new Error('authority parent is stale and not the exact parent of the reviewed phase commit');
    } catch (error) { fail(`Commit sandbox authority parent is not the exact sealed chain: ${error.message}`); }
    break;
  }

  case 'rushd.plan-amendment.v1': {
    for (const key of ['amendment_id', 'from_plan_version', 'to_plan_version', 'requested_at', 'requested_by_task_id', 'rationale', 'safe_work_while_waiting']) requireString(value, key);
    requireArray(value, 'affected_phases');
    requireArray(value, 'protected_paths_to_change');
    requireObject(value, 'founder_decision');
    if (!isIsoUtc(value.requested_at) && !String(value.requested_at).startsWith('REPLACE')) fail('Plan amendment requested_at must be ISO UTC');
    for (const phaseId of value.affected_phases ?? []) if (!phaseFor(plan, phaseId)) fail(`Unknown affected phase ${phaseId}`);
    for (const path of value.protected_paths_to_change ?? []) if (!matchesAny(path, plan.protected_paths)) fail(`Amendment path is not protected: ${path}`);
    if (value.founder_decision?.status !== 'approved' || value.founder_decision?.actor !== 'founder' || (!isIsoUtc(value.founder_decision?.approved_at) && !String(value.founder_decision?.approved_at).startsWith('REPLACE')) || typeof value.founder_decision?.exact_scope !== 'string' || value.founder_decision.exact_scope.length < 8) fail('Plan amendment requires exact founder approval');
    if (value.correction_revision !== undefined && value.correction_revision !== 1) fail('Plan amendment correction revision is invalid');
    break;
  }

  case 'rushd.precommit-reconciliation.v1': {
    for (const key of ['run_id', 'phase_id', 'amendment_id', 'failure_signature', 'failing_summary', 'prior_checkpoint_path', 'prior_checkpoint_sha256', 'prior_review_path', 'prior_review_sha256', 'failing_log_path', 'failing_log_sha256', 'current_head_sha']) requireString(value, key);
    if (!Number.isInteger(value.prior_attempt) || value.prior_attempt < 1) fail('Prior reconciliation attempt is invalid');
    requireArray(value, 'affected_paths');
    if (!isIsoUtc(value.created_at)) fail('Reconciliation created_at is invalid');
    if (template) break;
    const phase = phaseFor(plan, value.phase_id);
    if (!phase || !validRunId(value.run_id) || value.amendment_id !== 'RUSHD-20260822-PORTABLE-PRECOMMIT-RECONCILIATION') fail('Reconciliation run/phase/amendment is invalid');
    if (!gitCommitExists(value.current_head_sha)) fail('Reconciliation head is invalid');
    else try {
      const currentHead = gitHead();
      if (value.current_head_sha !== currentHead) {
        if (!isAncestor(value.current_head_sha, currentHead)) throw new Error('recorded head is not an ancestor of the current HEAD');
        for (const commit of git('rev-list', '--reverse', `${value.current_head_sha}..${currentHead}`).split('\n').filter(Boolean)) {
          const parents = git('rev-list', '--parents', '-n', '1', commit).trim().split(/\s+/);
          const changed = git('diff-tree', '--no-commit-id', '--name-only', '-r', commit).split('\n').filter(Boolean);
          if (parents.length !== 2 || changed.length === 0 || changed.some((path) => !matchesAny(path, AUTHORITY_PATHS))) {
            throw new Error(`commit after the recorded head must be single-parented and authority-only: ${commit}`);
          }
          requireSealedAuthorityCommit(commit, value.run_id, plan.plan_version);
        }
      }
    } catch (error) { fail(`Reconciliation head drift is not a sealed authority-only chain: ${error.message}`); }
    if (value.prior_checkpoint_sha256 !== sha256File(value.prior_checkpoint_path) || value.prior_review_sha256 !== sha256File(value.prior_review_path)) fail('Preserved PASS artifact hash mismatch');
    process.env.RUSHD_SEALED_ARTIFACT = '1';
    const checkpoint = validateNested(value.prior_checkpoint_path, 'rushd.phase-checkpoint.v1', null, true);
    const review = validateNested(value.prior_review_path, 'rushd.phase-review.v1', value.prior_checkpoint_path, true);
    if (checkpoint?.attempt !== value.prior_attempt || review?.verdict !== 'pass' || review?.confidence !== 'high') fail('Reconciliation must name the sealed high-confidence PASS');
    if (!isNonEmptyRegularFile(value.failing_log_path) || value.failing_log_sha256 !== sha256File(value.failing_log_path)) fail('Reconciliation failing log/hash is invalid');
    const log = readFileSync(value.failing_log_path, 'utf8');
    if (!log.includes(value.failure_signature)) fail('Reconciliation failure signature is absent from the preserved log');
    if (!value.affected_paths.length) fail('Reconciliation must name at least one affected path');
    for (const path of value.affected_paths) if (!phase.allowed_paths.some((pattern) => matchesAny(path, [pattern]))) fail(`Reconciliation path is outside the phase allowlist: ${String(path)}`);
    break;
  }

  case 'rushd.state-transition.v1': {
    for (const key of ['event_id', 'from', 'to', 'transition_kind', 'note']) requireString(value, key);
    requireArray(value, 'evidence');
    requireObject(value, 'evidence_hashes');
    requireObject(value, 'changes');
    if (!RUN_STATUSES.includes(value.from) || !RUN_STATUSES.includes(value.to)) fail('Transition status is invalid');
    if (!value.evidence.includes('REPLACE')) requireEvidence(value.evidence, null, value.evidence_hashes, 'Transition evidence');
    break;
  }

  case 'rushd.run-state.v1': {
    for (const key of ['run_id', 'plan_version', 'source_baseline_sha', 'authority_commit_sha', 'status', 'current_phase', 'base_sha', 'transition_journal_path']) requireString(value, key);
    for (const key of ['completed_phases', 'final_audits', 'unexplained_changes']) requireArray(value, key);
    for (const key of ['worker_threads', 'review_attempts', 'escalations', 'phase_commits']) requireObject(value, key);
    for (const key of ['active_worker_receipt_path', 'active_reviewer_receipt_path', 'checkpoint_path', 'review_path', 'adjudication_path', 'active_final_audit_id']) requireNullOrString(value, key);
    requireNullOrString(value, 'genesis_state_sha256');
    requireNullOrString(value, 'previous_state_sha256');
    if (value.precommit_reconciliation !== undefined && value.precommit_reconciliation !== null) {
      const link = value.precommit_reconciliation;
      if (!isObject(link) || !sameJson(Object.keys(link).sort(), ['affected_paths', 'record_path', 'record_sha256'].sort()) || typeof link.record_path !== 'string' || !isSha256(link.record_sha256) || !Array.isArray(link.affected_paths) || !link.affected_paths.length || !unique(link.affected_paths) || link.affected_paths.some((path) => typeof path !== 'string')) fail('Pre-commit reconciliation state link is malformed');
      else {
        requireArtifactHash(link.record_path, link.record_sha256, 'Pre-commit reconciliation');
        const record = loadJson(link.record_path);
        if (!isObject(record) || record.schema !== 'rushd.precommit-reconciliation.v1' || !sameJson(record.affected_paths, link.affected_paths)) fail('Pre-commit reconciliation state link does not match its record');
      }
    }
    if (!Number.isInteger(value.current_attempt) || value.current_attempt < 0 || !Number.isInteger(value.state_revision) || value.state_revision < 0) fail('Run attempt/revision is invalid');
    if (!RUN_STATUSES.includes(value.status) || !phaseFor(plan, value.current_phase)) fail('Run status/current phase is invalid');
    if (template) break;
    if (!validRunId(value.run_id) || value.plan_version !== plan.plan_version) fail('Run ID/plan version is invalid');
    for (const [label, sha] of [['source baseline', value.source_baseline_sha], ['authority commit', value.authority_commit_sha], ['base', value.base_sha]]) if (!gitCommitExists(sha)) fail(`Run ${label} SHA is not an existing commit`);
    if (value.state_revision > 0) try {
      const commitParts = git('rev-list', '--parents', '-n', '1', value.authority_commit_sha).trim().split(/\s+/);
      if (commitParts.length !== 2 || commitParts[1] !== value.source_baseline_sha) fail('Authority commit must be single-parented directly on the source baseline');
      const authorityTree = git('ls-tree', '-r', '--name-only', value.authority_commit_sha).split('\n').filter(Boolean);
      for (const required of REQUIRED_AUTHORITY_FILES) if (!authorityTree.includes(required)) fail(`Authority commit tree omits ${required}`);
      if (!authorityTree.some((path) => path.startsWith('.codex/agents/'))) fail('Authority commit tree omits Codex agent definitions');
      const authorityChanges = git('diff-tree', '--no-commit-id', '--name-only', '-r', value.authority_commit_sha).split('\n').filter(Boolean);
      if (authorityChanges.length === 0 || authorityChanges.some((path) => !matchesAny(path, AUTHORITY_PATHS))) fail('Authority commit must be non-empty and authority-only');
      const laterCommits = git('rev-list', '--reverse', `${value.authority_commit_sha}..${gitHead()}`).split('\n').filter(Boolean);
      for (const commit of laterCommits) {
        const parents = git('rev-list', '--parents', '-n', '1', commit).trim().split(/\s+/);
        const changed = git('diff-tree', '--no-commit-id', '--name-only', '-r', commit).split('\n').filter(Boolean);
        const authorityTouched = changed.filter((path) => matchesAny(path, AUTHORITY_PATHS));
        if (authorityTouched.length === 0) continue;
        if (parents.length !== 2 || changed.some((path) => !matchesAny(path, AUTHORITY_PATHS))) {
          fail(`Later workflow authority commit must be single-parented and authority-only: ${commit}`);
          continue;
        }
        try {
          requireSealedAuthorityCommit(commit, value.run_id, value.plan_version);
        } catch (error) {
          fail(`Could not validate later workflow authority amendment ${commit}: ${error.message}`);
        }
      }
    } catch (error) { fail(`Could not verify authority bootstrap: ${error.message}`); }
    if (value.transition_journal_path !== `.codex/runs/${value.run_id}/state.journal.jsonl`) fail('Run journal path is not canonical');
    const phaseIds = plan.phases.map((phase) => phase.id);
    const expectedPrefix = phaseIds.slice(0, value.completed_phases.length);
    if (!sameJson(value.completed_phases, expectedPrefix)) fail('Completed phases must be an ordered prefix');
    for (const phaseId of value.completed_phases) {
      const history = value.phase_commits[phaseId];
      if (!Array.isArray(history) || history.length === 0) fail(`Missing phase commit history for ${phaseId}`);
      else for (const entry of history) {
        const artifact = validateArtifactRecord(entry, 'rushd.phase-commit.v1', `Phase commit ${phaseId}`);
        if (artifact && (artifact.phase_id !== phaseId || artifact.commit_sha !== entry.commit_sha || artifact.patch_sha256 !== entry.patch_sha256 || artifact.attempt !== entry.attempt || artifact.committed_at !== entry.committed_at)) fail(`Phase commit record does not match artifact for ${phaseId}`);
      }
    }
    for (const phaseId of Object.keys(value.phase_commits)) if (!value.completed_phases.includes(phaseId)) fail(`Commit history exists for incomplete phase ${phaseId}`);
    const nextPhase = phaseIds[value.completed_phases.length] ?? 'P13';
    const lastCompleted = value.completed_phases.at(-1);
    if (value.remediation === null) {
      if (value.status === 'regression_review') fail('Regression review requires remediation');
      if (value.status === 'committed' && value.current_phase !== lastCompleted) fail('Committed state must point to the committed phase');
      if (!['committed', 'final_audit', 'complete'].includes(value.status) && value.current_phase !== nextPhase) fail(`Run must point to next phase ${nextPhase}`);
      if (['final_audit', 'complete'].includes(value.status) && value.current_phase !== 'P13') fail('Final state must point to P13');
    } else {
      const remediation = value.remediation;
      for (const key of ['owner_phase', 'trigger_artifact_path', 'trigger_artifact_sha256', 'return_phase', 'return_status', 'return_snapshot_manifest_path', 'return_snapshot_manifest_sha256', 'return_patch_sha256', 'status', 'pre_remediation_head_sha', 'round_base_sha']) requireString(remediation, key);
      for (const key of ['trigger_finding_ids', 'required_regression_phases', 'passed_regression_phases', 'regression_results', 'failed_regression_results']) requireArray(remediation, key);
      if (!value.completed_phases.includes(remediation.owner_phase) || !phaseFor(plan, remediation.return_phase)) fail('Remediation owner/return phase is invalid');
      if (!['implementing', 'reviewing', 'committed', 'regression_checking', 'ready_to_resume', 'paused'].includes(remediation.status)) fail('Remediation status is invalid');
      requireArtifactHash(remediation.trigger_artifact_path, remediation.trigger_artifact_sha256, 'Remediation trigger');
      requireArtifactHash(remediation.return_snapshot_manifest_path, remediation.return_snapshot_manifest_sha256, 'Remediation interrupted-patch manifest');
      const returnManifest = validateNested(remediation.return_snapshot_manifest_path, 'rushd.patch-manifest.v1');
      if (returnManifest && (returnManifest.base_sha !== remediation.pre_remediation_head_sha || returnManifest.patch_sha256 !== remediation.return_patch_sha256)) fail('Remediation interrupted-patch manifest does not match baseline/hash');
      if (!gitCommitExists(remediation.pre_remediation_head_sha) || !gitCommitExists(remediation.round_base_sha) || !Number.isInteger(remediation.remediation_round) || remediation.remediation_round < 1 || !Number.isInteger(remediation.owner_commit_count_before) || remediation.owner_commit_count_before < 1) fail('Remediation baseline/round metadata is invalid');
      const ownerIndex = value.completed_phases.indexOf(remediation.owner_phase);
      const required = value.completed_phases.slice(ownerIndex + 1);
      if (!sameJson(remediation.required_regression_phases, required)) fail('Remediation must require every later committed phase');
      if (!sameJson(remediation.passed_regression_phases, required.slice(0, remediation.passed_regression_phases.length))) fail('Remediation passes must be an ordered prefix');
      if (remediation.regression_results.length !== remediation.passed_regression_phases.length) fail('Every remediation pass requires one result artifact');
      for (let index = 0; index < remediation.regression_results.length; index += 1) {
        const record = remediation.regression_results[index];
        const artifact = validateArtifactRecord(record, 'rushd.regression-review.v1', `Regression result ${index + 1}`);
        if (artifact && (artifact.target_phase !== remediation.passed_regression_phases[index] || artifact.remediation_owner_phase !== remediation.owner_phase || artifact.remediation_commit_sha !== remediation.remediation_commit_sha || artifact.verdict !== 'pass')) fail('Regression result does not match remediation sequence');
      }
      for (const record of remediation.failed_regression_results) {
        const artifact = validateArtifactRecord(record, 'rushd.regression-review.v1', 'Failed regression result');
        if (artifact && (artifact.remediation_owner_phase !== remediation.owner_phase || artifact.verdict !== 'needs_changes' || artifact.target_phase !== record.target_phase || artifact.remediation_commit_sha !== record.remediation_commit_sha || record.verdict !== 'needs_changes' || !remediation.required_regression_phases.includes(artifact.target_phase))) fail('Failed regression result does not match remediation sequence');
      }
      if (remediation.failed_regression_results.length !== remediation.remediation_round - 1) fail('Every additional remediation round requires exactly one persisted failed regression result');
      if (['implementing', 'reviewing'].includes(remediation.status) && (value.current_phase !== remediation.owner_phase || value.base_sha !== remediation.round_base_sha || (value.phase_commits[remediation.owner_phase]?.length ?? 0) !== remediation.owner_commit_count_before)) fail('Active remediation round must start at the owner/latest additive commit/history count');
      if (['committed', 'regression_checking', 'ready_to_resume'].includes(remediation.status)) {
        if (!isSha1(remediation.remediation_commit_sha) || !isAncestor(remediation.pre_remediation_head_sha, remediation.remediation_commit_sha)) fail('Remediation additive commit is invalid');
        if ((value.phase_commits[remediation.owner_phase]?.length ?? 0) !== remediation.owner_commit_count_before + 1) fail('Remediation must append exactly one owner-phase commit');
      }
      if (remediation.status === 'regression_checking') {
        const next = required[remediation.passed_regression_phases.length];
        if (value.status !== 'regression_review' || value.current_phase !== next || remediation.active_regression_phase !== next || !value.active_reviewer) fail('Regression state must run the next downstream phase');
      }
      if (remediation.status === 'ready_to_resume' && (value.status !== 'regression_review' || !sameJson(remediation.passed_regression_phases, required) || value.active_reviewer !== null)) fail('Ready remediation must have every regression pass and no active reviewer');
      if (remediation.status === 'paused' && value.status !== 'human_required') fail('Paused remediation requires human_required');
    }
    if (value.status === 'not_started' && (value.current_phase !== 'P00' || value.current_attempt !== 0 || value.completed_phases.length || value.active_worker !== null || value.active_reviewer !== null)) fail('not_started state is not pristine');
    if (value.state_revision === 0 && (value.genesis_state_sha256 !== null || value.previous_state_sha256 !== null)) fail('Revision-zero state cannot have journal hashes');
    if (value.state_revision > 0 && (!isSha256(value.genesis_state_sha256) || !isSha256(value.previous_state_sha256))) fail('Transitioned state requires genesis and previous-state hashes');
    if (value.status === 'worker_running' && (!value.active_worker || value.active_reviewer !== null || !value.active_worker_receipt_path || value.current_attempt < 1)) fail('worker_running requires exactly one worker receipt');
    if (value.status === 'reviewer_running' && (!value.active_worker || !value.active_reviewer || !value.active_worker_receipt_path || !value.active_reviewer_receipt_path || !value.checkpoint_path)) fail('reviewer_running requires worker, reviewer, and checkpoint');
    if (['ready_for_review', 'needs_changes', 'passed_pending_commit'].includes(value.status) && (!value.active_worker || !value.active_worker_receipt_path || value.active_reviewer !== null || !value.checkpoint_path)) fail(`${value.status} requires worker/checkpoint and no active reviewer`);
    if (['needs_changes', 'passed_pending_commit'].includes(value.status) && !value.review_path) fail(`${value.status} requires review_path`);
    if (value.status === 'escalated' && (!value.active_worker || !value.active_reviewer || !value.active_reviewer_receipt_path)) fail('escalated requires active worker and adjudicator');
    if (value.status === 'final_audit') {
      const auditorAbsent = value.active_reviewer === null;
      if (auditorAbsent !== (value.active_reviewer_receipt_path === null) || auditorAbsent !== (value.active_final_audit_id === null)) fail('Final audit active auditor fields must be set or cleared together');
      if (value.active_final_audit_id !== null && value.active_final_audit_id !== CANONICAL_AUDITS[value.final_audits.length]) fail('Final audit active auditor is out of canonical order');
    }
    if (['committed', 'complete', 'failed', 'human_required'].includes(value.status) && (value.active_worker !== null || value.active_reviewer !== null)) fail(`${value.status} cannot retain active tasks`);
    if (value.status === 'human_required') {
      const gate = value.human_required;
      for (const key of ['gate_id', 'gate_kind', 'phase_id', 'exact_request', 'requested_at', 'requesting_task_id', 'request_sha256']) requireString(gate, key);
      for (const key of ['safe_options', 'evidence_required']) requireArray(gate, key);
      if (!['manual_qa', 'external'].includes(gate.gate_kind) || !isIsoUtc(gate.requested_at) || !isSha256(gate.request_sha256) || !RUN_STATUSES.includes(value.resume_state) || value.resume_state === 'human_required') fail('Human gate metadata/resume state is invalid');
      if (!isObject(value.paused_tasks) || value.active_worker_receipt_path !== null || value.active_reviewer_receipt_path !== null || value.active_final_audit_id !== null) fail('Human gate must durably hold cleared active tasks and a paused-task record');
    }
    if (value.status !== 'human_required' && (value.human_required !== null || value.resume_state !== null)) fail('Non-human state cannot retain a human gate');
    const activeReceiptExpectations = [];
    if (value.active_worker_receipt_path) activeReceiptExpectations.push([value.active_worker_receipt_path, ['phase_worker', 'remediation_worker'], ['worker_running'].includes(value.status) ? 'created' : 'completed', value.active_worker]);
    if (value.active_reviewer_receipt_path) activeReceiptExpectations.push([value.active_reviewer_receipt_path, ['phase_reviewer', 'adjudicator', 'regression_reviewer', 'final_auditor'], 'created', value.active_reviewer]);
    for (const [path, roles, status, threadId] of activeReceiptExpectations) {
      const active = validateNested(path, 'rushd.task-receipt.v1');
      if (active && (!roles.includes(active.role) || active.status !== status || active.thread_id !== threadId || active.run_id !== value.run_id)) fail(`Active task receipt does not match state: ${path}`);
    }
    if (value.precommit_reconciliation && value.checkpoint_path) {
      const reconciliation = loadJson(value.precommit_reconciliation.record_path);
      const checkpoint = loadJson(value.checkpoint_path);
      if (checkpoint.schema === 'rushd.phase-checkpoint.v1' && checkpoint.phase_id === reconciliation.phase_id && checkpoint.attempt === reconciliation.prior_attempt + 1) {
        for (const change of checkpoint.changed_files ?? []) {
          if (!value.precommit_reconciliation.affected_paths.some((path) => matchesAny(change.path, [path]))) fail(`Reconciliation checkpoint path is outside affected_paths: ${String(change?.path)}`);
        }
      }
    }
    const auditIds = value.final_audits.map((audit) => audit?.audit_id);
    if (!unique(auditIds) || !sameJson(auditIds, CANONICAL_AUDITS.slice(0, auditIds.length))) fail('Final audits must be a canonical ordered prefix');
    for (const record of value.final_audits) {
      const artifact = validateArtifactRecord(record, 'rushd.final-audit.v1', `Final audit ${record.audit_id}`);
      if (artifact && (artifact.run_id !== value.run_id || artifact.audit_id !== record.audit_id || artifact.release_sha !== record.release_sha || artifact.verdict !== record.verdict || artifact.verdict !== 'pass')) fail(`Final audit record mismatch for ${record.audit_id}`);
    }
    if (['final_audit', 'complete'].includes(value.status)) {
      if (!gitCommitExists(value.release_candidate_sha) || value.release_candidate_sha !== gitHead()) fail('Final state release candidate must be current HEAD');
      if (value.final_audits.some((audit) => audit.release_sha !== value.release_candidate_sha)) fail('Every final audit must target release candidate');
    }
    if (value.full_gate !== null) {
      const artifact = validateArtifactRecord(value.full_gate, 'rushd.full-gate.v1', 'Full gate');
      if (artifact && (artifact.run_id !== value.run_id || artifact.release_sha !== value.release_candidate_sha || artifact.status !== 'pass')) fail('Full-gate summary mismatch');
    }
    if (value.publication_authority !== null) {
      const artifact = validateArtifactRecord(value.publication_authority, 'rushd.publication-authority.v1', 'Publication authority');
      if (artifact && (artifact.run_id !== value.run_id || artifact.release_sha !== value.release_candidate_sha || artifact.status !== 'approved' || artifact.actor !== 'founder')) fail('Publication authority summary mismatch');
    }
    if (value.post_deployment_verification !== null) {
      const artifact = validateArtifactRecord(value.post_deployment_verification, 'rushd.post-deployment.v1', 'Post-deployment verification');
      if (artifact && (artifact.run_id !== value.run_id || artifact.release_sha !== value.release_candidate_sha || artifact.status !== 'pass')) fail('Post-deployment summary mismatch');
    }
    if (value.status === 'complete') {
      if (!sameJson(value.completed_phases, phaseIds) || value.final_audits.length !== CANONICAL_AUDITS.length || !value.full_gate || !value.publication_authority || !value.post_deployment_verification || value.remediation !== null || value.unexplained_changes.length) fail('Complete state is missing a release gate');
    }
    if (process.env.RUSHD_PENDING_STATE !== '1' && value.state_revision > 0) {
      if (!isNonEmptyRegularFile(value.transition_journal_path)) fail('Run journal is missing or invalid');
      else {
        try {
          const lines = readFileSync(resolve(value.transition_journal_path), 'utf8').trim().split('\n').filter(Boolean);
          const events = lines.map((line) => JSON.parse(line));
          const last = assertJournalChain(events, value.genesis_state_sha256);
          const stateHash = sha256Bytes(readFileSync(resolve(input)));
          if (events.length !== value.state_revision || last.state_revision !== value.state_revision || last.next_state_sha256 !== stateHash || last.previous_state_sha256 !== value.previous_state_sha256 || last.to !== value.status) fail('Run state does not match the full journal chain');
          let p13CheckpointPath = value.current_phase === 'P13' ? value.checkpoint_path : null;
          if (!p13CheckpointPath && value.completed_phases.includes('P13')) {
            const p13CommitRecord = value.phase_commits.P13?.at(-1);
            if (p13CommitRecord?.artifact_path) p13CheckpointPath = loadJson(p13CommitRecord.artifact_path).checkpoint_path;
          }
          if (p13CheckpointPath) {
            const checkpoint = loadJson(p13CheckpointPath);
            for (const gate of checkpoint.mandatory_human_gates ?? []) {
              const witnessed = events.some((event) => event.transition_kind === 'resume_human' && event.evidence.some((evidence) => evidence.path === gate.attestation_path && evidence.sha256 === gate.attestation_sha256));
              if (!witnessed) fail(`P13 mandatory gate was not resumed through the journal: ${gate.gate_id}`);
            }
          }
        } catch (error) { fail(`Could not validate journal: ${error.message}`); }
      }
    }
    break;
  }

  default:
    fail(`Unknown schema: ${String(value.schema)}`);
}

if (failures.length) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`${value.schema} valid`);

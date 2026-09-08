/**
 * Isolated IDB leak probe for P04-A.
 *
 * Requires --run-token and --output from the parent. Always exits nonzero
 * when any fault-trial row leaked. The parent orchestration gate is the
 * only process that may turn that expected negative into a green run, and
 * only after it accepts a newly created payload carrying this invocation's
 * token. This wrapper never writes idb-fault-probe.json.
 */
/* global process: false, console: false */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = '/Users/mehmet/Desktop/Rushd';
const here = dirname(fileURLToPath(import.meta.url));

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) return null;
  return process.argv[index + 1];
}

const token = readArg('--run-token');
const output = readArg('--output');
if (!token || !output) {
  console.error('idb-fault-probe requires --run-token and --output');
  process.exit(1);
}

const result = spawnSync(process.execPath, [
  join(here, 'candidate-experiment.mjs'),
  '--idb-fault-probe',
  '--run-token',
  token,
  '--output',
  output,
], {
  cwd: ROOT,
  stdio: 'inherit',
  env: process.env,
});
process.exit(result.status === null ? 1 : result.status);

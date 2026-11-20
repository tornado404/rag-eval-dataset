import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const syntaxFiles = [
  'scripts/automation/check.mjs',
  'scripts/automation/issue-gate.mjs',
  'scripts/automation/issue-intake.mjs',
  'test/automation-issue-intake.test.mjs',
];
const jsonFiles = [
  'automation/multica/workflow-steps.json',
  'scripts/automation/fixtures/labeled-allowed.json',
  'scripts/automation/fixtures/labeled-denied.json',
  'scripts/automation/fixtures/opened-allowed.json',
  'scripts/automation/fixtures/opened-denied.json',
  'test/fixtures/labeled-allowed.json',
  'test/fixtures/opened-allowed.json',
];

for (const file of syntaxFiles) {
  execFileSync(process.execPath, ['--check', resolve(root, file)], {
    cwd: root,
    stdio: 'inherit',
  });
}

for (const file of jsonFiles) {
  JSON.parse(readFileSync(resolve(root, file), 'utf8'));
}

execFileSync(
  process.execPath,
  ['--test', resolve(root, 'test/automation-issue-intake.test.mjs')],
  { cwd: root, stdio: 'inherit' },
);

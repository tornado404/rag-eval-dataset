import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../editor/index.html', import.meta.url), 'utf8');

test('history list projections are not cached as complete reports', () => {
  assert.ok(!/for\(const report of reports\)reportCache\.set\(report\.run_id,report\)/.test(source));
  assert.match(source, /async function getCachedReport\(runId\)\{[\s\S]*?reportHistory\.getReport\(runId\)/);
});

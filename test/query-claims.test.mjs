import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { claimQuery, claimsState, releaseQueryClaim, renewQueryClaim } from '../scripts/lib/query-claims.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'query-claims-test-'));
  const dataDir = path.join(root, 'golden-v1');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'queries.jsonl'), `${JSON.stringify({
    query_id: 'Q0001',
    text: '问题一',
    variant_type: 'canonical',
    expected_behavior: 'answer',
    status: 'review',
  })}\n`);
  const now = new Date('2026-11-20T02:00:00.000Z');
  const env = { ...process.env, GOLDEN_DATA_DIR: dataDir };
  return { root, dataDir, now, env };
}

function withDataDir(env, run) {
  const original = process.env.GOLDEN_DATA_DIR;
  process.env.GOLDEN_DATA_DIR = env.GOLDEN_DATA_DIR;
  try {
    return run();
  } finally {
    if (original === undefined) delete process.env.GOLDEN_DATA_DIR;
    else process.env.GOLDEN_DATA_DIR = original;
  }
}

test('a second owner cannot claim the same query while the first claim is active', (context) => {
  const fixtureData = fixture();
  context.after(() => fs.rmSync(fixtureData.root, { recursive: true, force: true }));
  withDataDir(fixtureData.env, () => {
    const first = claimQuery('golden-v1', { query_id: 'Q0001', owner: '张三' }, fixtureData.now);
    assert.equal(first.created, true);
    assert.throws(
      () => claimQuery('golden-v1', { query_id: 'Q0001', owner: '李四' }, new Date(fixtureData.now.getTime() + 1000)),
      (error) => error.status === 409 && error.message.includes('张三'),
    );
  });
});

test('the same owner reclaim is idempotent and expiry frees the query', (context) => {
  const fixtureData = fixture();
  context.after(() => fs.rmSync(fixtureData.root, { recursive: true, force: true }));
  withDataDir(fixtureData.env, () => {
    claimQuery('golden-v1', { query_id: 'Q0001', owner: '张三', ttl_seconds: 60 }, fixtureData.now);
    const repeat = claimQuery('golden-v1', { query_id: 'Q0001', owner: '张三' }, new Date(fixtureData.now.getTime() + 1000));
    assert.equal(repeat.created, false);
    assert.equal(claimsState('golden-v1', new Date(fixtureData.now.getTime() + 1000)).byQueryId.size, 1);
    assert.equal(claimsState('golden-v1', new Date(fixtureData.now.getTime() + 61_000)).byQueryId.size, 0);
    const afterExpiry = claimQuery('golden-v1', { query_id: 'Q0001', owner: '李四' }, new Date(fixtureData.now.getTime() + 61_000));
    assert.equal(afterExpiry.created, true);
  });
});

test('renew extends only the owner claim and release is repeatable', (context) => {
  const fixtureData = fixture();
  context.after(() => fs.rmSync(fixtureData.root, { recursive: true, force: true }));
  withDataDir(fixtureData.env, () => {
    claimQuery('golden-v1', { query_id: 'Q0001', owner: '张三', ttl_seconds: 120 }, fixtureData.now);
    assert.throws(
      () => renewQueryClaim('golden-v1', { query_id: 'Q0001', owner: '李四' }, fixtureData.now),
      (error) => error.status === 409,
    );
    const renewed = renewQueryClaim('golden-v1', { query_id: 'Q0001', owner: '张三', ttl_seconds: 300 }, new Date(fixtureData.now.getTime() + 1000));
    assert.equal(renewed.claim.expires_at, '2026-11-20T02:05:01.000Z');
    releaseQueryClaim('golden-v1', { query_id: 'Q0001', owner: '张三' }, new Date(fixtureData.now.getTime() + 2000));
    releaseQueryClaim('golden-v1', { query_id: 'Q0001', owner: '张三' }, new Date(fixtureData.now.getTime() + 3000));
    assert.equal(claimsState('golden-v1', new Date(fixtureData.now.getTime() + 3000)).byQueryId.size, 0);
  });
});

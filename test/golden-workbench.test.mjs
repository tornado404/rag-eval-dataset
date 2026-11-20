import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { applyEvidenceChunks, applyFactEvidence, applyQueryFactManagement, createEvidence, emptyState, evidenceInventory, upsertEntity } from '../scripts/lib/golden.mjs';

const appSource = fs.readFileSync(new URL('../editor/golden/app.js', import.meta.url), 'utf8')
  .replace("import * as api from './api.js';", 'const api = globalThis.testApi;');

function fixture() {
  const state = emptyState('test');
  state.queries = [
    { query_id: 'Q_TEST_001', text: '第一个问题', variant_type: 'canonical', status: 'draft', expected_behavior: 'answer' },
    { query_id: 'Q_TEST_092', text: '提交后如何确认结果？', variant_type: 'canonical', status: 'review', expected_behavior: 'answer' },
  ];
  state.facts = [
    { fact_id: 'F_TEST_001', statement: '第一个问题的事实', fact_type: 'product_information', importance: 'P1', status: 'draft' },
    { fact_id: 'F_TEST_027', statement: '提交成功后，页面应显示已更新状态', fact_type: 'safety', importance: 'P1', status: 'draft' },
    { fact_id: 'F_TEST_240', statement: '没有 Query 引用的事实', fact_type: 'safety', importance: 'P1', status: 'draft' },
  ];
  state.query_facts = [
    { query_id: 'Q_TEST_001', fact_id: 'F_TEST_001', requirement: 'required' },
    { query_id: 'Q_TEST_092', fact_id: 'F_TEST_027', requirement: 'required' },
  ];
  state.evidences = [
    { evidence_id: 'E_TEST_001', title: '提交结果证据', excerpt: '操作成功后，页面显示已更新。', status: 'draft' },
    { evidence_id: 'E_TEST_002', title: '另一条证据', excerpt: '补充的核验原文。', status: 'review' },
  ];
  state.fact_evidence = [{ fact_id: 'F_TEST_027', evidence_ids: ['E_TEST_001'], operator: 'OR' }];
  return state;
}

function evidenceFixture() {
  const state = fixture();
  state.evidences.push({ evidence_id: 'E_TEST_003', title: '共享来源证据', excerpt: '共享来源的另一条可核验摘录。', status: 'draft' });
  state.chunks = [
    { chunk_id: 'C_TEST_001', content: '第一段完整原文。', document_name: '操作说明', source: 'ragflow' },
    { chunk_id: 'C_TEST_002', content: '第二段共享原文。', document_name: '操作说明', source: 'ragflow' },
    { chunk_id: 'C_TEST_003', content: '尚未关联证据的完整原文。', document_name: '补充说明', source: 'ragflow' },
  ];
  state.evidence_chunks = [
    { evidence_id: 'E_TEST_001', chunk_ids: ['C_TEST_001', 'C_TEST_002'] },
    { evidence_id: 'E_TEST_002', chunk_ids: [] },
    { evidence_id: 'E_TEST_003', chunk_ids: ['C_TEST_002'] },
  ];
  return state;
}

async function openApp(hash, serverState = fixture(), options = {}) {
  const calls = [];
  const listeners = new Map();
  const nodes = new Map(['.app-shell', '#view', '#modal-root', '#toast-root', '#connection-pill']
    .map((selector) => [selector, { innerHTML: '', classList: { toggle() {} }, querySelector: () => null, querySelectorAll: () => [] }]));
  let currentHash = hash;
  const location = {
    get hash() { return currentHash; },
    set hash(value) {
      currentHash = value;
      queueMicrotask(() => listeners.get('hashchange')?.());
    },
    replace(value) { this.hash = new URL(value, 'http://localhost/').hash; },
  };
  const testApi = {
    ApiError: class extends Error {},
    async getState() { return structuredClone(serverState); },
    async getEvidenceInventory() { return { inventory: evidenceInventory(serverState) }; },
    async linkEvidenceChunks(evidenceId, chunkIds, chunks = []) {
      calls.push({ type: 'evidence-chunks', evidenceId, chunkIds: [...chunkIds] });
      if (options.rejectEvidenceChunks) throw new Error('Evidence Chunk save failed');
      for (const chunk of chunks) upsertEntity(serverState, 'chunks', chunk);
      applyEvidenceChunks(serverState, evidenceId, chunkIds);
      return { state: structuredClone(serverState) };
    },
    async createEvidence(body) {
      calls.push({ type: 'create-evidence', body: structuredClone(body) });
      if (options.rejectCreateEvidence) throw new Error('Evidence save failed');
      const result = createEvidence(serverState, body);
      return { ...structuredClone(result), state: structuredClone(serverState) };
    },
    async manageQueryFacts(queryId, facts, factStatuses = []) {
      calls.push({ type: 'query-facts', queryId, facts: structuredClone(facts), factStatuses: structuredClone(factStatuses) });
      if (options.rejectQueryFacts) throw new Error('Query facts save failed');
      applyQueryFactManagement(serverState, queryId, facts, factStatuses);
      return { state: structuredClone(serverState) };
    },
    async saveEntity(type, body) {
      calls.push({ type: 'entity', entityType: type, body: structuredClone(body) });
      const { row } = upsertEntity(serverState, type, body);
      return { row: structuredClone(row), state: structuredClone(serverState) };
    },
    async runRecall(body) {
      calls.push({ type: 'recall', body: structuredClone(body), savedFacts: structuredClone(serverState.query_facts.filter((link) => link.query_id === body.query_id)) });
      return { report: { facts: [], required_total: 0, hit_total: 0, recall: null }, retrieval: { chunks: [] } };
    },
    async linkFactEvidence(factId, evidenceIds, operator) {
      calls.push({ type: 'fact-evidence', factId, evidenceIds: [...evidenceIds], operator });
      applyFactEvidence(serverState, factId, evidenceIds, operator);
      return { state: structuredClone(serverState) };
    },
    async searchRagflow(body) {
      calls.push({ type: 'search', body: structuredClone(body) });
      return { chunks: structuredClone(options.searchChunks || []) };
    },
  };
  const context = vm.createContext({
    URL, URLSearchParams, console, testApi, location,
    history: { replaceState(_state, _title, value) { location.replace(value); } },
    document: {
      querySelector: (selector) => nodes.get(selector) || null,
      querySelectorAll: () => [],
      addEventListener: (name, callback) => listeners.set(name, callback),
    },
    window: {
      addEventListener: (name, callback) => listeners.set(name, callback),
      setTimeout: () => 0,
    },
  });
  vm.runInContext(appSource, context, { filename: 'editor/golden/app.js' });
  await new Promise(setImmediate);
  return {
    calls, serverState,
    get hash() { return currentHash; },
    get html() { return nodes.get('#view').innerHTML; },
    get modalHtml() { return nodes.get('#modal-root').innerHTML; },
    async click(action, dataset = {}) {
      const element = { dataset: { action, ...dataset }, tagName: 'BUTTON', classList: { contains: () => false } };
      await listeners.get('click')({ target: { closest: () => element }, preventDefault() {}, stopPropagation() {} });
      await new Promise(setImmediate);
    },
    async change(action, id, value) {
      const element = { dataset: { action, id }, tagName: 'SELECT', value };
      listeners.get('change')({ target: { closest: () => element } });
      await new Promise(setImmediate);
    },
    async input(bind, value) {
      const element = { dataset: { bind }, tagName: 'INPUT', value };
      element.closest = () => element;
      listeners.get('input')({ target: element });
      await new Promise(setImmediate);
    },
  };
}

test('a Fact-only workbench link retains the requested Fact and opens Fact review', async () => {
  const app = await openApp('#workbench?fact=F_TEST_027&returnTo=workbench');
  assert.match(app.hash, /^#fact-review\?/);
  assert.match(app.html, /提交成功后，页面应显示已更新状态/);
  assert.doesNotMatch(app.html, /<h2>当前 Query<\/h2>|data-action="approve-query"/);
});

test('Fact library association opens Fact review even without a Query reference', async () => {
  const app = await openApp('#facts?fact=F_TEST_240');
  await app.click('open-fact-workbench', { id: 'F_TEST_240' });
  assert.match(app.hash, /^#fact-review\?/);
  assert.match(app.hash, /fact=F_TEST_240/);
  assert.doesNotMatch(app.hash, /[?&]query=/);
  assert.match(app.html, /没有 Query 引用的事实/);
  assert.match(app.html, /data-action="link-selected-evidence"/);
});

test('Fact association saves, changes the operator and unlinks on the same Fact', async () => {
  const app = await openApp('#fact-review?fact=F_TEST_240');
  const originalQueries = structuredClone(app.serverState.queries);
  const originalQueryFacts = structuredClone(app.serverState.query_facts);
  await app.click('toggle-evidence', { id: 'E_TEST_002' });
  await app.click('link-selected-evidence');
  await app.click('set-relation', { operator: 'AND' });
  await app.click('unlink-fact-evidence', { id: 'E_TEST_002' });
  assert.deepEqual(app.calls, [
    { type: 'fact-evidence', factId: 'F_TEST_240', evidenceIds: ['E_TEST_002'], operator: 'OR' },
    { type: 'fact-evidence', factId: 'F_TEST_240', evidenceIds: ['E_TEST_002'], operator: 'AND' },
    { type: 'fact-evidence', factId: 'F_TEST_240', evidenceIds: [], operator: 'AND' },
  ]);
  assert.match(app.html, /没有 Query 引用的事实/);
  assert.deepEqual(app.serverState.queries, originalQueries);
  assert.deepEqual(app.serverState.query_facts, originalQueryFacts);
});

test('Fact Evidence preview stays on Fact review', async () => {
  const app = await openApp('#fact-review?fact=F_TEST_027');
  await app.click('preview-evidence', { id: 'E_TEST_002' });
  assert.match(app.hash, /^#fact-review\?fact=F_TEST_027/);
  assert.match(app.html, /编辑 E_TEST_002/);
  assert.doesNotMatch(app.html, /<h2>当前 Query<\/h2>/);
});

test('opening linked Evidence from the Fact library retains the Fact and Evidence', async () => {
  const app = await openApp('#facts?fact=F_TEST_027');
  await app.click('open-fact-evidence', { id: 'E_TEST_001' });
  assert.match(app.hash, /^#fact-review\?/);
  assert.match(app.hash, /fact=F_TEST_027/);
  assert.match(app.hash, /evidence=E_TEST_001/);
  assert.match(app.html, /编辑 E_TEST_001/);
  assert.match(app.html, /提交成功后，页面应显示已更新状态/);
});

test('Fact review works with no Queries and searches by the Fact statement', async () => {
  const state = fixture();
  state.queries = [];
  state.query_facts = [];
  const app = await openApp('#fact-review?fact=F_TEST_027', state);
  assert.match(app.html, /提交成功后，页面应显示已更新状态/);
  assert.doesNotMatch(app.html, /还没有 Query|自动匹配当前 Query/);
  await app.click('switch-center', { tab: 'chunk' });
  await app.click('search-ragflow');
  assert.deepEqual(app.calls, [{ type: 'search', body: { query: '提交成功后，页面应显示已更新状态', top_k: 12 } }]);
});

test('saving with no Queries retains a Fact other than the first Fact', async () => {
  const state = fixture();
  state.queries = [];
  state.query_facts = [];
  const app = await openApp('#fact-review?fact=F_TEST_027', state);
  await app.click('toggle-evidence', { id: 'E_TEST_002' });
  await app.click('link-selected-evidence');
  assert.match(app.html, /提交成功后，页面应显示已更新状态/);
  await app.click('unlink-fact-evidence', { id: 'E_TEST_002' });
  assert.deepEqual(app.calls, [
    { type: 'fact-evidence', factId: 'F_TEST_027', evidenceIds: ['E_TEST_001', 'E_TEST_002'], operator: 'OR' },
    { type: 'fact-evidence', factId: 'F_TEST_027', evidenceIds: ['E_TEST_001'], operator: 'OR' },
  ]);
  assert.match(app.html, /提交成功后，页面应显示已更新状态/);
});

test('an explicit Query route still opens the Query review and its requested Fact', async () => {
  const app = await openApp('#workbench?query=Q_TEST_092&fact=F_TEST_027');
  assert.match(app.hash, /^#workbench\?/);
  assert.match(app.html, /<h2>当前 Query<\/h2>/);
  assert.match(app.html, /提交后如何确认结果？/);
  assert.match(app.html, /提交成功后，页面应显示已更新状态/);
  assert.match(app.html, /data-action="approve-query"/);
});

test('the Query review navigation exits Fact review', async () => {
  const app = await openApp('#fact-review?fact=F_TEST_240');
  await app.click('navigate', { screen: 'workbench' });
  assert.match(app.hash, /^#workbench\?/);
  assert.match(app.html, /<h2>当前 Query<\/h2>/);
  assert.match(app.html, /第一个问题/);
});

test('editing a Fact and returning keeps its Fact review context', async () => {
  const app = await openApp('#fact-review?fact=F_TEST_240&returnTo=facts');
  await app.click('open-fact-library', { id: 'F_TEST_240' });
  assert.match(app.hash, /^#facts\?/);
  assert.match(app.html, /编辑 F_TEST_240/);
  await app.click('return-from-facts');
  assert.match(app.hash, /^#fact-review\?/);
  assert.match(app.html, /没有 Query 引用的事实/);
});

test('save and next advances through Facts on Fact review', async () => {
  const app = await openApp('#fact-review?fact=F_TEST_027');
  await app.click('save-association-next');
  assert.match(app.hash, /^#fact-review\?/);
  assert.match(app.hash, /fact=F_TEST_240/);
  assert.match(app.html, /没有 Query 引用的事实/);
  assert.doesNotMatch(app.html, /data-action="approve-query"/);
  assert.deepEqual(app.calls, [{ type: 'fact-evidence', factId: 'F_TEST_027', evidenceIds: ['E_TEST_001'], operator: 'OR' }]);
});

test('Query review searches Facts and only displays Evidence as support context', async () => {
  const app = await openApp('#workbench?query=Q_TEST_092&fact=F_TEST_027');
  assert.match(app.html, /搜索与选择 Facts/);
  assert.match(app.html, /data-bind="query-facts-search"/);
  assert.match(app.html, /Fact 与证据链/);
  assert.match(app.html, /操作成功后，页面显示已更新。/);
  assert.match(app.html, /data-action="save-query-facts"/);
  assert.doesNotMatch(app.html, /搜索已有 Evidence|搜索原始 Chunk|data-action="set-relation"|data-action="save-evidence"|data-action="unlink-fact-evidence"/);
});

test('Query review saves Fact selection and scoring without changing Evidence relationships', async () => {
  const app = await openApp('#workbench?query=Q_TEST_001');
  const originalEvidence = structuredClone(app.serverState.fact_evidence);
  const otherQueryFacts = structuredClone(app.serverState.query_facts.filter((row) => row.query_id === 'Q_TEST_092'));
  await app.click('toggle-query-fact', { id: 'F_TEST_240' });
  await app.change('set-query-fact-assignment', 'F_TEST_240', 'optional');
  await app.click('save-query-facts');
  assert.deepEqual(app.calls, [{
    type: 'query-facts', queryId: 'Q_TEST_001',
    facts: [
      { fact_id: 'F_TEST_001', requirement: 'required', group_id: '' },
      { fact_id: 'F_TEST_240', requirement: 'optional', group_id: '' },
    ], factStatuses: [],
  }]);
  assert.deepEqual(app.serverState.fact_evidence, originalEvidence);
  assert.deepEqual(app.serverState.query_facts.filter((row) => row.query_id === 'Q_TEST_092'), otherQueryFacts);
  assert.equal(app.serverState.queries[0].status, 'draft');
});

test('Query review can remove the final Fact association', async () => {
  const app = await openApp('#workbench?query=Q_TEST_001');
  await app.click('toggle-query-fact', { id: 'F_TEST_001' });
  await app.click('save-query-facts');
  assert.deepEqual(app.calls, [{ type: 'query-facts', queryId: 'Q_TEST_001', facts: [], factStatuses: [] }]);
  assert.equal(app.serverState.query_facts.some((row) => row.query_id === 'Q_TEST_001'), false);
});

test('Query review preserves an alternative Fact group in its save payload', async () => {
  const app = await openApp('#workbench?query=Q_TEST_001');
  await app.click('toggle-query-fact', { id: 'F_TEST_027' });
  await app.click('toggle-query-fact', { id: 'F_TEST_240' });
  await app.change('set-query-fact-assignment', 'F_TEST_027', '__new_alternative_group__');
  await app.change('set-query-fact-assignment', 'F_TEST_240', 'required_any:A1');
  await app.click('save-query-facts');
  assert.deepEqual(app.calls[0]?.facts, [
    { fact_id: 'F_TEST_001', requirement: 'required', group_id: '' },
    { fact_id: 'F_TEST_027', requirement: 'required_any', group_id: 'A1' },
    { fact_id: 'F_TEST_240', requirement: 'required_any', group_id: 'A1' },
  ]);
});

test('Query Fact save only submits Fact statuses explicitly edited by the user', async () => {
  const app = await openApp('#workbench?query=Q_TEST_001');
  await app.change('set-query-fact-status', 'F_TEST_027', 'approved');
  await app.click('save-query-facts');
  assert.deepEqual(app.calls[0]?.factStatuses, [{ fact_id: 'F_TEST_027', status: 'approved' }]);
  assert.equal(app.serverState.facts.find((row) => row.fact_id === 'F_TEST_027').status, 'approved');
  assert.equal(app.serverState.facts.find((row) => row.fact_id === 'F_TEST_001').status, 'draft');
});

test('Query review can preview an unselected Fact and manage its evidence in Fact review', async () => {
  const app = await openApp('#workbench?query=Q_TEST_001');
  await app.click('preview-query-fact', { id: 'F_TEST_240' });
  assert.match(app.html, /没有 Query 引用的事实/);
  await app.click('open-query-fact-review');
  assert.match(app.hash, /^#fact-review\?/);
  assert.match(app.hash, /fact=F_TEST_240/);
  assert.match(app.hash, /query=Q_TEST_001/);
  assert.match(app.hash, /returnTo=workbench/);
  assert.match(app.html, /data-action="link-selected-evidence"/);
  assert.deepEqual(app.calls, []);
});

test('returning from Fact review preserves the pending Query Fact selection', async () => {
  const app = await openApp('#workbench?query=Q_TEST_001');
  await app.click('toggle-query-fact', { id: 'F_TEST_240' });
  await app.click('preview-query-fact', { id: 'F_TEST_240' });
  await app.click('open-query-fact-review');
  assert.match(app.hash, /^#fact-review\?/);
  await app.click('return-from-fact-review');
  assert.match(app.hash, /^#workbench\?/);
  await app.click('save-query-facts');
  assert.equal(app.calls[0]?.facts.some((link) => link.fact_id === 'F_TEST_240'), true);
  assert.equal(app.calls[0]?.queryId, 'Q_TEST_001');
});

test('Query approval saves pending Fact rules before approving the Query', async () => {
  const app = await openApp('#workbench?query=Q_TEST_001');
  const originalEvidence = structuredClone(app.serverState.fact_evidence);
  await app.click('toggle-query-fact', { id: 'F_TEST_240' });
  await app.click('approve-query', { id: 'Q_TEST_001', advance: 'false' });
  assert.deepEqual(app.calls.map((call) => call.type), ['query-facts', 'entity']);
  assert.equal(app.calls[0].facts.some((link) => link.fact_id === 'F_TEST_240'), true);
  assert.equal(app.calls[1].entityType, 'queries');
  assert.equal(app.serverState.queries[0].status, 'approved');
  assert.deepEqual(app.serverState.fact_evidence, originalEvidence);
});

test('a failed Query Fact save prevents approval and keeps the draft for retry', async () => {
  const app = await openApp('#workbench?query=Q_TEST_001', fixture(), { rejectQueryFacts: true });
  await app.click('toggle-query-fact', { id: 'F_TEST_240' });
  await app.click('approve-query', { id: 'Q_TEST_001', advance: 'true' });
  await app.click('save-query-facts');
  assert.deepEqual(app.calls.map((call) => call.type), ['query-facts', 'query-facts']);
  assert.equal(app.calls.every((call) => call.queryId === 'Q_TEST_001' && call.facts.some((link) => link.fact_id === 'F_TEST_240')), true);
  assert.equal(app.serverState.queries[0].status, 'draft');
  assert.match(app.hash, /query=Q_TEST_001/);
});

test('Query trial retrieval uses the pending Fact selection after saving it', async () => {
  const app = await openApp('#workbench?query=Q_TEST_001');
  await app.click('toggle-query-fact', { id: 'F_TEST_240' });
  await app.click('run-recall');
  assert.deepEqual(app.calls.map((call) => call.type), ['query-facts', 'recall']);
  assert.equal(app.calls[1].savedFacts.some((link) => link.fact_id === 'F_TEST_240'), true);
});

test('a failed Query Fact save prevents trial retrieval and next Query navigation', async () => {
  const app = await openApp('#workbench?query=Q_TEST_001', fixture(), { rejectQueryFacts: true });
  await app.click('toggle-query-fact', { id: 'F_TEST_240' });
  await app.click('run-recall');
  await app.click('save-query-facts-next');
  assert.deepEqual(app.calls.map((call) => call.type), ['query-facts', 'query-facts']);
  assert.match(app.hash, /query=Q_TEST_001/);
});

test('Query approval does not adopt pending Evidence selection left in Fact review', async () => {
  const app = await openApp('#workbench?query=Q_TEST_092&fact=F_TEST_027');
  const originalEvidence = structuredClone(app.serverState.fact_evidence);
  await app.click('open-query-fact-review');
  await app.click('toggle-evidence', { id: 'E_TEST_002' });
  await app.click('return-from-fact-review');
  await app.click('approve-query', { id: 'Q_TEST_092', advance: 'false' });
  assert.equal(app.calls.every((call) => call.type === 'query-facts' || call.type === 'entity'), true);
  assert.equal(app.serverState.queries.find((row) => row.query_id === 'Q_TEST_092').status, 'approved');
  assert.deepEqual(app.serverState.fact_evidence, originalEvidence);
});

test('approving a Query from the list does not save another Query draft', async () => {
  const app = await openApp('#workbench?query=Q_TEST_001');
  await app.click('toggle-query-fact', { id: 'F_TEST_240' });
  await app.click('navigate', { screen: 'queries' });
  await app.click('approve-query', { id: 'Q_TEST_092', advance: 'false' });
  assert.deepEqual(app.calls.map((call) => call.type), ['entity']);
  assert.equal(app.calls[0].body.query_id, 'Q_TEST_092');
  assert.equal(app.serverState.query_facts.some((link) => link.query_id === 'Q_TEST_001' && link.fact_id === 'F_TEST_240'), false);
});

test('Evidence opened outside the workbenches goes to its Fact review without requiring a Query', async () => {
  const state = fixture();
  state.queries = [];
  state.query_facts = [];
  const app = await openApp('#overview', state);
  await app.click('preview-evidence', { id: 'E_TEST_001' });
  assert.match(app.hash, /^#fact-review\?/);
  assert.match(app.hash, /fact=F_TEST_027/);
  assert.match(app.html, /编辑 E_TEST_001/);
});

test('Query save and next advances Queries after persisting their Fact rules', async () => {
  const app = await openApp('#workbench?query=Q_TEST_001');
  await app.click('toggle-query-fact', { id: 'F_TEST_240' });
  await app.click('save-query-facts-next');
  assert.deepEqual(app.calls.map((call) => call.type), ['query-facts']);
  assert.equal(app.calls[0].facts.some((link) => link.fact_id === 'F_TEST_240'), true);
  assert.match(app.hash, /^#workbench\?query=Q_TEST_092/);
  assert.match(app.html, /提交后如何确认结果？/);
});

test('Evidence relationships open without a Query and prioritize missing sources', async () => {
  const state = evidenceFixture();
  state.queries = [];
  state.query_facts = [];
  const app = await openApp('#evidence', state);
  assert.match(app.html, /从 Evidence 处理/);
  assert.match(app.html, /从 Chunk 处理/);
  assert.match(app.html, /data-workspace-evidence="E_TEST_002"/);
  await app.click('set-workspace-direction', { direction: 'chunk' });
  assert.match(app.html, /data-workspace-chunk="C_TEST_001"/);
  assert.match(app.html, /第一段完整原文。/);
  assert.deepEqual(app.calls, []);
});

test('Evidence additions preserve its existing sources and stay on the current Evidence', async () => {
  const app = await openApp('#evidence', evidenceFixture());
  await app.click('select-workspace-item', { id: 'E_TEST_001' });
  await app.click('toggle-evidence-candidate', { id: 'C_TEST_003' });
  await app.click('link-selected-evidence-chunks');
  assert.deepEqual(app.calls, [{ type: 'evidence-chunks', evidenceId: 'E_TEST_001', chunkIds: ['C_TEST_001', 'C_TEST_002', 'C_TEST_003'] }]);
  assert.match(app.html, /data-workspace-evidence="E_TEST_001"/);
  assert.match(app.html, /data-linked-chunk="C_TEST_003"/);
});

test('switching Evidence or direction cannot carry pending sources into another item', async () => {
  const app = await openApp('#evidence', evidenceFixture());
  await app.click('toggle-evidence-candidate', { id: 'C_TEST_003' });
  await app.click('select-workspace-item', { id: 'E_TEST_001' });
  await app.click('link-selected-evidence-chunks');
  await app.click('toggle-evidence-candidate', { id: 'C_TEST_003' });
  await app.click('set-workspace-direction', { direction: 'chunk' });
  await app.click('set-workspace-direction', { direction: 'evidence' });
  await app.click('link-selected-evidence-chunks');
  assert.deepEqual(app.calls, []);
});

test('unlinking a shared Chunk removes only the selected Evidence relationship', async () => {
  const app = await openApp('#evidence', evidenceFixture());
  const originalChunks = structuredClone(app.serverState.chunks);
  const originalFacts = structuredClone(app.serverState.fact_evidence);
  await app.click('select-workspace-item', { id: 'E_TEST_001' });
  await app.click('unlink-workspace-chunk', { evidence: 'E_TEST_001', chunk: 'C_TEST_002' });
  assert.deepEqual(app.serverState.evidence_chunks.find(row => row.evidence_id === 'E_TEST_001').chunk_ids, ['C_TEST_001']);
  assert.deepEqual(app.serverState.evidence_chunks.find(row => row.evidence_id === 'E_TEST_003').chunk_ids, ['C_TEST_002']);
  assert.deepEqual(app.serverState.chunks, originalChunks);
  assert.deepEqual(app.serverState.fact_evidence, originalFacts);
  assert.match(app.html, /data-workspace-evidence="E_TEST_001"/);
});

test('a failed source save preserves the selection for retry without advancing', async () => {
  const app = await openApp('#evidence', evidenceFixture(), { rejectEvidenceChunks: true });
  await app.click('toggle-evidence-candidate', { id: 'C_TEST_003' });
  await app.click('link-selected-evidence-chunks');
  await app.click('link-selected-evidence-chunks');
  assert.equal(app.calls.length, 2);
  assert.deepEqual(app.calls[0], app.calls[1]);
  assert.equal(app.calls[0].evidenceId, 'E_TEST_002');
  assert.deepEqual(app.calls[0].chunkIds, ['C_TEST_003']);
  assert.deepEqual(app.serverState.evidence_chunks.find(row => row.evidence_id === 'E_TEST_002').chunk_ids, []);
  assert.match(app.html, /data-workspace-evidence="E_TEST_002"/);
});

test('Chunk processing exposes shared references and appends to an existing Evidence', async () => {
  const app = await openApp('#evidence', evidenceFixture());
  await app.click('set-workspace-direction', { direction: 'chunk' });
  await app.click('select-workspace-item', { id: 'C_TEST_002' });
  assert.match(app.html, /引用此 Chunk 的 Evidence · 2/);
  await app.click('select-workspace-item', { id: 'C_TEST_003' });
  await app.input('workspace-target-evidence', 'E_TEST_001');
  await app.click('bind-workspace-chunk');
  assert.deepEqual(app.calls, [{ type: 'evidence-chunks', evidenceId: 'E_TEST_001', chunkIds: ['C_TEST_001', 'C_TEST_002', 'C_TEST_003'] }]);
  assert.match(app.html, /data-workspace-chunk="C_TEST_003"/);
});

test('Chunk navigation clears its pending target and keeps every snapshot Chunk available', async () => {
  const state = evidenceFixture();
  state.evidence_chunks.find(row => row.evidence_id === 'E_TEST_002').chunk_ids = ['C_TEST_003'];
  const app = await openApp('#evidence', state);
  await app.click('set-workspace-direction', { direction: 'chunk' });
  assert.match(app.html, /Chunk 队列 · 3/);
  await app.input('workspace-target-evidence', 'E_TEST_003');
  await app.click('next-workspace-item');
  assert.match(app.html, /data-workspace-chunk="C_TEST_002"/);
  await app.click('bind-workspace-chunk');
  assert.deepEqual(app.calls, []);
  await app.click('prev-workspace-item');
  assert.match(app.html, /data-workspace-chunk="C_TEST_001"/);
});

test('a Chunk can create an independent Evidence without any Query or Fact', async () => {
  const state = evidenceFixture();
  state.queries = [];
  state.query_facts = [];
  state.facts = [];
  state.fact_evidence = [];
  const app = await openApp('#evidence', state);
  await app.click('set-workspace-direction', { direction: 'chunk' });
  await app.click('select-workspace-item', { id: 'C_TEST_003' });
  await app.click('create-evidence-from-workspace-chunk');
  await app.input('evidence-draft-title', '独立创建的证据');
  await app.input('evidence-draft-excerpt', '尚未关联证据的完整原文。');
  await app.click('save-evidence-draft');
  const saved = app.serverState.evidences.find(row => row.title === '独立创建的证据');
  assert.ok(saved);
  assert.equal(saved.status, 'draft');
  assert.deepEqual(app.serverState.evidence_chunks.find(row => row.evidence_id === saved.evidence_id).chunk_ids, ['C_TEST_003']);
  assert.deepEqual(app.serverState.fact_evidence, []);
  assert.equal(app.calls[0].body.fact_id, undefined);
  assert.match(app.html, /data-workspace-chunk="C_TEST_003"/);
  assert.equal(app.modalHtml, '');
});

test('failed Evidence creation retains editable draft content and source for retry', async () => {
  const app = await openApp('#evidence', evidenceFixture(), { rejectCreateEvidence: true });
  await app.click('set-workspace-direction', { direction: 'chunk' });
  await app.click('select-workspace-item', { id: 'C_TEST_003' });
  await app.click('create-evidence-from-workspace-chunk');
  await app.input('evidence-draft-title', '失败后保留的证据标题');
  await app.input('evidence-draft-excerpt', '失败后保留的原文摘录。');
  await app.click('save-evidence-draft');
  await app.click('save-evidence-draft');
  assert.equal(app.calls.length, 2);
  assert.deepEqual(app.calls[0], app.calls[1]);
  assert.equal(app.calls[0].body.title, '失败后保留的证据标题');
  assert.equal(app.calls[0].body.excerpt, '失败后保留的原文摘录。');
  assert.deepEqual(app.calls[0].body.chunk_ids, ['C_TEST_003']);
  assert.notEqual(app.modalHtml, '');
  assert.match(app.html, /data-workspace-chunk="C_TEST_003"/);
});

test('an Evidence route selects that Evidence and retains its return context', async () => {
  const app = await openApp('#evidence?evidence=E_TEST_003&fact=F_TEST_027&returnTo=fact-review', evidenceFixture());
  assert.match(app.html, /data-workspace-evidence="E_TEST_003"/);
  await app.click('return-from-evidence');
  assert.match(app.hash, /^#fact-review\?/);
  assert.match(app.hash, /fact=F_TEST_027/);
});

test('an empty library can retrieve a new raw Chunk and create its first Evidence', async () => {
  const state = emptyState('test');
  state.config = { ragflow: { configured: true, datasets: [{ id: 'ds-test', name: '测试数据集' }] } };
  const remote = { chunk_id: 'C_REMOTE_001', content: '新检索到的完整原始片段。', document_name: '上游说明书', dataset_id: 'ds-test', source: 'ragflow' };
  const app = await openApp('#evidence', state, { searchChunks: [remote] });
  await app.click('set-workspace-direction', { direction: 'chunk' });
  assert.match(app.html, /data-action="toggle-workspace-retrieval"/);
  await app.input('evidence-keyword', '说明书');
  await app.click('search-evidence-keywords');
  await app.click('select-workspace-item', { id: 'C_REMOTE_001' });
  assert.match(app.html, /data-workspace-chunk="C_REMOTE_001"/);
  assert.match(app.html, /新检索到的完整原始片段。/);
  await app.click('create-evidence-from-workspace-chunk');
  await app.input('evidence-draft-title', '第一条独立证据');
  await app.input('evidence-draft-excerpt', '新检索到的完整原始片段。');
  await app.click('save-evidence-draft');
  assert.equal(app.serverState.evidences.length, 1);
  assert.equal(app.serverState.chunks[0].chunk_id, 'C_REMOTE_001');
  assert.equal(app.serverState.chunks[0].content, remote.content);
  assert.deepEqual(app.serverState.evidence_chunks[0].chunk_ids, ['C_REMOTE_001']);
  assert.deepEqual(app.serverState.fact_evidence, []);
});

test('changing a relation filter selects a matching item and saving keeps that item visible', async () => {
  const app = await openApp('#evidence', evidenceFixture());
  await app.change('set-workspace-filter', '', 'linked');
  assert.match(app.html, /data-workspace-evidence="E_TEST_001"/);
  await app.change('set-workspace-filter', '', 'missing');
  assert.match(app.html, /data-workspace-evidence="E_TEST_002"/);
  await app.click('toggle-evidence-candidate', { id: 'C_TEST_003' });
  await app.click('link-selected-evidence-chunks');
  assert.match(app.html, /data-workspace-evidence="E_TEST_002"/);
  assert.match(app.html, /当前项已不在筛选结果中，仍可继续编辑/);
  assert.match(app.html, /data-linked-chunk="C_TEST_003"/);
});

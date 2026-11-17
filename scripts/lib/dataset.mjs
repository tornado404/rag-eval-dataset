import fs from 'node:fs';
import path from 'node:path';

export const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

export function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${filePath}:${index + 1}: invalid JSON: ${error.message}`);
      }
    });
}

export function writeJsonl(filePath, rows) {
  const content = rows.map((row) => JSON.stringify(row, null, 0)).join('\n') + '\n';
  fs.writeFileSync(filePath, content, 'utf8');
}

export function datasetDir(version) {
  return path.join(REPO_ROOT, 'datasets', version);
}

export function loadDataset(version) {
  const dir = datasetDir(version);
  const names = [
    'cases',
    'facts',
    'evidences',
    'fact_evidence_relations',
    'expected_outputs',
  ];
  return Object.fromEntries(names.map((name) => [name, readJsonl(path.join(dir, `${name}.jsonl`))]));
}

export function validateDataset(data) {
  const errors = [];
  const cases = new Map(data.cases.map((row) => [row.case_id, row]));
  const facts = new Set(data.facts.map((row) => row.fact_id));
  const evidences = new Set(data.evidences.map((row) => row.evidence_id));
  const outputs = new Map();

  for (const [index, row] of data.cases.entries()) {
    if (!row.case_id) errors.push(`cases:${index + 1}: missing case_id`);
    if (!row.question?.trim()) errors.push(`cases:${index + 1}: empty question`);
    if (cases.has(row.case_id) && data.cases.findIndex((item) => item.case_id === row.case_id) !== index) {
      errors.push(`cases:${index + 1}: duplicate case_id ${row.case_id}`);
    }
  }

  for (const [index, row] of data.facts.entries()) {
    if (!row.fact_id) errors.push(`facts:${index + 1}: missing fact_id`);
    for (const evidenceId of row.evidence_ids || []) {
      if (!evidences.has(evidenceId)) errors.push(`facts:${index + 1}: unknown evidence ${evidenceId}`);
    }
  }

  for (const [index, row] of data.fact_evidence_relations.entries()) {
    if (!facts.has(row.fact_id)) errors.push(`relations:${index + 1}: unknown fact ${row.fact_id}`);
    for (const evidenceId of row.evidence_ids || []) {
      if (!evidences.has(evidenceId)) errors.push(`relations:${index + 1}: unknown evidence ${evidenceId}`);
    }
  }

  for (const [index, row] of data.expected_outputs.entries()) {
    if (!row.case_id) errors.push(`expected_outputs:${index + 1}: missing case_id`);
    if (outputs.has(row.case_id)) errors.push(`expected_outputs:${index + 1}: duplicate case_id ${row.case_id}`);
    outputs.set(row.case_id, row);
    if (!cases.has(row.case_id)) errors.push(`expected_outputs:${index + 1}: unknown case ${row.case_id}`);
    if (row.expected_behavior === 'answer' && !row.answer_text?.trim()) {
      errors.push(`expected_outputs:${index + 1}: empty answer_text for answer case ${row.case_id}`);
    }
    if (!['draft', 'review', 'approved'].includes(row.status)) {
      errors.push(`expected_outputs:${index + 1}: invalid status ${row.status}`);
    }
    for (const factId of [...(row.required_fact_ids || []), ...(row.forbidden_fact_ids || [])]) {
      if (!facts.has(factId)) errors.push(`expected_outputs:${index + 1}: unknown fact ${factId}`);
    }
  }

  for (const row of data.cases) {
    if (!outputs.has(row.case_id)) errors.push(`expected_outputs: missing case ${row.case_id}`);
  }

  return errors;
}

import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

export const SCHEMA_VERSION = 'ragflow-eval-v1/1.0';
export const SCORER_VERSION = 'ragflow-eval-scorers/1.0.0';
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
export const fileHash = (file) => sha256(fs.readFileSync(file));
export const readJsonl = (file) => fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((s) => s.trim()).map((s, index) => {
  try { return JSON.parse(s); } catch (error) { throw new Error(`${file}:${index + 1}: ${error.message}`); }
});
export const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
export const writeNew = (file, value) => fs.writeFileSync(file, value, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
export const writeJsonNew = (file, value) => writeNew(file, `${JSON.stringify(value, null, 2)}\n`);
export const writeJsonlNew = (file, rows) => writeNew(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));

export function uniqueIndex(rows, key, label) {
  const out = new Map();
  for (const row of rows) {
    const id = row[key];
    if (!id || out.has(id)) throw new Error(`${label}: missing or duplicate ${key}: ${id}`);
    out.set(id, row);
  }
  return out;
}

export function normalizeText(input) {
  let value = String(input ?? '');
  if (/<(?:table|tr|td|th|p|div|br|span|strong|em|b|i)\b/i.test(value)) value = value.replace(/<[^>]*>/g, '');
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  value = value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp);/gi, (match, code) => {
    if (code[0] !== '#') return entities[code.toLowerCase()] ?? match;
    const n = code[1]?.toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
    return Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
  });
  return value.normalize('NFKC').replace(/[\s\u00ad]/gu, '');
}

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { out._.push(arg); continue; }
    const key = arg.slice(2);
    if (!argv[i + 1] || argv[i + 1].startsWith('--')) out[key] = true;
    else out[key] = argv[++i];
  }
  return out;
}

export function requiredArg(args, name) {
  if (typeof args[name] !== 'string' || !args[name]) throw new Error(`Missing --${name}`);
  return args[name];
}

export function ensureNewDir(dir) {
  fs.mkdirSync(path.dirname(path.resolve(dir)), { recursive: true, mode: 0o700 });
  fs.mkdirSync(dir, { mode: 0o700 });
}

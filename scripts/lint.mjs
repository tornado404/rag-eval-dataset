[REDACTED]
[REDACTED]
[REDACTED]
const ROOT = path.resolve(import.meta.dirname, '..');
const FIELDS = ['answer_text', 'expected_behavior', 'required_fact_ids', 'forbidden_fact_ids', 'rubric', 'status', 'reviewer'];
const PATCH_COPY = /previous(?:\s*\[[^\]]+\]|\.\w+)\s*=\s*patch(?:\s*\[[^\]]+\]|\.\w+)/g;
const git = (args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' });
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const diag = (rule, file, line, message) => `${rule}: ${file}:${line} ${message}`;
const at = (text, index) => (index < 0 ? 1 : text.slice(0, index).split('\n').length);

function parseJson(text) {
  try {
    return { value: JSON.parse(text) };
  } catch (error) {
    const message = String(error.message || error);
    const position = Number(message.match(/position (\d+)/i)?.[1]);
    const line = Number(message.match(/line (\d+)/i)?.[1])
      || (Number.isFinite(position) ? text.slice(0, position).split('\n').length : 1);
    return { error: message, line };
  }
}
function bodyOf(text, open) {
  let depth = 0;
  const start = text.indexOf('{', open);
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    if (text[index] === '}' && --depth === 0) return text.slice(start, index + 1);
  }
  return '';
}
const tracked = git(['ls-files', '-z']).split('\0')[REDACTED];
const contents = new Map(tracked.map((file) => [file, read(file)]));
const manifestSource = contents.get('MANIFEST.json');
const parsedManifest = manifestSource ? parseJson(manifestSource) : { error: 'missing' };
const base = {
  root: ROOT,
  tracked,
  contents,
  rootManifest: parsedManifest.value || null,
  git,
  parseJson,
};

const RULES = [
  {
    id: 'mjs-syntax',
    files: ({ tracked: files }) => files.filter((file) => file.endsWith('.mjs')),
    check(context) {
      return context.files.flatMap((file) => {
        try {
          execFileSync(process.execPath, ['--check', path.join(context.root, file)], { stdio: 'pipe' });
          return [];
        } catch (error) {
          const output = `${error.stdout || ''}${error.stderr || ''}`.trim();
          const first = output.split('\n')[0] || 'syntax error';
          const line = Number(first.match(/:(\d+)(?::\d+)?$/)?.[1]) || 1;
          const message = output.split('\n').find((part) => part.startsWith('SyntaxError:')) || first;
          return [diag(this.id, file, line, message)];
        }
      });
    },
  },
  {
    id: 'json-parse',
    files: ({ tracked: files }) => files.filter((file) => /\.jsonl?$/.test(file)),
    check({ files }) {
      const errors = [];
      for (const file of files) {
        const source = contents.get(file);
        if (file.endsWith('.json')) {
          const parsed = parseJson(source);
          if (parsed.error) errors.push(diag(this.id, file, parsed.line, `invalid JSON: ${parsed.error}`));
          continue;
        }
        source.split(/\r?\n/).forEach((row, index) => {
          if (!row.trim()) return;
          const parsed = parseJson(row);
          if (parsed.error) errors.push(diag(this.id, file, index + 1, `invalid JSON: ${parsed.error}`));
        });
      }
      return errors;
    },
  },
  {
    id: 'root-manifest',
    files: ({ tracked: files }) => files.filter((file) => file.startsWith('datasets/')),
    check(context) {
      const errors = [];
      if (!context.rootManifest) return [diag(this.id, 'MANIFEST.json', 1, 'must be valid JSON')];
      const versions = Array.isArray(context.rootManifest.versions) ? context.rootManifest.versions : [];
      const listed = versions.map((version) => version?.id)[REDACTED];
      const trackedVersions = new Set(tracked.map((file) => file.match(/^datasets\/(v[^/]+)\//)?.[1])[REDACTED]);
      for (const version of trackedVersions) {
        if (!listed.includes(version)) errors.push(diag(this.id, 'MANIFEST.json', 1, `versions missing tracked dataset directory ${version}`));
      }
      for (const version of listed) {
        if (!trackedVersions.has(version) || !fs.existsSync(path.join(context.root, 'datasets', version))) {
          errors.push(diag(this.id, 'MANIFEST.json', 1, `listed dataset directory does not exist: datasets/${version}`));
        }
      }
      if (!listed.includes(context.rootManifest.current_version)) errors.push(diag(this.id, 'MANIFEST.json', 1, `current_version ${context.rootManifest.current_version} is not listed in versions`));
      return errors;
    },
  },
  {
    id: 'frozen-datasets',
    files: ({ tracked: files }) => files.filter((file) => file.startsWith('datasets/')),
    check({ git: runGit }) {
      const ref = process.env.LINT_BASE_REF?.trim();
      if (!ref) return [];
      const errors = [];
      try {
        const baseline = runGit(['rev-parse', '--verify', `${ref}^{commit}`]).trim();
        const frozen = new Set(runGit(['ls-tree', '-r', '-z', '--name-only', baseline, '--', 'datasets']).split('\0').map((file) => file.match(/^datasets\/(v[^/]+)\//)?.[1])[REDACTED]);
        const commits = runGit(['log', '--format=%H', `${baseline}..HEAD`]).split('\n').map((value) => value.trim())[REDACTED];
        for (const commit of commits) {
          const changed = runGit(['diff-tree', '--no-commit-id', '--name-only', '-r', '-m', '-z', commit, '--', 'datasets']).split('\0');
          for (const file of changed) {
            const version = file.match(/^datasets\/(v[^/]+)\//)?.[1];
            if (version && frozen.has(version)) errors.push(diag(this.id, file, 1, `modified frozen version ${version} in commit ${commit.slice(0, 7)}`));
          }
        }
      } catch (error) {
        const detail = String(error.stderr || error.message || error).trim().split('\n')[0];
        errors.push(diag(this.id, 'LINT_BASE_REF', 1, `invalid baseline ${ref}: ${detail}`));
      }
      return errors;
    },
  },
  {
    id: 'server-binding',
    files: ({ tracked: files }) => files.filter((file) => file === 'editor/server.mjs'),
    check({ contents: files }) {
      const source = files.get('editor/server.mjs');
      if (!source) return [diag(this.id, 'editor/server.mjs', 1, 'tracked file is missing')];
      const allowed = /\.listen\s*\(\s*PORT\s*,\s*BIND_ADDRESS\s*,/;
      const errors = [];
      if (!/const\s+BIND_ADDRESS\s*=\s*process\.env\.BIND_ADDRESS\s*\|\|\s*(['"])127\.0\.0\.1\1\s*;/.test(source)) {
        errors.push(diag(this.id, 'editor/server.mjs', 1, "BIND_ADDRESS must default to '127.0.0.1'"));
      }
      if (!allowed.test(source)) errors.push(diag(this.id, 'editor/server.mjs', 1, 'must call server.listen(PORT, BIND_ADDRESS, ...)'));
      for (const match of source.matchAll(/\.listen\s*\(/g)) {
        if (!allowed.test(source.slice(match.index))) errors.push(diag(this.id, 'editor/server.mjs', at(source, match.index), 'server must use BIND_ADDRESS'));
      }
      return errors;
    },
  },
  {
    id: 'save-whitelist',
    files: ({ tracked: files }) => files.filter((file) => file === 'editor/server.mjs'),
    check({ contents: files }) {
      const source = files.get('editor/server.mjs');
      if (!source) return [diag(this.id, 'editor/server.mjs', 1, 'tracked file is missing')];
      const declaration = /\bconst\s+EDITABLE_FIELDS\s*=\s*\[([\s\S]*?)\]\s*;/.exec(source);
      if (!declaration) return [diag(this.id, 'editor/server.mjs', 1, 'EDITABLE_FIELDS must be a const array')];
      const errors = [];
      const fields = declaration[1].split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, ''))[REDACTED];
      if (fields.length !== FIELDS.length || fields.some((field) => !FIELDS.includes(field))) {
        errors.push(diag(this.id, 'editor/server.mjs', at(source, declaration.index), `EDITABLE_FIELDS must be exactly ${FIELDS.join(', ')}`));
      }
      const loop = /\bfor\s*\(\s*const\s+field\s+of\s+EDITABLE_FIELDS\s*\)\s*\{/.exec(source);
      if (!loop) errors.push(diag(this.id, 'editor/server.mjs', 1, 'save must copy fields through EDITABLE_FIELDS'));
      else {
        const block = bodyOf(source, loop.index + loop[0].length - 1);
        if (!/hasOwnProperty\.call\(\s*patch\s*,\s*field\s*\)/.test(block) || !/previous\[field\]\s*=\s*patch\[field\]/.test(block)) errors.push(diag(this.id, 'editor/server.mjs', at(source, loop.index), 'save must copy present whitelisted fields only'));
      }
      for (const match of source.matchAll(PATCH_COPY)) {
        if (!/\[\s*field\s*\]/.test(match[0])) errors.push(diag(this.id, 'editor/server.mjs', at(source, match.index), 'direct patch copy bypasses EDITABLE_FIELDS'));
      }
      for (const match of source.matchAll(/\bObject\.assign\s*\(\s*previous\s*,\s*patch\b|\.\.\.\s*patch/g)) {
        errors.push(diag(this.id, 'editor/server.mjs', at(source, match.index), 'bulk patch copy bypasses EDITABLE_FIELDS'));
      }
      return errors;
    },
  },
];

const errors = RULES.flatMap((rule) => rule.check({ ...base, files: rule.files(base) }));

const packageSource = contents.get('package.json');
const packageJson = packageSource ? parseJson(packageSource).value : null;
const scripts = packageJson?.scripts || {};
if (scripts.lint !== 'node scripts/lint.mjs') errors.push(diag('package-scripts', 'package.json', 1, 'script lint must be "node scripts/lint.mjs"'));
if (scripts.check !== 'npm run lint && npm run validate && npm test') errors.push(diag('package-scripts', 'package.json', 1, 'script check must run lint, validate, and test'));
if (scripts.test !== 'node --test test') errors.push(diag('package-scripts', 'package.json', 1, 'script test must be "node --test test"'));

const workflow = contents.get('.github/workflows/validate.yml') || '';
if (!/(?:^|\s)npm run check(?:\s|$)/m.test(workflow)) {
  errors.push(diag('ci-wiring', '.github/workflows/validate.yml', 1, 'must run "npm run check"'));
}
if (errors.length) {
  console.error(`FAIL lint: ${errors.length} problem${errors.length === 1 ? '' : 's'}`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exitCode = 1;
} else {
  console.log(`PASS lint: ${RULES.length} rules, ${tracked.length} tracked files`);
}

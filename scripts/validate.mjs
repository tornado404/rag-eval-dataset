[REDACTED]
[REDACTED]
import { DATASET_ROOT, REPO_ROOT, loadDataset, loadExpectedActionMap, validateDataset, validateExpectedActionMap } from './lib/dataset.mjs';

const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'MANIFEST.json'), 'utf8'));
let versions = Array.isArray(manifest.versions) ? manifest.versions : [];
if (!versions.length && fs.existsSync(DATASET_ROOT)) {
  versions = fs.readdirSync(DATASET_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^v\d+(?:\.\d+)*$/.test(entry.name))
    .map((entry) => ({ id: entry.name }));
}
let failed = false;

for (const version of versions) {
  const data = loadDataset(version.id);
  const errors = [
    ...validateDataset(data),
    ...(version.id === 'v1.5' ? validateExpectedActionMap(data, loadExpectedActionMap(version.id)) : []),
  ];
  if (errors.length) {
    failed = true;
    console.error(`FAIL ${version.id}`);
    for (const error of errors.slice(0, 40)) console.error(`  - ${error}`);
    if (errors.length > 40) console.error(`  ... ${errors.length - 40} more`);
  } else {
    console.log(`PASS ${version.id}: dataset structure valid`);
  }
}

if (!versions.length) {
  console.log('SKIP dataset validation: no private datasets found; set DATASET_ROOT to validate provisioned data.');
}

process.exitCode = failed ? 1 : 0;

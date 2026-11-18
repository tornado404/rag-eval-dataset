[REDACTED]
[REDACTED]
import { REPO_ROOT, datasetDir, loadDataset, loadExpectedActionMap, validateDataset, validateExpectedActionMap } from './lib/dataset.mjs';

const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'MANIFEST.json'), 'utf8'));
let failed = false;

for (const version of manifest.versions) {
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
    console.log(`PASS ${version.id}: ${data.cases.length} cases`);
  }
}

process.exitCode = failed ? 1 : 0;

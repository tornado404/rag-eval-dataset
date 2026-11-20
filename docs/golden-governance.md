# Golden dataset governance

The Golden CLI reads and writes its data under `GOLDEN_DATA_DIR`, or `$DATASET_ROOT/golden-v1` when the override is unset. Review records and split files are stored alongside that private dataset. The CLI validates state before writing governance records and does not alter the core tables when it creates a split or review record.

The governance contract schema is maintained in [`schemas/golden-governance-contract.json`](../schemas/golden-governance-contract.json). A private dataset may keep an override at `governance/contract.json`.

## Examples

```bash
GOLDEN_DATA_DIR=/private/eval-data/golden-v1 node scripts/golden-governance.mjs status
GOLDEN_DATA_DIR=/private/eval-data/golden-v1 node scripts/golden-governance.mjs split propose --id split-a --seed 42 --validation-ratio 0.2
GOLDEN_DATA_DIR=/private/eval-data/golden-v1 node scripts/golden-governance.mjs review query-fact --query QUERY-1 --fact FACT-1 --status approved --reviewer reviewer
```

The `p0-p1` gate requires an approved split and current approved reviews for the covered records. Review digests become stale if their underlying data changes.

Keep the dataset, review ledger, split files, and generated output outside the public source repository.

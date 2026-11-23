# RAG evaluation tooling

This repository contains tools for editing and evaluating retrieval and answer behavior. It publishes source code only. Evaluation datasets, source excerpts, chunk snapshots, generated reports, and review artifacts are provisioned separately and are not included here.

## Data locations

The default data root is `datasets/`, but versioned data directories are ignored by Git. Set `DATASET_ROOT` to a private directory containing the datasets you have permission to use:

```text
/private/eval-data/
├── v1.5/
└── golden-v1/
```

```bash
export DATASET_ROOT=/private/eval-data
```

The editor reads `DATASET_VERSION` (default `v1.5`). Golden review data uses `$DATASET_ROOT/golden-v1` by default; set `GOLDEN_DATA_DIR` to choose another location. Keep these directories and any generated reports outside the repository.

## Requirements

- Node.js 20 or newer
- Private evaluation data for dataset editing and data validation
- Service credentials only when using remote retrieval or answer evaluation

Install dependencies only if your local environment requires them; the current toolchain uses Node.js built-ins.

## Start the tools

Start the case editor with a provisioned dataset:

```bash
DATASET_ROOT=/private/eval-data DATASET_VERSION=v1.5 npm run editor
```

Start the Golden review tool:

```bash
DATASET_ROOT=/private/eval-data npm run golden
```

Evidence–Chunk mappings keep exact source anchors, experiment versions, and a review status separate from the Evidence status. See [the mapping review guide](docs/evidence-chunk-mappings.md) for the schema, approval behavior, and private snapshot preparation command.

The editor binds to `127.0.0.1` by default. Set `PORT` and `BIND_ADDRESS` when your local setup requires different values. The review tools do not bundle or download private data.

## Configuration

The evaluation editor can read service settings from an environment file at `~/.config/rag-eval-dataset/eval.env`. Copy [`deploy/eval.env.example`](deploy/eval.env.example) and replace its example values locally. Do not commit credentials or service-specific dataset identifiers.

The Golden review tool reads `~/.config/rag-eval-dataset/golden.env` by default. Set `GOLDEN_CONFIG_FILE` to use another file. Keep credentials in the server environment; they are not part of the dataset files.

## Validation

Run source checks with:

```bash
npm run lint
npm run check
```

`npm run validate` validates datasets under `DATASET_ROOT`. A public checkout without private data reports that dataset validation was skipped. Pull request validation uses a GitHub-hosted runner. The optional deployment workflow still uses a self-hosted runner; move that runner and workflow to private infrastructure before publishing this repository. See [deployment notes](deploy/README.md).

## Dataset handling

- `DATASET_ROOT` points to private version directories such as `v1.5`.
- `GOLDEN_DATA_DIR` points to a private Golden data directory.
- `.gitignore` excludes versioned dataset directories, Golden data directories, reports, and local audit caches.
- Dataset migration reads its source from `DATASET_ROOT` and writes to `GOLDEN_DATA_DIR` or `$DATASET_ROOT/golden-v1`.

Do not add evaluation records, source excerpts, chunk text, audit results, or generated reports to this repository. Keep the private data backup and retention policy in the system that provisions those directories.

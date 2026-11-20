# Golden dataset review tool

The Golden review tool is a local editor for a separately provisioned evaluation dataset. It reads from `GOLDEN_DATA_DIR` or `$DATASET_ROOT/golden-v1` and writes only to that directory. No review records or chunk text are bundled in the public source tree.

## Data model

The tool manages seven JSONL tables: queries, facts, evidences, chunks, query–fact links, fact–evidence links, and evidence–chunk links. A query may link to several required, optional, or forbidden facts. Each fact may be supported by one or more evidences; each evidence may refer to multiple chunks.

The tool validates the complete state before saving. It supports separate Query and Fact review workbenches, evidence drafts, retrieval previews, recall calculations, and optional query claims for team coordination. Claims are stored with the provisioned data, separately from the seven core tables.

## Start

Set the data path and start the server:

```bash
GOLDEN_DATA_DIR=/private/eval-data/golden-v1 npm run golden
```

The server binds to `127.0.0.1` by default. Use `GOLDEN_PORT` or `BIND_ADDRESS` to configure the local listener. Do not expose the editor on an untrusted network without adding authentication and access controls.

## Service configuration

By default, the service reads `~/.config/rag-eval-dataset/golden.env`; set `GOLDEN_CONFIG_FILE` to use another file. The file may contain RAGFlow or OpenAI-compatible service settings. Keep credentials on the server and do not commit the configured file.

The API supports state reads, entity and relationship updates, evidence drafting, retrieval previews, and recall checks. Retrieval previews are read-only; saving a draft is an explicit write to the private data directory.

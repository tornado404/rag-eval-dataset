# Evidence–Chunk source mappings

An Evidence excerpt must be a verbatim, continuous passage from one Chunk or from consecutive Chunks in the same source document. A mapping records where that passage occurs and preserves its own experiment version, revision history, and review decision. Evidence review and mapping review are separate workflows.

## Mapping record

Mapping revisions are stored in the private dataset at `governance/evidence-mapping-revisions.jsonl`. Each revision contains:

- `evidence_id` and `experiment_version`, which identify the mapping being reviewed;
- the exact `excerpt` and ordered `chunk_ids`;
- a `source_anchor` with one segment per Chunk, code-point start and end offsets, the exact quote, and a SHA-256 digest of the Chunk text;
- `review_status` (`pending`, `approved`, or `rejected`), reviewer, review time, and note.

The public record shape is described by [`schemas/evidence-mapping-revision.schema.json`](../schemas/evidence-mapping-revision.schema.json); source offsets and digest validity are also checked against the private Chunk snapshot when reading or saving a mapping.

Offsets count Unicode code points from zero, with the end offset excluded. A changed Chunk makes its anchor stale. Revisions are append-only; a new edit creates the next revision. Different experiment versions keep separate excerpts, source Chunk sequences, and decisions.

Approving a mapping in the default `source-anchor-v1` experiment also updates the private Golden snapshot’s Evidence excerpt and `evidence_chunks` relation. Rejecting a default mapping clears its canonical Chunk links so it cannot remain active as Gold. Saving a pending candidate leaves those canonical tables untouched. Approving or rejecting another experiment version records that version’s decision without changing the canonical Evidence tables.

## Review rules

1. Select only Chunks that contribute text to the excerpt, in source order. The excerpt must equal the joined anchored quotes exactly.
2. A multi-Chunk mapping must use Chunks from the same dataset and document. The reviewer confirms that they are consecutive in the source before approval.
3. A source digest or offset mismatch invalidates an approved mapping and marks it stale.
4. Mapping approval does not change the Evidence record’s own review status.
5. Automatically generated candidates are always pending. Exact text matching proves the quote is present; it does not prove the excerpt supports the intended fact.
6. Recall runs that use a mapping ledger score only approved mappings for the selected experiment version. An `AND` Fact remains unscorable until every linked Evidence mapping is approved; an `OR` Fact can use any approved Evidence mapping. Datasets without a mapping ledger retain the existing recall behavior.

## Preparing a private review snapshot

The preparation command reads a state bundle and writes a private Golden snapshot, candidate revision ledger, per-Evidence audit JSONL, and summary report. It requires an output directory outside this repository and refuses to overwrite a non-empty directory.

```bash
node scripts/prepare-evidence-mapping-review.mjs \
  --input-state /path/to/golden-state.json \
  --output-dir /private/path/golden-evidence-review \
  --experiment-version source-anchor-v1
```

An optional `--overrides /private/path/exact-source-overrides.json` accepts a JSON array of manually selected `{ "evidence_id", "excerpt", "chunk_ids", "note" }` entries. The command verifies each excerpt against the named Chunk or Chunks and still records it as pending.

Point the local Golden editor at the generated snapshot with `GOLDEN_DATA_DIR=/private/path/golden-evidence-review`. Candidate excerpts and source text stay in that private directory; do not commit or publish them.

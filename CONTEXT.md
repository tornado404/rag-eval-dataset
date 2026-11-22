# Golden Dataset Context

This glossary defines the source-grounding terms used by Golden dataset curation and retrieval evaluation.

## Evidence and source mapping

**Chunk**:
The smallest parsing unit produced by RAGFlow and a unit that retrieval can return.

**Evidence**:
The smallest continuous passage grounded in original source text that supports a fact. It may span consecutive Chunks.
_Avoid_: A paraphrase assembled from a Chunk

**Evidence–Chunk Mapping**:
A versioned record locating an Evidence excerpt in one or more source Chunks, with its own review status.
_Avoid_: An unqualified Evidence–Chunk link

**Source Anchor**:
The Chunk ID, exact excerpt offsets, quoted source text, and source content digest that locate an Evidence excerpt.

**Experiment Version**:
The identifier for one mapping experiment. Different versions may retain different source excerpts or Chunk sequences for the same Evidence.

**Mapping Review Status**:
The pending, approved, or rejected decision for an Evidence–Chunk Mapping. It is independent of the Evidence record’s review status.
_Avoid_: Evidence status when referring to mapping approval

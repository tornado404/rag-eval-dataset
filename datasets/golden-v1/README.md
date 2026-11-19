# golden-v1

Query 主键的金标准数据集，由 `npm run golden` 审核页面维护。

初始种子数据由 `scripts/migrate-v15-to-golden.mjs` 从历史提交 `968bad4` 的 `datasets/v1.5/` 迁移。题目、事实、证据关系、Chunk 映射均来自该提交，未使用臆测样例。

## 文件

| 文件 | 内容 |
| --- | --- |
| `queries.jsonl` | 用户问题；变体通过 `parent_query_id` 归到主问 |
| `facts.jsonl` | 手工编写的原子事实 |
| `evidences.jsonl` | 证据摘录 |
| `chunks.jsonl` | RAGFlow Chunk 的本地快照 |
| `query_facts.jsonl` | Query → Fact（requirement 与可选的 Query 内 group_id） |
| `fact_evidence.jsonl` | Fact → Evidence（OR / AND） |
| `evidence_chunks.jsonl` | Evidence ↔ Chunk（多对多） |

## 约定

- 一条 Query 就是一条评测样本；同义句与口语化各自成行，便于单独统计。
- `group_id` 只在当前 Query 内生效。`required` 且共享 `group_id` 的 Fact 属于必需组，组内每条 Fact 都要命中且各自计 1 项；没有 `group_id` 的 `required` Fact 各自独立计分。
- `required_any` 且共享 `group_id` 的 Fact 属于一个任选组，命中组内任一 Fact 即满足 1 项；不同 `group_id` 是不同评分项。同一 Query 内旧数据或旧客户端未提供 `group_id` 的 Fact 共用默认组 `A1`。
- `optional` 只提供上下文，不计分；`forbidden` 明确不得作为答案依据。
- Evidence 是人工摘录，不是 Chunk 的复制品。一条 Evidence 可以引用多个 Chunk。
- Fact 只要有一个 Evidence 关联了 Chunk，就具备召回评分条件。
- 已审核样本把 `status` 置为 `approved`；发布前把整个目录复制成新版本，不覆盖本目录。
- 写盘不会自动提交；`git diff` 确认后手动 commit。

完整字段与接口见 `docs/golden-dataset-review-tool.md`。

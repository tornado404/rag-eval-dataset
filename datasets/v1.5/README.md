# v1.5 · M3 qwen 知识库映射版

`v1.5` 以 `v1.4` 为唯一数据基线：题目、事实、关系、预期输出、场景和术语均沿用 `v1.4`，只重新映射 `evidences.jsonl` 中的 `ragflow_chunk_id`，使其指向 M3 当前 qwen 解析库中的真实 chunk。

v1.4 的证据 chunk ID 来自旧解析库，直接用于当前 RAGFlow 检索会命中不到任何内容。v1.5 因此不改变评测口径，只修正证据定位。

## 目标知识库

映射目标是 2026-11-17 M3 上 `RAGFLOW_DATASET_IDS` 实际使用的三个 qwen 数据集：

| dataset | RAGFlow 名称 | dataset_id | 文档数 | chunk 数 |
| --- | --- | --- | ---: | ---: |
| `DS01` | Customer Service Scripts-qwen | `6fc656c4dc4811f182a97bfda9b37d41` | 13 | 131 |
| `DS02` | Medical Research Paper-qwen | `7131ca20dc4811f182a97bfda9b37d41` | 245 | 21599 |
| `DS03` | Medication Guide-qwen | `73843970dc4811f182a97bfda9b37d41` | 3 | 263 |

`datasets.jsonl` 记录上述数据集元数据；`mapping_report.json` 记录逐数据集映射统计。

## 映射方法

1. 用 `/api/v1/datasets/{id}/documents` 与 `/api/v1/datasets/{id}/chunks` 全量导出新旧库 chunk。
2. 优先用旧 chunk 正文在新库中做规范化精确匹配或包含匹配。
3. 旧 chunk 无法匹配时，回退到 `evidence.source_text` 做精确/包含匹配。
4. 仅对同文档名、长文本且 bigram 覆盖率不低于 0.55 的页级分块做保守模糊匹配。
5. 未匹配证据不保留旧 chunk ID，评测时按不可评分处理，不猜测 ID。

## 映射结果

- 证据总数 482，已映射 479，未映射 3。
- 54 条证据映射到多个 chunk（同一事实跨分块）。
- 使用到的目标 chunk 共 314 个。
- 来源：`chunk_exact` 432、`source_contains` 30、`source_fuzzy_page` 17、`unmapped` 3。

未映射证据均为 `DS01` 的 `z1658-public-nav` 内容，上游答案文本已被改写，无法在不猜测的前提下定位：

- `E00096`
- `E00097`
- `E00466`

引用这些证据的事实/题目在 v1.5 中仍保留，但对应 Gold 覆盖会被记为不可评分，而不是算作检索失败。

## 重新生成

本目录由脚本生成，不手工编辑 `evidences.jsonl`：

```bash
RAGFLOW_BASE_URL=http://127.0.0.1:8088 \
RAGFLOW_API_KEY=... \
RAGFLOW_DATASET_IDS=<旧库三个 ID> \
node scripts/dump_ragflow_chunks.mjs /tmp/ragflow-old.jsonl

RAGFLOW_BASE_URL=http://127.0.0.1:8088 \
RAGFLOW_API_KEY=... \
RAGFLOW_DATASET_IDS=6fc656c4dc4811f182a97bfda9b37d41,7131ca20dc4811f182a97bfda9b37d41,73843970dc4811f182a97bfda9b37d41 \
node scripts/dump_ragflow_chunks.mjs /tmp/ragflow-new.jsonl

node scripts/build_v15.mjs /tmp/ragflow-old.jsonl /tmp/ragflow-new.jsonl
```

生成的 chunk dump 体积大且含知识库原文，只作为本地中间产物，不提交到 Git。

## 评测口径

- 原始候选层使用 `ragflow_chunk_id` 与 `ragflow_candidate_chunk_ids_at_12` 的交集计算 `Recall@12`。
- AI 问答链路使用后端观测中的 `final_grounding_chunks` 计算最终证据池的 `Recall@K` / `Hit@K`。
- 单轮题目通常会在 Query 改写门禁处跳过改写（`gate_skip`）；要验证服务内 Query 改写是否实际生效，应使用同一 session 的多轮 followup/correction 题。

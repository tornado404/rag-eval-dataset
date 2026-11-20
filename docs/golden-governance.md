# Golden Dataset 治理 CLI

`golden-v1` 的七张核心 JSONL 表仍由正在运行的 Golden 服务负责编辑。本 CLI 只写 `datasets/golden-v1/governance/` 下的 sidecar 文件，不会修改核心表、`MANIFEST.json` 或 `editor/` 文件。

## 查看状态

```bash
node scripts/golden-governance.mjs status
```

状态按 `approved`、`rejected`、`stale`、`pending` 统计。缺少审核记录表示 `pending`。审核记录中的 `subject_digest` 与当前数据不一致时表示 `stale`，必须重新审核，旧结论不会被接受。

## P2 启动门禁

```bash
npm run gate:p0-p1
```

门禁重新计算 split，并检查三类跨集泄漏、核心表字节、Query–Fact 审核、Fact 映射审核和 split 审核。它不写真实数据目录。

当前数据仍在审核中，门禁会返回非零退出码，并在 JSON 中列出 `blockers`。只有 `passed` 为 `true` 时才能启动 P2 sweep runner。

## 审核 Query–Fact 与 Fact 映射

```bash
node scripts/golden-governance.mjs review query-fact --query Q00001 --fact F001 --status approved --reviewer alice --note "确认"
node scripts/golden-governance.mjs review mapping --fact F001 --status approved --reviewer alice
```

命令按 `subject_type + subject_id` upsert `governance/reviews.jsonl`。重复执行同一审核会保持同一条记录；换 reviewer、状态、备注或底层摘要会更新这条记录。

`query-fact` 的摘要覆盖当前 Query–Fact 关系。`mapping` 的摘要覆盖 Fact 表述、operator、按顺序排列的 evidence ID，以及每个 evidence 按顺序排列的 chunk ID。任一底层内容变化后，该审核都会变成 `stale`。

## 提出与查看 Split

```bash
node scripts/golden-governance.mjs split propose --id split-golden-v1-v1 --seed 42 --validation-ratio 0.2
node scripts/golden-governance.mjs split show --id split-golden-v1-v1
```

Split 按场景整组划分验证集，再按共享 required Fact 和共享 required Chunk 把训练侧 Query 标记为 `quarantined`。验证侧 Query 保持 `validation`。`quarantined` 表示这条 Query 与验证集共享必需资源，因此不进入训练集；它既不用于训练，也不用于最终验证，避免泄漏。CLI 要求训练集与验证集的场景交叉、共享 Fact 和共享 Chunk 数量都为零，否则拒绝生成。

`propose` 不会覆盖不同的同名 split 文件；内容相同时是 no-op。核心表变化会使 split 的 `core_digest` 失效，必须重新提出 split。

## 审核 Split

```bash
node scripts/golden-governance.mjs review split --split split-golden-v1-v1 --status approved --reviewer alice
```

Split 审核摘要只覆盖与审核无关字段。确认 split 内容、泄漏报告和审核摘要后再批准。任何 `stale` 审核都要用相同命令重新执行；旧的 `approved` 或 `rejected` 不会继续生效。

支持 `GOLDEN_DATA_DIR` 指向另一个 Golden 数据目录，便于在副本上预演：

```bash
GOLDEN_DATA_DIR=/path/to/golden-copy node scripts/golden-governance.mjs status
```

# rag-eval-dataset

一个独立的、可编辑且 Git 可追踪的 RAGFlow 问答评测题库，用于反复跑 `Recall@12` 与 HIT。

## 目录

- `datasets/v1.4/cases.jsonl`：题目、场景、检索概念、必需/禁止事实 ID。
- `datasets/v1.4/facts.jsonl`、`evidences.jsonl`、`fact_evidence_relations.jsonl`：事实与证据口径。
- `datasets/v1.4/expected_outputs.jsonl`：可编辑的预设答案、行为、rubric、审核状态。
- `editor/index.html`：单页编辑器；JSONL 是真源，HTML 只提供交互。
- `editor/server.mjs`：读取/保存 JSONL、运行校验、自动 Git commit。
- `scripts/compute_hit.mjs`：从评测明细计算 `Recall@K`、`any_hit@K`、`strict_hit@K`。

## 本地编辑

```bash
npm run editor
# 打开 http://127.0.0.1:4173
```

默认保存到工作区后自动 `git commit`。默认不 push；如需 push：

```bash
AUTO_PUSH=1 npm run editor
```

浏览器不保存任何 token。Git push 使用当前机器已配置的 GitHub 凭据。

## 校验

```bash
npm run validate
```

## 指标口径

- `macro_fact_recall@K`：answer 题的 `covered required facts / total required facts` 宏平均。
- `any_hit@K`：至少命中一个 required fact 的 answer 题占比。
- `strict_hit@K`：全部 required facts 命中的 answer 题占比。

给定 `eval_retrieval.py` 生成的 `details_mode_a.jsonl`：

```bash
node scripts/compute_hit.mjs /path/to/details_mode_a.jsonl --top-k 12
```

## 版本冻结

编辑后建议：

```bash
npm run validate
git tag datasets/v1.5
git push origin main --tags
```

评测时应固定到某个 tag/commit，避免“跑的是哪一版题库”不可追溯。

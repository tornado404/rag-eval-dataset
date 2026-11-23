# RAGFlow 第一版检索评测

本工具将现有 Golden 数据编译为 Query 的 Evidence 支持路径和 Evidence 的 Chunk 覆盖路径，再对保存的 RAGFlow 返回结果进行三种评分。运行时不读取 Fact。源数据、检索回包、快照、模型提示词和评分器均以版本或 SHA-256 记录。评测结果及私有来源应保存在仓库之外。

## 路径与可评分性

- 每个 `required` Fact 是一个必需条件；同一 `required_any` 组是一个任选条件；忽略 `optional` 和 `forbidden`。编译器将条件之间的 AND 和每个 Fact 的 Evidence AND/OR 展开为 Evidence 路径的 OR-of-AND，并删除逻辑上被较短路径包含的冗余路径。
- 已审核来源锚点里的连续 Chunk 合为一条 AND 路径。输入使用显式 `chunk_paths` 时，多 Chunk 路径须确认连续。缺少审核账本时，单 Chunk 路径只有在原文完整包含 Evidence 时才接受；不可判断的多 Chunk 映射标为不可评分。
- 为避免分母随检索结果改变，任一候选 Evidence 路径缺少可用的 Chunk 映射时，该 Query 的 Gold 路径评分列为不可评分，已观察到的命中仍保留在明细中。返回 Chunk ID 与来源快照相同但文本哈希不同，也会标记为不可评分。
- 文本评分先检查单个实际返回 Chunk，再检查同文档且 `source_order` 明确相邻的 Chunk。没有完整顺序时，使用已确认的 Gold Chunk 路径约束多 Chunk 检查，并标记 `constrained_text_check`。保留医学数字、单位、否定和标点；HTML 标签、Unicode 格式及空白做有限标准化。
- 实验不能覆盖已有快照、检索目录或报告。原始检索回包和转换后的结果都保存；`positions` 不被当作连续顺序。

## 快照与保存的检索结果

以下示例把输出写到仓库外的私有目录。源目录包含 Golden 七张 JSONL 表；若存在 `governance/evidence-mapping-revisions.jsonl`，须指定相应的映射版本。`--trace` 保存编译时 Fact 关系，供事后审计，评分器不会读取它。

```bash
node scripts/eval-v1/cli.mjs compile \
  --source /private/data/golden --dataset-version golden-v1 \
  --mapping-version source-anchor-v1 --out /private/eval/snapshot.json \
  --validation /private/eval/snapshot-validation.json --trace /private/eval/compilation-trace.jsonl

node scripts/eval-v1/cli.mjs freeze-retrieval \
  --snapshot /private/eval/snapshot.json --raw /private/data/retrieval.jsonl \
  --manifest /private/data/retrieval-manifest.json --out /private/eval/retrieval \
  --experiment replay-001 --k 12
```

快照编译会校验来源锚点、Chunk 正文哈希和原文摘录。原始查询、检索请求中的 Query 和快照不一致时，保存器拒绝生成实验。历史检索清单未记载的 RAGFlow 数据集及文档版本被标记为 `unrecorded`，不能据此声称版本可完整复现。

## 语义评分与报告

语义评分仅向配置的模型发送 Query 和实际返回 Chunk，不发送 Golden Evidence、路径或 Fact。可通过 `LLM_BASE_URL`、`LLM_MODEL`、`LLM_API_KEY` 环境变量配置，也可使用现有 `~/.config/rag-eval-dataset/golden.env`。生成的结果只作为诊断，直到人工校准通过。

```bash
node scripts/eval-v1/cli.mjs judge \
  --snapshot /private/eval/snapshot.json --retrieval /private/eval/retrieval/retrieval.jsonl \
  --out /private/eval/semantic.jsonl --concurrency 4 --attempts 3

node scripts/eval-v1/cli.mjs report \
  --snapshot /private/eval/snapshot.json --retrieval-dir /private/eval/retrieval \
  --semantic /private/eval/semantic.jsonl --out /private/eval/report
```

如果语义评分中断，可对同一输出加 `--resume`；程序核对快照、回包、模型、提示词和评分代码哈希后继续。单题错误单独记录，语义覆盖率使用全部答案型 Query 作分母。报告中的分数使用各自可评分的 Query 作分母；差异桶同时显示占全部答案型 Query 和占三种评分均可比较 Query 的比例。`report.html` 支持按问题检索并展开三种评分、命中路径和实际 Top-K；`query-results.csv` 与 `query-results.jsonl` 可用于导出和进一步分析。

有校准报告后，可在生成新报告时附加 `--calibration /private/eval/calibration-report.json`；程序检查其快照、检索结果和语义评分哈希，并在报告中列出人工校准及重复稳定性状态。

报告支持 `--source-order-audit /private/eval/source-order-audit.json` 加载已核查的补充顺序；补充文件须绑定检索结果哈希，并逐条验证 Query、排名、Chunk ID、正文哈希、同文档及连续索引。输出明细保存所用顺序和来源，报告记录补充文件哈希。额外顺序信息构成新的报告版本，原始检索回包不会修改。

## 人工校准

```bash
node scripts/eval-v1/cli.mjs calibration-set \
  --snapshot /private/eval/snapshot.json --retrieval /private/eval/retrieval/retrieval.jsonl \
  --out /private/eval/calibration --count 120

node scripts/eval-v1/cli.mjs judge \
  --snapshot /private/eval/snapshot.json --retrieval /private/eval/retrieval/retrieval.jsonl \
  --selection /private/eval/calibration/human-calibration-blank.jsonl \
  --out /private/eval/semantic-repeat.jsonl --concurrency 2

node scripts/eval-v1/cli.mjs calibrate \
  --snapshot /private/eval/snapshot.json --retrieval /private/eval/retrieval/retrieval.jsonl \
  --annotations /private/eval/calibration/human-calibration-annotated.jsonl \
  --semantic /private/eval/semantic.jsonl --repeat /private/eval/semantic-repeat.jsonl \
  --out /private/eval/calibration-report.json
```

标注集不包含模型结论。打开样本目录中的 `human-calibration.html` 可逐条填写并导出 JSONL；也可直接编辑 JSONL。人工需先独立填写标签和标注人，再保存为新文件；持续有分歧的样本标为 `ambiguous`。标注类别使用样本目录说明中的十个代码；若样本不足以覆盖，需补充人工样本。工具核验每个样本的 Query 和 Chunk 输入哈希、模型和提示词版本，输出四类混淆矩阵、完全支持的精确率/召回率、总体一致率和重复稳定性。硬门槛为至少 100 条有效人工标注、十个必需类别全部覆盖、全部有效样本有重复评分、精确率 ≥95%、召回率 ≥90%、一致率 ≥90%、稳定性 ≥99%。未完成标注或重复评分时状态为 `incomplete`。

## 验证

```bash
node --test test/eval-v1.test.mjs
```

测试覆盖 T01–T12 的路径和接口行为，包括 AND/OR、跨 Chunk、数字差异、否定、语义结果独立性、引用校验和重复调用。语义相关单元测试使用模拟模型，不能代替对真实模型的人工作答校准。

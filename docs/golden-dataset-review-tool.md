# Golden Dataset 审核工具

目标：用 Query 作为金标准主键，把每个 Query 依次关联事实（Fact）、证据（Evidence）和 RAGFlow 原始 Chunk，并在录入时直接试检索，先发现召回问题再冻结数据。

该工具是 `editor/` 的兄弟模块，读取 `datasets/golden-v1/`。它不修改 v1.4 冻结版本，也不接入审核员登录或操作日志。

## 数据模型

一份金标准样本 = 一条 Query。变体（同义句、口语化、追问）各自是一行 Query，通过 `parent_query_id` 归到主问。

```text
queries.jsonl          Q0001  主键，含 text / variant_type / status
facts.jsonl            F001   手工编写的原子事实
evidences.jsonl        E001   证据摘录（可编辑，可跨多个 Chunk）
chunks.jsonl           <RAGFlow chunk id>  Chunk 快照（文档、页码、原文）
query_facts.jsonl      query → facts，含 requirement 和 Query 内可选的 group_id
fact_evidence.jsonl    fact → evidences，operator: OR / AND
evidence_chunks.jsonl  evidence ↔ chunks，多对多
```

关系图：

```text
Query ──< query_facts >── Fact ──< fact_evidence >── Evidence ──< evidence_chunks >── Chunk
  └── parent_query_id → Query（变体）
```

Evidence 与 Chunk 是多对多：一条证据可以由多个 Chunk 共同支撑；同一个 Chunk 可以被多条证据复用。Chunk 行是 RAGFlow 内容的本地快照（`dataset_id`、`document_id`、`document_name`、`page`、`content`），不是第二份权威数据。

### Query 与 Fact 的评分分组

`query_facts` 每行可带 `group_id`。组 ID 只在同一个 `query_id` 内有效。使用短且稳定的 ID，例如必需组 `R1` 和任选组 `A1`。

| `requirement` | `group_id` | 评分语义 |
| --- | --- | --- |
| `required` | 空 | 该 Fact 是独立必需条件，单独计 1 项 |
| `required` | 相同且非空 | 属于同一必需组；每个成员各计 1 项，所有成员都要命中 |
| `required_any` | 相同且非空 | 属于同一任选组；整组计 1 项，命中任一成员即可满足 |
| `required_any` | 不同且非空 | 每个 group 是独立评分条件 |
| `required_any` | 旧数据中为空 | 视为默认组 `A1`，保持旧版共用一个任选组的行为 |
| `optional` | 空 | 只提供上下文，不计分 |
| `forbidden` | 空 | 不得作为答案依据，不计分 |

`optional` 和 `forbidden` 不得设置 `group_id`。同一 Query 的同一个 `group_id` 不得混用 `required` 与 `required_any`。

### 字段

`queries`

| 字段 | 取值 |
| --- | --- |
| `query_id` | `Q0001` 递增 |
| `text` | 用户问题，非空，全局去重（忽略大小写与空白） |
| `variant_type` | `canonical` / `paraphrase` / `colloquial` / `follow_up` |
| `parent_query_id` | 变体所属主问；主问为空 |
| `expected_behavior` | `answer` / `refuse` / `clarify`，默认 `answer` |
| `status` | `draft` / `review` / `approved` |
| `notes` | 审核备注 |
| `created_at` / `updated_at` | ISO 时间 |

`facts`

| 字段 | 取值 |
| --- | --- |
| `fact_id` | `F001` 递增 |
| `statement` | 原子事实，非空 |
| `topic` | 主题；候选来自 v1.4 `scenarios.jsonl` 的 23 个场景名称 |
| `fact_type` | `product_information` / `population` / `usage` / `safety` / `special_population` / `ingredients` / `usage_safety` / `plain_language` / `customer_service` / `research_evidence` / `cross_source`，与 v1.4 `scenarios.domain` 和 `terminology.domain` 对齐 |
| `importance` | `P0` / `P1` / `P2` |
| `source_note` | 事实来源或判定依据 |
| `status` | `draft` / `review` / `approved` |

`evidences`

| 字段 | 取值 |
| --- | --- |
| `evidence_id` | `E001` 递增 |
| `title` | 证据标题，非空 |
| `excerpt` | 证据摘录，保留完整限定条件 |
| `status` | `draft` / `review` / `approved` |

`chunks`

| 字段 | 取值 |
| --- | --- |
| `chunk_id` | RAGFlow chunk id；手工 Chunk 用 `CK-0001` |
| `dataset_id` / `document_id` / `document_name` | 来源定位 |
| `page` | 页码，未知为空 |
| `content` | 原始文本快照 |
| `source` | `ragflow` / `manual` |

## 审核流程

1. 事实库手工录入 Fact，或从 Fact 起草 Query。
2. 起草 Query：服务端把所选 Fact 交给 LLM，返回 1 条 canonical 和若干同义句、口语化、追问候选；人工挑选后落库。批量提交时，候选列表中的第一条 Query 成为 canonical，后续 canonical 建议降级为 paraphrase，所有变体通过 `parent_query_id` 指向该主问。
3. 工作台或构造 Query 页面把 Fact 分配到必需单项、必需组、任选组、可选或禁止。必需组的所有成员都要命中，每个成员各计一项。每个任选组单独计一项，命中组内任一 Fact 即满足。
4. 用 RAGFlow 检索或按文档浏览 Chunk。核对原文后，摘录一条可支撑 Fact 的 Evidence，并关联来源 Chunk。一个 Evidence 可以引用多个 Chunk；一个 Chunk 也可以被多条 Evidence 复用。
5. 把 Evidence 关联到 Fact，并设置该 Fact 的 OR / AND 运算符。
6. 点“试检索”：用当前 Query 调 RAGFlow，返回 Top-K 中命中的 gold chunk。必需单项和必需组成员逐条计分；每个任选组独立计一项，组内命中任一 Fact 即满足。
7. 确认后状态置为 `approved`，进入下一条。

### 证据库

`证据库` 是自动匹配与存量核对页面。页面通过 `GET /api/golden/state` 读取 Query、Fact、Evidence、Chunk 和关系，通过 `GET /api/golden/evidence/inventory` 读取库存计数与 RAGFlow 配置。它展示 Evidence 总数、Chunk 总数、已关联/未关联 Chunk 数、无 Chunk 的 Evidence 数。

在该页选择真实 Query、目标 Fact 和检索范围，再点 `自动匹配 Chunk`。服务端调用 RAGFlow，按 RAGFlow 分数排序；缺少分数时，按 Query、Fact 和已有 Evidence 文本做词法匹配。结果会标出候选 Chunk、匹配到的 Fact 和 Evidence、来源文档及页码。检索只读，不会写入金标准。

勾选 Chunk 表示选择 Evidence 的来源。点 `创建 Evidence 草稿` 后，页面打开编辑窗口，并保留候选结果。窗口逐条展示所选 Chunk 的完整原文和来源信息。审核员可以移除来源、插入某条原文到摘录，再编辑标题和 Evidence 摘录。每条 Evidence 记录一项可核验事实；不同事实分别建条目，只有共同支撑当前 Fact 的 Chunk 才放进同一条 Evidence。页面不会自动拼接多个 Chunk 的内容，也不会在草稿阶段写入数据。草稿暂存在浏览器内存中，必须有目标 Fact、标题、摘录和至少一个来源 Chunk。

Chunk 卡片上的 `禁用` / `启用` 会调用 RAGFlow `PATCH /api/v1/datasets/{dataset_id}/documents/{document_id}/chunks`，发送 `available_int: 0` 或 `1`；禁用后的 Chunk 在重新启用前不再参与 RAGFlow 检索。该操作只修改 RAGFlow 的检索可用性，不写入本地 gold 文件或 Chunk 快照。

点 `保存 Evidence` 后，页面向 `POST /api/golden/evidence` 发送一个 Evidence 草稿、目标 `fact_id` 和所选 Chunk 快照。服务端在一次 `read → mutate → validate → write changed files` 操作中完成以下写入：

1. 按 `chunk_id` 新增或更新 `chunks.jsonl` 中的 Chunk 快照。
2. 在 `evidences.jsonl` 中创建一条状态为 `draft` 的 Evidence，保存审核员编辑的标题和摘录。
3. 在 `fact_evidence.jsonl` 中把新 Evidence 加入目标 Fact。若该 Fact 已有关联，保留现有 OR / AND 运算符。
4. 在 `evidence_chunks.jsonl` 中记录新 Evidence 引用的 Chunk ID 集合。

服务端先校验完整数据，再写入发生变化的 JSONL 文件。成功响应会返回更新后的数据集状态，页面据此刷新 Evidence 和关联信息。保存失败时，页面保留可编辑草稿；重复使用的 Chunk 不会被锁定或复制成新的 Chunk。

`送入工作台` 仍会把勾选的 Chunk 放进工作台选区。工作台的 `自动匹配` 按钮使用当前 Query 执行同一检索，并把候选送入工作台选区。

召回口径：一条 Evidence 只要有一个关联 Chunk 进入 Top-K 就算命中；Fact 的 `OR` 表示任一 Evidence 命中即可，`AND` 表示全部 Evidence 命中。没有 group 的 `required` Fact 各计一项。必需组内每条 Fact 各计一项，组内所有 Fact 都要命中。每个 `required_any` group 独立计一项，命中其中任一 Fact 即满足；不同 group 分别计分。旧数据中没有 `group_id` 的 `required_any` Fact 共用默认组 `A1`。没有可用 Chunk 的必需成员会被标为不可评分；任选组只有在所有成员都没有 Chunk 时才是不可评分。

Fact 的审核状态可在 Fact 库编辑，也可在“管理 Query 的 Facts”面板中直接修改。它是 Fact 的全局状态，会影响所有引用该 Fact 的 Query；试跑中的“命中 / 未命中”只表示本次召回结果。

召回试跑的宽窗顶部可切换当前 Query 的 Fact，下面并排比较预期与实际结果。左栏展示所选 Fact 关联的 Evidence，以及每个 Gold Chunk 的标题和完整本地快照原文；快照缺失时显示“无本地快照”。右栏展示 RAGFlow 本轮 Top-K 的完整 Chunk 原文。`matched` 标记只针对当前选中的 Fact：某个实际结果出现在该 Fact 的 `matched_chunk_ids` 中时才会显示，用于对照预期 Chunk 与本次真实召回。切换 Fact 不会重新检索，也不会改变评分。

## 接口

所有写操作在一次 `read → mutate → validate → write changed files` 事务内完成；只要校验失败就不落盘。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/golden/state` | 全量状态 + 配置可用性 |
| GET | `/api/golden/evidence/inventory` | Evidence/Chunk 数量、关联和孤立统计 |
| POST | `/api/golden/entities/:type` | 新增/更新 query / fact / evidence / chunk |
| DELETE | `/api/golden/entities/:type/:id` | 删除实体并级联清理关系 |
| POST | `/api/golden/links/query-facts` | 覆盖 Query 的 Fact 集合 |
| POST | `/api/golden/query-facts/manage` | 一次保存 Query 的 Fact 关联与 Fact 审核状态 |
| POST | `/api/golden/links/fact-evidence` | 覆盖 Fact 的 Evidence 集合与运算符 |
| POST | `/api/golden/links/evidence-chunks` | 覆盖 Evidence 的 Chunk 集合 |
| POST | `/api/golden/evidence` | 创建 Evidence、Chunk 快照和两层关联，校验后写入变更文件 |
| POST | `/api/golden/evidence/polish` | 用 LLM 润色 Evidence 草稿的标题和摘录，不写数据 |
| POST | `/api/golden/queries/draft` | LLM 从 Fact 生成 Query 候选 |
| POST | `/api/golden/queries/bulk` | 批量创建主问、变体及其 Fact 关联 |
| POST | `/api/golden/ragflow/search` | RAGFlow `/api/v1/retrieval` |
| GET | `/api/golden/ragflow/documents/:id/chunks` | RAGFlow 文档 Chunk 列表 |
| POST | `/api/golden/ragflow/chunks/availability` | 调用 RAGFlow PATCH 禁用/启用 Chunk，不写本地数据 |
| POST | `/api/golden/evidence/auto-match` | 按 Query/Fact 检索并排序候选 Chunk，不写数据 |
| POST | `/api/golden/recall` | 试检索并计算 gold chunk 覆盖 |

## 配置

默认读取 `~/.config/rag-eval-dataset/golden.env`，可用 `GOLDEN_CONFIG_FILE` 覆盖。进程环境变量优先。文件权限建议 `600`，凭据不会返回浏览器。

```bash
RAGFLOW_BASE_URL=https://ragflow.example.com
RAGFLOW_API_KEY=...
# 逗号分隔；带标签时用 id:显示名
RAGFLOW_DATASETS=9c66...:公共客服话术库,f115...:骨化二醇科研文献库

# OpenAI 兼容 Chat Completions
LLM_BASE_URL=https://llm.example.com/v1
LLM_API_KEY=...
LLM_MODEL=...
```

启动：

```bash
npm run golden
GOLDEN_PORT=4174 BIND_ADDRESS=0.0.0.0 npm run golden
```

写盘后不会自动 Git commit；确认 diff 后手动提交。数据按版本目录新增，已发布目录不覆盖。

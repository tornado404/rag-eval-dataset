# Pilot 标注规范：Evidence、Fact 与 Question

本规范只约束 Pilot 标注，依据《RAG 问答评测知识地图建设执行方案 v1.0》§§3.2、8–12、22–24。示例取自已完成的 ZOYEN-1993 Pilot Scenario Registry：S003「日常用法与用量」、S020「产品资料与科研证据核对」；它们当前是 `draft` 场景，只说明标注边界，不代表 Gold 数据已批准。

## 1. Evidence 记录规范

### 1.1 原文访问与定位

- 办公网内优先访问 `http://192.168.31.201:8088`；办公网外访问 `https://ragflow.dozoyen.com/`。
- 当前 `RAGFLOW_BASE_URL` 超时后，按当前网络位置切换到可用入口重试。超时不等于原文不存在；两个入口都不可达时记录访问阻塞，不能据此判定「无 Evidence」。
- 正例：办公网内网入口超时后切到公网入口重试，并记录实际访问位置与结果。反例：内网一次超时就把 Scenario 标成「原文不可得」。

### 1.2 必填字段与定位键

每条 Evidence 记录 `evidence_id`、`dataset_id`、`document_id`、`document_name`、`page`、`section`、`source_text`、`source_hash`；`ragflow_chunk_id` 仅作可空的运行时辅助字段。

- 正例：用 `dataset_id + document_id + page/section + source_hash` 定位原文片段，并给它稳定的 `evidence_id`（从 `E00001` 起，已使用 ID 不复用）。
- 反例：只保存 `ragflow_chunk_id`，或将 chunk ID 当作 Evidence ID；重新解析后无法稳定追溯。
- **来源分级（Gate C2，ZOYEN-2004）**：扩充新增 Evidence 必须在交付说明中标注来源等级——`原文件`（直接核对了原始 .txt/.pdf/.docx）、`解析文本`（仅以 RAGFlow chunk 文本核对，如 DS01——原始 .txt 下载不可用，见 `pilot-review-report.md` §3）、`元数据`（仅有 document/section 定位）。标 `解析文本` / `元数据` 的条目不得计为原文件核验；汇报「原始资料命中率」时必须分级列出，不得混写为 100% 原文命中。

### 1.3 `source_text` 摘录边界

只摘自原始文档，逐字保留原文，取能够支持待标事实的最小连续片段。保留否定词、情态词、限定条件和必要上下文；表格摘录须包含对应行及理解该行所需的表头、单位。非连续原文分别建立 Evidence，不拼接、不改写、不用模型摘要代替原文。

- 正例：摘录表格中的目标行，并同时包含「适用人群」「每日次数」「单次用量」表头和单位。
- 反例：把两个不相邻段落拼成一句，或将「建议咨询医生」改写成「禁止使用」。

### 1.4 `source_hash` 算法

先将 `\r\n` 与孤立 `\r` 统一为 `\n`，再去除首尾 Unicode 空白；内部字符、空格和标点保持原样。对结果编码为 UTF-8，计算 SHA-256，并保存为 64 位小写十六进制字符串：`source_hash = hex_lower(SHA256(UTF8(normalize(source_text))))`。

- 正例：只因 CRLF/LF 或首尾空白不同的同一摘录，规范化后得到相同 hash。
- 反例：先压缩内部空格、删除标点或改写原句再计算 hash；这会掩盖原文差异。

## 2. Atomic Fact 原子化规则

### 2.1 判定条件

一条 Fact 必须能独立判断「正确 / 错误 / 未提及」，且只能包含一个可独立判断的断言。用「前半句正确、后半句错误」判定法逐条检验：只要存在这种可能，就必须继续拆分（方案 §3.2）。

- 正例：原文「成年人每日2次，每次2粒，餐后服用」拆为四条 Fact（§2.2）。
- 反例：把同一句写成一条「成年人每日2次，每次2粒，餐后服用」。后半句可被单独证伪，违反原子化。

### 2.2 标准示例：S003「日常用法与用量」

原文：「成年人每日2次，每次2粒，餐后服用。」应拆为 **4 条** Fact：

| fact_id（示例） | Fact |
|---|---|
| F001 | 适用人群包括成年人 |
| F002 | 推荐每日使用2次 |
| F003 | 推荐每次使用2粒 |
| F004 | 建议餐后使用 |

拆成 3 条（省略适用人群）或 1 条（整句照抄）都不符合本规范；结论与方案 §3.2 一致。

### 2.3 忠于原文，不做推导

- 正例：原文写「建议咨询医生」，Fact 写「建议使用前咨询医生」。
- 反例：同一条原文写成「禁止使用」或「不建议使用」，属于标注人员自行推导或加强。

## 3. Fact 审核状态机与写入权限

### 3.1 状态与迁移

状态只允许按 `draft → reviewing → approved` 或 `draft → reviewing → rejected` 单向迁移。`approved` / `rejected` 是终态；需要修改内容时，先把 Fact 退回 `draft`，改完后重新走 `reviewing`，不得在终态上直接改字。`rejected` 必须记录驳回理由；被 `rejected` 的 Fact 不得被任何 `draft` / `approved` 的 Question Case 引用。

### 3.2 各状态谁有权写入

| 状态 | 可写入者 | 规则 |
|---|---|---|
| `draft` | LLM 辅助工具、知识标注人员 | LLM 只能产出候选，且候选必须停留在 `draft`；未经人工确认不得离开 |
| `reviewing` | 知识标注人员 | 提交审核时写入，必须填写 `reviewer` 待审核人；LLM 不得写入 |
| `approved` | 具名人工审核员（业务专家） | 必须填写真实 `reviewer`；P0 Fact 只能由工作区 owner findfm932 签署；LLM 不得写入 |
| `rejected` | 具名人工审核员（业务专家） | 必须填写 `reviewer` 与驳回理由；LLM 不得写入 |

- 正例：LLM 抽取后写入 `draft`，标注人员核对原文后改为 `reviewing`，业务专家审核后写 `approved` 并填 `reviewer`。
- 反例：LLM 直接输出 `approved`，或审核员姓名留空却标 `approved`；二者都违反「LLM 不得自行批准 Golden 数据」。
- 反例：在 `approved` 记录上直接改 `fact` 字段而不退回 `draft`；修改后未重新审核，`approved` 已失效。

## 4. 数字、单位与条件保留规则

Fact 必须逐字保留原文的数字、单位和适用条件，不得约数化、不得换算、不得省略单位或前提。

- 正例：原文「成年人每日2次，每次2粒，餐后服用」保留为 F001「适用人群包括成年人」、F002「推荐每日使用2次」、F003「推荐每次使用2粒」；数字 `2`、单位「次」「粒」、人群条件「成年人」均在对应 Fact 中。
- 反例：写成「推荐剂量为2」（丢失单位）、「每天2次」（丢失「成年人」条件），或写成「每日约两次」（把确定数字改成约数）。
- 正例：原文「6岁以下儿童每次1片」的 Fact 保留「6岁以下」和「每次1片」。
- 反例：只写「儿童每次1片」，丢掉年龄边界；或把「每次1片」改写成「每日1片」，混淆单次量与日总量。

## 5. OR / AND 证据组表达规则

### 5.1 表达格式

在 `fact_evidence_relations.jsonl` 中，每行表示一个证据组：`fact_id, evidence_group, operator, evidence_ids`。`operator` 只取 `OR` / `AND`；同一 `fact_id` 内 `evidence_group` 从 1 递增且不重复；`evidence_ids` 中的 ID 必须真实存在于 `evidences.jsonl`。

字段类型、文件级校验与覆盖计算口径见 `README.md` §10–§11。补充约束：

- 一个 Fact 可以有多个证据组，组间为 OR：任一组满足即视为该 Fact 已覆盖；组内才按 `operator` 判定。
- 单元素 `OR` 表示「仅此一条直接证据」；不得用单元素 `AND` 表达同样的含义。
- `facts.jsonl` 的 `evidence_ids` 是直接证据集，关系文件必须完整覆盖它；追加佐证证据时，`OR` 新项须能独立充分支持该 Fact，`AND` 新项须为组合成立的必要条件，并在 `README.md` §10 的口径下落盘。
- Fact 文本、数字、单位或条件被修改后，除 §7 的两项检查外，必须重跑 §11 的校验入口；引用不成立时不得进入 `approved`。

### 5.2 OR 组

组内每条 Evidence 都能独立、充分地支持该 Fact，召回任意一条即视为该组已覆盖。适用于同一事实在多处原文重复出现（如说明书与客服话术口径一致）。

- 正例：F002「推荐每日使用2次」在说明书和客服话术各有一处原文，写成 `operator=OR, evidence_ids=[E00012,E00087]`；召回任一条即算覆盖。
- 反例：把 S020「产品资料与科研证据核对」所需的说明书功效陈述与科研研究结果写成同一 OR 组；两者陈述对象不同，召回其一并不等于该 Fact 已获支持。

### 5.3 AND 组

组内 Evidence 必须组合才能支持该 Fact，缺任一条都不得判为已覆盖。适用于跨文档、跨 Dataset 的组合断言（研究对象 + 干预方式 + 研究结果）。

- 正例：F020「某项研究在特定人群中观察到特定结果」写成 `operator=AND, evidence_ids=[E001,E002,E003]`，分别承载研究对象、干预方式和研究结果；缺 E002 即未覆盖。
- 反例：把上述三条写成 OR 组，只召回研究对象就判为覆盖；结论实际缺少干预与结果证据。
- 反例：同一组内混用 OR 与 AND 语义（如「E1 或 E2，且必须有 E3」）；应拆成两个证据组：组 1 `OR [E1,E2]`、组 2 `AND [E1,E3]` 等明确组合。

## 6. 定稿 Prompt（可整段复制执行）

两段 Prompt 必须整段使用，不得删减条款；占位符 `{{...}}` 由执行人替换为真实数据。模型输出一律视为候选，须经 §3 的人工审核。

### 6.1 Fact 抽取 Prompt

```text
你是 RAG 评测知识地图的 Atomic Fact 抽取助手。你的输出只是候选数据，不是 Golden 数据；任何候选都必须由人工审核后才能进入 approved。

【输入】
- scenario: {{scenario_id}} {{scenario_name}}
- evidence: {{evidence_id}}
- 原文摘录 source_text:
"""
{{source_text}}
"""
- 文档位置: dataset={{dataset_id}} document={{document_id}} page={{page}} section={{section}}

【任务】
从 source_text 中抽取 Atomic Fact 候选，输出 JSONL，每行一个对象，字段固定为：
fact, evidence_ids, source_condition, importance, uncertain, status

【必须遵守】
1. 只能提取 source_text 明确陈述的内容，禁止添加推理、常识或行业默认值。
2. 一条 Fact 只能包含一个可独立判断真假的断言。若存在「前半句正确、后半句错误」的可能，必须拆成多条。
3. 数字、单位、频次、适用人群、时间、前提条件不得省略或改写；不得约数化、不得换算。
4. evidence_ids 固定为 ["{{evidence_id}}"]；不得引用未提供的 Evidence。
5. 一句话包含多个事实时必须拆分，不得整句照抄为一条 Fact。
6. 原文存在歧义、缺页、指代不明或无法确认适用人群时，把 uncertain 设为 true，并在 fact 中保留原文措辞；不确定内容标 uncertain，不得自行判断、不得补全。
7. status 固定为 "draft"；importance 只能填 P0 / P1 / P2 或 null；source_condition 写明适用条件与判档依据，没有条件时填 "none"。

【输出】
只输出 JSONL，不要输出解释、Markdown 或代码围栏。若没有任何可抽取的显式事实，只输出一行：
{"status":"no_fact","reason":"说明原因"}
```

### 6.2 Question 生成 Prompt

```text
你是 RAG 评测知识地图的 Question 生成助手。你的输出只是候选问题，必须由 QA 人员审核后才能进入 approved。

【输入】
- scenario: {{scenario_id}} {{scenario_name}} — {{description}}
- 可用 Fact 列表（只允许引用 status=approved 的条目）:
{{approved_facts_jsonl}}
- 允许的 question_type: single_fact, multi_fact, multi_chunk, cross_document, cross_dataset, paraphrase, ambiguous, no_answer, conflict, conditional, concept_chain（v1.1 增补，见 §10）

【任务】
生成 Question 候选，输出 JSONL，每行一个对象，字段固定为：
question, scenario_id, type, required_fact_ids, optional_fact_ids, forbidden_fact_ids, expected_behavior, difficulty, priority, uncertain, status

【必须遵守】
1. 不得直接复制资料标题或说明书章节名；必须以真实用户自然语言表达。
2. 必须包含口语表达和短问题；至少 1 条多事实问题；Scenario 涉及多个 Dataset 时至少 1 条跨 Dataset 问题，涉及多份文档时至少 1 条跨文档问题。
3. required_fact_ids 只能引用输入中 status=approved 的 fact_id，且每个问题都要能解释「为什么需要这些 Fact」。
4. optional_fact_ids 只放答了加分、不答不扣分的 Fact；forbidden_fact_ids 放原文不支持、模型不得生成的结论。
5. 不得提出资料无法支持的问题；只有显式标记 no_answer 且 expected_behavior 为 `clarify` / `refuse_compliance` / `insufficient_evidence` / `escalate_human` 之一的题目例外（五值定义见 §11）。
6. 引用了非 approved 的 Fact，或无法确认 Fact 是否支持该问法时，把 uncertain 设为 true；保留候选但不得提交审核，由人工判断。不确定内容标 uncertain，不得自行判断。
7. status 固定为 "draft"；difficulty 取 easy / medium / hard；priority 取 P0 / P1 / P2；type 可多选，写成数组。
8. （Gate C4，ZOYEN-2004）v1 冻结验收按**纯 `cross_dataset` ≥ 20%** 执行：`cross_dataset` / `cross_document` 按 Required Facts 证据来源交集复算（`tools/calculate_case_coverage.py`），并集口径不再作为 v1 达标口径；每批 Question 交付后必须输出双口径（纯 / 并集）比例，纯口径不足 20% 时优先补跨 Dataset 题而非跨 Document 题。

【输出】
只输出 JSONL，不要输出解释、Markdown 或代码围栏。
```

## 7. 修改 Fact 后必须重跑的两项检查

任何 Fact 的 `fact`、`evidence_ids`、`source_condition` 或 `importance` 发生变化（包括 `approved` 退回 `draft` 后修改），都必须重跑以下两项，两项都通过才可重新提交审核；未重跑不得回到 `approved`。

### 7.1 Evidence Mapping

逐条核对：每个 `evidence_id` 仍存在；对应 `source_text` 仍逐字支持新的 Fact；数字、单位、条件和否定词未被改动；OR 组任一条仍独立充分，AND 组仍必须组合成立。任一项不成立，退回 Evidence 标注，不保留失效映射。

- 正例：F002 由「每日2次」改为「每日3次」后，重跑发现原 Evidence 写的是「每日2次」，于是更换 Evidence 或撤回修改。
- 反例：只改 Fact 文本、不重跑，继续沿用旧 Evidence，造成 Fact 与原文不一致。

### 7.2 Question Mapping

检索所有 `required_fact_ids` / `optional_fact_ids` / `forbidden_fact_ids` 引用该 `fact_id` 的 Case，逐条复核：Required 是否仍成立、Optional 是否应降级、Forbidden 是否因修改而失效。Required 不再成立的 Case 退回重写，不得保留旧映射。

- 正例：F002 拆分后，原「一天吃几个？」的 Required 从 `[F001,F002]` 调整为 `[F002,F003]`，并重新核对问题语义。
- 反例：Fact 已拆分或改写，Case 仍引用旧 `fact_id` 且未复核，导致问题与事实对不上。

检查完成后记录：检查人、检查时间、影响的 `fact_id` 与 `case_id` 范围、结论（通过 / 退回）。

## 8. 可执行性确认

可执行：§1 字段、定位键、摘录边界与 `source_hash`（`page` 缺失时留空，用 `section + source_hash` 定位）；§2 原子化判定；§4 数字/单位/条件规则；§5 OR/AND 表达；§6 两段 Prompt 可整段复制，输出为 `draft` 候选；§7 两项重跑检查。

执行限制：`approved` / `rejected` 只能由具名人工审核员写入，标注 Agent 不能自行签署，Stage 3 只产出 `draft` / `reviewing`；S003 原文尚未在 DS03 实际检索登记，§2.2 的 4 条 Fact 需在 Stage 2 用真实 Evidence 复核；本规范不定义评测平台实现与 RAG Score 算法。

## 9. 依据

方案 §§3.2、8–12、22–24；ZOYEN-1993 `scenarios.jsonl`（S003、S020，当前 `draft`）；ZOYEN-1988 讨论（RAGFlow 上下班入口与回落规则、LLM 不得自行批准 Golden 数据）。

## 10. 功效外溢/场景关联题（`concept_chain`，v1.1 增补）

> Owner 决议：2026-11-08。本节新增题型 `concept_chain`，并**废除**「用户问产品对爬山/熬夜等生活场景有没有帮助 → 荒谬联想 → no_answer」的旧定性。该旧定性错误，任何历史分析、批注或候选数据中沿用的，一律以本节为准。

### 10.1 定义

用户把产品主对象与自身生活场景或状态（爬山、熬夜、睡眠、体力活动等）组合，询问产品「有没有帮助」。问题不直接对应说明书适应症，必须先把场景映射为已建档的检索概念，再回到原始证据作答。该题型在 `question_type` 中记为 `concept_chain`（可与 `multi_fact` / `paraphrase` / `no_answer` 等并列）。

### 10.2 概念链构建规则

```text
主对象概念（如 RC_CALCIDIOL）
  → 场景关联概念（爬山 → RC_OUTDOOR_ACTIVITY；熬夜 → RC_SLEEP_DEPRIVATION）
  → Terminology 扩词检索（方案 v1.1 §23/§24）
  → 命中原始证据 → 只按 Gold Facts 作答
```

- 场景到概念的映射必须如实登记 `relation_type`：`爬山` 是 `户外运动` 的下位活动，记 `narrower`；`熬夜` 是 `睡眠不足` 的口语说法，记 `colloquial`；不得为了扩词把场景硬标成 `exact_alias`。
- 概念链是**检索手段**，只写入 `retrieval_concept_ids`；不得写入 `facts.jsonl`，不得参与 Fact Coverage 评分（§18）。
- 关系类型只取 §17 十一类封闭集；场景概念与主对象之间不得伪造等价或上下位关系。

### 10.3 判分边界（fail-closed）

1. 扩词只影响「怎么搜」；答案对错仍只由 Required / Optional Gold Facts 判分。
2. 命中可支撑原文 → 建 `answer` 题；`required_fact_ids` 必须逐条可解释「为什么需要」，数字、单位、人群与条件完整保留。
3. 概念链可建立、但语料只有间接证据 → 仍可建 `answer` 题，但答案只能陈述 Gold Facts 支持的部分（如肌肉功能、步行速度、跌倒），**不得**把场景本身写成结论（如「能提升爬山成绩」「能治失眠」）；同时在 `v1.1/corpus_gaps.md` 逐题登记直接证据缺口。
4. 连间接证据都没有 → 建 `no_answer` 题（`expected_behavior=refuse_or_insufficient_evidence`、`required_fact_ids=[]`），并必附 corpus gap 记录：检索词、命中情况、缺哪类文献、建议补充方向。是否补语料由 Owner 决定。
5. 禁止无证据建 `answer` 题。引用 DS01 客服话术支撑医学结论时，按 §1.2 标注来源等级（`解析文本`/`元数据`），不得冒充原始文献。

### 10.4 与 no_answer 口径的关系

与 ZOYEN-2039（§28）口径一致：`no_answer` 表示「语料不足以支持」，不表示「问题听起来荒谬」。`concept_chain` 与 `no_answer` 可以并列（`["concept_chain","no_answer"]`）；只要证据链不足，仍必须 fail-closed；但**禁止**把本族问题默认打成 `no_answer`。


## 11. expected_behavior 五值枚举（v1.3 增补，ZOYEN-2068）

v1.1/v1.2 的 `expected_behavior` 只有 `answer` 与 `refuse_or_insufficient_evidence` 二值，导致「澄清追问 / 合规拒答 / 证据不足 / 转人工」四类完全不同的期望行为被压成同一个值，无法分别评估。v1.3 起改为五值封闭集：

| 值 | 语义 | `required_fact_ids` | 典型触发 |
|---|---|---|---|
| `answer` | 正常作答 | 必须非空，逐条可解释「为什么需要」 | 语料有可支撑的 Gold Fact |
| `clarify` | 澄清追问 | 必须为空 | 用户问题歧义、缺关键限定（人群/剂型/场景），先问清再答 |
| `refuse_compliance` | 合规拒答 | 必须为空 | 明确禁止的医疗建议、处方/诊断、超说明书承诺等合规红线 |
| `insufficient_evidence` | 证据不足 | 必须为空 | 主题合理但语料无证据，fail-closed 不编造 |
| `escalate_human` | 转人工 | 必须为空 | 需人工/客服跟进（售后、退款、个体化诊疗）或超出自动应答边界 |

判定顺序（fail-closed）：先判合规红线（`refuse_compliance`），再判是否必须人工（`escalate_human`），再判是否歧义需澄清（`clarify`），最后才判证据是否不足（`insufficient_evidence`）；只有能落到 Gold Fact 且无上述情形时才是 `answer`。

### 11.1 v1.3 的映射范围

本版本只调整 8 条存量题（`C00030`→`clarify`；`C00031`/`C00033`/`C00052`/`C00054`→`refuse_compliance`；`C00032`/`C00051`→`escalate_human`；`C00053`→`insufficient_evidence`），其余 12 条存量 `no_answer` 题（`C00078` `C00079` `C00114` `C00115` `C00116` `C00117` `C00119` `C00120` `C00149` `C00150` `C00155` `C00159`）字节不动，继续保留退役值 `refuse_or_insufficient_evidence`。

退役值只对上述 12 个 `case_id` 白名单放行：校验器 `tools/validate_knowledge_map_v11.py` 在 v1.3 口径下发现白名单外使用旧值即报错；白名单内题目一旦迁移为五值之一，必须同步收敛白名单常量。新增题目一律只能取五值。

### 11.2 与 no-answer / 评分的关系

- `question_type` 含 `no_answer` 的题目，`expected_behavior` 必须属于四类非作答行为之一（或存量退役值），且不得为 `answer`。
- 非 `answer` 题目的 `required_fact_ids` 必须为空：它们不参与 Fact Coverage 评分，命中情况记录在 `corpus_gaps.md` / `cases_coverage.md`。
- 枚举只描述「该题期望系统做什么」，不改变任何 `question`、证据关系或答案方向；v1.3 未重跑评测。

## 12. v1.4 标注纠错改判（ZOYEN-2083，2026-11-10）

依据 `docs/compliance/stage5-coverage-gap-adjudication-v1.md`（裁定 v1.1）§1.1 逐题重算表与 §2.3/§2.4 题组裁定，本版本改判 7 条存量题。改判理由：v1.1/v1.2 标注 `refuse_or_insufficient_evidence` 时按「知识库可能没有」从宽；v1.3 逐题裁定确认题组 C（生活指导通用知识）与题组 D（平台服务事实）知识库可答且答案不越界，按「答错代价可承受 + 有可引用依据」改判 `answer`；C00078 经逐题表复核实为模糊不适询问，改判 `clarify`。

| case_id | v1.3.0 | v1.4.0 | 依据（裁定章节） |
|---|---|---|---|
| `C00078` | `refuse_or_insufficient_evidence` | `clarify` | §2.1.1 模糊不适：三重条件命中（safety 0.65 越 0.5 + 不适词 + 无急症词） |
| `C00114` | `refuse_or_insufficient_evidence` | `answer` | §2.3 题组 C：疗程询问属规则性询问，F006/F133 可引用 |
| `C00115` | `refuse_or_insufficient_evidence` | `answer` | §2.3 题组 C：食物同服规则性询问，F131/F430 可引用 |
| `C00120` | `refuse_or_insufficient_evidence` | `answer` | §2.3 题组 C：运动询问属规则性询问，F131/F457 可引用 |
| `C00150` | `refuse_or_insufficient_evidence` | `answer` | §2.4 题组 D：物流边界信息，v1.3 实测已自我设限 |
| `C00155` | `refuse_or_insufficient_evidence` | `answer` | §2.4 题组 D：实测答案零编造，本质是自然的边界说明 |
| `C00159` | `refuse_or_insufficient_evidence` | `answer` | §2.4 题组 D：实测答案引导官方渠道，无防伪承诺 |

### 12.1 改判题的 required_fact_ids 标注说明

改判为 `answer` 的 6 题按裁定「有可引用依据」要求补齐 `required_fact_ids`。其中 C00150/C00155/C00159 引用的 `F394`/`F395`/`F398`/`F436` 为批次 3/4B 候选事实（status=draft，待 §36 BUSINESS_REVIEW）：其证据组（`E00011`/`E00091`/`E00088`/`E00090`）均落在已入库文档（C01/C06/C10/C11）可定位；本卡校验器只校验事实存在性与正向链可达，不强制 required fact 的 review status。这些 draft 事实随所属批次走完业务评审后自动解除标注例外；若评审驳回，对应题目须回退 `insufficient_evidence` 并清空 required。

C00115/C00120 的引用说明（裁定未为这两题指定事实，按「最接近的可引用依据」落档）：

- C00115（咖啡/浓茶）：`F430`（服用不要求与某一餐绑定，DS01 话术）+ `F131`（服用时间为睡前，DS03 说明书）。知识库确无咖啡/浓茶同服专项证据——required 表达的是「作答须锚定服用时间与餐食关系这两条既有依据，同服许可本身不得编造」。
- C00120（剧烈运动）：`F457`（长期室内/缺少户外活动致 25 羟 D 偏低，DS01）+ `F131`（DS03）。同样表达「作答须锚定活动量与 25 羟 D 的既有相关结论及服药时间，运动限制本身不得编造」。

### 12.2 白名单收敛与比例 gate 口径

- 退役值白名单从 12 条收敛为 5 条：`C00079` `C00116` `C00117` `C00119` `C00149`（校验器 `LEGACY_BEHAVIOR_V13_CASE_IDS` 同步收敛）；v1.3 冻结目录的复算继续使用其历史 12 条口径（`LEGACY_BEHAVIOR_V13_ALL`），冻结数据零改动。
- `no_answer` 类型题从 17 条降到 11 条（10.4% → 6.7%）：改判是标注纠错而非知识库扩容，v1.1 的 10% gate 前提不再成立，v1.4+ 口径阈值降为 6%（`GATE_NO_ANSWER_MIN_V14`）；gate 本身保留，防止拒答边界样本全灭。
- 其余 156 条 Case 及全部 facts/evidences/terminology/scenarios/datasets 数据文件零改动。

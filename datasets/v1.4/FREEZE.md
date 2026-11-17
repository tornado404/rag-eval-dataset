# v1.4.0 Golden Dataset 冻结记录（标注纠错改判 + required_fact_ids 补齐）

- 版本：`golden-dataset-v1.4.0`（tag 由项目负责人于 PR 合入后打在 squash merge commit 上；本卡不自行 push tag）
- 发布日期：2026-11-10
- 卡片：ZOYEN-2083（Epic ZOYEN-2063 合规闸门，Stage 5 覆盖缺口裁定落地）
- 基线：`golden-dataset-v1.2.0`（commit `fb465cb326607744b0417761eea20f389ba7a795`，MANIFEST `git_base` 同此值）
- 变更依据：裁定 `docs/compliance/stage5-coverage-gap-adjudication-v1.md`（§2.1.1/§2.2/§2.3/§2.4）——题组 B（C00053）按 insufficient_evidence + 证据门槛落地，题组 A 的 6 条拒答判定复核为知识库标注错误
- 承接口径：v1.3 目录（ZOYEN-2068 产物）+ 本卡 7 题改判；本卡不改写 v1.3 冻结目录

## 冻结范围与零改动声明

- 本目录 `v1.4/` 以 tag `golden-dataset-v1.2.0` 的 `docs/eval/knowledge-map/v1.2/`（47 个文件）为基线**全量承接**，叠加 v1.3 的 8 题五值映射与本卡 7 题改判；逐条证明见 `tools/verify_v14_delta.py`（双层断言：相对 v1.2 仅 15 题 `expected_behavior` 变化，相对 v1.3 仅 7 题三字段变化）。
- `golden-dataset-v1.0.0`、`golden-dataset-v1.1.0`、`golden-dataset-v1.2.0`、`golden-dataset-v1.3.0` 四个冻结版本的数据文件与 tag 均零改动。
- 本目录内 `annotation_guideline.md` 为 v1.3 副本 + §12（本卡改判与口径记录）；`v1.4/FREEZE.md` 与 `tools/verify_freeze.py` 沿用 v1.3 的「指向本目录内文件」口径。
- 本卡新增 `tools/verify_v14_delta.py`（双层 delta 复算）与 `tools/verify_freeze.py`（v1.4 口径）；`tools/pilot_gate_check.py`、`tools/verify_case_expansion.py`、`tools/coverage_report.py`、`tools/scale_gap_report.py`、`tools/verify_fact_review.py` 为 v1.3 承接副本，其中 `pilot_gate_check.py`/`verify_case_expansion.py` 仅按 §12.2 调整 no-answer 阈值口径（10% → 6%）。
- **证据 JSON 说明**：`pilot_gate_check.json` 与 `gate_samples.json` 在 v1.4 目录中为本卡复算产物（`python3 docs/eval/knowledge-map/v1.4/tools/pilot_gate_check.py` 按本目录数据重新生成），统计口径随 v1.4 数据更新（answer_cases 143→149、noanswer_cases 20→14、facts 460→462、relation_groups 461→463），`gate_samples.json` 抽样事实文案取自 v1.4 的 `facts.jsonl`（含 ZOYEN-2051 整改后的 approved 修订文本与 draft 事实），**不是** v1.3 字节承接副本；两文件的 v1.3 版本在 `v1.3/` 目录原样保留。

## 相对 v1.3.0 的数据 delta（7 题标注纠错改判）

| case_id | v1.3.0 | v1.4.0 | 依据（裁定章节） |
|---|---|---|---|
| `C00078` | `refuse_or_insufficient_evidence` | `clarify` | §2.4 R-safety-ambiguous：歧义问法，先追问安全限定 |
| `C00114` | `refuse_or_insufficient_evidence` | `answer` | §2.1.1 题组 A：知识库有据，拒答属标注错误 |
| `C00115` | `refuse_or_insufficient_evidence` | `answer` | §2.1.1 题组 A：同上 |
| `C00120` | `refuse_or_insufficient_evidence` | `answer` | §2.1.1 题组 A：同上 |
| `C00150` | `refuse_or_insufficient_evidence` | `answer` | §2.1.1 题组 A：同上 |
| `C00155` | `refuse_or_insufficient_evidence` | `answer` | §2.1.1 题组 A：同上 |
| `C00159` | `refuse_or_insufficient_evidence` | `answer` | §2.1.1 题组 A：同上 |

- 6 条 answer 改判题同步补齐 `required_fact_ids`（C00114→F006/F133，C00115→F131/F430，C00120→F131/F457，C00150→F394/F398，C00155→F436/F395，C00159→F394/F395）；C00115/C00120 的 required 表达「锚定既有依据、不编造缺证据部分」的填法说明见 `annotation_guideline.md` §12.1。
- answer 改判题移除 `no_answer` 类型标签（空则补 `single_fact`）；C00114/C00115/C00120 因 required facts 证据天然跨 DS01/DS03，按复算口径补 `cross_dataset` 标签；C00078 补 `ambiguous` 标签。
- 其余 156 条 Case 逐字段零改动；其余数据 JSONL 相对 v1.2 字节零改动。

### 行为分布（v1.4.0，163 条）

| expected_behavior | 条数 | 题号 |
|---|---:|---|
| `answer` | 149 | — |
| `clarify` | 2 | `C00030` `C00078` |
| `refuse_compliance` | 4 | `C00031` `C00033` `C00052` `C00054` |
| `insufficient_evidence` | 1 | `C00053` |
| `escalate_human` | 2 | `C00032` `C00051` |
| `refuse_or_insufficient_evidence`（退役值，仅 5 条未迁移存量白名单） | 5 | `C00079` `C00116` `C00117` `C00119` `C00149` |

### 退役值白名单收敛（12 条 → 5 条）

v1.3 的 12 条退役值白名单在本卡改判后收敛为 5 条：`C00079` `C00116` `C00117` `C00119` `C00149`。校验器在 v1.4+ 口径下强制该收敛白名单；v1.3 冻结目录的复算保持 12 条历史白名单（`LEGACY_BEHAVIOR_V13_ALL`），保证已打 tag 版本可复算。

### no-answer 比例 gate 口径（10% → 6%）

v1.1 §43 的 no-answer ≥10% gate 建立在「标注从宽」的前提下（当时 `refuse_or_insufficient_evidence` 题有 17/163 = 10.4%）。本卡将其中 6 条复核为标注错误并改判 answer 后，真实分布为 11/163 = 6.7%——这是**标注纠错**（恢复知识库本可作答的题），不是知识库扩容后拒答场景灭失。因此 v1.4+ 口径阈值降为 6%（`GATE_NO_ANSWER_MIN_V14`），gate 本身保留以防拒答边界样本被清空；v1.3 及之前复算仍用 10%。口径变化同时记录于 `annotation_guideline.md` §12.2，并同步到本目录 `tools/pilot_gate_check.py` 与 `tools/verify_case_expansion.py`。Cross-Dataset ≥20% gate 不变（v1.4 实测 22.7%）。

### required_fact_ids 的 draft 事实豁免

校验器只检查 required fact 存在性 + Evidence 正向链，不强制 `approved`；本卡 6 条 answer 改判题引用的 F394/F395/F398/F436/F430 为批次 3/4B 候选（draft），其证据（E00011/E00091/E00088/E00090/E00052）均落在已入库文档。豁免理由与回退约定（评审驳回则回退 insufficient_evidence 并清空 required）见 `annotation_guideline.md` §12.1。

## 复算命令（仓库根）

```bash
python3 docs/eval/knowledge-map/tools/validate_knowledge_map_v11.py --root docs/eval/knowledge-map/v1.4 --strict
python3 docs/eval/knowledge-map/tools/calculate_case_coverage.py --root docs/eval/knowledge-map/v1.4
python3 docs/eval/knowledge-map/tools/test_calculate_case_coverage.py
python3 docs/eval/knowledge-map/v1.4/tools/verify_case_expansion.py
python3 docs/eval/knowledge-map/v1.4/tools/verify_fact_review.py --root docs/eval/knowledge-map/v1.4 --require-complete
python3 docs/eval/knowledge-map/v1.4/tools/verify_freeze.py
python3 docs/eval/knowledge-map/v1.4/tools/verify_v14_delta.py
python3 docs/eval/knowledge-map/v1.4/tools/pilot_gate_check.py
python3 docs/eval/knowledge-map/v1.3/tools/verify_freeze.py            # v1.3.0 冻结清单零变化
# v1.2.0：在 tag 工作树内执行 python3 docs/eval/knowledge-map/v1.2/tools/verify_freeze.py
```

`verify_freeze.py --write` 生成/更新本目录 `MANIFEST.json`（19 个文件，sha256 + bytes）。

## 后续变更规则

沿用 `v1.1/FREEZE.md`：本版本合入并打 tag 后，任何数据变更须发布 `golden-dataset-v1.5.0` 及以后版本目录，不得原地修改 `MANIFEST.json` 所列文件或已打 tag 的 commit。剩余 5 条退役值白名单题应在后续版本逐条完成五值枚举。

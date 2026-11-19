# RAGFlow QA 评测数据集

这是一个独立维护的 RAG 问答评测数据集和本机编辑器。它把评测题、标准事实、证据来源和预期输出保存在 Git 可追踪的 JSONL 文件中，用于重复评估知识检索结果，并为下游回答评测提供必需/禁止事实基准。

当前默认版本为 `v1.5`：题目、事实和预期输出承接 `v1.4`（163 条问题，覆盖产品说明、用药与安全信息、临床研究、客服边界等场景），证据 chunk ID 重新映射到 M3 的 qwen 解析库。来源路径和上游标签记录在根目录 `MANIFEST.json`；`datasets/v1.4/FREEZE.md` 记录上游版本的冻结依据，`datasets/v1.5/README.md` 记录本轮映射口径与未映射证据。

## 目标与用途

- 固定一组可复用的问题和事实标注，便于比较不同知识库、检索配置或模型版本的评测结果。
- 将问题（Case）、原子事实（Fact）、来源证据（Evidence）和预期输出关联起来，便于追溯答案依据。
- 通过本机网页快速检索、查看和编辑预期答案与标注状态；每次保存都经过数据校验。
- 通过评测面板调用配置的 Query 改写模型及 M3 只读检索探针或 RAGFlow 原始接口，比较 Top-12 检索结果、Query 漂移和延迟；也可以直接调用 AI 问答 API，读取服务端 Decision 路由与 Query 改写观测。
- 从已有的检索评测明细计算 `Recall@K`、`any_hit@K` 和 `strict_hit@K` 汇总指标。

本项目负责维护评测数据和评估检索质量，不启动 RAGFlow、不生成问答答案，也不负责把数据自动导入 RAGFlow。`compute_hit.mjs` 读取上游评测程序生成的明细文件。评测结果用于评估系统，不是面向患者的医疗建议。

## 数据与目录

```text
.
├── MANIFEST.json                   # 当前版本、版本清单、数据来源和指标口径
├── datasets/
│   ├── v1.4/                       # 上游冻结版本
│   │   ├── cases.jsonl
│   │   ├── ...
│   │   └── FREEZE.md
│   └── v1.5/                       # 当前默认版本
│       ├── cases.jsonl             # 问题、场景、必需/禁止事实 ID
│       ├── facts.jsonl             # 原子事实
│       ├── evidences.jsonl         # 原文证据和定位信息
│       ├── fact_evidence_relations.jsonl
│       ├── expected_outputs.jsonl  # 预期答案、行为、rubric 和审核状态
│       ├── datasets.jsonl          # 目标 RAGFlow 数据集元数据
│       ├── mapping_report.json     # v1.4 → v1.5 证据映射统计
│       ├── annotation_guideline.md # 标注规范
│       ├── README.md               # 映射口径与重新生成方式
│       └── MANIFEST.json           # 该版本的文件清单与校验信息
├── editor/
│   ├── index.html                  # 本机编辑页面
│   └── server.mjs                 # 本机 HTTP 服务、校验、Git 提交/推送
├── schemas/                        # 数据结构定义
├── scripts/
│   ├── validate.mjs                # 校验 MANIFEST 中列出的所有版本
│   ├── compute_hit.mjs             # 从评测明细计算指标
│   └── bootstrap_expected_outputs.mjs
└── .github/workflows/validate.yml  # Push / PR 时运行数据校验
```

JSONL 文件每行是一条独立 JSON 记录。`cases.jsonl` 描述问题和预期检索事实；`facts.jsonl` 与 `evidences.jsonl` 记录事实及其来源；`fact_evidence_relations.jsonl` 表达事实和证据之间的关系；`expected_outputs.jsonl` 保存答案文本、期望行为、必需/禁止事实、评分要点和审核状态。标注规则以 [annotation_guideline.md](datasets/v1.5/annotation_guideline.md) 为准（与 v1.4 相同）。

## 环境要求

- Node.js 20 或更新版本。
- Git。编辑器默认会自动提交数据更改；启用自动推送时还需配置 `origin` 和可用的 Git 凭据。
- 项目没有 npm 运行时依赖，不需要执行 `npm install`。

## 启动本机编辑器

在仓库根目录运行：

```bash
npm run editor
```

然后打开 [http://127.0.0.1:4173/](http://127.0.0.1:4173/)。服务默认读取 `datasets/v1.5/`。按 `Ctrl+C` 停止服务。

页面默认是只读表格。勾选“编辑模式”后可以修改预期答案、预期行为和状态（`draft`、`review`、`approved`）；搜索框可匹配问题、答案、行为和事实 ID，两个筛选器可按状态和预期行为过滤记录。必需/禁止事实 ID 和评分要点当前在页面中展示，编辑器网页没有对应的编辑输入框。

点击“保存更改”后，服务会：

1. 检查提交的 Case ID，并校验该版本的数据引用和必填约束。
2. 将修改写入 `datasets/<DATASET_VERSION>/expected_outputs.jsonl`，更新记录的 `updated_at`。
3. 默认把该文件自动 Git commit；提交信息前缀默认为 `dataset(editor)`。
4. 只有设置 `AUTO_PUSH=1` 时，才会在提交后执行 `git push origin HEAD`。

页面使用的接口是 `GET /api/state`（载入当前版本）、`POST /api/save`（保存修改）、`GET /api/eval/defaults`（读取不含凭据的评测默认值）和 `POST /api/eval/run`（执行评测）。浏览器不保存 Git 或其他 token；推送认证由本机 Git 凭据提供。

### 配置

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PORT` | `4173` | 本机服务端口 |
| `BIND_ADDRESS` | `127.0.0.1` | 监听地址；M3 部署设为 `127.0.0.1` 以支持局域网访问 |
| `DATASET_VERSION` | `v1.5` | 要读取和编辑的 `datasets/<版本>/` 目录 |
| `AUTO_COMMIT` | `1` | 自动提交；设为 `0` 时仍写入文件，但不自动 commit |
| `AUTO_PUSH` | `0` | 设为 `1` 时，在自动 commit 后推送当前分支 |
| `COMMIT_PREFIX` | `dataset(editor)` | 自动提交信息前缀 |
| `EVAL_CONFIG_FILE` | `~/.config/rag-eval-dataset/eval.env` | 评测面板的服务端默认配置与凭据文件 |
| `EVAL_REMOTE_TIMEOUT_MS` | `180000` | 单次上游请求超时（毫秒） |

可以通过当前命令临时设置变量：

```bash
PORT=4173 DATASET_VERSION=v1.5 npm run editor
```

`.env.example` 是配置示例；Node 服务不会自动读取 `.env`。若使用 `.env`，启动前需在当前 shell 中显式加载：

```bash
set -a
source .env
set +a
npm run editor
```

评测面板的服务端默认配置从 `EVAL_CONFIG_FILE` 读取，默认路径为 `~/.config/rag-eval-dataset/eval.env`；该文件不应进入仓库，建议权限设为 `600`。示例见 `deploy/eval.env.example`。表单中的 Key / Token 留空时由服务端补全；`GET /api/eval/defaults` 只返回“是否已配置”，不会返回凭据值。

**自动提交注意事项：**保存前先检查 `git status`。服务会 `git add` 当前版本的 `expected_outputs.jsonl`，随后运行普通 `git commit`；Git 会把暂存区里的其他文件一并提交。不要在暂存区留有不相关的改动。若只想保存文件并自行决定如何提交，可设置 `AUTO_COMMIT=0`。自动推送会把当前分支推到 `origin`，不会自动创建版本标签，也不等同于部署。如果自动推送失败，本地文件和 commit 可能已经生成；先检查工作区和提交记录，再手动处理推送。

本机启动默认绑定 `127.0.0.1`。M3 部署通过 `BIND_ADDRESS=127.0.0.1` 绑定全部网卡并提供局域网地址；服务没有登录认证，局域网访问者可以查看和编辑数据，也可以调用评测接口，因此只在受信任的私有网络使用。

## Golden Dataset 审核工作台

Golden Dataset 以 Query 为主键。每条 Query 关联 Fact，Fact 关联 Evidence，Evidence 与 Chunk 为多对多关系。工作台从 Fact 起草 Query，关联 Evidence，检索 RAGFlow Chunk，并运行试召回。

```bash
npm run golden
```

打开 [http://127.0.0.1:4174/](http://127.0.0.1:4174/)。数据模型、审核流程和接口说明见 [Golden Dataset 审核工具](docs/golden-dataset-review-tool.md)。

## 校验数据

```bash
npm run validate
```

校验器会读取根目录 `MANIFEST.json` 中列出的版本，并检查 JSONL 是否可解析、Case 和 Expected Output 是否对应、必需事实 ID 是否存在、Fact 引用的 Evidence 是否存在，以及审核状态和必填字段等约束。它不运行 RAG 检索或答案生成，也不校验版本目录内 `MANIFEST.json` 所列文件的哈希值；冻结发布时需另外复核版本清单。

GitHub Actions 在 push 和 pull request 时运行 lint、测试和数据集校验；`deploy-m3` workflow 在 `main` push 时部署到 M3，也支持手动指定分支、tag 或 SHA 部署。

## Lint 仓库约束

`npm run lint` 检查以下约束：

- 所有已跟踪的 `.mjs` 文件通过当前 Node 的语法检查。
- 所有已跟踪的 `.json` 和 `.jsonl` 文件可解析为 JSON，并报告错误路径和行号。
- 根 `MANIFEST.json` 登记所有已跟踪的 `datasets/vX/` 目录，列出的目录存在，且 `current_version` 已登记。
- 可选：设置 `LINT_BASE_REF` 后，检查该基线之后的提交是否修改基线中已存在的版本目录；未设置时跳过，兼容当前历史。
- `editor/server.mjs` 的 `BIND_ADDRESS` 默认是 `127.0.0.1`，服务器只通过该变量绑定地址。
- `editor/server.mjs` 的 `EDITABLE_FIELDS` 只包含允许的七个字段，保存时只复制白名单字段。
- `package.json` 配置 `lint`、`check` 和 `test` 脚本，CI 工作流运行 `npm run check`。

完整检查命令：

```bash
npm run lint
npm run check
```

`npm run check` 依次运行 lint、数据校验和 repository tests。若要验证已有版本数据未变更，可显式指定基线，例如 `LINT_BASE_REF=HEAD~1 npm run lint`；基线中已有的版本目录在后续提交中不得修改，新增版本目录应先登记为当前版本再作为后续基线。

## 计算检索指标

先由上游检索评测流程生成明细文件，再运行：

```bash
node scripts/compute_hit.mjs /path/to/details_mode_a.jsonl --top-k 12 --dataset v1.5
```

`--top-k` 默认为 `12`，记录在结果的 `top_k` 字段中。脚本不会据此执行检索或截取候选；输入明细中的 `fact_recall`、`required_covered` 和 `required_total` 必须已经按对应 K 值计算。指定 `--dataset` 后，脚本用该版本的 Case 行为筛出 `answer` 题；未指定时使用明细行中的 `expected_behavior`。

结果包括：

- `macro_fact_recall`：有 `fact_recall` 的 answer 题逐题召回率宏平均。
- `any_hit_at_k`：至少覆盖一个必需事实的 answer 题比例。
- `strict_hit_at_k`：覆盖全部必需事实的 answer 题比例。
- `answer_cases`、`any_hit_cases`、`strict_hit_cases`：指标对应的题目数。

可用 `--out /path/to/summary.json` 将结果写入 JSON 文件。指标口径依赖上游明细生成流程中的事实匹配逻辑；该脚本只做汇总。

## 数据版本与发布

`v1.4` 是上游导入并冻结的数据版本；`v1.5` 是当前默认的 M3 qwen 映射版本，题目与事实不变，只修正证据定位。冻结标签用于重现历史评测；Git 标签指向的内容不会因后续分支修改而改变。代码本身不会阻止在工作分支上编辑当前版本，但冻结规则要求后续数据变更发布为新版本，因此**正式更新时应新增版本目录，不要覆盖已发布版本**。

推荐的版本发布流程：

1. 从已发布版本或新的权威数据源创建 `datasets/v1.5/`，并只在新目录中修改数据。
2. 更新新版本自己的 `FREEZE.md` 和 `MANIFEST.json`，重新核对文件清单、哈希和变更依据。
3. 更新根目录 `MANIFEST.json` 的 `current_version` 与 `versions`，登记版本号、状态、题目数和文件清单。
4. 使用新版本启动编辑器，例如 `DATASET_VERSION=v1.5 npm run editor`；确认版本清单已纳入根 manifest 后运行 `npm run validate`。
5. 审查数据 diff 和冻结记录，提交变更并通过 GitHub Actions 校验；发布时为已审查的提交创建 `datasets/v1.5` 标签，并将分支和标签推送到 `origin`。

版本标签用于固定一次评测所用的数据快照。更新版本目录、根 manifest 和标签是数据发布流程；更新编辑器代码则需要把仓库代码同步到运行机器并重启服务。

### M3 服务更新

将代码推送到 `main` 会自动触发 M3 部署。也可以在 GitHub Actions 手动运行 `deploy-m3` 并填写要部署的 `ref`。runner 会 checkout 远程代码、校验数据、同步部署目录、重启 launchd 服务并检查健康状态；局域网 URL 会写入 workflow 日志和 Summary。

M3 服务监听端口 `4183`，launchd label 为 `com.tornado404.rag-eval-dataset`。部署后的 LAN 地址由 M3 默认网卡 IPv4 和端口组成，格式为 `http://<M3-LAN-IP>:4183/`。

### 本机服务更新

在运行服务的终端按 `Ctrl+C`，检查并保留工作区改动，再快进同步代码并重新启动：

```bash
git status --short
git pull --ff-only
npm run editor
```

服务不会热更新 Node 代码。

本机编辑器代码不会热更新；M3 上的服务由 CI workflow 和 launchd 管理。

## 版本冻结记录

查看 [v1.4 冻结记录](datasets/v1.4/FREEZE.md) 了解上游数据来源、163 条题目的组成和后续升级规则；查看 [v1.5 映射说明](datasets/v1.5/README.md) 了解 qwen 知识库映射、3 条未映射证据和重新生成方式。编辑细节以当前 `datasets/<版本>/` 中的 JSONL、规范和 manifest 为准。

# M3 部署

本仓库的所有 GitHub Actions job 均运行在 M3 本机的 self-hosted runner 上，不消耗 GitHub-hosted Actions 配额。

- runner 目录：`/Users/zoyen/actions-runner-rag-eval-dataset`
- runner 名称：`m3-rag-eval-dataset`
- runner labels：`self-hosted,macOS,ARM64,office`
- workflow 匹配：`runs-on: [self-hosted, macOS, ARM64, office]`
- 服务监听：`0.0.0.0:4183`（M3 全部网卡）
- 本机地址：`http://127.0.0.1:4183/`
- 局域网地址：部署 workflow 日志和 Summary 中的 `LAN_URL`
- 数据接口：`http://127.0.0.1:4183/api/state` 或局域网地址加 `/api/state`
- 部署目录：`~/apps/rag-eval-dataset`
- launchd label：`com.tornado404.rag-eval-dataset`
- 日志：`~/apps/rag-eval-dataset/deploy.log`、`deploy.err.log`

`main` 推送或手动触发 `deploy-m3` workflow 后，runner 先 checkout 指定提交，再执行 `deploy/deploy-m3.sh`。脚本把该次 checkout 的文件同步到部署目录，写入 `DEPLOYED_SHA`，重启 launchd 服务并检查本机与默认网卡地址。

部署服务固定使用 `BIND_ADDRESS=0.0.0.0`、`AUTO_COMMIT=0`、`AUTO_PUSH=0`；网页端编辑产生的改动由维护者按正常 Git 流程提交，避免部署环境自动回写仓库。服务没有登录认证；局域网访问者可以读取、编辑数据并调用评测接口，只应在受信任的私有网络使用。

## AI 问答真实链路评测

页面“检索目标”选 **M3 AI 问答真实链路** 时，服务会真实调用 `POST /api/v1/qa/turns`（`deliver=auto`），完整经过 Decision 路由、Query 改写门禁和最终证据装配，再用 `docker logs` 读取后端 `qa: turn_observation` 打分：

- 最终证据池：优先使用 v2 `final_grounding[].chunk_id`，兼容旧字段 `final_grounding_chunks`；`Recall@K` 的 K 取该题最终 chunk 数。
- 检索层：优先使用 v2 `ragflow_candidates_at_12[].chunk_id`，兼容旧字段 `ragflow_candidate_chunk_ids_at_12`；这是 merge 前的 RAGFlow 专业库 Top-12，对应 `Recall@12 / Hit@12`。
- `document_id` / `evidence_id` 不能当作 chunk ID 参与 Gold 匹配；旧版 observation 缺少任何 chunk 级字段时标记为 `legacy_schema_unscorable`，不进入 Recall/Hit 分母。
- 缺失观测的题标记为不可评分，不使用接口 citations 或答案文本反推。

在 `~/.config/rag-eval-dataset/eval.env` 配置 `M3_QA_USER_REFRESH_TOKEN`（推荐）或 `M3_QA_USER_JWT`，以及可选的 `M3_BACKEND_CONTAINER` / `DOCKER_BIN`。token 只在服务端内存与轮换中使用，不返回浏览器。单轮题按服务内规则通常 `rewrite.called=false`、`fallback_reason=gate_skip`；要观察真实改写需在同一会话里连续发 followup / correction 多轮。

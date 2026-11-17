# M3 部署

本仓库的所有 GitHub Actions job 均运行在 M3 本机的 self-hosted runner 上，不消耗 GitHub-hosted Actions 配额。

- runner 目录：`/path/to/project
- runner 名称：`m3-rag-eval-dataset`
- runner labels：`self-hosted,macOS,ARM64,office`
- workflow 匹配：`runs-on: [self-hosted, macOS, ARM64, office]`
- 服务监听：`127.0.0.1:4183`（M3 全部网卡）
- 本机地址：`http://127.0.0.1:4183/`
- 局域网地址：部署 workflow 日志和 Summary 中的 `LAN_URL`
- 数据接口：`http://127.0.0.1:4183/api/state` 或局域网地址加 `/api/state`
- 部署目录：`~/apps/rag-eval-dataset`
- launchd label：`com.tornado404.rag-eval-dataset`
- 日志：`~/apps/rag-eval-dataset/deploy.log`、`deploy.err.log`

`main` 推送或手动触发 `deploy-m3` workflow 后，runner 先 checkout 指定提交，再执行 `deploy/deploy-m3.sh`。脚本把该次 checkout 的文件同步到部署目录，写入 `DEPLOYED_SHA`，重启 launchd 服务并检查本机与默认网卡地址。

部署服务固定使用 `BIND_ADDRESS=127.0.0.1`、`AUTO_COMMIT=0`、`AUTO_PUSH=0`；网页端编辑产生的改动由维护者按正常 Git 流程提交，避免部署环境自动回写仓库。服务没有登录认证；局域网访问者可以读取、编辑数据并调用评测接口，只应在受信任的私有网络使用。

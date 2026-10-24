# 内容发布：Git → PostgreSQL、Typesense 与 R2

生产前端仍在 `zaixi.dev` 的 Cloudflare Pages；`api.zaixi.dev` 由 Go 提供。Git 是写作入口，PostgreSQL `blog` 数据库是公开内容读取权威。运行时 API 每请求读取 `publication JOIN releases`，不遍历 Markdown、不启动 Node parser、不退回内存搜索。

应用发布分两阶段：main push 自动完成门禁、镜像 smoke 和 GHCR 发布；运维固定 digest 后等待 Flux、数据库和 API 子域真实就绪，再手动运行同一完整 SHA，显式选择 `deploy_pages=true` 发布 Pages。默认 false，main push 不自动替换主站，避免首次后端尚未 Ready 时前端提前切换。手动运行同样重新执行完整门禁和 smoke，不使用 sleep 作为就绪条件。

## 独立导入命令

```bash
./dist/blog --mode=migrate
./dist/blog --mode=import --checkout-root=/data/git/current
```

迁移使用 `blog-migration` 的 schema owner；导入使用 `blog-importer` publisher 身份。服务端环境变量见 `.env.example`。R2 参数为 `R2_BUCKET`、`S3_ENDPOINT`、`S3_REGION`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`、`S3_FORCE_PATH_STYLE`、`MEDIA_BASE_URL`。生产连接必须在 `DATABASE_URL` 中使用 `sslmode=verify-full` 和已挂载 CA 路径；开发连接只指向隔离 PostgreSQL。

导入器先固定 current 的 Git checkout SHA，再取得 PostgreSQL session advisory lock。Node stdio 子进程只承担现有安全解析，将公开 snapshot 投影存入 PostgreSQL；移除 raw、草稿标记，草稿不进入公开页面、索引和导出。

新 revision 从 sequence 分配。公开 snapshot 引用的媒体上传到 `releases/<revision>/static/...` 或 `releases/<revision>/forum/...` 不可变 R2 key，返回 `https://blog-media.zaixi.dev/...` URL；不会整包上传 public。Typesense 建立 `blog_r<revision>_zh` / `blog_r<revision>_en` collection，逐行验证导入结果并核对文档总数。只有这些步骤全部成功，PG 单个事务才插入 release 并切换 active_revision。旧 collection 暂保留，避免并发请求清理竞态。

`publication.phase` 为 syncing/ready/failed，表示新导入的状态；公开读取始终依据最后成功提交的 active_revision。更新中或导入失败时继续服务该完整 release，响应 `X-Content-Revision` 明确版本，不是读取失败后退回缓存。尚无 active、PG 读取错误或 Typesense 查询错误时返回 503，搜索没有内存 fallback。导入失败保持 active 不变并记录非敏感 error_code，CLI 非零退出；修复重跑成功才切新 revision。相同 SHA 已 ready 时幂等返回现有 revision。

旧 `/static/`、`/forum/` URL 经 Pages 转 API，再按当前 release media manifest 重定向 R2；已公开对象保留不可变 URL，不承诺撤稿后撤回已公开图片。删除或撤稿的正文和搜索索引在下一 release 消失，不需要镜像 build、CI 或 API 重启。

## 完整本地环境

```bash
pnpm dlx @devcontainers/cli up --workspace-folder .
pnpm dlx @devcontainers/cli exec --workspace-folder . pnpm dev:full
```

Node 24、Go 1.26.10、PostgreSQL 18、Typesense 29、SeaweedFS mini S3 由 `.devcontainer/compose.yaml` 提供，全部使用专用测试凭据和独立卷。宿主仅 loopback 暴露 45100 React、45101 Go、45102 PG、45103 Typesense、45104 S3、45105 SeaweedFS Admin UI。为保持已有入口，S3 服务 DNS 仍名为 `minio`，数据使用新 `seaweedfs-data` 卷，旧 MinIO 卷保留。测试身份仅限 `blog-test-media` bucket；匿名图片读取按该 bucket 的 GetObject policy 验证。parity 使用 45110；不读取生产 R2/PG/Typesense 凭据。`dev:full` 构建、迁移、初始化本地 bucket、导入当前 checkout，再启动 React/Go。

```bash
pnpm dlx @devcontainers/cli exec --workspace-folder . pnpm test:integration
```

集成测试使用真实 PG/Typesense/S3，覆盖发布、更新、草稿、删除、失败不切版、故障 503 与媒体引用。测试依赖不得指向生产；本地卷在停止容器后保留，删除卷需使用者明确操作。

# 部署

## R2 媒体资源

生产专用 bucket 为 `zaixi-blog-media`（APAC、Standard），公开只读域名为 `https://blog-media.zaixi.dev`，配置项 `MEDIA_BASE_URL` 使用该地址。r2.dev 未启用，原 img 域名不变。上传由导入器使用 account S3 endpoint 与 bucket 作用域凭据完成，凭据只通过生产 Secret 注入，不进入浏览器、Git 或本地测试环境。对象 key 与内容索引的发布顺序按导入器数据合同执行；配置公开域名不代表图片迁移已完成。

应用和内容分别交付。应用由 Go HTTP 进程、私有 Node stdio worker 和 Vite 静态壳组成；运行时必须有 Node.js 24+，不是单二进制部署，也不再适用于 Pages-only 静态托管。

## 本机运行交付包

```bash
pnpm install --frozen-lockfile
pnpm build
./dist/blog --addr 127.0.0.1:45101 --static out --content /srv/blog/content --media /srv/blog/public
```

保留 `dist/`、`out/`、`node_modules/`、`package.json` 的相对位置。worker 入口默认 `dist/worker/content-worker.mjs`，可以用 `--worker` 指定。HTTP 只由 Go 监听，Node 通过私有 stdin/stdout 通信，不开放额外端口。服务启动校验内容，坏内容或缺失目录直接启动失败；运行中坏内容返回 503，修好后下一请求恢复。SIGINT/SIGTERM 优雅关闭 HTTP 与所属 worker。

## 容器与持久内容

```bash
docker build -t zaixi-blog .
docker run --rm -p 127.0.0.1:45101:45101 \
  -v /srv/blog/content:/content:ro \
  -v /srv/blog/public:/media:ro zaixi-blog
```

`/content` 放 `blog/{locale}/...md` 和 `authors/...mdx`；`/media` 放 `static/`、`forum/` 及 `_redirects`。容器用户需有读取权限。内容不打入镜像，应用替换不会覆盖文章；写作同步工具在宿主目录原子 rename 文件即可，单篇内容校验失败不允许旧快照静默继续服务。跨多文件的一次编辑需由发布者保证目录切换原子性。

### Flux 与独立导入器

`deploy/k8s/storage` 单独管理 blog namespace、Retain StorageClass/PV/PVC，资源关闭 Flux prune；`deploy/k8s/app` 只管理应用。infra 的 `blog-storage` 协调 storage，`blog` 通过 dependsOn 等待 storage，再以 `blog-release` ConfigMap 的 `BLOG_IMAGE` 完整 digest 替换应用镜像。该值必须来自成功 Sengi 发布记录。

生产 importer 独占 `/data` PVC，不使用 Kubernetes subPath。git-sync v4.8.0 每 30 秒从 main 同步，原子切换 current，保留旧 worktree 10 分钟，再通过 exechook 执行同镜像中的 `--mode=import`。导入器固定 checkout SHA，解析公开内容、上传 R2、建立 Typesense collection，最后事务切换 PostgreSQL active_revision。API 不挂载内容 PVC、不启动 parser，只读 PG 与当前 Typesense 索引。完整协议见 [publication.md](./publication.md)。

`--checkout-root` 仅导入器使用；生产 `DATABASE_URL` 启用 PG API 模式，旧无数据库 `--content` / `--media` 本地 preview 仍可用。新增/修改/删除经独立导入即可发布，不执行文章 CI、不重建镜像、不 rollout API Pod。失败不切 revision，publication phase/error_code 显式记录，API 继续读取最后成功提交的 active release；无 active、PG 读取或 Typesense 查询失败才返回 503。

当前 storage 清单固定 `prod-sg-db-03:/var/lib/kubelet/blog-content`，5 GiB、ReadWriteOnce、Recreate 单副本。数据由 node 本地卷持久化，Pod 重建会复用；节点不可用时不自动跨节点搬迁。Git 仍是内容权威，恢复时由运维明确恢复该目录或另建 Retain PV。删除应用协调不应删除 storage；销毁 PVC/PV/namespace 需另行批准。

公网前端 `zaixi.dev` 保留现有 `zaixi-blog` Cloudflare Pages 项目，不迁移 apex。后端 `api.zaixi.dev` 复用 zaixi-edge 的 `edge-ha` Gateway、Gateway 级 CrowdSec AppSec 和远程管理 cloudflared。edge blog HTTPRoute 只匹配 API 子域；ReferenceGrant 和 NetworkPolicy 仅允许 Envoy 到 blog 的 45101 端口。需推进 infra 中固定的 zaixi-edge source commit；只推 edge main 不会更新生产。API 子域 DNS/tunnel 配置由获授权运维处理，不修改遗留 ConfigMap 冒充切流。

Pages 构建设置 `API_BASE_URL=https://api.zaixi.dev`，page loader/search 统一调用该基址；开发默认空值走 45100→45101 同源代理。Go `CORS_ORIGINS` 使用精确白名单：主域、`dev.zaixi.dev` 和项目正式 `zaixi-blog.pages.dev`；任意 hash preview 不自动受信任，需运维显式追加该完整 origin 并重启应用配置。无 credentials、无通配符；OPTIONS 只允许 GET/HEAD，拒绝自定义请求头，错误响应同样保留 CORS/Vary。

API 中媒体字段由导入器改写为 R2 不可变对象 URL；export/feed 等服务资源指向后端，文章页面链接仍指向 Pages，不改外部 URL 或正文文字。新媒体随独立导入发布，不依赖 Pages build；Pages 旧 `/static/images/*`、forum、export/feed/sitemap/robots 路径重定向后端，再由当前 media manifest 定位 R2。纯静态 Pages 用 `/* /index.html 200` 支持客户端动态路由，因此未知页面 HTTP shell 可能为 200，真实 404 由 API 返回并渲染，不能声称 Pages 提供动态 HTTP 404 或服务端 OG。Go 本地 preview 继续提供动态 head 与真实状态码。

Git 历史默认仅使用运行目录中的本地 Git 信息；无 git 或无历史时直接使用文章 date/lastmod 和稳定源文件链接，不等待网络。需要完整历史时保留只读仓库与提交历史。可显式设置 `GIT_HISTORY_REMOTE=1` 启用 GitHub 历史富化；该可选模式可能等待网络，不建议在离线服务开启。运行时未提交修改可以立即显示，Git 更新时间仍表示已提交历史。正文解析错误仍返回 503，不属于元信息缺失。

## Sengi 镜像流水线

先在本地运行 `pnpm verify:local`。该入口将当前工作树复制到独立临时 checkout，复用 `.devcontainer` 镜像与 Compose 服务定义，创建唯一项目、全新数据卷和随机 loopback 依赖端口，不复用或清理开发环境。应用代码检查、Go race/vet/build、生产构建、PG/Typesense/S3 集成、跨域发布、runtime、完整 E2E、parity 和性能预算均在容器内执行，浏览器使用容器字体。宿主只负责 Docker 调度及运行时镜像 smoke 的编排；被检查的进程仍来自真实 Docker 镜像。不会把 Docker socket 挂入开发容器。

完成后 `.cache/local-verification.json` 记录原始提交、未提交写集和本地镜像 ID；未提交候选不冒充干净提交。执行期间源码变动会失败。测试 checkout 保留原 Git 历史，但不复制仓库配置、凭据或 hooks；只有未提交候选使用临时提交供 importer 读取，该提交不冒充应用源码版本。失败时输出有界依赖日志并保留 `.cache/blog-verify-*-test-results`，最终只清理该次创建的容器、网络和卷，开发卷保持原样。该命令需要 Linux 宿主 Node、Docker Compose 和可用 Docker daemon，运行时镜像验证沿用 Linux host network；不在已进入的 app 容器内嵌套调用。应用 pre-push 要求已提交且工作区干净，并自动验证正在推送的 HEAD；纯内容 push 不触发应用构建。

`.github/workflows/deploy.yml` 使用 Sengi Ubuntu 24.04 runner：双核仅构建生产 Pages 壳并检查重定向/CSP artifact，四核使用 Buildx 构建实际 Dockerfile，再执行无需外部依赖的轻量容器 smoke。云端不安装 Playwright 浏览器、不启动 PG/Typesense/S3、不跑 check、runtime、E2E、parity、perf 或完整 publication 集成。BuildKit 缓存继续使用 GitHub Actions cache。云端不验证本地报告的可信性；本地完整门禁由提交流程负责，不引入签名证明平台。

PR 和 dev 分支只验证、构建和 smoke，不发布镜像或部署。main 应用变更通过后，将已 smoke 的同一镜像推送到 `ghcr.io/yunzaixi-dev/blog:<完整提交 SHA>`；`blog-image-<sha>` artifact 中的 `image-digest.txt` 和 job summary 给出 `ghcr.io/yunzaixi-dev/blog@sha256:...`，由 GitOps 清单固定此 digest，Flux 负责集群协调。流水线不调用 kubectl、不修改 Flux、不依赖 latest 标签。

同次验证还产出独立 `blog-pages-<sha>` 静态壳 artifact。后端经 Flux、数据库与 DNS 实际验收后，手动运行同一 SHA 并设置 `deploy_pages=true`，才使用原有 CI secrets 经 `scripts/pages_deploy.py` 上传 `zaixi-blog` main。默认 false，main push 不自动替换 Pages。上传权限与 GHCR publish job 分开。`deploy/**` 只更新固定 digest 不触发应用流水线，避免发布循环。

首次上线可在 GitHub Actions 手动运行 `sengi-release`，`commit_sha` 必须提供完整 40 位提交 SHA。门禁、镜像构建、smoke 和最终标签全部绑定此提交；手动发布同样不能跳过验证。验证和镜像构建 job 只有 `contents: read`，checkout 不保留凭据。smoke 成功后以 `docker save` artifact 传递精确镜像；独立 publish job 仅在 main push 或手动发布时运行，独占 `packages: write`，只下载、加载和推送镜像，不 checkout、不执行源码、不重新构建。它使用 GitHub job token 登录 GHCR，无需读取本地 CLI 凭据。公开源码不自动等于公开 GHCR package；集群拉取前需确认包可匿名读取，或使用已批准的 imagePullSecret。

只改 `content/**`、`public/static/images/**` 或 `public/forum/**` 不触发应用流水线；文章交付必须走独立内容同步。`pnpm test:container <image>` 可本地重跑实际镜像 smoke，覆盖 Go/私有 worker、静态壳、只读挂载内容修改/删除、媒体读取和 SIGTERM 退出，不把仓库文章打进镜像。

## 代理、缓存与安全

生产通过可信反向代理终止 HTTPS。Go 默认绑定 loopback，容器明确绑定 `0.0.0.0:45101`。代理应配置 TLS/HSTS、传输压缩与请求大小限制，不缓存 `/api/`、页面文档、RSS、sitemap、robots、export 的运行时响应（服务返回 `no-store`）。

Vite 哈希 `/assets/*` 使用一年 immutable；可变 `/static/*` 使用一小时 must-revalidate，支持 HEAD、304、Range。不把可变图片设为永久 immutable。export 使用 Markdown MIME 和 `X-Robots-Tag: noindex`。安全响应头由 `internal/web/static.go` 实际执行，`public/_headers` 只作为可读参考，不依赖托管商解析。

`public/_redirects` 按顺序匹配历史路径和 splat，保留 query 与 Unicode；目录无尾斜杠也能读取，不额外强制 canonical redirect。未知 API 返回 JSON 404，未知资源返回真实 404，未知页面使用本地化 404 壳与 API 响应。目录列表、dotfile 和符号链接不公开。

可选环境变量见 [.env.example](../.env.example)。Vite 构建时把应用端 `SITE_URL` 固化进前端配置；worker 保留 `process.env.SITE_URL`，在 Node 进程启动时读取，用于运行时 canonical/RSS/sitemap/export。部署时应保持二者一致。修改 worker 的站点身份配置需要重启服务；修改文章不需要。`DEV_PORT` 默认 45100，`API_PORT` 默认紧随其后（45101）；隔离测试可显式设置另一组连续端口，preview 的 `--port` 独立配置。

文章图表保留原分辨率并以 WebP quality 90 编码；照片/插画最多 1400px、quality 80、alphaQuality 100。PNG/JPEG 转换后只发布 `<去掉原扩展名>.webp` 一份，`public/_redirects` 对旧 PNG/JPEG URL 明确 301 到新的 `.webp` URL，不打断历史链接。原图可从转换前 Git 提交恢复，恢复时同时移除对应的 301 规则。favicon PNG 保持原格式并无损压缩，RGBA 像素逐字节一致。

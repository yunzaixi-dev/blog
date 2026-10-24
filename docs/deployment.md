# 部署

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

Git 历史默认仅使用运行目录中的本地 Git 信息；无 git 或无历史时直接使用文章 date/lastmod 和稳定源文件链接，不等待网络。需要完整历史时保留只读仓库与提交历史。可显式设置 `GIT_HISTORY_REMOTE=1` 启用 GitHub 历史富化；该可选模式可能等待网络，不建议在离线服务开启。运行时未提交修改可以立即显示，Git 更新时间仍表示已提交历史。正文解析错误仍返回 503，不属于元信息缺失。

## 发布 artifact

`.github/workflows/deploy.yml` 在应用变更时执行完整门禁后上传 `blog-runtime-<sha>`，内含 Go、worker、应用壳与 Node 依赖。只改 `content/**` 或文章图片不触发该工作流。CI 不持有 Pages 发布令牌、不执行远端部署。下载 Linux artifact 后解包到新的应用目录，再用现有服务管理器切换应用版本；挂载的内容目录保持独立。

## 代理、缓存与安全

生产通过可信反向代理终止 HTTPS。Go 默认绑定 loopback，容器明确绑定 `0.0.0.0:45101`。代理应配置 TLS/HSTS、传输压缩与请求大小限制，不缓存 `/api/`、页面文档、RSS、sitemap、robots、export 的运行时响应（服务返回 `no-store`）。

Vite 哈希 `/assets/*` 使用一年 immutable；可变 `/static/*` 使用一小时 must-revalidate，支持 HEAD、304、Range。不把可变图片设为永久 immutable。export 使用 Markdown MIME 和 `X-Robots-Tag: noindex`。安全响应头由 `internal/web/static.go` 实际执行，`public/_headers` 只作为可读参考，不依赖托管商解析。

`public/_redirects` 按顺序匹配历史路径和 splat，保留 query 与 Unicode；目录无尾斜杠也能读取，不额外强制 canonical redirect。未知 API 返回 JSON 404，未知资源返回真实 404，未知页面使用本地化 404 壳与 API 响应。目录列表、dotfile 和符号链接不公开。

可选环境变量见 [.env.example](../.env.example)。Vite 构建时把应用端 `SITE_URL` 固化进前端配置；worker 保留 `process.env.SITE_URL`，在 Node 进程启动时读取，用于运行时 canonical/RSS/sitemap/export。部署时应保持二者一致。修改 worker 的站点身份配置需要重启服务；修改文章不需要。`DEV_PORT` 默认 45100，`API_PORT` 默认紧随其后（45101）；隔离测试可显式设置另一组连续端口，preview 的 `--port` 独立配置。

文章图表保留原分辨率并以 WebP quality 90 编码；照片/插画最多 1400px、quality 80、alphaQuality 100。PNG/JPEG 转换后只发布 `<去掉原扩展名>.webp` 一份，`public/_redirects` 对旧 PNG/JPEG URL 明确 301 到新的 `.webp` URL，不打断历史链接。原图可从转换前 Git 提交恢复，恢复时同时移除对应的 301 规则。favicon PNG 保持原格式并无损压缩，RGBA 像素逐字节一致。

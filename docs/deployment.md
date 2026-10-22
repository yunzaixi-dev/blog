# 部署

生产部署使用 GitHub Actions 发布到 Cloudflare Pages。

## 部署产物

构建命令：

```bash
pnpm build
```

部署目录：

```text
out/
```

`next.config.js` 使用静态导出：

```js
output: 'export'
```

图片配置为静态导出兼容模式：

```js
images: {
  unoptimized: true
}
```

## 压缩与缓存

生产链路是：

```text
GitHub Actions -> pnpm build -> out/ -> Cloudflare Pages
```

传输压缩由 Cloudflare Pages 在边缘处理。不要手工生成或提交 `.gz`、`.br` 文件，也不要在本地修改 `out/` 作为性能优化手段。

如果以后需要自动图片优化、资源预算或 Lighthouse 门禁，应作为可重复的构建脚本或 GitHub Actions 步骤加入，并同步更新 `docs/development.md`。不接受一次性手工转码或只在某台机器上成立的优化。

当前 GitHub Actions 在部署前会执行：

- `pnpm lint:check`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm typecheck:scripts`
- `pnpm deadcode:check`
- `pnpm build`
- 列表页 RSC payload 检查，防止 MDX 正文重新进入首页列表
- `pnpm quality:html`
- `pnpm size:budget`
- `pnpm size:report` 静态资源体积报告

## GitHub Actions

工作流文件：

```text
.github/workflows/deploy.yml
```

触发方式：push 到 `main`（正式站 https://zaixi.dev/）或 `dev`（预览站 https://dev.zaixi.dev/），以及手动触发 `workflow_dispatch`。

两个并行 job，都跑在 Sengi runner（`sengi-standard-2-ubuntu-2404`）上：

- `deploy`：拉取完整历史（文章页的更新时间和提交记录来自 git）→ 安装依赖（pnpm store 与 `.next/cache` 走 Actions 缓存）→ `pnpm build` → `scripts/pages_deploy.py` 直传 Cloudflare Pages。上线只依赖这一条路径。
- `check`：`pnpm check`（格式、lint、类型、单元测试、死代码、图标与图片清单）。失败会在 GitHub 上标红，但不阻塞上线。

`dev` 分支构建时设置 `NEXT_PUBLIC_SITE_URL=https://dev.zaixi.dev` 和 `NEXT_PUBLIC_NOINDEX=true`（robots.txt 禁止抓取），并给 `out/_headers` 追加全站 `X-Robots-Tag: noindex`。

## Cloudflare Pages 直传

`scripts/pages_deploy.py <dir> <project> <branch>` 不依赖 Node/wrangler：先查询 Pages 已有的文件哈希，只上传变化的文件，再创建部署。`_headers`、`_redirects`、`_routes.json` 按 Pages 的要求作为部署请求的独立字段发送，不进文件清单。

项目名 `zaixi-blog`。GitHub 仓库需要配置：

```text
secrets.CLOUDFLARE_ACCOUNT_ID
secrets.CLOUDFLARE_API_TOKEN
```

`CLOUDFLARE_API_TOKEN` 需要具备 Cloudflare Pages 部署权限。

不等 CI 时可以本地直传：`task deploy-dev`、`task deploy-prod`，或在 box 上 `task deploy:fast`（`scripts/fast-deploy.sh`，读取 box 上的令牌文件）。

## 环境变量

可选：

```bash
NEXT_UMAMI_ID=
```

设置后，生产构建会输出 Umami 统计脚本。未设置时不加载统计脚本。

## 静态 headers

Cloudflare Pages 会读取：

```text
public/_headers
```

这里维护 CSP、HSTS、Referrer Policy、Frame Policy 等响应头。

## 重定向

`public/_redirects` 是旧 URL 的权威规则，开发服务器、静态 preview 和 Cloudflare Pages 共用这份清单：

- 无语言前缀的历史路径（`/categories`、`/tags`、`/blog/*`）跳到 `/zh/`。
- 迁移前的 Hugo 站点：文章 `/posts/<slug>/` 跳到 `/zh/<分类>/<slug>/`，`/about/` 和 `/posts/` 跳到首页，`/index.xml` 跳到 `/feed.xml`，文章配图 `/<slug>/*` 跳到 `/static/images/<slug>/*`。
- 论坛外链的动态 WebP 保持原路径 `/forum/*`，不做跳转。

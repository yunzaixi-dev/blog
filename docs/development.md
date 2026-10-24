# 本地开发

使用 `.node-version`、`package.json#packageManager` 指定的工具链，以及 Go 1.26+。

## 严格端口开发

```bash
pnpm install
pnpm dev
```

浏览器地址 `http://127.0.0.1:45100/zh/`，Go API 位于 `45101`。Vite 代理 `/api` 到 Go，文档请求也使用 Go 的状态、redirect、动态 head 后再注入 HMR。端口已占用立即失败，不自动换端口。supervisor 只关闭自己创建的进程组，子进程失败会停止所属同伴。源码经 Vite HMR，文章每次请求按字节发现变更，不依赖 HMR、mtime 或重启。

隔离开发可用 `DEV_PORT=45200 API_PORT=45201 pnpm dev`，API_PORT 必须紧随 DEV_PORT。开发壳写入 `.cache/dev-out`，不覆盖生产 preview 的 `out/`。图片与论坛资源同样代理 Go，旧图片 URL 的 WebP 映射在两种服务中一致。

`CONTENT_DIR=/path/to/content pnpm dev` 可使用隔离内容。生产与 preview 使用同一个 Go handler。应用预览：

```bash
pnpm build
pnpm preview --no-build --port 45100
```

## 验收命令

完整应用发布在 Linux 宿主运行 `pnpm verify:local`。入口自动创建使用 `.devcontainer` 定义的独立测试项目，在容器内运行下述检查以及真实 PG/Typesense/S3 发布集成；宿主只编排 Docker 和实际运行时镜像 smoke。无需手动进入容器，也不复用开发数据库或占用开发端口。应用 push hook 自动执行，纯文章和媒体 push 保持独立导入。隔离与证据说明见 [deployment.md](./deployment.md#sengi-镜像流水线)。

app 容器通过网络命名空间内的 `ip_local_reserved_ports` 保留 `45100–45142`：这些固定监听端口不再被浏览器的临时出站连接随机占用。此设置不修改宿主 sysctl，也不关闭其他服务。

以下单项命令用于容器内定向诊断，不替代完整发布入口：

```bash
pnpm format:check
pnpm lint:check
pnpm typecheck
pnpm typecheck:scripts
pnpm test:unit
pnpm deadcode:check
pnpm test:go
pnpm test:runtime
pnpm test:e2e
pnpm test:e2e:parity
pnpm perf:check
```

`pnpm check` 包含确定性静态门禁、unit、图标/图片检查以及 Go race/vet/build/gofmt。`test:runtime` 在 `45101` 启动隔离内容服务，证明启动后新增、同长保 mtime 修改、草稿、删除、写坏和恢复同时影响页面 API、搜索、feed、sitemap、export，无构建或重启。先运行 `pnpm build` 获得交付包。

`test:e2e` 使用已构建产物，在 `45100` 运行 preview；`test:e2e:parity` 同时使用 Vite `45100`、Go `45101` 与 preview `45110`。运行前释放自己启动的占用进程，勿终止其他项目进程。devcontainer 镜像已安装 Chromium 和系统依赖，宿主字体的测试结果不作为完整发布验收。E2E 用真实中文文章；英文和富内容能力用测试内隔离的真实解析 fixture，不增加生产文章。

`perf:check` 构建、检查应用壳 HTML 与资源预算。`quality:html` 发现 issue 必须非零退出；预算不因迁移而调高。ECharts 是按需异步 chunk，不属于首页初始依赖。文章正文和解析器不得进入前端构建图。

## 阅读与导航合同

稳定 `AppShell` 持有已有 animata 状态机；路由 loader 请求 `/api/page`，AbortSignal 防止旧请求覆盖快速新导航。POP、focus、pageshow 重取内容，不定时轮询。列表返回保留该历史条目的已加载数量；唯一 `ScrollRestoration` 与浏览器负责滚动，不保存或二次矫正 scrollY。

返回控制稳定 href 是本地化首页。只有同标签页、同源、同 locale、精确目标的一次性到达凭证才允许 Back；直达、刷新、外部来源走首页。树内文章切换使用 replace 并保留原列表来源。文章 fragment 使用保留 `history.state` 的 replaceState，不插入新的返回项。

卡片/树覆盖层 fixed、inert，不复制正文、不改变路由/滚动所有权。打开 underlay 160ms 后 morph 380ms，经验证返回 morph 340ms 后 underlay 淡出；reduced motion 不等待完整动画。桌面 `TOC | surface | tree`、320px 内部滚动、代码复制恢复提示和 Header 1024px 断点保持原合同。

## 写作与本地证据

```bash
pnpm write-blog create --title "文章标题" --locale zh --slug my-post --folder 工程 --draft
pnpm content:generate
pnpm images:optimize
pnpm ui:screenshots --label after --base-url http://127.0.0.1:45100
pnpm ui:probe --base-url http://127.0.0.1:45100 --out docs/agent-records/probe.json
```

内容校验是作者的可选检查，不是运行时发布前置。`images:optimize` 仅将新增 PNG/JPEG 转成 WebP（仅在体积变小时替换），默认不重新编码已有 WebP/AVIF；重复执行不会继续损失质量。`images:check` 只读取并验证解码与尺寸。新图转换后按日志更新正文引用，旧 URL 由明确 redirect 保留；没有默认强制重编码模式。

截图与 probe 只写本地 ignored records，不启动或重建服务。`ui:screenshots` 支持 `--label`、`--base-url`、`--locale zh|en`、`--pages`（逗号分隔）、`--viewports`、`--theme dark|light|both`、`--article-path`、`--search-query`、`--empty-query`、`--text-scale`、`--out-dir`、`--selector`、`--scroll-to`、`--full-page`。默认真实文章是 `/zh/数据分析/nodeseek-post-types/`，分类详情为数据分析，标签详情为 NodeSeek，搜索词为 NodeSeek。英文当前无文章：英文首页/分类/标签展示空态，search-results 记录空结果，term detail 为 404；选择文章截图时仍默认使用存在的中文文章，不伪造英文文章。

```bash
pnpm ui:screenshots --label zh-evidence --pages home,article,category-term,tag-term,search-results --viewports mobile,desktop --theme both
pnpm ui:screenshots --label en-empty --locale en --pages home,categories,tags,search-results --viewports mobile
pnpm ui:screenshots --label code --pages article-code --article-path /zh/建站/hello/ --viewports mobile
```

`ui:probe` **只接受 `--base-url` 与 `--out`**，没有 `--article-path`。它自动检查当前真实中文文章、发现界面、多 viewport、注入的隔离排版 fixture 与英文空站；未出现在真实文章中的数学/代码元素记录 null，富内容能力由 E2E fixture 验证。JSON 中 `readingAlignment.summary` 是测量结果，不等于脚本运行成功即视觉门禁通过。站点身份、导航、代码主题分别位于 `data/siteMetadata.ts`、`data/headerNavLinks.ts`、`data/codeThemes.ts`。

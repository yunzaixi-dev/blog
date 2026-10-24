# 软件架构

React 静态应用壳与运行时内容完全分离。文章更新无需前端构建、CI/CD 或进程重启。当前权威决策是 [ADR-0019](./decisions.md#adr-0019-静态-react-壳与运行时-go-内容-api)。旧 Next.js 静态正文与 Pagefind 决策已被取代。

## 数据流

```text
Vite -> out/index.html + hashed assets (no article content)
Browser -> Go /api/page?path=... -> current page projection
Mounted content -> byte comparison -> private Node stdio parser
  -> immutable snapshot -> Go page/search/feed/sitemap/export handlers
Mounted public -> Go safe static files / images / forum media
```

生产运行 Go HTTP 与一个受管 Node worker。Node 不监听端口；只接受 Go 从挂载内容目录读出的文件文本，返回 JSON。启动时建立首个快照，内容缺失、无效或 worker 启动失败会停止启动。HTTP 请求按完整字节比较增改删，不用 mtime/size 作为内容身份。新快照生成完成后整体发布；失败返回 503，不伪装为 404、不静默提供旧快照，修复后下一请求重试。

## 目录与边界

- `app/main.tsx`：普通 React Router data router、稳定 AppShell、唯一 ScrollRestoration。
- `app/page.tsx`：运行时 page loader 与页面投影消费；没有文章静态模块。
- `internal/web/`：内容目录安全读取、快照锁与发布、搜索、HTTP、动态 head 与静态服务。
- `server/content-worker.ts`：frontmatter schema、内容查询投影、正文 JSON 树、RSS/sitemap/export。
- `server/document.ts`、`content-pipeline/`：安全 Markdown/MDX 解析及原 remark/rehype 插件。
- `components/DocumentRenderer.tsx`：固定 registry 递归渲染 JSON 文档；浏览器不执行作者代码。
- `lib/content/`：类型、term 原始 label/slug、列表与树查询。只在 worker 中绑定完整文章集合。
- `content/` 与 `public/`：独立持久挂载；不是应用构建所需的文章数据。

## API 与响应语义

`GET /api/page?path=/{locale}/.../` 返回当前请求同一快照的 kind、locale、metadata，以及对应页面的 cards/article/body/tree/terms。列表只携带卡片投影；文章只携带当前文章的白名单树、作者、TOC、精简上一篇/下一篇和 locale 内容树。未知页面返回 404 与本地化 notFound 投影，未知 API 返回 JSON 404，非法 path 返回 400。

`GET /api/search?q=...&locale=zh|en&limit=1..50` 由 Go 对发布内容的内存索引搜索。默认 limit 10，q 必须非空且不超过 200 Unicode 字符；重复/未知参数、非法 locale/limit 返回 400。所有词都必须命中，标题权重高于摘要、摘要高于正文；同分按 URL 稳定排序。摘要是 Unicode 安全纯文本，不注入 HTML。草稿不进入页面、搜索、RSS、sitemap 或 export。

`/feed.xml`、`/{locale}/tags/{tag}/feed.xml`、历史 `/tags/{tag}/feed.xml`、`/sitemap.xml`、`/robots.txt`、`/export/{locale}/{slug}.md` 都来自同一发布快照。页面文档、API 和这些内容响应均 `no-store`。

## 安全内容树

管线保持 remark-gfm → remark-math（singleDollarTextMath 实际为 true）→ TradingView → ECharts → icons → GitHub embeds 的次序，随后 heading slug/autolink → MathJax SVG → code source metadata → Shiki → code line metadata → minify。

白名单仅允许标准排版元素与 Icon、Image、ECharts、StrategyCard、TradingView 两类 widget。JSX props 限静态字面量、数组/对象、负数，拒绝 ESM import/export、函数、调用、spread、事件属性、危险对象键及 URL。原 Markdown、编译器和可执行 MDX code 不进入浏览器。MathJax/Shiki 的生成样式在服务端转换为静态属性；生成 style 节点不能从作者输入直接注入。新图标通过 lucide 完整动态映射按需加载，新图片使用挂载资源的原生 img，不依赖构建时文章 manifest。

## 文档与 SEO

Go 注入当前请求的 title、lang、canonical、OG/Twitter、hreflang 与 JSON-LD，正文仍经 API 加载。无 JavaScript 时显示说明与 Markdown export 路径，不承诺无脚本正文。中文/英文空首页、term index 和 search 真实保留；没有英文文章时不伪造英文文章/term detail。未知资源返回真实 404，不被 SPA 壳吞掉。

## 返回与滚动

稳定 `AppShell` 保留 animata 状态机。路由、POP、focus、pageshow 发起新请求，loader AbortSignal 防止旧结果覆盖；不使用定时轮询。列表按 history key 保存已加载数量，确保第六篇以后返回仍有目标卡片。唯一 React Router ScrollRestoration 与浏览器负责位置恢复，不保存 scrollY、不做 timer 恢复。fragment 保留 history.state 并 replaceState，不插入返回项。

返回控制默认本地化首页；只有同标签页、同源、同 locale、精确目标、短到达窗口的一次性来源凭证允许 Back。树内切换 replace 并保留来源会话；直达、刷新、外链与新标签页不能 Back 离开站点。

## 文章卡片转场

卡片、树快照 fixed、inert、aria-hidden，不复制 DOM 或正文。Header z50，覆盖层 z40。完整卡片共享 title/Git/summary/date/tag 的逐 child geometry；underlay 160ms 后打开 morph 380ms、验证返回 morph 340ms、返回 underlay 160ms 淡出。树 companion 同步 Phase B，树 solo 380ms；文章切换只用 180–220ms paint veil。reduced motion 取消大位移与等待。

桌面阅读维持 `TOC(256) | gap(36) | surface | gap(36) | tree(256)`，shell 上限 1440；1024px 以下隐藏侧栏树，640px 以下卡片目标 top72/radius0，其他 top120/radius8。正文 rail、表格/代码/公式内部滚动与 44px 代码控件沿用现有样式。动画不接管路由或滚动；resize、缺几何、快速导航与不匹配目标立即退出快照。

## 静态服务与开发一致性

Go 使用 os.Root 限制根目录，禁 dotfile、目录列表与符号链接；静态支持 GET/HEAD、304、Range。哈希 assets 一年 immutable，可变媒体一小时 must-revalidate。权威 `_redirects` 按顺序与 splat 匹配，保留 query/Unicode，不强加尾斜杠。安全头由 Go handler 执行。

开发 Vite 严格 45100、Go 严格 45101；Vite API 与文档转发到相同 handler 再插入 HMR。preview 直接由 Go 提供壳与 API。进程 supervisor 只管理自己创建的进程组。运行时一致性、浏览器导航和安全边界由 unit、Go race、runtime integration、E2E 与 parity 门禁共同验证。

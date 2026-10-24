# zaixi.dev

纯粹的技术博客。React 19 + Vite 静态应用壳，React Router 处理浏览器导航；Go 提供运行时页面、搜索、RSS、sitemap 和 Markdown export API，并管理一个不监听端口的私有 Node 内容解析 worker。

**更新文章不需要构建、CI/CD 或重启。** 把 Markdown 与图片写入服务挂载的 `content/`、`public/` 目录，下次请求就会读到完整的新快照。文章正文不写进应用 HTML 或前端 bundle；无 JavaScript 时显示说明，Markdown 可通过 `/export/zh/<分类>/<slug>.md` 阅读。

## 开发与预览

需要 Node.js 24+、pnpm 11 和 Go 1.26+。可选安装 [go-task](https://taskfile.dev/installation/)。

```bash
pnpm install
pnpm dev                         # Vite 45100，Go 45101；端口占用即失败
pnpm build                       # out/ 应用壳、dist/blog、dist/worker/
pnpm preview --no-build --port 45100
pnpm content:generate            # 可选内容校验，不是发布步骤
pnpm check
pnpm test:runtime
pnpm test:e2e
pnpm test:e2e:parity
pnpm perf:check
```

## 写作与转发

```bash
task new-post SLUG=my-post CATEGORY=工程 TITLE="标题"
pnpm images:optimize
pnpm export forum my-post
pnpm export x my-post
task webp IN=clip.mp4
```

CI 只验证并提供运行时 artifact，不自动发布到远端。内容与媒体独立持久挂载，部署命令见 [部署文档](docs/deployment.md)。

- [软件架构](docs/architecture.md)
- [内容与安全 MDX](docs/content.md)
- [本地开发与门禁](docs/development.md)
- [架构决策记录](docs/decisions.md)

## 致谢

站点代码基于 [mizorewww/blog](https://github.com/mizorewww/blog)，它源自 [timlrx/tailwind-nextjs-starter-blog](https://github.com/timlrx/tailwind-nextjs-starter-blog)，均以 MIT 许可发布，见 [LICENSE](LICENSE)。文章内容与图片版权归本站作者所有。

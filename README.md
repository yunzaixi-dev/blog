# zaixi.dev

纯粹的技术博客。Next.js App Router + Contentlayer + Tailwind CSS 静态导出，部署在 Cloudflare Pages。

- `main` → https://zaixi.dev/
- `dev` → https://dev.zaixi.dev/（禁止索引）

推送后由 GitHub Actions 在 [Sengi](https://sengi.run) runner 上构建，`scripts/pages_deploy.py` 只上传变化的文件。

## 常用命令

需要 Node.js 22、pnpm 和 [go-task](https://taskfile.dev/installation/)。

```bash
task install                      # 安装依赖
task serve                        # 开发预览 http://localhost:3001
task new-post SLUG=my-post CATEGORY=工程 TITLE="标题"
task images                       # 加了配图后生成多尺寸 WebP
task build                        # 构建到 out/
task check                        # 全部检查（CI 同款）

task export:list                  # 可导出的文章
task export:forum SLUG=my-post    # 论坛 Markdown（图片为完整 URL）→ 剪贴板
task export:x SLUG=my-post        # X 文章富文本 → 剪贴板，图片 → ~/Downloads/x-export/<slug>/

task webp IN=clip.mp4             # 视频 → 论坛动态 WebP（public/forum/）
task deploy:fast                  # 不等 CI，从 box 直传
```

论坛 Markdown 也随站点发布在 `https://zaixi.dev/export/zh/<分类>/<slug>.md`，手机上也能直接复制。

## 文档

- [软件架构](docs/architecture.md)
- [部署](docs/deployment.md)
- [本地开发](docs/development.md)
- [架构决策记录](docs/decisions.md)

## 致谢

站点代码基于 [mizorewww/blog](https://github.com/mizorewww/blog)，它源自 [timlrx/tailwind-nextjs-starter-blog](https://github.com/timlrx/tailwind-nextjs-starter-blog)，均以 MIT 许可发布，见 [LICENSE](LICENSE)。文章内容与图片版权归本站作者所有。

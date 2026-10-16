# zaixi.dev blog

Hugo 0.168.0，主题内置于 layouts/，无 Node/子模块。推送 `main` → GitHub Actions 构建 → `scripts/pages_deploy.py` 通过 Pages Direct Upload API 增量直传（项目 `zaixi-blog`）。

- `main` → https://zaixi.dev/
- `dev` → https://dev.zaixi.dev/

## 常用命令（Taskfile）

需安装 [go-task](https://taskfile.dev/installation/)：`curl -fsSL https://taskfile.dev/install.sh | sh`

```bash
task --list          # 列出任务
task serve           # 本地预览
task build           # 构建到 public/
task new-post SLUG=my-post
task webp IN=clip.mp4          # 视频→ static/forum/*.webp（需 ffmpeg）
task forum:upload FILE=a.webp  # 拷贝 webp 到论坛目录
task clean
```

本地直传（一般用 Git push 即可）：`task deploy-dev` / `task deploy-prod`（需 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`）。

论坛动态 WebP 说明见 [`static/forum/README.md`](static/forum/README.md)。

## 不用 Taskfile 时

```bash
hugo server
hugo --minify
```

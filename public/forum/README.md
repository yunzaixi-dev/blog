# 论坛动态 WebP 托管

本目录通过 Cloudflare Pages 公开托管，用于在 NodeSeek 等论坛发帖时插入动态 WebP。

## URL

| 环境 | 地址 |
|------|------|
| 预览 | `https://dev.zaixi.dev/forum/<文件名>.webp` |
| 正式 | `https://zaixi.dev/forum/<文件名>.webp` |

占位示例：[`demo.webp`](./demo.webp) → `https://dev.zaixi.dev/forum/demo.webp`

## 推荐流程（Taskfile）

```bash
# 安装 go-task 后，在仓库根目录：

# 1) 视频转动态 WebP（需 ffmpeg）
task webp IN=./clip.mp4
# 可选: SCALE=480:-2 FPS=8 Q=40 OUT=my-clip.webp

# 2) 或拷贝已有 webp
task forum:upload FILE=./a.webp NAME=my-clip

# 3) 提交并推送到 dev 预览，确认后再合并 main
git add static/forum && git commit -m "forum: add my-clip.webp" && git push origin dev
```

## 限制与注意

- Cloudflare Pages 单文件建议不超过 **25 MiB**。
- 文件名用英文、数字、连字符，避免空格和中文。
- 不要把密钥、Cookie、私人截图提交进仓库。
- 本目录只放需要公开外链的媒体；博客正文图片仍放各文章目录。

## 论坛引用示例

```markdown
![说明](https://zaixi.dev/forum/demo.webp)
```

直接贴链接亦可（部分论坛会自动识别为图片）。

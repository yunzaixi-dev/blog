---
title: "用博客托管论坛动态 WebP"
date: 2026-10-16T17:46:00+08:00
summary: "论坛只收动态 WebP 时，把片段放进本站 Pages 的 /forum/，用 task 一键转换并外链引用。"
categories: ["建站"]
tags: ["Hugo", "Cloudflare", "论坛"]
language: zh
authors: ['default']
---

不少论坛只允许嵌入动态 WebP，不方便直接贴视频。这个博客本身跑在 Cloudflare Pages 上，于是把公开外链媒体放进 `static/forum/`，推送后即可用固定 URL 引用，不必另开对象存储。

## 效果

![论坛动态 WebP 示例](/forum/demo.webp)

正式地址：`https://zaixi.dev/forum/demo.webp`

## 转换

仓库根目录装好 [go-task](https://taskfile.dev/) 和 ffmpeg 后：

```bash
task webp IN=./clip.mp4
# 可选：SCALE=480:-2 FPS=8 Q=40 OUT=my-clip.webp
```

输出默认落到 `static/forum/`。单文件请保持在约 25 MiB 以内（Pages 限制）。已有 WebP 可直接：

```bash
task forum:upload FILE=./a.webp NAME=my-clip
```

## 引用

Markdown：

```markdown
![说明](https://zaixi.dev/forum/my-clip.webp)
```

部分论坛直接贴链接也会识别为图片。文件名用英文、数字和连字符；不要把密钥或私人截图提交进仓库。

日常流程：先推 `dev` 在 [dev.zaixi.dev](https://dev.zaixi.dev/forum/demo.webp) 预览，确认后再合并 `main`。更多细节见仓库里的 `static/forum/README.md`。

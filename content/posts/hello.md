---
title: "你好，世界"
date: 2026-10-15T03:50:00+08:00
description: "第一篇文章：这个博客是怎么搭起来的，以及推送即上线的部署流水线。"
tags: ["随笔", "Hugo", "Cloudflare"]
---
这是用 Hugo 搭建、通过 Cloudflare Pages 部署的第一篇文章。推送到 `main` 即自动上线。（t4）

## 为什么是 Hugo

单个二进制、没有 Node 依赖，整站构建只需要几十毫秒。

> 工具越轻，越容易坚持写下去。

## 部署流程

```yaml
on:
  push:
    branches: [main]
steps:
  - run: hugo --minify --gc
  - run: npx wrangler pages deploy public --project-name=zaixi-blog
```

1. 本地写 Markdown
2. `git push`
3. 约 30 秒后上线

# GitHub Pages / Actions 构建链减负与稳定化计划

## 目标
- Pages dist 只发布浏览器运行需要的文件，保持在 900 MiB 以下。
- PR 校验拆成 fast 与 smoke，减少每个 PR 的浏览器安装和串行长链路。
- perf gate 增加并发取消、缓存、浅拉取、失败产物，补齐性能相关路径分类。
- transport 与 scenario 专门 workflow 保持 check 名称稳定，内部按路径决定执行重活。

## 边界
- 不迁移 GitHub Pages 到 CDN/Releases。
- 不改变性能阈值。
- 不改 README。
- branch protection 等 workflow 稳定后再启用，本轮只准备稳定 check 名称。

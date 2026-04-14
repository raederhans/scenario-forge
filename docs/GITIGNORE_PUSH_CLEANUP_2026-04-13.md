# GITIGNORE_PUSH_CLEANUP_2026-04-13

- [x] 确认 push 失败根因是未推送历史中混入超大 `dist/app/data/**` 生成产物。
- [ ] 在 `.gitignore` 收口 `dist/app/data/`，只忽略确认不影响云端构建的生成产物。
- [ ] 备份当前本地 HEAD，并暂存未提交工作区改动，避免重写历史时丢失。
- [ ] 将 `main` 回退到 `origin/main`，保留工作区内容后重组提交，排除 `dist/app/data/**`。
- [ ] 校验未推送对象里不再包含超限大文件，并执行 `git push origin main:main`。
- [ ] 记录 lessons learned，并把本文档移入 `docs/archive/`。

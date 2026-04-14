# GITIGNORE_PUSH_CLEANUP_2026-04-13

- [x] 确认 push 失败根因是未推送历史中混入超大 `dist/app/data/**` 生成产物。
- [x] 在 `.gitignore` 收口 `dist/app/data/`，只忽略确认不影响云端构建的生成产物。
- [x] 备份当前本地 HEAD，并暂存未提交工作区改动，避免重写历史时丢失。
- [x] 将 `main` 回退到 `origin/main`，保留工作区内容后重组提交，排除 `dist/app/data/**`。
- [x] 校验未推送对象里不再包含超限大文件，并执行 `git push origin main:main`。
- [x] 记录 lessons learned，并把本文档移入 `docs/archive/`。

## Result

- 远端已成功接收新的 `main`：`2afae79 -> 3bd88d0`
- 未推送对象里已不再包含 `dist/app/data/**` 下的 100MB+ 超大 blob
- GitHub 仍对 `data/scenarios/tno_1962/derived/marine_regions_named_waters.snapshot.geojson` 给出 86.86 MB 警告，但本次 push 已成功，不是阻塞项

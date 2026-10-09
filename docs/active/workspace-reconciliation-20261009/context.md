# 恢复与交接

审计主线固定为 `ab915f9ee95112ad8c1deeadfe05b6087702ebe5`。root 是唯一 Git 整合负责人；活动整合分支为 `codex/workspace-recovery-20261009`。

主目录下的恢复位置：

- `.runtime/tmp/workspace-reconcile-20261009/backups/`：primary、hgo-native、pr-delivery 原文件、manifest、binary patch 和原索引。
- `refs/recovery/workspace-20261009/primary-wip`：本次主目录完整 tracked/untracked stash；另固定了原本地、远端和 64 个历史 stash 引用。
- `.runtime/worktree-archives/workspace-reconcile-20261009/<原目录名>/`：15 个旧 checkout 的完整同卷目录归档，包括 ignored 文件。原 `.git` 链接更名为 `.git.worktree-link`，原独立 gitdir 另存于 `.runtime/tmp/workspace-reconcile-20261009/worktree-admin/`。
- `.runtime/reports/generated/workspace-reconcile-20261009/`：逐文件分类、分支覆盖与删除清单、逐工作树归档回执、同步前后交付计划。

这些是本地 Git/文件恢复归档，不是 Codex 跨对话的托管归档；其他旧对话中的原路径现在是历史位置。恢复时先从固定引用创建新分支和工作树，再从归档提取需要的 WIP/ignored 文件，不能直接把旧 `.git` 链接复制回新目录。不要把整个旧 WIP 覆盖到当前 main。

清理前发现主仓库存在 10 月 5 日遗留的空 `index.lock`；核对修改时间后已移动到恢复目录留存，而非丢弃。主线更新保留全部 ignored 本地数据。

分支覆盖证据：wave3 / wave4 / PR delivery / Pages delivery 的 integration 分支分别与已合并提交 `b416e2571` / `bb510a549` / `06d09474d` / `a1be99c6d` 整树相同；对应子分支补丁已进入这些 integration。physical 本地重复 merge 与已合并的远端版本整树相同。`pr-lane-probe` 仅多临时 CSS 注释，PR #207 已关闭。

Blank Base 构建 owner 为 blank_recovery，cwd 为本次隔离工作树；命令为 `python tools/build_blank_base_scenario.py --india-source C:/Users/raede/Desktop/dev/mapcreator/data/geoBoundaries-IND-ADM2.geojson --restoration-source-root C:/Users/raede/Desktop/dev/mapcreator`。构建日志 `.runtime/reports/generated/blank-rebuild.log`，只写本工作树 Blank Base 资产及 `.runtime` inventory；父代理和其他代理不并行运行 materializer。成功以当前 geometry/source/storage 合约验证为准，失败时保留日志，不扩展 allowlist 或掩盖失败。

root 独占本轮浏览器验证：`MAPCREATOR_DEV_PORT=8009 node node_modules/@playwright/test/cli.js test tests/e2e/scenario_blank_exit.spec.js --workers=1 --retries=0`，cwd 为本次隔离工作树。使用已有 120 秒用例预算，仅访问 localhost；Playwright 管理 server 并在结束时关闭。两次失败分别定位到旧主权 setter 和未等待 detail settled 的初始快照；修正用例后最终 1 case 通过，0 retry。最终日志 `.runtime/reports/generated/recovery-blank-browser-final.log`，三次输出分别保留在 `.runtime/tests/playwright/` 的独立子目录，原 ownerless、reset、全状态相等和像素断言均未放宽。

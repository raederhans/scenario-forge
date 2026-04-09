# TERRAIN_REVIEW_FOLLOWUP_2026-04-08

## Plan
- [x] 补齐 physical preset 新控件的 i18n 接线与翻译。
- [x] 给 project_save_load_roundtrip 增加可定位的启动/等待诊断。
- [x] 跑最小静态检查与目标测试。
- [x] 复核并归档本文件。

## Progress
- 2026-04-08 20:00 开始 follow-up 修复。
- 已补：`index.html`、`js/ui/i18n.js`、`tools/translate_manager.py`、`js/ui/toolbar.js` 的 physical preset / hint / 12 类标签 i18n 接线。
- 已补：`tests/e2e/project_save_load_roundtrip.spec.js` 通过 `readBootStateSnapshot` + 分段日志暴露真实卡点。
- 已验证：`node --check js/ui/toolbar.js`、`node --check js/ui/i18n.js`、`node --check tests/e2e/project_save_load_roundtrip.spec.js`、`python -m py_compile tools/translate_manager.py`。
- 额外诊断结论：`project_save_load_roundtrip.spec.js` 当前不是卡在 harness 启动。单跑后已看到首个 roundtrip 用例完成，随后进入下一条用例；此前“只有 Running 5 tests”只是缺少阶段日志造成的错觉。

- 追加定位：在 `gotoProjectPage:interactive` 之后，日志仍卡在 `waitForProjectUiReady:start`，说明当前问题已缩到 project UI ready 链路，不是 harness 本身没启动。

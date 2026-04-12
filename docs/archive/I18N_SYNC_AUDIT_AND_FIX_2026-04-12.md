# I18N Sync Audit And Fix 2026-04-12

## Goal
- 修复现有汉化体系对新架构内容的覆盖缺口。
- 执行一轮正式汉化，把当前明显未汉化的 UI 文案补齐。

## Plan
1. 统一翻译来源：让 sync 流程复用 `js/ui/i18n.js` 里的现有中文。
2. 补齐未接入 i18n 的静态文案，并把图标误报从 audit 里排除。
3. 补充必要的人工术语翻译，执行 `sync_i18n.bat --machine`。
4. 跑 audit 和相关测试，确认 UI 缺口清零。

## Progress
- [x] 已完成现状审计与 preview 验证，确认当前问题集中在 UI 层。
- [x] 已完成代码修复与文案补齐。
- [x] 已完成正式汉化生成与 `data/locales.json` 更新。
- [x] 已完成验证并准备归档。

## Result
- `tools/translate_manager.py` 现在会复用 `js/ui/i18n.js` 的现有中文，并在控制台显式输出 UI english fallback 数量。
- `tools/i18n_audit.py` 现在会统计 UI english fallback，并正确忽略 `\u00D7 / \u25B6 / \u2699` 这类图标字面量误报。
- `index.html` 新增 9 处 `data-i18n` 接线，当前 audit 结果为：
  - `ui_missing=0`
  - `ui_english_fallback=0`
  - `uncovered_visible_ui=0`

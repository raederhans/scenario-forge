# Context

- 2026-04-24T19:34:59: 已创建 Ralph snapshot：.omx/context/app-web-i18n-zh-20260424T233459Z.md。
- 发现工作树已有 landing 相关未提交文件，后续改动会先读现状再做最小修改。

- 2026-04-24T23:55:00: 子代理扫描确认 main app 漏点集中在 Scenario Guide、Water/Special override badge、Transport Workbench 配置文案；landing 漏点集中在 aria-label、img alt、hero chips 和 zh 翻译表英文术语。
- 2026-04-25T00:08:00: 已完成主壳 data-i18n 接线、transport 动态渲染 t(...) 接线、landing alt/aria/chip 接线、i18n audit 扩展、data/locales UI 补齐。
- 2026-04-25T00:11:00: 验证通过：i18n audit ui_missing=0 / uncovered_visible_ui=0 / dynamic_ui=0；py_compile、node --check、unit tests、build_pages_dist + pages dist tests 均通过。dist 为验证产物，已清理。
- 2026-04-25T00:25:00: 根据二轮 review 修复 landing zh 残留英文术语，校正 data/locales 中 Classes/inspector/Hub/Port/station/carrier/lens 等高风险错译，并补静态回归。
- 2026-04-25T00:27:00: 复验通过：i18n audit 关键计数全 0；py_compile、node --check、16 个 unit 测试、build_pages_dist + pages dist 测试通过。
- 2026-04-25T00:36:00: 第三/四轮 review 继续指出 geo Lens、carrier/lens/station 术语残留；已修复全域禁词，扩展测试到 locales.ui + locales.geo。
- 2026-04-25T00:40:00: 最终复核子代理 APPROVED。验证通过：i18n audit final6 全绿、py_compile、node --check、16 个 unit 测试、build_pages_dist + pages dist 测试、git diff --check。
- 2026-04-25T00:48:00: deslop pass（changed files only）完成：无新增重构，检查禁词、landing zh 残留、data-i18n-alt runtime 接线；post-deslop 验证重新通过。

# Context

2026-04-28 开始执行。当前 git status 只有 `.omx/metrics.json` 已修改，属于运行态产物，代码工作树干净。

已确认：
- `js/ui/toolbar/palette_library_panel.js` 已有 source tabs 渲染逻辑，但 `index.html` 缺 `#paletteLibrarySources` DOM。
- `paletteLibraryOpen` 默认值仍为 false，HTML 面板仍 hidden。
- 搜索输入缺清空按钮和 Esc 清空。
- 颜色行仅支持 click 选色，缺 double click / Enter 应用到目标。
- `map_renderer.js#getResolvedFeatureColor()` 仍在 renderer 内部，`js/core/color_resolver.js` 还不存在。

2026-04-28 实施记录：translate_manager 全量同步在前台超过 2 分钟无输出，已停止对应 Python 进程；本轮改为手动补充新增 UI 文案到 manual_ui、locales、baseline，后续用 i18n_audit 验证。

2026-04-28 验证记录：Node palette runtime bridge、renderer runtime state、i18n audit、i18n unittest、perf snapshot、perf gate contract 均通过。Playwright sidebar spec 两次卡在 test runner 启动前无输出，手动启动 8810 server 后仍未进入 reporter；已停止对应进程。browser quick 脚本失败于 WSL dev server 8000-8010 不可达。

2026-04-28 附加验证：Playwright --list 可列出计划内 3 个 E2E 文件共 8 个测试，说明测试发现路径正常；执行路径仍卡在 runner 启动/浏览器阶段。

2026-04-28 review follow-up：修复 roving focus 会选中折叠 details 内隐藏颜色行的问题。根因是 getPaletteLibraryRows 直接取全部 .palette-library-row；现在只返回所在 details 已展开的行，并在分组 toggle 后重算 tabindex。验证：node --check js/ui/toolbar/palette_library_panel.js；python -m unittest tests.test_toolbar_split_boundary_contract -q。

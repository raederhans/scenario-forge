# Task

## Current status
四轮优化及展示页小优化已在本地完成，相关 UI 的 dist 副本已同步。未提交、推送或部署。

## Checklist
- [x] 第一轮：恢复、导出、编辑入口。
- [x] 第二轮：桌面工作区精修。
- [x] 第三轮：平板核心操作。
- [x] 第四轮：指南、文案、展示与后台。
- [x] 目标验证、浏览器检查、相关 dist 同步。

## Delivered changes
- 启动错误时恢复按钮同步 hidden 状态；用户提示与原始错误详情分离。修复的是恢复界面，不宣称消除了所有启动故障。
- 工作区常驻保存项目 / 导出图片入口，复用现有保存流程及并发保护；显示未保存、导入、下载等项目状态。
- 外观导航和右侧折叠面板收紧间距，减弱卡片阴影。颜色库改为单一来源选择，异步加载和语言切换时保持真实选项。
- 底部着色 / 归属模式显示文字，空间不足时工具分组换行；撤销、重做、自动填色保持可达。
- 平板侧栏使用真实遮罩和关闭按钮；关闭时 inert，打开时转移焦点，Tab / Shift+Tab 循环，Esc 返回入口。焦点候选排除折叠栏目内容。
- 侧栏说明随栏目展开，减少对 hover 的依赖；触控主按钮扩大命中区域，弹窗内容可滚动。
- 导出默认呈现预览及目标、格式、分辨率；参数与图层放入高级设置。修正字段挤压及禁用下拉框文字重影。
- 指南的 HGO 操作步骤仅在对应剧本显示，步骤连续；补齐相关中英文名称。
- 展示页保持现有作品、来源与章节结构，调整中英文产品说明和主 CTA；后台补齐标签键盘操作、面板和对话框名称、焦点样式。

## Validation evidence
相关 Node 检查共 112 项通过：
- startup_boot_overlay_behavior：4；scenario_guide_popover_behavior：2。
- project_support_diagnostics_controller_behavior：31；palette_library_panel_grouping：9。
- backend_console_helpers：6。
- export_workbench_actions_behavior、export_workbench_state_behavior、landing_showcase_view_behavior：合计 47。
- deferred_ui_bootstrap_behavior、main_deferred_bootstrap_boundary：合计 13。

浏览器命令：`PLAYWRIGHT_TEST_BASE_URL=http://127.0.0.1:8007 npx playwright test tests/e2e/ui_rework_mainline_shell_sidebar.spec.js -g 'desktop commands and tablet drawers|desktop export preview opens' --workers=1 --output=.runtime/tests/playwright/ui-polish-final`。两项通过，总计 43.9 秒。

自动覆盖 1366 / 1440 / 1920 / 1024 桌面或横屏宽度、768×1024 平板竖屏；检查主要工具不重叠、导出字段不溢出、抽屉 inert / 焦点循环 / 关闭返回、真实 TNO 剧本导出预览和对话框 Tab / Escape。另在内置浏览器检查中文导出、展示页中英文切换、后台匿名页面和登录对话框的键盘操作。未提交后台表单。

最终截图：`.runtime/browser/ui-polish-20260911/editor-desktop-final.png` 与 `export-desktop-final.png`；检查日志同目录 `desktop-tablet-final.log`。已目视复核右侧卡片、颜色库、工具栏和导出布局。

三组既有 Python UI 静态契约合计 39 项，其中 34 项通过，3 项失败、2 项错误。本次开始前的 HEAD 内容对照出现相同 5 项问题：两项依赖过时 HTML 分界字符串，三项仍断言已迁移到其他 controller 的源码位置。本次更新工具栏换行的相关契约，最终失败集合没有增加。具体名称见 `ui-contracts-final.log`；不将该组检查报告为全绿。

仅同步 12 份相关 UI 源码到现有 dist 目标并重建 manifest，逐一核对内容相同；未运行全量数据生成或覆盖 renderer。相关文件 `git diff --check` 通过。

## Open risks
现有地图数据/渲染 WIP 不属于本次验收；真实 iPad Safari 未验证。未覆盖远端 CI 或部署，未新增手机支持。

# UI 自适应布局契约重构 - 指导计划

目标：把上下边栏和子菜单的宽度、内容缩放、滚动行为收回到统一布局契约里。

范围：
- scenarioContextBar
- bottomDock
- dock/sidebar popover
- transport info/help popover
- palette library
- 本范围内的文本截断与溢出测试

关键实现：
- css/style.css 增加布局 token 与 utility class。
- toolbar.js 中 scenarioContextBar 从 inline maxWidth 改为 CSS custom property `--scenario-bar-safe-max-width`。
- bottom-dock-primary 由单一 owner 规则控制响应式 grid。
- dock/sidebar/transport popover 使用统一 popover token。
- palette library 列表高度以 CSS variables 为真相源，JS 只读取变量并写运行时高度。
- index.html 只给范围内静态顶栏文本 span 加 `.u-truncate`。

验证命令：
- npm run verify:ui-contract-foundation
- npm run verify:ui-rework-mainline
- npm run verify:ui-rework-support
- npm run verify:test:e2e-layers
- npm run test:e2e:ui-rework-mainline
- npm run test:e2e:ui-rework-support
- browser inspection quick 或等价 Playwright 截图，输出到 `.runtime/`

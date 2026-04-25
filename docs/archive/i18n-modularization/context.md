# i18n 模块化上下文

2026-04-24：开始执行。工作树已有 app/web i18n 相关未提交改动，本轮在现有改动基础上继续收口，避免回退已有汉化与 landing 改动。

已读规则：AGENTS.md、lessons learned、docs/shared/agent-tiers.md、ultrawork skill。

2026-04-24：实施进展。
- 已抽出 `js/ui/i18n_catalog.js`，`js/ui/i18n.js` 改为 import catalog；`tools/translate_manager.py` 改读 catalog 文件。
- 已抽出 `js/ui/toolbar/transport_workbench_descriptor.js`，controller 继续保留状态归一、渲染与事件。
- 已补 i18n audit 的 landing 扫描、catalog key、transport descriptor、runtime alt 字面量、source scope/dynamic config/catalog/mixed term report 字段。
- 已在 `map_builder/contracts.py` 增加 scenario locale language、manifest field、filename 映射常量，并接入 HOI4 builder、TNO patcher、checker、scenario context、rebuild planner、startup bundle/bootstrap 工具和 JS runtime startup asset contract。

2026-04-24：review 自检发现 translate_manager 与 i18n_audit 的 transport key 扫描分叉。已新增 `tools/i18n_key_extractor.py` 作为共享 transport config 文案提取器，并补 `tests/test_translate_manager.py` 覆盖。验证显示 `dynamic_config_ui_keys=451` 且 translate_manager 漏收为 0。

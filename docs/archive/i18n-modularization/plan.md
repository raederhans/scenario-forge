# i18n 模块化执行计划

目标：按最小模块化路径收口 i18n 文案源、transport workbench 文案边界、scenario/startup locale 资产契约，并保持现有汉化结果稳定。

任务清单：
- [x] 核对现有 i18n/audit/transport/startup locale 代码现状。
- [x] 补强 i18n audit：覆盖 landing、alt、aria、transport config、catalog key，并输出 main app / landing / dynamic config / inline catalog 统计。
- [x] 抽出 UI copy catalog，让 runtime i18n 只负责翻译和 DOM 应用，translate_manager 读取 catalog 文件。
- [x] 抽出 transport workbench descriptor，controller 保留装配和事件。
- [x] 集中 scenario/startup locale asset contract，builder、patcher、checker 共用契约常量。
- [x] 跑定向验证，修复红灯。
- [x] 自检后归档本任务文档。

边界：不做全量 i18n 平台重写，不改 README，不创建 worktree，不扩大到每个 panel 的独立文案模块。




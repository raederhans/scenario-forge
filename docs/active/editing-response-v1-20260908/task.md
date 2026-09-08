# N1–N4 执行状态

- [x] 读取链接最新补充要求，确认 N1–N4 与本地基线 fb28b187。
- [x] N1：scheduler 执行实例和排队回调归属隔离。18 个新增反例在原实现失败，修复后 24/24；装配边界 15/15。
- [x] N2：实际探针复用纯 input-evidence helper，7/7；16 份旧记录、52 次离散输入、32 次受控 busy overlap 重放。缺失事件不变成零，采样模式分别报告。
- [x] N3：完成分段采样、自然后台、TNO stable、HOI4 stable 对照。UI hooks 约占慢 redo history 的 3.9%，主成本是注入 full refresh 后恢复 fine 政治图层。按原停止条件不改生产 history/UI，不为不存在的候选运行四组 A/B；无性能提升声明。一次 overlap 失败仅作诊断保留。
- [x] N4：旧 deferred callback、版本 reset 复用、失败 pending、取消、loadState 替换及空间索引异步续体均有确定性回归保护。空间 owner 两个新增反例先失败后通过；infra 最终 7/7，spatial 7/7，既有 refresh plan 17/17。
- [x] N4：最终源码冷启动、同浏览器再次进入、TNO→HOI4 切换三个编辑窗口通过（2.0m）；任务排空、ready、索引、填色及 undo/redo 正确。等待/异步历时/长任务分别统计，未将后台总历时当作 CPU 或输入延迟。
- [x] 最终 canonical Pages build exit 0（922.02 MiB）；三个生产源码镜像 LF 一致，dist 仅三个镜像与 manifest 改动；diff-check 通过，浏览器服务器已退出，文档收口。

工作区未提交、未推送、未发布；保留起始配置和 M0/M1 记录 WIP。N3 结论是测量后的停止决定，N4 的确定性缺陷不冒充历史 pending timeout 的根因。详细证据索引见 context.md。

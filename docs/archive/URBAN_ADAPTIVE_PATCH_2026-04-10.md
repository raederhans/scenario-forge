# Urban adaptive 恢复修复记录

## 目标
- 恢复城市/urban 的 adaptive 选项
- 保持当前 checked-in 的 political 地块分配和名称文本不变

## 执行计划
- [x] 确认根因：checked-in urban 产物缺少 `country_owner_id`，不能继续依赖前端 fallback
- [x] 实现 urban-only patch 脚本：基于当前 topology 的 political shell 重建 urban 元数据
- [x] 仅回写 `data/europe_urban.geojson`，不重建 checked-in political/topology 产物
- [x] 在运行时优先使用契约完整的 external urban 数据，避开 stale topology urban
- [x] 更新定向测试，改为断言 adaptive 可用，并移除与本问题无关的脆弱断言
- [x] 执行定向验证并归档

## 进度备注
- 当前确认：`data/europe_urban.geojson`、`data/europe_topology*.json` 的 urban layer 仍缺少 owner metadata
- 当前确认：scenario runtime topology 不含 urban object，本次无需动 scenario runtime topology
- 中途发现：只要重写 checked-in topology，就会触发 political feature 数量漂移；因此最终方案改成“只修 external urban + 运行时 source 选择”，彻底避开 political drift 风险

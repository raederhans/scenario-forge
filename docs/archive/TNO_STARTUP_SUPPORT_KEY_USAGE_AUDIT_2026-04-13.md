# TNO startup support key-usage 审计 2026-04-13

## 目标
- 审清 `locales.startup.json` / `geo_aliases.startup.json` 在默认启动阶段的真实 key-usage
- 产出可直接指导下一刀裁剪的白名单依据，不直接修改正式 support 产物

## 实施清单
- [x] 建立留档
- [ ] 梳理运行时读取点与 lookup 入口
- [ ] 实现 key-usage 审计脚本与报告
- [ ] 补测试并生成真实报告
- [ ] 复核后归档

# TNO Review Fixups 2026-04-09

## Goal

收口 review 指出的 3 个问题：

1. exact-after-settle helper/state 链可达且不报错
2. detail ADM mesh 为空时不能持续空转重绘
3. 懒生成的内部边界要同步进 static mesh snapshot

## Progress

- [x] 复核当前 review 锚点
- [x] 修复 detail ADM 空转重绘状态机
- [x] 修复 snapshot 同步
- [x] 验证 exact-after-settle 路径
- [x] 静态检查与浏览器回归
- [x] 更新 lessons learned 并归档

## Validation

- `node --check js/core/map_renderer.js`
- `node --check js/core/scenario_resources.js`
- `node --check js/main.js`
- `node --check js/core/state.js`
- 脚本入口 `/?render_profile=balanced&startup_interaction=readonly&startup_worker=1&startup_cache=1` 已恢复到可正常结束 boot
- 缩放/settle 探针已走到 exact-after-settle 路径，没有再出现 helper 缺失或 ReferenceError

# CITY_REVEAL_LOGIC_REWORK_IMPLEMENTATION_2026-04-14

## Goal
按已确认方案收口城市点位显示逻辑：保留现有分级体系，不新增功能入口，修正预算优先级、关键国家保底、局部阅读主导权切换，以及缩放阶段的单调露出行为。

## Plan
- [x] 收紧 reveal/quota 主链：总预算硬上限、关键国家保底池、统一竞争池、禁止 floor/capital reserve 顶穿预算
- [x] 修正国家分类边界问题：subject 优先于 warlord；P0/P2 quota 表与 reveal bucket 语义一致
- [x] 引入按 phase 切换的竞争排序：低缩放偏国家代表性，中缩放均衡，高缩放偏局部阅读（城市级别+人口+轻微中心偏置）
- [x] 用稳定窄范围阈值替换统一 0.68 reveal 开门点，保持露出单调
- [x] 调整标签预算：P3 提前少量 capital labels
- [x] 补充/修正回归测试，覆盖预算硬上限、关键国家保底、排除标签、P3 标签约束
- [x] 收窄保底池资格，避免 featured-heavy 场景把“有限保底”重新撑宽

## Progress Log
- 2026-04-14 立项：已完成本地复核、子代理交叉评审、方案确认，开始实施。
- 2026-04-14 实施：已完成 map_renderer 主链改造，去掉 quota floor / candidate viewport multiplier 对最终配额的强制抬升，加入关键国家有限保底池和 phase 分段排序。
- 2026-04-14 验证：已修正两份城市点位 Playwright 回归，补上预算硬上限、保护型首都、排除标签、P3 capital-only labels 的断言；针对单文件和单测做了定向验证。
- 2026-04-14 修正：根据 review 收窄 `isPriorityCountry`，保底池不再自动纳入所有 featured / A-B tier 国家，避免 featured-heavy 场景下“名义 priority 但实际保护不了”的回归。
- [x] 修复 review 暴露的两个回归：低 markerDensity 时保留有效国家配额；默认配置下让 P3 label phase 真正可见

- 2026-04-14 review 修复启动：确认两个新回归都成立，按最短路径准备收口 quota floor 和默认 labelMinZoom。

- 2026-04-14 review 修复完成：低密度 quota 重新保留最小有效国家配额；capital label 改为按独立 labelMinZoom 门控，默认配置下 P3 早期标签重新生效。
- 2026-04-14 review 验证：定向通过 point density changes marker budgets while label density only changes labels 与 p3 city labels stay capital-only and respect the small early label budget。


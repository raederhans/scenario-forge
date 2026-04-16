# TNO_COLOR_AUDIT_2026-04-15

## 计划
- [x] 定位 TNO 色板来源、运行时实际国家取色链路、TNO 剧本国家/TAG 数据来源。
- [x] 建立审核脚本：按 tag、地理位置、名字三方比对 TNO 色板映射与实际游戏内颜色。
- [x] 输出全量不匹配清单，区分明确误配、疑似缺失映射、需人工判定三类。
- [x] 复核结果，整理最短修复建议。

## 进度
- [x] 已读取 lessons learned 和项目代理约束。
- [x] 已完成颜色来源梳理。
- [x] 已完成三方匹配审核。
- [x] 已完成复核与汇报。

## 产物
- `.runtime/reports/generated/tno_color_audit_2026-04-15.json`
- `.runtime/reports/generated/tno_color_audit_2026-04-15.md`

## 结论摘要
- TNO 1962 运行时主地图国家颜色以 `data/scenarios/tno_1962/countries.json` 的 `color_hex` 为准。
- `data/palette-maps/tno.map.json` 当前 118 个 `mapped` TAG 与 `hoi4_vanilla.map.json` 完全一致，TNO 专属 verified 映射层还是空白。
- 全量审核得到 53 个颜色差异，其中 38 个属于高优先级核对项，15 个属于殖民地/附庸/controller overlay 语义下的人工确认项。
- 4 个国家出现了直接沿用其他剧本颜色的强信号：`ARM`、`BZ`、`GY`、`LIB`。

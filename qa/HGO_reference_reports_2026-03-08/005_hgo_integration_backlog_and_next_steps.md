# QA-HGO-005: HGO 接入建议、优先级与后续行动清单

**日期**: 2026-03-08
**范围**: 基于前四份报告，将 HGO 的可复用内容转化为可执行的开发 backlog
**目标**: 为后续开发提供明确的优先级、预期收益与风险边界
**状态**: 初版建议

---

## Executive Summary

HGO 的内容很多，但不应贪多。最合理的方式是按“最少改动，最大收益”的原则分批吸收。

建议分三层推进：

1. 先接入低风险高收益的语义层
2. 再接入中风险但收益很高的专题 catalog
3. 最后才考虑新的 donor 几何专题

---

## 1. 第一优先级: 立即值得做

### 1.1 建 HGO 专题索引

建议新增机器可读数据，例如：

- `data/hgo_catalogs/hgo_atlantropa_states.json`
- `data/hgo_catalogs/hgo_macroengineering_sites.json`
- `data/hgo_catalogs/hgo_special_zone_types.json`
- `data/hgo_catalogs/hgo_mediterranean_names.json`

原因：

- 这是后续一切接入的基础
- 避免每次都人工翻 `history/states` 和 `localisation`
- 风险很低，不会影响 runtime

### 1.2 接入命名层

建议先把 HGO 的命名引入当前项目，而不是立刻扩 donor geometry。

优先接入：

- Mediterrranean 子盆地名
- Atlantropa Zone 名
- Landbridge/Dam/Canal Site 名
- Reclamation Zone 名

接入位置建议：

- scenario metadata
- special regions metadata
- tooltip/legend label 数据源

### 1.3 接入特殊地块类型词表

将 [Anarchy Tags.txt](C:\Users\raede\Desktop\dev\mapcreator\historic geographic overhaul\help\Anarchy%20Tags.txt) 中的地块类型思想转成当前项目自己的 taxonomy。

例如新增内部枚举：

- `macroengineering_zone`
- `special_unclaimed_land`
- `collapsed_governance_region`
- `international_control_zone`
- `salt_basin`
- `reclaimed_land_stage`

---

## 2. 第二优先级: 明显有用，但应先做 catalog 再接

### 2.1 运河与陆桥专题 catalog

建议专门抽取：

- Nicaragua 系列
- Thai Canal 系列
- Qattara 系列
- Channel/North Sea 系列
- Baku-Bekdas 系列
- Crimean 系列

目标不是马上全部上线，而是形成一个“未来可选专题库”。

### 2.2 微型实体与地区 tag catalog

建议从 HGO 中筛出适合你当前项目语境的实体：

- 地中海圈
- 巴尔干圈
- 黑海圈
- 中东圈
- 北海/英伦圈

这些实体将来可以用于：

- owner/controller placeholder
- releasable overlays
- 区域候选方案
- 历史/替代历史说明

### 2.3 颜色与 cosmetic catalog

这一步适合在 UI 层准备扩展前完成。

收益：

- 减少未来 scenario overlay 的配色返工
- 避免新专题마다重新想命名与颜色

---

## 3. 第三优先级: 风险最高，但潜力大

### 3.1 开新 donor 几何专题

可候选方向：

- 黑海/里海/马尔马拉海
- 北海与英吉利海峡
- 北极重作
- 中美洲运河专题

但这类工作只有在以下条件下才建议推进：

- 你已经有明确的新场景目标
- 命名和语义 catalog 已经准备好
- 当前 vector 编译管线足够稳定

### 3.2 复用光栅实验层

HGO 中部分实验资源，如 `arctic rework`，适合作为 donor 参考，但不适合作为直接输入。

因此建议：

- 只在确定要做该专题时才解析
- 严格走抽取和重建流程
- 不要把老光栅工程直接挂到当前 runtime

---

## 4. 明确不建议的方向

### 4.1 不建议直接搬 HGO 整个 `map`

原因：

- 与当前 GeoJSON/TopoJSON 管线不兼容
- 会把当前项目拉回 HOI4 province 光栅逻辑
- 成本高，收益并不匹配

### 4.2 不建议优先处理 `events` 和旧 `interface`

原因：

- 当前项目主线是地图、scenario、runtime layer
- 事件和旧 GUI 不会显著提升当前开发效率

### 4.3 不建议先碰 `music/sound`

除非你进入成品包装阶段，否则这部分对核心开发没有帮助。

---

## 5. 建议的实际执行顺序

### Sprint 1

- 建 `HGO catalog` 抽取脚本
- 抽取 Atlantropa/Mediterranean 命名
- 抽取 special zone 类型词表

### Sprint 2

- 抽取非 Atlantropa 工程专题索引
- 抽取地中海周边微型实体与 cosmetic 名称
- 形成候选 overlay 分类

### Sprint 3

- 选择一个新专题做试点
- 推荐优先试点：`Baku-Crimea-Marmara` 或 `Channel/North Sea`

---

## 6. 最终判断

HGO 最适合当前项目的角色，不是“老地图包”，而是：

- `地块设计参考库`
- `特殊区语义库`
- `命名与政治身份词典`
- `宏大工程专题样本库`

如果按这个定位接入，你会得到持续收益。

如果试图整包导入，你会立刻陷入格式、版本和架构不兼容问题。

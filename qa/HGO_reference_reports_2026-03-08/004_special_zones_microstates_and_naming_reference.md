# QA-HGO-004: 特殊区、微型实体与命名体系参考报告

**日期**: 2026-03-08
**范围**: HGO 中与特殊地块类型、无主区、微型国家、cosmetic 命名、颜色体系相关的内容
**目标**: 为后续剧本增厚、地图语义化和替代政区设计提供参考
**状态**: 分析完成

---

## Executive Summary

HGO 的另一个被低估的价值，是它已经把很多“正常国家体系之外的地块”设计成了可操作的分类系统。

这对当前项目非常重要，因为你正在做的并不是纯现实行政区地图，而是逐步进入：

- 特殊工程区
- 无主区
- 占领区
- 国际托管区
- 分裂体
- 微型实体
- 替代政区命名

HGO 在这些问题上已经提供了很成熟的语义素材。

---

## 1. 特殊地块类型设计

最重要的参考文件是 [Anarchy Tags.txt](C:\Users\raede\Desktop\dev\mapcreator\historic geographic overhaul\help\Anarchy%20Tags.txt)。

该文件将“非正常国家地块”拆成如下类别：

- `Anarchy`
- `Bandits`
- `Tribes`
- `Wasteland`
- `Nomads`
- `International Zone`
- `Unclaimed Land`
- `Disputed Territory`

每一类又给出了不同意识形态下的显示名和语义用途。

### 1.1 对当前项目的价值

这套设计思路很适合迁移成你的 scenario/special region 分类体系。例如：

- `construction_zone`
- `international_water_control_zone`
- `salt_basin`
- `exposed_seabed`
- `unclaimed_macroengineering_land`
- `buffer_territory`
- `international_administration_area`
- `collapsed_governance_area`

也就是说，HGO 提供的不是单个名字，而是一整套“特殊地块类别应该怎么想”的范式。

---

## 2. 微型实体与区域拆分语义

HGO 的 [common/countries](C:\Users\raede\Desktop\dev\mapcreator\historic geographic overhaul\common\countries) 中拥有大量细分区域实体。

已确认特别适合地中海或边缘海域剧本参考的包括：

- `Andalusia`
- `Attica`
- `Baleares`
- `Corsica`
- `Crete`
- `Cyrenaica`
- `Dalmatia`
- `Sardinia`
- `Sicily`
- `Tripolitania`
- `Western Greece`
- `Northern Cyprus`
- `South Algeria`

这些实体的价值并不只在“可释放”，更在于：

- 它们为地块划分提供了成熟语义
- 可直接作为 feature group、subregion、overlay category 的命名来源
- 可以作为未来 scenario 的 `owner/controller placeholder`

---

## 3. cosmetic 命名层

HGO 的 [HGO_cosmetic_l_english.yml](C:\Users\raede\Desktop\dev\mapcreator\historic geographic overhaul\localisation\HGO_cosmetic_l_english.yml) 很适合后续做剧本增厚。

例如：

- `British Mandate of Palestine`
- `Mandatory Syrian Republic`
- `State of Greater Lebanon`
- `Generalitat of Catalonia`
- `Italian Cyprus`
- `Southern Territories of Algeria`

这类资源特别适合：

- 替代历史场景
- 占领与托管体系
- 殖民余绪
- 人工构造行政体

它们能让地图上的一个区域，不只是“被谁染色”，而是“它作为一种政治实体应该被叫什么”。

---

## 4. 重命名系统

HGO 中还存在针对城市和州的命名弹性设计：

- [City Renaming Events.txt](C:\Users\raede\Desktop\dev\mapcreator\historic geographic overhaul\help\City%20Renaming%20Events.txt)
- [rename_states_l_english.yml](C:\Users\raede\Desktop\dev\mapcreator\historic geographic overhaul\localisation\rename_states_l_english.yml)

虽然这些是 HOI4 玩法层实现，但设计思想值得保留：

- 同一地块可以有多套合法命名
- 命名由文化、政权、视角、时代决定
- 不应把一个地块的 display name 永远固定死

对 `mapcreator` 的启发：

- 未来可支持 scenario-specific display name
- 未来可支持 locale-specific display name
- 未来可支持 owner-dependent label
- 未来可支持 “historical name” 与 “engineering name” 双轨显示

---

## 5. 颜色体系

HGO 的 [colors (2).txt](C:\Users\raede\Desktop\dev\mapcreator\historic geographic overhaul\what am i doing\colors%20(2).txt) 和 [gcolors.txt](C:\Users\raede\Desktop\dev\mapcreator\historic geographic overhaul\what am i doing\gcolors.txt) 可以作为颜色参考库。

价值主要在于：

- 已经验证过大量 tag 的区分度
- 对地中海周边、多小实体并列显示很有帮助
- 能为当前项目未来的 scenario overlays 提供更稳定配色，而不是临时拼颜色

特别是当你开始加入：

- 工程区
- 中立区
- 施工控制区
- 特殊无主区

这种非正常国家类型时，配色规则会比单纯国旗色更重要。

---

## 6. 人名与角色风味

[HGO_names.txt](C:\Users\raede\Desktop\dev\mapcreator\historic geographic overhaul\common\names\HGO_names.txt) 虽不是地块核心资源，但它提供了一件重要事情：

- HGO 的区域拆分不是只有几何，还有本地化文化风味

这意味着你未来若要把某些地区从“地图专题”推进成“完整 scenario artifact”，这些名字资源可以辅助：

- 角色名
- 事件文本
- 地区风味说明

---

## 7. 结论

HGO 在特殊区和命名层面的最大价值，是它让“地图上的一块地方”不再只有几何边界，而拥有：

- 类别
- 角色
- 颜色
- 政治身份
- 多视角命名

这对你后续完善剧本尤其关键。

如果几何 donor 解决的是“地块长什么样”，那么这一层解决的是“地块在叙事上是什么”。

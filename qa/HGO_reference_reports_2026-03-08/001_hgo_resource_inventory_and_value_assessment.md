# QA-HGO-001: HGO 资源盘点与复用价值评估

**日期**: 2026-03-08
**范围**: `historic geographic overhaul` 全目录
**目标**: 判断哪些内容值得复用，哪些只适合作为参考，哪些应避免直接接入
**状态**: 盘点完成

---

## Executive Summary

`historic geographic overhaul` 是一个完整的 HOI4 老式模组工程，而不是单纯的素材包。其目录结构覆盖 `common`、`history`、`events`、`gfx`、`interface`、`localisation`、`map`、`music`、`sound` 等完整模组要素。

但从实际可复用角度看，HGO 的价值分布非常不平均：

1. 最有价值的是 `history/states`、`common/countries`、`localisation`、`map/adjacency_rules.txt` 和 `map/definition.csv`
2. 中等价值的是 `help`、`what am i doing`、部分 `gfx`
3. 较低价值的是整包 `events`、完整 `music/sound`、老版本 `interface`
4. 风险最高的是直接搬运整张 `map` 光栅工程到当前 vector/runtime 管线

---

## 1. 目录规模概览

根据本次扫描结果，HGO 主要目录规模如下：

| 目录 | 文件数 | 体积 | 判断 |
|---|---:|---:|---|
| `common` | 1387 | 5.9 MB | 高价值，含国家、地形、命名、触发器 |
| `history` | 13585 | 4.21 MB | 极高价值，核心地块拆分成果在此 |
| `events` | 29 | 0.49 MB | 中低价值，玩法逻辑可参考但不宜直接接 |
| `localisation` | 119 | 4.28 MB | 极高价值，命名与地块标签非常丰富 |
| `gfx` | 12416 | 308.96 MB | 中价值，美术与旗帜资源多，但不是当前重点 |
| `interface` | 67 | 0.84 MB | 中低价值，老 HOI4 GUI 参考意义有限 |
| `map` | 50 | 467.48 MB | 极高价值，但适合作 donor/reference，不适合直连 |
| `music` | 26 | 267.14 MB | 低价值，除非做完整模组包装 |
| `sound` | 8 | 2.57 MB | 低价值 |
| `what am i doing` | 19 | 101.65 MB | 高价值，含实验性设计资料与中间产物 |

---

## 2. 高价值目录

### 2.1 `history/states`

这是 HGO 的核心资产层。

关键发现：

- 共计 `11894` 个州文件
- 其中存在大量非 vanilla 的人工拆分州
- 其中有大批围绕海盆、海峡、工程区、运河区、替代地理构造出来的特殊州

这意味着 HGO 最强的能力不是“画了一张图”，而是“把大量复杂区域拆成了可剧本化的地块单元”。

对当前项目的意义：

- 可作为地中海、黑海、英吉利海峡、北海等区域的 donor 语义层
- 可为后续 scenario overlay、special regions、水域替代、工程占位区提供现成命名和分块方案
- 可用于提取 “人工设计过的地块颗粒度” 作为未来拆分参考

### 2.2 `common/countries`

该目录包含 `1299` 个国家定义文件，远超普通模组规模。

价值主要在于：

- 提供大量微型实体、地区国家、历史小邦、分裂体
- 为区域分治、可释放区、边缘政权、特殊行政体提供已有 tag 和颜色
- 有助于把一个纯地图项目扩展成“可挂剧本语义”的项目

对当前项目尤其有用的不是把这些国家都直接做进 UI，而是把它们当成“区域拆分语义词典”。

### 2.3 `localisation`

本目录中最重要的文件包括：

- [state_names_l_english.yml](C:\Users\raede\Desktop\dev\mapcreator\historic geographic overhaul\localisation\state_names_l_english.yml)
- [HGO_cosmetic_l_english.yml](C:\Users\raede\Desktop\dev\mapcreator\historic geographic overhaul\localisation\HGO_cosmetic_l_english.yml)
- [HGO_additional_states_l_english.yml](C:\Users\raede\Desktop\dev\mapcreator\historic geographic overhaul\localisation\HGO_additional_states_l_english.yml)
- [HGO_countries_l_english.yml](C:\Users\raede\Desktop\dev\mapcreator\historic geographic overhaul\localisation\HGO_countries_l_english.yml)

价值在于：

- 已经把大量特殊地块命名标准化
- 形成了工程区、海盆区、特殊行政区、附庸区、国际区的文字体系
- 可直接用于当前项目的 legend、tooltip、scenario label、未来导出文本

### 2.4 `map`

该目录价值很高，但必须谨慎使用。

关键资产包括：

- [provinces.bmp](C:\Users\raede\Desktop\dev\mapcreator\historic geographic overhaul\map\provinces.bmp)
- [heightmap.bmp](C:\Users\raede\Desktop\dev\mapcreator\historic geographic overhaul\map\heightmap.bmp)
- [terrain.bmp](C:\Users\raede\Desktop\dev\mapcreator\historic geographic overhaul\map\terrain.bmp)
- [rivers.bmp](C:\Users\raede\Desktop\dev\mapcreator\historic geographic overhaul\map\rivers.bmp)
- [definition.csv](C:\Users\raede\Desktop\dev\mapcreator\historic geographic overhaul\map\definition.csv)
- [adjacencies.csv](C:\Users\raede\Desktop\dev\mapcreator\historic geographic overhaul\map\adjacencies.csv)
- [adjacency_rules.txt](C:\Users\raede\Desktop\dev\mapcreator\historic geographic overhaul\map\adjacency_rules.txt)

适合的用途：

- donor 几何
- 海峡/运河规则参考
- province 级工程区占位
- 海盆边缘和海岸线重构参考

不适合的用途：

- 直接替换当前项目的 vector 数据源
- 直接成为当前 runtime topology

原因是当前项目走的是 GeoJSON/TopoJSON 管线，而 HGO 是光栅 + province id + HOI4 引擎文件管线。

---

## 3. 中价值目录

### 3.1 `what am i doing`

这个目录名字虽然随意，但实际很有信息量。

其中已确认有：

- [arctic rework](C:\Users\raede\Desktop\dev\mapcreator\historic geographic overhaul\what am i doing\arctic rework)
- [colors (2).txt](C:\Users\raede\Desktop\dev\mapcreator\historic geographic overhaul\what am i doing\colors (2).txt)
- [gcolors.txt](C:\Users\raede\Desktop\dev\mapcreator\historic geographic overhaul\what am i doing\gcolors.txt)
- [cosmetic (2).txt](C:\Users\raede\Desktop\dev\mapcreator\historic geographic overhaul\what am i doing\cosmetic (2).txt)
- [00_ideologies.txt](C:\Users\raede\Desktop\dev\mapcreator\historic geographic overhaul\what am i doing\00_ideologies.txt)

价值主要体现在：

- 记录作者如何思考颜色、cosmetic、特殊工程区与替代地理
- 包含一些半成品实验，可为未来新专题提供方向
- 很适合做“设计思路源头”而不是最终资产源

### 3.2 `help`

看似说明文件，实际上暴露了设计哲学。

例如：

- [FAQ.txt](C:\Users\raede\Desktop\dev\mapcreator\historic geographic overhaul\help\FAQ.txt) 明确说 HGO 是 mapping tool
- [Anarchy Tags.txt](C:\Users\raede\Desktop\dev\mapcreator\historic geographic overhaul\help\Anarchy Tags.txt) 对特殊无主区的类型设计非常有参考价值
- [City Renaming Events.txt](C:\Users\raede\Desktop\dev\mapcreator\historic geographic overhaul\help\City Renaming Events.txt) 提供多政权命名思路

---

## 4. 低价值或高风险目录

### 4.1 `events`

文件数量不多，但大部分是老式 HOI4 玩法事件。

问题在于：

- 当前项目不是 HOI4 事件模组编写器
- 这些事件多数是玩法流程，不是地图资源
- 引擎版本较老，不宜直接移植

但仍可少量参考：

- 命名方式
- 城市改名逻辑
- 特殊释放逻辑

### 4.2 `gfx`、`music`、`sound`

这部分体量很大，但当前阶段不是主线需求。

只有在以下情况下建议使用：

- 你准备做完整的 HGO 风格包装
- 你要把某个地块专题发展成完整 scenario artifact
- 你想补足旗帜、载入图、角色头像的表现层

否则它们容易制造上下文噪音。

---

## 5. 与当前项目的兼容性判断

### 5.1 已存在的良好接点

当前项目已经存在 HGO 接点：

- [tools/patch_tno_1962_bundle.py](C:\Users\raede\Desktop\dev\mapcreator\tools\patch_tno_1962_bundle.py) 中定义了 `HGO_ROOT`
- 同文件直接加载 donor context
- `audit` 中记录了 `hgo_donor_provinces` 作为 Atlantropa 几何来源

这说明当前项目并不需要重新决定“是否使用 HGO”，而是应该继续扩大使用范围。

### 5.2 主要兼容性问题

- HGO 的地理资产不是现代 vector 格式
- 存在多个尺寸不完全一致的光栅源文件
- `strategicregions` 和 `supplyareas` 内容明显不完整
- `descriptor.mod` 指向 HOI4 `1.9.3`，属于旧版本工程

---

## 6. 结论

HGO 中真正值得长期复用的，是它完成了大量“别人不会重复手工做第二次”的工作：

- 极细地块切分
- 特殊地块命名
- 宏大工程区占位
- 海峡与运河逻辑
- 微型实体和边缘地区组织方式

因此建议将 HGO 定位为：

`历史地理 donor + 特殊地块语义库 + 替代地理设计样本库`

而不是：

`可直接挪用的老地图模组`

# QA-HGO-003: 非亚特兰托帕地块与宏大工程参考报告

**日期**: 2026-03-08
**范围**: HGO 中除亚特兰托帕以外，仍与大地块设计、运河、陆桥、围海和替代地理直接相关的内容
**目标**: 为后续剧本选题和区域改造提供非地中海方向的参考库
**状态**: 分析完成

---

## Executive Summary

如果只把 HGO 用来服务亚特兰托帕，那么它的大量潜力会被浪费。HGO 还系统性地探索了多类“宏大地理工程”题材：

- 运河方案
- 陆桥方案
- 海峡改造
- 围海方案
- 替代海岸线
- 极地/边缘海实验

换句话说，HGO 不只是“一个 drained Mediterranean 模组”，而是一个“宏大地理工程草图库”。

---

## 1. 运河工程专题

在 [state_names_l_english.yml](C:\Users\raede\Desktop\dev\mapcreator\historic geographic overhaul\localisation\state_names_l_english.yml) 与 [history\states](C:\Users\raede\Desktop\dev\mapcreator\historic geographic overhaul\history\states) 中，已确认存在以下运河方向：

### 1.1 中美洲与美洲方向

- `Western Nicaragua Canal Site`
- `Nicaragua Canal Site A/B/C/D`
- `North Nicaragua Canal Site A-H`
- `Costa Rica Canal Site A/B/C`
- `David Canal Site`
- `Chepo Canal Site`
- `Darien Canal Site`
- `Uraba Canal Zone`
- `Tehuantepec Canal Site A/B`
- `Guatemala Canal Site A/B/C`
- `Honduras Canal Site A/B/C/D`

### 1.2 中东与西亚方向

- `West Salwa Canal Site`
- `East Salwa Canal Site`
- `Qattara Canal Site`
- `Qattara Atlantropa Canal Site`
- `West Suez Atlantropa Canal Site`
- `East Suez Atlantropa Canal Site`
- `Istanbul Canal Site`

### 1.3 东南亚方向

- `North Thai Canal Site`
- `Phuket Canal Site`
- `Central Thai Canal Site`
- `South Thai Canal Site A/B`

### 1.4 参考意义

这些运河专题非常适合用于未来的：

- 平行历史工程构想
- “假如某条运河建成”的世界线地图
- chokepoint 替换与重定向贸易/海军路径的专题场景

更重要的是，HGO 不是只给了概念名，而是把这些项目拆成了多个 site。说明作者已经在用“工程节点群”而不是“单点事件”来建模。

---

## 2. 陆桥与围海专题

### 2.1 已确认的陆桥或连接工程

- `Crimean Landbridge Site`
- `Baku-Bekdas Landbridge Site`
- `West Baku-Bekdas Landbridge Site`
- `Scottish-Northern-Irish Landbridge`
- `Ceylon Landbridge`
- `Ceylon Landbridge Site`
- `Torres Landbridge Site`
- `New Zealand Landbridge Site`
- `Corsica-Elba Atlantropa Landbridge Site`
- `Gibraltar Landbridge Site`
- `Marmaran Landbridge Site`

### 2.2 已确认的围海/封海专题

- `North Sea Dam Site`
- `West Norwegian North Sea Dam Site`
- `Outer Norwegian North Sea Dam Site`
- `East Shetland North Sea Dam Site`
- `West Shetland North Sea Dam Site`
- `North Orkney Dam Site`
- `Central Orkney Dam Site`
- `South Orkney Dam Site`
- `Channel Dam Site`
- `North Channel Dam Site`
- `South Channel Dam Site`
- `Bridge of the Horns Site`

### 2.3 参考意义

这一类资源对你未来的价值不在于直接照搬，而在于它们证明了一个很有用的思路：

- 一个大型替代地理工程最好拆成“坝点 + 位点 + 回填区 + 新岸线”，而不是只画最终形状。

这个思路完全可以迁移到：

- 北海围垦
- 黑海改造
- 波罗的海工程化
- 英伦海峡封堵
- 红海与波斯湾实验性改造

---

## 3. 黑海、里海、马尔马拉方向

HGO 在东欧到西亚过渡区也有不少很有意思的专题：

- `Crimean Gulf`
- `Crimean Black Sea`
- `East Crimean Reclamation Zone`
- `South Crimean Reclamation Zone`
- `West Crimean Reclamation Zone`
- `Marmara Sea`
- `North Marmara Sea`
- `South Marmara Sea`
- `Marmaran Drainage Area`
- `Marmaran Dam Site`
- `Lake Gemlik Site`
- `Lake Marmara Site`
- `Baku`
- `North Baku`
- `Baku-Bekdas Landbridge Site`

这些内容说明 HGO 对“封闭海域和内海改造”有明显兴趣，不只是地中海。

对你有两层参考价值：

1. 可供未来开新专题，如黑海/马尔马拉海/里海工程化剧本
2. 可用于推导“若地中海改造成立，其他近邻内海是否会被进一步工程化”

---

## 4. 英伦与北海方向

HGO 中存在一整批与英伦群岛和北海相关的工程位点：

- `Channel Tunnel Site`
- `North Channel Tunnel Site`
- `South Channel Tunnel Site`
- `Channel Dam Site`
- `Scottish Sea`
- `Scottish-Northern-Irish Landbridge`
- `North Sea Dam Site`
- 多个设得兰、奥克尼相关坝址

这说明 HGO 对“岛屿国家与大陆重新连接”的想象是系统性的。

对当前项目的潜在启发：

- 若以后做英伦专题，完全可以不只做国界和 controller，而是引入“海峡工程化状态”
- 这类专题特别适合用你当前的 `special_regions` + `water_regions` + `scenario manifest` 机制承载

---

## 5. 北极与边缘地区实验

HGO 的 [what am i doing\arctic rework](C:\Users\raede\Desktop\dev\mapcreator\historic geographic overhaul\what am i doing\arctic rework) 包含独立图层：

- `provinces.bmp`
- `heightmap.bmp`
- `rivers.bmp`
- `terrain.bmp`
- `world_normal.bmp`

虽然这不是完成度很高的成品，但它非常值得参考，因为它展示了：

- 作者把极地当成需要单独处理的空间
- 极地重作需要独立图层工程，而不是只在主图上局部修补

这对你未来若要做：

- 北极航道
- 冰盖退却
- 极地新区块
- 高纬海洋与陆架专题

会是非常直接的参考。

---

## 6. 结论

HGO 的非亚特兰托帕价值，主要体现在它已经替你做过一轮“宏大工程题材 brainstorming”，而且不是停留在概念层，而是落到了州级地块命名和工程节点层。

最值得后续继续跟进的非亚特兰托帕专题顺序建议：

1. 运河方案库
2. 陆桥与围海方案库
3. 黑海/马尔马拉/里海替代地理
4. 英吉利海峡与北海工程化
5. 北极与高纬实验区

如果未来你想把 `mapcreator` 从“地图查看器”进一步推向“替代地理 scenario 设计平台”，这些内容会非常关键。

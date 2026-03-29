# 印度工业矿产、能源设施、工业区研究总览

日期：2026-03-28

## 1. 总体结论

印度这三条线里，`industrial_zones` 最适合先试点，`mineral_resources` 的全国权威骨架很强但开放与产品化摩擦较大，`energy_facilities` 则是官方平台存在但子类现势和点表整齐度不一，因此最稳的整体判断是：`工业区最贴题，矿产次之，能源设施更适合作全国骨架 + 分子类补强`。

## 2. 三条线总体成熟度判断

| 线别 | 成熟度判断 | 现在能不能直接落盘 | 核心原因 |
|---|---|---|---|
| 工业区 | 高 | 可以 | `India Industrial Land Bank` 已经提供全国工业园区/地块平台，`IPRS` 又能做全国园区筛选与重要度补强，这条线与“真实工业园区/工業用地”最贴题 |
| 工业矿产 | 中高 | 可以，但要写清中央 + 邦级结构 | `IBM NMI` 与 `GSI/NGDR` 组成全国权威资源骨架，但开放获取和产品化友好度不如日本，需要接受“全国骨架 + 邦级补强” |
| 能源设施 | 中 | 可以，但要写清子类差异 | 官方的 `Energy Map of India` 与 `NPP/CEA` 很强，但更像全国能源平台与电力台账；如果要求完整、现势统一的点层，还得分子类补点 |

## 3. 哪条线最适合先试点

最适合先试点的是 `industrial_zones`。

原因很直接：

1. 它是三条线里最贴近当前产品目标的一条。
2. 全国层已经有 `India Industrial Land Bank` 这样的官方平台。
3. `IPRS` 能把“哪些园区更重要”这件事也一并收口。
4. 相比之下，矿产更专业、能源更碎，工业区是最容易先做出业务价值的一条。

## 4. 和日本最明显的不同

印度和日本最明显的不同，是印度这三条线里最强的不是“传统国土专题包”，而是 `国家平台型源`。

- 日本更像“专题地理数据包 + 产品化映射”
- 印度更像“国家平台 + 业务台账 + 邦级补强”

这会直接带来两种不同的实施感受：

- 日本更像下载、清洗、映射
- 印度更像平台抽取、字段收口、再做补强

## 5. 哪些地方必须降级到非官方但可信公开源

### 5.1 必须接受降级的地方

- `energy_facilities`：如果要求把电力之外的炼厂、LNG、POL 等子类一起做成统一现势点层，现实上需要 `Tier C` 补点。
- `mineral_resources`：如果要求把中央层进一步补成更细致的矿床点层或具体项目点位，往往也要接受邦级之外的公开补源。

### 5.2 当前不必先降级的地方

- `industrial_zones` 首版不必先降级，因为 `IILB + IPRS` 已经足够构成强官方骨架。
- `mineral_resources` 的全国骨架也不必先退到协作源。

## 6. 可直接承接到仓库架构的判断

### 6.1 工业矿产

适合承接为 `mineral_resources` 独立资源包，但更接近 `全国资源骨架 + 邦级细化`。

### 6.2 能源设施

适合承接为 `energy_facilities` 点层，但建议 `power-first`，其他子类后加。

### 6.3 工业区

非常适合承接为 `industrial_zones` 面层，且这条线最接近可直接进入实现阶段。

## 7. 风险判断

1. 最大风险是把平台型官方源误当成已经整理好的离线成品包。
2. 第二个风险是为了追求“一套源打天下”而不愿意接受中央 + 邦级补强。
3. 第三个风险是把能源平台里的不同子类当成同等现势、同等完备。
4. 第四个风险是把矿产资源分布误写成现役矿山经营体系。

## 8. 下一步建议

1. 先做印度 `industrial_zones`。
2. 第二条线做 `mineral_resources`，但明确写成“全国骨架 + 邦级补强”。
3. `energy_facilities` 先按 `power-first` 收口，不急着一次性并进所有油气下游设施。

## 9. 本轮使用的关键来源

- Tier A: [India Industrial Land Bank / NSWS](https://www.nsws.gov.in/)
- Tier A: [IPRS 3.0](https://apps.dpiit.gov.in/iprs3)
- Tier A: [Indian Bureau of Mines - National Mineral Inventory](https://ibm.gov.in/IBMPortal/pages/National_Mineral_Inventory)
- Tier A: [National Geoscience Data Repository](https://geodataindia.gov.in/NGDR/welcomepage)
- Tier A: [Energy Map of India](https://www.vedas.sac.gov.in/energymap/)
- Tier A: [National Power Portal](https://www.npp.gov.in/aboutus)

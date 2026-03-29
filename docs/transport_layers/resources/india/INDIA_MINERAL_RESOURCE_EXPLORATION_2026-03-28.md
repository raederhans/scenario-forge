# 印度工业矿产专题研究归档

日期：2026-03-28

## 1. 一句话结论

印度工业矿产这条线可以做，但最稳的写法不是“有一份现成全国开放点层主包”，而是 `官方全国资源骨架 + 邦级补强`：全国层最强的是 Indian Bureau of Mines 的 `National Mineral Inventory (NMI)` 与 Geological Survey of India 的 `NGDR`，但它们在开放程度、下载形态和直接产品化友好度上都不如日本，需要接受“全国骨架成立、落地仍要补邦级或降级源”的现实。

## 2. 研究边界

- 按 `矿床/资源分布` 研究
- 不强求现役矿山
- 如出现中央 + 邦级碎片化，按“全国骨架 + 邦级补强”处理

## 3. 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 | 许可或使用边界 | Tier | 适不适合作为主源 | 判断 |
|---|---|---|---|---|---|---|---|
| [Indian Bureau of Mines - National Mineral Inventory](https://ibm.gov.in/IBMPortal/pages/National_Mineral_Inventory) | 印度全国 | 点/块位置信息为主，配套资源与属性 | 页面显示 `最终更新时间 10/03/2026` | 官方权威，但带订购/收费与获取门槛，不是即拿即用的开放下载主源 | Tier A | 是，作为全国骨架 | 对“矿床/资源分布”最贴题，但开放可得性不如日本 |
| [National Geoscience Data Repository (NGDR)](https://geodataindia.gov.in/NGDR/welcomepage) | 印度全国 | GIS 兼容多类地质、地球化学、勘查数据 | 门户当前在线，2026-03 可访问 | 官方国家级门户，但数据抽取与使用体验更像专业平台，不是轻量成品包 | Tier A | 是，作全国地学骨架与补强 | 适合支撑矿种、勘查区和资源分布判断 |
| [Website of NGDR - National Portal of India](https://www.india.gov.in/category/infrastructure-industries/subcategory/mining/details/website-of-national-geoscience-data-repository-ngdr) | 印度全国 | 门户说明 | 在线 | 官方门户索引页，不是数据本体 | Tier A | 否，作佐证 | 用于确认 NGDR 的官方归属与用途边界 |
| [National Mineral Inventory - An Overview](https://www.ibm.gov.in/writereaddata/files/1696339081651c14891a043Chapter9.pdf) | 印度全国，按州/区可分解 | 统计与资源分布表 | 页面显示近月可访问，内容覆盖 `as on 01.04.2020` 等资源口径 | 官方概览 PDF，适合资源量级和空间分布判断，不是 GIS 成品层 | Tier A | 否，作后备与核对 | 很适合把全国骨架收口到矿种和州/区尺度 |
| 邦级地质与矿业主管部门门户 | 各邦 | 点、块、图件或目录不一 | 不一 | 官方但高度碎片化 | Tier B | 否，作补强 | 当中央层不够细时，必须接受“邦级补强” |
| OSM / 公开学术与行业目录 | 局部或全国 | 点/面不一 | 不一 | 必须显式降级使用 | Tier C | 否，作降级补缺 | 只在中央与邦级源都不足时使用 |

## 4. 主源 / 后备源 / 排除项

### 4.1 主源

- `IBM National Mineral Inventory`
- `GSI / NGDR`

最稳的理解方式是：

- `NMI` 负责全国矿床/资源清单与属性骨架
- `NGDR` 负责全国地学与勘查空间骨架

这不是一份像日本那样直接可以拿来渲染的轻量点层主包，但已经足够支撑“印度全国资源骨架成立”。

### 4.2 后备源

- `NMI overview` 一类官方资源概览 PDF
- 邦级地质与矿业部门门户

如果需要把全国层进一步细化到具体邦、具体矿带或具体资源块，现实上必须接受邦级补强。

### 4.3 排除项

- 现役矿山经营状态清单
- 需要付费或订购后才能获取但又被误写成“开放即用”的完整主源
- 纯行业新闻、企业宣传材料

## 5. 与现有仓库架构的承接判断

印度矿产最适合继续承接为 `mineral_resources` 独立资源包，但要接受它更像 `全国资源骨架 + 地方细化`，而不是一张整齐的纯点层表。

最稳的架构判断是：

- 全国层先承接 `deposit / block / exploration area` 语义
- 如果产品端首版仍坚持点层，再在构建期派生 `representative_points`
- 不要在研究层面把印度的官方资源区块语义硬压成“现成全国点层”

## 6. 与日本最明显的不同

日本矿产试点更像“先拿到较贴题的全国资源点/位置数据，再做产品化收口”；印度更像“全国权威资源骨架很强，但落地方式更专业、更平台化，也更依赖中央 + 邦级拼接”。

简单说：

- 日本更像专题包
- 印度更像权威资源平台 + 分层获取

## 7. 风险与下一步建议

### 7.1 风险

1. 最大风险是把 `NMI` 这种带获取门槛的官方权威源，误说成“开放即下即用”的主层。
2. 第二个风险是把 `NGDR` 这种专业平台，误当成已经清洗好的产品层。
3. 第三个风险是把矿床/资源分布研究误读成现役矿山经营图层。

### 7.2 下一步建议

1. 首版印度 `mineral_resources` 先按“全国资源骨架成立”写结论，不强装成完美开放主包。
2. 如果后续要真正做出全国点层，优先走 `NMI/NGDR + 邦级补强`，而不是一开始就退到协作源。
3. 只在中央和邦级官方源都明显不足时，才把 Tier C 拿来做局部补缺。

## 8. 关键来源列表

- Tier A: [Indian Bureau of Mines - National Mineral Inventory](https://ibm.gov.in/IBMPortal/pages/National_Mineral_Inventory)
- Tier A: [National Geoscience Data Repository](https://geodataindia.gov.in/NGDR/welcomepage)
- Tier A: [Website of NGDR - National Portal of India](https://www.india.gov.in/category/infrastructure-industries/subcategory/mining/details/website-of-national-geoscience-data-repository-ngdr)
- Tier A: [National Mineral Inventory - An Overview](https://www.ibm.gov.in/writereaddata/files/1696339081651c14891a043Chapter9.pdf)

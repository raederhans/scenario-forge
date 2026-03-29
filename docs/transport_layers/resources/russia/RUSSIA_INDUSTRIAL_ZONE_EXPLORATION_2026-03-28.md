# 俄罗斯工业区研究归档

日期：2026-03-28

## 1. 一句话结论

俄罗斯 `industrial_zones` 这条线可以做，但当前最稳的写法不是“全国真实工业园区 polygon 官方主源已经存在”，而是：`官方/准官方命名园区名录较强，统一空间几何较弱`。因此首版更适合收敛成 `园区名录主层 + 几何补充层`。

## 2. 研究边界

- 研究对象是 `真实园区 / 工业园 / 技术园 / 特殊经济区`
- 不先用规划工业分区替代
- 不把普通工业地类、一般商业开发区和招商概念词混入主层
- 如果没有官方 polygon，也不能伪装成全国真实园区边界主源

## 3. 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 | 许可/使用边界 | Tier | 适不适合作为主源 | 判断 |
|---|---|---|---|---|---|---|---|
| [GISP - Реестр технопарков](https://gisp.gov.ru/gisip/reg_tech_parks) | 俄罗斯全国技术园区体系 | 以名录为主，带园区级对象信息 | 页面显示 `Дата формирования: 20.03.2026` | 官方工业信息系统入口，适合名录与属性判断，不是统一 polygon 下载包 | Tier A | 是，但只适合命名园区主层 | 这是当前最稳的官方全国园区对象入口之一 |
| [Association of Industrial Parks Russia - National portal](https://indparks.ru/) | 俄罗斯全国工业园、SEZ、产业基础设施 | 名录、地图与园区页面 | 持续更新 | 行业国家级公共门户，适合作 Tier B 主补充层 | Tier B | 是，适合作园区名录主补充层 | 对工业园区本体很对题，但不是官方主源 |
| [AIP Russia - Overview of Industrial Parks and SEZ in Russia](https://indparks.ru/upload/iblock/3ac/Overview_Industrial_parks_SEZ_Russia_2022_%20AIP.pdf) | 俄罗斯全国 | 名录、统计、区域分布 | 文件近期重新发布 | 准官方行业报告，可用于核对园区范围与区域分布 | Tier B | 否，适合作补强 | 对欧洲俄罗斯与远东的园区密度对比有价值 |
| 地区招商门户与园区官网 | 区域级 | 点、面、地址不一 | 各地不同 | 可公开访问，但口径不一 | Tier C | 否 | 只适合补几何、补边界、补联系信息 |
| [OpenStreetMap / Geofabrik Russia](https://download.geofabrik.de/russia.html) | 俄罗斯全国 | 点、线、面 | 频繁更新 | ODbL；衍生使用需遵守 OSM 规则 | Tier C | 否，除非补边界 | 只能作为园区边界或位置补充，不应决定“哪些算园区” |

## 4. 主源 / 后备源 / 排除项

### 4.1 主源

- 官方命名园区主层：`GISP 技术园/园区体系`
- 准官方主补充：`AIP Russia` 的工业园和特区目录

### 4.2 欧洲俄罗斯与非欧洲俄罗斯

- 欧洲俄罗斯：园区名录、工业园和特区对象最密集，官方和准官方公开源都更强。
- 非欧洲俄罗斯：园区数量更少，公开信息更分散，更容易依赖地区门户和园区官网补位置与边界，因此更容易降到 Tier C。
- 这条线在东部的弱点主要是“几何与对象齐全度”，不是完全没有园区对象。

### 4.3 后备源

- 地区招商门户与园区官网：补地址、边界、运营主体
- `OSM / Geofabrik Russia`：只补边界和位置，不决定主名单

### 4.4 排除项

- 规划工业分区
- 一般城市工业用地分类
- 把没有实体园区运营主体的政策区域当成真实园区主层

## 5. 与现有仓库架构的承接判断

俄罗斯工业区不适合直接假设有全国 polygon 主源。

最稳的接法是：

- `industrial_zones_registry`：命名园区主层
- `industrial_zones_geometry_patch`：几何补充层

如果后续产品必须显示面状边界，也应明确写成“名录层 + 边界补充层”，而不是伪装成一张统一来源的工业用地面层。

## 6. 与日本最明显的不同

- 日本更接近“真实工业用地/工业区专题层”。
- 俄罗斯更接近“命名园区、技术园、特区体系比较强，但统一几何弱”。
- 所以俄罗斯这条线的难点不是园区对象不存在，而是 polygon 主源不整齐。

## 7. 风险与下一步建议

### 7.1 风险

1. 最大风险是把技术园、工业园、特区和普通工业用地混成一层。
2. 第二个风险是把名录页误写成真实园区边界主源。
3. 第三个风险是把欧洲俄罗斯的园区密度外推到远东和西伯利亚。

### 7.2 下一步建议

1. 首版先把俄罗斯工业区明确写成 `命名园区层`，不要一开始追求全国统一 polygon。
2. 先覆盖欧洲俄罗斯核心工业带，再把东部园区作为放宽覆盖区。
3. 如后续需要面状显示，再按园区逐个补边界，而不是先发明代理地类层。

## 8. 关键来源列表

- Tier A: [GISP - Реестр технопарков](https://gisp.gov.ru/gisip/reg_tech_parks)
- Tier B: [Association of Industrial Parks Russia - National portal](https://indparks.ru/)
- Tier B: [AIP Russia - Overview of Industrial Parks and SEZ in Russia](https://indparks.ru/upload/iblock/3ac/Overview_Industrial_parks_SEZ_Russia_2022_%20AIP.pdf)
- Tier C: [Geofabrik Russia](https://download.geofabrik.de/russia.html)

# 人口空间图层

入口：编辑器「图层 → 专题 → 人口空间分布」。默认关闭。启用后可选择「地块人口密度」或「连续人口热力」，调整不透明度、查询地块，并按剧本国家或当前选区汇总。人口着色、国家指标着色和战略数值着色互斥。

## 数据及精度

使用欧盟委员会联合研究中心的 **GHS-POP R2023A，2020 年、1 公里、World Mollweide（ESRI:54009）** 全球人口栅格。数值是模型估计的常住人口数，每像元单位为人，NoData 为 -200。源文件、下载元数据、GeoTIFF 头和 SHA256 固定在产物 manifest 与 source ledger；原始 ZIP／GeoTIFF 保存在 `.runtime/source-cache/thematic/ghsl/`。

1 公里适合世界尺度分布展示。小于像元的地块按照相交比例估算，不能据此判断街区或单栋建筑人口。现代世界、HOI4 1936、HOI4 1939 和 TNO 1962 都使用同一 **2020 年人口分布**；历史场景明确提示这不是剧本年代的人口重建。

来源与许可：[GHSL GHS-POP 产品说明](https://human-settlement.emergency.copernicus.eu/ghs_pop2023.php)、[JRC 数据集 DOI](https://doi.org/10.2905/2FF68A52-5B5B-4A22-8F40-C41DA8332CFE)，CC BY 4.0。地图图例和导出保留年份、来源署名。

## 地块统计

统计输入是当前场景 manifest 指向的**完整** `runtime_topology_url` 的 `political` 对象，按稳定 feature ID 输出。数据绑定该文件实际 SHA256，拒绝过期几何版本；不使用当前视野、coarse/detail 混合数据或国家平均人口密度推算地块人口。

处理流程为：解码完整几何 → 投影至等面积 Mollweide → 修复统计副本 → 扣除 Natural Earth 已映射湖泊 → 切分重叠区域 → exactextract 对像元做面积比例积分。修复与 1 毫米几何计算精度只作用于统计副本，显示边界不变，修复数量和面积变化写入审计。

源边界存在重叠，同一处由 N 个地块覆盖时，该处人口和面积各分配 1/N。这样选区／国家可以直接去重加总，不重复计算重叠人口。`overlap_fraction` 暴露受影响比例。人口密度 = 分配人口 ÷ 分配的建模陆地面积；面积口径不等于高精度海岸土地覆盖，未映射水体和概化海岸仍有误差。

保存 `population`、`land_area_km2`、`density`、`coverage_fraction`、`overlap_fraction`、`source_epoch` 和 `status`。真实零人口是有效值；缺失、无效几何和架空新陆地用 null。部分覆盖保留已知人数，但不报告完整地块或汇总密度。接近 1 的覆盖率只在已验证的数值容差内归一；真正 NoData 不补成零。

国家汇总使用只读场景 baseline 成员，颜色编辑不会改变归属或人口。选区汇总按 ID 去重，和缩放无关。没有可用数值的地区不会被误算成零人口国家。TNO Atlantropa 的陆地／浅滩为未估计状态，水面不适用，热力裁除虚构陆地；后续历史或架空人口应以独立、有来源的情景数据接入。

## 连续热力及导出

同一源栅格按人口数求和生成 50 公里 overview 和 5 公里 detail，面积同步求和，再计算密度。热力面积分母是**有效源像元面积**，与扣湖后政治地块面积的口径不同，图例明确区分。不会平均已着色像素或模糊国家均值，也不将 NoData 平滑进海洋。

热力栅格默认先加载约 2 MB 的 overview，地块统计另行加载；放大时按视野请求最多 32 块 detail，缓存最多 64 块。全部 detail 约 133 MB，由浏览器按需获取。地图通过当前投影、缩放、DPR 反算源栅格坐标，裁剪至场景陆地。颜色阈值固定为 1、10、50、200、1,000、5,000 人／km²，移动和缩放不重新分级。

地图／颜色层导出等待所需统计和当前视野细节加载完成；加载失败阻止导出，文字层单独导出不需要等待人口。PNG 带固定色阶、精度、年份和历史参考说明。CSV 包含全部地块原始统计字段、只读国家归属、数据版本与几何版本，不丢弃 null 状态。

## 重建与检查

安装仓库 `requirements.txt`（含固定 `exactextract==0.3.0`）后运行：

```powershell
npm run build:population-spatial
```

该命令下载／复用经过校验的官方源文件，构建全部场景与栅格，登记 runtime assets、构建 outputs、来源账本并重新生成数据目录。下载支持绑定源身份的分片续传。入口 manifest 在完整构建与守恒审计之后写出。已有构建失败的中间文件不能被声明为新版本 ready。

相关检查：

```powershell
npm run test:node:population-spatial
npm run test:py:population-spatial
python tools/data_health.py
python -m unittest tests.test_data_catalog_contract
```

核心代码分别为 `map_builder/population_spatial.py`、`js/core/population_spatial_data.js`、`js/core/population_spatial_runtime.js`、`js/core/population_spatial_view_model.js`、`js/core/renderer/population_heatmap_render_owner.js` 和 `js/ui/toolbar/population_spatial_owner.js`。产物位于 `data/thematic_layers/population/ghsl_population_2020_v1/`，详细守恒残差、覆盖状态和几何处理证据见其中 `audit.json`。

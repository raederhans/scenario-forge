# HGO 参考报告目录

**日期**: 2026-03-08
**主题**: `historic geographic overhaul` 资源梳理、复用评估与后续开发指引
**状态**: 初版完成，可继续迭代

---

## 目录说明

本目录用于沉淀对 [historic geographic overhaul](C:\Users\raede\Desktop\dev\mapcreator\historic geographic overhaul) 的系统性研究结果。目标不是复述素材清单，而是把它拆解成可执行的开发参考，便于后续在 `mapcreator` 中继续推进地中海、亚特兰托帕以及其他大型地块改造方案。

本次共整理 5 份报告：

1. `001_hgo_resource_inventory_and_value_assessment.md`
   全量资源盘点，判断各类目录的价值和复用方式。
2. `002_atlantropa_and_mediterranean_reuse_report.md`
   聚焦亚特兰托帕与地中海，梳理当前已接入内容和仍可榨取的资源。
3. `003_non_atlantropa_landblock_and_macroengineering_reference.md`
   聚焦非亚特兰托帕的大地块、运河、陆桥、围海与替代地理方案。
4. `004_special_zones_microstates_and_naming_reference.md`
   聚焦特殊区、无主地块、微型实体、cosmetic 命名与剧本增厚资源。
5. `005_hgo_integration_backlog_and_next_steps.md`
   将前述发现转化为接入建议、优先级和后续执行清单。

---

## 核心结论

- HGO 更像一个老版本 HOI4 的地理工程资料库，而不是普通玩法模组。
- 对当前项目最有价值的内容，不是整包地图，而是其已经完成的地块切分、特殊区设计、命名体系和海峡/运河逻辑。
- 当前项目已经在 [tools/patch_tno_1962_bundle.py](C:\Users\raede\Desktop\dev\mapcreator\tools\patch_tno_1962_bundle.py) 中将 HGO 作为亚特兰托帕 donor 使用，但仍有大量语义层和命名层尚未接入。
- 除亚特兰托帕外，HGO 还提供了可供参考的运河方案、陆桥工程、围海地块、特殊无人区与微型地区切分方法。

---

## 建议用法

- 把本目录当成设计手册，而不是一次性的 QA 结论。
- 之后每次从 HGO 正式提取一批资源时，可以在对应报告下追加“已接入状态”和“剩余待接入项”。
- 若后续决定自动化抽取 HGO 目录中的特定资源，建议再补一份机器可读索引，例如 `data/hgo_catalogs/*.json`。

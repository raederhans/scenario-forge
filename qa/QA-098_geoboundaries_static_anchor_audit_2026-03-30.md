# QA-098 geoBoundaries Static Anchor Audit

日期：2026-03-30

## 摘要

- 第二阶段只治理 geoBoundaries 上游入口。
- 项目当前实际使用 17 份 geoBoundaries 数据。
- 这 17 份本地缓存与 geoBoundaries 官方 API `gjDownloadURL` 当前静态文件逐个做了 SHA-256 对照，全部一致。
- 因此本轮可以把所有 geoBoundaries 来源从 `raw/main`、`media/.../main`、`@main` 迁到官方静态锚点，而不引入数据内容变化。

## 冻结规则

- 配置中的 geoBoundaries `url` 必须等于官方 API 返回的 `gjDownloadURL`
- geoBoundaries `fallback_urls` 必须清空
- 本地缓存 SHA-256 必须与官方 `gjDownloadURL` 完全一致
- 不接受 geometry drift，不接受 feature count 变化，不接受下游产物漂移

## 对照结果

| Source | boundaryID | buildDate | 本地 SHA-256 = 官方静态 SHA-256 | 冻结 URL |
|---|---|---|---|---|
| CHN ADM2 | `CHN-ADM2-17275852` | `Dec 12, 2023` | 是 | `https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/CHN/ADM2/geoBoundaries-CHN-ADM2.geojson` |
| CZE ADM2 | `CZE-ADM2-57006924` | `Dec 12, 2023` | 是 | `https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/CZE/ADM2/geoBoundaries-CZE-ADM2.geojson` |
| DNK ADM2 | `DNK-ADM2-71786716` | `Dec 12, 2023` | 是 | `https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/DNK/ADM2/geoBoundaries-DNK-ADM2.geojson` |
| SVK ADM2 | `SVK-ADM2-56367889` | `Dec 12, 2023` | 是 | `https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/SVK/ADM2/geoBoundaries-SVK-ADM2.geojson` |
| RUS ADM2 | `RUS-ADM2-50074027` | `Dec 12, 2023` | 是 | `https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/RUS/ADM2/geoBoundaries-RUS-ADM2.geojson` |
| UKR ADM2 | `UKR-ADM2-74538382` | `Dec 12, 2023` | 是 | `https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/UKR/ADM2/geoBoundaries-UKR-ADM2.geojson` |
| BLR ADM2 | `BLR-ADM2-67162791` | `Dec 12, 2023` | 是 | `https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/BLR/ADM2/geoBoundaries-BLR-ADM2.geojson` |
| IND ADM2 | `IND-ADM2-76128533` | `Dec 12, 2023` | 是 | `https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/IND/ADM2/geoBoundaries-IND-ADM2.geojson` |
| MEX ADM2 | `MEX-ADM2-50627088` | `Dec 12, 2023` | 是 | `https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/MEX/ADM2/geoBoundaries-MEX-ADM2.geojson` |
| BIH ADM1 | `BIH-ADM1-54001226` | `Feb 21, 2024` | 是 | `https://github.com/wmgeolab/geoBoundaries/raw/90a1d52/releaseData/gbOpen/BIH/ADM1/geoBoundaries-BIH-ADM1.geojson` |
| IDN ADM1 | `IDN-ADM1-65028918` | `Dec 12, 2023` | 是 | `https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/IDN/ADM1/geoBoundaries-IDN-ADM1.geojson` |
| BFA ADM1 | `BFA-ADM1-92566538` | `Dec 12, 2023` | 是 | `https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/BFA/ADM1/geoBoundaries-BFA-ADM1.geojson` |
| GIN ADM1 | `GIN-ADM1-385441` | `Dec 12, 2023` | 是 | `https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/GIN/ADM1/geoBoundaries-GIN-ADM1.geojson` |
| CIV ADM1 | `CIV-ADM1-83157122` | `Dec 12, 2023` | 是 | `https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/CIV/ADM1/geoBoundaries-CIV-ADM1.geojson` |
| MWI ADM1 | `MWI-ADM1-82672581` | `Dec 12, 2023` | 是 | `https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/MWI/ADM1/geoBoundaries-MWI-ADM1.geojson` |
| UGA ADM1 | `UGA-ADM1-17295835` | `Dec 12, 2023` | 是 | `https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/UGA/ADM1/geoBoundaries-UGA-ADM1.geojson` |
| SOM ADM1 | `SOM-ADM1-83879307` | `Dec 12, 2023` | 是 | `https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/SOM/ADM1/geoBoundaries-SOM-ADM1.geojson` |

## 结论

- 这批 geoBoundaries 数据当前可以整批冻结到官方静态锚点。
- 本轮治理的风险点不在数据内容，而在配置是否仍残留 `main` 分支入口，以及 sidecar 是否补齐。
- 下一步执行时，应以 `tools/freeze_geoboundaries_sources.py` 和 `tools/smoke_check_source_fetch.py --group geoboundaries_phase2` 作为硬门禁。

# River pack 下载传输格式

运行时下载使用 `transportVersion: 1`、`kind: "river-paint-indexed-coordinates"` 的 JSON wrapper。`coordinates` 是共享的精确 `[longitude, latitude]` 坐标表；`pack` 保留 schema 1 的字段和记录顺序，仅将每个 Polygon / MultiPolygon 的 `geometry.coordinates` 中的点替换为从零开始的坐标表索引。父级原始几何、cell 几何及 support 的两种几何均使用同一张表。

编码不舍入、不量化、不调整环顺序，不改 pack ID 或几何指纹。坐标按首次出现顺序去重，使用 binary64 值作为 key，保留正负零。Python JSON 数字经浏览器解析后仍是原有 JS Number；真实 wave3 的跨语言测试逐点比较完整解码结果，并核对规范化后的完整包及 canonical SHA 认证。

实测 wave3：原始包 1,993,389 UTF-8 字节；传输包 1,193,430 字节，减少 799,959 字节（40.13%）。原始 48,606 个点引用映射到 18,993 个唯一点。大小包含结尾 LF，不包含 Windows checkout 可能加入的 CR。

编码入口：

```powershell
python -m tools.river_partitions.compact_transport INPUT.json OUTPUT.transport.json
```

Python API 为 `encode_transport(pack)` / `decode_transport(value)`，JS API 为 `decodeRiverPartitionTransport(value)`。工具输出文件必须与 canonical 输入路径不同。生成器、canonical 数据及 manifest 的认证摘要继续以完整 schema 1 包为准，传输文件是独立下载资产。

loader 保留既有 2,000,000 字符下载预算，先解析 JSON、完整预检 wrapper，然后展开坐标并调用 `verifyApprovedRiverPack`。预检同时约束坐标表最多 250,000 点、所有几何累计最多 250,000 个引用（包含父级及 support 两种几何）、512 个 parent、每 parent 128 个 cell、总计 8,192 个 cell 和 2,048 个 support。几何嵌套只接受 Polygon / MultiPolygon 的固定深度，环至少四个引用。每个索引必须是非负安全整数且落在表内，所有坐标必须有限且满足现有经纬度范围。检查全部引用后才分配展开的坐标数组，避免小坐标表重复引用突破累计预算。未知字段、版本、带继承或 accessor 的记录、稀疏或自定义数组均拒绝。

解码仅用于下载入口。完整包规范化、几何 / 覆盖约束及完整 canonical SHA 仍由现有认证执行；wrapper 自身不能替代认证。项目保存继续输出自包含 schema 1 完整几何，项目导入不接受 wrapper。旧 pilot / wave2 / wave3 完整包的下载与保存导入继续使用原契约。

目标验证：`node --test tests/river_pack_transport.test.mjs` 与 `python -B -m unittest tests.test_river_compact_transport`。覆盖真实 fixture 精确往返、原包认证、元数据及保持面积的索引篡改、旧包 / 保存兼容性、非法引用及坐标、原型字段 / accessor，以及各个容量边界和重复引用放大。

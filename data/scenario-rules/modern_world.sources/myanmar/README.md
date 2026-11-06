# 缅甸镇区与驻地，2026-01-01

使用 geoBoundaries gbOpen MMR ADM3，固定提交 9469f09，2019 年镇区边界，330 个 Township。许可 CC BY 4.0；署名 The Myanmar Analytics Project / USAID、geoBoundaries。元数据保存在 geoBoundaries-MMR-ADM3-metaData.json；固定 URL、原始快照 SHA-256 见 provenance.json。完整快照未裁剪，不引入其他几何源。此记录不声称已核查间接上游完整采集链。

unit_selection.json 固定实际 shapeName / shapeID：佤邦五镇区 Pangsang、Mongmao、Pangwaun、Narphan、Hopang；果敢 Laukkaing、Konkyan。排除 Matman、Lashio 城市、Kunlong、Hseni 及南佤。

若开 Sittwe、Kyaukpyu、Munaung 镇区留 MM，余区 ARK；三镇区整体保留属于行政近似，不能解读为军方控制全部乡村。补缝 MM_PRIMARY_GAP_10 仅与 Pauktaw 相交（0.003104916660953704 平方度），归 ARK。钦邦 Hakha、Tedim 留 MM，Paletwa 归 ARK，其余六镇区及数据边界余区归 CHR；混合控制按多数近似。法兰是合并表达的钦族抵抗力量代表驻地。

克钦军方据点采用城市周边人工近似轮廓，包含 Myitkyina、Waingmaw、Bhamo 残余驻军、Putao、Machanbaw、Nawngmun、Khaunglanhpu、Tanai、Mohnyin、Mogaung。禁止将整个镇区回划；其余乡村沿用第一批 KIO 多数近似，低置信，不声称完整前线。八莫仅表达残余据点，不代表全城。

控制权依据（沿用批准方案，本次离线未重新访问）：
- https://english.shannews.org/archives/28788
- https://myanmar-now.org/en/news/kokang-army-blocks-sham-elections-outside-lashio/
- https://dmediag.com/news/elsufusthrke.html
- https://www.chinhumanrights.org/press-release-sham-election-collapses-on-day-one-junta-loses-control-of-chin-state-as-boycotts-violence-and-cancellations-derail-sham-polls/
- https://english.dvb.no/fight-over-control-of-bhamo-between-kachin-independence-army-and-military-enters-its-second-year/
- https://eng.mizzima.com/2026/01/04/29897

驻地定位采用邦康 (99.18,22.17)、拉咱 (97.56,24.76)、妙乌 (93.194,20.596)、法兰 (93.68,22.91)。前两者落在项目底图缝隙，按批准的 ≤0.02° 规则就近吸附到底图，保留原始坐标和吸附距离见 capital_locations.json；后两者无需吸附。驻地为同名城市的制图表达，不改变 canonical 国界。镇区正负样本采用 ADM3 与母地块交集的 representative_point，另验吸附后首都位于正确势力地块内。

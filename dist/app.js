const STORAGE_KEY = "scenario_forge_landing_lang";

const translations = {
  en: {
    skipLink: "Skip to content",
    navWorks: "Outputs",
    navWorkflow: "Workflow",
    navProduct: "Product",
    navFeatures: "Capabilities",
    navData: "Evidence",
    navFaq: "FAQ",
    navRoadmap: "In progress",
    headerGithub: "GitHub",
    headerOpenApp: "Open demo",
    heroEyebrow: "Scenario-first political map workbench",
    heroTitle: "Shape a world state.",
    heroTitleAccent: "Export the map that tells it.",
    heroBody:
      "Start with a public world state, shape political ownership, add geographic context, and export a presentation-ready map.",
    heroPrimaryCta: "Open demo",
    heroSecondaryCta: "View three real outputs",
    productPreviewLabel: "Scenario Forge generated cartography preview",
    productStageLabel: "Scenario Forge / Generated atlas",
    heroChipsLabel: "Hero scenario style",
    heroMapHudOne: "Political baseline",
    heroMapHudTwo: "Routes + lights",
    brandHomeLabel: "Scenario Forge home",
    primaryNavLabel: "Primary navigation",
    languageSwitcherLabel: "Language switcher",
    statsLabel: "Scenario Forge product statistics",
    productPreviewAlt:
      "Generated Scenario Forge HOI4 1936 political map with borders and capital labels.",
    heroAltBlank: "Generated neutral blank Europe map with land, water, borders, and grid lines.",
    heroAltHoi41936: "Generated Scenario Forge HOI4 1936 Europe political map with capital labels.",
    heroAltHoi41939: "Generated Scenario Forge HOI4 1939 Europe political map with capital labels.",
    heroAltTno1962:
      "Generated Scenario Forge TNO 1962 political ownership crop of Europe with capital markers; Atlantropa overlay omitted.",
    workOneAlt:
      "Generated TNO 1962 Atlantropa Mediterranean map with political context, salt basins, shoals, and water regions.",
    workTwoAlt: "Generated HOI4 1936 and 1939 Central Europe comparison map.",
    workThreeAlt: "Generated Central Japan local transport atlas with roads, rail, urban anchors, stations, terrain, and rivers.",
    chipBlank: "Blank",
    chipHoi41936: "HOI4 1936",
    chipHoi41939: "HOI4 1939",
    chipTno1962: "TNO 1962 · political crop",
    statScenarios: "public scenario baselines · current demo",
    statCities: "source city records · global input",
    statAliases: "city alias records · global lookup input",
    statCatalog: "cataloged assets · public project data",
    statJapan: "road + rail source features · Japan preview input",
    worksEyebrow: "Sample runs",
    worksTitle: "Three traceable outputs, paired with editable samples.",
    worksBody:
      "Each published map pairs a visible result with an editable sample, project JSON, evidence details, and an explicit scope.",
    sampleFiltersLabel: "Sample run filters",
    sampleRunsPanelLabel: "Sample run gallery",
    sampleFilterAll: "All",
    sampleFilterScenario: "Scenario",
    sampleFilterTransport: "Transport",
    sampleFilterAtlas: "Atlas output",
    sampleFilterEvidence: "Evidence-backed",
    sampleScenarioLabel: "Scenario / baseline",
    samplePathLabel: "Demo path",
    sampleExportLabel: "Export target",
    sampleDemoPath: "Open demo guide",
    sampleProjectActionsLabel: "Sample project actions",
    sampleProjectOpen: "Open editable sample",
    sampleProjectDownload: "Download JSON",
    sampleRecipeManifest: "View recipe",
    sampleProjectDownloadsTitle: "All sample project downloads",
    sampleProjectDownloadsBody: "Open any public baseline in the editor with the Guide panel, or download the JSON for local import.",
    sampleProjectGuideNote: "Editor links open the sample with the Guide panel so you can edit, export, or download the original JSON.",
    sampleProjectBlank: "Blank Map starter",
    sampleProjectModern: "Modern World · Central Japan local transport atlas",
    sampleProjectHoi41936: "HOI4 1936 Europe briefing",
    sampleProjectHoi41939: "HOI4 1939 Europe switch",
    sampleProjectTno: "TNO 1962 Atlantropa briefing",
    sampleSnapshotTarget: "Published WebP snapshot + SVG source",
    sampleRecipeLabel: "Layer recipe",
    sampleRecipeAriaLabel: "Layer recipe",
    sampleEvidenceLabel: "Source-backed evidence",
    workOneLabel: "TNO 1962 briefing map",
    workOneTitle: "Atlantropa Mediterranean, with political and physical context.",
    workOneBody:
      "A generated briefing map for the TNO 1962 Mediterranean: ownership, clipped coastline detail, salt basins, shoals, and water regions share one frame.",
    workOneScenario: "TNO 1962 Europe",
    workOneRecipeOne: "TNO political owners",
    workOneRecipeTwo: "Atlantropa basins",
    workOneRecipeThree: "Coastline detail",
    workOneRecipeFour: "Mediterranean labels",
    workOneEvidenceOne: "rendered Atlantropa features · Mediterranean extent · scenario output",
    workOneEvidenceTwo: "dissolved country owners · Mediterranean extent",
    workTwoLabel: "HOI4 comparison run",
    workTwoTitle: "1936 and 1939 Europe, aligned as one scenario switch.",
    workTwoBody:
      "The same Central Europe frame shows two HOI4 baselines side by side, so political change reads as a map comparison.",
    workTwoScenario: "HOI4 1936 / HOI4 1939",
    workTwoRecipeOne: "1936 ownership layer",
    workTwoRecipeTwo: "1939 ownership layer",
    workTwoRecipeThree: "Shared comparison viewport",
    workTwoEvidenceOne: "rendered political features · 1936 · shared Central/Eastern Europe extent",
    workTwoEvidenceTwo: "rendered political features · 1939 · shared Central/Eastern Europe extent",
    workThreeLabel: "Central Japan local transport atlas",
    workThreeTitle: "Central Japan transport context as a local atlas output.",
    workThreeBody:
      "Roads, rail, stations, urban anchors, rivers, and terrain are composed into a compact local atlas output.",
    workThreeScenario: "Central Japan local transport atlas",
    workThreeRecipeOne: "Road lines",
    workThreeRecipeTwo: "Rail lines",
    workThreeRecipeThree: "Major stations",
    workThreeRecipeFour: "Urban anchors, terrain, and rivers",
    workThreeEvidenceOne: "rendered road + rail routes · Central Japan local transport atlas",
    workThreeEvidenceTwo: "major stations · Central Japan local transport atlas",
    storyEyebrow: "One workflow",
    storyTitle: "Move from a public baseline to a finished map.",
    storyBody:
      "Choose a baseline, shape political state, add geographic context, inspect the evidence, and export the result.",
    storyStageLabel: "Interactive product story map stage",
    storyStageChrome: "Scenario Forge story stage",
    storyComparisonLabel: "Scenario state comparison",
    storyCompare1936: "1936",
    storyCompare1939: "1939",
    storyCompareTno: "TNO 1962",
    storyEvidenceSummary: "Source-backed evidence",
    storyEvidenceBaselinesLabel: "public scenario baselines · current demo",
    storyEvidenceScenarioLabel: "political source features · HOI4 1936 Europe input",
    storyEvidenceTransportLabel: "road + rail source features · Japan preview input",
    storyEvidenceCatalogLabel: "cataloged assets · public project data",
    storyEvidenceExportLabel: "routes + major stations (165 + 18) · Central Japan local transport atlas",
    storyStepsLabel: "Product story steps",
    storyAltBaseline: "Generated HOI4 1936 baseline map.",
    storyAltScenario: "Generated scenario comparison map for HOI4 and TNO baselines.",
    storyAltTransport: "Generated Japan transport preview map.",
    storyAltEvidence: "Generated Europe showcase map with source-backed layers.",
    storyAltExport: "Generated Central Japan local transport atlas output.",
    storyStageBadgeBaseline: "Baseline selected",
    storyStageTitleBaseline: "Start from a named public baseline.",
    storyStageBodyBaseline:
      "The map begins from a scenario frame with known ownership and geography.",
    storyStageBadgeScenario: "Political state shaped",
    storyStageTitleScenario: "Compare world states in one map-reading frame.",
    storyStageBodyScenario:
      "The comparison control swaps published views; the editable samples open the ownership and control workflow.",
    storyStageBadgeTransport: "Context added",
    storyStageTitleTransport: "Transport and geography turn the map into a readable place.",
    storyStageBodyTransport:
      "Roads, rail, city anchors, terrain, rivers, and night context build a richer output from existing data.",
    storyStageBadgeEvidence: "Scope and sources visible",
    storyStageTitleEvidence: "Read every count with its evidence boundary.",
    storyStageBodyEvidence:
      "The published scenario, catalog, and landing records define each object, extent, and processing stage.",
    storyStageBadgeExport: "Export-ready",
    storyStageTitleExport: "The finished map can leave the workbench as a compact story asset.",
    storyStageBodyExport:
      "The Central Japan local transport atlas combines transport, city anchors, terrain, and rivers into one presentation view.",
    storyStepBaselineTitle: "Choose baseline",
    storyStepBaselineBody: "Begin with a named public world state before opening the design surface.",
    storyStepBaselineProof: "5 public baselines are registered.",
    storyStepScenarioTitle: "Shape political state",
    storyStepScenarioBody: "Compare published world states, then open the sample to edit ownership and control.",
    storyStepScenarioProof: "1936, 1939, and TNO views share the same map-reading frame.",
    storyStepTransportTitle: "Add transport/context",
    storyStepTransportBody:
      "Layer roads, rail, cities, terrain, rivers, and night context onto the same map story.",
    storyStepTransportProof: "Japan preview records keep the transport counts visible.",
    storyStepEvidenceTitle: "Check scope and sources",
    storyStepEvidenceBody: "Read each count with its object, geographic extent, and processing stage.",
    storyStepEvidenceProof: "Published records and the source ledger define the evidence boundary.",
    storyStepExportTitle: "Export the result",
    storyStepExportBody: "Turn the layered workbench view into a compact presentation map.",
    storyStepExportProof:
      "The Central Japan local transport atlas combines roads, rail, stations, city anchors, terrain, and rivers.",
    showcaseEyebrow: "Evidence explorer",
    showcaseTitle: "Inspect how one Europe output is assembled.",
    showcaseBody:
      "Switch among published political, rail, city-label, capital-anchor, and day-night layers for the HOI4 1936 Europe extent.",
    showcaseAlt: "Europe 1936 generated scenario showcase map.",
    showcaseMapLabel: "Europe 1936 generated scenario showcase map",
    showcaseLayerTabsLabel: "Europe 1936 showcase layers",
    showcaseLayerPolitical: "Political",
    showcaseLayerRail: "Rail",
    showcaseLayerCities: "Cities",
    showcaseLayerDayNight: "Day-Night",
    showcaseLayerPoliticalBadge: "HOI4 1936 Europe",
    showcaseLayerPoliticalTitle:
      "Political ownership comes from the 1936 scenario data.",
    showcaseLayerPoliticalBody:
      "The map colors European territory through Scenario Forge's HOI4 1936 ownership table and country palette.",
    showcaseLayerRailBadge: "Europe rail network",
    showcaseLayerRailTitle: "Rail corridors come from the global rail source.",
    showcaseLayerRailBody:
      "The rail layer samples visible European lines from the OpenStreetMap-derived transport package.",
    showcaseLayerCitiesBadge: "City labels + capital anchors",
    showcaseLayerCitiesTitle: "City labels combine major places with scenario capital anchors.",
    showcaseLayerCitiesBody:
      "The layer combines selected labels from the world city catalog with anchors from the HOI4 1936 capital hints table.",
    showcaseLayerDayNightBadge: "Day-night cycle",
    showcaseLayerDayNightTitle: "A moving day-night pass makes context layers feel alive.",
    showcaseLayerDayNightBody:
      "The overlay combines the Europe scenario map with animated night shade and capital lights, echoing the night-light context used elsewhere in the product.",
    showcaseMeta:
      "HOI4 1936 output · Europe extent · 7,177 political source features, 220 selected rail lines, 34 city labels, and 22 capital anchors.",
    showcaseMetadataFallback: "Layer metadata is unavailable; showing the generated map.",
    previewEyebrow: "Interactive preview",
    previewTitle: "Inspect the Japan transport selection before opening the editor.",
    previewBody:
      "Four pre-generated WebP layers form an interactive preview that separates source records from routes selected for a readable map.",
    miniMapLabel: "Japan transport preview",
    miniMapTitle:
      "5,899 road and rail source features feed a readable transport and context preview.",
    miniMapBadge: "Interactive preview",
    previewSurfaceLabel: "Japan preview map viewport",
    previewZoomControlsLabel: "Japan preview zoom controls",
    previewZoomIn: "Zoom in",
    previewZoomOut: "Zoom out",
    previewZoomReset: "Reset preview zoom",
    previewTabsLabel: "Preview layers",
    previewTabTransport: "Transport",
    previewTabCities: "Cities",
    previewTabTerrain: "Terrain",
    previewTabNight: "Night context",
    previewImageFallback: "This preview layer is unavailable right now.",
    previewPanelTransportBadge: "Japan preview · selected routes",
    previewPanelTransportTitle:
      "420 rendered routes (260 road + 160 rail) · Japan transport preview.",
    previewPanelTransportBody:
      "The preview selects these routes from 5,899 road and rail source features; the featured Central Japan local transport atlas uses its own 165-route local extent.",
    previewPanelCitiesBadge: "Japan preview · city context",
    previewPanelCitiesTitle:
      "32 rendered city anchors · Japan transport preview.",
    previewPanelCitiesBody:
      "Selected cities tie the routes to familiar regional hubs.",
    previewPanelTerrainBadge: "Japan preview · physical context",
    previewPanelTerrainTitle:
      "Contours and rivers show how corridors cross the landscape.",
    previewPanelTerrainBody:
      "The terrain view selects published contour and river lines inside the preview extent.",
    previewPanelNightBadge: "Japan preview · night context",
    previewPanelNightTitle:
      "88 sampled light points · Japan transport preview.",
    previewPanelNightBody:
      "The night layer combines a Black Marble grid sample with historical city anchors.",
    featuresEyebrow: "Product capabilities",
    featuresTitle: "Edit political state, compose context, and keep the result editable.",
    featuresBody:
      "The current public workbench centers on four outcomes: scenario editing, cartographic control, geographic context, and local export.",
    featureGroupOneTitle: "Political state",
    featureGroupOneBody:
      "Start from Blank Map, Modern World, HOI4 1936, HOI4 1939, or TNO 1962, then edit ownership, controller, frontlines, and special regions.",
    featurePointPalettes:
      "Five named baselines are available in the public demo.",
    featurePointExport: "HGO 1936 remains a developer/local preview.",
    featureGroupTwoTitle: "Cartographic control",
    featureGroupTwoBody:
      "Tune layer order, palettes, borders, labels, legends, city points, water regions, terrain, and presentation effects in one workspace.",
    featurePointUndo: "Editing sessions include 80-step undo and redo.",
    featurePointDistricts:
      "Administrative districts and hierarchy data support detailed scenario work.",
    featureGroupThreeTitle: "Geographic context",
    featureGroupThreeBody:
      "Add roads, rail, settlements, relief, contours, rivers, night lights, urban areas, and source links around the political story.",
    featureGroupFourTitle: "Local projects and export",
    featureGroupFourBody:
      "Save editable project JSON and export PNG or JPG presentation snapshots at 1x–4x scale.",
    featurePointTransport:
      "Roads and rail are the strongest current public transport paths.",
    featurePointAudits:
      "Project files keep the map editable after export.",
    dataEyebrow: "Evidence and provenance",
    dataTitle: "Every public number names its object, extent, and processing stage.",
    dataBody:
      "The three visible outputs link to published output details, source records, and the license boundary that applies to code, data, and derived assets.",
    dataCardOneTag: "TNO 1962 output",
    dataCardOneTitle: "Atlantropa Mediterranean",
    dataCardOneBody:
      "896 rendered Atlantropa features and 47 dissolved country owners · Mediterranean extent · scenario output · record schema 1 · sample manifest updated 2026-06-30.",
    dataCardTwoTag: "HOI4 comparison output",
    dataCardTwoTitle: "1936 / 1939 Central–Eastern Europe",
    dataCardTwoBody:
      "90 rendered political features per scenario · shared Central/Eastern Europe extent · comparison output · record schema 1 · sample manifest updated 2026-06-30.",
    dataCardThreeTag: "Central Japan atlas output",
    dataCardThreeTitle: "Central Japan local transport atlas",
    dataCardThreeBody:
      "165 rendered routes (95 road + 70 rail) and 18 major stations · 134.1–141.5°E / 33.2–36.8°N · local atlas output · record schema 1 · sample manifest updated 2026-06-30.",
    dataCardFourTag: "License boundary",
    dataCardFourTitle: "MIT project, source-specific data terms",
    dataCardFourBody:
      "Scenario Forge code and documentation use the MIT License. Third-party datasets and derived assets retain their own source terms and provenance records.",
    evidenceMetadataLink: "View output details",
    evidenceSourceLedgerLink: "Review source list",
    evidenceRoadSourcesLink: "Road source terms",
    evidenceRailSourcesLink: "Rail source terms",
    evidenceLicenseLink: "Read the MIT License",
    editionsEyebrow: "Current boundaries",
    editionsTitle:
      "Public demo, local preview, and future direction are separate surfaces.",
    editionOneBadge: "Current public demo",
    editionOneTitle: "Five public baselines and browser editing",
    editionOneBody:
      "Use political and context layers, save editable project JSON, and export PNG/JPG snapshots at 1x–4x scale.",
    editionTwoBadge: "Local/developer preview",
    editionTwoTitle: "HGO 1936 and local backend flows",
    editionTwoBody:
      "HGO validation plus Cloud Saves and community workflows run through the local creator setup.",
    editionThreeBadge: "Future direction",
    editionThreeTitle: "Shared project and publishing surfaces",
    editionThreeBody:
      "Shared project spaces, permissioned publishing, and cloud collaboration remain a future direction. Availability and release dates remain unannounced.",
    faqEyebrow: "FAQ",
    faqTitle: "Answers grounded in the current public surface.",
    faqOneQuestion: "Is Scenario Forge a GIS tool or a map editor?",
    faqOneAnswer:
      "Scenario Forge is a scenario-first map workbench for editing political state, composing geographic context, and exporting presentation maps.",
    faqTwoQuestion: "What data sources does it use?",
    faqTwoAnswer:
      "Current source families include Natural Earth, geoBoundaries, GeoNames, NOAA ETOPO, NASA Black Marble, OpenStreetMap, Geofabrik, and country transport sources. Each visible output links to its published details and provenance path.",
    faqThreeQuestion: "Can I run it locally?",
    faqThreeAnswer:
      "The public workbench is a static browser application. HGO validation, larger data refreshes, Cloud Saves, and community workflows belong to the local/developer setup.",
    faqFourQuestion: "What can I export?",
    faqFourAnswer:
      "The public workbench exports PNG or JPG presentation snapshots at 1x–4x scale and saves editable project JSON.",
    faqFiveQuestion: "How mature are the transport layers?",
    faqFiveAnswer:
      "Roads and rail are the strongest current public transport paths. Airports and ports provide overview context; mineral resources, energy, industry, and logistics remain preview/workbench families.",
    faqSixQuestion: "How is Scenario Forge licensed?",
    faqSixAnswer:
      "Scenario Forge code and documentation are released under the MIT License. Third-party datasets and derived assets retain their own source terms and provenance records. Check each sample’s source links before redistributing data-derived assets.",
    ctaEyebrow: "Open the workbench",
    ctaTitle: "Start from a public baseline and make the next map editable.",
    ctaBody:
      "The demo opens with a guide; the repository contains the source, project samples, output details, and provenance records.",
    ctaPrimary: "Open demo",
    ctaSecondary: "Browse the repository",
    footerNote:
      "Scenario-first political editing, geographic context, editable project files, and presentation export.",
    footerSources:
      "Major data families include Natural Earth, geoBoundaries, GeoNames, NOAA ETOPO, NASA Black Marble, OpenStreetMap, and Geofabrik.",
    footerDemo: "Open demo",
    footerGithub: "GitHub",
    metaTitle: "Scenario Forge — Scenario-first political map workbench",
    metaDescription:
      "Scenario Forge is a scenario-first political map workbench for alternate history, strategy modding, and geopolitical storytelling.",
    metaOgDescription:
      "Build political maps that start from a world state, reshape control, layer context, and export a story-ready result.",
  },
  zh: {
    skipLink: "跳到正文",
    navWorks: "成果",
    navWorkflow: "流程",
    navProduct: "产品",
    navFeatures: "能力",
    navData: "证据",
    navFaq: "FAQ",
    navRoadmap: "进行中",
    headerGithub: "GitHub",
    headerOpenApp: "打开 Demo",
    heroEyebrow: "场景优先的政治地图工作台",
    heroTitle: "改写一个世界状态。",
    heroTitleAccent: "导出一张能讲清它的地图。",
    heroBody:
      "从公开世界状态开始，调整政治归属，叠加地理上下文，导出可用于展示的地图。",
    heroPrimaryCta: "打开 Demo",
    heroSecondaryCta: "查看三个真实输出",
    productPreviewLabel: "Scenario Forge 生成式制图预览",
    productStageLabel: "Scenario Forge / 生成图集",
    heroChipsLabel: "首屏场景风格",
    heroMapHudOne: "政治基线",
    heroMapHudTwo: "路线与夜光",
    brandHomeLabel: "Scenario Forge 首页",
    primaryNavLabel: "主导航",
    languageSwitcherLabel: "语言切换",
    statsLabel: "Scenario Forge 产品数据",
    productPreviewAlt: "生成式 Scenario Forge HOI4 1936 欧洲政治地图，包含边界和首都标签。",
    heroAltBlank: "生成式中性欧洲空白地图，包含陆地、水域、边界和网格线。",
    heroAltHoi41936: "生成式 Scenario Forge HOI4 1936 欧洲政治地图，包含首都标签。",
    heroAltHoi41939: "生成式 Scenario Forge HOI4 1939 欧洲政治地图，包含首都标签。",
    heroAltTno1962: "Scenario Forge 生成的 TNO 1962 欧洲政治归属局部图，包含首都标记；未叠加 Atlantropa 图层。",
    workOneAlt: "生成式 TNO 1962 地中海 Atlantropa 地图，包含政治语境、盐沼、浅滩和水域。",
    workTwoAlt: "生成式 HOI4 1936 与 1939 中欧对比地图。",
    workThreeAlt: "生成式日本中部局部交通图集，包含道路、铁路、城市锚点、车站、地形和河流。",
    chipBlank: "空白地图",
    chipHoi41936: "HOI4 1936",
    chipHoi41939: "HOI4 1939",
    chipTno1962: "TNO 1962 · 政治局部图",
    statScenarios: "公开场景基线 · 当前 Demo",
    statCities: "城市源记录 · 全球输入",
    statAliases: "城市别名记录 · 全球检索输入",
    statCatalog: "已编目资产 · 签入数据范围",
    statJapan: "道路 + 铁路源要素 · 日本预览输入",
    worksEyebrow: "示例运行",
    worksTitle: "三个可追溯成图，分别配有可编辑样例。",
    worksBody: "每张公开成图都配有可编辑示例、项目 JSON、证据详情和明确范围。",
    sampleFiltersLabel: "示例运行筛选",
    sampleRunsPanelLabel: "示例运行图库",
    sampleFilterAll: "全部",
    sampleFilterScenario: "场景",
    sampleFilterTransport: "交通",
    sampleFilterAtlas: "图集输出",
    sampleFilterEvidence: "来源证据",
    sampleScenarioLabel: "场景 / 基线",
    samplePathLabel: "演示路径",
    sampleExportLabel: "导出目标",
    sampleDemoPath: "打开演示指南",
    sampleProjectActionsLabel: "示例项目操作",
    sampleProjectOpen: "打开可编辑示例",
    sampleProjectDownload: "下载 JSON",
    sampleRecipeManifest: "查看配方",
    sampleProjectDownloadsTitle: "全部示例项目下载",
    sampleProjectDownloadsBody: "打开任一公开基线时会进入带 Guide 面板的编辑器，也可下载 JSON 本地导入。",
    sampleProjectGuideNote: "编辑器链接会打开带 Guide 面板的示例，方便继续编辑、导出或下载原始 JSON。",
    sampleProjectBlank: "Blank Map 起步项目",
    sampleProjectModern: "Modern World · 日本中部局部交通图集",
    sampleProjectHoi41936: "HOI4 1936 欧洲简报",
    sampleProjectHoi41939: "HOI4 1939 欧洲切换",
    sampleProjectTno: "TNO 1962 Atlantropa 简报",
    sampleSnapshotTarget: "公开 WebP 快照 + SVG 源图",
    sampleRecipeLabel: "图层配方",
    sampleRecipeAriaLabel: "图层配方",
    sampleEvidenceLabel: "来源证据",
    workOneLabel: "TNO 1962 简报图",
    workOneTitle: "Atlantropa 地中海，政治和实体地理同屏呈现。",
    workOneBody: "这张 TNO 1962 地中海简报图把归属、海岸线细节、盐盆、浅滩和水域放在同一个画面里。",
    workOneScenario: "TNO 1962 欧洲",
    workOneRecipeOne: "TNO 政治归属",
    workOneRecipeTwo: "Atlantropa 盆地",
    workOneRecipeThree: "海岸线细节",
    workOneRecipeFour: "地中海标签",
    workOneEvidenceOne: "已渲染 Atlantropa 要素 · 地中海范围 · 场景输出",
    workOneEvidenceTwo: "已融合国家归属 · 地中海范围",
    workTwoLabel: "HOI4 对比运行",
    workTwoTitle: "把 1936 和 1939 欧洲对齐为一次场景切换。",
    workTwoBody: "同一张中欧视图并排展示两套 HOI4 基线，让政治变化成为可读的地图对比。",
    workTwoScenario: "HOI4 1936 / HOI4 1939",
    workTwoRecipeOne: "1936 归属图层",
    workTwoRecipeTwo: "1939 归属图层",
    workTwoRecipeThree: "共享对比视口",
    workTwoEvidenceOne: "已渲染政治要素 · 1936 · 共享中东欧范围",
    workTwoEvidenceTwo: "已渲染政治要素 · 1939 · 共享中东欧范围",
    workThreeLabel: "日本中部局部交通图集",
    workThreeTitle: "把日本中部交通上下文整理成局部图集输出。",
    workThreeBody: "道路、铁路、车站、城市锚点、河流和地形被组合成紧凑的局部图集输出。",
    workThreeScenario: "日本中部局部交通图集",
    workThreeRecipeOne: "道路线",
    workThreeRecipeTwo: "铁路线",
    workThreeRecipeThree: "主要车站",
    workThreeRecipeFour: "城市锚点、地形和河流",
    workThreeEvidenceOne: "已渲染道路 + 铁路线路 · 日本中部局部交通图集",
    workThreeEvidenceTwo: "主要车站 · 日本中部局部交通图集",
    storyEyebrow: "一条工作流",
    storyTitle: "从公开基线走到最终成图。",
    storyBody: "选择基线、调整政治状态、叠加地理上下文、核对证据，再导出结果。",
    storyStageLabel: "可交互产品叙事地图舞台",
    storyStageChrome: "Scenario Forge 叙事舞台",
    storyComparisonLabel: "场景状态对比",
    storyCompare1936: "1936",
    storyCompare1939: "1939",
    storyCompareTno: "TNO 1962",
    storyEvidenceSummary: "来源证据",
    storyEvidenceBaselinesLabel: "公开场景基线 · 当前 Demo",
    storyEvidenceScenarioLabel: "政治源要素 · HOI4 1936 欧洲输入",
    storyEvidenceTransportLabel: "道路 + 铁路源要素 · 日本预览输入",
    storyEvidenceCatalogLabel: "已编目资产 · 签入数据范围",
    storyEvidenceExportLabel: "线路 + 主要车站（165 + 18）· 日本中部局部交通图集",
    storyStepsLabel: "产品叙事步骤",
    storyAltBaseline: "生成式 HOI4 1936 基线地图。",
    storyAltScenario: "生成式 HOI4 与 TNO 场景对比地图。",
    storyAltTransport: "生成式日本交通预览地图。",
    storyAltEvidence: "带来源图层的生成式欧洲展示地图。",
    storyAltExport: "生成式日本中部局部交通图集输出。",
    storyStageBadgeBaseline: "已选择基线",
    storyStageTitleBaseline: "从命名公开基线开始。",
    storyStageBodyBaseline: "地图先落在一套明确的场景框架里，归属和地理都有来源。",
    storyStageBadgeScenario: "已调整政治状态",
    storyStageTitleScenario: "在同一地图阅读框架中比较世界状态。",
    storyStageBodyScenario: "对比控件切换公开视图；可编辑示例会进入归属与控制方编辑流程。",
    storyStageBadgeTransport: "已叠加上下文",
    storyStageTitleTransport: "交通和地理上下文让地图变成可阅读的地方。",
    storyStageBodyTransport: "道路、铁路、城市锚点、地形、河流和夜光上下文共同支撑成图。",
    storyStageBadgeEvidence: "范围与来源可见",
    storyStageTitleEvidence: "每个计数都带有证据边界。",
    storyStageBodyEvidence: "公开场景、目录和 landing 记录定义对象、范围与处理阶段。",
    storyStageBadgeExport: "可导出",
    storyStageTitleExport: "完成后的地图可以作为紧凑的叙事资产离开工作台。",
    storyStageBodyExport: "日本中部局部交通图集把交通、城市锚点、地形和河流合成到同一个展示视图。",
    storyStepBaselineTitle: "选择基线",
    storyStepBaselineBody: "从一个命名公开世界状态开始，再进入设计界面。",
    storyStepBaselineProof: "已登记 5 个公开基线。",
    storyStepScenarioTitle: "调整政治状态",
    storyStepScenarioBody: "比较公开世界状态，再打开示例编辑归属与控制方。",
    storyStepScenarioProof: "1936、1939 和 TNO 视图共享同一地图阅读框架。",
    storyStepTransportTitle: "叠加交通与上下文",
    storyStepTransportBody: "把道路、铁路、城市、地形、河流和夜光上下文叠到同一条地图叙事里。",
    storyStepTransportProof: "日本预览记录保留了交通计数。",
    storyStepEvidenceTitle: "核对范围与来源",
    storyStepEvidenceBody: "每个计数都标明对象、地理范围与处理阶段。",
    storyStepEvidenceProof: "公开记录与 source ledger 定义证据边界。",
    storyStepExportTitle: "导出结果",
    storyStepExportBody: "把工作台里的图层组合导出成紧凑展示地图。",
    storyStepExportProof: "日本中部局部交通图集组合了道路、铁路、车站、城市锚点、地形和河流。",
    showcaseEyebrow: "证据浏览",
    showcaseTitle: "查看一张欧洲输出如何组合图层。",
    showcaseBody: "在 HOI4 1936 欧洲范围内切换公开的政治、铁路、城市标签、首都锚点与昼夜图层。",
    showcaseAlt: "欧洲 1936 场景展示地图。",
    showcaseMapLabel: "欧洲 1936 场景展示地图",
    showcaseLayerTabsLabel: "欧洲 1936 展示图层",
    showcaseLayerPolitical: "政治",
    showcaseLayerRail: "铁路",
    showcaseLayerCities: "城市",
    showcaseLayerDayNight: "昼夜",
    showcaseLayerPoliticalBadge: "HOI4 1936 欧洲",
    showcaseLayerPoliticalTitle: "政治归属来自 1936 场景数据。",
    showcaseLayerPoliticalBody: "欧洲地块颜色来自仓库中的 HOI4 1936 归属表和国家配色。",
    showcaseLayerRailBadge: "欧洲铁路网络",
    showcaseLayerRailTitle: "铁路走廊来自 global rail 数据源。",
    showcaseLayerRailBody: "铁路图层从仓库中 OpenStreetMap 衍生交通包里抽取欧洲可见线路。",
    showcaseLayerCitiesBadge: "城市标签 + 首都锚点",
    showcaseLayerCitiesTitle: "城市标签由主要城市与场景首都锚点共同组成。",
    showcaseLayerCitiesBody: "这一层组合世界城市目录中的选定标签与 HOI4 1936 首都提示表中的锚点。",
    showcaseLayerDayNightBadge: "昼夜循环",
    showcaseLayerDayNightTitle: "昼夜变化让上下文图层更有生命感。",
    showcaseLayerDayNightBody: "这一层把欧洲场景地图、移动夜色和首都光点组合起来，对应产品里的夜光上下文能力。",
    showcaseMeta: "HOI4 1936 输出 · 欧洲范围 · 7,177 个政治源要素、220 条已选铁路线、34 个城市标签和 22 个首都锚点。",
    showcaseMetadataFallback: "图层元数据暂不可用，当前显示已生成地图。",
    previewEyebrow: "可交互预览",
    previewTitle: "进入编辑器前，先查看日本交通筛选结果。",
    previewBody: "四张预生成 WebP 通过图层切换形成交互预览，并分别说明源记录与成图所选线路。",
    miniMapLabel: "日本交通预览",
    miniMapTitle: "5,899 个道路与铁路源要素进入交通和地理上下文预览。",
    miniMapBadge: "可交互预览",
    previewSurfaceLabel: "日本预览地图视口",
    previewZoomControlsLabel: "日本预览缩放控件",
    previewZoomIn: "放大",
    previewZoomOut: "缩小",
    previewZoomReset: "重置预览缩放",
    previewTabsLabel: "预览图层",
    previewTabTransport: "交通",
    previewTabCities: "城市",
    previewTabTerrain: "地形",
    previewTabNight: "夜光上下文",
    previewImageFallback: "该预览图层暂时不可用。",
    previewPanelTransportBadge: "日本预览 · 已选线路",
    previewPanelTransportTitle: "420 条已渲染线路（260 条道路 + 160 条铁路）· 日本交通预览。",
    previewPanelTransportBody: "预览从 5,899 个道路与铁路源要素中筛选这些线路；日本中部局部交通图集使用独立的 165 条局部线路范围。",
    previewPanelCitiesBadge: "日本预览 · 城市上下文",
    previewPanelCitiesTitle: "32 个已渲染城市锚点 · 日本交通预览。",
    previewPanelCitiesBody: "选定城市把线路连接到熟悉的区域中心。",
    previewPanelTerrainBadge: "日本预览 · 实体地理上下文",
    previewPanelTerrainTitle: "等高线与河流呈现交通走廊穿越地形的方式。",
    previewPanelTerrainBody: "地形视图筛选预览范围内已签入的等高线与河流线。",
    previewPanelNightBadge: "日本预览 · 夜光上下文",
    previewPanelNightTitle: "88 个抽样光点 · 日本交通预览。",
    previewPanelNightBody: "夜光图层组合 Black Marble 网格抽样与历史城市锚点。",
    featuresEyebrow: "产品能力",
    featuresTitle: "编辑政治状态、组合上下文，并让结果保持可编辑。",
    featuresBody: "当前公开工作台围绕四类结果组织：场景编辑、制图控制、地理上下文和本地导出。",
    featureGroupOneTitle: "政治状态",
    featureGroupOneBody: "从 Blank Map、Modern World、HOI4 1936、HOI4 1939 或 TNO 1962 开始，再编辑归属、控制方、前线与特殊区域。",
    featurePointPalettes: "当前 Demo 提供 5 个命名公开基线。",
    featurePointExport: "HGO 1936 保持开发/本地预览状态。",
    featureGroupTwoTitle: "制图控制",
    featureGroupTwoBody: "在同一工作台调整图层顺序、调色板、边界、标签、图例、城市点、水域、地形与表现效果。",
    featurePointUndo: "编辑会话支持 80 步撤销与重做。",
    featurePointDistricts: "行政区与层级数据支持细致场景制作。",
    featureGroupThreeTitle: "地理上下文",
    featureGroupThreeBody: "围绕政治叙事叠加道路、铁路、聚落、地形、等高线、河流、夜光、城市区域与来源链接。",
    featureGroupFourTitle: "本地项目与导出",
    featureGroupFourBody: "保存可编辑项目 JSON，并按 1x–4x 比例导出 PNG 或 JPG 展示快照。",
    featurePointTransport: "道路与铁路是当前最强的公开交通路径。",
    featurePointAudits: "项目文件让成图在导出后继续可编辑。",
    dataEyebrow: "证据与溯源",
    dataTitle: "每个公开数字都标明对象、范围与处理阶段。",
    dataBody: "三个可见输出都链接到公开输出详情、来源记录，以及代码、数据与衍生资产各自适用的许可边界。",
    dataCardOneTag: "TNO 1962 输出",
    dataCardOneTitle: "Atlantropa 地中海",
    dataCardOneBody: "896 个已渲染 Atlantropa 要素与 47 个已融合国家归属 · 地中海范围 · 场景输出 · 记录格式 1 · 样例清单更新于 2026-06-30。",
    dataCardTwoTag: "HOI4 对比输出",
    dataCardTwoTitle: "1936 / 1939 中东欧",
    dataCardTwoBody: "每个场景 90 个已渲染政治要素 · 共享中东欧范围 · 对比输出 · 记录格式 1 · 样例清单更新于 2026-06-30。",
    dataCardThreeTag: "日本中部图集输出",
    dataCardThreeTitle: "日本中部局部交通图集",
    dataCardThreeBody: "165 条已渲染线路（95 条道路 + 70 条铁路）与 18 个主要车站 · 134.1–141.5°E / 33.2–36.8°N · 局部图集输出 · 记录格式 1 · 样例清单更新于 2026-06-30。",
    dataCardFourTag: "许可边界",
    dataCardFourTitle: "项目采用 MIT，数据遵循各自来源条款",
    dataCardFourBody: "Scenario Forge 的代码与文档采用 MIT License。第三方数据集及衍生资产保留各自来源条款与溯源记录。",
    evidenceMetadataLink: "查看输出详情",
    evidenceSourceLedgerLink: "查看来源清单",
    evidenceRoadSourcesLink: "道路来源条款",
    evidenceRailSourcesLink: "铁路来源条款",
    evidenceLicenseLink: "阅读 MIT License",
    editionsEyebrow: "当前边界",
    editionsTitle: "公开 Demo、本地预览与未来方向分别说明。",
    editionOneBadge: "当前公开 Demo",
    editionOneTitle: "5 个公开基线与浏览器编辑",
    editionOneBody: "使用政治与上下文图层，保存可编辑项目 JSON，并按 1x–4x 比例导出 PNG/JPG 快照。",
    editionTwoBadge: "本地/开发预览",
    editionTwoTitle: "HGO 1936 与本地后端流程",
    editionTwoBody: "HGO 验证、Cloud Saves 与社区工作流通过本地创作者设置运行。",
    editionThreeBadge: "未来方向",
    editionThreeTitle: "共享项目与发布界面",
    editionThreeBody: "共享项目空间、权限发布与云端协作属于未来方向，可用性与发布日期仍待公布。",
    faqEyebrow: "FAQ",
    faqTitle: "答案以当前公开能力为准。",
    faqOneQuestion: "Scenario Forge 是 GIS 工具还是地图编辑器？",
    faqOneAnswer: "Scenario Forge 是场景优先的地图工作台，用于编辑政治状态、组合地理上下文并导出展示地图。",
    faqTwoQuestion: "它使用哪些数据来源？",
    faqTwoAnswer: "当前来源包括 Natural Earth、geoBoundaries、GeoNames、NOAA ETOPO、NASA Black Marble、OpenStreetMap、Geofabrik 和各国交通来源。每个可见输出都链接到公开详情与溯源路径。",
    faqThreeQuestion: "可以在本地运行吗？",
    faqThreeAnswer: "公开工作台是静态浏览器应用。HGO 验证、更大数据刷新、Cloud Saves 与社区工作流属于本地/开发设置。",
    faqFourQuestion: "可以导出什么？",
    faqFourAnswer: "公开工作台支持按 1x–4x 比例导出 PNG 或 JPG 展示快照，并保存可编辑项目 JSON。",
    faqFiveQuestion: "交通图层成熟度如何？",
    faqFiveAnswer: "道路与铁路是当前最强的公开交通路径。机场和港口提供总览上下文；矿产资源、能源、工业与物流保持预览/工作台状态。",
    faqSixQuestion: "Scenario Forge 使用什么许可？",
    faqSixAnswer: "Scenario Forge 的代码和文档采用 MIT License。第三方数据集及衍生资产遵循各自的来源条款和溯源记录；分发含数据的衍生成果前，请查看对应样例的来源链接。",
    ctaEyebrow: "打开工作台",
    ctaTitle: "从公开基线开始，让下一张地图保持可编辑。",
    ctaBody: "Demo 会打开使用指南；仓库包含源码、项目样例、输出详情与溯源记录。",
    ctaPrimary: "打开 Demo",
    ctaSecondary: "浏览仓库",
    footerNote: "场景优先政治编辑、地理上下文、可编辑项目文件与展示导出。",
    footerSources: "主要数据来源包括 Natural Earth、geoBoundaries、GeoNames、NOAA ETOPO、NASA Black Marble、OpenStreetMap 与 Geofabrik。",
    footerDemo: "打开 Demo",
    footerGithub: "GitHub",
    metaTitle: "Scenario Forge — 场景优先政治地图工作台",
    metaDescription: "Scenario Forge 是一个面向架空历史、策略模组制作与地缘政治叙事的场景优先政治地图工作台。",
    metaOgDescription: "从一个世界状态出发，改写控制与归属，叠加上下文图层，再导出成故事就绪的政治地图。",
  },
};

const SHOWCASE_LAYER_COPY_KEYS = {
  political: {
    badge: "showcaseLayerPoliticalBadge",
    title: "showcaseLayerPoliticalTitle",
    body: "showcaseLayerPoliticalBody",
  },
  rail: {
    badge: "showcaseLayerRailBadge",
    title: "showcaseLayerRailTitle",
    body: "showcaseLayerRailBody",
  },
  cities: {
    badge: "showcaseLayerCitiesBadge",
    title: "showcaseLayerCitiesTitle",
    body: "showcaseLayerCitiesBody",
  },
  "day-night": {
    badge: "showcaseLayerDayNightBadge",
    title: "showcaseLayerDayNightTitle",
    body: "showcaseLayerDayNightBody",
  },
};
const SHOWCASE_METADATA_URL = "./assets/europe-1936-showcase.json";
const DEFAULT_SHOWCASE_LAYER = "political";
const SHOWCASE_VIEW_WIDTH = 980;
const SHOWCASE_VIEW_HEIGHT = 620;
const SHOWCASE_VIEW_SCALES = [1, 1.16, 1.34, 1.58, 1.8];
const DEFAULT_SHOWCASE_VIEW_SCALE_INDEX = 1;
const PREVIEW_VIEW_WIDTH = 680;
const PREVIEW_VIEW_HEIGHT = 440;
const PREVIEW_VIEW_SCALES = [1, 1.25, 1.55, 1.9, 2.25];
const DEFAULT_HERO_MODE = "hoi4-1936";
const HERO_SCENARIO_ASSETS = {
  blank: {
    src: "./assets/hero-blank.webp",
    metadata: "./assets/hero-blank.json",
    altKey: "heroAltBlank",
  },
  "hoi4-1936": {
    src: "./assets/hero-hoi4-1936.webp",
    metadata: "./assets/hero-hoi4-1936.json",
    altKey: "heroAltHoi41936",
  },
  "hoi4-1939": {
    src: "./assets/hero-hoi4-1939.webp",
    metadata: "./assets/hero-hoi4-1939.json",
    altKey: "heroAltHoi41939",
  },
  "tno-1962": {
    src: "./assets/hero-tno-1962.webp",
    metadata: "./assets/hero-tno-1962.json",
    altKey: "heroAltTno1962",
  },
};
const DEFAULT_PRODUCT_STORY_STEP = "baseline";
const DEFAULT_PRODUCT_STORY_COMPARISON = "hoi4-1936";
const PRODUCT_STORY_COMPARISON_ASSETS = {
  "hoi4-1936": {
    src: "./assets/hero-hoi4-1936.webp",
    altKey: "storyAltBaseline",
  },
  "hoi4-1939": {
    src: "./assets/hero-hoi4-1939.webp",
    altKey: "heroAltHoi41939",
  },
  "tno-1962": {
    src: "./assets/hero-tno-1962.webp",
    altKey: "heroAltTno1962",
  },
};
const PRODUCT_STORY_STEPS = {
  baseline: {
    src: "./assets/hero-hoi4-1936.webp",
    altKey: "storyAltBaseline",
    badgeKey: "storyStageBadgeBaseline",
    titleKey: "storyStageTitleBaseline",
    bodyKey: "storyStageBodyBaseline",
  },
  scenario: {
    comparisonDriven: true,
    altKey: "storyAltScenario",
    badgeKey: "storyStageBadgeScenario",
    titleKey: "storyStageTitleScenario",
    bodyKey: "storyStageBodyScenario",
  },
  transport: {
    src: "./assets/japan-preview-transport.webp",
    altKey: "storyAltTransport",
    badgeKey: "storyStageBadgeTransport",
    titleKey: "storyStageTitleTransport",
    bodyKey: "storyStageBodyTransport",
  },
  evidence: {
    src: "./assets/europe-1936-showcase.svg",
    altKey: "storyAltEvidence",
    badgeKey: "storyStageBadgeEvidence",
    titleKey: "storyStageTitleEvidence",
    bodyKey: "storyStageBodyEvidence",
  },
  export: {
    src: "./assets/work-atlas-japan-corridor.webp",
    altKey: "storyAltExport",
    badgeKey: "storyStageBadgeExport",
    titleKey: "storyStageTitleExport",
    bodyKey: "storyStageBodyExport",
  },
};
const DEFAULT_SAMPLE_RUN_FILTER = "all";
const SAMPLE_RUN_FILTERS = new Set(["all", "scenario", "transport", "atlas", "evidence"]);

function getStoredLanguage() {
  try {
    const value = String(globalThis.localStorage?.getItem(STORAGE_KEY) || "").trim().toLowerCase();
    return value === "zh" ? "zh" : "en";
  } catch (_error) {
    return "en";
  }
}

function applyLanguage(language) {
  const copy = translations[language] || translations.en;
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    const key = node.getAttribute("data-i18n");
    if (!key || !(key in copy)) return;
    node.textContent = copy[key];
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((node) => {
    const key = node.getAttribute("data-i18n-aria-label");
    if (!key || !(key in copy)) return;
    node.setAttribute("aria-label", copy[key]);
  });

  document.querySelectorAll("[data-i18n-alt]").forEach((node) => {
    const key = node.getAttribute("data-i18n-alt");
    if (!key || !(key in copy)) return;
    node.setAttribute("alt", copy[key]);
  });

  document.querySelectorAll("[data-lang]").forEach((button) => {
    const active = button.getAttribute("data-lang") === language;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });

  document.title = copy.metaTitle;
  const description = document.querySelector('meta[name="description"]');
  const ogDescription = document.querySelector('meta[property="og:description"]');
  const twitterDescription = document.querySelector('meta[name="twitter:description"]');
  const ogTitle = document.querySelector('meta[property="og:title"]');
  const twitterTitle = document.querySelector('meta[name="twitter:title"]');

  if (description) description.setAttribute("content", copy.metaDescription);
  if (ogDescription) ogDescription.setAttribute("content", copy.metaOgDescription);
  if (twitterDescription) twitterDescription.setAttribute("content", copy.metaDescription);
  if (ogTitle) ogTitle.setAttribute("content", copy.metaTitle);
  if (twitterTitle) twitterTitle.setAttribute("content", copy.metaTitle);
  formatMetricNumbers(language);
  updateShowcaseLayerCopy(language);
  syncSampleRunsFromDom();
  syncProductStoryFromDom();
  syncHeroMapFromDom();

  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, language);
  } catch (_error) {
    // noop
  }
}

function formatMetricNumbers(language) {
  const locale = language === "zh" ? "zh-CN" : "en-US";
  const formatter = new Intl.NumberFormat(locale);
  document.querySelectorAll("[data-stat-value]").forEach((node) => {
    const value = Number.parseInt(node.getAttribute("data-stat-value") || "", 10);
    if (Number.isNaN(value)) return;
    node.textContent = formatter.format(value);
  });
}

function initMetricCountUp() {
  const motionQuery = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
  const statNodes = Array.from(document.querySelectorAll("[data-stat-value]"));
  if (motionQuery?.matches || !statNodes.length) return;

  const animateNode = (node) => {
    const target = Number.parseInt(node.getAttribute("data-stat-value") || "", 10);
    if (Number.isNaN(target) || node.dataset.counted === "true") return;
    node.dataset.counted = "true";
    const language = document.documentElement.lang === "zh-CN" ? "zh" : "en";
    const formatter = new Intl.NumberFormat(language === "zh" ? "zh-CN" : "en-US");
    const duration = 760;
    const start = globalThis.performance?.now?.() || Date.now();
    const tick = (now) => {
      const elapsed = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - elapsed, 3);
      node.textContent = formatter.format(Math.round(target * eased));
      if (elapsed < 1) globalThis.requestAnimationFrame(tick);
    };
    globalThis.requestAnimationFrame(tick);
  };

  if (!("IntersectionObserver" in globalThis)) {
    statNodes.forEach(animateNode);
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        animateNode(entry.target);
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.4 },
  );

  statNodes.forEach((node) => observer.observe(node));
}

function initScrollReveal() {
  const motionQuery = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
  if (motionQuery?.matches) return;

  const revealNodes = Array.from(document.querySelectorAll("[data-reveal]"));
  if (!revealNodes.length) return;

  document.documentElement.dataset.reveal = "enabled";

  if (!("IntersectionObserver" in globalThis)) {
    revealNodes.forEach((node) => node.classList.add("is-revealed"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const siblings = Array.from(entry.target.parentElement?.children || []).filter((node) =>
          node.hasAttribute?.("data-reveal"),
        );
        const revealIndex = Math.max(0, siblings.indexOf(entry.target));
        entry.target.style.setProperty("--reveal-delay", `${Math.min(revealIndex, 8) * 60}ms`);
        entry.target.classList.add("is-revealed");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.16, rootMargin: "0px 0px -8% 0px" },
  );

  revealNodes.forEach((node) => observer.observe(node));
}

function resolveHeroMode(mode) {
  return Object.prototype.hasOwnProperty.call(HERO_SCENARIO_ASSETS, mode) ? mode : DEFAULT_HERO_MODE;
}

function decodeHeroAsset(src) {
  if (!src || typeof globalThis.Image !== "function") return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    const preload = new globalThis.Image();
    preload.decoding = "async";
    preload.onload = () => {
      if (typeof preload.decode === "function") {
        preload.decode().then(() => resolve(true)).catch(() => resolve(true));
      } else {
        resolve(true);
      }
    };
    preload.onerror = () => reject(new Error(`Unable to preload ${src}`));
    preload.src = src;
  });
}

function prefetchHeroAssets(activeMode) {
  const preloadRest = () => {
    Object.entries(HERO_SCENARIO_ASSETS).forEach(([mode, asset]) => {
      if (mode === activeMode) return;
      decodeHeroAsset(asset.src).catch(() => {});
    });
  };

  if (typeof globalThis.requestIdleCallback === "function") {
    globalThis.requestIdleCallback(preloadRest, { timeout: 1800 });
  } else {
    globalThis.setTimeout(preloadRest, 300);
  }
}

function isCurrentHeroAsset(image, src) {
  const currentSrc = image.getAttribute("src") || "";
  const normalizedSrc = src.replace(/^\.\//, "");
  return currentSrc === src || currentSrc.endsWith(normalizedSrc);
}

function syncHeroMap(root, mode, options = {}) {
  const nextMode = resolveHeroMode(mode);
  const asset = HERO_SCENARIO_ASSETS[nextMode];
  const image = root.querySelector("[data-hero-image]");
  const chips = Array.from(document.querySelectorAll("[data-hero-chip]"));
  const copy = translations[getActiveLanguage()] || translations.en;

  // heroMetadata 跟随当前图片一起切换，保证文案和可见资产都指向同一份生成器 metadata。
  root.dataset.heroMode = nextMode;
  if (asset.metadata) {
    root.dataset.heroMetadata = asset.metadata;
  }

  if (image) {
    const swapImage = () => {
      image.src = asset.src;
      image.alt = copy[asset.altKey] || copy.productPreviewAlt;
    };
    if (isCurrentHeroAsset(image, asset.src) && image.complete && image.naturalWidth > 0) {
      image.alt = copy[asset.altKey] || copy.productPreviewAlt;
      root.dataset.heroTransition = "ready";
      delete root.dataset.heroPendingMode;
    } else if (options.animate) {
      root.dataset.heroTransition = "loading";
      root.dataset.heroPendingMode = nextMode;
      decodeHeroAsset(asset.src)
        .catch(() => false)
        .then(() => {
          if (root.dataset.heroPendingMode !== nextMode) return;
          swapImage();
          root.dataset.heroTransition = "ready";
          delete root.dataset.heroPendingMode;
        });
    } else {
      delete root.dataset.heroPendingMode;
      swapImage();
      root.dataset.heroTransition = "ready";
    }
  }

  chips.forEach((chip) => {
    const active = chip.getAttribute("data-hero-chip") === nextMode;
    chip.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function syncHeroMapFromDom() {
  const root = document.querySelector("[data-hero-map]");
  if (!root) return;
  syncHeroMap(root, root.dataset.heroMode || DEFAULT_HERO_MODE);
}

function initHeroMap() {
  const root = document.querySelector("[data-hero-map]");
  const chips = Array.from(document.querySelectorAll("[data-hero-chip]"));
  if (!root || !chips.length) return;
  const motionQuery = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
  syncHeroMap(root, root.dataset.heroMode || DEFAULT_HERO_MODE);
  prefetchHeroAssets(resolveHeroMode(root.dataset.heroMode || DEFAULT_HERO_MODE));

  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const nextMode = chip.getAttribute("data-hero-chip") || DEFAULT_HERO_MODE;
      if (resolveHeroMode(root.dataset.heroMode || DEFAULT_HERO_MODE) === resolveHeroMode(nextMode)) return;
      syncHeroMap(root, nextMode, { animate: !motionQuery?.matches });
    });
  });
}

function resolveProductStoryStep(root, stepId) {
  if (Object.prototype.hasOwnProperty.call(PRODUCT_STORY_STEPS, stepId)) {
    delete root.dataset.storyError;
    return stepId;
  }
  root.dataset.storyError = stepId || "missing";
  return DEFAULT_PRODUCT_STORY_STEP;
}

function resolveProductStoryComparison(comparisonId) {
  return Object.prototype.hasOwnProperty.call(PRODUCT_STORY_COMPARISON_ASSETS, comparisonId)
    ? comparisonId
    : DEFAULT_PRODUCT_STORY_COMPARISON;
}

function getProductStoryAsset(root, stepId) {
  const step = PRODUCT_STORY_STEPS[stepId] || PRODUCT_STORY_STEPS[DEFAULT_PRODUCT_STORY_STEP];
  if (!step.comparisonDriven) return step;
  const comparisonId = resolveProductStoryComparison(root.dataset.storyComparison || DEFAULT_PRODUCT_STORY_COMPARISON);
  return {
    ...step,
    ...PRODUCT_STORY_COMPARISON_ASSETS[comparisonId],
  };
}

function resolveSampleRunFilter(root, filter) {
  if (SAMPLE_RUN_FILTERS.has(filter)) {
    delete root.dataset.sampleFilterError;
    return filter;
  }
  root.dataset.sampleFilterError = filter || "missing";
  return DEFAULT_SAMPLE_RUN_FILTER;
}

function sampleRunCardMatches(card, filter) {
  if (filter === DEFAULT_SAMPLE_RUN_FILTER) return true;
  return String(card.getAttribute("data-sample-tags") || "")
    .split(/\s+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .includes(filter);
}

function updateSampleRunsGallery(root) {
  const filter = resolveSampleRunFilter(root, root.dataset.sampleFilter || DEFAULT_SAMPLE_RUN_FILTER);
  const buttons = Array.from(root.querySelectorAll("[data-sample-run-filter]"));
  const cards = Array.from(root.querySelectorAll("[data-sample-run-card]"));
  let featuredAssigned = false;

  root.dataset.sampleFilter = filter;
  root.dataset.sampleMotion = isReducedMotionPreferred() ? "reduced" : "standard";

  buttons.forEach((button) => {
    const active = button.getAttribute("data-sample-run-filter") === filter;
    button.setAttribute("aria-pressed", active ? "true" : "false");
    button.setAttribute("tabindex", active ? "0" : "-1");
  });

  cards.forEach((card) => {
    const visible = sampleRunCardMatches(card, filter);
    card.hidden = !visible;
    card.dataset.sampleActive = visible ? "true" : "false";
    card.dataset.sampleFeatured = visible && !featuredAssigned ? "true" : "false";
    if (visible) featuredAssigned = true;
  });

  if (featuredAssigned) {
    delete root.dataset.sampleRunEmpty;
  } else {
    root.dataset.sampleRunEmpty = "true";
  }
}

function syncSampleRunsFromDom() {
  const root = document.querySelector("[data-sample-runs-root]");
  if (!root) return;
  updateSampleRunsGallery(root);
}

function initSampleRunsGallery() {
  const root = document.querySelector("[data-sample-runs-root]");
  if (!root) return;

  const buttons = Array.from(root.querySelectorAll("[data-sample-run-filter]"));
  if (!buttons.length) return;

  const selectFilter = (filter, options = {}) => {
    root.dataset.sampleFilter = resolveSampleRunFilter(root, filter);
    updateSampleRunsGallery(root);
    if (options.focus) {
      buttons.find((button) => button.getAttribute("data-sample-run-filter") === root.dataset.sampleFilter)?.focus();
    }
  };

  buttons.forEach((button, index) => {
    button.addEventListener("click", () => selectFilter(button.getAttribute("data-sample-run-filter")));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      let nextIndex = index;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % buttons.length;
      if (event.key === "ArrowLeft") nextIndex = (index - 1 + buttons.length) % buttons.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = buttons.length - 1;
      selectFilter(buttons[nextIndex].getAttribute("data-sample-run-filter"), { focus: true });
    });
  });

  updateSampleRunsGallery(root);
}

function updateProductStoryStage(root, language = getActiveLanguage()) {
  const copy = translations[language] || translations.en;
  const stepId = resolveProductStoryStep(root, root.dataset.storyStep || DEFAULT_PRODUCT_STORY_STEP);
  const asset = getProductStoryAsset(root, stepId);
  const image = root.querySelector("[data-story-stage-image]");
  const badge = root.querySelector("[data-story-stage-badge]");
  const title = root.querySelector("[data-story-stage-title]");
  const body = root.querySelector("[data-story-stage-body]");

  root.dataset.storyStep = stepId;
  root.dataset.storyComparison = resolveProductStoryComparison(root.dataset.storyComparison || DEFAULT_PRODUCT_STORY_COMPARISON);
  root.dataset.storyStageAsset = asset.src;

  if (image) {
    image.src = asset.src;
    image.alt = copy[asset.altKey] || "";
    image.setAttribute("src", asset.src);
    image.setAttribute("data-i18n-alt", asset.altKey);
  }
  if (badge) badge.textContent = copy[asset.badgeKey] || "";
  if (title) title.textContent = copy[asset.titleKey] || "";
  if (body) body.textContent = copy[asset.bodyKey] || "";

  root.querySelectorAll("[data-story-step-button]").forEach((button) => {
    const active = button.getAttribute("data-story-step-button") === stepId;
    button.setAttribute("aria-pressed", active ? "true" : "false");
    if (active) {
      button.setAttribute("aria-current", "step");
    } else {
      button.removeAttribute?.("aria-current");
    }
  });

  root.querySelectorAll("[data-story-compare]").forEach((button) => {
    const active = button.getAttribute("data-story-compare") === root.dataset.storyComparison;
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });

  root.querySelectorAll("[data-story-evidence]").forEach((item) => {
    item.dataset.storyEvidenceActive = item.getAttribute("data-story-evidence") === stepId ? "true" : "false";
  });
}

function syncProductStoryFromDom() {
  const root = document.querySelector("[data-story-root]");
  if (!root) return;
  updateProductStoryStage(root);
}

function initProductStory() {
  const root = document.querySelector("[data-story-root]");
  if (!root) return;

  const stepButtons = Array.from(root.querySelectorAll("[data-story-step-button]"));
  const compareButtons = Array.from(root.querySelectorAll("[data-story-compare]"));
  if (!stepButtons.length) return;

  const selectStep = (stepId, options = {}) => {
    root.dataset.storyStep = resolveProductStoryStep(root, stepId);
    updateProductStoryStage(root);
    if (options.focus) {
      stepButtons.find((button) => button.getAttribute("data-story-step-button") === root.dataset.storyStep)?.focus();
    }
  };

  stepButtons.forEach((button, index) => {
    button.addEventListener("click", () => selectStep(button.getAttribute("data-story-step-button")));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      let nextIndex = index;
      if (event.key === "ArrowDown" || event.key === "ArrowRight") nextIndex = (index + 1) % stepButtons.length;
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") nextIndex = (index - 1 + stepButtons.length) % stepButtons.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = stepButtons.length - 1;
      selectStep(stepButtons[nextIndex].getAttribute("data-story-step-button"), { focus: true });
    });
  });

  compareButtons.forEach((button, index) => {
    button.addEventListener("click", () => {
      root.dataset.storyComparison = resolveProductStoryComparison(button.getAttribute("data-story-compare"));
      selectStep("scenario");
    });
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      let nextIndex = index;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % compareButtons.length;
      if (event.key === "ArrowLeft") nextIndex = (index - 1 + compareButtons.length) % compareButtons.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = compareButtons.length - 1;
      compareButtons[nextIndex].focus();
      root.dataset.storyComparison = resolveProductStoryComparison(compareButtons[nextIndex].getAttribute("data-story-compare"));
      selectStep("scenario");
    });
  });

  if (!isReducedMotionPreferred() && "IntersectionObserver" in globalThis) {
    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const stepId = visibleEntry?.target?.getAttribute?.("data-story-step-button");
        if (stepId) selectStep(stepId);
      },
      { threshold: [0.42, 0.62], rootMargin: "-18% 0px -34% 0px" },
    );
    stepButtons.forEach((button) => observer.observe(button));
  }

  updateProductStoryStage(root);
}

function initTopbarState() {
  const topbar = document.querySelector(".topbar");
  if (!topbar) return;
  const update = () => {
    topbar.classList.toggle("is-scrolled", globalThis.scrollY > 12);
  };
  update();
  globalThis.addEventListener("scroll", update, { passive: true });
}

function initScrollSpy() {
  const navLinks = Array.from(document.querySelectorAll(".topnav a[href^='#']"));
  const sections = navLinks
    .map((link) => {
      const id = link.getAttribute("href")?.slice(1);
      return id ? document.getElementById(id) : null;
    })
    .filter(Boolean);
  if (!navLinks.length || !sections.length || !("IntersectionObserver" in globalThis)) return;

  const setActiveSection = (id) => {
    navLinks.forEach((link) => {
      const active = link.getAttribute("href") === `#${id}`;
      link.classList.toggle("is-active", active);
      if (active) {
        link.setAttribute("aria-current", "true");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  };

  const observer = new IntersectionObserver(
    (entries) => {
      const visibleEntries = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
      if (visibleEntries[0]?.target?.id) setActiveSection(visibleEntries[0].target.id);
    },
    { rootMargin: "-34% 0px -52% 0px", threshold: [0.08, 0.22, 0.4, 0.58] },
  );

  sections.forEach((section) => observer.observe(section));
}

function getActiveLanguage() {
  return document.documentElement.lang === "zh-CN" ? "zh" : "en";
}

function getShowcaseLayerIds(root) {
  return String(root.dataset.showcaseLayerIds || Object.keys(SHOWCASE_LAYER_COPY_KEYS).join(","))
    .split(",")
    .map((layer) => layer.trim())
    .filter(Boolean);
}

function isShowcaseLayerAllowed(root, layer) {
  return getShowcaseLayerIds(root).includes(layer) && Object.prototype.hasOwnProperty.call(SHOWCASE_LAYER_COPY_KEYS, layer);
}

function resolveShowcaseLayer(root, layer) {
  if (isShowcaseLayerAllowed(root, layer)) {
    delete root.dataset.showcaseLayerError;
    return layer;
  }
  root.dataset.showcaseLayerError = layer || "missing";
  return null;
}

function setShowcaseStatus(root, visible) {
  const status = root.querySelector("[data-showcase-status]");
  if (status) status.hidden = !visible;
}

function isReducedMotionPreferred() {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
}

async function loadShowcaseMetadata(root) {
  if (!globalThis.fetch) return;
  const response = await fetch(SHOWCASE_METADATA_URL);
  if (!response.ok) throw new Error(`Unable to load ${SHOWCASE_METADATA_URL}`);
  const metadata = await response.json();
  const layerIds = Array.isArray(metadata?.layers)
    ? metadata.layers.map((layer) => String(layer?.id || "").trim()).filter(Boolean)
    : [];
  if (!layerIds.length) throw new Error("Europe showcase metadata is missing layers");
  root.dataset.showcaseLayerIds = layerIds.join(",");
}

function setShowcaseSvgLayer(root) {
  const layer = resolveShowcaseLayer(root, root.dataset.showcaseLayer || DEFAULT_SHOWCASE_LAYER);
  if (!layer) return;
  const objectNode = root.querySelector("[data-showcase-object]");
  if (!objectNode?.contentDocument) return;
  const svg = objectNode.contentDocument.querySelector("svg");
  if (!svg) return;
  // 这里写入 SVG 根节点属性，真实显隐由生成 SVG 内的 CSS/SMIL 合同执行。
  svg.setAttribute("data-active-layer", layer);
  const animationState = layer === "day-night" && !isReducedMotionPreferred() ? "running" : "paused";
  svg.setAttribute("data-showcase-animation", animationState);
  if (animationState === "running") {
    svg.unpauseAnimations?.();
  } else {
    svg.pauseAnimations?.();
  }
}

function getShowcaseCityDetail(scaleIndex) {
  if (scaleIndex >= 4) return "dense";
  if (scaleIndex >= 3) return "regional";
  if (scaleIndex >= 2) return "expanded";
  return "base";
}

function getShowcaseSvgViewport(root) {
  const objectNode = root.querySelector("[data-showcase-object]");
  if (!objectNode?.contentDocument) return null;
  return objectNode.contentDocument.querySelector("[data-showcase-viewport]");
}

function getShowcaseViewState(root) {
  const scaleIndex = Number.parseInt(root.dataset.showcaseViewScaleIndex || "0", 10);
  return {
    scaleIndex: Number.isNaN(scaleIndex) ? 0 : Math.max(0, Math.min(scaleIndex, SHOWCASE_VIEW_SCALES.length - 1)),
    x: Number.parseFloat(root.dataset.showcaseViewX || "0") || 0,
    y: Number.parseFloat(root.dataset.showcaseViewY || "0") || 0,
  };
}

function clampShowcaseViewPosition(scale, x, y) {
  if (scale <= 1) return { x: 0, y: 0 };
  return {
    x: Math.max(SHOWCASE_VIEW_WIDTH * (1 - scale), Math.min(0, x)),
    y: Math.max(SHOWCASE_VIEW_HEIGHT * (1 - scale), Math.min(0, y)),
  };
}

function getCenteredShowcaseViewPosition(scale) {
  if (scale <= 1) return { x: 0, y: 0 };
  return {
    x: (SHOWCASE_VIEW_WIDTH * (1 - scale)) / 2,
    y: (SHOWCASE_VIEW_HEIGHT * (1 - scale)) / 2,
  };
}

function applyShowcaseViewState(root, nextState) {
  const scaleIndex = Math.max(0, Math.min(nextState.scaleIndex, SHOWCASE_VIEW_SCALES.length - 1));
  const scale = SHOWCASE_VIEW_SCALES[scaleIndex];
  const position = clampShowcaseViewPosition(scale, nextState.x, nextState.y);
  // data-* 同时驱动外层 CSS、嵌入 SVG 的城市细节层和测试合同，更新时要保持同一波次。
  root.dataset.showcaseViewScaleIndex = String(scaleIndex);
  root.dataset.showcaseViewScale = scale.toFixed(2);
  root.dataset.showcaseViewZoomed = scaleIndex > DEFAULT_SHOWCASE_VIEW_SCALE_INDEX ? "true" : "false";
  root.dataset.showcaseCityDetail = getShowcaseCityDetail(scaleIndex);
  root.dataset.showcaseViewX = position.x.toFixed(1);
  root.dataset.showcaseViewY = position.y.toFixed(1);
  const viewport = getShowcaseSvgViewport(root);
  if (viewport) {
    viewport.setAttribute("transform", `matrix(${scale} 0 0 ${scale} ${position.x.toFixed(1)} ${position.y.toFixed(1)})`);
  }
  const objectNode = root.querySelector("[data-showcase-object]");
  const svg = objectNode?.contentDocument?.querySelector("svg");
  const touchAction = scaleIndex > DEFAULT_SHOWCASE_VIEW_SCALE_INDEX ? "none" : "pan-y";
  if (objectNode?.style) {
    objectNode.style.touchAction = touchAction;
  }
  if (svg) {
    svg.setAttribute("data-showcase-city-detail", root.dataset.showcaseCityDetail);
    if (svg.style) {
      svg.style.touchAction = touchAction;
    }
  }
}

function zoomShowcaseView(root, direction) {
  const state = getShowcaseViewState(root);
  const currentScale = SHOWCASE_VIEW_SCALES[state.scaleIndex];
  const nextScaleIndex = Math.max(0, Math.min(state.scaleIndex + direction, SHOWCASE_VIEW_SCALES.length - 1));
  const nextScale = SHOWCASE_VIEW_SCALES[nextScaleIndex];
  const centerX = (SHOWCASE_VIEW_WIDTH / 2 - state.x) / currentScale;
  const centerY = (SHOWCASE_VIEW_HEIGHT / 2 - state.y) / currentScale;
  applyShowcaseViewState(root, {
    scaleIndex: nextScaleIndex,
    x: SHOWCASE_VIEW_WIDTH / 2 - centerX * nextScale,
    y: SHOWCASE_VIEW_HEIGHT / 2 - centerY * nextScale,
  });
}

function resetShowcaseView(root) {
  const scale = SHOWCASE_VIEW_SCALES[DEFAULT_SHOWCASE_VIEW_SCALE_INDEX];
  const position = getCenteredShowcaseViewPosition(scale);
  applyShowcaseViewState(root, {
    scaleIndex: DEFAULT_SHOWCASE_VIEW_SCALE_INDEX,
    x: position.x,
    y: position.y,
  });
}

function isModifiedZoomWheelEvent(event) {
  return Boolean(event.ctrlKey || event.metaKey || event.altKey);
}

function initShowcaseView() {
  const root = document.querySelector("[data-showcase-root]");
  if (!root) return;

  const objectNode = root.querySelector("[data-showcase-object]");
  if (!objectNode) return;

  let dragState = null;

  const onWheel = (event) => {
    if (!isModifiedZoomWheelEvent(event)) return;
    event.preventDefault();
    zoomShowcaseView(root, event.deltaY < 0 ? 1 : -1);
  };

  const onDoubleClick = (event) => {
    event.preventDefault();
    const state = getShowcaseViewState(root);
    if (state.scaleIndex <= DEFAULT_SHOWCASE_VIEW_SCALE_INDEX) {
      zoomShowcaseView(root, 1);
    } else {
      resetShowcaseView(root);
    }
  };

  const onPointerDown = (event) => {
    const state = getShowcaseViewState(root);
    if (state.scaleIndex <= DEFAULT_SHOWCASE_VIEW_SCALE_INDEX) return;
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      viewX: state.x,
      viewY: state.y,
    };
    root.dataset.showcaseViewDragging = "true";
    event.currentTarget?.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    applyShowcaseViewState(root, {
      scaleIndex: getShowcaseViewState(root).scaleIndex,
      x: dragState.viewX + event.clientX - dragState.startX,
      y: dragState.viewY + event.clientY - dragState.startY,
    });
  };

  const onPointerEnd = (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    event.currentTarget?.releasePointerCapture?.(event.pointerId);
    dragState = null;
    delete root.dataset.showcaseViewDragging;
  };

  const onKeyDown = (event) => {
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomShowcaseView(root, 1);
      return;
    }
    if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      zoomShowcaseView(root, -1);
      return;
    }
    if (event.key === "0" || event.key === "Escape") {
      event.preventDefault();
      resetShowcaseView(root);
    }
  };

  const bindEmbeddedSvg = () => {
    applyShowcaseViewState(root, getShowcaseViewState(root));
    const svg = objectNode.contentDocument?.querySelector("svg");
    if (!svg || svg.dataset.showcaseViewBound === "true") return;
    svg.dataset.showcaseViewBound = "true";
    // <object> 内部 SVG 有独立 document，外层 object 和内层 svg 都要绑定，才能同时覆盖加载前后事件。
    svg.addEventListener("wheel", onWheel, { passive: false });
    svg.addEventListener("pointerdown", onPointerDown);
    svg.addEventListener("pointermove", onPointerMove);
    svg.addEventListener("pointerup", onPointerEnd);
    svg.addEventListener("pointercancel", onPointerEnd);
    svg.addEventListener("dblclick", onDoubleClick);
  };

  objectNode.addEventListener("wheel", onWheel, { passive: false });
  objectNode.addEventListener("pointerdown", onPointerDown);
  objectNode.addEventListener("pointermove", onPointerMove);
  objectNode.addEventListener("pointerup", onPointerEnd);
  objectNode.addEventListener("pointercancel", onPointerEnd);
  objectNode.addEventListener("keydown", onKeyDown);
  objectNode.addEventListener("dblclick", onDoubleClick);
  objectNode.addEventListener("load", bindEmbeddedSvg);
  resetShowcaseView(root);
  bindEmbeddedSvg();
}

function updateShowcaseLayerCopy(language = getActiveLanguage()) {
  const root = document.querySelector("[data-showcase-root]");
  if (!root) return;
  const layer = resolveShowcaseLayer(root, root.dataset.showcaseLayer || DEFAULT_SHOWCASE_LAYER);
  if (!layer) return;
  const keys = SHOWCASE_LAYER_COPY_KEYS[layer];
  const copy = translations[language] || translations.en;
  const badge = root.querySelector("[data-showcase-layer-badge]");
  const title = root.querySelector("[data-showcase-layer-title]");
  const body = root.querySelector("[data-showcase-layer-body]");
  if (badge) badge.textContent = copy[keys.badge];
  if (title) title.textContent = copy[keys.title];
  if (body) body.textContent = copy[keys.body];
}

function initShowcaseLayers() {
  const root = document.querySelector("[data-showcase-root]");
  if (!root) return;

  const tabs = Array.from(root.querySelectorAll("[data-showcase-layer-tab]"));
  const panel = root.querySelector("[role=\"tabpanel\"]");
  if (!tabs.length) return;

  const selectLayer = (tab, shouldFocus = false) => {
    const layer = resolveShowcaseLayer(root, tab.getAttribute("data-showcase-layer-tab") || DEFAULT_SHOWCASE_LAYER);
    if (!layer) return;
    setShowcaseStatus(root, false);
    root.dataset.showcaseLayer = layer;

    tabs.forEach((item) => {
      const active = item === tab;
      item.setAttribute("aria-selected", active ? "true" : "false");
      item.setAttribute("tabindex", active ? "0" : "-1");
    });
    if (panel && tab.id) panel.setAttribute("aria-labelledby", tab.id);

    updateShowcaseLayerCopy();
    setShowcaseSvgLayer(root);
    if (shouldFocus) tab.focus();
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectLayer(tab));
    tab.addEventListener("keydown", (event) => {
      const key = event.key;
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) return;
      event.preventDefault();

      let nextIndex = index;
      if (key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
      if (key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
      if (key === "Home") nextIndex = 0;
      if (key === "End") nextIndex = tabs.length - 1;

      selectLayer(tabs[nextIndex], true);
    });
  });

  const objectNode = root.querySelector("[data-showcase-object]");
  objectNode?.addEventListener("load", () => setShowcaseSvgLayer(root));
  const motionQuery = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
  motionQuery?.addEventListener?.("change", () => setShowcaseSvgLayer(root));
  motionQuery?.addListener?.(() => setShowcaseSvgLayer(root));
  loadShowcaseMetadata(root)
    .then(() => {
      setShowcaseStatus(root, false);
      const selectedTab = tabs.find((tab) => tab.getAttribute("aria-selected") === "true") || tabs[0];
      selectLayer(selectedTab);
    })
    .catch((error) => {
      root.dataset.showcaseLayerError = "metadata";
      setShowcaseStatus(root, true);
    });
  updateShowcaseLayerCopy();
  setShowcaseSvgLayer(root);
}

function getPreviewViewState(root) {
  const scaleIndex = Number.parseInt(root.dataset.previewScaleIndex || "0", 10);
  return {
    scaleIndex: Number.isNaN(scaleIndex) ? 0 : Math.max(0, Math.min(scaleIndex, PREVIEW_VIEW_SCALES.length - 1)),
    x: Number.parseFloat(root.dataset.previewX || "0") || 0,
    y: Number.parseFloat(root.dataset.previewY || "0") || 0,
  };
}

function clampPreviewViewPosition(scale, x, y) {
  if (scale <= 1) return { x: 0, y: 0 };
  return {
    x: Math.max(PREVIEW_VIEW_WIDTH * (1 - scale), Math.min(0, x)),
    y: Math.max(PREVIEW_VIEW_HEIGHT * (1 - scale), Math.min(0, y)),
  };
}

function applyPreviewViewState(root, nextState) {
  const scaleIndex = Math.max(0, Math.min(nextState.scaleIndex, PREVIEW_VIEW_SCALES.length - 1));
  const scale = PREVIEW_VIEW_SCALES[scaleIndex];
  const position = clampPreviewViewPosition(scale, nextState.x, nextState.y);
  root.dataset.previewScaleIndex = String(scaleIndex);
  root.dataset.previewScale = scale.toFixed(2);
  root.dataset.previewZoomed = scale > 1 ? "true" : "false";
  root.dataset.previewX = position.x.toFixed(1);
  root.dataset.previewY = position.y.toFixed(1);
  const viewport = root.querySelector("[data-preview-viewport]");
  if (viewport) {
    viewport.style.setProperty("--preview-scale", scale.toFixed(2));
    viewport.style.setProperty("--preview-x", `${position.x.toFixed(1)}px`);
    viewport.style.setProperty("--preview-y", `${position.y.toFixed(1)}px`);
  }
}

function zoomPreviewView(root, direction) {
  const state = getPreviewViewState(root);
  const currentScale = PREVIEW_VIEW_SCALES[state.scaleIndex];
  const nextScaleIndex = Math.max(0, Math.min(state.scaleIndex + direction, PREVIEW_VIEW_SCALES.length - 1));
  const nextScale = PREVIEW_VIEW_SCALES[nextScaleIndex];
  const centerX = (PREVIEW_VIEW_WIDTH / 2 - state.x) / currentScale;
  const centerY = (PREVIEW_VIEW_HEIGHT / 2 - state.y) / currentScale;
  applyPreviewViewState(root, {
    scaleIndex: nextScaleIndex,
    x: PREVIEW_VIEW_WIDTH / 2 - centerX * nextScale,
    y: PREVIEW_VIEW_HEIGHT / 2 - centerY * nextScale,
  });
}

function resetPreviewView(root) {
  applyPreviewViewState(root, { scaleIndex: 0, x: 0, y: 0 });
}

function getPreviewImageForMode(root, mode) {
  return Array.from(root.querySelectorAll("[data-preview-image]")).find(
    (image) => image.getAttribute("data-preview-image") === mode,
  );
}

function syncPreviewImageStatus(root) {
  const status = root.querySelector("[data-preview-status]");
  if (!status) return;
  const mode = root.dataset.previewMode || "transport";
  const image = getPreviewImageForMode(root, mode);
  const failed = image?.dataset.previewLoadError === "true";
  status.hidden = !failed;
  if (failed) {
    root.dataset.previewImageError = mode;
  } else {
    delete root.dataset.previewImageError;
  }
}

function initPreviewImageStatus(root) {
  const images = Array.from(root.querySelectorAll("[data-preview-image]"));
  images.forEach((image) => {
    if (image.complete === true && image.naturalWidth === 0 && image.getAttribute("src")) {
      image.dataset.previewLoadError = "true";
    }
    image.addEventListener("error", () => {
      image.dataset.previewLoadError = "true";
      syncPreviewImageStatus(root);
    });
    image.addEventListener("load", () => {
      delete image.dataset.previewLoadError;
      syncPreviewImageStatus(root);
    });
  });
  syncPreviewImageStatus(root);
}

function initPreviewView() {
  const root = document.querySelector("[data-preview-root]");
  const surface = root?.querySelector("[data-preview-surface]");
  if (!root || !surface) return;

  let dragState = null;

  const onPointerDown = (event) => {
    if (event.target?.closest?.("[data-preview-zoom]")) return;
    const state = getPreviewViewState(root);
    if (PREVIEW_VIEW_SCALES[state.scaleIndex] <= 1) return;
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      viewX: state.x,
      viewY: state.y,
    };
    root.dataset.previewDragging = "true";
    event.currentTarget?.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    applyPreviewViewState(root, {
      scaleIndex: getPreviewViewState(root).scaleIndex,
      x: dragState.viewX + event.clientX - dragState.startX,
      y: dragState.viewY + event.clientY - dragState.startY,
    });
  };

  const onPointerEnd = (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    event.currentTarget?.releasePointerCapture?.(event.pointerId);
    dragState = null;
    delete root.dataset.previewDragging;
  };

  surface.addEventListener("wheel", (event) => {
    if (!isModifiedZoomWheelEvent(event)) return;
    event.preventDefault();
    zoomPreviewView(root, event.deltaY < 0 ? 1 : -1);
  }, { passive: false });
  surface.addEventListener("pointerdown", onPointerDown);
  surface.addEventListener("pointermove", onPointerMove);
  surface.addEventListener("pointerup", onPointerEnd);
  surface.addEventListener("pointercancel", onPointerEnd);
  surface.addEventListener("dblclick", () => {
    if (getPreviewViewState(root).scaleIndex > 0) {
      resetPreviewView(root);
    } else {
      zoomPreviewView(root, 1);
    }
  });
  surface.addEventListener("keydown", (event) => {
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomPreviewView(root, 1);
    }
    if (event.key === "-") {
      event.preventDefault();
      zoomPreviewView(root, -1);
    }
    if (event.key === "0" || event.key === "Escape") {
      event.preventDefault();
      resetPreviewView(root);
    }
  });
  root.querySelectorAll("[data-preview-zoom]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.getAttribute("data-preview-zoom");
      if (action === "reset") {
        resetPreviewView(root);
      } else {
        zoomPreviewView(root, action === "1" ? 1 : -1);
      }
    });
  });
  initPreviewImageStatus(root);
  resetPreviewView(root);
}

function initPreviewTabs() {
  const root = document.querySelector("[data-preview-root]");
  if (!root) return;

  const tabs = Array.from(root.querySelectorAll("[data-preview-tab]"));
  const panels = Array.from(document.querySelectorAll("[data-preview-panel]"));
  if (!tabs.length || !panels.length) return;

  const selectTab = (tab, shouldFocus = false) => {
    const mode = tab.getAttribute("data-preview-tab");
    if (!mode) return;
    root.dataset.previewMode = mode;

    tabs.forEach((item) => {
      const active = item === tab;
      item.setAttribute("aria-selected", active ? "true" : "false");
      item.setAttribute("tabindex", active ? "0" : "-1");
    });

    panels.forEach((panel) => {
      panel.hidden = panel.getAttribute("data-preview-panel") !== mode;
    });

    syncPreviewImageStatus(root);

    if (shouldFocus) tab.focus();
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTab(tab));
    tab.addEventListener("keydown", (event) => {
      const key = event.key;
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) return;
      event.preventDefault();

      let nextIndex = index;
      if (key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
      if (key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
      if (key === "Home") nextIndex = 0;
      if (key === "End") nextIndex = tabs.length - 1;

      selectTab(tabs[nextIndex], true);
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const initialLanguage = getStoredLanguage();
  applyLanguage(initialLanguage);
  document.querySelectorAll("[data-lang]").forEach((button) => {
    button.addEventListener("click", () => {
      applyLanguage(button.getAttribute("data-lang") === "zh" ? "zh" : "en");
    });
  });
  initPreviewTabs();
  initPreviewView();
  initSampleRunsGallery();
  initProductStory();
  initShowcaseLayers();
  initShowcaseView();
  initHeroMap();
  initTopbarState();
  initScrollSpy();
  initMetricCountUp();
  initScrollReveal();
});

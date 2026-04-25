// Transport workbench copy and descriptor catalog.
// Controller code imports these data-only contracts and keeps rendering/event logic local.

export const TRANSPORT_WORKBENCH_FAMILIES = [
  {
    id: "road",
    label: "Road",
    title: "Road workbench",
    lensTitle: "Japan road adapter",
    /*
    lensBody: "Japan road 妫ｆ牜澧楅崶鍝勭暰娑?OSM / Geofabrik Japan 娑撹鍤戞担鏇礉閸旂姳绗?N06 妤傛﹢鈧喕闊╂禒钘夊閸ユ亽鈧?,
    lensNext: "閸欘亜浠?motorway / trunk / primary閿涘苯濮?road_labels閿涘奔绗夌喊棰佺鞍闁哎鈧购outing 閸?secondary 閸欏﹣浜掓稉瀣ㄢ偓?,
    previewTitle: "Road carrier",
    previewCaption: "Japan carrier 瀹告彃姘ㄦ担宥冣偓淇給ad 閻ㄥ嫮婀＄€?overlay 鏉╂ɑ鐥呴幒銉у殠閿涘本澧嶆禒銉ㄧ箹闁插苯鍘涚拫鍐潐閸掓瑥鎷伴弽宄扮础閿涘奔绗夋导顏堚偓?geometry閵?,
    inspectorTitle: "Road inspector",
    inspectorBody: "瑜版挸澧犳潻妯荤梾閺堝婀＄€?road 鐟曚胶绀岄崣顖炩偓澶堚偓鍌氬礁娓氀冨帥鐟欙綁鍣存担鐘靛箛閸︺劏绻栨總?Japan road 鐟欏嫬鍨导姘偓搴㈢壉鏉╂稑鍙?pack閵?,
    inspectorEmptyTitle: "Waiting for real road packs",
    inspectorEmptyBody: "roads 閸?road_labels Japan packs 娑撯偓閺冿附甯撮崗銉礉鏉╂瑩鍣风亸鍗炲瀼閸掓壆婀＄€圭偞顔岄拃钘夋嫲 ref 閻ㄥ嫯顩︾槐鐘愁梾閺屻儯鈧?,
    supportsDetailedControls: true,
    */
    lensBody: "Japan road now loads a real preview pack built from Geofabrik geometry with N06 motorway hardening.",
    lensNext: "The live slice stays on motorway, trunk, primary, and road_labels. Links are carried for review but stay filtered by default.",
    previewTitle: "Road carrier",
    previewCaption: "The carrier now shows real Japan road geometry. Use the left column to stress the rules and the inspector to verify real segments and refs.",
    inspectorTitle: "Road inspector",
    inspectorBody: "The inspector now reads from the live Japan road preview pack and reports why a segment is shown, hidden, or conflict-marked.",
    inspectorEmptyTitle: "No road feature selected",
    inspectorEmptyBody: "Click a road segment or ref label in the carrier to inspect real source, class, and hardening details.",
    supportsDetailedControls: true,
  },
  {
    id: "rail",
    label: "Rail",
    title: "Rail workbench",
    lensTitle: "Japan rail adapter",
    /*
    lensBody: "Japan rail 妫ｆ牜澧楅崶鍝勭暰娑撳搫鐣奸弬?active 娑撹崵缍夌紒婊愮礉閸?OSM lifecycle / gap patch閵?,
    lensNext: "閸欘亜浠?railways 閸?major stations閿涘奔绗夌喊鏉垮弿闁插繒鐝悙骞库偓涔簅uting閵嗕焦妞傛惔蹇氱箥鐞涘苯娴橀崪灞筋槻閺夊倽绻嶉拃銉﹀瘹閺嶅洢鈧?,
    previewTitle: "Rail carrier",
    previewCaption: "Japan carrier 瀹告彃姘ㄦ担宥冣偓淇絘il 閻ㄥ嫮婀＄€?overlay 鏉╂ɑ鐥呴幒銉у殠閿涘本澧嶆禒銉ㄧ箹闁插苯鍘涢幎濠勫Ц閹降鈧胶鐡戠痪褍鎷?station 鐟欏嫬鍨崢瀣杽閵?,
    inspectorTitle: "Rail inspector",
    inspectorBody: "瑜版挸澧犳潻妯荤梾閺堝婀＄€?rail 鐟曚胶绀岄崣顖炩偓澶堚偓鍌氬礁娓氀冨帥鐟欙綁鍣存担鐘靛箛閸︺劏绻栨總?Japan rail 鐟欏嫬鍨导姘偓搴㈢壉閽€钘夊煂鐎规ɑ鏌熷┃鎰嫲 OSM patch 娑撳鈧?,
    inspectorEmptyTitle: "Waiting for real rail packs",
    inspectorEmptyBody: "railways 閸?rail_stations_major Japan packs 閹恒儱鍙嗛崥搴礉鏉╂瑩鍣锋导姘▔缁€铏规埂鐎圭偟鍤庣捄顖氭嫲娑撴槒顩︽潪锔剧彲鐟欙綁鍣撮妴?,
    supportsDetailedControls: true,
    */
    lensBody: "Japan rail baseline uses the official active network with OSM lifecycle and gap patches.",
    lensNext: "Scope stays on railways and major stations. No full station product, routing, timetable, or heavy operations metrics.",
    previewTitle: "Rail carrier",
    previewCaption: "The Japan carrier now renders the real rail pack and keeps national trunk lines visually ahead of city-scale service rail.",
    inspectorTitle: "Rail inspector",
    inspectorBody: "This side switches to real Japan rail line and station inspection as soon as the deferred packs exist. Until then it reports the pending contract instead of inventing sample data.",
    inspectorEmptyTitle: "No rail feature selected",
    inspectorEmptyBody: "Click a rail line or major station in the carrier to inspect the real source, class, and station importance data.",
    supportsDetailedControls: true,
  },
  {
    id: "airport",
    label: "Airport",
    title: "Airport workbench",
    lensTitle: "Airport facility lens",
    lensBody: "Airport now runs on the official C28 source and stays anchored to official airport reference points.",
    lensNext: "The first live airport pass stays on facility points only. Routes, terminals, and remote outer-island scope remain out of v1.",
    previewTitle: "Airport carrier",
    previewCaption: "The carrier now shows real Japan airport points with official class, status, and importance filters.",
    inspectorTitle: "Airport inspector",
    inspectorBody: "The inspector now reads directly from the live Japan airport pack and preserves the original Japanese source fields.",
    inspectorEmptyTitle: "No airport selected",
    inspectorEmptyBody: "Click an airport point or label in the carrier to inspect the live source attributes.",
    supportsDetailedControls: true,
  },
  {
    id: "port",
    label: "Port",
    title: "Port workbench",
    lensTitle: "Port facility lens",
    lensBody: "Port now runs on the official C02 node source with explicit CP932 ingestion and internal-trial-only governance.",
    lensNext: "The first live port pass stays on major legal designations only. Harbor polygons and district boundaries remain out of v1.",
    previewTitle: "Port carrier",
    previewCaption: "The carrier now shows real major port nodes with legal designation and manager filters.",
    inspectorTitle: "Port inspector",
    inspectorBody: "The inspector now reads directly from the live Japan port pack and keeps internal-trial release constraints visible.",
    inspectorEmptyTitle: "No port selected",
    inspectorEmptyBody: "Click a port point or label in the carrier to inspect the live source attributes.",
    supportsDetailedControls: true,
  },
  {
    id: "mineral_resources",
    label: "Mineral Resources",
    title: "Mineral resource workbench",
    lensTitle: "Mineral resource lens",
    lensBody: "Mineral resources now carry a governed local pack built from the GSJ mine distribution source and clipped to the Japan four-islands carrier mask.",
    lensNext: "The carrier now renders the live mineral point pack directly. Taxonomy stays conservative for v1, so review focuses on real site attributes, labels, and governed source lineage.",
    previewTitle: "Mineral carrier",
    previewCaption: "The carrier now shows live mineral points and keeps source lineage, clipping scope, and site attributes explicit.",
    inspectorTitle: "Mineral inspector",
    inspectorBody: "This side now reads directly from the live mineral point pack and keeps pack governance visible without inventing a synthetic mineral score.",
    inspectorEmptyTitle: "No mineral site selected",
    inspectorEmptyBody: "Click a mineral point or label in the carrier to inspect the live source attributes.",
    supportsDetailedControls: true,
  },
  {
    id: "energy_facilities",
    label: "Energy Facilities",
    title: "Energy facility workbench",
    lensTitle: "Energy facility lens",
    lensBody: "Energy facilities now expose a governed local pack for official MLIT power-plant subtypes while broader energy categories stay split out as reference-only.",
    lensNext: "The carrier now renders the local energy points directly. Only approved local subtypes enter the map, while reference-only subtypes stay visible in diagnostics and out of the feature set.",
    previewTitle: "Energy carrier",
    previewCaption: "The carrier now shows live energy facilities and keeps local versus reference-only subtype scope explicit.",
    inspectorTitle: "Energy inspector",
    inspectorBody: "This side now reads directly from the live energy facility pack and keeps subtype availability, status, and source governance visible.",
    inspectorEmptyTitle: "No energy facility selected",
    inspectorEmptyBody: "Click an energy point or label in the carrier to inspect the live source attributes.",
    supportsDetailedControls: true,
  },
  {
    id: "industrial_zones",
    label: "Industrial Land",
    title: "Industrial land workbench",
    lensTitle: "Industrial land lens",
    lensBody: "Industrial land now runs as a dual-track polygon family: official L05 stays internal, while the open variant stays source-separated on OSM industrial polygons.",
    lensNext: "The carrier now renders one variant at a time. Internal stays the default review track, while the open variant stays source-separated and opt-in.",
    previewTitle: "Industrial land carrier",
    previewCaption: "The carrier now shows the live industrial polygon pack and keeps internal versus open provenance explicit instead of fusing them.",
    inspectorTitle: "Industrial land inspector",
    inspectorBody: "This side now reports the active industrial-land variant, source lineage, build counts, and the selected polygon attributes without inventing one merged polygon truth.",
    inspectorEmptyTitle: "No industrial polygon selected",
    inspectorEmptyBody: "Click an industrial polygon in the carrier to inspect its active variant, source member, and site attributes.",
    supportsDetailedControls: true,
  },
  {
    id: "logistics_hubs",
    label: "Logistics Hubs",
    title: "Logistics hub workbench",
    lensTitle: "Logistics supplement lens",
    lensBody: "Logistics hubs now load as a real supplement layer from official P31 point features and stay separate from industrial land polygons.",
    lensNext: "This first pass exposes the point layer honestly, keeps raw category codes visible, and does not force a fake merged industrial-logistics index.",
    previewTitle: "Logistics carrier",
    previewCaption: "The carrier now shows real Japan logistics hub points as a supplement to industrial land review.",
    inspectorTitle: "Logistics hub inspector",
    inspectorBody: "This side reads directly from the live P31 logistics-hub pack and keeps the internal-first source constraints visible.",
    inspectorEmptyTitle: "No logistics hub selected",
    inspectorEmptyBody: "Click a logistics hub point in the carrier to inspect its live source attributes.",
    supportsDetailedControls: true,
  },
  {
    id: "layers",
    label: "Layers",
    title: "Layer order board",
    lensTitle: "Transport layer order",
    lensBody: "This board controls future draw order across the eight transport families instead of hard-coding one fixed stacking rule.",
    lensNext: "Multiple families are live now, but this board still stays local so each renderer can consume one explicit draw order.",
    previewTitle: "Layer order board",
    previewCaption: "Use the center frame to drag families into the order you want future transport layers to draw.",
    inspectorTitle: "Layer order status",
    inspectorBody: "The inspector mirrors the current local layer order so later family renderers can consume it directly.",
    inspectorEmptyTitle: "Layer order ready",
    inspectorEmptyBody: "Reorder the 8 transport families in the center board. This order currently stays local to the Transport workbench.",
  },
];

export const ROAD_CLASS_OPTIONS = [
  { value: "motorway", label: "Motorway" },
  { value: "trunk", label: "Trunk" },
  { value: "primary", label: "Primary" },
];

export const ROAD_REF_CLASS_OPTIONS = [
  ...ROAD_CLASS_OPTIONS,
  { value: "secondary", label: "Secondary", disabled: true },
  { value: "tertiary", label: "Tertiary", disabled: true },
];

export const RAIL_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "disused", label: "Disused" },
  { value: "abandoned", label: "Abandoned" },
  { value: "construction", label: "Construction" },
];

export const RAIL_CLASS_OPTIONS = [
  { value: "high_speed", label: "High speed" },
  { value: "trunk", label: "Trunk" },
  { value: "branch", label: "Branch" },
  { value: "service", label: "Service" },
];

export const AIRPORT_TYPE_OPTIONS = [
  { value: "company_managed", label: "Company managed" },
  { value: "national", label: "National" },
  { value: "specific_local", label: "Specific local" },
  { value: "local", label: "Local" },
  { value: "other", label: "Other" },
  { value: "shared", label: "Shared" },
];

export const AIRPORT_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "unknown", label: "Unknown" },
];

export const PORT_DESIGNATION_OPTIONS = [
  { value: "international_strategy", label: "International strategy" },
  { value: "international_hub", label: "International hub" },
  { value: "important", label: "Important" },
  { value: "local", label: "Local" },
  { value: "shelter", label: "Shelter / special-use" },
];

export const PORT_MANAGER_TYPE_OPTIONS = [
  { value: "1", label: "Prefecture" },
  { value: "2", label: "Municipality" },
  { value: "3", label: "Port authority" },
  { value: "4", label: "Joint authority" },
  { value: "5", label: "Other" },
];

export const INDUSTRIAL_VARIANT_OPTIONS = [
  { value: "internal", label: "Internal official" },
  { value: "open", label: "Open OSM" },
];

export const INDUSTRIAL_SITE_CLASS_OPTIONS = [
  { value: "industrial_complex", label: "Industrial complex" },
  { value: "isolated_industrial_site", label: "Isolated industrial site" },
  { value: "industrial_landuse", label: "Industrial landuse" },
];

export const INDUSTRIAL_COASTAL_OPTIONS = [
  { value: "coastal", label: "Coastal" },
  { value: "inland", label: "Inland" },
];

export const LOGISTICS_HUB_TYPE_OPTIONS = [
  { value: "air_cargo_terminal", label: "Air cargo terminal" },
  { value: "bonded_area", label: "Bonded area" },
  { value: "container_terminal", label: "Container terminal" },
  { value: "rail_cargo_station", label: "Rail cargo station" },
  { value: "truck_terminal", label: "Truck terminal" },
  { value: "wholesale_market", label: "Wholesale market" },
];

export const LOGISTICS_OPERATOR_CLASSIFICATION_OPTIONS = [
  { value: "public", label: "Public" },
  { value: "private", label: "Private" },
  { value: "other", label: "Other" },
];

export const ENERGY_STATUS_OPTIONS = [
  { value: "existing", label: "Existing" },
  { value: "under_construction", label: "Under construction" },
  { value: "construction_preparation", label: "Construction preparation" },
];

export const TRANSPORT_WORKBENCH_LABEL_DENSITY_OPTIONS = [
  { value: "very_sparse", label: "Very sparse" },
  { value: "sparse", label: "Sparse" },
  { value: "balanced", label: "Balanced" },
  { value: "dense", label: "Dense" },
  { value: "very_dense", label: "Very dense" },
];

export const TRANSPORT_WORKBENCH_DISPLAY_MODE_OPTIONS = [
  { value: "inspect", label: "Inspect" },
  { value: "aggregate", label: "Aggregate" },
  { value: "density", label: "Density" },
];

export const TRANSPORT_WORKBENCH_DISPLAY_PRESET_OPTIONS = [
  { value: "review_first", label: "Review first" },
  { value: "balanced", label: "Balanced" },
  { value: "pattern_first", label: "Pattern first" },
  { value: "extreme_density", label: "Extreme density" },
];

export const TRANSPORT_WORKBENCH_AGGREGATION_ALGORITHM_OPTIONS = [
  { value: "cluster", label: "Cluster" },
  { value: "hex", label: "Hex grid" },
  { value: "square", label: "Square grid" },
  { value: "density_surface", label: "Density surface" },
];

export const TRANSPORT_WORKBENCH_LABEL_LEVEL_OPTIONS = [
  { value: "region", label: "Region only" },
  { value: "anchor", label: "Geographic anchor" },
  { value: "category", label: "Anchor + category" },
];

export const TRANSPORT_WORKBENCH_INSPECTOR_TABS = [
  { id: "inspect", label: "Inspect" },
  { id: "display", label: "Display" },
  { id: "aggregation", label: "Aggregation" },
  { id: "labels", label: "Labels" },
  { id: "coverage", label: "Coverage" },
  { id: "data", label: "Data" },
];

export const TRANSPORT_WORKBENCH_INLINE_HELP_SECTIONS = {
  road: new Set(["source_hardening", "noise_control"]),
  rail: new Set(["source_reconciliation", "line_presentation"]),
};

export const TRANSPORT_WORKBENCH_INLINE_HELP_COPY = {
  road: {
    source_hardening: {
      title: "Source hardening",
      body: "This block decides how Japan road identity is stabilized before the pack is emitted. Keep geometry on the shared OSM corridor and use N06 only where motorway identity or official refs need deterministic reinforcement.",
    },
    noise_control: {
      title: "Noise control",
      body: "This block suppresses short or dense segments before they crowd the preview. The goal is not to invent heuristics, but to make motorway, trunk, and primary stay readable across Tokyo and Osaka at the same review zooms.",
    },
  },
  rail: {
    source_reconciliation: {
      title: "Source reconciliation",
      body: "This block explains how the official active network and OSM lifecycle patches resolve conflicts. Keep the official active backbone authoritative, and only let OSM fill explicit gaps or non-active status where the official source is silent.",
    },
    line_presentation: {
      title: "Line presentation",
      body: "This block decides how status and class differences are shown once the rail pack is wired. Active lines should stay structurally clear first, while branch, service, and inactive states remain secondary and never overpower the trunk network.",
    },
  },
};

export const TRANSPORT_WORKBENCH_DATA_CONTRACTS = {
  road: {
    country: "Japan",
    adapterId: "japan_road_v1",
    geometryKind: "line",
    packs: ["roads", "road_labels"],
    geometrySource: "OSM / Geofabrik Japan",
    hardeningSource: "N06 motorway identity",
    governance: "Local-source-only pack build with reproducible inputs, explicit diagnostics, and UTF-8-first Japanese text handling.",
    pendingStatus: "Load on demand from roads + road_labels Japan packs",
  },
  rail: {
    country: "Japan",
    adapterId: "japan_rail_v1",
    geometryKind: "line",
    packs: ["railways", "rail_stations_major"],
    geometrySource: "Official active network",
    hardeningSource: "OSM lifecycle / gap patch",
    governance: "Local-source-only pack build with UTF-8-first MLIT ingestion, CP932 fallback, repo-versioned overrides, and explicit diagnostics.",
    pendingStatus: "Waiting for railways + rail_stations_major Japan packs",
  },
  airport: {
    country: "Japan",
    adapterId: "japan_airport_v1",
    geometryKind: "point",
    packs: ["airports"],
    geometrySource: "Official airport point source",
    hardeningSource: "Administrative category / importance review",
    governance: "Deferred point pack aligned to the cityPoints-style load and visibility chain.",
    pendingStatus: "Waiting for airports Japan pack",
  },
  port: {
    country: "Japan",
    adapterId: "japan_port_v1",
    geometryKind: "point",
    packs: ["ports"],
    geometrySource: "Official or quasi-official major port node source",
    hardeningSource: "Official designation / coverage-tier review",
    governance: "Deferred point pack with tiered official coverage. Routes and harbor polygons stay out of v1, but the runtime can switch between core, expanded, and full official subsets.",
    pendingStatus: "Waiting for ports Japan pack",
  },
  mineral_resources: {
    country: "Japan",
    adapterId: "japan_mineral_resources_v1",
    geometryKind: "point",
    packs: ["mineral_resources"],
    geometrySource: "Official mineral resource distribution point source",
    hardeningSource: "Manual resource class normalization",
    governance: "Local static pack with UTF-8 storage, CP932 source decode, explicit four-islands clipping, and repo-versioned class normalization.",
    pendingStatus: "Waiting for mineral_resources Japan pack manifest",
  },
  energy_facilities: {
    country: "Japan",
    adapterId: "japan_energy_facilities_v1",
    geometryKind: "point",
    packs: ["energy_facilities"],
    geometrySource: "Official energy facility point source",
    hardeningSource: "Facility subtype and status normalization",
    governance: "Local static pack for verified MLIT power-plant subtypes, with broader energy categories kept in a reference-only subtype catalog until their source chain is approved.",
    pendingStatus: "Waiting for energy_facilities Japan pack manifest",
  },
  industrial_zones: {
    country: "Japan",
    adapterId: "japan_industrial_zones_v2",
    geometryKind: "polygon",
    packs: ["industrial_zones"],
    geometrySource: "Official L05 polygons + source-separated OSM industrial polygons",
    hardeningSource: "Variant split and source lineage governance",
    governance: "Dual-track polygon family. L05 stays internal-only, OSM stays publishable, and the two tracks are not merged into one synthetic geometry layer.",
    pendingStatus: "Waiting for industrial_zones Japan pack manifest",
  },
  logistics_hubs: {
    country: "Japan",
    adapterId: "japan_logistics_hubs_v1",
    geometryKind: "point",
    packs: ["logistics_hubs"],
    geometrySource: "Official P31 logistics hub point source",
    hardeningSource: "Main-islands clipping and explicit raw code preservation",
    governance: "Supplement point layer kept separate from industrial polygons. Internal-first release until the source path is approved for broader distribution.",
    pendingStatus: "Waiting for logistics_hubs Japan pack",
  },
};

export const TRANSPORT_WORKBENCH_TAB_SECTION_MAP = {
  road: {
    display: ["style"],
    aggregation: ["inclusion", "source_hardening", "noise_control"],
    labels: ["labels"],
    coverage: [],
    data: ["diagnostics"],
  },
  rail: {
    display: ["line_presentation", "style"],
    aggregation: ["network_scope", "source_reconciliation"],
    labels: ["major_stations"],
    coverage: [],
    data: ["diagnostics"],
  },
  airport: {
    display: ["style"],
    aggregation: [],
    labels: ["visibility"],
    coverage: ["facility_scope"],
    data: ["diagnostics"],
  },
  port: {
    display: ["display_mode", "style"],
    aggregation: ["aggregation_mode"],
    labels: ["label_strategy", "visibility"],
    coverage: ["facility_scope"],
    data: ["diagnostics"],
  },
  mineral_resources: {
    display: ["display_mode", "style"],
    aggregation: ["aggregation_mode"],
    labels: ["label_strategy", "visibility"],
    coverage: [],
    data: ["diagnostics"],
  },
  energy_facilities: {
    display: ["display_mode", "style"],
    aggregation: ["aggregation_mode"],
    labels: ["label_strategy", "visibility"],
    coverage: ["facility_scope"],
    data: ["diagnostics"],
  },
  industrial_zones: {
    display: ["display_mode", "style"],
    aggregation: ["aggregation_mode"],
    labels: ["label_strategy", "visibility"],
    coverage: ["data_variant", "filtering"],
    data: ["diagnostics"],
  },
  logistics_hubs: {
    display: ["display_mode", "style"],
    aggregation: ["aggregation_mode"],
    labels: ["label_strategy", "visibility"],
    coverage: ["facility_scope"],
    data: ["diagnostics"],
  },
  layers: {
    display: [],
    aggregation: [],
    labels: [],
    coverage: [],
    data: [],
  },
};

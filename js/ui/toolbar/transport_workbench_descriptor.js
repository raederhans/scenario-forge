// Transport workbench copy and descriptor catalog.
// Controller code imports these data-only contracts and keeps rendering/event logic local.

import {
  getTransportCapabilityFamilyMetadata,
  listTransportCapabilityFamilyIds,
} from "../../core/transport_capability_registry.js";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach((entry) => deepFreeze(entry));
  return Object.freeze(value);
}

const TRANSPORT_WORKBENCH_FAMILY_COPY = Object.freeze({
  road: Object.freeze({
    label: "Road",
    title: "Road workbench",
    lensTitle: "Review roads",
    lensBody: "Choose which major roads and route labels appear in the preview.",
    lensNext: "Motorway, trunk, and primary roads are available. Road links are hidden by default.",
    previewTitle: "Road preview",
    previewCaption: "Adjust the road rules on the left, then select a road or route label to inspect it.",
    inspectorTitle: "Road inspector",
    inspectorBody: "Select a road to see its class, route label, and visibility.",
    inspectorEmptyTitle: "No road feature selected",
    inspectorEmptyBody: "Select a road or route label to see its details.",
  }),
  rail: Object.freeze({
    label: "Rail",
    title: "Rail workbench",
    lensTitle: "Review railways",
    lensBody: "Choose which railway lines and major stations appear in the preview.",
    lensNext: "Use the network and status controls to focus the review.",
    previewTitle: "Rail preview",
    previewCaption: "Review lines and stations in the preview; main lines stay visually prominent.",
    inspectorTitle: "Rail inspector",
    inspectorBody: "Select a line or major station to see its status and source.",
    inspectorEmptyTitle: "No rail feature selected",
    inspectorEmptyBody: "Select a rail line or major station to see its details.",
  }),
  airport: Object.freeze({
    label: "Airport",
    title: "Airport workbench",
    lensTitle: "Airport facility lens",
    lensBody: "Filter airport points by type, status, and importance.",
    lensNext: "Select an airport to review its details.",
    previewTitle: "Airport preview",
    previewCaption: "Review airports by type, status, and importance.",
    inspectorTitle: "Airport inspector",
    inspectorBody: "Select an airport to see its type, status, and details.",
    inspectorEmptyTitle: "No airport selected",
    inspectorEmptyBody: "Select an airport to see its details.",
  }),
  port: Object.freeze({
    label: "Port",
    title: "Port workbench",
    lensTitle: "Port facility lens",
    lensBody: "Filter major ports by designation and manager.",
    lensNext: "Select a port to review its facilities and services.",
    previewTitle: "Port preview",
    previewCaption: "Review major ports by designation and manager.",
    inspectorTitle: "Port inspector",
    inspectorBody: "Select a port to see its designation, manager, and facilities.",
    inspectorEmptyTitle: "No port selected",
    inspectorEmptyBody: "Select a port to see its details.",
  }),
  mineral_resources: Object.freeze({
    label: "Mineral Resources",
    title: "Mineral resource workbench",
    lensTitle: "Mineral resource lens",
    lensBody: "Review mineral sites and their resource types.",
    lensNext: "Select a site to see its recorded attributes.",
    previewTitle: "Mineral preview",
    previewCaption: "Review mineral sites and select one for details.",
    inspectorTitle: "Mineral inspector",
    inspectorBody: "Select a mineral site to see its resource and work status.",
    inspectorEmptyTitle: "No mineral site selected",
    inspectorEmptyBody: "Select a mineral site to see its details.",
  }),
  energy_facilities: Object.freeze({
    label: "Energy Facilities",
    title: "Energy facility workbench",
    lensTitle: "Energy facility lens",
    lensBody: "Filter available energy facilities by subtype and status.",
    lensNext: "Reference-only categories are listed in Data and do not appear on the map.",
    previewTitle: "Energy preview",
    previewCaption: "Review available facilities; reference-only categories are listed in Data.",
    inspectorTitle: "Energy inspector",
    inspectorBody: "Select a facility to see its subtype, status, and operator.",
    inspectorEmptyTitle: "No energy facility selected",
    inspectorEmptyBody: "Select an energy facility to see its details.",
  }),
  industrial_zones: Object.freeze({
    label: "Industrial Land",
    title: "Industrial land workbench",
    lensTitle: "Industrial land lens",
    lensBody: "Choose a source track and filter industrial sites by land type.",
    lensNext: "The active track determines which sites appear in the preview.",
    previewTitle: "Industrial land preview",
    previewCaption: "Review industrial sites from the selected source track.",
    inspectorTitle: "Industrial land inspector",
    inspectorBody: "Select an industrial site to review its land type and location.",
    inspectorEmptyTitle: "No industrial site selected",
    inspectorEmptyBody: "Select an industrial site to see its details.",
  }),
  logistics_hubs: Object.freeze({
    label: "Logistics Hubs",
    title: "Logistics hub workbench",
    lensTitle: "Logistics supplement lens",
    lensBody: "Filter logistics hubs by category and operator type.",
    lensNext: "Select a hub to review its recorded details.",
    previewTitle: "Logistics preview",
    previewCaption: "Review logistics hubs and select one for details.",
    inspectorTitle: "Logistics hub inspector",
    inspectorBody: "Select a logistics hub to see its category and operator type.",
    inspectorEmptyTitle: "No logistics hub selected",
    inspectorEmptyBody: "Select a logistics hub to see its details.",
  }),
  layers: Object.freeze({
    label: "Layers",
    title: "Layer order board",
    lensTitle: "Transport layer order",
    lensBody: "Drag transport layers into the order you want to review.",
    lensNext: "Changes to this order stay in the workbench.",
    previewTitle: "Layer order board",
    previewCaption: "Use the center frame to drag families into the order you want future transport layers to draw.",
    inspectorTitle: "Layer order status",
    inspectorBody: "Check the current layer order here.",
    inspectorEmptyTitle: "Layer order ready",
    inspectorEmptyBody: "Drag layers in the center board to change their order.",
  }),
});

function createTransportWorkbenchFamilyDescriptor(familyId) {
  const copy = TRANSPORT_WORKBENCH_FAMILY_COPY[familyId];
  if (!copy) {
    throw new Error(`Missing transport workbench family copy for ${familyId}`);
  }
  return Object.freeze({
    ...getTransportCapabilityFamilyMetadata(familyId),
    ...copy,
  });
}

export const TRANSPORT_WORKBENCH_FAMILIES = Object.freeze(
  listTransportCapabilityFamilyIds().map(createTransportWorkbenchFamilyDescriptor)
);

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

const TRANSPORT_WORKBENCH_DENSITY_FAMILY_ID_SET = new Set([
  "port",
  "mineral_resources",
  "energy_facilities",
  "industrial_zones",
  "logistics_hubs",
]);
// 这里暴露成只读 membership/list 接口，避免调用方拿到 Set 后误改 family 分类真相源。
export const TRANSPORT_WORKBENCH_DENSITY_FAMILY_IDS = Object.freeze({
  has: (familyId) => TRANSPORT_WORKBENCH_DENSITY_FAMILY_ID_SET.has(familyId),
  values: () => TRANSPORT_WORKBENCH_DENSITY_FAMILY_ID_SET.values(),
  [Symbol.iterator]: () => TRANSPORT_WORKBENCH_DENSITY_FAMILY_ID_SET[Symbol.iterator](),
});
// default config 是 workbench 首次打开时的 canonical 草稿；后续 owner 只能按 key 覆盖，不在渲染层补默认值。
export const TRANSPORT_WORKBENCH_DEFAULT_CONFIGS = deepFreeze({
  road: {
    roadClass: ["motorway", "trunk", "primary"],
    excludeLinks: true,
    excludeServiceLike: true,
    zoomGate: "balanced",
    motorwayIdentitySource: "osm_plus_n06",
    preferOfficialRef: true,
    preferOfficialNameWhenPresent: true,
    showSourceConflicts: false,
    mergeContiguousSegments: true,
    minProjectedSegmentPx: 6,
    suppressShortPrimarySegments: true,
    denseMetroGuard: "balanced",
    showRefs: true,
    refClasses: ["motorway", "trunk", "primary"],
    labelDensityPreset: "balanced",
    allowPrimaryRefsAtHighZoom: true,
    strokePreset: "corridor",
    selectedEmphasis: "outline",
    baseOpacity: 88,
    refOpacity: 82,
    motorwayWidth: 2.8,
    trunkWidth: 2.0,
    primaryWidth: 1.18,
  },
  rail: {
    status: ["active"],
    class: ["high_speed", "trunk", "branch"],
    showServiceAtHighZoomOnly: true,
    showOsmPatchSegments: true,
    officialActiveNetworkLocked: true,
    allowOsmActiveGapFill: false,
    strictDedupMode: "strict",
    showReconciliationConflicts: false,
    showMajorStations: true,
    importanceThreshold: "regional_core",
    singlePrimaryStationPerCity: true,
    showStationLabels: true,
    labelDensityPreset: "balanced",
    statusEncoding: "line_style",
    showBranchAtCurrentZoom: true,
    showServiceLines: false,
    stationSymbolPreset: "dot_ring",
    lineOpacity: 92,
    stationOpacity: 86,
    inactiveFadeStrength: 72,
  },
  airport: {
    airportTypes: AIRPORT_TYPE_OPTIONS.map((option) => option.value),
    statuses: ["active", "paused"],
    importanceThreshold: "regional_core",
    showLabels: true,
    labelDensityPreset: "balanced",
    baseOpacity: 90,
  },
  port: {
    displayMode: "inspect",
    displayPreset: "balanced",
    aggregationAlgorithm: "cluster",
    labelLevel: "anchor",
    labelBudget: 8,
    labelSeparation: 1,
    labelAllowMerge: true,
    legalDesignations: PORT_DESIGNATION_OPTIONS.map((option) => option.value),
    managerTypes: PORT_MANAGER_TYPE_OPTIONS.map((option) => option.value),
    importanceThreshold: "regional_core",
    showLabels: true,
    labelDensityPreset: "balanced",
    baseOpacity: 90,
  },
  mineral_resources: {
    displayMode: "aggregate",
    displayPreset: "balanced",
    aggregationAlgorithm: "hex",
    labelLevel: "category",
    labelBudget: 7,
    labelSeparation: 1.15,
    labelAllowMerge: true,
    showLabels: false,
    labelDensityPreset: "sparse",
    pointOpacity: 72,
    pointSize: 92,
  },
  energy_facilities: {
    displayMode: "inspect",
    displayPreset: "balanced",
    aggregationAlgorithm: "cluster",
    labelLevel: "category",
    labelBudget: 8,
    labelSeparation: 1,
    labelAllowMerge: true,
    facilitySubtypes: [],
    statuses: ENERGY_STATUS_OPTIONS.map((option) => option.value),
    showLabels: true,
    labelDensityPreset: "very_sparse",
    pointOpacity: 86,
    pointSize: 100,
  },
  industrial_zones: {
    displayMode: "aggregate",
    displayPreset: "pattern_first",
    aggregationAlgorithm: "square",
    labelLevel: "category",
    labelBudget: 8,
    labelSeparation: 1.1,
    labelAllowMerge: true,
    variant: "internal",
    siteClasses: INDUSTRIAL_SITE_CLASS_OPTIONS.map((option) => option.value),
    coastalModes: INDUSTRIAL_COASTAL_OPTIONS.map((option) => option.value),
    showLabels: false,
    labelDensityPreset: "sparse",
    fillOpacity: 74,
    outlineOpacity: 88,
  },
  logistics_hubs: {
    displayMode: "aggregate",
    displayPreset: "pattern_first",
    aggregationAlgorithm: "cluster",
    labelLevel: "category",
    labelBudget: 8,
    labelSeparation: 1.12,
    labelAllowMerge: true,
    hubTypes: LOGISTICS_HUB_TYPE_OPTIONS.map((option) => option.value),
    operatorClassifications: LOGISTICS_OPERATOR_CLASSIFICATION_OPTIONS.map((option) => option.value),
    showLabels: false,
    labelDensityPreset: "sparse",
    pointOpacity: 78,
    pointSize: 100,
  },
});

export const TRANSPORT_WORKBENCH_BASELINE_CONFIGS = deepFreeze({
  road: JSON.parse(JSON.stringify(TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.road)),
  rail: JSON.parse(JSON.stringify(TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.rail)),
  airport: JSON.parse(JSON.stringify(TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.airport)),
  port: JSON.parse(JSON.stringify(TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.port)),
  mineral_resources: JSON.parse(JSON.stringify(TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.mineral_resources)),
  energy_facilities: JSON.parse(JSON.stringify(TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.energy_facilities)),
  industrial_zones: JSON.parse(JSON.stringify(TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.industrial_zones)),
  logistics_hubs: JSON.parse(JSON.stringify(TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.logistics_hubs)),
});

export const TRANSPORT_WORKBENCH_SECTION_DEFAULTS = deepFreeze({
  road: {
    inclusion: true,
    source_hardening: true,
    noise_control: false,
    labels: false,
    style: false,
    diagnostics: false,
  },
  rail: {
    network_scope: true,
    source_reconciliation: true,
    major_stations: false,
    line_presentation: false,
    style: false,
    diagnostics: false,
  },
  airport: {
    facility_scope: true,
    visibility: true,
    style: false,
    diagnostics: false,
  },
  port: {
    display_mode: true,
    aggregation_mode: true,
    label_strategy: true,
    facility_scope: true,
    visibility: true,
    style: false,
    diagnostics: false,
  },
  mineral_resources: {
    display_mode: true,
    aggregation_mode: true,
    label_strategy: true,
    visibility: true,
    style: false,
    diagnostics: false,
  },
  energy_facilities: {
    display_mode: true,
    aggregation_mode: true,
    label_strategy: true,
    facility_scope: true,
    visibility: true,
    style: false,
    diagnostics: false,
  },
  industrial_zones: {
    display_mode: true,
    aggregation_mode: true,
    label_strategy: true,
    data_variant: true,
    filtering: true,
    visibility: true,
    style: false,
    diagnostics: false,
  },
  logistics_hubs: {
    display_mode: true,
    aggregation_mode: true,
    label_strategy: true,
    facility_scope: true,
    visibility: true,
    style: false,
    diagnostics: false,
  },
});


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

function formatTransportWorkbenchSlugLabel(value) {
  return String(value || "")
    .trim()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function buildEnergyFacilitySubtypeControlOptions(previewSnapshot) {
  const catalog = Array.isArray(previewSnapshot?.subtypeCatalog) ? previewSnapshot.subtypeCatalog : [];
  return catalog
    .filter((entry) => entry?.availability === "local")
    .map((entry) => ({
      value: String(entry.subtype_id || "").trim(),
      label: formatTransportWorkbenchSlugLabel(entry.subtype_id),
    }))
    .filter((entry) => entry.value);
}

export const TRANSPORT_WORKBENCH_CONTROL_SCHEMAS = deepFreeze({
  road: [
    {
      key: "inclusion",
      title: "Inclusion",
      controls: [
        { type: "multi", key: "roadClass", label: "Road classes", options: ROAD_CLASS_OPTIONS, description: "Pilot scope stays on motorway, trunk, and primary." },
        { type: "toggle", key: "excludeLinks", label: "Exclude *_link", description: "Keep motorway_link, trunk_link, and primary_link out by default." },
        { type: "toggle", key: "excludeServiceLike", label: "Exclude service-like roads" },
        { type: "select", key: "zoomGate", label: "Zoom gate", description: "Controls low, mid, and high-zoom reveal behavior.", options: [
          { value: "strict", label: "Strict corridor" },
          { value: "balanced", label: "Balanced" },
          { value: "loose", label: "Loose reveal" },
        ] },
      ],
    },
    {
      key: "source_hardening",
      title: "Source Hardening",
      controls: [
        { type: "select", key: "motorwayIdentitySource", label: "Motorway identity source", description: "Japan baseline defaults to OSM geometry plus N06 hardening.", options: [
          { value: "osm_plus_n06", label: "OSM + N06 hardening" },
          { value: "osm_only", label: "OSM only" },
        ] },
        { type: "toggle", key: "preferOfficialRef", label: "Prefer official ref", description: "Use official motorway refs when they exist." },
        { type: "toggle", key: "preferOfficialNameWhenPresent", label: "Prefer official name", description: "Use official names when source values disagree." },
        { type: "toggle", key: "showSourceConflicts", label: "Show source conflicts", description: "Expose OSM versus N06 conflicts instead of hiding them." },
      ],
    },
    {
      key: "noise_control",
      title: "Noise Control",
      controls: [
        { type: "toggle", key: "mergeContiguousSegments", label: "Merge contiguous segments", description: "Safely merge same-class runs before rendering." },
        { type: "range", key: "minProjectedSegmentPx", label: "Min projected segment", description: "Very short projected segments drop out to reduce spark noise.", min: 2, max: 16, step: 1, unit: "px" },
        { type: "toggle", key: "suppressShortPrimarySegments", label: "Suppress short primary", description: "Hide extra-short primary stubs in the first pass." },
        { type: "select", key: "denseMetroGuard", label: "Dense metro guard", description: "Extra denoise strength for Tokyo and Osaka density.", options: [
          { value: "light", label: "Light" },
          { value: "balanced", label: "Balanced" },
          { value: "strict", label: "Strict" },
        ] },
      ],
    },
    {
      key: "labels",
      title: "Labels",
      controls: [
        { type: "toggle", key: "showRefs", label: "Show refs", description: "Turns road reference labels on or off." },
        { type: "multi", key: "refClasses", label: "Ref classes", options: ROAD_REF_CLASS_OPTIONS, description: "Primary is now available. Lower classes stay visible in UI but disabled until data lands." },
        { type: "select", key: "labelDensityPreset", label: "Label density", description: "Controls how aggressively refs fill the corridor.", options: TRANSPORT_WORKBENCH_LABEL_DENSITY_OPTIONS },
        { type: "toggle", key: "allowPrimaryRefsAtHighZoom", label: "Allow primary refs at high zoom", description: "Primary refs stay gated until closer inspection." },
      ],
    },
    {
      key: "style",
      title: "Style",
      controls: [
        { type: "select", key: "strokePreset", label: "Stroke preset", description: "Sets motorway, trunk, and primary emphasis.", options: [
          { value: "corridor", label: "Corridor" },
          { value: "review", label: "Review" },
          { value: "quiet", label: "Quiet" },
        ] },
        { type: "select", key: "selectedEmphasis", label: "Selected emphasis", description: "How a chosen segment should stand out later.", options: [
          { value: "outline", label: "Outline" },
          { value: "glow", label: "Glow" },
          { value: "mute_others", label: "Mute others" },
        ] },
        { type: "range", key: "motorwayWidth", label: "Motorway width", description: "Screen-space width for motorway strokes.", min: 1.6, max: 4.8, step: 0.05, unit: "px" },
        { type: "range", key: "trunkWidth", label: "Trunk width", description: "Screen-space width for trunk strokes.", min: 1.1, max: 3.8, step: 0.05, unit: "px" },
        { type: "range", key: "primaryWidth", label: "Primary width", description: "Screen-space width for primary strokes.", min: 0.55, max: 2.8, step: 0.05, unit: "px" },
        { type: "range", key: "baseOpacity", label: "Base opacity", description: "Overall road line opacity.", min: 40, max: 100, step: 1, unit: "%" },
        { type: "range", key: "refOpacity", label: "Ref opacity", description: "Overall road reference-label opacity.", min: 30, max: 100, step: 1, unit: "%" },
      ],
    },
  ],
  rail: [
    {
      key: "network_scope",
      title: "Network Scope",
      controls: [
        { type: "multi", key: "status", label: "Statuses", options: RAIL_STATUS_OPTIONS, description: "Japan rail baseline opens only active by default." },
        { type: "multi", key: "class", label: "Classes", options: RAIL_CLASS_OPTIONS, description: "Low zoom should favor high_speed and trunk." },
        { type: "toggle", key: "showServiceAtHighZoomOnly", label: "Service only at high zoom", description: "Keep service lines from dominating national views." },
        { type: "toggle", key: "showOsmPatchSegments", label: "Show OSM patch segments", description: "Display only explicit lifecycle or gap patches." },
      ],
    },
    {
      key: "source_reconciliation",
      title: "Source Reconciliation",
      description: "Choose how official and OSM railway information is combined.",
      controls: [
        { type: "toggle", key: "officialActiveNetworkLocked", label: "Official active network locked", description: "Official Japan source defines active network boundaries." },
        { type: "toggle", key: "allowOsmActiveGapFill", label: "Allow OSM active gap fill", description: "Permit OSM to fill only obvious official gaps." },
        { type: "select", key: "strictDedupMode", label: "Dedup mode", description: "Keep reconciliation strict rather than heuristic.", options: [
          { value: "strict", label: "Strict" },
          { value: "strict_plus_name", label: "Strict + name" },
        ] },
        { type: "toggle", key: "showReconciliationConflicts", label: "Show reconciliation conflicts", description: "Expose official-versus-OSM conflicts instead of hiding them." },
      ],
    },
    {
      key: "major_stations",
      title: "Major Stations",
      description: "Choose which major stations and names appear on the map.",
      controls: [
        { type: "toggle", key: "showMajorStations", label: "Show major stations", description: "Turn the major station layer on or off." },
        { type: "select", key: "importanceThreshold", label: "Importance threshold", description: "Controls the lowest station importance that survives.", options: [
          { value: "capital_core", label: "Capital core" },
          { value: "regional_core", label: "Regional core" },
          { value: "broad_major", label: "Broad major" },
        ] },
        { type: "toggle", key: "singlePrimaryStationPerCity", label: "Single primary station per city", description: "Keep one main station per city by default." },
        { type: "toggle", key: "showStationLabels", label: "Show station labels", description: "Expose names only for retained major stations." },
        { type: "select", key: "labelDensityPreset", label: "Label density", description: "Controls how aggressively station names are kept on screen.", options: TRANSPORT_WORKBENCH_LABEL_DENSITY_OPTIONS },
      ],
    },
    {
      key: "line_presentation",
      title: "Line Presentation",
      description: "Distinguish railway status with line styles and fading.",
      controls: [
        { type: "select", key: "statusEncoding", label: "Status encoding", description: "How inactive lines fade away in preview.", options: [
          { value: "line_style", label: "Line style" },
          { value: "line_style_plus_hue", label: "Line style + hue" },
        ] },
        { type: "toggle", key: "showBranchAtCurrentZoom", label: "Show branch at current zoom", description: "Whether branch lines participate at the current zoom gate." },
        { type: "toggle", key: "showServiceLines", label: "Show service lines", description: "Keep service lines off unless deliberately reviewing them." },
        { type: "select", key: "stationSymbolPreset", label: "Station symbol", description: "Symbol treatment for major stations.", options: [
          { value: "dot_ring", label: "Dot ring" },
          { value: "solid_dot", label: "Solid dot" },
          { value: "quiet_square", label: "Quiet square" },
        ] },
      ],
    },
    {
      key: "style",
      title: "Style",
      controls: [
        { type: "range", key: "lineOpacity", label: "Line opacity", description: "Overall rail line opacity.", min: 40, max: 100, step: 1, unit: "%" },
        { type: "range", key: "stationOpacity", label: "Station opacity", description: "Overall major-station opacity.", min: 35, max: 100, step: 1, unit: "%" },
        { type: "range", key: "inactiveFadeStrength", label: "Inactive fade strength", description: "How strongly inactive lifecycle states fade.", min: 0, max: 100, step: 1, unit: "%" },
      ],
    },
  ],
  airport: [
    {
      key: "facility_scope",
      title: "Facility Scope",
      controls: [
        { type: "multi", key: "airportTypes", label: "Airport types", options: AIRPORT_TYPE_OPTIONS, description: "Select which official airport classes remain visible." },
        { type: "multi", key: "statuses", label: "Statuses", options: AIRPORT_STATUS_OPTIONS, description: "Filter airport status using normalized official status categories." },
        { type: "select", key: "importanceThreshold", label: "Importance threshold", description: "Hide lower-importance airports before render.", options: [
          { value: "national_core", label: "National core" },
          { value: "regional_core", label: "Regional core" },
          { value: "local_connector", label: "Local connector" },
        ] },
      ],
    },
    {
      key: "visibility",
      title: "Visibility",
      controls: [
        { type: "toggle", key: "showLabels", label: "Show labels", description: "Expose airport names only when the current zoom can carry them cleanly." },
        { type: "select", key: "labelDensityPreset", label: "Label density", description: "Controls how aggressively airport names are kept on screen.", options: TRANSPORT_WORKBENCH_LABEL_DENSITY_OPTIONS },
      ],
    },
    {
      key: "style",
      title: "Style",
      controls: [
        { type: "range", key: "baseOpacity", label: "Base opacity", description: "Overall airport point opacity.", min: 35, max: 100, step: 1, unit: "%" },
      ],
    },
  ],
  port: [
    {
      key: "display_mode",
      title: "Display Mode",
      description: "Choose individual sites, grouped sites, or a density view.",
      controls: [
        { type: "select", key: "displayMode", label: "Mode", description: "Choose the current view language for ports.", options: TRANSPORT_WORKBENCH_DISPLAY_MODE_OPTIONS },
        { type: "select", key: "displayPreset", label: "Preset", description: "Dynamic thresholds, not fixed counts.", options: TRANSPORT_WORKBENCH_DISPLAY_PRESET_OPTIONS },
      ],
    },
    {
      key: "aggregation_mode",
      title: "Aggregation",
      description: "Aggregation stays dynamic and only steps in when the current view becomes dense.",
      controls: [
        { type: "select", key: "aggregationAlgorithm", label: "Algorithm", description: "Choose how dense port points should be summarized.", options: TRANSPORT_WORKBENCH_AGGREGATION_ALGORITHM_OPTIONS.filter((option) => ["cluster", "square", "density_surface"].includes(option.value)) },
      ],
    },
    {
      key: "label_strategy",
      title: "Label Strategy",
      description: "Labels use geographic anchors first, then category when the map can carry it.",
      controls: [
        { type: "select", key: "labelLevel", label: "Label level", description: "Choose how descriptive aggregated labels should be.", options: TRANSPORT_WORKBENCH_LABEL_LEVEL_OPTIONS },
        { type: "range", key: "labelBudget", label: "Label budget", description: "Maximum labels to keep on screen before label aggregation kicks in.", min: 3, max: 18, step: 1 },
        { type: "range", key: "labelSeparation", label: "Label separation", description: "Higher values spread labels further apart.", min: 0.7, max: 1.8, step: 0.05 },
      ],
    },
    {
      key: "facility_scope",
      title: "Facility Scope",
      controls: [
        { type: "multi", key: "legalDesignations", label: "Legal designations", options: PORT_DESIGNATION_OPTIONS, description: "Select which official port legal classes remain visible." },
        { type: "multi", key: "managerTypes", label: "Manager types", options: PORT_MANAGER_TYPE_OPTIONS, description: "Filter by official manager type code." },
        { type: "select", key: "importanceThreshold", label: "Importance threshold", description: "Hide lower-importance ports before render.", options: [
          { value: "national_core", label: "National core" },
          { value: "regional_core", label: "Regional core" },
          { value: "local_connector", label: "Local connector" },
        ] },
      ],
    },
    {
      key: "visibility",
      title: "Visibility",
      description: "Keep port names gated by the current zoom and importance.",
      controls: [
        { type: "toggle", key: "showLabels", label: "Show labels", description: "Expose port names only when the current zoom can carry them cleanly." },
        { type: "select", key: "labelDensityPreset", label: "Label density", description: "Controls how aggressively port names are kept on screen.", options: TRANSPORT_WORKBENCH_LABEL_DENSITY_OPTIONS },
      ],
    },
    {
      key: "style",
      title: "Style",
      controls: [
        { type: "range", key: "baseOpacity", label: "Base opacity", description: "Overall port point opacity.", min: 35, max: 100, step: 1, unit: "%" },
      ],
    },
  ],
  mineral_resources: [
    {
      key: "display_mode",
      title: "Display Mode",
      description: "Choose individual sites, grouped sites, or a density view.",
      controls: [
        { type: "select", key: "displayMode", label: "Mode", description: "Choose the current view language for mineral resources.", options: TRANSPORT_WORKBENCH_DISPLAY_MODE_OPTIONS },
        { type: "select", key: "displayPreset", label: "Preset", description: "Dynamic thresholds drive when inspect, aggregate, or density takes over.", options: TRANSPORT_WORKBENCH_DISPLAY_PRESET_OPTIONS },
      ],
    },
    {
      key: "aggregation_mode",
      title: "Aggregation",
      description: "Grid-based aggregation works better than raw point carpets for dense mineral clusters.",
      controls: [
        { type: "select", key: "aggregationAlgorithm", label: "Algorithm", description: "Choose how mineral points should be aggregated.", options: TRANSPORT_WORKBENCH_AGGREGATION_ALGORITHM_OPTIONS.filter((option) => ["hex", "square", "density_surface"].includes(option.value)) },
      ],
    },
    {
      key: "label_strategy",
      title: "Label Strategy",
      description: "Prefer geographic anchors with dominant resource category, then back off when the map gets crowded.",
      controls: [
        { type: "select", key: "labelLevel", label: "Label level", description: "Choose how descriptive aggregated mineral labels should be.", options: TRANSPORT_WORKBENCH_LABEL_LEVEL_OPTIONS },
        { type: "range", key: "labelBudget", label: "Label budget", description: "Maximum labels kept before geographic label merge takes over.", min: 3, max: 18, step: 1 },
        { type: "range", key: "labelSeparation", label: "Label separation", description: "Higher values increase spacing between labels.", min: 0.7, max: 1.8, step: 0.05 },
      ],
    },
    {
      key: "visibility",
      title: "Labels",
      description: "Keep mineral labels opt-in so dense point fields stay readable.",
      controls: [
        { type: "toggle", key: "showLabels", label: "Show labels", description: "Expose mineral labels only during closer review." },
        { type: "select", key: "labelDensityPreset", label: "Label density", description: "Controls how aggressively mineral labels are kept on screen.", options: TRANSPORT_WORKBENCH_LABEL_DENSITY_OPTIONS },
      ],
    },
    {
      key: "style",
      title: "Appearance",
      controls: [
        { type: "range", key: "pointOpacity", label: "Point opacity", description: "Overall mineral point opacity.", min: 28, max: 100, step: 1, unit: "%" },
        { type: "range", key: "pointSize", label: "Point size", description: "Scales the mineral point marker size.", min: 72, max: 148, step: 1, unit: "%" },
      ],
    },
  ],
  energy_facilities: [
    {
      key: "display_mode",
      title: "Display Mode",
      description: "Choose individual sites, grouped sites, or a density view.",
      controls: [
        { type: "select", key: "displayMode", label: "Mode", description: "Choose the current view language for energy facilities.", options: TRANSPORT_WORKBENCH_DISPLAY_MODE_OPTIONS },
        { type: "select", key: "displayPreset", label: "Preset", description: "Dynamic thresholds decide when aggregation should take over.", options: TRANSPORT_WORKBENCH_DISPLAY_PRESET_OPTIONS },
      ],
    },
    {
      key: "aggregation_mode",
      title: "Aggregation",
      description: "Aggregation is optional here, but the mode should still honor subtype-driven density shifts.",
      controls: [
        { type: "select", key: "aggregationAlgorithm", label: "Algorithm", description: "Choose how energy facilities should summarize at lower zooms.", options: TRANSPORT_WORKBENCH_AGGREGATION_ALGORITHM_OPTIONS.filter((option) => ["cluster", "square", "density_surface"].includes(option.value)) },
      ],
    },
    {
      key: "label_strategy",
      title: "Label Strategy",
      description: "Subtype-driven labels should stay sparse and readable instead of repeating raw facility names everywhere.",
      controls: [
        { type: "select", key: "labelLevel", label: "Label level", description: "Choose how descriptive aggregated energy labels should be.", options: TRANSPORT_WORKBENCH_LABEL_LEVEL_OPTIONS },
        { type: "range", key: "labelBudget", label: "Label budget", description: "Maximum labels kept before label merge kicks in.", min: 3, max: 18, step: 1 },
        { type: "range", key: "labelSeparation", label: "Label separation", description: "Higher values increase spacing between labels.", min: 0.7, max: 1.8, step: 0.05 },
      ],
    },
    {
      key: "facility_scope",
      title: "Facility Scope",
      controls: [
        {
          type: "multi",
          key: "facilitySubtypes",
          label: "Local subtypes",
          options: ({ previewSnapshot }) => buildEnergyFacilitySubtypeControlOptions(previewSnapshot),
          description: "Choose which approved local energy subtypes remain visible.",
          defaultAllWhenEmpty: true,
        },
        { type: "multi", key: "statuses", label: "Statuses", options: ENERGY_STATUS_OPTIONS, description: "Filter energy facilities by normalized source status." },
      ],
    },
    {
      key: "visibility",
      title: "Labels",
      description: "Keep facility names visible only when the current zoom can carry them cleanly.",
      controls: [
        { type: "toggle", key: "showLabels", label: "Show labels", description: "Expose energy facility labels during closer review." },
        { type: "select", key: "labelDensityPreset", label: "Label density", description: "Controls how aggressively facility names are kept on screen.", options: TRANSPORT_WORKBENCH_LABEL_DENSITY_OPTIONS },
      ],
    },
    {
      key: "style",
      title: "Appearance",
      controls: [
        { type: "range", key: "pointOpacity", label: "Point opacity", description: "Overall energy point opacity.", min: 30, max: 100, step: 1, unit: "%" },
        { type: "range", key: "pointSize", label: "Point size", description: "Scales the energy point marker size.", min: 72, max: 148, step: 1, unit: "%" },
      ],
    },
  ],
  industrial_zones: [
    {
      key: "display_mode",
      title: "Display Mode",
      description: "Choose individual sites, grouped sites, or a density view.",
      controls: [
        { type: "select", key: "displayMode", label: "Mode", description: "Choose the current view language for industrial land.", options: TRANSPORT_WORKBENCH_DISPLAY_MODE_OPTIONS },
        { type: "select", key: "displayPreset", label: "Preset", description: "Dynamic thresholds decide when polygons collapse into pattern views.", options: TRANSPORT_WORKBENCH_DISPLAY_PRESET_OPTIONS },
      ],
    },
    {
      key: "aggregation_mode",
      title: "Aggregation",
      description: "Industrial review needs pattern-first summarization without blending internal and open tracks.",
      controls: [
        { type: "select", key: "aggregationAlgorithm", label: "Algorithm", description: "Choose how industrial land should summarize at lower zooms.", options: TRANSPORT_WORKBENCH_AGGREGATION_ALGORITHM_OPTIONS.filter((option) => ["square", "hex", "density_surface"].includes(option.value)) },
      ],
    },
    {
      key: "label_strategy",
      title: "Label Strategy",
      description: "Use geographic anchors and dominant land context before falling back to fewer region labels.",
      controls: [
        { type: "select", key: "labelLevel", label: "Label level", description: "Choose how descriptive industrial labels should be.", options: TRANSPORT_WORKBENCH_LABEL_LEVEL_OPTIONS },
        { type: "range", key: "labelBudget", label: "Label budget", description: "Maximum industrial labels kept before merge and downgrade.", min: 3, max: 18, step: 1 },
        { type: "range", key: "labelSeparation", label: "Label separation", description: "Higher values increase spacing between labels.", min: 0.7, max: 1.8, step: 0.05 },
      ],
    },
    {
      key: "data_variant",
      title: "Source Track",
      description: "Keep official review data separate from publicly releasable data.",
      controls: [
        { type: "select", key: "variant", label: "Source track", options: INDUSTRIAL_VARIANT_OPTIONS },
      ],
    },
    {
      key: "filtering",
      title: "Filters",
      controls: [
        { type: "multi", key: "siteClasses", label: "Land type", options: INDUSTRIAL_SITE_CLASS_OPTIONS, description: "Keep only the industrial land types you want to inspect." },
        {
          type: "multi",
          key: "coastalModes",
          label: "Location context",
          options: INDUSTRIAL_COASTAL_OPTIONS,
          description: "This filter only applies to the internal official variant.",
          showWhen: (config) => String(config?.variant || "internal") === "internal",
        },
      ],
    },
    {
      key: "visibility",
      title: "Labels",
      description: "Keep names opt-in so polygon review stays readable.",
      controls: [
        { type: "toggle", key: "showLabels", label: "Show labels", description: "Expose polygon names only when you want name-led review." },
        { type: "select", key: "labelDensityPreset", label: "Label density", description: "Controls how aggressively polygon names are kept on screen.", options: TRANSPORT_WORKBENCH_LABEL_DENSITY_OPTIONS },
      ],
    },
    {
      key: "style",
      title: "Appearance",
      controls: [
        { type: "range", key: "fillOpacity", label: "Fill opacity", description: "Overall polygon fill opacity.", min: 18, max: 100, step: 1, unit: "%" },
        { type: "range", key: "outlineOpacity", label: "Outline opacity", description: "Overall polygon outline opacity.", min: 28, max: 100, step: 1, unit: "%" },
      ],
    },
  ],
  logistics_hubs: [
    {
      key: "display_mode",
      title: "Display Mode",
      description: "Choose individual sites, grouped sites, or a density view.",
      controls: [
        { type: "select", key: "displayMode", label: "Mode", description: "Choose the current view language for logistics hubs.", options: TRANSPORT_WORKBENCH_DISPLAY_MODE_OPTIONS },
        { type: "select", key: "displayPreset", label: "Preset", description: "Dynamic thresholds decide when the layer moves between inspect, aggregate, and density.", options: TRANSPORT_WORKBENCH_DISPLAY_PRESET_OPTIONS },
      ],
    },
    {
      key: "aggregation_mode",
      title: "Aggregation",
      description: "Cluster and grid views are both valid here, depending on how aggressively you want to compress the point field.",
      controls: [
        { type: "select", key: "aggregationAlgorithm", label: "Algorithm", description: "Choose how logistics hubs should summarize when dense.", options: TRANSPORT_WORKBENCH_AGGREGATION_ALGORITHM_OPTIONS.filter((option) => ["cluster", "square", "density_surface"].includes(option.value)) },
      ],
    },
    {
      key: "label_strategy",
      title: "Label Strategy",
      description: "Use geographic anchors and dominant logistics function, then merge labels when corridor density spikes.",
      controls: [
        { type: "select", key: "labelLevel", label: "Label level", description: "Choose how descriptive logistics labels should be.", options: TRANSPORT_WORKBENCH_LABEL_LEVEL_OPTIONS },
        { type: "range", key: "labelBudget", label: "Label budget", description: "Maximum logistics labels kept before merge.", min: 3, max: 18, step: 1 },
        { type: "range", key: "labelSeparation", label: "Label separation", description: "Higher values increase spacing between labels.", min: 0.7, max: 1.8, step: 0.05 },
      ],
    },
    {
      key: "facility_scope",
      title: "Hub Scope",
      controls: [
        { type: "multi", key: "hubTypes", label: "Hub category", options: LOGISTICS_HUB_TYPE_OPTIONS, description: "Filter which logistics hub categories remain visible." },
        { type: "multi", key: "operatorClassifications", label: "Operator type", options: LOGISTICS_OPERATOR_CLASSIFICATION_OPTIONS, description: "Filter hubs by operator type." },
      ],
    },
    {
      key: "visibility",
      title: "Labels",
      description: "Keep names gated so hub points stay readable over industrial land.",
      controls: [
        { type: "toggle", key: "showLabels", label: "Show labels", description: "Expose logistics hub labels only during closer review." },
        { type: "select", key: "labelDensityPreset", label: "Label density", description: "Controls how aggressively hub names are kept on screen.", options: TRANSPORT_WORKBENCH_LABEL_DENSITY_OPTIONS },
      ],
    },
    {
      key: "style",
      title: "Appearance",
      controls: [
        { type: "range", key: "pointOpacity", label: "Point opacity", description: "Overall logistics point opacity.", min: 30, max: 100, step: 1, unit: "%" },
        { type: "range", key: "pointSize", label: "Point size", description: "Scales the logistics point marker size.", min: 72, max: 148, step: 1, unit: "%" },
      ],
    },
  ],
});

export const TRANSPORT_WORKBENCH_INLINE_HELP_SECTIONS = {
  road: new Set(["source_hardening", "noise_control"]),
  rail: new Set(["source_reconciliation", "line_presentation"]),
};

export const TRANSPORT_WORKBENCH_INLINE_HELP_COPY = {
  road: {
    source_hardening: {
      title: "Source hardening",
      body: "Use official road names and route numbers where available.",
    },
    noise_control: {
      title: "Noise control",
      body: "Hide short or crowded road segments to keep major roads readable.",
    },
  },
  rail: {
    source_reconciliation: {
      title: "Source reconciliation",
      body: "Combine official active railway lines with OSM information for gaps and inactive lines.",
    },
    line_presentation: {
      title: "Line presentation",
      body: "Use line styles and fading to distinguish railway status. Keep main lines more prominent than branch and service lines.",
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
    governance: "OSM / Geofabrik Japan and N06.",
    pendingStatus: "Loads on demand from the Japan road geometry and reference-label packs",
  },
  rail: {
    country: "Japan",
    adapterId: "japan_rail_v1",
    geometryKind: "line",
    packs: ["railways", "rail_stations_major"],
    geometrySource: "Official active network",
    hardeningSource: "OSM lifecycle / gap patch",
    governance: "Official active network and OSM lifecycle / gap information.",
    pendingStatus: "Waiting for the Japan rail lines and major-station packs",
  },
  airport: {
    country: "Japan",
    adapterId: "japan_airport_v1",
    geometryKind: "point",
    packs: ["airports"],
    geometrySource: "Official airport point source",
    hardeningSource: "Administrative category / importance review",
    governance: "Official airport point source.",
    pendingStatus: "Waiting for airports Japan pack",
  },
  port: {
    country: "Japan",
    adapterId: "japan_port_v1",
    geometryKind: "point",
    packs: ["ports"],
    geometrySource: "Official or quasi-official major port node source",
    hardeningSource: "Official designation / coverage-tier review",
    governance: "Official or quasi-official major port node source.",
    pendingStatus: "Waiting for ports Japan pack",
  },
  mineral_resources: {
    country: "Japan",
    adapterId: "japan_mineral_resources_v1",
    geometryKind: "point",
    packs: ["mineral_resources"],
    geometrySource: "Official mineral resource distribution point source",
    hardeningSource: "Manual resource class normalization",
    governance: "Official mineral resource distribution point source.",
    pendingStatus: "Waiting for the Japan mineral resource pack manifest",
  },
  energy_facilities: {
    country: "Japan",
    adapterId: "japan_energy_facilities_v1",
    geometryKind: "point",
    packs: ["energy_facilities"],
    geometrySource: "Official energy facility point source",
    hardeningSource: "Facility subtype and status normalization",
    governance: "MLIT power-plant sources; other energy categories are reference-only.",
    pendingStatus: "Waiting for the Japan energy facility pack manifest",
  },
  industrial_zones: {
    country: "Selected region",
    adapterId: "active_industrial_zones_manifest",
    geometryKind: "polygon_or_point",
    packs: ["industrial_zones"],
    geometrySource: "Industrial land polygons or site locations",
    hardeningSource: "Separate official and public sources",
    governance: "OSM and official industrial land sources; official review and public release data remain separate.",
    pendingStatus: "Waiting for the active industrial land pack manifest",
  },
  logistics_hubs: {
    country: "Japan",
    adapterId: "japan_logistics_hubs_v1",
    geometryKind: "point",
    packs: ["logistics_hubs"],
    geometrySource: "Official P31 logistics hub point source",
    hardeningSource: "Main-islands clipping and explicit raw code preservation",
    governance: "Official P31 logistics hub point source; internal use only, not approved for external distribution.",
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

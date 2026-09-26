import assert from "node:assert/strict";
import test from "node:test";

import {
  buildManifestOnlyInspectorRows,
  buildTransportWorkbenchInspectorRenderSignature,
  buildTransportWorkbenchDiagnosticRows,
  buildTransportWorkbenchPackDetailsRows,
  buildTransportWorkbenchInspectorModel,
  createTransportWorkbenchInspectorOwner,
  formatTransportWorkbenchManifestTimestamp,
  getTransportWorkbenchInspectorRowClassNames,
} from "../js/ui/toolbar/transport_workbench_inspector_owner.js";

function rowValue(rows, label) {
  const row = rows.find(([candidate]) => candidate === label);
  assert.ok(row, `missing row: ${label}`);
  return row[1];
}

class TestClassList {
  constructor(node) {
    this.node = node;
  }

  add(...tokens) {
    const values = new Set(String(this.node.className || "").split(/\s+/).filter(Boolean));
    tokens.forEach((token) => values.add(token));
    this.node.className = Array.from(values).join(" ");
  }

  remove(...tokens) {
    const values = new Set(String(this.node.className || "").split(/\s+/).filter(Boolean));
    tokens.forEach((token) => values.delete(token));
    this.node.className = Array.from(values).join(" ");
  }

  contains(token) {
    return String(this.node.className || "").split(/\s+/).includes(token);
  }

  toggle(token, force) {
    const shouldAdd = force === undefined ? !this.contains(token) : !!force;
    if (shouldAdd) {
      this.add(token);
    } else {
      this.remove(token);
    }
    return shouldAdd;
  }
}

function createTestDocument() {
  return {
    createElement(tagName) {
      const node = {
        tagName: String(tagName || "").toLowerCase(),
        children: [],
        textContent: "",
        className: "",
        replaceChildrenCallCount: 0,
        get childElementCount() {
          return this.children.length;
        },
        appendChild(child) {
          this.children.push(child);
          return child;
        },
        append(...children) {
          children.forEach((child) => this.appendChild(child));
        },
        replaceChildren(...children) {
          this.replaceChildrenCallCount += 1;
          this.children = [];
          this.append(...children);
        },
      };
      node.classList = new TestClassList(node);
      return node;
    },
  };
}

test("manifest timestamps stay readable for inspector rows", () => {
  assert.equal(formatTransportWorkbenchManifestTimestamp(""), "unknown");
  assert.equal(formatTransportWorkbenchManifestTimestamp("2026-05-19T12:34:00Z"), "2026-05-19 12:34:00 UTC");
});

test("manifest-only rows expose error and ready pack governance", () => {
  const errorRows = buildManifestOnlyInspectorRows(
    { id: "energy_facilities", label: "Energy facilities" },
    { status: "error", error: "source missing" },
    { governance: "data/transport/energy.json" },
  );
  assert.equal(rowValue(errorRows, "Pack status"), "Energy facilities pack failed to load");
  assert.equal(rowValue(errorRows, "Error"), "source missing");
  assert.equal(rowValue(errorRows, "Data path"), "data/transport/energy.json");

  const readyRows = buildManifestOnlyInspectorRows(
    { id: "energy_facilities", label: "Energy facilities" },
    {
      status: "ready",
      manifest: {
        adapter_id: "japan_energy_facilities_v1",
        recipe_version: "2026.05",
        distribution_tier: "preview",
        license_tier: "restricted",
        coverage_scope: "japan",
        source_policy: "official",
        generated_at: "2026-05-19T00:00:00Z",
        feature_counts: { preview: { facilities: 2 }, full: { facilities: 4 } },
        default_variant: "preview",
        variants: {
          preview: {
            label: "Preview",
            distribution_tier: "preview",
            feature_counts: { full: 2 },
          },
        },
      },
      audit: { recipe_version: "audit-v1" },
      subtypeCatalog: [
        { subtype_id: "thermal", label: "Thermal", availability: "local", feature_count: 3 },
        { subtype_id: "solar", label: "Solar", availability: "reference_only", feature_count: 1 },
      ],
      packMode: "preview",
    },
    { adapterId: "fallback", governance: "governed" },
  );
  assert.equal(rowValue(readyRows, "Pack version"), "japan_energy_facilities_v1");
  assert.equal(rowValue(readyRows, "Default variant"), "preview");
  assert.equal(rowValue(readyRows, "Variants"), "preview (2)");
  assert.equal(rowValue(readyRows, "Local subtypes"), "thermal (3)");
  assert.equal(rowValue(readyRows, "Reference-only subtypes"), "solar");
});

test("diagnostic rows stay family specific", () => {
  const roadRows = buildTransportWorkbenchDiagnosticRows("road", {
    roadClass: ["motorway"],
    motorwayIdentitySource: "osm_and_n06",
    refClasses: ["primary"],
    widthScale: 110,
    noiseReduction: 35,
    showRefs: true,
  });
  assert.equal(rowValue(roadRows, "Data intake"), "Motorway only");
  assert.equal(rowValue(roadRows, "Source recipe"), "OSM + N06 hardening");
  assert.equal(rowValue(roadRows, "Label scope"), "Primary refs");

  const hubRows = buildTransportWorkbenchDiagnosticRows("logistics_hubs", {
    displayMode: "density",
    displayPreset: "dense",
    aggregationAlgorithm: "grid",
    hubTypes: ["truck_terminal"],
    operatorClassifications: ["public"],
    showLabels: true,
    labelLevel: "major",
    labelBudget: 24,
    pointSize: 80,
  });
  assert.equal(rowValue(hubRows, "Display mode"), "density / dense");
  assert.equal(rowValue(hubRows, "Hub category"), "Truck terminal");
  assert.equal(rowValue(hubRows, "Operator type"), "Public");
});

test("inspector model preserves road, rail, airport, and port pack status rows", () => {
  const roadError = buildTransportWorkbenchInspectorModel({
    family: { id: "road", label: "Road" },
    previewSnapshot: { status: "error", error: "road missing" },
    dataContract: { governance: "road.json" },
  });
  assert.equal(rowValue(roadError.rows, "Pack status"), "Road pack failed to load");
  assert.equal(rowValue(roadError.rows, "Error"), "road missing");

  const roadLoading = buildTransportWorkbenchInspectorModel({
    family: { id: "road", label: "Road" },
    config: { motorwayIdentitySource: "osm_only" },
    previewSnapshot: { status: "pending" },
    dataContract: { governance: "road.json" },
  });
  assert.equal(rowValue(roadLoading.rows, "Pack status"), "Loading Japan road pack");
  assert.equal(roadLoading.rows.some(([label]) => label === "Adapter"), false);

  const pendingCases = [
    {
      family: { id: "rail", label: "Rail" },
      config: { allowOsmActiveGapFill: true, status: ["active"], class: ["trunk"], showMajorStations: true, importanceThreshold: "regional" },
      errorStatus: "Rail pack failed to load",
      pendingStatus: "Waiting for the Japan rail lines and major-station packs",
    },
    {
      family: { id: "airport", label: "Airport" },
      config: { airportTypes: ["national"], statuses: ["active"], showLabels: true },
      errorStatus: "Airport pack failed to load",
      pendingStatus: "Waiting for airport Japan pack",
    },
    {
      family: { id: "port", label: "Port" },
      config: { coverageTier: "core", legalDesignations: ["important"], managerTypes: ["2"], showLabels: true },
      errorStatus: "Port pack failed to load",
      pendingStatus: "Waiting for port Japan pack",
    },
  ];

  pendingCases.forEach(({ family, config, errorStatus, pendingStatus }) => {
    const errorModel = buildTransportWorkbenchInspectorModel({
      family,
      config,
      previewSnapshot: { status: "error", error: `${family.id} missing` },
      dataContract: { governance: `${family.id}.json` },
    });
    assert.equal(rowValue(errorModel.rows, "Pack status"), errorStatus);

    const loadingModel = buildTransportWorkbenchInspectorModel({
      family,
      config,
      previewSnapshot: { status: "pending" },
      dataContract: { governance: `${family.id}.json` },
    });
    assert.equal(rowValue(loadingModel.rows, "Pack status"), pendingStatus);
  });
});

test("inspector model preserves rail selected line and station rows", () => {
  const railLineModel = buildTransportWorkbenchInspectorModel({
    family: { id: "rail", label: "Rail" },
    config: { allowOsmActiveGapFill: true, status: ["active"], class: ["trunk"] },
    previewSnapshot: {
      status: "ready",
      manifest: { adapter_id: "japan_rail_v1", source_policy: "official", generated_at: "2026-05-19T00:00:00Z" },
      audit: { recipe_version: "rail-v1" },
      stats: { totalLines: 12, visibleLines: 7, totalStations: 5, visibleStations: 3 },
      selected: {
        type: "line",
        name: "Tokaido",
        operator: "JR",
        railTypeCode: "main",
        operatorTypeCode: "private",
        status: "active",
        lineClass: "trunk",
        source: "official",
        sourceFlags: ["N02"],
        visible: false,
        hiddenReason: "status_filtered",
      },
    },
  });
  assert.equal(rowValue(railLineModel.rows, "Loaded lines"), "12");
  assert.equal(rowValue(railLineModel.rows, "Selected line"), "Tokaido");
  assert.equal(rowValue(railLineModel.rows, "Visibility"), "Filtered by status");

  const railStationModel = buildTransportWorkbenchInspectorModel({
    family: { id: "rail", label: "Rail" },
    config: { allowOsmActiveGapFill: false, status: ["active"], class: ["trunk"] },
    previewSnapshot: {
      status: "ready",
      manifest: { adapter_id: "japan_rail_v1" },
      audit: { recipe_version: "rail-v1" },
      stats: { totalLines: 1, visibleLines: 1, totalStations: 1, visibleStations: 0 },
      selected: {
        type: "station",
        name: "Tokyo",
        cityKey: "tokyo",
        stationCode: "TYO",
        groupCode: "grp",
        importance: "major",
        source: "station-pack",
        visible: false,
      },
    },
  });
  assert.equal(rowValue(railStationModel.rows, "Selected station"), "Tokyo");
  assert.equal(rowValue(railStationModel.rows, "Visibility"), "Hidden by threshold");
});

test("inspector model preserves airport and port selected feature rows", () => {
  const airportModel = buildTransportWorkbenchInspectorModel({
    family: { id: "airport", label: "Airport" },
    config: { airportTypes: ["national"], statuses: ["active"] },
    previewSnapshot: {
      status: "ready",
      manifest: { adapter_id: "japan_airport_v1", recipe_version: "airport-v1", source_policy: "official", generated_at: "2026-05-19T00:00:00Z" },
      stats: { totalFeatures: 8, visibleFeatures: 6, visibleLabels: 4 },
      packMode: "preview",
      selected: {
        name: "Tokyo International",
        properties: {
          airport_type_label: "National",
          status: "active",
          owner: "MLIT",
          manager: "Airport manager",
          scheduled_service_code: "yes",
          runway_length_m_max: 3000,
          passengers_per_day_latest: 100000,
          survey_year_latest: 2025,
          iata: "HND",
          icao: "RJTT",
        },
      },
    },
  });
  assert.equal(rowValue(airportModel.rows, "Loaded airports"), "8");
  assert.equal(rowValue(airportModel.rows, "Selected airport"), "Tokyo International");
  assert.equal(rowValue(airportModel.rows, "Runway max"), "3000m");
  assert.equal(rowValue(airportModel.rows, "IATA"), "HND");

  const portModel = buildTransportWorkbenchInspectorModel({
    family: { id: "port", label: "Port" },
    config: { coverageTier: "core", legalDesignations: ["important"], managerTypes: ["2"] },
    previewSnapshot: {
      status: "ready",
      activeVariant: "core",
      manifest: { adapter_id: "japan_port_v1", recipe_version: "port-v1", source_policy: "official", release_policy: "public", generated_at: "2026-05-19T00:00:00Z" },
      stats: { totalFeatures: 5, visibleFeatures: 4, visibleLabels: 3 },
      packMode: "preview",
      selected: {
        name: "Yokohama",
        properties: {
          legal_designation_label: "Important",
          manager: "Yokohama city",
          manager_type: "municipality",
          outer_facility_length_m: 1200,
          mooring_facility_length_m: 700,
          ferry_service: true,
          agency_labels: "MLIT",
        },
      },
    },
  });
  assert.equal(rowValue(portModel.rows, "Loaded ports"), "5");
  assert.equal(rowValue(portModel.rows, "Selected port"), "Yokohama");
  assert.equal(rowValue(portModel.rows, "Ferry service"), "Yes");
  assert.equal(rowValue(portModel.rows, "Outer facility"), "1200m");
});

test("inspector model reports empty logistics filters and layer status", () => {
  const logisticsModel = buildTransportWorkbenchInspectorModel({
    family: { id: "logistics_hubs", label: "Logistics hubs" },
    config: {
      hubTypes: ["logistics_center"],
      operatorClassifications: ["public"],
      showLabels: true,
    },
    previewSnapshot: {
      status: "ready",
      stats: { totalFeatures: 9, visibleFeatures: 0, filteredFeatures: 9 },
      manifest: { adapter_id: "japan_logistics_hubs_v1" },
    },
  });
  assert.equal(logisticsModel.stateCards.length, 1);
  assert.equal(logisticsModel.stateCards[0].title, "No features match the current filters");
  assert.equal(rowValue(logisticsModel.rows, "Visible hubs"), "0");
  assert.equal(rowValue(logisticsModel.rows, "Filtered out"), "9");

  const layerModel = buildTransportWorkbenchInspectorModel({
    family: { id: "layers", label: "Layers" },
    layerOrder: ["road", "energy_facilities", "custom"],
    getLayerFamilyMeta: (id) => ({ label: id }),
    isLivePreviewFamily: (id) => id === "road",
    isManifestOnlyRuntimeFamily: (id) => id === "energy_facilities",
  });
  assert.deepEqual(layerModel.rows, [
    ["1", "road (live)"],
    ["2", "energy_facilities (metadata)"],
    ["3", "custom (reserved)"],
  ]);
});

test("inspector owner keeps row class semantics out of the controller", () => {
  assert.deepEqual(getTransportWorkbenchInspectorRowClassNames({
    familyId: "logistics_hubs",
    index: 0,
    label: "Hub category",
  }), ["is-summary"]);
  assert.deepEqual(getTransportWorkbenchInspectorRowClassNames({
    familyId: "logistics_hubs",
    index: 4,
    label: "Selected hub",
  }), ["is-selected"]);
  assert.deepEqual(getTransportWorkbenchInspectorRowClassNames({
    familyId: "industrial_zones",
    index: 8,
    label: "Pack version",
  }), ["is-governance"]);
  assert.deepEqual(getTransportWorkbenchInspectorRowClassNames({
    familyId: "industrial_zones",
    label: "Source track",
  }), []);
  assert.deepEqual(getTransportWorkbenchInspectorRowClassNames({
    familyId: "road",
    index: 0,
    label: "Pack version",
  }), []);

  const previousDocument = globalThis.document;
  globalThis.document = createTestDocument();
  try {
    const owner = createTransportWorkbenchInspectorOwner();
    const row = owner.createRow("Pack version", "japan_industrial_zones_v2", {
      familyId: "industrial_zones",
      index: 2,
    });
    assert.equal(row.classList.contains("transport-workbench-inspector-row"), true);
    assert.equal(row.classList.contains("is-summary"), true);
    assert.equal(row.classList.contains("is-governance"), true);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("owner factory injects layer metadata and keeps translated lens label", () => {
  const owner = createTransportWorkbenchInspectorOwner({
    getLayerOrder: () => ["road", "port"],
    getLayerFamilyMeta: (id) => ({ label: id.toUpperCase() }),
    isLivePreviewFamily: (id) => id === "road",
    isManifestOnlyRuntimeFamily: (id) => id === "port",
  });
  const model = owner.buildInspectorModel({ family: { id: "layers", label: "Layers" } });
  assert.deepEqual(model.rows, [
    ["1", "ROAD (live)"],
    ["2", "PORT (metadata)"],
  ]);

  const summaryRows = owner.buildLensSummaryRows({
    family: { label: "Road", previewTitle: "Japan road" },
    previewSnapshot: { status: "ready" },
    dataContract: { packs: ["japan_road"], geometryKind: "line" },
    rightDeckLabel: "Translated right deck",
  });
  assert.equal(summaryRows.some(([label]) => label === "Right deck"), false);
  assert.equal(rowValue(summaryRows, "Pack status"), "ready");
  assert.equal(summaryRows.some(([label]) => label === "Compare"), false);
});

test("pack governance stays available for Data while Inspect shows the current result", () => {
  const previewSnapshot = {
    status: "ready",
    manifest: {
      adapter_id: "japan_road_v1",
      source_policy: "internal review",
      license_tier: "restricted",
      n06_source_member: "N06-23",
      n06_encoding: "CP932",
    },
    stats: { totalRoads: 12, visibleLabels: 3, filteredRoads: 2 },
  };
  const model = buildTransportWorkbenchInspectorModel({
    family: { id: "road", label: "Road" }, previewSnapshot,
    dataContract: { governance: "Review source terms before distribution." },
  });
  assert.equal(rowValue(model.rows, "Loaded roads"), "12");
  for (const label of ["Pack version", "Source policy", "N06 member", "N06 encoding"]) {
    assert.equal(model.rows.some(([candidate]) => candidate === label), false);
  }
  const details = buildTransportWorkbenchPackDetailsRows(previewSnapshot, {
    governance: "Review source terms before distribution.",
  }, "road");
  assert.equal(rowValue(details, "N06 encoding"), "CP932");
  assert.equal(rowValue(details, "License tier"), "restricted");
  assert.equal(rowValue(details, "Source and use"), "Review source terms before distribution.");
});

test("inspector owner skips detail DOM rebuilds when the rendered model is unchanged", () => {
  const previousDocument = globalThis.document;
  globalThis.document = createTestDocument();
  try {
    const owner = createTransportWorkbenchInspectorOwner();
    const detailsNode = document.createElement("div");
    const emptyCard = document.createElement("div");
    const input = {
      detailsNode,
      emptyCard,
      family: { id: "road", label: "Road" },
      config: { motorwayIdentitySource: "osm_only" },
      compareHeld: false,
      previewSnapshot: { status: "error", error: "source missing" },
      dataContract: { governance: "data/transport/road.json" },
    };

    const firstRender = owner.renderInspectorDetails(input);
    const secondRender = owner.renderInspectorDetails({ ...input });

    assert.equal(firstRender.reused, false);
    assert.equal(secondRender.reused, true);
    assert.equal(detailsNode.replaceChildrenCallCount, 1);
    assert.equal(detailsNode.childElementCount, 2);
    assert.equal(emptyCard.classList.contains("hidden"), true);

    const changedRender = owner.renderInspectorDetails({
      ...input,
      previewSnapshot: { status: "error", error: "different source missing" },
    });

    assert.equal(changedRender.reused, false);
    assert.equal(detailsNode.replaceChildrenCallCount, 2);
    assert.equal(
      buildTransportWorkbenchInspectorRenderSignature({
        familyId: "road",
        compareHeld: false,
        model: {
          rows: [["Pack status", "Road pack failed to load"]],
          stateCards: [],
        },
      }),
      buildTransportWorkbenchInspectorRenderSignature({
        familyId: "road",
        compareHeld: false,
        model: {
          rows: [["Pack status", "Road pack failed to load"]],
          stateCards: [],
        },
      }),
    );
  } finally {
    globalThis.document = previousDocument;
  }
});

test("inspector owner keeps the empty card visible for empty detail models", () => {
  const previousDocument = globalThis.document;
  globalThis.document = createTestDocument();
  try {
    const owner = createTransportWorkbenchInspectorOwner({
      getLayerOrder: () => [],
    });
    const detailsNode = document.createElement("div");
    const emptyCard = document.createElement("div");
    emptyCard.classList.add("hidden");

    const renderResult = owner.renderInspectorDetails({
      detailsNode,
      emptyCard,
      family: { id: "layers", label: "Layers" },
    });
    const secondRenderResult = owner.renderInspectorDetails({
      detailsNode,
      emptyCard,
      family: { id: "layers", label: "Layers" },
    });

    assert.equal(renderResult.reused, false);
    assert.equal(secondRenderResult.reused, true);
    assert.equal(detailsNode.childElementCount, 0);
    assert.equal(detailsNode.replaceChildrenCallCount, 1);
    assert.equal(emptyCard.classList.contains("hidden"), false);
  } finally {
    globalThis.document = previousDocument;
  }
});

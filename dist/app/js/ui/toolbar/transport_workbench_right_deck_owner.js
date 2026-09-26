// Transport workbench right-deck owner.
// Owns the control tabs, section DOM, and control event wiring for the workbench right deck.

import {
  getTransportWorkbenchFamilyPreviewSnapshot,
  selectTransportWorkbenchFamilyPreviewFeature,
} from "../transport_workbench_family_preview.js";
import {
  TRANSPORT_WORKBENCH_EDIT_OVERLAY_FAMILY_IDS,
} from "../../core/state.js";
import {
  TRANSPORT_WORKBENCH_CONTROL_SCHEMAS,
  TRANSPORT_WORKBENCH_DENSITY_FAMILY_IDS,
  TRANSPORT_WORKBENCH_DATA_CONTRACTS,
  TRANSPORT_WORKBENCH_TAB_SECTION_MAP,
} from "./transport_workbench_descriptor.js";
import { buildTransportWorkbenchPackDetailsRows } from "./transport_workbench_inspector_owner.js";
import {
  mapTransportWorkbenchLabelLevelToMaxLevel,
  mapTransportWorkbenchMaxLevelToLabelLevel,
} from "./transport_workbench_config_owner.js";

const TAB_MOUNTS = {
  display: "display",
  aggregation: "aggregation",
  labels: "labels",
  coverage: "coverage",
  data: "data",
};
const DATA_TAB_VISIBLE_ROW_LIMIT = 80;
const EDIT_OVERLAY_FAMILY_IDS = new Set(TRANSPORT_WORKBENCH_EDIT_OVERLAY_FAMILY_IDS);
const DATA_TAB_COLUMNS = Object.freeze([
  { key: "name", label: "Name", defaultVisible: true },
  { key: "editStatus", label: "Edit", defaultVisible: true },
  { key: "kind", label: "Kind", defaultVisible: true },
  { key: "visible", label: "Visible", defaultVisible: true },
  { key: "source", label: "Source", defaultVisible: true },
  { key: "location", label: "Location", defaultVisible: true },
]);
const DATA_TAB_SORT_OPTIONS = Object.freeze([
  { value: "default", label: "Default" },
  { value: "name", label: "Name" },
  { value: "editStatus", label: "Edit status" },
  { value: "visible", label: "Visible first" },
  { value: "source", label: "Source" },
]);
const dataTabStateByFamily = new Map();

const isElementLike = (node) => (
  !!node
  && typeof node.replaceChildren === "function"
  && typeof node.appendChild === "function"
);

const formatRangeValue = (rawValue, control) => {
  const numericValue = Number(rawValue);
  if (!Number.isFinite(numericValue)) return `${rawValue}${control.unit || ""}`;
  if (String(control.step || "").includes(".")) {
    return `${numericValue.toFixed(2).replace(/\.?0+$/, "")}${control.unit || ""}`;
  }
  return `${numericValue}${control.unit || ""}`;
};

const formatDataValue = (value) => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    return Math.abs(value) >= 1000 ? value.toLocaleString("en-US", { maximumFractionDigits: 0 }) : String(Number(value.toFixed(4)));
  }
  if (Array.isArray(value)) return value.filter(Boolean).join(", ") || "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
};

const formatDataCoordinate = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue.toFixed(4) : "—";
};

const createDataMetaNode = (label, value) => {
  const item = document.createElement("div");
  item.className = "transport-workbench-data-meta-item";
  const labelNode = document.createElement("span");
  labelNode.className = "transport-workbench-data-meta-label";
  labelNode.textContent = label;
  const valueNode = document.createElement("strong");
  valueNode.className = "transport-workbench-data-meta-value";
  valueNode.textContent = formatDataValue(value);
  item.append(labelNode, valueNode);
  return item;
};

const createDataFieldSummary = (properties = {}) => {
  const entries = Object.entries(properties || {})
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .slice(0, 6);
  if (entries.length === 0) return "";
  return entries.map(([key, value]) => `${key}: ${formatDataValue(value)}`).join(" · ");
};

const getDefaultDataTabColumnState = () => Object.fromEntries(
  DATA_TAB_COLUMNS.map((column) => [column.key, !!column.defaultVisible])
);

const getDataTabViewState = (familyId) => {
  const key = String(familyId || "default").trim() || "default";
  if (!dataTabStateByFamily.has(key)) {
    dataTabStateByFamily.set(key, {
      search: "",
      sort: "default",
      columns: getDefaultDataTabColumnState(),
    });
  }
  const state = dataTabStateByFamily.get(key);
  state.columns = { ...getDefaultDataTabColumnState(), ...(state.columns || {}) };
  return state;
};

const getDataRowSearchText = (row = {}) => [
  row.id,
  row.name,
  row.editStatus,
  row.kind,
  row.source,
  row.hiddenReason,
  row.lon,
  row.lat,
  row.lengthMeters,
  ...Object.values(row.properties || {}),
].map((value) => formatDataValue(value).toLowerCase()).join(" ");

const compareDataRows = (sortKey) => (left, right) => {
  if (sortKey === "name") {
    return String(left.name || left.id).localeCompare(String(right.name || right.id), "ja");
  }
  if (sortKey === "visible") {
    if (!!left.visible !== !!right.visible) return left.visible ? -1 : 1;
    return String(left.name || left.id).localeCompare(String(right.name || right.id), "ja");
  }
  if (sortKey === "editStatus") {
    const statusRank = { deleted: 0, updated: 1, created: 2, source: 3 };
    const leftRank = statusRank[left.editStatus] ?? 4;
    const rightRank = statusRank[right.editStatus] ?? 4;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return String(left.name || left.id).localeCompare(String(right.name || right.id), "ja");
  }
  if (sortKey === "source") {
    const sourceOrder = String(left.source || "").localeCompare(String(right.source || ""), "ja");
    if (sourceOrder !== 0) return sourceOrder;
    return String(left.name || left.id).localeCompare(String(right.name || right.id), "ja");
  }
  return 0;
};

const prepareDataRowsForView = (rows, viewState) => {
  const searchText = String(viewState.search || "").trim().toLowerCase();
  const filtered = searchText
    ? rows.filter((row) => getDataRowSearchText(row).includes(searchText))
    : [...rows];
  if (viewState.sort && viewState.sort !== "default") {
    filtered.sort(compareDataRows(viewState.sort));
  }
  return filtered;
};

const getDataCellText = (row, columnKey) => {
  if (columnKey === "name") return formatDataValue(row.name || row.id);
  if (columnKey === "editStatus") return formatDataValue(row.editStatus || "source");
  if (columnKey === "kind") return formatDataValue(row.kind);
  if (columnKey === "visible") return row.visible ? "Visible" : (row.hiddenReason || "Filtered");
  if (columnKey === "source") return formatDataValue(row.source);
  if (columnKey === "location") {
    if (Number.isFinite(Number(row.lon)) || Number.isFinite(Number(row.lat))) {
      return `${formatDataCoordinate(row.lon)}, ${formatDataCoordinate(row.lat)}`;
    }
    return formatDataValue(row.lengthMeters ? `${Math.round(Number(row.lengthMeters))} m` : "");
  }
  return formatDataValue(row[columnKey]);
};

const getPointOverlayStatusById = (overlay = {}) => {
  const statusById = new Map();
  const markEntries = (entries, status) => {
    (Array.isArray(entries) ? entries : []).forEach((entry) => {
      const id = String(entry?.id || entry || "").trim();
      if (id) statusById.set(id, status);
    });
  };
  markEntries(overlay.created || overlay.features, "created");
  markEntries(overlay.updated, "updated");
  markEntries(overlay.deleted, "deleted");
  return statusById;
};

const getDataRowEditStatus = (row = {}, overlayStatusById = new Map()) => {
  const id = String(row.id || "").trim();
  if (id && overlayStatusById.has(id)) return overlayStatusById.get(id);
  const properties = row.properties && typeof row.properties === "object" ? row.properties : {};
  if (properties.edit_overlay_mode === "updated") return "updated";
  if (row.editOverlay || properties.edit_overlay || properties.source === "user_overlay" || row.source === "user_overlay") return "created";
  return "source";
};

const decorateDataRowsWithEditStatus = (rows, overlay = {}) => {
  const overlayStatusById = getPointOverlayStatusById(overlay);
  const rowIds = new Set();
  const decorated = (Array.isArray(rows) ? rows : []).map((row) => {
    const id = String(row?.id || "").trim();
    if (id) rowIds.add(id);
    return {
      ...row,
      editStatus: getDataRowEditStatus(row, overlayStatusById),
    };
  });
  (Array.isArray(overlay.deleted) ? overlay.deleted : []).forEach((featureId) => {
    const id = String(featureId || "").trim();
    if (!id || rowIds.has(id)) return;
    decorated.push({
      id,
      name: id,
      kind: "",
      source: "",
      visible: false,
      hiddenReason: "Deleted",
      editStatus: "deleted",
      properties: {},
    });
  });
  return decorated;
};

export function createTransportWorkbenchRightDeckOwner({
  tabButtons = [],
  panels = {},
  mounts = {},
  translate = (value) => value,
  pickUiCopy = (_zh, en) => en,
  setInspectorTab = (tabId) => tabId || "inspect",
  getDisplayConfig = () => ({}),
  getPreviewSnapshot = getTransportWorkbenchFamilyPreviewSnapshot,
  isSectionOpen = () => false,
  updateFamilyConfig = () => {},
  updateDisplayConfig = () => {},
  toggleSection = () => {},
  createSectionHelpButton = () => null,
  renderDiagnosticsBody = () => document.createElement("div"),
  getEditOverlay = () => ({ features: [] }),
  addEditOverlayPoint = () => null,
  removeEditOverlayPoint = () => false,
  updateEditOverlayPoint = () => null,
  deleteEditOverlayPoint = () => false,
  selectPreviewFeature = selectTransportWorkbenchFamilyPreviewFeature,
} = {}) {
  const getSectionsForTab = (familyId, tabId) => {
    const sectionMap = TRANSPORT_WORKBENCH_TAB_SECTION_MAP[familyId] || {};
    const allowedSectionKeys = new Set(sectionMap[tabId] || []);
    return (TRANSPORT_WORKBENCH_CONTROL_SCHEMAS[familyId] || []).filter((section) => allowedSectionKeys.has(section.key));
  };

  const createEditOverlayNode = (family, previewSnapshot) => {
    if (!EDIT_OVERLAY_FAMILY_IDS.has(family.id)) return null;
    const overlay = getEditOverlay(family.id) || { features: [] };
    const features = Array.isArray(overlay.features) ? overlay.features : [];
    const updatedFeatures = Array.isArray(overlay.updated) ? overlay.updated : [];
    const deletedFeatureIds = Array.isArray(overlay.deleted) ? overlay.deleted : [];
    const selected = previewSnapshot?.selected || {};
    const hasSelectedFeature = !!String(selected?.id || "").trim();
    const card = document.createElement("div");
    card.className = "transport-workbench-note-card transport-workbench-edit-overlay-card";
    const title = document.createElement("div");
    title.className = "transport-workbench-note-title";
    title.textContent = translate("User Points");
    card.appendChild(title);
    const form = document.createElement("div");
    form.className = "transport-workbench-edit-overlay-form";
    const nameInput = document.createElement("input");
    nameInput.className = "text-input transport-workbench-edit-overlay-input";
    nameInput.type = "text";
    nameInput.placeholder = translate("Name");
    nameInput.value = selected?.name || "";
    const lonInput = document.createElement("input");
    lonInput.className = "text-input transport-workbench-edit-overlay-input";
    lonInput.type = "number";
    lonInput.step = "0.0001";
    lonInput.placeholder = translate("Longitude");
    lonInput.value = Number.isFinite(Number(selected?.lon)) ? String(selected.lon) : "";
    const latInput = document.createElement("input");
    latInput.className = "text-input transport-workbench-edit-overlay-input";
    latInput.type = "number";
    latInput.step = "0.0001";
    latInput.placeholder = translate("Latitude");
    latInput.value = Number.isFinite(Number(selected?.lat)) ? String(selected.lat) : "";
    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "transport-workbench-data-action-button";
    addButton.textContent = translate("Add point");
    addButton.addEventListener("click", () => {
      addEditOverlayPoint(family.id, {
        name: nameInput.value,
        lon: lonInput.value,
        lat: latInput.value,
      });
    });
    const updateButton = document.createElement("button");
    updateButton.type = "button";
    updateButton.className = "transport-workbench-data-action-button";
    updateButton.textContent = translate("Save selected");
    updateButton.disabled = !hasSelectedFeature;
    updateButton.addEventListener("click", () => {
      updateEditOverlayPoint(family.id, selected.id, {
        name: nameInput.value,
        lon: lonInput.value,
        lat: latInput.value,
      });
    });
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "transport-workbench-data-action-button transport-workbench-data-action-button-subtle";
    deleteButton.textContent = translate("Delete selected");
    deleteButton.disabled = !hasSelectedFeature;
    deleteButton.addEventListener("click", () => {
      deleteEditOverlayPoint(family.id, selected.id);
    });
    form.append(nameInput, lonInput, latInput, addButton, updateButton, deleteButton);
    card.appendChild(form);
    const list = document.createElement("div");
    list.className = "transport-workbench-edit-overlay-list";
    if (!features.length) {
      const empty = document.createElement("p");
      empty.className = "transport-workbench-note-text";
      empty.textContent = translate("No user points in this family yet.");
      list.appendChild(empty);
    } else {
      features.forEach((feature) => {
        const row = document.createElement("div");
        row.className = "transport-workbench-edit-overlay-row";
        const label = document.createElement("button");
        label.type = "button";
        label.className = "transport-workbench-data-row-button";
        label.textContent = formatDataValue(feature.name || feature.id);
        label.addEventListener("click", () => {
          selectPreviewFeature(family.id, { id: feature.id, kind: family.id });
        });
        const meta = document.createElement("span");
        meta.className = "transport-workbench-edit-overlay-row-meta";
        meta.textContent = `${formatDataCoordinate(feature.lon)}, ${formatDataCoordinate(feature.lat)}`;
        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "transport-workbench-data-action-button transport-workbench-data-action-button-subtle";
        removeButton.textContent = translate("Remove");
        removeButton.addEventListener("click", () => {
          removeEditOverlayPoint(family.id, feature.id);
        });
        row.append(label, meta, removeButton);
        list.appendChild(row);
      });
    }
    card.appendChild(list);
    if (updatedFeatures.length || deletedFeatureIds.length) {
      const status = document.createElement("div");
      status.className = "transport-workbench-edit-overlay-delta-status";
      const updated = document.createElement("span");
      updated.textContent = `${translate("Updated")}: ${formatDataValue(updatedFeatures.length)}`;
      const deleted = document.createElement("span");
      deleted.textContent = `${translate("Deleted")}: ${formatDataValue(deletedFeatureIds.length)}`;
      status.append(updated, deleted);
      card.appendChild(status);
    }
    return card;
  };

  const createDataTabNode = (family, config) => {
    const previewSnapshot = getPreviewSnapshot(family.id, config) || {};
    const overlay = EDIT_OVERLAY_FAMILY_IDS.has(family.id) ? getEditOverlay(family.id) : {};
    const rows = decorateDataRowsWithEditStatus(previewSnapshot.dataRows, overlay);
    const viewState = getDataTabViewState(family.id);
    const viewRows = prepareDataRowsForView(rows, viewState);
    const visibleRows = viewRows.slice(0, DATA_TAB_VISIBLE_ROW_LIMIT);
    const totalRows = Number.isFinite(Number(previewSnapshot.dataRowCount))
      ? Number(previewSnapshot.dataRowCount)
      : rows.length;
    const card = document.createElement("div");
    card.className = "transport-workbench-note-card transport-workbench-data-card";
    const header = document.createElement("div");
    header.className = "transport-workbench-data-header";
    const title = document.createElement("div");
    title.className = "transport-workbench-note-title";
    title.textContent = translate("Loaded Data");
    const meta = document.createElement("div");
    meta.className = "transport-workbench-data-meta";
    meta.append(
      createDataMetaNode(translate("Pack Rows"), totalRows),
      createDataMetaNode(translate("Table Rows"), rows.length),
      createDataMetaNode(translate("Mode"), previewSnapshot.packMode || previewSnapshot.status || "idle"),
      createDataMetaNode(translate("Shown"), Math.min(visibleRows.length, viewRows.length))
    );
    header.append(title, meta);
    card.appendChild(header);
    const packDetailsRows = buildTransportWorkbenchPackDetailsRows(
      previewSnapshot, TRANSPORT_WORKBENCH_DATA_CONTRACTS[family.id], family.id,
    );
    if (packDetailsRows.length) {
      const details = document.createElement("details");
      details.className = "transport-workbench-pack-details";
      const summary = document.createElement("summary");
      summary.textContent = translate("Pack details");
      const detailList = document.createElement("div");
      detailList.className = "transport-workbench-data-meta";
      packDetailsRows.forEach(([label, value]) => {
        detailList.appendChild(createDataMetaNode(translate(label), value));
      });
      details.append(summary, detailList);
      card.appendChild(details);
    }
    if (rows.length === 0) {
      const empty = document.createElement("p");
      empty.className = "transport-workbench-note-text";
      empty.textContent = translate("No loaded feature rows for the current preview pack.");
      card.appendChild(empty);
      return card;
    }
    const controls = document.createElement("div");
    controls.className = "transport-workbench-data-controls";
    const searchInput = document.createElement("input");
    searchInput.className = "text-input transport-workbench-data-search";
    searchInput.type = "search";
    searchInput.placeholder = translate("Search table rows");
    searchInput.value = viewState.search || "";
    const sortSelect = document.createElement("select");
    sortSelect.className = "select-input transport-workbench-data-sort";
    DATA_TAB_SORT_OPTIONS.forEach((option) => {
      const optionNode = document.createElement("option");
      optionNode.value = option.value;
      optionNode.textContent = translate(option.label);
      optionNode.selected = option.value === viewState.sort;
      sortSelect.appendChild(optionNode);
    });
    const columnControls = document.createElement("div");
    columnControls.className = "transport-workbench-data-column-controls";
    DATA_TAB_COLUMNS.forEach((column) => {
      const label = document.createElement("label");
      label.className = "transport-workbench-data-column-toggle";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!viewState.columns[column.key];
      input.dataset.transportDataColumn = column.key;
      input.addEventListener("change", () => {
        viewState.columns[column.key] = input.checked;
        if (!DATA_TAB_COLUMNS.some((candidate) => viewState.columns[candidate.key])) {
          viewState.columns.name = true;
        }
        renderTableRows();
      });
      const text = document.createElement("span");
      text.textContent = translate(column.label);
      label.append(input, text);
      columnControls.appendChild(label);
    });
    controls.append(searchInput, sortSelect, columnControls);
    card.appendChild(controls);
    const tableWrap = document.createElement("div");
    tableWrap.className = "transport-workbench-data-table-wrap";
    const table = document.createElement("table");
    table.className = "transport-workbench-data-table";
    const thead = document.createElement("thead");
    const tbody = document.createElement("tbody");
    const renderTableRows = () => {
      const activeColumns = DATA_TAB_COLUMNS.filter((column) => viewState.columns[column.key]);
      const nextRows = prepareDataRowsForView(rows, viewState).slice(0, DATA_TAB_VISIBLE_ROW_LIMIT);
      thead.replaceChildren();
      tbody.replaceChildren();
      const headerRow = document.createElement("tr");
      activeColumns.forEach((column) => {
        const cell = document.createElement("th");
        cell.scope = "col";
        cell.textContent = translate(column.label);
        headerRow.appendChild(cell);
      });
      thead.appendChild(headerRow);
      nextRows.forEach((row) => {
        const tableRow = document.createElement("tr");
        if (row.selected) {
          tableRow.classList.add("is-selected");
        }
        activeColumns.forEach((column) => {
          const cell = document.createElement("td");
          if (column.key === "name") {
            const selectButton = document.createElement("button");
            selectButton.type = "button";
            selectButton.className = "transport-workbench-data-row-button";
            selectButton.textContent = getDataCellText(row, column.key);
            selectButton.dataset.transportDataRowId = row.id || "";
            selectButton.dataset.transportDataRowKind = row.kind || "";
            selectButton.addEventListener("click", () => {
              selectPreviewFeature(family.id, row);
            });
            cell.appendChild(selectButton);
            const fieldSummary = createDataFieldSummary(row.properties);
            if (fieldSummary) {
              const sub = document.createElement("div");
              sub.className = "transport-workbench-data-row-subtext";
              sub.textContent = fieldSummary;
              cell.appendChild(sub);
            }
          } else {
            cell.textContent = column.key === "visible"
              ? translate(getDataCellText(row, column.key))
              : getDataCellText(row, column.key);
          }
          tableRow.appendChild(cell);
        });
        tbody.appendChild(tableRow);
      });
    };
    searchInput.addEventListener("input", () => {
      viewState.search = searchInput.value;
      renderTableRows();
    });
    sortSelect.addEventListener("change", () => {
      viewState.sort = sortSelect.value || "default";
      renderTableRows();
    });
    renderTableRows();
    table.appendChild(thead);
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    card.appendChild(tableWrap);
    if (viewRows.length > visibleRows.length || totalRows > rows.length) {
      const note = document.createElement("p");
      note.className = "transport-workbench-note-text transport-workbench-data-limit-note";
      note.textContent = translate("Search and sort use the current table sample; the side panel keeps a bounded row set to stay responsive.");
      card.appendChild(note);
    }
    return card;
  };

  // 单个 control 只负责 schema -> DOM -> config update；compareHeld 锁住交互，保留对比基线不被拖拽误写。
  const renderControl = (familyId, control, config, compareHeld) => {
    const previewSnapshot = getPreviewSnapshot(familyId, config);
    const resolvedOptions = typeof control.options === "function"
      ? (control.options({ familyId, config, previewSnapshot }) || [])
      : (control.options || []);
    const field = document.createElement("div");
    field.className = "transport-workbench-field";
    const title = document.createElement("div");
    title.className = "transport-workbench-field-title";
    title.textContent = translate(control.label);
    field.appendChild(title);

    if (control.type === "toggle") {
      const label = document.createElement("label");
      label.className = "transport-workbench-toggle";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!config[control.key];
      input.disabled = compareHeld;
      const text = document.createElement("span");
      text.textContent = translate(input.checked ? "Enabled" : "Disabled");
      input.addEventListener("change", () => {
        if (compareHeld) return;
        updateFamilyConfig(familyId, control.key, input.checked);
        text.textContent = translate(input.checked ? "Enabled" : "Disabled");
      });
      label.appendChild(input);
      label.appendChild(text);
      field.appendChild(label);
      return field;
    }

    if (control.type === "select") {
      const select = document.createElement("select");
      select.className = "select-input transport-workbench-select";
      select.disabled = compareHeld;
      resolvedOptions.forEach((option) => {
        const optionNode = document.createElement("option");
        optionNode.value = option.value;
        optionNode.textContent = translate(option.label);
        optionNode.selected = option.value === config[control.key];
        select.appendChild(optionNode);
      });
      select.addEventListener("change", () => {
        if (compareHeld) return;
        updateFamilyConfig(familyId, control.key, select.value);
      });
      field.appendChild(select);
      return field;
    }

    if (control.type === "range") {
      const rangeRow = document.createElement("div");
      rangeRow.className = "transport-workbench-range-row";
      const range = document.createElement("input");
      range.type = "range";
      range.className = "transport-workbench-range";
      range.min = String(control.min);
      range.max = String(control.max);
      range.step = String(control.step || 1);
      range.value = String(config[control.key]);
      range.disabled = compareHeld;
      const value = document.createElement("span");
      value.className = "transport-workbench-range-value";
      value.textContent = formatRangeValue(config[control.key], control);
      range.addEventListener("input", () => {
        value.textContent = formatRangeValue(range.value, control);
      });
      range.addEventListener("change", () => {
        if (compareHeld) return;
        updateFamilyConfig(familyId, control.key, Number(range.value));
      });
      rangeRow.appendChild(range);
      rangeRow.appendChild(value);
      field.appendChild(rangeRow);
      return field;
    }

    if (control.type === "multi") {
      const optionGrid = document.createElement("div");
      optionGrid.className = "transport-workbench-option-grid";
      const defaultValuesWhenEmpty = control.defaultAllWhenEmpty
        ? resolvedOptions.filter((option) => !option.disabled).map((option) => option.value)
        : [];
      resolvedOptions.forEach((option) => {
        const label = document.createElement("label");
        label.className = "transport-workbench-option-pill";
        if (option.disabled) {
          label.classList.add("is-disabled");
        }
        const input = document.createElement("input");
        input.type = "checkbox";
        const configuredValues = Array.isArray(config[control.key]) ? config[control.key] : [];
        const effectiveValues = configuredValues.length === 0 && control.defaultAllWhenEmpty
          ? defaultValuesWhenEmpty
          : configuredValues;
        input.checked = effectiveValues.includes(option.value);
        input.disabled = compareHeld || !!option.disabled;
        input.addEventListener("change", () => {
          if (compareHeld || option.disabled) return;
          if (control.defaultAllWhenEmpty) {
            const nextValues = [...effectiveValues];
            const valueIndex = nextValues.indexOf(option.value);
            if (input.checked) {
              if (valueIndex === -1) nextValues.push(option.value);
            } else if (valueIndex !== -1) {
              nextValues.splice(valueIndex, 1);
            }
            updateFamilyConfig(familyId, control.key, nextValues);
            return;
          }
          updateFamilyConfig(familyId, control.key, input.checked, { appendValue: option.value });
        });
        const text = document.createElement("span");
        text.textContent = translate(option.label);
        label.appendChild(input);
        label.appendChild(text);
        optionGrid.appendChild(label);
      });
      field.appendChild(optionGrid);
      return field;
    }

    return field;
  };

  const createSectionNode = (family, section, config, compareHeld) => {
    const visibleControls = (section.controls || []).filter((control) => (
      typeof control.showWhen !== "function" || control.showWhen(config)
    ));
    if (section.kind !== "diagnostics" && visibleControls.length === 0) {
      return null;
    }
    const details = document.createElement("details");
    details.className = "transport-workbench-section";
    details.open = !!isSectionOpen(family.id, section.key);
    details.addEventListener("toggle", () => {
      toggleSection(family.id, section.key, details.open);
    });
    const summary = document.createElement("summary");
    summary.className = "transport-workbench-section-summary";
    const heading = document.createElement("div");
    heading.className = "transport-workbench-section-heading";
    const title = document.createElement("div");
    title.className = "transport-workbench-section-title";
    title.textContent = translate(section.title);
    const actions = document.createElement("div");
    actions.className = "transport-workbench-section-actions";
    const helpButton = createSectionHelpButton(family.id, section);
    if (helpButton) {
      actions.appendChild(helpButton);
    }
    const chevron = document.createElement("span");
    chevron.className = "transport-workbench-section-chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "▾";
    actions.appendChild(chevron);
    heading.appendChild(title);
    summary.appendChild(heading);
    summary.appendChild(actions);
    details.appendChild(summary);
    const body = section.kind === "diagnostics"
      ? renderDiagnosticsBody(family.id, config)
      : document.createElement("div");
    if (section.kind !== "diagnostics") {
      body.className = "transport-workbench-section-body";
      if (section.description) {
        const description = document.createElement("p");
        description.className = "transport-workbench-section-description";
        description.textContent = translate(section.description);
        body.appendChild(description);
      }
      visibleControls.forEach((control) => {
        body.appendChild(renderControl(family.id, control, config, compareHeld));
      });
    } else if (section.description) {
      const description = document.createElement("p");
      description.className = "transport-workbench-section-description transport-workbench-section-description-diagnostics";
      description.textContent = translate(section.description);
      body.prepend(description);
    }
    details.appendChild(body);
    return details;
  };

  const createShellCard = (family, tabId, config, compareHeld) => {
    if (!TRANSPORT_WORKBENCH_DENSITY_FAMILY_IDS.has(family.id)) {
      return null;
    }
    // density families 有 displayConfig 这一层运行时壳；它展示当前显示策略，避免把聚合/标签细调塞进普通 section schema。
    const displayConfig = getDisplayConfig(family.id);
    const card = document.createElement("div");
    card.className = "transport-workbench-note-card transport-workbench-note-card-soft transport-workbench-shell-card";
    const heading = document.createElement("div");
    heading.className = "transport-workbench-shell-heading";
    const title = document.createElement("div");
    title.className = "transport-workbench-note-title";
    title.textContent = translate(
      tabId === "display"
        ? "Display settings"
        : tabId === "aggregation"
          ? "Aggregation settings"
          : tabId === "labels"
            ? "Label settings"
            : "Coverage settings"
    );
    const kicker = document.createElement("span");
    kicker.className = "transport-workbench-shell-kicker";
    kicker.textContent = translate("Current settings");
    heading.append(title, kicker);
    card.appendChild(heading);
    const grid = document.createElement("div");
    grid.className = "transport-workbench-shell-grid";
    const addShellSelect = (labelText, value, options, onChange, mountTarget = grid) => {
      const control = document.createElement("div");
      control.className = "transport-workbench-shell-control";
      const label = document.createElement("div");
      label.className = "transport-workbench-shell-label";
      label.textContent = translate(labelText);
      const select = document.createElement("select");
      select.className = "select-input transport-workbench-select";
      select.disabled = compareHeld;
      options.forEach((option) => {
        const optionNode = document.createElement("option");
        optionNode.value = option.value;
        optionNode.textContent = translate(option.label);
        optionNode.selected = option.value === value;
        select.appendChild(optionNode);
      });
      select.addEventListener("change", () => {
        if (compareHeld) return;
        onChange(select.value);
      });
      control.append(label, select);
      mountTarget.appendChild(control);
    };
    const addShellRange = (labelText, value, min, max, step, unit, onChange, mountTarget = grid) => {
      const control = document.createElement("div");
      control.className = "transport-workbench-shell-control";
      const label = document.createElement("div");
      label.className = "transport-workbench-shell-label";
      label.textContent = translate(labelText);
      const row = document.createElement("div");
      row.className = "transport-workbench-range-row";
      const input = document.createElement("input");
      input.type = "range";
      input.className = "transport-workbench-range";
      input.disabled = compareHeld;
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(value);
      const valueNode = document.createElement("span");
      valueNode.className = "transport-workbench-range-value";
      valueNode.textContent = `${value}${unit}`;
      input.addEventListener("input", () => {
        valueNode.textContent = `${input.value}${unit}`;
      });
      input.addEventListener("change", () => {
        if (compareHeld) return;
        onChange(Number(input.value));
      });
      row.append(input, valueNode);
      control.append(label, row);
      mountTarget.appendChild(control);
    };
    const addShellToggle = (labelText, checked, onChange, mountTarget = grid) => {
      const control = document.createElement("div");
      control.className = "transport-workbench-shell-control";
      const label = document.createElement("div");
      label.className = "transport-workbench-shell-label";
      label.textContent = translate(labelText);
      const toggle = document.createElement("label");
      toggle.className = "transport-workbench-toggle";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!checked;
      input.disabled = compareHeld;
      const text = document.createElement("span");
      text.textContent = input.checked ? translate("Enabled") : translate("Disabled");
      input.addEventListener("change", () => {
        if (compareHeld) return;
        text.textContent = input.checked ? translate("Enabled") : translate("Disabled");
        onChange(input.checked);
      });
      toggle.append(input, text);
      control.append(label, toggle);
      mountTarget.appendChild(control);
    };
    if (tabId === "display") {
      addShellSelect("Mode", displayConfig.mode, [
        { value: "inspect", label: "Inspect" },
        { value: "aggregate", label: "Aggregate" },
        { value: "density", label: "Density" },
      ], (nextValue) => updateDisplayConfig(family.id, (draft) => {
        draft.mode = nextValue;
      }));
      addShellSelect("Preset", displayConfig.preset, [
        { value: "review_first", label: "Review first" },
        { value: "balanced", label: "Balanced" },
        { value: "pattern_first", label: "Pattern first" },
        { value: "extreme_density", label: "Extreme density" },
      ], (nextValue) => updateDisplayConfig(family.id, (draft) => {
        draft.preset = nextValue;
      }));
    } else if (tabId === "aggregation") {
      const algorithmOptions = family.id === "mineral_resources"
        ? [
          { value: "hex", label: "Hex grid" },
          { value: "square", label: "Square grid" },
          { value: "density_surface", label: "Density surface" },
        ]
        : family.id === "industrial_zones"
          ? [
            { value: "square", label: "Square grid" },
            { value: "density_surface", label: "Density surface" },
          ]
          : [
            { value: "cluster", label: "Cluster" },
            { value: "square", label: "Grid" },
            { value: "density_surface", label: "Density surface" },
          ];
      addShellSelect("Algorithm", displayConfig.aggregation.algorithm, algorithmOptions, (nextValue) => {
        updateDisplayConfig(family.id, (draft) => {
          draft.aggregation.algorithm = nextValue;
        });
      });
      addShellRange(
        "Cell size",
        Number(displayConfig.aggregation.thresholds?.cellSizePx || config?.aggregationCellSizePx || 44),
        24,
        96,
        2,
        "px",
        (nextValue) => updateDisplayConfig(family.id, (draft) => {
          draft.aggregation.thresholds.cellSizePx = nextValue;
        })
      );
    } else if (tabId === "labels") {
      addShellSelect("Geographic level", mapTransportWorkbenchMaxLevelToLabelLevel(displayConfig.labels.maxLevel), [
        { value: "region", label: "Level 1 region" },
        { value: "anchor", label: "Level 2 anchor" },
        { value: "category", label: "Level 3 category" },
      ], (nextValue) => updateDisplayConfig(family.id, (draft) => {
        draft.labels.maxLevel = mapTransportWorkbenchLabelLevelToMaxLevel(nextValue);
      }));
      addShellRange(
        "Label budget",
        Number(displayConfig.labels.budget || config?.labelBudget || 8),
        3,
        18,
        1,
        "",
        (nextValue) => updateDisplayConfig(family.id, (draft) => {
          draft.labels.budget = nextValue;
        })
      );
      addShellToggle("Allow label aggregation", !!displayConfig.labels.allowAggregation, (nextValue) => {
        updateDisplayConfig(family.id, (draft) => {
          draft.labels.allowAggregation = nextValue;
        });
      });
    } else if (tabId === "coverage") {
      if (family.id === "port") {
        addShellSelect("Coverage tier", displayConfig.coverage || "core", [
          { value: "core", label: "Core" },
          { value: "expanded", label: "Expanded" },
          { value: "full_official", label: "Full official" },
        ], (nextValue) => updateDisplayConfig(family.id, (draft) => {
          draft.coverage = nextValue;
        }));
      }
    }
    const note = document.createElement("p");
    note.className = "transport-workbench-shell-note";
    note.textContent = tabId === "data"
      ? translate("Manifest and audit stay read-only here so control tuning and source truth do not get mixed.")
      : translate("Use this panel to adjust the current family without changing the lens column context.");
    card.append(grid, note);
    return card;
  };

  const appendAdvancedRange = (tabId, family, config, body, compareHeld) => {
    const displayConfig = getDisplayConfig(family.id);
    const control = document.createElement("div");
    control.className = "transport-workbench-shell-control";
    const label = document.createElement("div");
    label.className = "transport-workbench-shell-label";
    label.textContent = translate(tabId === "aggregation" ? "Cluster radius" : "Label separation");
    const row = document.createElement("div");
    row.className = "transport-workbench-range-row";
    const input = document.createElement("input");
    input.type = "range";
    input.className = "transport-workbench-range";
    input.disabled = compareHeld;
    input.min = tabId === "aggregation" ? "24" : "0.7";
    input.max = tabId === "aggregation" ? "120" : "1.8";
    input.step = tabId === "aggregation" ? "2" : "0.05";
    const value = tabId === "aggregation"
      ? Number(displayConfig.aggregation.thresholds?.clusterRadiusPx || config?.aggregationClusterRadiusPx || 48)
      : Number(displayConfig.labels.separationStrength || config?.labelSeparation || 1);
    const unit = tabId === "aggregation" ? "px" : "";
    input.value = String(value);
    const valueText = document.createElement("span");
    valueText.className = "transport-workbench-range-value";
    const formatValue = (nextValue) => `${nextValue}${unit}`;
    valueText.textContent = formatValue(value);
    const commitValue = () => {
      const nextValue = Number(input.value);
      valueText.textContent = formatValue(nextValue);
      if (compareHeld) return;
      updateDisplayConfig(family.id, (draft) => {
        if (tabId === "aggregation") {
          draft.aggregation.thresholds.clusterRadiusPx = nextValue;
        } else {
          draft.labels.separationStrength = nextValue;
        }
      });
    };
    input.addEventListener("input", () => {
      valueText.textContent = formatValue(Number(input.value));
    });
    input.addEventListener("change", commitValue);
    row.append(input, valueText);
    control.append(label, row);
    body.appendChild(control);
  };

  const renderTabSections = (family, config, compareHeld, tabId, mountNode) => {
    if (!isElementLike(mountNode)) return;
    mountNode.replaceChildren();
    const shellCard = createShellCard(family, tabId, config, compareHeld);
    if (shellCard) {
      mountNode.appendChild(shellCard);
    }
    if (tabId === "data") {
      const previewSnapshot = getPreviewSnapshot(family.id, config) || {};
      const editOverlayNode = createEditOverlayNode(family, previewSnapshot);
      if (editOverlayNode) {
        mountNode.appendChild(editOverlayNode);
      }
      mountNode.appendChild(createDataTabNode(family, config));
    }
    const skipDefaultSections = TRANSPORT_WORKBENCH_DENSITY_FAMILY_IDS.has(family.id)
      && (tabId === "aggregation" || tabId === "labels");
    if (!skipDefaultSections) {
      getSectionsForTab(family.id, tabId).forEach((section) => {
        const node = createSectionNode(family, section, config, compareHeld);
        if (node) {
          mountNode.appendChild(node);
        }
      });
    }
    if (tabId === "aggregation" || tabId === "labels") {
      const advanced = document.createElement("details");
      advanced.className = "transport-workbench-advanced";
      const summary = document.createElement("summary");
      summary.textContent = translate("Advanced");
      advanced.appendChild(summary);
      const body = document.createElement("div");
      body.className = "transport-workbench-section-body transport-workbench-section-body-advanced";
      const copy = document.createElement("p");
      copy.className = "transport-workbench-section-description";
      copy.textContent = tabId === "aggregation"
        ? pickUiCopy(
          "调整聚合半径、网格大小和密度阈值。",
          "Adjust cluster radius, cell size, and density thresholds."
        )
        : pickUiCopy(
          "调整标签间距和显示阈值。",
          "Adjust label spacing and display thresholds."
        );
      appendAdvancedRange(tabId, family, config, body, compareHeld);
      body.appendChild(copy);
      advanced.appendChild(body);
      mountNode.appendChild(advanced);
    }
    if (mountNode.childElementCount === 0) {
      const empty = document.createElement("div");
      empty.className = "transport-workbench-empty-card";
      const title = document.createElement("div");
      title.className = "transport-workbench-empty-title";
      title.textContent = tabId === "data" ? translate("No audit payload yet") : translate("No controls in this tab");
      const body = document.createElement("p");
      body.className = "transport-workbench-empty-text";
      body.textContent = tabId === "data"
        ? translate("This family has not exposed extra manifest or audit cards in the current shell.")
        : family.id === "layers"
          ? pickUiCopy(
            "在中间拖动图层以调整顺序，并在 Inspect 确认结果。",
            "Drag layers in the center board to change their order, then check the result in Inspect."
          )
          : pickUiCopy(
            "此页没有可调整的设置。请使用其他页签，或在 Inspect 查看当前结果。",
            "No settings are available here. Use another tab or check the current result in Inspect."
          );
      empty.append(title, body);
      mountNode.appendChild(empty);
    }
  };

  const renderTabs = ({ family, config, compareHeld, activeTab }) => {
    const resolvedTab = setInspectorTab(activeTab);
    tabButtons.forEach((button) => {
      const isActive = String(button.dataset.transportInspectorTab || "") === resolvedTab;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
      button.setAttribute("tabindex", isActive ? "0" : "-1");
    });
    Object.entries(panels).forEach(([tabId, panel]) => {
      if (!panel || !panel.classList) return;
      panel.classList.toggle("hidden", tabId !== resolvedTab);
      panel.classList.toggle("is-active", tabId === resolvedTab);
      panel.hidden = tabId !== resolvedTab;
    });
    if (Object.prototype.hasOwnProperty.call(TAB_MOUNTS, resolvedTab)) {
      renderTabSections(family, config, compareHeld, resolvedTab, mounts[resolvedTab]);
    }
    return resolvedTab;
  };

  return {
    renderControl,
    renderTabSections,
    renderTabs,
  };
}

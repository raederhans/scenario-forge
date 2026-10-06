import {
  createEmptyThematicLayerCatalogPreview,
  loadThematicLayerCatalogPreview,
  THEMATIC_CATALOG_PENDING_SUMMARY,
} from "../../core/thematic_layer_catalog.js";
import {
  buildThematicCatalogDiagnostic,
  resolveLayerStatusTone,
  sanitizeLayerStatusText,
} from "./layer_status_diagnostics.js";

const THEMATIC_CATALOG_LOAD_FAILED_SUMMARY = "Preview load failed";

function translateUi(translate, key) {
  return typeof translate === "function" ? translate(key, "ui") : key;
}

function formatPreviewMessage(value, fallback = THEMATIC_CATALOG_PENDING_SUMMARY) {
  const sanitized = sanitizeLayerStatusText(value);
  return sanitized === "Status unavailable" ? fallback : sanitized;
}

function normalizePreviewError(error) {
  if (error instanceof Error) {
    return formatPreviewMessage(error.message, THEMATIC_CATALOG_LOAD_FAILED_SUMMARY);
  }
  const errorType = typeof error;
  const rawMessage = errorType === "string"
    || errorType === "number"
    || errorType === "boolean"
    || errorType === "bigint"
    ? String(error)
    : "";
  return formatPreviewMessage(rawMessage, THEMATIC_CATALOG_LOAD_FAILED_SUMMARY);
}

function formatValue(value, fallback = "Pending") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function createTextNodeElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function setStatusSeverity(node, diagnostic) {
  const normalizedSeverity = String(diagnostic?.severity || "muted").trim() || "muted";
  node.dataset.severity = normalizedSeverity;
  node.dataset.statusTone = resolveLayerStatusTone(diagnostic, normalizedSeverity);
  node.classList.toggle("is-active", normalizedSeverity === "active");
  node.classList.toggle("is-warning", normalizedSeverity === "warning");
  node.classList.toggle("is-muted", normalizedSeverity === "muted");
}

function createBadge(text, modifier = "") {
  const badge = createTextNodeElement("span", "thematic-layer-badge", text);
  if (modifier) badge.classList.add(modifier);
  return badge;
}

function createMetaRow(label, value) {
  const row = document.createElement("div");
  row.className = "thematic-layer-meta-row";
  row.append(
    createTextNodeElement("dt", "thematic-layer-meta-label", label),
    createTextNodeElement("dd", "thematic-layer-meta-value", value),
  );
  return row;
}

function createLayerCard(layer, translate) {
  const card = document.createElement("article");
  card.className = "thematic-layer-card";
  card.setAttribute("role", "listitem");
  card.dataset.thematicLayerId = layer.layerId;

  const header = document.createElement("div");
  header.className = "thematic-layer-card-header";
  const title = createTextNodeElement("h3", "thematic-layer-card-title", translateUi(translate, layer.title));
  const subtitle = createTextNodeElement("p", "thematic-layer-card-summary", layer.summary);
  header.append(title, subtitle);

  const badgeRow = document.createElement("div");
  badgeRow.className = "thematic-layer-badge-row";
  if (layer.fixtureOnly) {
    badgeRow.append(createBadge(translateUi(translate, "Fixture only"), "is-warning"));
  }
  if (layer.hiddenByDefault) {
    badgeRow.append(createBadge(translateUi(translate, "Hidden by default")));
  }
  if (layer.disabledReason) {
    badgeRow.append(createBadge(translateUi(translate, layer.disabledReason), "is-muted"));
  }

  const metadata = document.createElement("dl");
  metadata.className = "thematic-layer-meta-grid";
  metadata.append(
    createMetaRow(translateUi(translate, "Theme"), formatValue(layer.theme)),
    createMetaRow(translateUi(translate, "Geometry"), formatValue(layer.geometryKind)),
    createMetaRow(translateUi(translate, "Status"), formatValue(layer.statusLabel)),
    createMetaRow(translateUi(translate, "Source"), formatValue(layer.sourcePolicyLabel)),
    createMetaRow(translateUi(translate, "Coverage"), formatValue(layer.coverageScope)),
    createMetaRow(translateUi(translate, "Renderer"), formatValue(layer.renderer)),
    createMetaRow(translateUi(translate, "Payload"), formatValue(layer.payloadKind)),
    createMetaRow(translateUi(translate, "Manifest"), formatValue(layer.manifestPath)),
  );

  card.append(header, badgeRow, metadata);
  return card;
}

export function createThematicLayerPreviewController({
  t,
  loadCatalogPreview = loadThematicLayerCatalogPreview,
} = {}) {
  const listNode = document.getElementById("thematicLayerPreviewList");
  const statusNode = document.getElementById("thematicLayerCatalogStatus");
  let preview = createEmptyThematicLayerCatalogPreview();

  const renderStatus = () => {
    if (!statusNode) return;
    const diagnostic = buildThematicCatalogDiagnostic({
      thematicCatalogPreview: preview,
    }, { translate: t });
    const summary = sanitizeLayerStatusText(diagnostic.summary || THEMATIC_CATALOG_PENDING_SUMMARY);
    statusNode.textContent = summary;
    statusNode.dataset.statusSummary = summary;
    setStatusSeverity(statusNode, diagnostic);
  };

  const renderEmptyState = () => {
    if (!listNode) return;
    const message = preview.error || preview.summary || THEMATIC_CATALOG_PENDING_SUMMARY;
    listNode.replaceChildren(createTextNodeElement(
      "p",
      "thematic-layer-empty",
      translateUi(t, formatPreviewMessage(message)),
    ));
  };

  const render = () => {
    renderStatus();
    if (!listNode) return;
    const layers = Array.isArray(preview.layers) ? preview.layers : [];
    if (layers.length === 0) {
      renderEmptyState();
      return;
    }
    listNode.replaceChildren(...layers.map((layer) => createLayerCard(layer, t)));
  };

  const load = async () => {
    preview = createEmptyThematicLayerCatalogPreview({ status: "loading" });
    render();
    try {
      preview = await loadCatalogPreview();
    } catch (error) {
      preview = createEmptyThematicLayerCatalogPreview({
        status: "error",
        error: normalizePreviewError(error),
      });
    }
    render();
    return preview;
  };

  return Object.freeze({
    getPreview: () => preview,
    load,
    render,
  });
}

export function createFacilitySurfaceOwner({
  helpers = {},
} = {}) {
  const {
    renderTooltipText,
    t,
  } = helpers;

  function normalizeFacilityDisplayValue(value) {
    if (value == null) return "";
    const normalized = String(value).trim();
    if (!normalized) return "";
    const lower = normalized.toLowerCase();
    if (["nan", "null", "none", "undefined"].includes(lower)) {
      return "";
    }
    return normalized;
  }

  function buildFacilityTooltipText(entry) {
    if (!entry) return "";
    const properties = entry.properties || {};
    const lines = [String(properties.name || "").trim()];
    if (entry.familyId === "airport") {
      const typeLabel = String(properties.airport_type_label || properties.airport_type || properties.category || "").trim();
      const code = String(properties.iata || properties.icao || "").trim();
      if (typeLabel || code) {
        lines.push([typeLabel, code].filter(Boolean).join(" · "));
      }
      const runwayLength = Number(properties.runway_length_m_max);
      const passengerCount = Number(properties.passengers_per_day_latest);
      const summaryBits = [];
      if (Number.isFinite(runwayLength) && runwayLength > 0) {
        summaryBits.push(`${t("Runway", "ui")}: ${Math.round(runwayLength).toLocaleString()}m`);
      }
      if (Number.isFinite(passengerCount) && passengerCount > 0) {
        summaryBits.push(`${t("Passengers/day", "ui")}: ${Math.round(passengerCount).toLocaleString()}`);
      }
      if (summaryBits.length) {
        lines.push(summaryBits.join(" · "));
      }
    } else if (entry.familyId === "port") {
      const designation = String(properties.legal_designation_label || properties.legal_designation || properties.category || "").trim();
      const portClass = String(properties.port_class || "").trim();
      if (designation || portClass) {
        lines.push([designation, portClass].filter(Boolean).join(" · "));
      }
      const mooringLength = Number(properties.mooring_facility_length_m);
      const ferryService = properties.ferry_service === true || String(properties.ferry_service || "").trim().toLowerCase() === "true";
      const summaryBits = [];
      if (ferryService) {
        summaryBits.push(t("Ferry service", "ui"));
      }
      if (Number.isFinite(mooringLength) && mooringLength > 0) {
        summaryBits.push(`${t("Mooring", "ui")}: ${Math.round(mooringLength).toLocaleString()}m`);
      }
      if (summaryBits.length) {
        lines.push(summaryBits.join(" · "));
      }
    }
    return renderTooltipText({ lines: lines.filter(Boolean) });
  }

  function buildFacilityInfoCardTitle(entry) {
    const familyLabel = entry?.familyId === "port" ? t("Port", "ui") : t("Airport", "ui");
    const name = String(entry?.properties?.name || "").trim() || t("Unnamed facility", "ui");
    return `${familyLabel} · ${name}`;
  }

  function buildFacilityInfoCardRows(entry, expanded = false) {
    if (!entry) {
      return { rows: [], hasExtraRows: false };
    }
    const properties = entry.properties || {};
    const defaultRows = [];
    const extraRows = [];
    const pushRow = (target, label, value) => {
      const normalizedValue = normalizeFacilityDisplayValue(value);
      if (!normalizedValue) return false;
      target.push({
        label: String(label || "").trim(),
        value: normalizedValue,
      });
      return true;
    };
    const appendFallbackRow = (target, rows) => {
      for (const [label, value] of rows) {
        if (pushRow(target, label, value)) return true;
      }
      return false;
    };
    pushRow(defaultRows, t("Tier", "ui"), String(properties.importance || "").replaceAll("_", " "));
    if (entry.familyId === "airport") {
      pushRow(defaultRows, t("Airport type", "ui"), properties.airport_type_label || properties.airport_type || properties.category);
      pushRow(defaultRows, "IATA / ICAO", [properties.iata, properties.icao].filter(Boolean).join(" / "));
      pushRow(defaultRows, t("Runway", "ui"), Number.isFinite(Number(properties.runway_length_m_max)) && Number(properties.runway_length_m_max) > 0
        ? `${Math.round(Number(properties.runway_length_m_max)).toLocaleString()}m`
        : "");
      const passengersPerDay = Number.isFinite(Number(properties.passengers_per_day_latest)) && Number(properties.passengers_per_day_latest) > 0
        ? Math.round(Number(properties.passengers_per_day_latest)).toLocaleString()
        : "";
      const landingsPerDay = Number.isFinite(Number(properties.landings_per_day_latest)) && Number(properties.landings_per_day_latest) > 0
        ? Math.round(Number(properties.landings_per_day_latest)).toLocaleString()
        : "";
      const statusText = String(properties.status || properties.status_category || "").trim();
      let usedAirportMetric = "";
      if (pushRow(defaultRows, t("Passengers/day", "ui"), passengersPerDay)) {
        usedAirportMetric = "passengers";
      } else if (pushRow(defaultRows, t("Landings/day", "ui"), landingsPerDay)) {
        usedAirportMetric = "landings";
      } else if (pushRow(defaultRows, t("Status", "ui"), statusText)) {
        usedAirportMetric = "status";
      }
      if (usedAirportMetric !== "landings") {
        pushRow(extraRows, t("Landings/day", "ui"), landingsPerDay);
      }
      if (usedAirportMetric !== "passengers") {
        pushRow(extraRows, t("Passengers/day", "ui"), passengersPerDay);
      }
      pushRow(extraRows, t("Hours", "ui"), [properties.operation_start, properties.operation_end].filter(Boolean).join(" - "));
      appendFallbackRow(extraRows, [
        [t("Owner / Manager", "ui"), [properties.owner, properties.manager].filter(Boolean).join(" / ")],
        [t("Owner", "ui"), properties.owner],
        [t("Manager", "ui"), properties.manager],
      ]);
    } else if (entry.familyId === "port") {
      pushRow(defaultRows, t("Designation", "ui"), properties.legal_designation_label || properties.legal_designation);
      pushRow(defaultRows, t("Class", "ui"), properties.port_class);
      const mooringText = Number.isFinite(Number(properties.mooring_facility_length_m)) && Number(properties.mooring_facility_length_m) > 0
        ? `${Math.round(Number(properties.mooring_facility_length_m)).toLocaleString()}m`
        : "";
      const outerFacilityText = Number.isFinite(Number(properties.outer_facility_length_m)) && Number(properties.outer_facility_length_m) > 0
        ? `${Math.round(Number(properties.outer_facility_length_m)).toLocaleString()}m`
        : "";
      const ferryText = properties.ferry_service === true ? t("Yes", "ui") : properties.ferry_service === false ? t("No", "ui") : "";
      const managerText = String(properties.manager || "").trim();
      let usedPortMetric = "";
      if (pushRow(defaultRows, t("Mooring", "ui"), mooringText)) {
        usedPortMetric = "mooring";
      } else if (pushRow(defaultRows, t("Outer facility", "ui"), outerFacilityText)) {
        usedPortMetric = "outer";
      }
      let usedPortIdentity = "";
      if (pushRow(defaultRows, t("Ferry", "ui"), ferryText)) {
        usedPortIdentity = "ferry";
      } else if (pushRow(defaultRows, t("Manager", "ui"), managerText)) {
        usedPortIdentity = "manager";
      }
      if (usedPortMetric !== "outer") {
        pushRow(extraRows, t("Outer facility", "ui"), outerFacilityText);
      }
      if (usedPortMetric !== "mooring") {
        pushRow(extraRows, t("Mooring", "ui"), mooringText);
      }
      if (usedPortIdentity !== "manager") {
        pushRow(extraRows, t("Manager", "ui"), managerText);
      }
      if (usedPortIdentity !== "ferry") {
        pushRow(extraRows, t("Ferry", "ui"), ferryText);
      }
      pushRow(extraRows, t("Established", "ui"), properties.date_established);
      appendFallbackRow(extraRows, [
        [t("Manager / Agencies", "ui"), [properties.manager, properties.agency_labels].filter(Boolean).join(" / ")],
        [t("Agencies", "ui"), properties.agency_labels],
      ]);
    }
    return {
      rows: [...defaultRows, ...(expanded ? extraRows : [])],
      hasExtraRows: extraRows.length > 0,
    };
  }

  function renderFacilityInfoCardRows(container, rows = []) {
    if (!(container instanceof HTMLElement)) {
      return;
    }
    container.replaceChildren();
    if (!rows.length) {
      const emptyNode = document.createElement("div");
      emptyNode.className = "facility-info-card-empty";
      emptyNode.textContent = t("No facility details available yet.", "ui");
      container.appendChild(emptyNode);
      return;
    }
    rows.forEach((row) => {
      const rowNode = document.createElement("div");
      rowNode.className = "facility-info-card-row";
      const labelNode = document.createElement("span");
      labelNode.className = "facility-info-card-label";
      labelNode.textContent = String(row?.label || "");
      const valueNode = document.createElement("span");
      valueNode.className = "facility-info-card-value";
      valueNode.textContent = String(row?.value || "");
      rowNode.append(labelNode, valueNode);
      container.appendChild(rowNode);
    });
  }

  function applyFacilityInfoCardState(entry, {
    anchor = null,
    expanded = false,
    previousAnchor = null,
    dom = {},
    entryKey = "",
  } = {}) {
    const {
      facilityInfoCard = null,
      facilityInfoCardBody = null,
      facilityInfoCardMoreBtn = null,
      facilityInfoCardTitle = null,
      facilityInfoCardZoomBtn = null,
    } = dom;
    if (!facilityInfoCard || !facilityInfoCardTitle || !facilityInfoCardBody || !facilityInfoCardZoomBtn || !facilityInfoCardMoreBtn) {
      return { anchor: previousAnchor, visible: false, hasExtraRows: false };
    }
    if (!entry) {
      facilityInfoCard.classList.add("hidden");
      facilityInfoCard.setAttribute("aria-hidden", "true");
      facilityInfoCardTitle.textContent = "";
      renderFacilityInfoCardRows(facilityInfoCardBody, []);
      facilityInfoCardZoomBtn.disabled = true;
      facilityInfoCardZoomBtn.dataset.familyKey = "";
      facilityInfoCardMoreBtn.classList.add("hidden");
      facilityInfoCardMoreBtn.textContent = t("More fields", "ui");
      return { anchor: null, visible: false, hasExtraRows: false };
    }
    const nextAnchor = anchor && Number.isFinite(Number(anchor?.x)) && Number.isFinite(Number(anchor?.y))
      ? { x: Number(anchor.x), y: Number(anchor.y) }
      : (previousAnchor || { x: 24, y: 24 });
    facilityInfoCardTitle.textContent = buildFacilityInfoCardTitle(entry);
    const model = buildFacilityInfoCardRows(entry, expanded);
    renderFacilityInfoCardRows(facilityInfoCardBody, model.rows);
    facilityInfoCardZoomBtn.disabled = false;
    facilityInfoCardZoomBtn.dataset.familyKey = String(entryKey || "");
    facilityInfoCardMoreBtn.classList.toggle("hidden", !model.hasExtraRows);
    facilityInfoCardMoreBtn.textContent = t(expanded ? "Less fields" : "More fields", "ui");
    facilityInfoCard.classList.remove("hidden");
    facilityInfoCard.setAttribute("aria-hidden", "false");
    const viewportWidth = Math.max(320, Number(globalThis.innerWidth || 0));
    const viewportHeight = Math.max(280, Number(globalThis.innerHeight || 0));
    const cardWidth = 340;
    const cardHeight = 260;
    const anchorX = Number(nextAnchor?.x || 0);
    const anchorY = Number(nextAnchor?.y || 0);
    const left = Math.max(16, Math.min(viewportWidth - cardWidth - 16, anchorX + 18));
    const top = Math.max(16, Math.min(viewportHeight - cardHeight - 16, anchorY + 18));
    facilityInfoCard.style.left = `${Math.round(left)}px`;
    facilityInfoCard.style.top = `${Math.round(top)}px`;
    return { anchor: nextAnchor, visible: true, hasExtraRows: model.hasExtraRows };
  }

  return {
    applyFacilityInfoCardState,
    buildFacilityInfoCardFieldSections: buildFacilityInfoCardRows,
    buildFacilityInfoCardTitle,
    buildFacilityTooltipText,
  };
}

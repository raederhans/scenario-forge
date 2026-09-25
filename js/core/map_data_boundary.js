import { getCountryCode, getFeatureId } from "./feature_identity.js";
import { normalizeCountryCodeAlias } from "./country_code_aliases.js";

// P2 boundary, not a second store. Reference queries expose only detached scalar
// metadata and immutable membership arrays. Paint reads borrow the existing
// compact base-palette + per-feature edit storage through one resolution API.
// Neither side derives a country identity from RGB values.
const boundaries = new WeakMap();
const referenceIndexes = new WeakMap();
const EMPTY_RECORD = Object.freeze({});
const EMPTY_IDS = Object.freeze([]);
const text = (value) => String(value ?? "").trim();
const record = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : EMPTY_RECORD;
const ownValue = (values, key) => Object.hasOwn(record(values), key) ? values[key] : undefined;
const normalizeCode = (value) => normalizeCountryCodeAlias(text(value));
const defaultSafeColor = (value, fallback = "") => /^#[0-9a-f]{6}$/i.test(text(value)) ? text(value).toLowerCase() : fallback;

export function createReadonlyReferenceAssignments(assignments) {
  // Copy before freezing: scenario loaders and their bundle caches keep their
  // own payload identity; the published baseline cannot be edited in place.
  return Object.freeze({ ...record(assignments) });
}

function getReferenceIndex(assignments) {
  const source = record(assignments);
  // Only immutable snapshots are cached. Mutable test/transition inputs are
  // recomputed, so a caller can never observe a stale membership index.
  if (Object.isFrozen(source) && referenceIndexes.has(source)) return referenceIndexes.get(source);
  const groups = new Map();
  const ids = [];
  for (const [id, rawCode] of Object.entries(source)) {
    if (!text(id)) continue;
    ids.push(id);
    const code = normalizeCode(rawCode);
    if (!code) continue;
    if (!groups.has(code)) groups.set(code, []);
    groups.get(code).push(id);
  }
  for (const [code, members] of groups) groups.set(code, Object.freeze(members));
  const index = { ids: Object.freeze(ids), groups };
  if (Object.isFrozen(source)) referenceIndexes.set(source, index);
  return index;
}

export function getMapDataBoundary(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new TypeError("Map data boundary requires a state object");
  }
  if (boundaries.has(source)) return boundaries.get(source);

  const getScenarioAssignments = () => text(source.activeScenarioId)
    ? record(source.scenarioBaselineOwnersByFeatureId)
    : EMPTY_RECORD;
  const getScenarioGroupCode = (featureId) => normalizeCode(ownValue(getScenarioAssignments(), text(featureId)));
  const reference = Object.freeze({
    getFeatureOrigin(featureOrId) {
      const id = getFeatureId(featureOrId, { fallback: "" });
      const feature = typeof featureOrId === "string" ? source.landIndex?.get(id) : featureOrId;
      return Object.freeze({
        featureId: id,
        geographicCountryCode: getCountryCode(feature, { useIdFallback: false })
          || normalizeCode(ownValue(source.runtimeCanonicalCountryByFeatureId, id)),
        scenarioId: text(source.activeScenarioId),
        scenarioGroupCode: getScenarioGroupCode(id),
      });
    },
    getScenarioGroupCode,
    hasScenarioFeature(featureId) {
      return Object.hasOwn(getScenarioAssignments(), text(featureId));
    },
    getScenarioAssignments() {
      const assignments = getScenarioAssignments();
      return Object.isFrozen(assignments) ? assignments : createReadonlyReferenceAssignments(assignments);
    },
    getBaseGroupCode(featureOrId) {
      const id = getFeatureId(featureOrId, { fallback: "" });
      const feature = typeof featureOrId === "string" ? source.landIndex?.get(id) : featureOrId;
      const props = feature?.properties || {};
      if (text(props.detail_tier).toLowerCase() === "antarctic_sector") return "";
      const direct = getScenarioGroupCode(id);
      const shell = id.toUpperCase().includes("_FB_")
        || text(props.name).toLowerCase().includes("shell fallback");
      const shellCode = normalizeCode(ownValue(source.scenarioAutoShellOwnerByFeatureId, id)
        || props.scenario_shell_owner_hint || props.scenario_shell_controller_hint);
      if (text(source.mapSemanticMode) === "blank") return shell ? direct || shellCode : direct;
      if (shell) return direct || shellCode;
      return direct || normalizeCode(getCountryCode(feature, { useIdFallback: false }))
        || normalizeCode(ownValue(source.runtimeCanonicalCountryByFeatureId, id));
    },
    getScenarioFeatureIds() {
      // Complete scenario membership, independent of the hydrated land index.
      return getReferenceIndex(getScenarioAssignments()).ids;
    },
    getScenarioGroupFeatureIds(groupCode) {
      return getReferenceIndex(getScenarioAssignments()).groups.get(normalizeCode(groupCode)) || EMPTY_IDS;
    },
    getGeographicCountryFeatureIds(countryCode) {
      const members = source.countryToFeatureIds?.get?.(normalizeCode(countryCode));
      return Array.isArray(members) || members instanceof Set ? Object.freeze([...members]) : EMPTY_IDS;
    },
  });

  const paint = Object.freeze({
    resolveFeatureColor(featureId, { getSafeColor = defaultSafeColor, getBaseGroupCode = null } = {}) {
      const id = text(featureId);
      const safe = typeof getSafeColor === "function" ? getSafeColor : defaultSafeColor;
      for (const field of ["visualOverrides", "featureOverrides"]) {
        const color = safe(ownValue(source[field], id), "");
        if (color) return { color, source: field, featureId: id, groupCode: "" };
      }
      // Persistent base paint uses read-only reference membership, never a
      // mutable ownership mirror or a display overlay. Adapters remain explicit.
      const groupCode = typeof getBaseGroupCode === "function"
        ? normalizeCode(getBaseGroupCode(id))
        : reference.getBaseGroupCode(id);
      if (groupCode) {
        for (const field of ["sovereignBaseColors", "countryBaseColors"]) {
          const color = safe(ownValue(source[field], groupCode), "");
          if (color) return { color, source: field, featureId: id, groupCode };
        }
      }
      return { color: null, source: "", featureId: id, groupCode };
    },
  });

  const boundary = Object.freeze({ reference, paint });
  boundaries.set(source, boundary);
  return boundary;
}

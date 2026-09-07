import {
  SCENARIO_RENDER_PROFILES,
} from "./pure_helpers.js";

function normalizeScenarioPerformanceHints(manifest) {
  const hints = manifest?.performance_hints;
  const raw = hints && typeof hints === "object" ? hints : {};
  const renderProfileDefault = String(raw.render_profile_default || "").trim().toLowerCase();
  return {
    renderProfileDefault: SCENARIO_RENDER_PROFILES.has(renderProfileDefault) ? renderProfileDefault : "",
    dynamicBordersDefault:
      typeof raw.dynamic_borders_default === "boolean" ? raw.dynamic_borders_default : null,
    parentBordersDefault:
      typeof raw.parent_borders_default === "boolean" ? raw.parent_borders_default : null,
    scenarioReliefOverlaysDefault:
      typeof raw.scenario_relief_overlays_default === "boolean" ? raw.scenario_relief_overlays_default : null,
    scenarioAtlantropaDefault:
      typeof raw.scenario_atlantropa_default === "boolean" ? raw.scenario_atlantropa_default : null,
    waterRegionsDefault:
      typeof raw.water_regions_default === "boolean" ? raw.water_regions_default : null,
    specialRegionsDefault:
      typeof raw.special_regions_default === "boolean" ? raw.special_regions_default : null,
  };
}

const SCENARIO_PRESENTATION_FEATURES = Object.freeze({
  ATLANTROPA_RELIEF: "atlantropa_relief",
  COASTAL_ACCENT: "coastal_accent",
});

function getScenarioPresentationFeatures(manifest) {
  const raw = manifest?.presentation_features;
  return raw && typeof raw === "object" ? raw : {};
}

function scenarioHasPresentationFeature(manifest, featureKey) {
  const normalizedKey = String(featureKey || "").trim();
  if (!normalizedKey) return false;
  return getScenarioPresentationFeatures(manifest)?.[normalizedKey] === true;
}

export {
  SCENARIO_PRESENTATION_FEATURES,
  normalizeScenarioPerformanceHints,
  scenarioHasPresentationFeature,
};

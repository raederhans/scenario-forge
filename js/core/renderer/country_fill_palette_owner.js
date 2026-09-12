// Country fill statistics are separate from border geometry and stroke rendering.
export function createCountryFillPaletteOwner({
  state,
  getFeatures,
  getFeatureId,
  resolveCountryCode,
  isExcluded,
  resolveColor,
}) {
  let identity = null;
  let colorRevision = -1;
  let appearanceRevision = 0;
  let dominantColors = new Map();
  let recordsById = new Map();
  let recordsByCountry = new Map();

  function readIdentity(features) {
    return [
      features, features.length, state.activeScenarioId, state.sceneGeneration,
      state.scenarioDataGeneration, state.topologyRevision, state.sovereigntyRevision,
      state.scenarioShellOverlayRevision, state.mapSemanticMode, state.showScenarioAtlantropa,
    ];
  }

  function identityMatches(next) {
    return identity && next.every((value, index) => value === identity[index]);
  }

  function readRecord(feature, index) {
    const id = getFeatureId(feature) || `feature-${index}`;
    const country = resolveCountryCode(feature);
    return {
      feature, index, id, country,
      color: country && !isExcluded(feature, id) ? resolveColor(feature, id) : null,
    };
  }

  function addToCountry(record) {
    if (!record.country) return;
    if (!recordsByCountry.has(record.country)) recordsByCountry.set(record.country, new Set());
    recordsByCountry.get(record.country).add(record);
  }

  function resolveDominant(country) {
    const counts = new Map();
    for (const record of recordsByCountry.get(country) || []) {
      if (!record.color) continue;
      const entry = counts.get(record.color) || { count: 0, firstIndex: record.index };
      entry.count += 1;
      entry.firstIndex = Math.min(entry.firstIndex, record.index);
      counts.set(record.color, entry);
    }
    let bestColor = null;
    let bestCount = -1;
    let bestIndex = Infinity;
    for (const [color, entry] of counts) {
      if (entry.count > bestCount || (entry.count === bestCount && entry.firstIndex < bestIndex)) {
        bestColor = color;
        bestCount = entry.count;
        bestIndex = entry.firstIndex;
      }
    }
    return bestColor;
  }

  function rebuild(features, nextIdentity) {
    recordsById = new Map();
    recordsByCountry = new Map();
    features.forEach((feature, index) => {
      const record = readRecord(feature, index);
      if (!recordsById.has(record.id)) recordsById.set(record.id, []);
      recordsById.get(record.id).push(record);
      addToCountry(record);
    });
    const next = new Map();
    for (const country of recordsByCountry.keys()) {
      const color = resolveDominant(country);
      if (color) next.set(country, color);
    }
    if (next.size !== dominantColors.size
      || ![...next].every(([country, color]) => dominantColors.get(country) === color)) {
      dominantColors = next;
      appearanceRevision += 1;
    }
    identity = nextIdentity;
    colorRevision = Number(state.colorRevision || 0);
  }

  function getDominantFillColorMap() {
    const features = getFeatures() || [];
    const nextIdentity = readIdentity(features);
    if (!identityMatches(nextIdentity) || colorRevision !== Number(state.colorRevision || 0)) {
      rebuild(features, nextIdentity);
    }
    return dominantColors;
  }

  // Call after the host has updated all listed colors and bumped colorRevision.
  // A skipped revision means some changed IDs are unknown, so rebuild safely.
  function notifyColorsChanged(featureIds = []) {
    const features = getFeatures() || [];
    const nextIdentity = readIdentity(features);
    const nextRevision = Number(state.colorRevision || 0);
    if (!identityMatches(nextIdentity) || nextRevision < colorRevision || nextRevision > colorRevision + 1) {
      rebuild(features, nextIdentity);
      return;
    }
    const affectedCountries = new Set();
    for (const id of new Set(featureIds)) {
      for (const record of recordsById.get(id) || []) {
        affectedCountries.add(record.country);
        recordsByCountry.get(record.country)?.delete(record);
        Object.assign(record, readRecord(record.feature, record.index));
        affectedCountries.add(record.country);
        addToCountry(record);
      }
    }
    if (!affectedCountries.size && nextRevision !== colorRevision) {
      rebuild(features, nextIdentity);
      return;
    }
    let changed = false;
    for (const country of affectedCountries) {
      if (!country) continue;
      const color = resolveDominant(country);
      if (color) {
        if (dominantColors.get(country) !== color) {
          dominantColors.set(country, color);
          changed = true;
        }
      } else if (dominantColors.delete(country)) changed = true;
    }
    if (changed) appearanceRevision += 1;
    colorRevision = nextRevision;
  }

  function getAppearanceRevision() {
    getDominantFillColorMap();
    return appearanceRevision;
  }

  function invalidate() { identity = null; }

  return Object.freeze({ getDominantFillColorMap, notifyColorsChanged, getAppearanceRevision, invalidate });
}

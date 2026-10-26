const normalizeColor = value => String(value || '').trim().toLowerCase();

// Painted color is the border identity: a feature painted in a scenario
// country's exact base color joins that country. ISO aliases that share their
// country's color are not candidates when the scenario country set is known.
export function createBorderIdentityResolver({ sovereignBaseColors, getReferenceOwner, getOverrideColor,
  getCountryTags = () => null,
  getRevision = () => 0,
}) {
  let source, tagsSource, revision, byColor;
  return function resolveBorderKey(featureId, feature) {
    const reference = getReferenceOwner(featureId, feature);
    const override = getOverrideColor(featureId, feature);
    if (!override) return reference;
    const colors = typeof sovereignBaseColors === 'function' ? sovereignBaseColors() : sovereignBaseColors;
    const tags = getCountryTags();
    const nextRevision = getRevision();
    if (source !== colors || tagsSource !== tags || revision !== nextRevision || !byColor) {
      source = colors; tagsSource = tags; revision = nextRevision; byColor = new Map();
      for (const tag of Object.keys(colors || {}).sort()) {
        if (tags && !tags.has(tag)) continue;
        const color = normalizeColor(colors[tag]);
        if (!byColor.has(color)) byColor.set(color, []);
        byColor.get(color).push(tag);
      }
    }
    const color = normalizeColor(override);
    const candidates = byColor.get(color);
    return candidates?.includes(reference) ? reference : candidates?.[0] || `color:${color}`;
  };
}

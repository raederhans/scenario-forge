const COUNTRY_CODE_ALIASES = Object.freeze({
  UK: "GB",
  EL: "GR",
});

// Each step runs once, in order, for projects saved before its version.
const TNO_TAG_MIGRATIONS = Object.freeze([
  { version: 1, tags: Object.freeze({
    MAG: "MGN", RSF: "MAG", GUI: "GUZ", BRM: "BUR", FRI: "AZH",
    SIC: "XIK", SIK: "XIN", HOL: "SUR", GSW: "ANG", PRC: "CHI", TAN: "PRC",
  }), supersededBy: Object.freeze({ ANG: "GSW", PRC: "CHI" }) },
  { version: 2, tags: Object.freeze({ BZ: "BLZ", GY: "GUY" }), supersededBy: Object.freeze({}) },
]);
const TNO_TAG_MIGRATION_VERSION = TNO_TAG_MIGRATIONS.at(-1).version;

function migrateTnoProjectTags(project) {
  const savedVersion = Number(project.scenario?.tagMigrationVersion || 0);
  if (project.scenario?.id !== "tno_1962" || savedVersion >= TNO_TAG_MIGRATION_VERSION) {
    return project;
  }
  let result = { ...project, scenario: {
    ...project.scenario, tagMigrationVersion: TNO_TAG_MIGRATION_VERSION,
  } };
  for (const { version, tags, supersededBy } of TNO_TAG_MIGRATIONS) {
    if (savedVersion >= version) continue;
    const migrateTag = tag => tags[tag] || tag;
    const step = { ...result };
    for (const field of ["sovereignBaseColors", "countryBaseColors", "customPresets",
      "parentBorderEnabledByCountry", "releasableBoundaryVariantByTag"]) {
      if (!result[field]) continue;
      // A tag whose legacy source is also present yields to the migrated legacy value.
      step[field] = Object.fromEntries(Object.entries(result[field])
        .filter(([tag]) => !supersededBy[tag] || !Object.hasOwn(result[field], supersededBy[tag]))
        .map(([tag, value]) => [migrateTag(tag), value]));
    }
    if (result.activeSovereignCode) step.activeSovereignCode = migrateTag(result.activeSovereignCode);
    result = step;
  }
  return result;
}

function normalizeCountryCodeAlias(rawCode) {
  // Render/index loops mostly pass canonical codes. Skip repeated trimming,
  // case conversion and replacement for that common case.
  if (typeof rawCode === "string" && !/[^A-Z0-9]/.test(rawCode)) {
    return COUNTRY_CODE_ALIASES[rawCode] || rawCode;
  }
  const code = String(rawCode || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!code) return "";
  return COUNTRY_CODE_ALIASES[code] || code;
}

export {
  COUNTRY_CODE_ALIASES,
  TNO_TAG_MIGRATION_VERSION,
  migrateTnoProjectTags,
  normalizeCountryCodeAlias,
};

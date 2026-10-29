const COUNTRY_CODE_ALIASES = Object.freeze({
  UK: "GB",
  EL: "GR",
});

const TNO_TAG_MIGRATION_VERSION = 1;
const TNO_LEGACY_TAGS = Object.freeze({
  MAG: "MGN", RSF: "MAG", GUI: "GUZ", BRM: "BUR", FRI: "AZH",
  SIC: "XIK", SIK: "XIN", HOL: "SUR", GSW: "ANG", PRC: "CHI", TAN: "PRC",
});

function migrateTnoProjectTags(project) {
  if (project.scenario?.id !== "tno_1962"
      || Number(project.scenario.tagMigrationVersion || 0) >= TNO_TAG_MIGRATION_VERSION) {
    return project;
  }
  const migrateTag = tag => TNO_LEGACY_TAGS[tag] || tag;
  const result = { ...project, scenario: {
    ...project.scenario, tagMigrationVersion: TNO_TAG_MIGRATION_VERSION,
  } };
  for (const field of ["sovereignBaseColors", "countryBaseColors", "customPresets",
    "parentBorderEnabledByCountry", "releasableBoundaryVariantByTag"]) {
    if (!project[field]) continue;
    result[field] = Object.fromEntries(Object.entries(project[field])
      .filter(([tag]) => tag !== "ANG" || !Object.hasOwn(project[field], "GSW"))
      .filter(([tag]) => tag !== "PRC" || !Object.hasOwn(project[field], "CHI"))
      .map(([tag, value]) => [migrateTag(tag), value]));
  }
  if (project.activeSovereignCode) result.activeSovereignCode = migrateTag(project.activeSovereignCode);
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

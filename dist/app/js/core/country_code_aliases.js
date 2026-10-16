const COUNTRY_CODE_ALIASES = Object.freeze({
  UK: "GB",
  EL: "GR",
});

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
  normalizeCountryCodeAlias,
};

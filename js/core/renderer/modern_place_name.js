const normalizePlaceName = (name) => String(name || "").normalize("NFD").replace(/\p{M}/gu, "")
  .replace(/[\s\-'’.]+/g, "").trim().toLowerCase();

// 英文名去掉变音符与空格连字符后仍不同，才视为改名（Breslau/Wrocław 是，Kiev/Kyiv 是，Turin/Torino 由数据决定）。
export function isRenamedPlace(historicalEnglishName, modernEnglishName) {
  const historical = normalizePlaceName(historicalEnglishName);
  const modern = normalizePlaceName(modernEnglishName);
  return !!historical && !!modern && historical !== modern;
}

export function formatModernPlaceName(historicalName, modernName, language) {
  if (!modernName || historicalName === modernName) return historicalName;
  return language === "zh"
    ? `${historicalName}（今${modernName}）`
    : `${historicalName} (${modernName})`;
}

export function formatCityVictoryPoints(value, victoryPointName, cityName, language) {
  if (!(value > 0)) return "";
  const normalize = (name) => String(name || "").normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
  const name = victoryPointName && normalize(victoryPointName) !== normalize(cityName)
    ? (language === "zh" ? `（${victoryPointName}）` : ` (${victoryPointName})`)
    : "";
  return `${language === "zh" ? "胜利点：" : "Victory points: "}${value}${name}`;
}

// 检查器用：列出选中地块里被剧本改了名的城市（时代名 → 今名），按人口从大到小。
export function listRenamedPlacesInFeatures(cityFeatures, featureIds, language, { limit = 8 } = {}) {
  const hostIds = new Set((Array.isArray(featureIds) ? featureIds : [featureIds])
    .map((id) => String(id || "").trim()).filter(Boolean));
  if (!hostIds.size || !Array.isArray(cityFeatures)) return { entries: [], total: 0 };
  const lang = language === "zh" ? "zh" : "en";
  const seen = new Set();
  const matches = [];
  for (const feature of cityFeatures) {
    const props = feature?.properties || {};
    if (props.__city_hidden || !hostIds.has(String(props.__city_host_feature_id || "").trim())) continue;
    const era = props.__city_display_name_override;
    const modern = props.__city_base_display_name;
    if (!era || !modern || !isRenamedPlace(era.en, modern.en)) continue;
    const eraName = String(era[lang] || era.en || "").trim();
    const modernName = String(modern[lang] || modern.en || "").trim();
    if (!eraName || !modernName || eraName === modernName || seen.has(eraName)) continue;
    seen.add(eraName);
    matches.push({ eraName, modernName, population: Number(props.__city_population) || 0 });
  }
  matches.sort((a, b) => b.population - a.population || a.eraName.localeCompare(b.eraName));
  return {
    entries: matches.slice(0, Math.max(0, limit)).map(({ eraName, modernName }) => ({ eraName, modernName })),
    total: matches.length,
  };
}

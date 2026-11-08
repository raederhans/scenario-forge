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

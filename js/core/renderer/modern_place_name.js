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

// 数据基址：运行时把仓库相对的 data/ URL 在发请求前统一经这里解析。
// 基址默认为空（同源相对路径，行为不变）；页面可用 <meta name="scenario-forge-data-base" content="https://…/"> 指向外部 CDN/对象存储。
let dataBaseUrl;

export function normalizeDataBaseUrl(value) {
  const normalized = String(value ?? "").trim();
  if (!/^https?:\/\//i.test(normalized)) return "";
  try { new URL(normalized); } catch { return ""; }
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

export function getDataBaseUrl() {
  if (dataBaseUrl === undefined) {
    dataBaseUrl = normalizeDataBaseUrl(
      globalThis.document?.querySelector?.('meta[name="scenario-forge-data-base"]')?.content
    );
  }
  return dataBaseUrl;
}

export function configureDataBaseUrl(value) {
  dataBaseUrl = normalizeDataBaseUrl(value);
  return dataBaseUrl;
}

export function resolveDataUrl(url, base = getDataBaseUrl()) {
  if (!base || typeof url !== "string") return url;
  if (url.startsWith("data/")) return base + url;
  if (url.startsWith("./data/")) return base + url.slice(2);
  return url;
}

export function isExternalDataUrl(resolvedUrl, original) {
  return resolvedUrl !== original;
}

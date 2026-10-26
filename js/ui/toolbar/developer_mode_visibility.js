// 判定开发者模式开关（#developerModeBtn）是否对当前访问者可见。
// 普通用户默认看不到 Dev 入口；本地开发主机、显式 ?dev=1、或曾经切换过开发者模式的浏览器才显示。

const LOCAL_DEVELOPMENT_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function shouldShowDeveloperModeEntry({ hostname = "", search = "", storedDeveloperMode = null } = {}) {
  const normalizedHost = String(hostname || "").trim().toLowerCase();
  if (LOCAL_DEVELOPMENT_HOSTNAMES.has(normalizedHost)) return true;
  try {
    const params = new URLSearchParams(String(search || ""));
    if (params.get("dev") === "1") return true;
  } catch {}
  return storedDeveloperMode === "true" || storedDeveloperMode === "false";
}

// 判定开发者模式开关（#developerModeBtn）及其快捷键帮助是否对当前访问者可见。
// 普通用户默认看不到 Dev 入口；本地开发主机、显式 ?dev=1、曾经切换过开发者模式的浏览器，
// 或本次会话已用快捷键开启（存储被阻止时只存在于内存）才显示。
import { state } from "../../core/state.js";

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

export const DEVELOPER_MODE_STORAGE_KEY = "map_creator_developer_mode";

export function readStoredDeveloperMode() {
  try {
    return globalThis.localStorage?.getItem(DEVELOPER_MODE_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export const isDeveloperModeEntryVisible = () => !!state.ui?.developerMode || shouldShowDeveloperModeEntry({
  hostname: globalThis.location?.hostname,
  search: globalThis.location?.search,
  storedDeveloperMode: readStoredDeveloperMode(),
});

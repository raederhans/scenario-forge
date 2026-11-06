// 变更层：状态写完之后的唯一通知入口。
//
// 调用方在一次编辑写完状态后调用 commitChange({ domains, ... })，声明"什么变了"。
// - 同步订阅者（subscribeChanges）立即收到这次变更，只用于渲染失效这类轻量标记。
// - 面板按 panel_subscriptions.js 的表合并刷新：同一帧里的多次变更取并集，
//   每个面板钩子最多跑一次，并且在下一次绘制之后才跑，地图像素先上屏。
// 没有帧调度的环境（Node 测试、worker）立即刷新，保持同步语义。
import { scheduleAfterPaint } from "../after_paint.js";
import { emit } from "./bus.js";
import { STATE_BUS_EVENTS } from "./config.js";
import { PANEL_HOOKS_BY_CHANGE_DOMAIN } from "./panel_subscriptions.js";

const syncSubscribers = new Set();
let pendingDomains = new Set();
let flushScheduled = false;

function normalizeDomains(domains) {
  const list = Array.isArray(domains) ? domains : [domains];
  return list.map((domain) => String(domain || "").trim()).filter(Boolean);
}

function reportListenerError(error) {
  // 一个面板出错不拦住其余面板，但错误仍要作为未捕获异常上报。
  if (typeof globalThis.reportError === "function") globalThis.reportError(error);
  else globalThis.setTimeout(() => { throw error; }, 0);
}

function collectPanelHooks(domains) {
  const hooks = new Set();
  // 按表的顺序刷新，和以前手写清单的顺序一致（工具栏在列表之前）。
  for (const [domain, hookNames] of Object.entries(PANEL_HOOKS_BY_CHANGE_DOMAIN)) {
    if (domains.has(domain)) hookNames.forEach((hookName) => hooks.add(hookName));
  }
  return hooks;
}

function flushPanels() {
  flushScheduled = false;
  const domains = pendingDomains;
  pendingDomains = new Set();
  collectPanelHooks(domains).forEach((hookName) => {
    try {
      emit(STATE_BUS_EVENTS[hookName]);
    } catch (error) {
      reportListenerError(error);
    }
  });
}

function schedulePanelFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  scheduleAfterPaint(flushPanels);
}

export function commitChange({ domains, ...details } = {}) {
  const normalized = normalizeDomains(domains);
  if (!normalized.length) return;
  const unknown = normalized.filter((domain) => !Object.hasOwn(PANEL_HOOKS_BY_CHANGE_DOMAIN, domain));
  if (unknown.length) throw new TypeError(`Unknown change domain: ${unknown.join(", ")}`);
  const change = { domains: normalized, ...details };
  syncSubscribers.forEach((subscriber) => {
    try {
      subscriber(change);
    } catch (error) {
      reportListenerError(error);
    }
  });
  normalized.forEach((domain) => pendingDomains.add(domain));
  schedulePanelFlush();
}

export function subscribeChanges(subscriber) {
  if (typeof subscriber !== "function") throw new TypeError("Change subscriber must be a function.");
  syncSubscribers.add(subscriber);
  return () => syncSubscribers.delete(subscriber);
}

// 有待刷新的面板时，界面还没到稳定状态。
export function hasPendingPanelRefresh() {
  return pendingDomains.size > 0;
}

// 需要界面立即一致的场景（例如测试里的显式刷新）直接刷新。
export function flushPanelRefreshNow() {
  if (pendingDomains.size) flushPanels();
}

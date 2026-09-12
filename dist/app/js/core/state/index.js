import { emit, off, on, once } from "./bus.js";
import {
  STATE_BUS_EVENTS,
  STATE_HANDLER_HOOK_NAMES,
  STATE_INTERNAL_HANDLER_HOOK_NAMES,
  STATE_NOTIFICATION_HOOK_NAMES,
} from "./config.js";

export * from "./config.js";
export * from "./bus.js";
export * from "../state_defaults.js";
export * from "../state_catalog.js";
export * from "./boot_state.js";
export * from "./content_state.js";
export * from "./color_state.js";
export * from "./ui_state.js";

const notificationHookNames = new Set(STATE_NOTIFICATION_HOOK_NAMES);
const handlerHookNames = new Set([
  ...STATE_HANDLER_HOOK_NAMES,
  ...STATE_INTERNAL_HANDLER_HOOK_NAMES,
]);
const notificationListenersByHookName = new Map();
const notificationDispatchersByHookName = new Map();
const handlerFnsByHookName = new Map();
const handlerDispatchersByHookName = new Map();
const compatTargets = new WeakSet();

// Runtime hook 分为通知型 bus 和有返回值的 handler；两类共享注册入口，但分发语义分开维护。
function normalizeRuntimeHook(hook) {
  return typeof hook === "function" ? hook : null;
}

// bus payload 只能带一个值，因此多参数 hook 统一包成显式 envelope，再在 listener 侧还原。
function packRuntimeHookArgs(args) {
  if (!Array.isArray(args) || !args.length) {
    return undefined;
  }
  if (args.length === 1) {
    return args[0];
  }
  return { __runtimeHookArgs: args };
}

function unpackRuntimeHookArgs(payload) {
  if (
    payload
    && typeof payload === "object"
    && Array.isArray(payload.__runtimeHookArgs)
  ) {
    return payload.__runtimeHookArgs;
  }
  if (payload === undefined) {
    return [];
  }
  return [payload];
}

function getNotificationDispatcher(hookName) {
  if (!notificationDispatchersByHookName.has(hookName)) {
    notificationDispatchersByHookName.set(hookName, (...args) => emitRuntimeHookBusEvent(null, hookName, ...args));
  }
  return notificationDispatchersByHookName.get(hookName);
}

function getHandlerDispatcher(hookName) {
  if (!handlerDispatchersByHookName.has(hookName)) {
    handlerDispatchersByHookName.set(hookName, (...args) => callRuntimeHook(null, hookName, ...args));
  }
  return handlerDispatchersByHookName.get(hookName);
}

export function isRuntimeHookBusEventName(hookName) {
  return notificationHookNames.has(String(hookName || "").trim());
}

export function isRuntimeHookHandlerName(hookName) {
  return handlerHookNames.has(String(hookName || "").trim());
}

export function readRuntimeHookBusDispatcher(_target, hookName) {
  if (!isRuntimeHookBusEventName(hookName)) {
    return null;
  }
  return notificationListenersByHookName.has(hookName)
    ? getNotificationDispatcher(hookName)
    : null;
}

export function registerRuntimeHookBusListener(target, hookName, listener) {
  const normalizedHookName = String(hookName || "").trim();
  if (!isRuntimeHookBusEventName(normalizedHookName)) {
    return null;
  }
  bindStateCompatSurface(target);
  const eventName = STATE_BUS_EVENTS[normalizedHookName];
  const previousListener = notificationListenersByHookName.get(normalizedHookName);
  if (previousListener) {
    off(eventName, previousListener);
    notificationListenersByHookName.delete(normalizedHookName);
  }
  const normalizedListener = normalizeRuntimeHook(listener);
  if (!normalizedListener) {
    return null;
  }
  const wrappedListener = (payload) => normalizedListener(...unpackRuntimeHookArgs(payload));
  notificationListenersByHookName.set(normalizedHookName, wrappedListener);
  on(eventName, wrappedListener);
  return wrappedListener;
}

export function emitRuntimeHookBusEvent(_target, hookName, ...args) {
  const normalizedHookName = String(hookName || "").trim();
  if (!isRuntimeHookBusEventName(normalizedHookName)) {
    return [];
  }
  return emit(STATE_BUS_EVENTS[normalizedHookName], packRuntimeHookArgs(args));
}

export function emitStateBusEvent(eventName, payload) {
  const normalizedEventName = String(eventName || "").trim();
  if (!normalizedEventName) {
    return [];
  }
  return emit(normalizedEventName, payload);
}

export function subscribeStateBusEvent(eventName, listener) {
  return on(String(eventName || "").trim(), listener);
}

export function readRuntimeHook(target, hookName) {
  const normalizedHookName = String(hookName || "").trim();
  if (!normalizedHookName) {
    return null;
  }
  bindStateCompatSurface(target);
  if (isRuntimeHookBusEventName(normalizedHookName)) {
    return readRuntimeHookBusDispatcher(target, normalizedHookName);
  }
  if (isRuntimeHookHandlerName(normalizedHookName) && handlerFnsByHookName.has(normalizedHookName)) {
    return getHandlerDispatcher(normalizedHookName);
  }
  return null;
}

export function readRegisteredRuntimeHookSource(target, hookName) {
  const normalizedHookName = String(hookName || "").trim();
  if (!normalizedHookName) {
    return null;
  }
  bindStateCompatSurface(target);
  if (isRuntimeHookBusEventName(normalizedHookName)) {
    return notificationListenersByHookName.get(normalizedHookName) || null;
  }
  if (isRuntimeHookHandlerName(normalizedHookName)) {
    return handlerFnsByHookName.get(normalizedHookName) || null;
  }
  return null;
}

export function registerRuntimeHook(target, hookName, hook) {
  const normalizedHookName = String(hookName || "").trim();
  if (!normalizedHookName) {
    return null;
  }
  bindStateCompatSurface(target);
  if (isRuntimeHookBusEventName(normalizedHookName)) {
    // 通知型 hook 暴露 dispatcher，兼容旧代码直接调用 state.someHook(...) 的写法。
    registerRuntimeHookBusListener(target, normalizedHookName, hook);
    return readRuntimeHookBusDispatcher(target, normalizedHookName);
  }
  if (!isRuntimeHookHandlerName(normalizedHookName)) {
    return null;
  }
  const normalizedHook = normalizeRuntimeHook(hook);
  if (!normalizedHook) {
    handlerFnsByHookName.delete(normalizedHookName);
    return null;
  }
  handlerFnsByHookName.set(normalizedHookName, normalizedHook);
  return getHandlerDispatcher(normalizedHookName);
}

// The registry is application-wide; target is only the legacy compatibility surface.
// Each owner registration has its own identity, even when callbacks are reused.
export function registerOwnedRuntimeHook(target, hookName, hook) {
  const name = String(hookName || "").trim();
  if (!isRuntimeHookBusEventName(name) && !isRuntimeHookHandlerName(name)) {
    throw new TypeError(`Unknown runtime hook: ${name}`);
  }
  if (typeof hook !== "function") {
    throw new TypeError(`Runtime hook requires a function: ${name}`);
  }
  registerRuntimeHook(target, name, (...args) => hook(...args));
  const registered = readRegisteredRuntimeHookSource(target, name);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    if (readRegisteredRuntimeHookSource(target, name) === registered) {
      registerRuntimeHook(target, name, null);
    }
  };
}

// Use at required command call sites. Optional notifications keep callRuntimeHook.
export function callRequiredRuntimeHook(target, hookName, ...args) {
  const name = String(hookName || "").trim();
  if (!isRuntimeHookHandlerName(name)) {
    throw new TypeError(`Required runtime hook must be a handler: ${name}`);
  }
  bindStateCompatSurface(target);
  const hook = handlerFnsByHookName.get(name);
  if (!hook) throw new Error(`Required runtime hook is not registered: ${name}`);
  return hook(...args);
}

export function callRuntimeHook(target, hookName, ...args) {
  const normalizedHookName = String(hookName || "").trim();
  if (!normalizedHookName) {
    return undefined;
  }
  bindStateCompatSurface(target);
  if (isRuntimeHookBusEventName(normalizedHookName)) {
    return emitRuntimeHookBusEvent(target, normalizedHookName, ...args);
  }
  const hook = handlerFnsByHookName.get(normalizedHookName) || null;
  if (!hook) {
    return undefined;
  }
  return hook(...args);
}

// Invoke the existing compatibility surface without binding or replacing it.
// Legacy callers may supply a plain target whose hook depends on its receiver.
export function callCompatRuntimeHook(target, hookName, ...args) {
  const normalizedHookName = String(hookName || "").trim();
  if (!isRuntimeHookBusEventName(normalizedHookName) && !isRuntimeHookHandlerName(normalizedHookName)) {
    throw new TypeError(`Unknown runtime hook: ${normalizedHookName}`);
  }
  return target[normalizedHookName]?.(...args);
}

// Deferred work can capture the current callback without retaining the state root.
// Preserve the bare-call receiver of legacy captured hooks, including strict mode.
export function captureCompatRuntimeHook(target, hookName) {
  const name = String(hookName || "").trim();
  if (!isRuntimeHookBusEventName(name) && !isRuntimeHookHandlerName(name)) {
    throw new TypeError(`Unknown runtime hook: ${name}`);
  }
  const callback = target?.[name];
  return typeof callback === "function"
    ? (...args) => Reflect.apply(callback, undefined, args)
    : undefined;
}

export function callRuntimeHooks(target, hookNames, ...args) {
  const normalizedHookNames = Array.isArray(hookNames) ? hookNames : [];
  return normalizedHookNames.map((hookName) => callRuntimeHook(target, hookName, ...args));
}

export function bindStateCompatSurface(target) {
  if (!target || typeof target !== "object" || compatTargets.has(target)) {
    return target;
  }
  compatTargets.add(target);

  // 兼容层把旧的 state 属性读写映射到集中 hook registry，避免各 owner 继续互相保存闭包引用。
  STATE_NOTIFICATION_HOOK_NAMES.forEach((hookName) => {
    Object.defineProperty(target, hookName, {
      configurable: true,
      enumerable: true,
      get() {
        return readRuntimeHookBusDispatcher(target, hookName);
      },
      set(nextHook) {
        registerRuntimeHookBusListener(target, hookName, nextHook);
      },
    });
  });

  STATE_HANDLER_HOOK_NAMES.forEach((hookName) => {
    Object.defineProperty(target, hookName, {
      configurable: true,
      enumerable: true,
      get() {
        return handlerFnsByHookName.has(hookName)
          ? getHandlerDispatcher(hookName)
          : null;
      },
      set(nextHook) {
        registerRuntimeHook(target, hookName, nextHook);
      },
    });
  });

  return target;
}

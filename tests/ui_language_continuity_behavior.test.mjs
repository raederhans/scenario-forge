import test from "node:test";
import assert from "node:assert/strict";
import { readLanguagePreference, persistLanguagePreference } from "../landing/i18n.js";
import { hydrateLanguage } from "../js/bootstrap/startup_bootstrap_support.js";
import { toggleLanguage } from "../js/ui/i18n.js";
import { state } from "../js/core/state.js";

function environment(t, { stored = {}, search = "", browser = "en-US", blocked = false } = {}) {
  const originals = new Map(["localStorage", "location", "navigator", "document"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const originalLanguage = state.currentLanguage;
  const values = new Map(Object.entries(stored));
  const storage = {
    getItem(key) { if (blocked) throw new Error("storage unavailable"); return values.get(key) ?? null; },
    setItem(key, value) { if (blocked) throw new Error("storage unavailable"); values.set(key, value); },
  };
  const globals = {
    localStorage: storage,
    location: { search },
    navigator: { language: browser },
    document: { documentElement: { lang: "en" }, querySelectorAll: () => [], getElementById: () => null },
  };
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    state.currentLanguage = originalLanguage;
  });
  return values;
}

for (const [name, options, expected] of [
  ["URL overrides every saved preference", { search: "?lang=zh-CN", stored: { scenario_forge_language: "en", map_lang: "en" } }, "zh"],
  ["shared preference overrides both legacy keys", { stored: { scenario_forge_language: "en", map_lang: "zh", scenario_forge_landing_lang: "zh" }, browser: "zh-CN" }, "en"],
  ["legacy editor preference migrates consistently", { stored: { map_lang: "zh" } }, "zh"],
  ["legacy landing preference migrates consistently", { stored: { scenario_forge_landing_lang: "zh" } }, "zh"],
  ["legacy conflict has a stable editor-first fallback", { stored: { map_lang: "en", scenario_forge_landing_lang: "zh" } }, "en"],
  ["browser language is used without a saved choice", { browser: "zh-TW" }, "zh"],
  ["unsupported values fall through to the browser", { search: "?lang=fr", stored: { scenario_forge_language: "de", map_lang: "invalid" }, browser: "zh-CN" }, "zh"],
  ["unsupported browser languages default to English", { browser: "fr-FR" }, "en"],
  ["blocked storage still honors the URL", { blocked: true, search: "?lang=en", browser: "zh-CN" }, "en"],
]) {
  test(`landing and editor agree: ${name}`, t => {
    environment(t, options);
    assert.equal(readLanguagePreference(), expected);
    hydrateLanguage();
    assert.equal(state.currentLanguage, expected);
  });
}

test("a landing choice reaches the editor and an editor toggle reaches the landing page", async t => {
  const values = environment(t);
  persistLanguagePreference("zh");
  assert.equal(values.get("scenario_forge_language"), "zh");
  assert.equal(values.get("map_lang"), "zh");
  assert.equal(values.get("scenario_forge_landing_lang"), "zh");
  hydrateLanguage();
  assert.equal(state.currentLanguage, "zh");
  await toggleLanguage();
  assert.equal(state.currentLanguage, "en");
  assert.equal(readLanguagePreference(), "en");
  for (const key of ["scenario_forge_language", "map_lang", "scenario_forge_landing_lang"]) assert.equal(values.get(key), "en");
});

test("a landing choice remains usable when browser storage is unavailable", t => {
  environment(t, { blocked: true, browser: "zh-CN" });
  assert.doesNotThrow(() => persistLanguagePreference("en"));
  assert.equal(readLanguagePreference(), "zh");
});

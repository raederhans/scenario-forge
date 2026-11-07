import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createScenarioIntroCard } from "../js/ui/scenario_intro_card.js";
import { state } from "../js/core/state.js";

class Element {
  constructor(ownerDocument, tag) {
    this.ownerDocument = ownerDocument;
    this.tagName = tag;
    this.children = [];
    this.style = {};
    this.attributes = {};
    this.listeners = {};
    this.textContent = "";
  }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
}

const registry = JSON.parse(readFileSync(new URL("../data/scenarios/index.json", import.meta.url), "utf8"));
const translations = JSON.parse(readFileSync(new URL("../data/i18n/manual_ui.json", import.meta.url), "utf8"));
const presentation = registry.scenarios.find((entry) => entry.scenario_id === "hoi4_1936").presentation;
function setup() {
  const document = { createElement: (tag) => new Element(document, tag) };
  const container = document.createElement("div");
  const controller = createScenarioIntroCard(container);
  return { controller, card: container.children[0] };
}
function find(root, className) {
  if (root.className === className) return root;
  for (const child of root.children) {
    const result = find(child, className);
    if (result) return result;
  }
}

test("renders translated presentation, current country names and colors, and layers", () => {
  const previous = { language: state.currentLanguage, countries: state.scenarioCountriesByTag, colors: state.sovereignBaseColors };
  try {
    state.currentLanguage = "en";
    state.scenarioCountriesByTag = { GER: { display_name_en: "Germany", display_name_zh: "德国", color_hex: "#123456" } };
    state.sovereignBaseColors = { GER: "#abcdef" };
    const { controller, card } = setup();
    controller.show(presentation);
    assert.equal(card.hidden, false);
    assert.equal(find(card, "scenario-intro-title").textContent, presentation.title);
    assert.equal(find(card, "scenario-intro-description").textContent, presentation.intro);
    assert.equal(find(card, "scenario-intro-tagline").textContent, presentation.tagline);
    const powers = find(card, "scenario-intro-powers");
    assert.equal(powers.children[1].children[1].textContent, "Germany");
    assert.equal(powers.children[1].children[0].style.backgroundColor, "#abcdef");
    assert.equal(powers.children[2].children[1].textContent, "ENG");
    assert.deepEqual(find(card, "scenario-intro-layers").children[1].children.map((node) => node.textContent), presentation.layers);
    state.currentLanguage = "zh";
    controller.show(presentation);
    assert.equal(find(card, "scenario-intro-title").textContent, translations[presentation.title]);
    assert.equal(find(card, "scenario-intro-description").textContent, translations[presentation.intro]);
    assert.equal(find(card, "scenario-intro-powers").children[1].children[1].textContent, "德国");
    assert.equal(find(card, "scenario-intro-close").attributes["aria-label"], "关闭剧本简介");
  } finally {
    state.currentLanguage = previous.language;
    state.scenarioCountriesByTag = previous.countries;
    state.sovereignBaseColors = previous.colors;
  }
});

test("close and Escape hide the card, and show replaces content and omits empty sections", () => {
  const { controller, card } = setup();
  assert.equal(card.hidden, true);
  controller.show(presentation);
  find(card, "scenario-intro-close").listeners.click();
  assert.equal(card.hidden, true);
  controller.show(presentation);
  let stopped = false;
  card.listeners.keydown({ key: "Escape", stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
  assert.equal(card.hidden, true);
  const blank = registry.scenarios.find((entry) => entry.scenario_id === "blank_base").presentation;
  controller.show(blank);
  assert.equal(card.hidden, false);
  assert.equal(find(card, "scenario-intro-powers"), undefined);
  assert.equal(find(card, "scenario-intro-layers"), undefined);
  assert.equal(card.children.filter((node) => node.tagName === "h2").length, 1);
  assert.notEqual(find(card, "scenario-intro-title").textContent, presentation.title);
});

test("all five scenarios have presentation copy with Chinese translations", () => {
  assert.equal(registry.scenarios.length, 5);
  for (const { presentation: entry } of registry.scenarios) {
    assert.ok(entry);
    assert.equal(typeof entry.year, "number");
    assert.ok(Array.isArray(entry.powers));
    assert.ok(Array.isArray(entry.layers));
    for (const key of [entry.title, entry.tagline, entry.intro, ...entry.layers]) {
      assert.equal(typeof key, "string");
      assert.match(translations[key], /[\u3400-\u9fff]/u);
    }
  }
});

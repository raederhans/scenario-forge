import test from "node:test";
import assert from "node:assert/strict";
import { createMobileEditingHintController } from "../js/ui/toolbar/mobile_editing_hint_controller.js";

class Node extends EventTarget {
  constructor(tag, doc) {
    super();
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this.attributes = new Map();
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  appendChild(node) { this.children.push(node); node.parentElement = this; return node; }
  append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
  prepend(node) { this.children.unshift(node); node.parentElement = this; }
  after(node) {
    const parent = this.parentElement;
    parent.children.splice(parent.children.indexOf(this) + 1, 0, node);
    node.parentElement = parent;
  }
  remove() {
    this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
  }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  focus() { this.ownerDocument.activeElement = this; }
  fire(type, properties = {}) {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, properties);
    const path = [];
    for (let node = this; node; node = node.parentElement) path.push(node);
    path.forEach(node => node.dispatchEvent(event));
    return event;
  }
}

function harness({ narrow = true, dismissed = false, storageThrows = false, projectBar = true } = {}) {
  const doc = {};
  doc.createElement = tag => new Node(tag, doc);
  doc.body = doc.createElement("body");
  doc.getElementById = id => {
    const find = node => node.id === id ? node : node.children.map(find).find(Boolean);
    return find(doc.body) ?? null;
  };
  const bar = doc.createElement("header");
  bar.id = "editorProjectBar";
  if (projectBar) doc.body.appendChild(bar);
  const map = doc.createElement("main");
  map.id = "mapContainer";
  map.setAttribute("tabindex", "-1");
  doc.body.appendChild(map);
  const values = new Map(dismissed ? [["sf.mobileEditingHint.dismissed", "1"]] : []);
  const storage = {
    getItem(key) { if (storageThrows) throw new Error("unavailable"); return values.get(key) ?? null; },
    setItem(key, value) { if (storageThrows) throw new Error("unavailable"); values.set(key, value); },
  };
  const media = new EventTarget();
  media.matches = narrow;
  const controller = createMobileEditingHintController({
    documentRef: doc, storage,
    matchMedia(query) { assert.equal(query, "(max-width: 767px)"); return media; },
    t(key, namespace) { assert.equal(namespace, "ui"); return `translated:${key}`; },
    createUiIcon(name, { size, doc: iconDoc }) {
      assert.equal(name, "close");
      assert.equal(size, 16);
      assert.equal(iconDoc, doc);
      return doc.createElement("svg");
    },
  });
  return {
    doc, bar, map, values, controller,
    hint: () => doc.getElementById("mobileEditingHint"),
    resize(matches) {
      media.matches = matches;
      media.dispatchEvent(Object.assign(new Event("change"), { matches }));
    },
  };
}

test("窄屏无关闭记录时在项目栏后显示带翻译和关闭按钮的提示", () => {
  const h = harness();
  h.controller.mount();
  const hint = h.hint();
  assert.equal(h.controller.isVisible(), true);
  assert.equal(h.doc.body.children[1], hint);
  assert.equal(hint.className, "mobile-editing-hint");
  assert.equal(hint.getAttribute("role"), "status");
  const [message, close] = hint.children;
  assert.equal(message.getAttribute("data-i18n"), "Editing works best on a desktop screen.");
  assert.equal(message.textContent, "translated:Editing works best on a desktop screen.");
  assert.equal(close.type, "button");
  assert.equal(close.className, "mobile-editing-hint-close");
  assert.equal(close.getAttribute("aria-label"), "translated:Dismiss");
  assert.equal(close.getAttribute("data-i18n-aria-label"), "Dismiss");
  assert.equal(close.children[0].tagName, "SVG");
});

test("没有项目栏时插入 body 开头", () => {
  const h = harness({ projectBar: false });
  h.controller.mount();
  assert.equal(h.doc.body.children[0], h.hint());
});

for (const options of [{ dismissed: true }, { narrow: false }]) {
  test(`${JSON.stringify(options)} 时不显示`, () => {
    const h = harness(options);
    h.controller.mount();
    assert.equal(h.controller.isVisible(), false);
    assert.equal(h.hint(), null);
    h.resize(true);
    assert.equal(h.hint(), null);
  });
}

for (const focusInside of [true, false]) {
  test(`点击关闭记录状态，提示内焦点=${focusInside}`, () => {
    const h = harness();
    h.controller.mount();
    const button = h.hint().children[1];
    const origin = focusInside ? button : h.bar;
    origin.focus();
    button.fire("click");
    assert.equal(h.hint(), null);
    assert.equal(h.controller.isVisible(), false);
    assert.equal(h.values.get("sf.mobileEditingHint.dismissed"), "1");
    assert.equal(h.doc.activeElement, focusInside ? h.map : origin);
  });
}

test("提示内部 Escape 关闭并阻止默认行为", () => {
  const h = harness();
  h.controller.mount();
  const close = h.hint().children[1];
  close.focus();
  const event = close.fire("keydown", { key: "Escape" });
  assert.equal(event.defaultPrevented, true);
  assert.equal(h.hint(), null);
  assert.equal(h.values.get("sf.mobileEditingHint.dismissed"), "1");
  assert.equal(h.doc.activeElement, h.map);
});

test("变宽移除提示但不存储，再次变窄不会自动显示", () => {
  const h = harness();
  h.controller.mount();
  h.resize(false);
  assert.equal(h.hint(), null);
  assert.equal(h.controller.isVisible(), false);
  assert.equal(h.values.size, 0);
  h.resize(true);
  assert.equal(h.hint(), null);
  h.controller.mount();
  assert.equal(h.controller.isVisible(), true);
});

test("存储读写抛错仍能显示和关闭", () => {
  const h = harness({ storageThrows: true });
  assert.doesNotThrow(() => h.controller.mount());
  assert.equal(h.controller.isVisible(), true);
  assert.doesNotThrow(() => h.controller.dismiss());
  assert.equal(h.hint(), null);
});

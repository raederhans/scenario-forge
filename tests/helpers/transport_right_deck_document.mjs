export class TestClassList {
  constructor(node) {
    this.node = node;
  }

  add(...tokens) {
    const values = new Set(String(this.node.className || "").split(/\s+/).filter(Boolean));
    tokens.forEach((token) => values.add(token));
    this.node.className = Array.from(values).join(" ");
  }

  remove(...tokens) {
    const values = new Set(String(this.node.className || "").split(/\s+/).filter(Boolean));
    tokens.forEach((token) => values.delete(token));
    this.node.className = Array.from(values).join(" ");
  }

  contains(token) {
    return String(this.node.className || "").split(/\s+/).includes(token);
  }

  toggle(token, force) {
    const shouldAdd = force === undefined ? !this.contains(token) : !!force;
    if (shouldAdd) {
      this.add(token);
    } else {
      this.remove(token);
    }
    return shouldAdd;
  }
}

export class TestElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toLowerCase();
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.listeners = new Map();
    this.attributes = new Map();
    this.className = "";
    this.classList = new TestClassList(this);
    this.textContent = "";
    this.type = "";
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.open = false;
    this.replaceChildrenCallCount = 0;
  }

  get childElementCount() {
    return this.children.length;
  }

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }

  appendChild(node) {
    this.children.push(node);
    node.parentNode = this;
    return node;
  }

  prepend(...nodes) {
    nodes.reverse().forEach((node) => {
      this.children.unshift(node);
      node.parentNode = this;
    });
  }

  replaceChildren(...nodes) {
    this.replaceChildrenCallCount += 1;
    this.children.forEach((child) => {
      child.parentNode = null;
    });
    this.children = [];
    this.append(...nodes);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) || "";
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  dispatch(type, event = {}) {
    const nextEvent = {
      preventDefault() {},
      ...event,
    };
    for (const handler of this.listeners.get(type) || []) {
      handler(nextEvent);
    }
  }
}

export function createTestDocument() {
  return {
    createElement: (tagName) => new TestElement(tagName),
  };
}

export function withTestDocument(callback) {
  const previousDocument = globalThis.document;
  globalThis.document = createTestDocument();
  try {
    callback();
  } finally {
    globalThis.document = previousDocument;
  }
}

export class Element {
  constructor(tag = "div") {
    this.tagName = tag;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.listeners = new Map();
    this.className = "";
    this.clientWidth = 800;
    this.clientHeight = 600;
    this.rebuilds = 0;
    this.classList = {
      toggle: (name, on) => {
        const names = new Set(this.className.split(" ").filter(Boolean));
        if (on) names.add(name); else names.delete(name);
        this.className = [...names].join(" ");
      },
      add: (name) => this.classList.toggle(name, true),
      remove: (name) => this.classList.toggle(name, false),
    };
  }
  append(...children) { children.forEach((child) => this.appendChild(child)); }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  replaceChildren(...children) { this.rebuilds++; this.children = []; this.append(...children); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
  contains(child) { return this === child || this.children.some((node) => node.contains(child)); }
  setAttribute(key, value) { this.attributes[key] = value; }
  matches(selector) {
    if (selector.startsWith(".")) return this.className.split(" ").includes(selector.slice(1));
    const match = selector.match(/^\[data-([a-z-]+)(?:="([^"]+)")?\]$/);
    if (!match) return false;
    const key = match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    return key in this.dataset && (match[2] === undefined || this.dataset[key] === match[2]);
  }
  querySelectorAll(selector) { return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return selector.split(", ").some((part) => this.matches(part)) ? this : this.parent?.closest(selector); }
  addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(handler); }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  fire(type, extras = {}) {
    const event = { button: 0, clientX: 30, clientY: 30, target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, ...extras };
    for (const handler of [...(this.listeners.get(type) || [])]) handler(event);
  }
  get offsetWidth() { return parseInt(this.style.width) || 240; }
  get offsetHeight() { return parseInt(this.style.height) || 340; }
  getBoundingClientRect() {
    const left = parseInt(this.style.left) || 0, top = parseInt(this.style.top) || 0;
    return { left, top, right: left + (this.parent ? this.offsetWidth : this.clientWidth), bottom: top + (this.parent ? this.offsetHeight : this.clientHeight) };
  }
}

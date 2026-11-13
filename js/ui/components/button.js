// 按钮工厂：返回真实的 <button>，不包装事件。
// variant / size 生成修饰类（.btn--primary、.btn--sm 等，各自自足）；className 原样追加，
// 旧调用点只传 className 时类名与原来完全一致（别名类的样式由 css/components/button.css 统一提供）。
const VARIANTS = new Set(["primary", "secondary", "danger", "icon"]);
const SIZES = new Set(["sm", "md", "lg"]);

export function createButton({
  label = "",
  variant = "",
  size = "",
  className = "",
  id = "",
  type = "button",
  title = "",
  ariaLabel = "",
  i18nKey = "",
  disabled = false,
  documentRef = globalThis.document,
} = {}) {
  const button = documentRef.createElement("button");
  button.type = type;
  const classes = [];
  if (variant) {
    if (!VARIANTS.has(variant)) throw new Error(`createButton: unknown variant "${variant}"`);
    classes.push(`btn--${variant}`);
  }
  if (size && size !== "md") {
    if (!SIZES.has(size)) throw new Error(`createButton: unknown size "${size}"`);
    classes.push(`btn--${size}`);
  }
  if (className) classes.push(className);
  if (classes.length) button.className = classes.join(" ");
  if (id) button.id = id;
  if (i18nKey) button.dataset.i18n = i18nKey;
  if (label) button.textContent = label;
  if (title) button.title = title;
  if (ariaLabel) button.setAttribute("aria-label", ariaLabel);
  if (disabled) button.disabled = true;
  return button;
}

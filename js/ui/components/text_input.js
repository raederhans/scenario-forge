// 文本输入工厂：返回真实的 <input>，业务方照常监听原生 input / change 事件。
// 默认类名 .input（样式见 css/components/text-input.css）；size: "sm" 追加 .input--sm。
export function createTextInput({
  id = "",
  type = "text",
  className = "input",
  size = "",
  placeholder = "",
  value = "",
  name = "",
  ariaLabel = "",
  autocomplete = "",
  documentRef = globalThis.document,
} = {}) {
  const input = documentRef.createElement("input");
  if (id) input.id = id;
  input.type = type;
  const classes = [className, size === "sm" ? "input--sm" : ""].filter(Boolean);
  if (classes.length) input.className = classes.join(" ");
  if (placeholder) input.placeholder = placeholder;
  if (value) input.value = value;
  if (name) input.name = name;
  if (ariaLabel) input.setAttribute("aria-label", ariaLabel);
  if (autocomplete) input.autocomplete = autocomplete;
  return input;
}

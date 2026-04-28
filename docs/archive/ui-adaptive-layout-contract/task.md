# Task

## Acceptance
- [x] layout token 与 utility class 进入 `:root` / shared utility 区。
- [x] `scenarioContextBar` 的安全宽度由 CSS custom property 控制，inline style 中没有 `maxWidth` 属性写入。
- [x] `bottom-dock-primary` 的响应式规则收敛到终态 owner 区块与 container/media fallback。
- [x] dock/sidebar popover、transport info/help popover、palette library 使用统一尺寸 token。
- [x] 范围内长文本具有明确 truncation/scroll 契约。
- [x] 指定 npm verify 与 e2e 命令通过，视觉证据写入 `.runtime/`。

## Verification
- `npm run verify:ui-contract-foundation` PASS。
- `npm run verify:ui-rework-mainline` PASS。
- `npm run verify:ui-rework-support` PASS。
- `npm run verify:test:e2e-layers` PASS。
- `npm run test:e2e:ui-rework-mainline` PASS。
- `npm run test:e2e:ui-rework-support` PASS。
- `git diff --check` PASS。
- `lsp_diagnostics_directory` PASS / no tsconfig found, 0 diagnostics.

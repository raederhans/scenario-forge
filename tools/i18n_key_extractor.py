from __future__ import annotations

import re
from pathlib import Path

TRANSPORT_CONFIG_UI_FIELD_RE = re.compile(
    r'''\b(?:label|title|description|lensTitle|lensBody|lensNext|previewTitle|previewCaption|inspectorTitle|inspectorBody|inspectorEmptyTitle|inspectorEmptyBody|pendingStatus)\s*:\s*"(?P<text>(?:\\.|[^"\\])*)"''',
)
JS_BLOCK_COMMENT_RE = re.compile(r"/\*.*?\*/", re.DOTALL)
JS_LINE_COMMENT_RE = re.compile(r"^\s*//.*$", re.MULTILINE)
TRANSPORT_CONFIG_FILENAMES = {
    "transport_workbench_controller.js",
    "transport_workbench_descriptor.js",
}


def strip_js_comments(content: str) -> str:
    without_blocks = JS_BLOCK_COMMENT_RE.sub("", content)
    return JS_LINE_COMMENT_RE.sub("", without_blocks)


def iter_transport_config_ui_strings(path: Path, content: str):
    """Yield user-facing transport descriptor strings from controller/catalog files."""
    if path.name not in TRANSPORT_CONFIG_FILENAMES:
        return
    for match in TRANSPORT_CONFIG_UI_FIELD_RE.finditer(strip_js_comments(content)):
        value = match.group("text")
        if value:
            yield value

import { execFileSync } from "node:child_process";
import test from "node:test";

test("each control referenced by the user guide exists in the page", () => {
  execFileSync(process.execPath, ["tools/run_python.mjs", "-c", `
from html.parser import HTMLParser
from pathlib import Path

class GuideControls(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = set()
        self.references = set()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "id" in attrs:
            self.ids.add(attrs["id"])
        self.references.update(attrs.get("data-guide-controls", "").split())

page = GuideControls()
page.feed(Path("index.html").read_text(encoding="utf-8"))
page.close()
assert page.references, "Guide contains no control references"
missing = page.references - page.ids
assert not missing, f"Missing guide controls: {sorted(missing)}"
`], { cwd: new URL("../", import.meta.url), stdio: "inherit" });
});

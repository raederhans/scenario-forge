"""可释放国目录的每一条都要有中文名：中文界面下国家列表直接显示 display_name_zh，缺了就会露出英文。"""

import json
import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
CATALOGS = [
    REPO_ROOT / "data/releasables/tno_1962.internal.phase1.catalog.json",
    REPO_ROOT / "data/releasables/hoi4_vanilla.internal.phase1.catalog.json",
]
CJK = re.compile(r"[一-鿿]")


class ReleasableCatalogNamesTest(unittest.TestCase):
    def test_every_releasable_has_a_chinese_display_name(self):
        for catalog_path in CATALOGS:
            entries = json.loads(catalog_path.read_text(encoding="utf-8"))["entries"]
            missing = [
                entry["tag"]
                for entry in entries
                if not CJK.search(str(entry.get("display_name_zh") or ""))
            ]
            with self.subTest(catalog=catalog_path.name):
                self.assertEqual(missing, [])


if __name__ == "__main__":
    unittest.main()

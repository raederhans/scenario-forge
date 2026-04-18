from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
VARIANT_HELPER_JS = REPO_ROOT / "js" / "ui" / "transport_workbench_manifest_variants.js"
PORT_PREVIEW_JS = REPO_ROOT / "js" / "ui" / "transport_workbench_port_preview.js"
INDUSTRIAL_PREVIEW_JS = REPO_ROOT / "js" / "ui" / "transport_workbench_industrial_zone_preview.js"
TOOLBAR_JS = REPO_ROOT / "js" / "ui" / "toolbar.js"
TRANSPORT_WORKBENCH_CONTROLLER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "transport_workbench_controller.js"


class TransportWorkbenchManifestRuntimeContractTest(unittest.TestCase):
    def test_shared_variant_helper_exposes_shared_manifest_contract(self) -> None:
        content = VARIANT_HELPER_JS.read_text(encoding="utf-8")

        self.assertIn("manifest?.variants", content)
        self.assertIn("manifest?.default_variant", content)
        self.assertNotIn("coverage_variants", content)
        self.assertNotIn("distribution_variants", content)
        self.assertNotIn("default_coverage_tier", content)
        self.assertNotIn("default_distribution_variant", content)

    def test_port_preview_uses_shared_variant_contract_only(self) -> None:
        content = PORT_PREVIEW_JS.read_text(encoding="utf-8")

        self.assertIn('./transport_workbench_manifest_variants.js', content)
        self.assertIn("resolveTransportWorkbenchManifestVariantId", content)
        self.assertIn("getTransportWorkbenchManifestVariantMeta", content)
        self.assertNotIn("coverage_variants", content)
        self.assertNotIn("default_coverage_tier", content)

    def test_industrial_preview_uses_shared_variant_contract_only(self) -> None:
        content = INDUSTRIAL_PREVIEW_JS.read_text(encoding="utf-8")

        self.assertIn('./transport_workbench_manifest_variants.js', content)
        self.assertIn("resolveTransportWorkbenchManifestVariantId", content)
        self.assertIn("getTransportWorkbenchManifestVariantMeta", content)
        self.assertIn("getTransportWorkbenchManifestDefaultVariantId", content)
        self.assertNotIn("distribution_variants", content)
        self.assertNotIn("default_distribution_variant", content)

    def test_toolbar_no_longer_reads_legacy_transport_variant_fields(self) -> None:
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        controller_content = TRANSPORT_WORKBENCH_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn('./toolbar/transport_workbench_controller.js', toolbar_content)
        self.assertIn('../transport_workbench_manifest_variants.js', controller_content)
        self.assertIn("listTransportWorkbenchManifestVariantEntries", controller_content)
        self.assertIn("getTransportWorkbenchManifestDefaultVariantId", controller_content)
        self.assertIn("getTransportWorkbenchManifestVariantMeta", controller_content)
        self.assertNotIn("coverage_variants", controller_content)
        self.assertNotIn("distribution_variants", controller_content)
        self.assertNotIn("default_coverage_tier", controller_content)
        self.assertNotIn("default_distribution_variant", controller_content)


if __name__ == "__main__":
    unittest.main()

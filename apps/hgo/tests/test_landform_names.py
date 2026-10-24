import json
from pathlib import Path
import sys
import tempfile
import unittest

TOOLS = Path(__file__).resolve().parents[1] / 'tools'
sys.path.insert(0, str(TOOLS))
import build_geographic_overlays as geo
import main_sources


class LandformNameTests(unittest.TestCase):
    def test_bound_text_refresh_preserves_registration_and_rejects_stale_review(self):
        runtime = geo.ROOT / '.runtime/tmp'
        runtime.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime) as temporary:
            root = Path(temporary)
            output = root / 'apps/hgo/assets/overlays/geography'
            local = root / 'apps/hgo/assets/overlays/localization'
            for path in (output, local):
                path.mkdir(parents=True, exist_ok=True)
            source = dict(id='n1', name_en='North-Estonian Coastal Plain', name_zh='波羅的海平原')
            main_sources.pin(root, 'data/physical_region_labels.geojson',
                             geo.encoded(dict(features=[dict(properties=source)])))
            (local / 'TSPhrases.txt').write_text('愛沙尼亞\t爱沙尼亚\n', encoding='utf8')
            (local / 'TSCharacters.txt').write_text('羅\t罗\n', encoding='utf8')
            review = dict(schemaVersion=1, entries=[dict(
                id='n1', originalEn=source['name_en'], originalZh=source['name_zh'],
                proposedZh='北愛沙尼亞沿海平原', reason='Exact geographic description', source='Original English name')])
            review_path = output / 'name_reviews.json'
            review_path.write_bytes(geo.encoded(review))
            original = dict(id='n1', nameEn=source['name_en'], nameZh=source['name_zh'],
                            x=22.25, y=39.75, rank=5, minZoom=2.55, classId=4)
            raw = geo.encoded(dict(schemaVersion=1, coordinateSpace='hgo-pixel', labels=[original]))
            (output / 'labels.json').write_bytes(raw)
            manifest = dict(datasetRevision='unchanged', assets={
                'labels': dict(url='labels.json', encoding='json', byteLength=len(raw), sha256=geo.digest(raw)),
                'physical': dict(sha256='unaltered-raster')})
            (output / 'manifest.json').write_bytes(geo.encoded(manifest))
            updated = geo.build_label_names_only(root, output)
            label = json.loads((output / 'labels.json').read_bytes())['labels'][0]
            self.assertEqual(label, {**original, 'nameZh': '北爱沙尼亚沿海平原'})
            self.assertEqual(updated['assets']['physical'], manifest['assets']['physical'])
            self.assertEqual(updated['datasetRevision'], manifest['datasetRevision'])
            once = (output / 'labels.json').read_bytes()
            geo.build_label_names_only(root, output)
            self.assertEqual((output / 'labels.json').read_bytes(), once)
            review['entries'][0]['proposedEn'] = 'Baltic Plains'
            review_path.write_bytes(geo.encoded(review))
            geo.build_label_names_only(root, output)
            geo.build_label_names_only(root, output)
            self.assertEqual(json.loads((output / 'labels.json').read_bytes())['labels'][0]['nameEn'], 'Baltic Plains')
            review['entries'][0]['proposedZh'] = ''
            review_path.write_bytes(geo.encoded(review))
            geo.build_label_names_only(root, output)
            self.assertEqual(json.loads((output / 'labels.json').read_bytes())['labels'][0]['nameZh'], '')
            review['entries'][0]['originalEn'] = 'Another plain'
            review_path.write_bytes(geo.encoded(review))
            with self.assertRaisesRegex(ValueError, 'source changed'):
                geo.build_label_names_only(root, output)


if __name__ == '__main__':
    unittest.main()

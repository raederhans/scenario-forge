import json
from pathlib import Path
import sys
import tempfile
import unittest

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from build_dataset import build
from source_parser import Block, history_at, parse
from validate_dataset import validate


class DatasetTests(unittest.TestCase):
    def setUp(self):
        runtime = Path(__file__).resolve().parents[3] / '.runtime/tmp'
        runtime.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=runtime)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'source'
        self.output = Path(self.temp.name) / 'output'
        self.put('map/definition.csv', '0;0;0;0;land\n42;10;20;30;land\n99;90;80;70;land\n')
        image = Image.new('RGB', (3, 2))
        image.putdata([(0, 0, 0), (10, 20, 30), (10, 20, 30), (0, 0, 0), (10, 20, 30), (0, 0, 0)])
        image.save(self.root / 'map/provinces.bmp')
        self.put('history/states/1.txt', 'state={id=1 name="STATE_1" provinces={0} history={owner=AAA victory_points={0 10}}}')
        self.put('history/states/8.txt', 'state={id=8 name="SEA" provinces={42} history={owner=WTR add_core_of=WTR}}')
        self.put('common/country_tags/tags.txt', 'AAA="countries/A.txt" WTR="countries/W.txt"')
        self.put('common/countries/A.txt', 'color=rgb {100 110 120}')
        self.put('common/countries/W.txt', 'color={20 40 80}')
        self.put('history/countries/AAA - A.txt', 'capital = 1')
        self.put('localisation/native_l_english.yml', 'l_english:\n STATE_1:0 "Native island"\n SEA:0 "Editable sea"\n AAA:0 "Native country"\n VICTORY_POINTS_0:0 "Harbor"\n')

    def put(self, name, text):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf-8')

    def test_roundtrip_deterministic_water_and_zero(self):
        first = build(self.root, self.output)
        before = {p.name: p.read_bytes() for p in self.output.iterdir()}
        second = build(self.root, self.output)
        self.assertEqual(first, second)
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.output.iterdir()})
        result = validate(self.output, self.root)
        self.assertEqual(result['sourcePixelMismatches'], 0)
        self.assertEqual(result['waterStateCount'], 1)
        core = json.loads((self.output / 'core.json').read_bytes())
        self.assertEqual(core['provinceIds'], [None, 0, 42, 99])
        self.assertEqual(core['provinceStateIds'], [None, 1, 8, None])
        self.assertEqual(core['states'][0]['name'], 'Native island')
        self.assertFalse(json.loads((self.output / 'places.json').read_bytes())['places'][0]['isCapital'])

    def test_duplicate_and_unknown_membership(self):
        self.put('history/states/9.txt', 'state={id=9 provinces={0} history={owner=AAA}}')
        with self.assertRaisesRegex(ValueError, 'Duplicate state membership'):
            build(self.root, self.output)
        self.put('history/states/9.txt', 'state={id=9 provinces={9999} history={owner=AAA}}')
        with self.assertRaisesRegex(ValueError, 'undefined provinces'):
            build(self.root, self.output)

    def test_undefined_pixels_and_unused_definitions(self):
        self.put('map/definition.csv', '0;0;0;0;land\n')
        with self.assertRaisesRegex(ValueError, 'undefined provinces'):
            build(self.root, self.output)
        self.put('map/definition.csv', '0;0;0;0;land\n42;1;2;3;land\n')
        with self.assertRaisesRegex(ValueError, 'undefined RGB'):
            build(self.root, self.output)

    def test_integrity_is_checked(self):
        build(self.root, self.output)
        path = self.output / 'ids.u16.gz'
        data = bytearray(path.read_bytes())
        data[-1] ^= 1
        path.write_bytes(data)
        with self.assertRaisesRegex(ValueError, 'integrity mismatch'):
            validate(self.output)

    def test_stale_optional_place_reference_is_reported(self):
        self.put('history/states/1.txt', 'state={id=1 provinces={0} history={owner=AAA victory_points={42 10}}}')
        manifest = build(self.root, self.output)
        self.assertEqual(manifest['source']['omittedPlaceReferenceCount'], 1)
        self.assertEqual(manifest['stats']['placeCount'], 0)
        self.assertTrue(validate(self.output)['valid'])

    def test_parser_preserves_history_and_comments(self):
        body = parse('name="A # B" # comment\nhistory={owner=AAA add_core_of=AAA 1937.1.1={owner=BBB}}')
        self.assertEqual(body.get('name'), 'A # B')
        self.assertEqual(history_at(body.get('history')).get('owner'), 'AAA')
        with self.assertRaises(ValueError):
            parse('state={id=1')


if __name__ == '__main__':
    unittest.main()

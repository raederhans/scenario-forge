import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from build_localization import build_overlay, make_simplifier
import main_sources


class LocalizationTests(unittest.TestCase):
    def fixture(self):
        core={'states':[
            {'id':1,'name':'North Inner York','entityTag':'ENG','nameKey':'STATE_1'},
            {'id':2,'name':'York','entityTag':'USA','nameKey':'STATE_2'},
            ],
            'entities':[{'tag':'ENG','name':'United Kingdom'}]}
        locales={'York (GB)':{'zh':'约克'},'York (US)':{'zh':'约克市'},'United Kingdom':{'zh':'英国'}}
        geo={'entries':[{'country_code':'GB','primary_name':'Ambiguous','stable_key':'id:a'},
            {'country_code':'US','primary_name':'York','stable_key':'id:us'}]}
        cities={'features':[]}
        return core,[],{'id':'hgo','revision':'r1'},{'entries':{}},locales,geo,cities

    def test_place_decisions_are_identity_bound_and_do_not_propagate_by_name(self):
        args=list(self.fixture())
        args[0]['states'][0]['name']='York'
        args[1]=[{'id':'vp-1','name':'York','stateId':1,'entityTag':'ENG'},
            {'id':'vp-2','name':'York','stateId':1,'entityTag':'ENG'},
            {'id':'vp-3','name':'York','stateId':2,'entityTag':'USA'}]
        review={'expectedCount':2,'entries':[
            {'id':'vp-1','original':'York','stateId':1,'entityTag':'ENG','decision':'accepted',
                'zh':'审核译名','status':'translation','basis':'Test reviewed source form','evidence':[{'key':'test'}]},
            {'id':'vp-3','original':'York','stateId':2,'entityTag':'USA','decision':'unresolved',
                'reason':'ambiguous-identity','basis':'Ambiguous source identity','evidence':[{'key':'test'}]}]}
        overlay,report=build_overlay(*args,place_reviews=review)
        self.assertEqual(overlay['places']['vp-1']['zh'],'审核译名')
        self.assertEqual(overlay['places']['vp-2']['zh'],'约克')
        self.assertEqual(overlay['states']['1']['zh'],'约克')
        self.assertNotIn('zh',overlay['places']['vp-3'])
        self.assertEqual(overlay['places']['vp-3']['sources'][0]['decision'],'unresolved')
        self.assertEqual(report['placeReviewSummary'],{'total':2,'accepted':1,'unresolved':1})
        for key,value in [('original','Stale source'),('stateId',2),('entityTag','USA')]:
            stale=json.loads(json.dumps(review));stale['entries'][0][key]=value
            with self.assertRaisesRegex(ValueError,'Stale place review binding'):
                build_overlay(*args,place_reviews=stale)

    def test_state_reviews_require_native_binding_and_same_name_place_approval(self):
        args=list(self.fixture());args[0]['states'][0]['name']='York'
        args[0]['states'].append({'id':6,'name':'York','entityTag':'ENG','nameKey':'STATE_6'})
        args[1]=[{'id':'vp-1','name':'York','stateId':1,'entityTag':'ENG'}]
        place_reviews={'entries':[{'id':'vp-1','original':'York','stateId':1,'entityTag':'ENG',
            'decision':'accepted','zh':'审核译名','status':'translation','basis':'Source pair','evidence':[{'key':'test'}]}]}
        state_reviews={'expectedCount':2,'entries':[
            {'id':1,'original':'York','entityTag':'ENG','decision':'accepted','zh':'审核译名',
                'status':'translation','basis':'Same native place name','evidence':[{'key':'test'}],'placeId':'vp-1'},
            {'id':2,'original':'York','entityTag':'USA','decision':'unresolved','reason':'ambiguous-identity',
                'basis':'Do not infer source location','evidence':[{'key':'test'}]}]}
        overlay,report=build_overlay(*args,place_reviews=place_reviews,state_reviews=state_reviews)
        self.assertEqual(overlay['states']['1']['zh'],'审核译名')
        self.assertEqual(overlay['states']['6']['zh'],'约克','same name in another state is not changed')
        self.assertNotIn('zh',overlay['states']['2'])
        self.assertEqual(overlay['places']['vp-1']['zh'],'审核译名')
        self.assertEqual(report['stateReviewSummary'],{'total':2,'accepted':1,'unresolved':1})
        for key,value in [('original','Stale name'),('entityTag','USA')]:
            stale=json.loads(json.dumps(state_reviews));stale['entries'][0][key]=value
            with self.assertRaisesRegex(ValueError,'Stale state review binding'):
                build_overlay(*args,place_reviews=place_reviews,state_reviews=stale)

    def test_committed_overlay_is_reproducible_from_source_files(self):
        root=Path(__file__).resolve().parents[3]
        # Main-repository inputs are HGO's pinned snapshots, not live main data.
        read=lambda path:main_sources.read_json(root,path) if path.startswith('data/') else json.loads((root/path).read_bytes())
        base=root/'apps/hgo/assets/overlays/localization'
        simplify=make_simplifier(*[(base/name).read_text(encoding='utf8') for name in ['TSPhrases.txt','TSCharacters.txt']])
        overlay,report=build_overlay(read('apps/hgo/assets/default/core.json'),
            read('apps/hgo/assets/default/places.json')['places'],read('apps/hgo/assets/default/manifest.json'),
            read('data/hgo_catalogs/hgo_place_names.json'),read('data/locales.json')['geo'],
            read('data/geo_aliases.json'),read('data/world_cities.geojson'),read('data/palettes/hoi4_vanilla.palette.json'),
            read('data/hierarchy.json'),read('data/city_aliases.json'),simplify,
            read('apps/hgo/assets/overlays/localization/reviewed_translations.json'),
            {'features':read('data/marine_regions.refined.source.geojson')['features']+read('data/marine_regions.additional.source.geojson')['features']},
            read('apps/hgo/assets/overlays/geography/georeference.json'),
            read('apps/hgo/assets/overlays/localization/place_reviews.json'),
            read('apps/hgo/assets/overlays/localization/state_reviews.json'))
        self.assertEqual(overlay,read('apps/hgo/assets/overlays/localization/index.json'))


if __name__=='__main__':
    unittest.main()

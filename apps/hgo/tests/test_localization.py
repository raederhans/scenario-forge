import json
import hashlib
from pathlib import Path
import struct
import sys
import unittest
import zipfile

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from build_localization import build_overlay, repair_name, encoded, make_simplifier, normalize


class LocalizationTests(unittest.TestCase):
    def fixture(self):
        core={'states':[
            {'id':1,'name':'North Inner York','entityTag':'ENG','nameKey':'STATE_1'},
            {'id':2,'name':'York','entityTag':'USA','nameKey':'STATE_2'},
            {'id':3,'name':'York','entityTag':'FRA','nameKey':'STATE_3'},
            {'id':4,'name':'STATE_4','entityTag':'ENG','nameKey':'STATE_4'},
            {'id':5,'name':'Ambiguous','entityTag':'ENG','nameKey':'STATE_5'}],
            'entities':[{'tag':'ENG','name':'United Kingdom'}]}
        locales={'York (GB)':{'zh':'约克'},'York (US)':{'zh':'约克市'},'United Kingdom':{'zh':'英国'}}
        geo={'entries':[{'country_code':'GB','primary_name':'Ambiguous','stable_key':'id:a'},
            {'country_code':'US','primary_name':'York','stable_key':'id:us'}]}
        cities={'features':[{'properties':{'id':'city:1','country_code':'GB','name':'Ambiguous','name_zh':'甲城'}},
            {'properties':{'id':'city:2','country_code':'GB','name':'Ambiguous','name_zh':'乙城'}}]}
        return core,[],{'id':'hgo','revision':'r1'},{'entries':{}},locales,geo,cities

    def test_parent_scope_direction_rules_and_ambiguity(self):
        overlay,report=build_overlay(*self.fixture())
        self.assertEqual(overlay['states']['1']['zh'],'约克内区北部')
        self.assertEqual(overlay['states']['2']['zh'],'约克市')
        self.assertNotIn('zh',overlay['states']['3'])
        self.assertNotIn('zh',overlay['states']['5'])
        self.assertEqual(report['unresolvedPlaceholders'],[4])
        self.assertEqual(overlay['dataset']['revision'],'r1')

    def test_id_native_repair_is_limited_to_provable_encoding_or_placeholders(self):
        self.assertEqual(repair_name('V盲sternorrlands','Västernorrlands'),'Västernorrlands')
        self.assertEqual(repair_name('STATE_4','Known native name'),'Known native name')
        self.assertEqual(repair_name('Historical name','Unrelated modern name'),'Historical name')

    def test_builder_is_deterministic_and_does_not_modify_inputs(self):
        args=self.fixture();before=encoded(args)
        first=build_overlay(*args);second=build_overlay(*args)
        self.assertEqual(encoded(first),encoded(second))
        self.assertEqual(encoded(args),before)

    def test_pinned_dictionary_normalizes_script_and_preserves_phrase_exceptions(self):
        base=Path(__file__).resolve().parents[1]/'assets/overlays/localization'
        simplify=make_simplifier(*[(base/name).read_text(encoding='utf8') for name in ['TSPhrases.txt','TSCharacters.txt']])
        self.assertEqual(simplify('北韋索與臺灣'),'北韦索与台湾')
        self.assertEqual(simplify('乾隆'),'乾隆')

    def test_historical_native_names_never_follow_modern_city_renames(self):
        root=Path(__file__).resolve().parents[3]
        reviewed=json.loads((root/'apps/hgo/assets/overlays/localization/reviewed_translations.json').read_bytes())
        rows=[('RUS','Leningrad','Saint Petersburg','圣彼得堡','列宁格勒','RU'),
            ('RUS','Stalingrad','Volgograd','伏尔加格勒','斯大林格勒','RU'),
            ('GER','Königsberg','Kaliningrad','加里宁格勒','柯尼斯堡','DE'),
            ('TUR','Constantinople','Istanbul','伊斯坦布尔','君士坦丁堡','TR'),
            ('RAJ','Madras','Chennai','钦奈','马德拉斯','IN')]
        states=[{'id':i,'name':old,'entityTag':tag,'nameKey':f'STATE_{i}'} for i,(tag,old,*_) in enumerate(rows,1)]
        places=[{'id':f'vp-{s["id"]}','name':s['name'],'stateId':s['id'],'entityTag':s['entityTag']} for s in states]
        cities={'features':[{'properties':{'id':f'city-{i}','name':modern,'name_en':modern,'name_zh':modern_zh,'country_code':code,'aliases':[old]}}
            for i,(_,old,modern,modern_zh,_,code) in enumerate(rows,1)]}
        overlay,_=build_overlay({'states':states,'entities':[]},places,{'id':'hgo','revision':'r1'},{'entries':{}},{},{'entries':[]},cities,reviewed=reviewed)
        for i,(_,_,_,modern_zh,expected,_) in enumerate(rows,1):
            self.assertEqual(overlay['states'][str(i)]['zh'],expected)
            self.assertEqual(overlay['places'][f'vp-{i}']['zh'],expected)
            self.assertNotEqual(overlay['places'][f'vp-{i}']['zh'],modern_zh)

    def test_water_compositions_and_author_translations_keep_provenance(self):
        root=Path(__file__).resolve().parents[3]
        reviewed=json.loads((root/'apps/hgo/assets/overlays/localization/reviewed_translations.json').read_bytes())
        states=[{'id':1,'name':'North Lake Michigan Stage 2 Reclamation Zone','entityTag':'WTR','nameKey':'STATE_1'},
            {'id':2,'name':'STATE_2','entityTag':'WTR','nameKey':'STATE_2'}]
        overlay,report=build_overlay({'states':states,'entities':[]},[],{'id':'hgo','revision':'r1'},{'entries':{}},{},{'entries':[]},{'features':[]},reviewed=reviewed)
        self.assertEqual(overlay['states']['1']['zh'],'密歇根湖北部第2期围垦区')
        self.assertEqual(overlay['states']['1']['sources'][0]['status'],'translation')
        self.assertTrue(overlay['states']['2']['displayFallback'])
        self.assertEqual(report['waterStats']['translated'],1)

    def test_unreviewed_city_aliases_and_airport_codes_do_not_supply_modern_names(self):
        core={'states':[{'id':1,'name':'She','entityTag':'CHI','nameKey':'STATE_1'},
            {'id':2,'name':'Old Unreviewed Name','entityTag':'CHI','nameKey':'STATE_2'}],'entities':[]}
        cities={'features':[{'properties':{'id':'city-1','name':'Shenyang','name_en':'Shenyang','name_zh':'沈阳','country_code':'CN','aliases':['SHE','Old Unreviewed Name']}}]}
        overlay,_=build_overlay(core,[],{'id':'hgo','revision':'r1'},{'entries':{}},{},{'entries':[]},cities)
        self.assertNotIn('zh',overlay['states']['1'])
        self.assertNotIn('zh',overlay['states']['2'])

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
        incomplete=json.loads(json.dumps(review));incomplete['expectedCount']=3
        with self.assertRaisesRegex(ValueError,'Incomplete place review inventory'):
            build_overlay(*args,place_reviews=incomplete)

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
        wrong_state=json.loads(json.dumps(state_reviews));wrong_state['entries'][0]['id']=6
        with self.assertRaisesRegex(ValueError,'Invalid same-name state/place review'):
            build_overlay(*args,place_reviews=place_reviews,state_reviews=wrong_state)
        placeholder={'entries':[{'id':4,'original':'STATE_4','entityTag':'ENG','decision':'accepted','zh':'虚构名',
            'status':'translation','basis':'Unsupported','evidence':[{'key':'test'}]}]}
        with self.assertRaisesRegex(ValueError,'Invalid accepted state review'):
            build_overlay(*args,state_reviews=placeholder)

    def test_committed_overlay_is_reproducible_from_source_files(self):
        root=Path(__file__).resolve().parents[3]
        read=lambda path:json.loads((root/path).read_bytes())
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
        self.assertEqual(len(report['corrections']),3)

    def test_round3_primary_admin_evidence_matches_original_dbf_fields(self):
        root=Path(__file__).resolve().parents[3]
        review=json.loads((root/'apps/hgo/assets/overlays/localization/state_reviews.json').read_bytes())
        entries=[row for row in review['entries'] if row.get('group')=='round3-other-primary-admin']
        self.assertTrue(entries,'The bounded round-three source review is retained')
        archive=next(item for item in review['sourceArchives'] if item['path']=='data/ne_10m_admin_1_states_provinces.zip')
        self.assertEqual(hashlib.sha256((root/archive['path']).read_bytes()).hexdigest(),archive['sha256'])
        with zipfile.ZipFile(root/archive['path']) as source:
            data=source.read(archive['member'])
        count=struct.unpack_from('<I',data,4)[0]
        header,width=struct.unpack_from('<HH',data,8)
        fields=[];offset=1
        for pos in range(32,header-1,32):
            if data[pos]==13:break
            name=data[pos:pos+11].split(b'\0')[0].decode('ascii');size=data[pos+16]
            fields.append((name,offset,size));offset+=size
        records={}
        for start in range(header,header+count*width,width):
            record={name:data[start+off:start+off+size].decode('utf8').strip(' \0') for name,off,size in fields}
            records[record['ne_id']]=record
        for entry in entries:
            sources=[item for item in entry['evidence'] if isinstance(item,dict) and item.get('member')==archive['member']]
            self.assertTrue(sources,entry['id'])
            for source in sources:
                record=records[source['ne_id']]
                for key in ['name','name_en','name_zh','adm1_code','iso_a2']:
                    self.assertEqual(source[key],record[key],(entry['id'],key))
                self.assertIn(normalize(entry['original']),[normalize(record['name']),normalize(record['name_en'])],entry['id'])
        by_id={row['id']:row for row in entries}
        for identity in [7032,7364,994,7001]:
            self.assertEqual(by_id[identity]['decision'],'unresolved','modern identity or damaged Chinese is insufficient')


if __name__=='__main__':
    unittest.main()

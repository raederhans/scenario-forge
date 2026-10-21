#!/usr/bin/env python3
"""Build an ID-bound overlay from repository sources; never alter native assets.

States/places require a country-scoped geographical name. A country scope is a
search constraint, not an assertion about sovereignty or 1936 borders. Ambiguous
translations stay unresolved. Directional microregions use an evidenced base.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re
import unicodedata

# Native entity identities, explicitly constrained to relevant modern search
# territories. Colonial/macro entities may have multiple territories; a name
# must still resolve to one Chinese rendering across the complete scope.
COUNTRY_SCOPES = {
    **dict(pair.split(':') for pair in '''AFG:AF ALB:AL ANG:AO ARG:AR AST:AU AUS:AT
    BAH:BS BAR:BB BEI:BN BEL:BE BER:BM BHR:BH BHU:BT BLR:BY BLZ:BZ BOL:BO BOT:BW BRA:BR BUL:BG
    CAN:CA CAT:ES CAY:GF CHI:CN CHL:CL CMR:CM COL:CO COS:CR CRC:CW CUB:CU CVD:CV CYP:CY
    DEN:DK DJI:DJ DOM:DO ECU:EC EGY:EG ELS:SV ENG:GB EQG:GQ ERI:ER EST:EE ETH:ET
    FIJ:FJ FIN:FI FRA:FR GAM:GM GDL:GP GER:DE GIB:GI GNB:GW GRE:GR GUA:GT GUM:GU GYA:GY
    HAI:HT HKG:HK HOL:NL HON:HN HUN:HU ICE:IS INS:ID IRE:IE IRQ:IQ ITA:IT JAM:JM JAP:JP
    JOR:JO KAZ:KZ KEN:KE KIR:KI KOR:KR KUW:KW KYR:KG LAT:LV LBA:LY LEB:LB LES:LS
    LIB:LR LIE:LI LIT:LT LUX:LU MAD:MG MAL:MY MCO:MC MCU:MO MEX:MX MLD:MV MLT:MT
    MLW:MW MOL:MD MON:MN MOR:MA MRS:MU MTQ:MQ MZB:MZ NAU:NR NCL:NC NEP:NP NFI:NF
    NGA:NG NIC:NI NMB:NA NOR:NO NZL:NZ PAL:PS PAN:PA PAR:PY PER:IR PHI:PH PNG:PG
    POL:PL POR:PT PRU:PE PTC:PN PUE:PR QAT:QA REU:RE ROM:RO RUS:RU SAF:ZA SAM:WS
    SAU:SA SEY:SC SIA:TH SIE:SL SMR:SM SOM:SO SPR:ES SRL:LK SUD:SD SUR:SR SWE:SE
    SWI:CH SWZ:SZ SYR:SY TAJ:TJ TIB:CN TMS:TM TOG:TG TON:TO TRI:TT TUN:TN TUR:TR
    TWN:TW TZN:TZ UGA:UG UKR:UA URG:UY USA:US UZB:UZ VAN:VU VCT:VA VEN:VE
    WAF:WF YEM:YE ZAM:ZM ZIM:ZW ADR:AD ALN:FI ALW:SY CRM:UA DAG:RU BSH:RU
    CVS:RU KAR:RU KMK:RU KPK:UZ MRD:RU TTR:RU UDM:RU YKT:RU TUG:CN TRM:CN
    SHX:CN SIK:CN YUN:CN GXC:CN GND:CN PRC:CN MAN:CN MEN:CN HMI:CN XSM:CN
    NEA:CN NIX:CN NWR:CN EHC:CN HPC:CN SHH:CN SHG:CN HNN:CN KWC:CN KNM:CN
    KRA:KR SRW:MY NBO:MY JOH:MY KED:MY KEL:MY TGA:MY PLS:MY STR:SG
    FAL:FK FAR:FO FND:IN GCO:GH GNH:GH GOA:IN HAW:US HSL:SL IFN:MA IMO:OM
    INI:GF JEB:SY JSY:JE GSY:GG KAS:IN KTR:YE LAQ:YE LYF:YE MHA:YE MNP:IN
    MNX:IM NFL:CA NGL:IN NGU:PG NGW:CN NWA:CN NFT:IN NG1:GL SG1:GL OML:MT
    OMN:OM PCZ:PA RDO:EH RIF:MA SEH:EH SGR:DZ SLB:SJ SKM:IN SML:SO SPM:PM
    STH:SH TAH:PF TAN:RU TGR:MA TNA:KE TPA:IN TVC:IN UYF:YE WVI:VG WTO:TG
    XIG:CN XJK:CN YLN:CN YSH:CN ZAN:TZ ZHJ:CN'''.split()),
    'RAJ':'IN PK BD', 'CZE':'CZ SK', 'YUG':'RS HR SI BA ME MK',
    'INC':'VN LA KH', 'FEA':'TD CF CG GA', 'FWA':'SN ML MR GN CI BF NE BJ',
    'RUU':'RW BI', 'BAS':'AG DM LC VC', 'BSA':'GD VC', 'PAC':'FM MH PW',
    'COG':'CD', 'TSC':'GE AM AZ',
    'PAL':'PS IL', 'CCG':'CN', 'CTU':'CN', 'TVC':'IN', 'DAN':'PL',
}

QUALIFIERS = {'North':'北','South':'南','East':'东','West':'西',
    'Northeast':'东北','Northwest':'西北','Southeast':'东南','Southwest':'西南',
    'Upper':'上','Lower':'下','Inner':'内','Outer':'外','Central':'中部',
    'Greater':'大','Old':'旧','New':'新'}

# Exact, independently corroborated spelling errors only. Never copy a whole
# vanilla tag table: MAN, for example, intentionally differs between mods.
SPELLING_CORRECTIONS = {'GUA':('Guatemla','Guatemala'),
    'VEN':('Venezula','Venezuela'), 'YEM':('Yeman','Yemen')}


def normalize(value):
    value = ''.join(c for c in unicodedata.normalize('NFKD', value) if not unicodedata.combining(c))
    return re.sub(r'[^\w]+', ' ', value.casefold()).strip()


def chinese(value):
    return isinstance(value, str) and bool(re.search(r'[\u3400-\u9fff]', value))


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))+'\n').encode('utf8')


def make_simplifier(*dictionaries):
    """Deterministic longest dictionary phrase, then character, conversion.

    This uses pinned OpenCC t2s data, not the OpenCC runtime/segmenter. First
    dictionary preference wins and first target is the dictionary default.
    """
    mapping={}
    for dictionary in dictionaries:
        for line in dictionary.splitlines():
            if not line or line.startswith('#'): continue
            original,targets=line.split('\t',1)
            mapping.setdefault(original,targets.split(' ')[0])
    maximum=max(map(len,mapping),default=1)
    def simplify(value):
        out=[]; offset=0
        while offset<len(value):
            for length in range(min(maximum,len(value)-offset),0,-1):
                token=value[offset:offset+length]
                if token in mapping:
                    out.append(mapping[token]); offset+=length; break
            else:
                out.append(value[offset]); offset+=1
        return ''.join(out)
    return simplify


def repair_name(original, native):
    """Only use native ID corrections when encoding damage is reproducible."""
    if not native or original == native:
        return original
    if re.fullmatch(r'STATE_\d+|[A-Z0-9]{3}', original):
        return native
    for codec in ('gbk','cp1252','latin1'):
        try:
            if native.encode('utf8').decode(codec) == original:
                return native
        except (UnicodeError, LookupError):
            pass
    return original


def build_overlay(core, places, manifest, catalog, locales, geo, cities, vanilla=None, hierarchy=None, city_aliases=None, simplify=lambda value:value, reviewed=None, marine=None, controls=None, place_reviews=None, state_reviews=None):
    entries = catalog['entries']
    reviewed=reviewed or {}
    # A reviewed source-name translation is deliberately bound to one native
    # place. It must never enter the broad name index or translate its state.
    place_reviews=place_reviews or {}
    if place_reviews.get('dataset') and place_reviews['dataset']!={'id':manifest['id'],'revision':manifest['revision']}:
        raise ValueError('Place review dataset does not match')
    place_by_id={place['id']:place for place in places}
    place_decisions={}
    for row in place_reviews.get('entries',[]):
        identity=row['id']; native=place_by_id.get(identity)
        if identity in place_decisions: raise ValueError(f'Duplicate place review: {identity}')
        if not native or any(row.get(key)!=native.get(source_key) for key,source_key in
            [('original','name'),('stateId','stateId'),('entityTag','entityTag')]):
            raise ValueError(f'Stale place review binding: {identity}')
        if row.get('decision') not in ['accepted','unresolved'] or not row.get('basis') or not row.get('evidence'):
            raise ValueError(f'Incomplete place review: {identity}')
        if row['decision']=='accepted' and (not chinese(row.get('zh')) or row.get('status') not in ['translation','normalization','verified']):
            raise ValueError(f'Invalid accepted place review: {identity}')
        if row['decision']=='unresolved' and (row.get('zh') or not row.get('reason')):
            raise ValueError(f'Invalid unresolved place review: {identity}')
        place_decisions[identity]=row
    if place_reviews.get('expectedCount',len(place_decisions))!=len(place_decisions):
        raise ValueError('Incomplete place review inventory')
    state_reviews=state_reviews or {}
    if state_reviews.get('dataset') and state_reviews['dataset']!={'id':manifest['id'],'revision':manifest['revision']}:
        raise ValueError('State review dataset does not match')
    native_states={state['id']:state for state in core['states']}
    state_decisions={}
    for row in state_reviews.get('entries',[]):
        identity=str(row['id']);native=native_states.get(row['id'])
        if identity in state_decisions: raise ValueError(f'Duplicate state review: {identity}')
        if not native or row.get('original')!=native['name'] or row.get('entityTag')!=native['entityTag']:
            raise ValueError(f'Stale state review binding: {identity}')
        if row.get('decision') not in ['accepted','unresolved'] or not row.get('basis') or not row.get('evidence'):
            raise ValueError(f'Incomplete state review: {identity}')
        if row['decision']=='accepted' and (not chinese(row.get('zh')) or row.get('status') not in ['translation','normalization','verified'] or re.fullmatch(r'STATE_\d+|NAME NEEDED|NameNeeded',native['name'])):
            raise ValueError(f'Invalid accepted state review: {identity}')
        if row.get('placeId'):
            place=place_by_id.get(row['placeId']);approval=place_decisions.get(row['placeId'],{})
            if not place or place['stateId']!=row['id'] or place.get('entityTag')!=row['entityTag'] or normalize(place['name'])!=normalize(row['original']) or approval.get('decision')!='accepted' or approval.get('zh')!=row.get('zh'):
                raise ValueError(f'Invalid same-name state/place review: {identity}')
        if row['decision']=='unresolved' and (row.get('zh') or not row.get('reason')):
            raise ValueError(f'Invalid unresolved state review: {identity}')
        state_decisions[identity]=row
    if state_reviews.get('expectedCount',len(state_decisions))!=len(state_decisions):
        raise ValueError('Incomplete state review inventory')
    scoped_names={(row['entityTag'],normalize(row['en'])):row for row in reviewed.get('scopedNames',[])}
    city_index=defaultdict(lambda:defaultdict(dict))
    city_by_id={}
    approved_aliases={(row['cityId'],normalize(row['en'])) for row in reviewed.get('equivalentCityAliases',[])}
    approved_aliases.update((row['cityId'],normalize(row['original'])) for row in reviewed.get('placeAliases',{}).values())
    def city_alias_allowed(p,name):
        canonical={normalize(p.get(key,'')) for key in ('name','name_en','name_ascii')}
        if normalize(name) in canonical: return True
        # Airport codes and arbitrary alias strings are not native place names.
        if re.fullmatch(r'[A-Z]{3}',name): return False
        identity=p.get('id') or p.get('city_id')
        return (identity,normalize(name)) in approved_aliases
    for feature in cities['features']:
        p=feature['properties']; identity=p.get('id') or p.get('city_id')
        if not identity: continue
        city_by_id[identity]=p
        for name in [p.get(k) for k in ('name','name_en','name_ascii')]+p.get('aliases',[]):
            if name and city_alias_allowed(p,name): city_index[p.get('country_code')][normalize(name)][identity]=p
    control_by_id={p['id']:p for p in (controls or {}).get('controlPoints',[])}
    entities_by_tag={entity['tag']:entity for entity in core['entities']}
    places_by_state=defaultdict(list)
    for place in places: places_by_state[place['stateId']].append(place)

    def city_name(name,codes,place=None):
        candidates={identity:p for code in codes for identity,p in city_index[code].get(normalize(name),{}).items()}
        alias=reviewed.get('placeAliases',{}).get(place.get('id')) if place else None
        if alias and alias['original']==place['name'] and alias['entityTag']==place.get('entityTag') and alias['stateId']==place.get('stateId'):
            p=city_by_id.get(alias['cityId'])
            if p and p.get('country_code')==alias['countryCode'] and chinese(p.get('name_zh')):
                return simplify(p['name_zh']),{'kind':'reviewed-native-city-normalization','key':alias['cityId'],'nativePlaceId':place['id'],'status':'normalization'}
        point=control_by_id.get(place.get('id')) if place else None
        verified_control=False
        if point and point.get('name')==place['name'] and point.get('entityTag')==place.get('entityTag') and point.get('x')==place.get('x') and point.get('y')==place.get('y'):
            p=city_by_id.get(point['cityId'])
            if p and p.get('country_code')==point.get('countryCode'): candidates={point['cityId']:p};verified_control=True
        canonical={identity:p for identity,p in candidates.items() if normalize(name) in {normalize(p.get(k,'')) for k in ('name','name_en','name_ascii')}}
        if len(canonical)==1: candidates=canonical
        if len(candidates)>1 and place and entities_by_tag.get(place.get('entityTag'),{}).get('capitalStateId')==place.get('stateId'):
            capitals={identity:p for identity,p in candidates.items() if p.get('is_country_capital') or p.get('capital_kind')=='country_capital'}
            if len(capitals)==1: candidates=capitals
        if len(candidates)!=1: return None,None
        identity,p=next(iter(candidates.items()));zh=p.get('name_zh')
        if not chinese(zh) or not city_alias_allowed(p,name): return None,None
        return simplify(zh),{'kind':'city-identity','key':identity,'countryCode':p.get('country_code'),
            'nativePlaceId':place['id'] if place else None,'match':'native-control' if verified_control and point.get('cityId')==identity else 'unique-country-city'}

    marine_names={}
    for feature in (marine or {}).get('features',[]):
        p=feature['properties'];en=p.get('name_en') or p.get('name');zh=p.get('name_zh')
        if en and chinese(zh): marine_names[normalize(en)]=(simplify(zh),{'kind':'marine-bilingual','key':p.get('id')})
    for row in reviewed.get('countryReference',{}).get('entries',[]):
        for name in row['names']:
            marine_names.setdefault(normalize(name),(simplify(row['zh']),{'kind':'country-bilingual','key':row['code']}))
    for name,row in reviewed.get('geographicTerms',{}).items():
        marine_names.setdefault(normalize(name),(simplify(row['zh']),{'kind':'reviewed-geographic-translation','key':name,'status':'translation'}))
    directions={**QUALIFIERS,'Northern':'北','Southern':'南','Eastern':'东','Western':'西','Northweast':'西北'}
    def directional(zh,word):
        value=directions[word]
        if word in ['Upper','Lower','Greater','Old','New']: return value+zh
        return zh+({'Inner':'内区','Outer':'外围','Central':'中部'}.get(word,value+'部'))

    def water_name(name,depth=0):
        if depth>8: return None,None
        direct=marine_names.get(normalize(name))
        if direct: return direct
        # Bare dictionary strings here are lexemes in an explicit water-name
        # composition, not joins to an unrelated modern feature identity.
        if name not in {'Georgia','Victoria','Washington','Columbia','Newcastle','Portland','San Juan','Santa Cruz','Santiago'}:
            zh=locales.get(name,{}).get('zh')
            if chinese(zh): return simplify(zh),{'kind':'geographic-lexeme-translation','key':name,'status':'translation'}
        patterns=[(r'(.+) (?:Stage|Phase) (\d+) Reclamation Zone',lambda z,m:f'{z}第{m[2]}期围垦区'),
            (r'(.+) Reclamation Zone',lambda z,m:z+'围垦区'),(r'(.+) Atlantropa Zone',lambda z,m:z+'（亚特兰特罗帕区）'),
            (r'(.+) Atlantropa Canal Site',lambda z,m:z+'亚特兰特罗帕运河拟建点'),
            (r'(.+) Dam Site',lambda z,m:z+'水坝拟建点'),(r'(.+) Landbridge(?: Site)?',lambda z,m:z+'陆桥拟建点'),
            (r'(.+) Canal Site',lambda z,m:z+'运河拟建点'),(r'(.+) (\d{4})',lambda z,m:f'{z}（{m[2]}年）'),
            (r'(.+) Coast',lambda z,m:z+'沿岸'),(r'(.+) Mouth',lambda z,m:z+'口'),(r'(.+) Border',lambda z,m:z+'边界'),
            (r'(.+) Basin',lambda z,m:z+'盆地'),(r'(.+) Stage (\d+)',lambda z,m:f'{z}第{m[2]}期'),
            (r'(.+) Island (\d+)',lambda z,m:f'{z}{m[2]}号岛')]
        for pattern,compose in patterns:
            match=re.fullmatch(pattern,name)
            if match:
                zh,source=water_name(match[1],depth+1)
                if zh: return compose(zh,match),{'kind':'marine-composition-translation','rule':pattern,'source':source,'status':'translation'}
        if ' ' in name:
            word,suffix=name.split(' ',1)
            if word in directions:
                zh,source=water_name(suffix,depth+1)
                if zh:return directional(zh,word),{'kind':'marine-direction-translation','qualifier':word,'source':source,'status':'translation'}
            for prefix in sorted(reviewed.get('geographicTerms',{}),key=len,reverse=True):
                if name.startswith(prefix+' '):
                    zh,source=water_name(name[len(prefix)+1:],depth+1)
                    if zh:return reviewed['geographicTerms'][prefix]['zh']+zh,{'kind':'marine-adjective-translation','prefix':prefix,'source':source,'status':'translation'}
        return None,None
    index = defaultdict(lambda: defaultdict(dict))
    def add(code, names, zh, source,city=None):
        if not chinese(zh):
            return
        zh=simplify(zh)
        for name in names:
            if name and (city is None or city_alias_allowed(city,name)):
                index[code][normalize(name)][zh] = source
    # Prefer explicitly qualified translations; unqualified dictionary entries
    # are used only after a source feature has established country identity.
    for feature in geo['entries']:
        code, name = feature['country_code'], feature['primary_name']
        names = list(dict.fromkeys([name]+feature.get('aliases',[])))
        value = locales.get(f'{name} ({code})', locales.get(name, {})).get('zh')
        add(code, names, value, {'kind':'geo-alias','key':feature['stable_key'],
            'localeKey':f'{name} ({code})' if f'{name} ({code})' in locales else name})
    for feature in cities['features']:
        p = feature['properties']
        add(p.get('country_code'), [p.get(k) for k in ('name','name_en','name_ascii')]+p.get('aliases',[]),
            p.get('name_zh'), {'kind':'world-city','key':p.get('id')},p)
    for p in (city_aliases or {}).get('entries',[]):
        add(p.get('country_code'),p.get('aliases',[])+[p.get('primary_name')],p.get('name_zh'),
            {'kind':'city-alias','key':p['stable_key']},p)
    for identity,label in (hierarchy or {}).get('labels',{}).items():
        match=re.match(r'^([A-Z]{2})_(.+)',identity)
        if not match: continue
        code,slug=match.groups()
        value=locales.get(f'{label} ({code})',locales.get(label,{})).get('zh')
        names=[label,slug.replace('_',' ')]
        short=re.sub(r' (?:Autonomous Region|Autonomous Republic|Province|Municipality|Region|Republic|District|Krai|Oblast)$','',label)
        if short!=label: names.append(short)
        add(code,names,value,{'kind':'hierarchy-admin','key':identity,'localeKey':label})

    def lookup(name, codes,tag=None):
        scoped=scoped_names.get((tag,normalize(name)))
        if scoped:return scoped['zh'],{'kind':'reviewed-historical-translation','key':f'{tag}:{name}','status':'translation','basis':scoped['basis']}
        hits = {}
        for code in codes:
            hits.update(index[code].get(normalize(name), {}))
            qualified = f'{name} ({code})'
            zh = locales.get(qualified, {}).get('zh')
            if chinese(zh):
                hits[simplify(zh)] = {'kind':'qualified-locale','key':qualified}
        if len(hits)==1:return next(iter(hits)),next(iter(hits.values()))
        # A city and an administrative feature can share a name in one country.
        # Do not resolve that conflict by silently preferring the city.
        return city_name(name,codes) if not hits else (None,None)

    def translate(name, codes,tag=None):
        zh, source = lookup(name, codes,tag)
        if zh:
            return zh, source
        parts, suffix = [], name
        while ' ' in suffix and suffix.split(' ',1)[0] in QUALIFIERS:
            word, suffix = suffix.split(' ',1)
            parts.append(word)
            zh, source = lookup(suffix, codes,tag)
            if zh:
                # In source order: North Inner X -> 北内X. Explicitly recorded
                # as a rule-derived translation rather than native Chinese.
                translated=zh
                for part in reversed(parts): translated=directional(translated,part)
                return translated, {
                    'kind':'direction-rule','qualifiers':parts,'base':suffix,'source':source,'status':'translation'}
        return None, None

    tables = {'states':{}, 'entities':{}, 'places':{}}
    unresolved = {table:[] for table in tables}
    corrections = []
    counts = Counter()
    state_by_id = {s['id']:s for s in core['states']}
    for table, sources in [('entities',core['entities']),('states',core['states']),('places',places)]:
        for source in sources:
            identity = str(source['tag'] if table=='entities' else source['id'])
            original = source['name']
            native_key = source.get('nameKey') if table=='states' else source.get('tag') if table=='entities' else None
            native = entries.get(native_key, {}).get('names',{}).get('en')
            name = repair_name(original, native)
            evidence = []
            spelling = SPELLING_CORRECTIONS.get(identity) if table=='entities' else None
            if spelling and original==spelling[0] and (vanilla or {}).get('entries',{}).get(identity,{}).get('localized_name')==spelling[1]:
                name=spelling[1]
                evidence.append({'kind':'corroborated-spelling','key':identity,
                    'source':'data/palettes/hoi4_vanilla.palette.json'})
            if name != original:
                corrections.append({'table':table,'id':identity,'original':original,'en':name,'nativeKey':native_key})
                if not evidence: evidence.append({'kind':'native-id-encoding-repair','key':native_key})
            if table=='entities':
                zh = locales.get(name,{}).get('zh')
                origin = {'kind':'native-entity-locale','key':name,'nativeKey':native_key} if chinese(zh) else None
                zh = zh if origin else None
                if not zh:
                    zh,origin=translate(name,COUNTRY_SCOPES.get(identity,'').split(),identity)
                review=reviewed.get('entities',{}).get(identity)
                if review and review['original']==original:
                    zh,origin=review['zh'],{'kind':'reviewed-entity-translation','key':identity,'status':review['status'],'reference':review.get('reference',review['basis'])}
            else:
                tag = source.get('entityTag') or state_by_id[source['stateId']]['entityTag']
                codes = COUNTRY_SCOPES.get(tag,'').split()
                # Independent core claims give useful geographic scope for
                # Indian princely states, without guessing arbitrary tags.
                if not codes and table=='states' and 'RAJ' in source.get('coreTags',[]):
                    codes = ['IN','PK','BD']
                if not codes and table=='places':
                    state = state_by_id[source['stateId']]
                    if 'RAJ' in state.get('coreTags',[]): codes = ['IN','PK','BD']
                zh, origin = translate(name,codes,tag)
                if table=='places':
                    city_zh,city_source=city_name(name,codes,source)
                    if city_zh and (not zh or origin.get('kind') in ['qualified-locale','geo-alias','city-identity']): zh,origin=city_zh,city_source
                elif not zh:
                    native_matches=[place for place in places_by_state[source['id']] if normalize(place['name'])==normalize(name)]
                    if len(native_matches)==1: zh,origin=city_name(name,codes,native_matches[0])
                if not zh:
                    other_codes=sorted({code for core_tag in state_by_id[source['id'] if table=='states' else source['stateId']].get('coreTags',[]) for code in COUNTRY_SCOPES.get(core_tag,'').split()}-set(codes))
                    if other_codes:
                        zh,origin=translate(name,other_codes,tag)
                        if zh: origin={**origin,'nativeCoreCountryScope':other_codes}
                scoped=scoped_names.get((tag,normalize(name)))
                if scoped:
                    zh,origin=scoped['zh'],{'kind':'reviewed-historical-translation','key':f'{tag}:{name}','status':'translation','basis':scoped['basis']}
                if tag=='WTR': zh,origin=water_name(name)
            decision=place_decisions.get(identity) if table=='places' else None
            if decision:
                zh=decision.get('zh') if decision['decision']=='accepted' else None
                origin={'kind':'reviewed-native-place','key':identity,'decision':decision['decision'],
                    'status':decision.get('status','unresolved'),'basis':decision['basis'],'evidence':decision['evidence']}
                if not zh: evidence.append(origin)
            state_decision=state_decisions.get(identity) if table=='states' else None
            if state_decision:
                zh=state_decision.get('zh') if state_decision['decision']=='accepted' else None
                origin={'kind':'reviewed-native-state','key':identity,'decision':state_decision['decision'],
                    'status':state_decision.get('status','unresolved'),'basis':state_decision['basis'],'evidence':state_decision['evidence']}
                if not zh:evidence.append(origin)
            entry = {'en':name,'original':original}
            placeholder = ((table=='states' and bool(re.fullmatch(r'STATE_\d+|NAME NEEDED|NameNeeded',original))) or (table=='places' and bool(re.fullmatch(r'VICTORY_POINTS_\d+',original)))) and name==original
            if placeholder:
                if table=='states': entry.update(en=f'Unnamed state #{identity}',zh=f'未命名州 #{identity}')
                else:
                    label_id=source.get('provinceId',identity)
                    entry.update(en=f'Unnamed place #{label_id}',zh=f'未命名地点 #{label_id}')
                entry.update(aliases=[original],displayFallback=True)
                evidence.append({'kind':'explicit-missing-name','key':source.get('nameKey')})
            if zh:
                entry['zh'] = simplify(zh)
                evidence.append(origin)
                counts[f'{table}:{origin["kind"]}'] += 1
            else:
                unresolved[table].append(identity)
            if name != original:
                entry['aliases'] = [original]
            if evidence: entry['sources'] = evidence
            tables[table][identity] = entry
    stats = {table:{'total':len(tables[table]),'translated':len(tables[table])-len(unresolved[table]),
        'untranslated':len(unresolved[table]),'displayFallbacks':sum(bool(e.get('displayFallback')) for e in tables[table].values())} for table in tables}
    overlay = {'format':'hgo-native-localization','schemaVersion':1,
        'dataset':{'id':manifest['id'],'revision':manifest['revision']}, **tables,
        'stats':stats}
    report = {'schemaVersion':1, 'policy':{
        'identity':'native state/entity/place IDs; dataset revision unchanged',
        'geographicMatching':'country-scoped aliases and cities, never global same-name matching',
        'ambiguity':'keep original English when no unique evidenced Chinese translation exists',
        'directionRules':QUALIFIERS,'countryScopes':COUNTRY_SCOPES,
        'chineseNormalization':'Pinned OpenCC ver.1.1.9 TSPhrases/TSCharacters; longest phrase then character; first target',
        'countryScopeMeaning':'modern search territory only; not ownership or border claims'},
        'stats':stats,'translationMethods':dict(sorted(counts.items())),
        'corrections':corrections,'unresolvedIds':unresolved,
        'unresolvedPlaceholders':[s['id'] for s in core['states'] if re.fullmatch(r'STATE_\d+', s['name'])],
        'unnamedStateIds':[int(identity) for identity,value in tables['states'].items() if value.get('displayFallback')],
        'qualityBaseline':reviewed.get('baseline'),
        'translationStatusPolicy':'Repository bilingual records identify their source. reviewed-entity/historical/geographic and marine/direction compositions are translations, not externally verified facts.',
        'cityAliasPolicy':'Only canonical source names and explicitly reviewed language-equivalent aliases supply Chinese. Historical city identity alone cannot substitute a modern Chinese name. Three-letter airport codes are excluded.',
        'placeReviewSummary':{'total':len(place_decisions),
            'accepted':sum(row['decision']=='accepted' for row in place_decisions.values()),
            'unresolved':sum(row['decision']=='unresolved' for row in place_decisions.values())},
        'placeReviewPolicy':'ID/original/state/entity-bound decisions override automatic candidates only for that place. Accept existing Chinese source-name forms or sourced word composition. An identity/control point alone is insufficient. verified denotes a direct Chinese source record, not official standardization. Unresolved decisions retain the original.',
        'placeReviewUnresolvedReasons':dict(sorted(Counter(row['reason'] for row in place_decisions.values() if row['decision']=='unresolved').items())),
        'stateReviewSummary':{'total':len(state_decisions),
            'accepted':sum(row['decision']=='accepted' for row in state_decisions.values()),
            'unresolved':sum(row['decision']=='unresolved' for row in state_decisions.values())},
        'stateReviewPolicy':'Selected named native states only, ID/original/entity-bound. Same-name places require the same native state and entity. Regional/longitude compositions retain the source qualifiers; they do not validate the source geography, borders or ownership. The remaining baseline inventory is not claimed to be manually reviewed.',
        'stateReviewUnresolvedReasons':dict(sorted(Counter(row['reason'] for row in state_decisions.values() if row['decision']=='unresolved').items())),
        'waterStats':{'total':sum(s['entityTag']=='WTR' for s in core['states']),
            'translated':sum(s['entityTag']=='WTR' and 'zh' in tables['states'][str(s['id'])] and not tables['states'][str(s['id'])].get('displayFallback') for s in core['states'])}}
    return overlay, report


def build(root, output):
    root, output = Path(root), Path(output)
    source_paths = {
        'core':'apps/hgo/assets/default/core.json','manifest':'apps/hgo/assets/default/manifest.json',
        'places':'apps/hgo/assets/default/places.json','catalog':'data/hgo_catalogs/hgo_place_names.json',
        'locales':'data/locales.json','geo':'data/geo_aliases.json','cities':'data/world_cities.geojson',
        'vanilla':'data/palettes/hoi4_vanilla.palette.json','hierarchy':'data/hierarchy.json',
        'cityAliases':'data/city_aliases.json',
        'reviewed':'apps/hgo/assets/overlays/localization/reviewed_translations.json',
        'placeReviews':'apps/hgo/assets/overlays/localization/place_reviews.json',
        'stateReviews':'apps/hgo/assets/overlays/localization/state_reviews.json',
        'marineRefined':'data/marine_regions.refined.source.geojson','marineAdditional':'data/marine_regions.additional.source.geojson',
        'controls':'apps/hgo/assets/overlays/geography/georeference.json'}
    raw = {key:(root/path).read_bytes() for key,path in source_paths.items()}
    data = {key:json.loads(value) for key,value in raw.items()}
    dictionary_root=root/'apps/hgo/assets/overlays/localization'
    dictionaries={name:(dictionary_root/name).read_bytes() for name in ['TSPhrases.txt','TSCharacters.txt']}
    simplify=make_simplifier(*(value.decode('utf8') for value in dictionaries.values()))
    country_ref=data['reviewed']['countryReference']
    country_bytes=(root/country_ref['path']).read_bytes()
    if hashlib.sha256(country_bytes).hexdigest()!=country_ref['sha256']: raise ValueError('Reviewed country reference changed')
    for reference in data['stateReviews'].get('sourceArchives',[]):
        if hashlib.sha256((root/reference['path']).read_bytes()).hexdigest()!=reference['sha256']:
            raise ValueError(f'Reviewed state reference changed: {reference["path"]}')
    marine={'features':data['marineRefined']['features']+data['marineAdditional']['features']}
    overlay, report = build_overlay(data['core'],data['places']['places'],data['manifest'],data['catalog'],
        data['locales']['geo'],data['geo'],data['cities'],data['vanilla'],data['hierarchy'],data['cityAliases'],simplify,
        data['reviewed'],marine,data['controls'],data['placeReviews'],data['stateReviews'])
    report['sources'] = [{'path':path,'sha256':hashlib.sha256(raw[key]).hexdigest()}
        for key,path in source_paths.items()]
    report['sources'].append({'path':country_ref['path'],'sha256':country_ref['sha256'],'member':country_ref['member'],'fields':country_ref['fields']})
    report['sources'].extend(data['stateReviews'].get('sourceArchives',[]))
    report['normalizationSources']=[{'path':f'apps/hgo/assets/overlays/localization/{name}',
        'url':f'https://raw.githubusercontent.com/BYVoid/OpenCC/ver.1.1.9/data/dictionary/{name}',
        'sha256':hashlib.sha256(value).hexdigest(),'license':'Apache-2.0 (OPENCC-LICENSE.txt)'}
        for name,value in dictionaries.items()]
    output.mkdir(parents=True,exist_ok=True)
    (output/'index.json').write_bytes(encoded(overlay))
    (output/'provenance.json').write_bytes(encoded(report))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[3])
    parser.add_argument('--output',type=Path)
    args = parser.parse_args()
    report = build(args.root,args.output or args.root/'apps/hgo/assets/overlays/localization')
    print(json.dumps({'stats':report['stats'],'corrections':len(report['corrections']),
        'unresolvedPlaceholders':len(report['unresolvedPlaceholders'])},ensure_ascii=False))

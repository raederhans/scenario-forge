from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from shapely import STRtree
from shapely.geometry import GeometryCollection, shape
from shapely.ops import transform

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools import build_tno_district_groups as districts
from tools import tno_1962_registration as registration
from tools.scenario_topology_decode import topology_object_to_geojson

SCENARIO = ROOT / 'data/scenarios/tno_1962'
REPORT = ROOT / '.runtime/reports/generated/tno_state_districts.json'
BASE_LOCALISATION = Path('C:/Program Files (x86)/Steam/steamapps/common/Hearts of Iron IV/localisation')
MANUAL_TAGS = frozenset('GER RKP RKN RKNO ITA FRA IBR ENG USA CHI CAN MEX NCP AZH TUR JAP MAN RAJ KOR RKU RKM RKK GEA GCO ANG ATL RGC SHX YUN GNG GXC GUZ GMA QMA XIN MEN ROM'.split())
TRANSLATIONS = {
    'Abidjan': '阿比让', 'Abuja': '阿布贾', 'Abyan': '阿比扬', 'Abéché': '阿贝歇',
    'Accra': '阿克拉', 'Aconcagua': '阿空加瓜', 'Ad Dakhiliyah': '内地省',
    'Akmola': '阿克莫拉', 'Aktobe': '阿克托别', 'Al Batinah': '巴提奈',
    'Al Mahrah': '马哈拉', 'Al Wusta': '中部省', 'Al-Bahah': '巴哈',
    'Al-Buraimi': '布赖米', 'Al-Dhahirah': '扎希拉', 'Al-Diwaniyah': '迪瓦尼耶',
    'Al-Jawf': '焦夫', 'Al-Qasim': '卡西姆', 'Aldan': '阿尔丹',
    'Alekseevka': '阿列克谢耶夫卡', 'Almaty': '阿拉木图', 'Am Timan': '安提曼',
    'Amarah': '阿马拉', 'Amazonas, Colombia': '哥伦比亚亚马孙',
    'Amazonas, Peru': '秘鲁亚马孙', 'Amazonas, Venezuela': '委内瑞拉亚马孙',
    'Ambovombe': '安博文贝', 'An Giang': '安江', 'Ancash': '安卡什',
    'Antioquia': '安蒂奥基亚', 'Antrim': '安特里姆', 'Antsiranana': '安齐拉纳纳',
    'Anzoátegui': '安索阿特吉', 'Apure and Barinas': '阿普雷与巴里纳斯',
    'Apurímac': '阿普里马克', 'Aragua and Caraboro': '阿拉瓜与卡拉沃沃',
    'Arauca': '阿劳卡', 'Ardennen-Maas': '阿登—马斯',
    'Argentine Tierra del Fuego': '阿根廷火地岛', 'Argyll and Bute': '阿盖尔与比特',
    'Arica': '阿里卡', 'As-Suwayda': '苏韦达', 'Ash Sharqiyah': '东部省',
    'Ashanti': '阿散蒂', 'Asir': '阿西尔', 'Atyrau': '阿特劳', 'Aussa': '奥萨',
    'Ayacucho': '阿亚库乔', 'Ayutthaya': '大城', 'Badakhshan': '巴达赫尚',
    'Badghis': '巴德吉斯', 'Baghlan': '巴格兰', 'Bagmati': '巴格马蒂',
    'Bahr el Ghazal': '加扎勒河', 'Bakhta': '巴赫塔', 'Bakhtaran': '巴赫塔兰',
    'Ballou': '巴卢（Ballou）', 'Balqa': '拜勒加', 'Balta': '巴尔塔',
    'Baluchistan and Sistan': '俾路支斯坦与锡斯坦', 'Bamenda': '巴门达',
    'Bamingui-Bangoran': '巴明吉—班戈兰', 'Bangka Belitung Islands': '邦加勿里洞群岛',
    'Bangkok': '曼谷', 'Baranja': '巴拉尼亚', 'Bardaï': '巴尔代',
    'Barnaul': '巴尔瑙尔', 'Batna': '巴特纳', 'Bayankhongor-Khangai': '巴彦洪戈尔—杭爱',
    'Beirut': '贝鲁特', 'Belize City': '伯利兹城', 'Beloretsk': '别洛列茨克',
    'Ben Tre': '槟椥', 'Berezivka': '别列济夫卡', 'Biafra': '比夫拉',
    'Bicol': '比科尔', 'Bien Hoa': '边和', 'Binh Thuan': '平顺',
    'Biobío': '比奥比奥', 'Bismarck Archipelago': '俾斯麦群岛',
    'Bitola': '比托拉', 'Bizerte': '比塞大', 'Blekinge': '布莱金厄',
    'Bobo-Dioulasso': '博博迪乌拉索', 'Boeotia-Aetolia': '维奥蒂亚—埃托利亚',
    'Bogotá': '波哥大', 'Boguchany': '博古恰内', 'Bohicon': '博希康',
    'Bolaang Mongondow': '博朗蒙贡多', 'Bolívar': '玻利瓦尔',
    'Bolívar, Colombia': '哥伦比亚玻利瓦尔', 'Boquerón': '博克龙', 'Borgou': '博尔古',
    'Bosnian Posavina': '波斯尼亚波萨维纳', 'Boyacá': '博亚卡',
    'Brak': '布拉克', 'Brakna': '卜拉克纳', 'Brasília': '巴西利亚',
    'Bratislava': '布拉迪斯拉发', 'Bulgan-Selenga': '布尔干—色楞格',
    'Buriram': '武里南', 'Béja': '贝贾', 'Bône': '博纳',
    'Caaguazú': '卡瓜苏', 'Cagayan Valley': '卡加延河谷', 'Cajamarca': '卡哈马卡',
    'Caldas': '卡尔达斯', 'Can Tho': '芹苴', 'Cao Bang': '高平', 'Caquetá': '卡克塔',
    'Casamance': '卡萨芒斯', 'Catamarca': '卡塔马卡', 'Center': '中部',
    'Central Finland': '中芬兰', 'Central Highlands': '中部高地',
    'Central Kalimantan': '中加里曼丹', 'Central Khorasan': '中呼罗珊',
    'Central Luzon': '中央吕宋', 'Central Province': '中央省',
    'Central Serbia': '中塞尔维亚', 'Central Visayas': '中米沙鄢',
    'Central Welsh Counties': '威尔士中部诸郡', 'Centre and Nord-Est': '中央与东北',
    'Cetinje': '采蒂涅', 'Chachoengsao': '北柳', 'Chaco': '查科',
    'Chaharmahal and Bakhtiari': '恰哈马哈勒和巴赫蒂亚里', 'Changtang': '羌塘',
    'Cheboksary': '切博克萨雷', 'Chiang Mai': '清迈', 'Chin': '钦', 'Chocó': '乔科',
    'Chonburi': '春武里', 'Chumphon': '春蓬', 'Cibao Nordeste': '锡瓦奥东北部',
    'Cibao Norte': '锡瓦奥北部', 'Cibao Sur': '锡瓦奥南部',
    'Coastal Plain': '沿海平原', 'Cochabamba': '科恰班巴',
    'Cojedes and Portuguesa': '科赫德斯与波图格萨',
    "Colchagua and O'Higgins": '科尔查瓜与奥希金斯', 'Colomb-Béchar': '科隆贝沙尔',
    'Conakry': '科纳克里', 'Concepción': '康塞普西翁', 'Copenhagen': '哥本哈根',
    'Coquimbo': '科金博', 'Cordillera': '科迪勒拉', 'Cork': '科克',
    'Coronel Portillo': '科罗内尔波蒂略', 'Corrientes': '科连特斯',
    'Cotabato': '哥打巴托', 'Cuzco': '库斯科', 'Córdoba, Colombia': '哥伦比亚科尔多瓦',
    'Dagomba': '达贡巴', 'Dak Lak': '多乐', 'Dakahlia': '代盖赫利耶', 'Dakar': '达喀尔',
    'Daraa': '德拉', 'Deir ez-Zor': '代尔祖尔', 'Delta Amacuro': '阿马库罗三角洲',
    'Denkalya': '登卡利亚', 'Dhamar': '扎马尔', 'Diyala': '迪亚拉', 'Djanet': '贾奈特',
    'Djibouti': '吉布提', 'Dniester Hills': '德涅斯特丘陵', 'Doti': '多蒂',
    'Down': '唐', 'Drina Valley': '德里纳河谷', 'Dubai': '迪拜',
    'E. Macedonia and W. Thrace': '东马其顿与西色雷斯', 'East': '东部',
    'East Jutland': '东日德兰', 'East Thrace': '东色雷斯', 'Eastern Cape': '东开普',
    'Eastern Equatoria': '东赤道', 'Eastern Karelia': '东卡累利阿',
    'Eastern Madagascar': '东马达加斯加', 'Eastern Province': '东部省',
    'Eastern Transvaal': '东德兰士瓦', 'Elbasan': '爱尔巴桑', 'Erbil': '埃尔比勒',
    'Eritrean Lowlands': '厄立特里亚低地', 'Espiríto Santo': '圣埃斯皮里图',
    'Essequibo': '埃塞奎博', 'Fada': '法达', 'Falcón': '法尔孔', 'Farafagana': '法拉凡加纳',
    'Faryab': '法里亚布', 'Fejér': '费耶尔', 'Ferdinand': '斐迪南',
    'Fergana Valley': '费尔干纳盆地', 'Fernando Pó': '费尔南多波岛', 'Fez': '非斯',
    'Francistown': '弗朗西斯敦', 'Freigrafschaft': '弗朗什孔泰', 'Fujairah': '富查伊拉',
    'Fuliang': '浮梁', 'Funen': '菲英岛', 'Galápagos Islands': '加拉帕戈斯群岛',
    'Gambela': '甘贝拉', 'Gaza': '加沙', 'Ghanzi': '杭济', 'Gharbia': '西部省',
    'Ghardaïa': '盖尔达耶', 'Ghat': '加特', 'Ghazni': '加兹尼', 'Ghor': '古尔',
    'Gitlerhaym': '希特勒海姆（Gitlerhaym）', 'Gjirokaster': '吉诺卡斯特',
    'Gorgan': '戈尔甘', 'Gorgol': '戈尔戈勒', 'Gorno-Badakhshan': '戈尔诺—巴达赫尚',
    'Gorontalo': '哥伦打洛', 'Grampian Counties': '格兰扁诸郡',
    'Greater Manila': '大马尼拉', 'Greater Montevideo': '大蒙得维的亚',
    'Guayaquil': '瓜亚基尔', 'Guidimaka': '吉迪马卡', 'Guyana': '圭亚那',
    'Guárico': '瓜里科', 'Ha Bac': '河北', 'Ha Tinh': '河静', "Ha'il": '哈伊勒',
    'Hadramaut': '哈德拉毛', 'Hailanpao': '海兰泡', 'Haiphong': '海防', 'Hajjah': '哈杰',
    'Halland': '哈兰', 'Hanoi': '河内', 'Harar': '哈勒尔', 'Helmand': '赫尔曼德',
    'Highlander Counties': '高地诸郡', 'Hillah': '希拉', 'Homs': '霍姆斯',
    'Houa Khong': '上孔（Houa Khong）', 'Houaphanh': '华潘', 'Hron': '赫龙河',
    'Huancavelica': '万卡韦利卡', 'Huila': '乌伊拉', 'Hun': '洪', 'Huánuco': '瓦努科',
    'Ibadan': '伊巴丹', 'Ibb': '伊卜', 'Ica': '伊卡', 'Ilocos': '伊罗戈',
    'Interior Kalimantan': '加里曼丹内陆', 'Irbid': '伊尔比德', 'Isaaq': '伊萨克',
    'Issyk-Kul': '伊塞克湖', 'Itapúa': '伊塔普阿', 'Ivanjica': '伊瓦尼察',
    'Ivashchenkovo': '伊瓦先科沃', 'Izhevsk': '伊热夫斯克', 'Jabal Amil': '阿米勒山',
    'Jalingo': '贾林戈', 'Jammu': '查谟', 'Jianyang': '建阳', 'Jizan': '吉赞',
    'Jonglei': '琼莱', 'Jowzjan': '朱兹詹', 'Jujuy': '胡胡伊', 'Junín': '胡宁',
    'Jönköping': '延雪平', 'Kairouan': '凯鲁万', 'Kalen': '卡伦（Kalen）',
    'Kalmar': '卡尔马', 'Kampong Cham': '磅湛', 'Kampong Chhnang': '磅清扬',
    'Kampot': '贡布', 'Kanchanaburi': '北碧', 'Kandi': '坎迪', 'Kandreho': '坎德雷胡',
    'Kanem': '加奈姆', 'Kangding': '康定', 'Kano': '卡诺', 'Kansk': '坎斯克',
    'Karaganda': '卡拉干达', 'Karak': '卡拉克', 'Karbala': '卡尔巴拉',
    'Kardzhali': '克尔贾利', 'Karen': '克伦', 'Kayah': '克耶', 'Kedah': '吉打',
    'Kelantan': '吉兰丹', 'Kemerovo': '克麦罗沃', 'Kgalagadi': '卡拉哈迪',
    'Khammouane': '甘蒙', 'Khanty-Mansiysk': '汉特—曼西斯克',
    'Khentii-Sükhbaatar-Dornod': '肯特—苏赫巴托尔—东方', 'Khilok': '希洛克',
    'Kirkuk': '基尔库克', 'Kisumu': '基苏木',
    'Kohgiluyeh and Boyer-Ahmad': '科吉卢耶和博韦艾哈迈德',
    'Kolpashevo': '科尔帕舍沃', 'Kong': '孔', 'Kopparberg': '科帕尔贝里',
    'Kordun and Banovina': '科尔敦与巴诺维纳', 'Kostroma': '科斯特罗马',
    'Kratié': '桔井', 'Krim': '克里米亚', 'Kronoberg': '克鲁努贝里', 'Kru': '克鲁',
    'Kudymkar': '库德姆卡尔', 'Kurgan': '库尔干', 'Kut': '库特', 'Kyzylorda': '克孜勒奥尔达',
    'La Guajira': '瓜希拉', 'La Pampa': '拉潘帕', 'La Rioja': '拉里奥哈',
    'Lahij': '拉赫季', 'Lakes': '湖泊州', 'Lam Dong': '林同', 'Lambayeque': '兰巴耶克',
    'Lampang': '南邦', 'Lanao': '拉瑙', 'Lang Son': '谅山', 'Lapland': '拉普兰',
    'Lara and Yaracuy': '拉腊与亚拉奎', 'Lashio': '腊戍', 'Lesosibirsk': '列索西比尔斯克',
    'Levantine Tripoli': '黎凡特的黎波里', 'Lhasa': '拉萨', 'Lhokha': '山南',
    'Lima Province': '利马省', 'Llanquihue': '延基韦', 'Lorestan': '洛雷斯坦',
    'Lothian Counties': '洛锡安诸郡', 'Lower Red Sea': '下红海', 'Luang Prabang': '琅勃拉邦',
    "Ma'an": '马安', 'Madre de Dios': '马德雷德迪奥斯', 'Magdalena': '马格达莱纳',
    'Magway': '马圭', 'Maiduguri': '迈杜古里', 'Majdal': '迈季代勒',
    'Majeerteen': '马杰尔廷', 'Makurdi': '马库尔迪', 'Mamuju': '马穆朱', 'Man': '马恩',
    'Manturovo': '曼图罗沃', 'Marib': '马里卜', 'Markazi': '中央省',
    'Markounda': '马尔昆达', 'Maroua': '马鲁阿', 'Marrakesh': '马拉喀什',
    'Mazandaran': '马赞德兰', 'Me Tog': '墨脱', 'Mecca': '麦加', 'Mechi': '梅吉',
    'Medina': '麦地那', 'Meknes': '梅克内斯', 'Melaky': '梅拉基', 'Merowe': '麦罗维',
    'Mezen': '梅津', 'Mianning': '冕宁', 'Mien Tay': '西部地区', 'Mikun': '米昆',
    'Miranda and the Federal District': '米兰达与联邦区', 'Misiones': '米西奥内斯',
    'Misiones Occidentales': '西米西奥内斯', 'Miskolc': '米什科尔茨', 'Misrata': '米苏拉塔',
    'Mohyliv': '莫希利夫', 'Mon': '孟', 'Monagas': '莫纳加斯', 'Mono': '莫诺',
    'Monrovia': '蒙罗维亚', 'Moquegua': '莫克瓜', 'Morava Valley': '摩拉瓦河谷',
    'Morobe': '莫罗贝', 'Mostaganem': '穆斯塔加奈姆', 'Mount Lebanon': '黎巴嫩山',
    'Mudug': '穆杜格', 'Murzuk-Al Jawf': '迈尔祖格—焦夫', 'Muurmanni': '摩尔曼斯克',
    'Médéa': '麦迪亚', 'Mérida and Táchira': '梅里达与塔奇拉',
    'Naberezhnye Chelny': '纳别列日内切尔尼', 'Nabeul': '纳布勒', 'Najran': '奈季兰',
    'Nakchu': '那曲', 'Nakhchivan': '纳希切万', 'Nakhon Ratchasima': '呵叻',
    'Nakhon Sawan': '北榄坡', 'Nam Dinh': '南定', 'Nangarhar': '楠格哈尔',
    'Narathiwat': '陶公', 'Naryan-Mar': '纳里扬马尔', 'Nasiriyah': '纳西里耶',
    'Negeri Sembilan': '森美兰', 'Neuquén': '内乌肯', 'New Valley': '新河谷',
    'Ngamiland': '恩加米兰', 'Ngaoundéré': '恩冈代雷', 'Nijamina': '恩贾梅纳',
    'Nimruz': '尼姆鲁兹', 'Nitra': '尼特拉', 'Nord': '北部',
    'Nord-Ouest and Artibonite': '西北与阿蒂博尼特', 'North Central Province': '北中省',
    'North Island': '北岛', 'North Jutland': '北日德兰', 'North Kordofan': '北科尔多凡',
    'North Moluccas': '北摩鹿加', 'North West': '西北', 'North Western Province': '西北省',
    'Northeast': '东北', 'Northern Borders Province': '北部边疆省',
    'Northern Buryatia': '北布里亚特', 'Northern Croatia': '北克罗地亚',
    'Northern Desert': '北部沙漠', 'Northern Great Plain': '北大平原',
    'Northern Isalo Massif': '伊萨卢山地北部', 'Northern Karelia': '北卡累利阿',
    'Northern Province': '北部省', 'Northern Rio Grande': '北里奥格兰德',
    'Northern Santander': '北桑坦德', 'Northern Sudan': '北苏丹',
    'Northern Transvaal': '北德兰士瓦', 'Northern Welsh Counties': '威尔士北部诸郡',
    'Northern Yakutia': '北雅库特', 'Northwest': '西北', 'Nyagan': '尼亚甘',
    'Nyingchi': '林芝', 'Nzérékoré': '恩泽雷科雷', 'Ogaden': '欧加登',
    'Olonets Karelia': '奥洛涅茨卡累利阿', 'Olyokminsk': '奥廖克明斯克',
    'Omo River': '奥莫河', 'Oran': '奥兰', 'Orange Free State': '奥兰治自由邦',
    'Orléansville': '奥尔良维尔', 'Oruro': '奥鲁罗', 'Osh': '奥什', 'Otradny': '奥特拉德内',
    'Ouagadougou': '瓦加杜古', 'Ouagadougou Region': '瓦加杜古地区', 'Ouargla': '瓦尔格拉',
    'Ouest': '西部', 'Paktia': '帕克蒂亚', 'Pando': '潘多', 'Papua Gulf': '巴布亚湾',
    'Paraíba': '帕拉伊巴', 'Parwan': '帕尔旺', 'Pasco': '帕斯科', 'Patras': '帕特雷',
    'Perlis': '玻璃市', 'Persian Gulf': '波斯湾', 'Perthshire': '珀斯郡',
    'Phetchabun': '碧差汶', 'Phnom Penh': '金边', 'Phongsaly': '丰沙里', 'Phuket': '普吉',
    'Phuoc Tuy': '福绥', 'Pishpek': '比什凯克', 'Piura': '皮乌拉', 'Plesetsk': '普列谢茨克',
    'Pleven': '普列文', 'Podgorica': '波德戈里察', 'Port Moresby': '莫尔兹比港',
    'Ports and Islands of Oman': '阿曼港口与岛屿', 'Potosí': '波托西',
    'Presidente Hayes': '阿耶斯总统', 'Pretoria-Witwatersrand-Vaal': '比勒陀利亚—威特沃特斯兰德—瓦尔',
    'Prey Veng': '波萝勉', 'Puno': '普诺', 'Pursat': '菩萨', 'Putao': '葡萄',
    'Putumayo': '普图马约', 'Pécs': '佩奇', 'Qalyubia': '盖勒尤卜', 'Qazvin': '加兹温',
    'Quang Ngai': '广义', 'Quito': '基多', 'Quneitra': '库奈特拉', 'Rabat': '拉巴特',
    'Radi': '拉季（Radi）', 'Rangoon': '仰光', 'Ras Al Khaima': '拉斯海马',
    'Rawalpindi': '拉瓦尔品第', 'River Nile': '尼罗河州', 'Riyadh Province': '利雅得省',
    'Roraima': '罗赖马', 'Ruse': '鲁塞', 'Ruwaished': '鲁韦希德',
    'Sabaragamuwa Province': '萨巴拉加穆瓦省', 'Salavan': '沙拉湾', 'Samarkand': '撒马尔罕',
    'Samarra': '萨迈拉', 'San Juan': '圣胡安', 'San Luis': '圣路易斯', 'San Martín': '圣马丁',
    'San Rafael': '圣拉斐尔', 'San-Pédro': '圣佩德罗', 'Sanaa': '萨那', 'Sandžak': '桑扎克',
    'Santander': '桑坦德', 'Sarh': '萨尔', 'Satun': '沙敦', 'Savannakhet': '沙湾拿吉',
    'Saïda': '赛伊达', 'Scottish Border Counties': '苏格兰边境诸郡',
    'Scottish Central Counties': '苏格兰中部诸郡', 'Sedone': '色敦', 'Selangor': '雪兰莪',
    'Semyonov': '谢苗诺夫', 'Sepik': '塞皮克', 'Sergipe': '塞尔希培', 'Serowe': '塞罗韦',
    'Settat': '塞塔特', 'Sfax': '斯法克斯', 'Shabwah': '舍卜沃', 'Sharqia': '东部省',
    'Sharya': '沙里亚', 'Shebelle': '谢贝利', 'Shumen': '舒门', 'Sibay': '锡拜',
    'Siem Reap': '暹粒', 'Siwa Oasis': '锡瓦绿洲', 'Skopje': '斯科普里',
    'Soc Trang': '朔庄', 'Sofia City': '索非亚市', 'Sofia River': '索菲亚河',
    'Somme': '索姆', 'Son La': '山罗', 'Songkhla': '宋卡', 'Soum': '苏姆', 'Sousse': '苏塞',
    'South Island': '南岛', 'South Kazakhstan': '南哈萨克斯坦', 'South Kordofan': '南科尔多凡',
    'South Mato Grosso': '南马托格罗索', 'Southeast District': '东南区',
    'Southeast Moluccas': '东南摩鹿加', 'Southern Desert': '南部沙漠',
    'Southern District': '南部区', 'Southern Highlands': '南部高地',
    'Southern Mindanao': '南棉兰老', 'Southern Province': '南部省',
    'Southern Rio Grande': '南里奥格兰德', 'Southern Tagalog': '南他加禄',
    'Southern Uplands Counties': '南部高地诸郡', 'Southern Welsh Counties': '威尔士南部诸郡',
    'Southwest': '西南', 'Southwestern Tagalog': '西南他加禄', 'Stara Zagora': '旧扎戈拉',
    'Sterlitamak': '斯捷尔利塔马克', 'Stockholm County': '斯德哥尔摩省',
    'Stung Treng': '上丁', 'Sucre and Nueva Esparta': '苏克雷与新埃斯帕塔',
    'Sud': '南部', 'Suez Canal': '苏伊士运河', 'Sulaymaniyah': '苏莱曼尼亚',
    'Sulu Archipelago': '苏禄群岛', 'Sumbawa': '松巴哇', 'Surat': '素叻',
    'Sureste': '东南', 'Suroeste': '西南', 'Swan River': '天鹅河', 'Syunik': '休尼克',
    'Syzran': '塞兹兰', 'Sétif': '塞提夫', 'Tacna': '塔克纳', 'Tagant': '塔甘特',
    'Taiz': '塔伊兹', 'Tak': '达', 'Tal Afar': '泰勒阿费尔', 'Taldykorgan': '塔尔迪库尔干',
    'Tamanrasset': '塔曼拉塞特', 'Tarapacá': '塔拉帕卡', 'Tartus': '塔尔图斯',
    'Tatra': '塔特拉', 'Taurien': '陶里亚', 'Tay Ninh': '西宁', 'Taymyria': '泰梅尔',
    'Teheran': '德黑兰', 'Tengchong': '腾冲', 'Terengganu': '登嘉楼', 'Thanh Hoa': '清化',
    'The Empty Quarter': '鲁卜哈利沙漠', 'Thessaly': '色萨利', 'Thua Thien': '承天',
    'Tiaret': '提亚雷特', 'Tirana': '地拉那', 'Tizi-Ouzou': '提济乌祖', 'Tolima': '托利马',
    'Touat': '图阿特', 'Touba': '图巴', 'Touggourt': '图古尔特', 'Trang': '董里',
    'Trarza': '特拉扎', 'Trenčín': '特伦钦', 'Trujillo': '特鲁希略', 'Tulun': '图伦',
    'Tunis': '突尼斯', 'Turku and Pori': '图尔库与波里', 'Tyrol-Vorarlberg': '蒂罗尔—福拉尔贝格',
    'Tyrone and Fermanagh': '蒂龙与弗马纳', 'Téné': '泰内（Téné）', 'Ubon': '乌汶',
    'Udon Thani': '乌隆', 'Ukhta': '乌赫塔', 'Upper Egypt': '上埃及', 'Upper Kenya': '上肯尼亚',
    'Upper Paraguay': '上巴拉圭', 'Upper Paraná': '上巴拉那', 'Upper Red Sea': '上红海',
    'Uppsala': '乌普萨拉', 'Uruzgan': '乌鲁兹甘', 'Uva Province': '乌瓦省', 'Vakaga': '瓦卡加',
    'Valdivia': '瓦尔迪维亚', 'Vaupés': '沃佩斯', 'Veliky Ustyug': '大乌斯秋格',
    'Vichada': '维查达', 'Vientiane': '万象', 'Viipuri': '维堡', 'Vilegodsk': '维列戈茨克',
    'Vinh Phu': '永富', 'Vlorë': '发罗拉', 'Vorkuta': '沃尔库塔', 'Vranya': '弗拉涅',
    'Vyatka': '维亚特卡', 'Västmanland': '西曼兰', 'Wardak': '瓦尔达克',
    'West Belize': '西伯利兹', 'West Jutland': '西日德兰', 'West Kalimantan': '西加里曼丹',
    'West Kazakhstan': '西哈萨克斯坦', 'West Panama': '西巴拿马', 'West Papua': '西巴布亚',
    'Western Cape': '西开普', 'Western Equatoria': '西赤道', 'Western Macedonia': '西马其顿',
    'Western Norrland': '西诺尔兰', 'Western Province': '西部省',
    'Western Transdanubia': '外多瑙河西部', 'White Karelia': '白卡累利阿',
    'White Nile': '白尼罗河', 'Xiangkhouang': '川圹', 'Xichang': '西昌', 'Xigaze': '日喀则',
    "Ya'an": '雅安', 'Yala': '也拉', 'Yamoussoukro': '亚穆苏克罗', 'Yeniseysk': '叶尼塞斯克',
    'Yerevan': '埃里温', 'Yibin': '宜宾', 'Yogyakarta': '日惹', 'Yoshkar-Ola': '约什卡尔奥拉',
    'Yugorsk': '尤戈尔斯克', 'Yushu': '玉树', 'Zabul': '扎布尔', 'Zaječar': '扎耶查尔',
    'Zanjan': '赞詹', 'Zealand': '西兰岛', 'Zeya': '结雅', 'Zhambyl': '江布尔',
    'Zizia': '齐齐亚', 'Zürich': '苏黎世', 'Ñuble': '纽夫莱', 'Örebro': '厄勒布鲁',
    'Šariš-Zemplín': '沙里什—曾普林',
    'Belgrade': '贝尔格莱德', 'Bern': '伯尔尼', 'Bheri': '佩里', 'Bintan': '民丹岛',
    'Brüssel': '布鲁塞尔', 'Bács-Bodrog': '巴奇—博德罗格', 'Entre Rios': '恩特雷里奥斯',
    'Federal Capital': '联邦首都', 'Gandaki': '甘达基', 'Grisons': '格劳宾登',
    'Heihe': '黑河', 'Malacca': '马六甲', 'Pest-Pilis-Solt-Kiskun': '佩斯—皮利什—绍尔特—小昆',
    'Požarevac': '波扎雷瓦茨', 'Romandie': '罗曼蒂', 'Schaffhausen': '沙夫豪森',
    'Serbian Banat': '塞尔维亚巴纳特', 'Southern Córdoba': '南科尔多瓦',
    'Southern Great Plain': '南大平原', 'Valais': '瓦莱', 'Vuka': '武卡',
    'Zavkhan-Altai': '扎布汗—阿尔泰',
}
UNCERTAIN_TRANSLATIONS = {'Ballou', 'Gitlerhaym', 'Houa Khong', 'Kalen', 'Radi', 'Téné'}


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def localization(path):
    return dict(re.findall(r'^\s*([\w.-]+):\d*\s*"([^"]*)"', path.read_text(encoding='utf-8-sig'), re.M))


def exact_name_translations(english, chinese):
    return {name: chinese[key] for key, name in english.items() if key in chinese}


def vote_summary(provinces, kinds, province_states):
    states = province_states[provinces]
    valid = (kinds == 'land') & (states > 0)
    votes = Counter(int(sid) for sid in states[valid])
    ordered = sorted(votes.items(), key=lambda item: (-item[1], item[0]))
    winner, count = ordered[0] if ordered else (None, 0)
    return dict(winner=winner, votes=dict(ordered), valid_land_fraction=float(valid.mean()),
                valid_land_votes=int(valid.sum()), winner_share=count / int(valid.sum()) if valid.any() else 0)


def sample_state_votes(geometry, source, fitted, province_states, seed):
    points = registration.sample_equal_area(geometry, 300, seed)
    schemes = {}
    for scheme in registration.SCHEMES:
        provinces, kinds, _ = source.lookup(fitted.lonlat_to_pixel(points, scheme))
        schemes[scheme] = vote_summary(provinces, kinds, province_states)
    a, b = (schemes[scheme] for scheme in registration.SCHEMES)
    agree = a['winner'] is not None and a['winner'] == b['winner']
    return dict(schemes=schemes, schemes_agree=agree,
                trusted=agree and min(a['winner_share'], b['winner_share']) >= .5)


def adjacency(geometries):
    ids = sorted(geometries)
    shapes = [geometries[fid] for fid in ids]
    tree = STRtree(shapes)
    edges = {fid: {} for fid in ids}
    for i, geom in enumerate(shapes):
        for j in tree.query(geom, predicate='intersects'):
            if j <= i:
                continue
            boundary = geom.boundary.intersection(shapes[j].boundary)
            length = registration.GEOD.geometry_length(boundary)
            if length > 0:
                edges[ids[i]][ids[j]] = length
                edges[ids[j]][ids[i]] = length
    return edges


def boundary_destination(members, assigned, edges, exclude=None):
    lengths = Counter()
    for fid in members:
        for neighbor, length in edges[fid].items():
            if neighbor in assigned and assigned[neighbor] != exclude and assigned[neighbor] != 0:
                lengths[assigned[neighbor]] += length
    return min(lengths, key=lambda sid: (-lengths[sid], sid)) if lengths else None


def attach(pending, assigned, edges, geometries, reasons):
    pending = set(pending)
    centers = {fid: geom.representative_point() for fid, geom in geometries.items()}
    while pending:
        frontier = [(fid, boundary_destination([fid], assigned, edges)) for fid in sorted(pending)]
        frontier = [(fid, sid) for fid, sid in frontier if sid is not None]
        if frontier:
            for fid, sid in frontier:
                assigned[fid] = sid
                reasons[fid] = 'shared_boundary'
                pending.remove(fid)
            continue
        anchors = {sid: GeometryCollection([geometries[fid] for fid in sorted(assigned)
                                            if assigned[fid] == sid]).representative_point()
                   for sid in sorted(set(assigned.values()) - {0})}
        if not anchors:
            break
        fid = min(pending)
        center = centers[fid]
        nearest = min(anchors, key=lambda sid: (
            registration.GEOD.inv(center.x, center.y, anchors[sid].x, anchors[sid].y)[2], sid))
        assigned[fid] = nearest
        reasons[fid] = 'nearest_representative_point'
        pending.remove(fid)
    return sorted(pending)


def components(members, edges):
    remaining = set(members)
    result = []
    while remaining:
        start = min(remaining)
        remaining.remove(start)
        component, stack = {start}, [start]
        while stack:
            for neighbor in edges[stack.pop()]:
                if neighbor in remaining:
                    remaining.remove(neighbor)
                    component.add(neighbor)
                    stack.append(neighbor)
        result.append(component)
    return result


def repair_connectivity(assigned, edges, geometries):
    areas = {fid: transform(registration.TO_AREA.transform, geom).area for fid, geom in geometries.items()}
    changes = []
    while True:
        moved = False
        for sid in sorted(set(assigned.values()) - {0}):
            blocks = components([fid for fid in assigned if assigned[fid] == sid], edges)
            blocks.sort(key=lambda block: (-sum(areas[fid] for fid in block), min(block)))
            for block in blocks[1:]:
                target = boundary_destination(block, assigned, edges, exclude=sid)
                if target is not None:
                    for fid in block:
                        assigned[fid] = target
                    changes.append(dict(feature_ids=sorted(block), from_state=sid, to_state=target))
                    moved = True
        if not moved:
            return changes


def group_tag(geometries, votes, atlantropa):
    edges = adjacency(geometries)
    antarctica = {fid for fid, geom in geometries.items() if geom.bounds[3] <= -60}
    shells = {fid for fid in geometries if '_SHELL_FB_' in fid} - antarctica
    assigned = {fid: vote['schemes']['tps']['winner'] for fid, vote in votes.items() if vote['trusted']}
    assigned.update({fid: 0 for fid in antarctica})
    reasons = {fid: 'antarctica' if sid == 0 else 'trusted_vote' for fid, sid in assigned.items()}
    pending = set(geometries) - set(assigned) - shells
    unresolved = attach(pending, assigned, edges, geometries, reasons)
    changes = repair_connectivity(assigned, edges, geometries)
    unresolved += attach(shells, assigned, edges, geometries, reasons)
    groups = defaultdict(list)
    for fid, sid in sorted(assigned.items()):
        groups[sid].append(fid)
    untrusted = [dict(feature_id=fid, destination=f'state_{assigned[fid]}' if fid in assigned else None,
                      method=reasons.get(fid, 'no_trusted_seed'))
                 for fid, vote in sorted(votes.items()) if not vote['trusted']]
    deferred = [dict(feature_id=fid, kind='shell' if fid in shells else 'atlantropa',
                     destination=f'state_{assigned[fid]}' if fid in assigned else None,
                     method=reasons.get(fid, 'no_trusted_seed'))
                for fid in sorted((shells | atlantropa) & set(geometries))]
    return dict(groups=dict(groups), untrusted=untrusted, deferred=deferred,
                connectivity_changes=changes, unresolved=unresolved)


def state_references(source, states, controls, fitted, state_ids):
    references = defaultdict(list)
    for control in controls:
        if control['state_id'] in state_ids:
            references[control['state_id']].append([control['lon'], control['lat']])
    missing = state_ids - references.keys()
    counts = np.bincount(source.pixels.ravel(), minlength=len(source.kinds))
    sx, sy = np.zeros(len(counts)), np.zeros(len(counts))
    x = np.arange(source.width) + .5
    for y, row in enumerate(source.pixels):
        sx += np.bincount(row, weights=x, minlength=len(counts))
        sy += np.bincount(row, minlength=len(counts)) * (y + .5)
    for sid in sorted(missing):
        provinces = states[sid].province_ids
        pixel = np.array([sx[provinces].sum(), sy[provinces].sum()]) / counts[provinces].sum()
        closest = min(controls, key=lambda c: (c['x'] - pixel[0]) ** 2 + (c['y'] - pixel[1]) ** 2)
        model = fitted.models[closest['region'], 'tps']
        references[sid].append(model.pixel_to_lonlat([pixel])[0].tolist())
    return references


def append_tags_bytes(content, key, additions):
    text = content.decode('utf-8')
    newline = '\r\n' if '\r\n' in text else '\n'
    start = re.search(r'^  "' + key + r'": (\{)', text, re.M).start(1)
    existing, length = json.JSONDecoder().raw_decode(text[start:])
    for tag in additions.keys() & existing.keys():
        assert existing[tag] == additions[tag], f'{tag}: existing generated districts differ'
    new = {tag: record for tag, record in additions.items() if tag not in existing}
    if not new:
        return text.encode('utf-8')
    inner = json.dumps(new, ensure_ascii=False, indent=2).splitlines()[1:-1]
    insertion = newline.join('  ' + line for line in inner)
    end = start + length - 1
    return (text[:end].rstrip() + (',' if existing else '') + newline + insertion + newline + '  ' + text[end:]).encode('utf-8')


def main():
    owners = read_json(SCENARIO / 'owners.by_feature.json')['owners']
    counts = Counter(owners.values())
    candidates = [tag for tag, count in counts.most_common() if count >= 6 and tag not in MANUAL_TAGS]
    skipped = {tag: dict(features=counts[tag], reason='tag_code_not_matching_^[A-Z]{2,4}$')
               for tag in candidates if not re.fullmatch(r'[A-Z]{2,4}', tag)}
    targets = [tag for tag in candidates if tag not in skipped]
    wanted = {fid for fid, owner in owners.items() if owner in targets}
    topology = read_json(SCENARIO / 'runtime_topology.topo.json')
    atlantropa_topology = read_json(SCENARIO / 'scenario_atlantropa.topo.json')
    atlantropa = {g['properties']['id'] for g in atlantropa_topology['objects']['scenario_atlantropa']['geometries']}
    geometries = {}
    for name in ('political', 'scenario_atlantropa'):
        selected = [g for g in topology['objects'][name]['geometries'] if g['properties']['id'] in wanted]
        subset = {**topology, 'objects': {name: dict(type='GeometryCollection', geometries=selected)}}
        for feature in topology_object_to_geojson(subset, name)['features']:
            geometries[feature['properties']['id']] = shape(feature['geometry'])
    assert geometries.keys() == wanted
    source, states, _ = registration.load_source()
    controls, control_rejections = registration.collect_controls(source, states)
    fitted = registration.Registration(controls, source.width, validate=False)
    province_states = np.zeros(len(source.kinds), dtype=int)
    for sid, state in states.items():
        province_states[state.province_ids] = sid
    votes = {}
    for seed, fid in enumerate(sorted(wanted)):
        if fid in atlantropa or '_SHELL_FB_' in fid or geometries[fid].bounds[3] <= -60:
            continue
        votes[fid] = sample_state_votes(geometries[fid], source, fitted, province_states, seed)
    results = {}
    for tag in targets:
        members = {fid: geometries[fid] for fid in sorted(wanted) if owners[fid] == tag}
        result = group_tag(members, {fid: votes[fid] for fid in members if fid in votes}, atlantropa)
        results[tag] = result
        if result['unresolved']:
            skipped[tag] = dict(features=counts[tag], reason='no_trusted_state_seed', feature_ids=result['unresolved'])
        elif len(result['groups']) < 2:
            skipped[tag] = dict(features=counts[tag], reason='fewer_than_two_groups')
    english = localization(registration.TNO_ROOT / 'localisation/english/state_names_l_english.yml')
    base_names = exact_name_translations(localization(BASE_LOCALISATION / 'english/state_names_l_english.yml'),
                                         localization(BASE_LOCALISATION / 'simp_chinese/state_names_l_simp_chinese.yml'))
    used_states = {sid for tag in targets if tag not in skipped for sid in results[tag]['groups'] if sid}
    references = state_references(source, states, controls, fitted, used_states)
    additions, translated, suspicious, tag_reports = {}, {}, [], {}
    for tag in targets:
        result = results[tag]
        info = dict(features=counts[tag], group_count=len(result['groups']), published=tag not in skipped,
                    untrusted_count=len(result['untrusted']), untrusted=result['untrusted'],
                    deferred=result['deferred'], connectivity_changes=result['connectivity_changes'],
                    singleton_groups=[], groups=[])
        tag_reports[tag] = info
        if tag in skipped:
            continue
        tag_spec = dict(source='tno_state_registration', districts=[])
        seen_en, seen_zh = Counter(), Counter()
        for sid, members in sorted(result['groups'].items()):
            name_en = english[f'STATE_{sid}'] if sid else 'Antarctic Territories'
            if sid == 0:
                name_zh = '南极属地'
            elif name_en in base_names:
                name_zh = base_names[name_en]
            else:
                name_zh = TRANSLATIONS[name_en]
                translated[sid] = dict(state_id=sid, name_en=name_en, name_zh=name_zh,
                                       needs_review=name_en in UNCERTAIN_TRANSLATIONS)
            seen_en[name_en] += 1
            seen_zh[name_zh] += 1
            if seen_en[name_en] > 1:
                name_en += f' {seen_en[name_en]}'
            if seen_zh[name_zh] > 1:
                name_zh += f' {seen_zh[name_zh]}'
            district_id = f'state_{sid}'
            tag_spec['districts'].append(dict(id=district_id, name_en=name_en, name_zh=name_zh, match=[dict(id=members)]))
            info['groups'].append(dict(district_id=district_id, name_en=name_en, name_zh=name_zh, members=len(members)))
            if len(members) == 1:
                info['singleton_groups'].append(dict(district_id=district_id, feature_id=members[0]))
            shell_fraction = sum('_SHELL_FB_' in fid for fid in members) / len(members)
            reasons = []
            details = dict(tag=tag, district_id=district_id, name_zh=name_zh, feature_ids=members)
            if shell_fraction >= .8:
                reasons.append('at_least_80_percent_shell_members')
                details['shell_fraction'] = shell_fraction
            if sid and states[sid].owner_tag != tag:
                projected = GeometryCollection([transform(registration.TO_AREA.transform, geometries[fid]) for fid in members])
                center = registration.FROM_AREA.transform(projected.centroid.x, projected.centroid.y)
                km = min(registration.GEOD.inv(*center, *point)[2] / 1000 for point in references[sid])
                if km > 500:
                    reasons.append('foreign_state_more_than_500_km')
                    details.update(state_owner=states[sid].owner_tag, distance_km=round(km, 1),
                                   group_centroid=list(center), state_reference_points=references[sid])
            if reasons:
                suspicious.append(dict(details, reasons=reasons))
        additions[tag] = tag_spec
    report = dict(added_tags=len(additions), added_groups=sum(len(s['districts']) for s in additions.values()),
                  skipped_tags=skipped, tags=tag_reports, suspicious=suspicious,
                  translations=sorted(translated.values(), key=lambda row: row['state_id']),
                  votes=votes,
                  rejected_controls=control_rejections['geographic_rejections'])
    spec_path = districts.DEFAULT_SPEC
    spec = read_json(spec_path)
    spec['tags'].update(additions)
    built, _ = districts.build_tags(spec, districts.load_features())
    _, mutations, payload = districts.materialize(built)
    updates = [
        (spec_path, append_tags_bytes(spec_path.read_bytes(), 'tags', additions)),
        (SCENARIO / 'district_groups.manual.json', append_tags_bytes((SCENARIO / 'district_groups.manual.json').read_bytes(), 'tags', {tag: payload['tags'][tag] for tag in additions})),
        (SCENARIO / 'scenario_mutations.json', append_tags_bytes((SCENARIO / 'scenario_mutations.json').read_bytes(), 'district_groups', {tag: mutations['district_groups'][tag] for tag in additions})),
    ]
    for path, content in updates:
        path.write_bytes(content)
    registration.write_json(REPORT, report)
    print(f"Added {report['added_tags']} tags / {report['added_groups']} districts; report: {REPORT}")


if __name__ == '__main__':
    main()

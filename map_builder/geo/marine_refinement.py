"""Shared ordinary marine partitions; no scenario coast or bathymetry inputs."""
from copy import deepcopy
import json
from pathlib import Path

from shapely.geometry import mapping, shape
from shapely.ops import unary_union

from .water_region_authority import polygonal

ROOT = Path(__file__).resolve().parents[2]
SOURCE_PATH = ROOT / "data/marine_regions.refined.source.geojson"
ADDITIONAL_SOURCE_PATH = ROOT / "data/marine_regions.additional.source.geojson"

# Recorded Marine Regions polygon IDs, not points or inferred bounding boxes.
ADDITIONAL_SEAS = (
    ("flores_sea", "Flores Sea", "弗洛勒斯海", "24126", "sea"),
    ("bali_sea", "Bali Sea", "巴厘海", "24125", "sea"),
    ("sunda_strait", "Sunda Strait", "巽他海峡", "24127", "strait"),
    ("sumba_strait", "Sumba Strait", "松巴海峡", "24123", "strait"),
    ("sawu_sea", "Sawu Sea", "萨武海", "24124", "sea"),
    ("gulf_of_tomini", "Gulf of Tomini", "托米尼湾", "24134", "gulf"),
    ("gulf_of_bone", "Gulf of Bone", "波尼湾", "24129", "gulf"),
    ("aru_sea", "Aru Sea", "阿鲁海", "24128", "sea"),
    ("ceram_sea", "Ceram Sea", "塞兰海", "24132", "sea"),
    ("berau_gulf", "Berau Gulf", "贝劳湾", "24131", "gulf"),
    ("florida_strait", "Straits of Florida", "佛罗里达海峡", "24043", "strait"),
    ("kara_sea", "Kara Sea", "喀拉海", "24027", "sea"),
    ("laptev_sea", "Laptev Sea", "拉普捷夫海", "24026", "sea"),
    ("east_siberian_sea", "East Siberian Sea", "东西伯利亚海", "24025", "sea"),
    ("chukchi_sea", "Chukchi Sea", "楚科奇海", "24022", "sea"),
    ("bering_strait", "Bering Strait", "白令海峡", "24122", "strait"),
    ("strait_of_hormuz", "Strait of Hormuz", "霍尔木兹海峡", "24076", "strait"),
    ("bay_of_fundy", "Bay of Fundy", "芬迪湾", "24045", "bay"),
    ("gulf_of_maine", "Gulf of Maine", "缅因湾", "63491", "gulf"),
    ("rio_de_la_plata", "Rio de la Plata", "拉普拉塔河口", "24038", "estuary"),
    ("davis_strait", "Davis Strait", "戴维斯海峡", "24019", "strait"),
    ("gulf_of_panama", "Gulf of Panama", "巴拿马湾", "24104", "gulf"),
    ("gulf_of_california", "Gulf of California", "加利福尼亚湾", "24106", "gulf"),
    ("coastal_waters_of_southeast_alaska_and_british_columbia",
     "Coastal Waters of Southeast Alaska and British Columbia",
     "阿拉斯加东南部与不列颠哥伦比亚沿岸水域", "24117", "sea"),
    ("solomon_sea", "Solomon Sea", "所罗门海", "24100", "sea"),
    ("bismarck_sea", "Bismarck Sea", "俾斯麦海", "24101", "sea"),
    ("riiser_larsen_sea", "Riiser-Larsen Sea", "里瑟-拉森海", "24151", "sea"),
    ("cooperation_sea", "Cooperation Sea", "合作海", "24153", "sea"),
    ("davis_sea", "Davis Sea", "戴维斯海", "24154", "sea"),
    ("lazarev_sea", "Lazarev Sea", "拉扎列夫海", "24150", "sea"),
    ("cosmonauts_sea", "Cosmonauts Sea", "宇航员海", "24152", "sea"),
    ("bellingshausen_sea", "Bellingshausen Sea", "别林斯高晋海", "24148", "sea"),
    ("amundsen_sea", "Amundsen Sea", "阿蒙森海", "24146", "sea"),
    ("mawson_sea", "Mawson Sea", "莫森海", "24155", "sea"),
    ("dumont_durville_sea", "Dumont d'Urville Sea", "迪维尔海", "24156", "sea"),
    ("somov_sea", "Somov Sea", "索莫夫海", "24157", "sea"),
    ("white_sea", "White Sea", "白海", "24020", "sea"),
    ("iceland_sea", "Iceland Sea", "冰岛海", "24021", "sea"),
    ("lincoln_sea", "Lincoln Sea", "林肯海", "24032", "sea"),
    ("gulf_of_mannar", "Gulf of Mannar", "马纳尔湾", "24067", "gulf"),
    ("palk_strait_and_palk_bay", "Palk Strait and Palk Bay", "保克海峡与保克湾", "24068", "strait"),
    ("lakshadweep_sea", "Lakshadweep Sea", "拉卡迪乌海", "24070", "sea"),
    ("bransfield_strait", "Bransfield Strait", "布兰斯菲尔德海峡", "24158", "strait"),
    ("drake_passage", "Drake Passage", "德雷克海峡", "24160", "strait"),
    ("tryoshnikova_gulf", "Tryoshnikova Gulf", "特里奥什尼科夫湾", "24149", "gulf"),
    ("dornoch_firth", "Dornoch Firth", "多诺赫湾", "24186", "channel"),
    ("firth_of_tay", "Firth of Tay", "泰湾", "24189", "channel"),
    ("tees_bay", "Tees Bay", "蒂斯湾", "24190", "bay"),
    ("bridlington_bay", "Bridlington Bay", "布里德灵顿湾", "24191", "bay"),
    ("westray_firth", "Westray Firth", "韦斯特雷海峡", "24180", "channel"),
    ("stronsay_firth", "Stronsay Firth", "斯特朗赛海峡", "24181", "channel"),
    ("scapa_flow", "Scapa Flow", "斯卡帕湾", "24182", "bay"),
    ("yell_sound", "Yell Sound", "耶尔海峡", "24184", "channel"),
    ('kilbrannan_sound', 'Kilbrannan Sound', '基尔布兰南海峡', '24238', 'channel'),
    ('firth_of_clyde', 'Firth of Clyde', '克莱德湾', '24239', 'channel'),
    ('inner_seas_off_west_coast_scotland', 'Inner Seas off the West Coast of Scotland', '苏格兰西岸内海', '24234', 'sea'),
    ('little_minch', 'Little Minch', '小明奇海峡', '24242', 'channel'),
    ('firth_of_lorn', 'Firth of Lorn', '洛恩湾', '24240', 'channel'),
    ('sea_of_hebrides', 'Sea of the Hebrides', '赫布里底海', '24241', 'sea'),
    ('lough_foyle', 'Lough Foyle', '福伊尔湾', '24235', 'estuary'),
    ('sound_of_jura', 'Sound of Jura', '朱拉海峡', '24237', 'channel'),
    ('northern_minch', 'Northern Minch', '北明奇海峡', '24243', 'channel'),
    ('st_magnus_bay', 'St. Magnus Bay', '圣马格努斯湾', '24183', 'bay'),
    ('gulf_of_kutch', 'Gulf of Kutch', '卡奇湾', '17457', 'gulf'),
    ('gulf_of_martaban', 'Gulf of Martaban', '莫塔马湾', '22290', 'gulf'),
    ('phang_nga_bay', 'Phang Nga Bay', '攀牙湾', '22447', 'bay'),
    ('tambalagam_bay', 'Tambalagam Bay', '坦巴拉加姆湾', '32543', 'bay'),
    ('king_sound', 'King Sound', '金湾', '33014', 'bay'),
    ('cockburn_sound', 'Cockburn Sound', '科伯恩湾', '32380', 'bay'),
    ('spencer_gulf', 'Spencer Gulf', '斯宾塞湾', '17864', 'gulf'),
    ('van_diemen_gulf', 'Van Diemen Gulf', '范迪门湾', '14930', 'gulf'),
    ('melville_bay', 'Melville Bay', '梅尔维尔湾', '32384', 'bay'),
    ('port_darwin', 'Port Darwin', '达尔文港湾', '32868', 'bay'),
    ('champion_bay', 'Champion Bay', '钱皮恩湾', '32439', 'bay'),
    ('two_peoples_bay', "Two people's Bay", '双人湾', '21543', 'bay'),
    ('ambaro_bay', 'Ambaro Bay', '安巴鲁湾', '32959', 'bay'),
    ('khalij_tarut', 'Tarut Bay', '塔鲁特湾', '32980', 'bay'),
    ('adventure_bay', 'Adventure Bay', '探险湾', '32462', 'bay'),
    ('balayan_bay', 'Balayan Bay', '巴拉延湾', '32947', 'bay'),
    ('cleveland_bay', 'Cleveland Bay', '克利夫兰湾', '31575', 'bay'),
    ('corner_inlet', 'Corner Inlet', '科纳湾', '32722', 'bay'),
    ('disaster_bay', 'Disaster Bay', '迪萨斯特湾', '32379', 'bay'),
    ('enshu_nada', 'Enshu-nada', '远州滩', '32816', 'sea'),
    ('fife_bay', 'Fife Bay', '法伊夫湾', '33823', 'bay'),
    ('halifax_bay', 'Halifax Bay', '哈利法克斯湾', '32377', 'bay'),
    ('kerema_bay', 'Kerema Bay', '凯雷马湾', '33873', 'bay'),
    ('manila_bay', 'Manila Bay', '马尼拉湾', '31579', 'bay'),
    ('nha_trang_bay', 'Bay of Nha Trang', '芽庄湾', '8902', 'bay'),
    ('sagami_bay', 'Sagami Bay', '相模湾', '26748', 'bay'),
    ('tosa_bay', 'Tosa Bay', '土佐湾', '15313', 'bay'),
    ("frobisher_bay", "Frobisher Bay", "弗罗比舍湾", "23370", "bay"),
    ("repulse_bay", "Repulse Bay", "里帕尔斯湾", "17823", "bay"),
    ("vestfjorden", "Vestfjorden", "韦斯特峡湾", "18664", "bay"),
    ("varangerfjorden", "Varangerfjorden", "瓦朗厄尔峡湾", "32695", "bay"),
    ("romsdalsfjord", "Romsdalsfjord", "鲁姆斯达尔峡湾", "32914", "bay"),
    ("storfjorden_svalbard", "Storfjorden", "斯托尔峡湾", "33048", "bay"),
    ("strangford_lough", "Strangford Lough", "斯特兰福德湾", "7932", "bay"),
    ("cape_cod_bay", "Cape Cod Bay", "科德角湾", "17487", "bay"),
    ("massachusetts_bay", "Massachusetts Bay", "马萨诸塞湾", "18882", "bay"),
    ("new_york_bight", "New York Bight", "纽约湾曲", "24648", "bay"),
    ("rhode_island_sound", "Rhode Island Sound", "罗得岛湾", "18947", "bay"),
    ("gaspe_bay", "Gaspe Bay", "加斯佩湾", "24627", "bay"),
    ("bay_of_campeche", "Bay of Campeche", "坎佩切湾", "18005", "bay"),
    ("gulf_of_honduras", "Gulf of Honduras", "洪都拉斯湾", "19265", "gulf"),
    ("gulf_of_venezuela", "Gulf of Venezuela", "委内瑞拉湾", "17610", "gulf"),
    ("gulf_of_paria", "Gulf of Paria", "帕里亚湾", "19269", "gulf"),
    ("gulf_of_uraba", "Gulf of Uraba", "乌拉巴湾", "21433", "gulf"),
    ("gulf_of_batabano", "Gulf of Batabano", "巴塔瓦诺湾", "8901", "gulf"),
    ("bay_of_ilha_grande", "Bay of Ilha Grande", "大岛湾", "19521", "bay"),
    ("guanabara_bay", "Guanabara Bay", "瓜纳巴拉湾", "19046", "bay"),
    ("garretts_bight", "Garretts Bight", "加勒特湾", "32374", "bay"),
    ("mida_creek", "Mida Creek", "米达溪", "15203", "estuary"),
    ("gharo_creek", "Gharo Creek", "加罗溪", "22585", "estuary"),
    ("tudor_creek", "Tudor Creek", "都铎溪", "20572", "estuary"),
    ("korangi_creek", "Korangi Creek", "科兰吉溪", "22486", "estuary"),
    ("khawr_al_hajar", "Khawr al Hajar", "哈贾尔湾", "21149", "bay"),
    ("minnie_bay", "Minnie Bay", "米妮湾", "22477", "bay"),
    ("ao_tang_khen", "Ao Tang Khen", "唐肯湾", "32987", "bay"),
    ("trou_aux_biches", "Trou-aux-Biches", "特鲁欧比什湾", "20571", "bay"),
    ("ahipara_bay", "Ahipara Bay", "阿希帕拉湾", "32666", "bay"),
    ("bootless_inlet", "Bootless Inlet", "布特利斯湾", "19885", "inlet"),
    ("gulf_of_fonseca", "Gulf of Fonseca", "丰塞卡湾", "21633", "gulf"),
    ("hauraki_gulf", "Hauraki Gulf", "豪拉基湾", "16473", "gulf"),
    ("kaimana_bay", "Kaimana Bay", "凯马纳湾", "33867", "bay"),
    ("magdalena_bay", "Magdalena Bay", "马格达莱纳湾", "18526", "bay"),
    ("matsushima_bay", "Matsushima-wan", "松岛湾", "32777", "bay"),
    ("orokolo_bay", "Orokolo Bay", "奥罗科洛湾", "33865", "gulf"),
    ("pegasus_bay", "Pegasus Bay", "佩加瑟斯湾", "32406", "bay"),
    ("saint_vincent_bay", "Baie de Saint-Vincent", "圣文森特湾", "32395", "bay"),
    ("san_diego_bay", "San Diego Bay", "圣迭戈湾", "19179", "bay"),
    ("santa_monica_bay", "Santa Monica Bay", "圣莫尼卡湾", "32749", "bay"),
    ("sebastian_vizcaino_bay", "Bahía Sebastián Vizcaíno", "塞瓦斯蒂安比斯凯诺湾", "32393", "bay"),
    ("tenacatita_bay", "Bahia Tenacatita", "特纳卡蒂塔湾", "21526", "bay"),
    ("todos_santos_bay", "Todos os Santos Bay", "托多斯桑托斯湾", "18585", "bay"),
    ("tomales_bay", "Tomales Bay", "托马利斯湾", "19238", "bay"),
    ("wandamen_bay", "Teluk Wandamen", "旺达门湾", "33449", "bay"),
)
# SeaVoX classifies these subregions under North Sea (mrgid_l3=23647).
# Parentage controls subtraction, not clipping to the parent's residual coast.
ADDITIONAL_DETAIL_PARENTS = {
    slug: "north_sea" for slug in (
        "dornoch_firth", "firth_of_tay", "tees_bay", "bridlington_bay",
        "westray_firth", "stronsay_firth", "scapa_flow", "yell_sound",
    )
}
# Gazetteer "Part of" relations to marine parents, not administrative regions.
ADDITIONAL_DETAIL_PARENTS.update({
    "gulf_of_kutch": "arabian_sea",
    "gulf_of_martaban": "andaman_sea",
    "melville_bay": "arafura_sea",
    "khalij_tarut": "persian_gulf",
})
ADDITIONAL_DETAIL_PARENTS.update({
    "gulf_of_paria": "caribbean_sea",
    "saint_vincent_bay": "coral_sea",
    "cape_cod_bay": "massachusetts_bay",
    "gulf_of_batabano": "caribbean_sea",
    "gaspe_bay": "gulf_of_st_lawrence",
    "gulf_of_honduras": "caribbean_sea",
    "bay_of_campeche": "gulf_of_mexico",
})

# Additional public bay polygons have Gazetteer MRGIDs, distinct from SeaVoX
# subregion IDs. Keep the selected five-field rows compatible with callers.
WORLD_BAY_GULF_SLUGS = frozenset({
    "adventure_bay",
    "ahipara_bay",
    "ambaro_bay",
    "ao_tang_khen",
    "balayan_bay",
    "bay_of_campeche",
    "bay_of_ilha_grande",
    "bootless_inlet",
    "cape_cod_bay",
    "champion_bay",
    "cleveland_bay",
    "cockburn_sound",
    "corner_inlet",
    "disaster_bay",
    "enshu_nada",
    "fife_bay",
    "frobisher_bay",
    "garretts_bight",
    "gaspe_bay",
    "gharo_creek",
    "guanabara_bay",
    "gulf_of_batabano",
    "gulf_of_fonseca",
    "gulf_of_honduras",
    "gulf_of_kutch",
    "gulf_of_martaban",
    "gulf_of_paria",
    "gulf_of_uraba",
    "gulf_of_venezuela",
    "halifax_bay",
    "hauraki_gulf",
    "kaimana_bay",
    "kerema_bay",
    "khalij_tarut",
    "khawr_al_hajar",
    "king_sound",
    "korangi_creek",
    "magdalena_bay",
    "manila_bay",
    "massachusetts_bay",
    "matsushima_bay",
    "melville_bay",
    "mida_creek",
    "minnie_bay",
    "new_york_bight",
    "nha_trang_bay",
    "orokolo_bay",
    "pegasus_bay",
    "phang_nga_bay",
    "port_darwin",
    "repulse_bay",
    "rhode_island_sound",
    "romsdalsfjord",
    "sagami_bay",
    "saint_vincent_bay",
    "san_diego_bay",
    "santa_monica_bay",
    "sebastian_vizcaino_bay",
    "spencer_gulf",
    "storfjorden_svalbard",
    "strangford_lough",
    "tambalagam_bay",
    "tenacatita_bay",
    "todos_santos_bay",
    "tomales_bay",
    "tosa_bay",
    "trou_aux_biches",
    "tudor_creek",
    "two_peoples_bay",
    "van_diemen_gulf",
    "varangerfjorden",
    "vestfjorden",
    "wandamen_bay",
})
ADDITIONAL_OCEAN_CLIP_OVERRIDES = {
    "kilbrannan_sound": ("tno_northeast_atlantic_ocean",),
    "firth_of_clyde": ("tno_northeast_atlantic_ocean",),
    "inner_seas_off_west_coast_scotland": ("tno_northeast_atlantic_ocean",),
    "little_minch": ("tno_northeast_atlantic_ocean",),
    "firth_of_lorn": ("tno_northeast_atlantic_ocean",),
    "sea_of_hebrides": ("tno_northeast_atlantic_ocean",),
    "lough_foyle": ("tno_northeast_atlantic_ocean",),
    "sound_of_jura": ("tno_northeast_atlantic_ocean",),
    "northern_minch": ("tno_northeast_atlantic_ocean",),
    "st_magnus_bay": ("tno_northeast_atlantic_ocean",),
    "gulf_of_kutch": ("tno_western_indian_ocean",),
    "ambaro_bay": ("tno_western_indian_ocean",),
    "khalij_tarut": ("tno_western_indian_ocean",),
    "gulf_of_martaban": ("tno_eastern_indian_ocean",),
    "phang_nga_bay": ("tno_eastern_indian_ocean",),
    "tambalagam_bay": ("tno_eastern_indian_ocean",),
    "king_sound": ("tno_eastern_indian_ocean",),
    "van_diemen_gulf": ("tno_eastern_indian_ocean",),
    "port_darwin": ("tno_eastern_indian_ocean",),
    "cockburn_sound": ("tno_southern_indian_ocean",),
    "spencer_gulf": ("tno_southern_indian_ocean",),
    "champion_bay": ("tno_southern_indian_ocean",),
    "two_peoples_bay": ("tno_southern_indian_ocean",),
    "melville_bay": ("tno_west_central_pacific_ocean",),
    "balayan_bay": ("tno_west_central_pacific_ocean",),
    "cleveland_bay": ("tno_west_central_pacific_ocean",),
    "fife_bay": ("tno_west_central_pacific_ocean",),
    "halifax_bay": ("tno_west_central_pacific_ocean",),
    "kerema_bay": ("tno_west_central_pacific_ocean",),
    "manila_bay": ("tno_west_central_pacific_ocean",),
    "nha_trang_bay": ("tno_west_central_pacific_ocean",),
    "adventure_bay": ("tno_southwest_pacific_ocean",),
    "corner_inlet": ("tno_southwest_pacific_ocean",),
    "disaster_bay": ("tno_southwest_pacific_ocean",),
    "enshu_nada": ("tno_northwest_pacific_ocean",),
    "sagami_bay": ("tno_northwest_pacific_ocean",),
    "tosa_bay": ("tno_northwest_pacific_ocean",),
    "frobisher_bay": ("tno_northwest_atlantic_ocean",),
    "repulse_bay": ("tno_northwest_atlantic_ocean", "tno_western_arctic_ocean"),
    "vestfjorden": ("tno_northeast_atlantic_ocean",),
    "varangerfjorden": ("tno_eastern_arctic_ocean",),
    "romsdalsfjord": ("tno_northeast_atlantic_ocean",),
    "storfjorden_svalbard": ("tno_eastern_arctic_ocean",),
    "strangford_lough": ("tno_northeast_atlantic_ocean",),
    "cape_cod_bay": ("tno_northwest_atlantic_ocean",),
    "massachusetts_bay": ("tno_northwest_atlantic_ocean",),
    "new_york_bight": ("tno_northwest_atlantic_ocean",),
    "rhode_island_sound": ("tno_northwest_atlantic_ocean",),
    "gaspe_bay": ("tno_northwest_atlantic_ocean",),
    "bay_of_campeche": ("tno_northwest_atlantic_ocean", "tno_west_central_atlantic_ocean"),
    "gulf_of_honduras": ("tno_west_central_atlantic_ocean",),
    "gulf_of_venezuela": ("tno_west_central_atlantic_ocean",),
    "gulf_of_paria": ("tno_west_central_atlantic_ocean",),
    "gulf_of_uraba": ("tno_west_central_atlantic_ocean",),
    "gulf_of_batabano": ("tno_northwest_atlantic_ocean",),
    "bay_of_ilha_grande": ("tno_southwest_atlantic_ocean",),
    "guanabara_bay": ("tno_southwest_atlantic_ocean",),
    "garretts_bight": ("tno_southwest_pacific_ocean",),
    "mida_creek": ("tno_western_indian_ocean",),
    "gharo_creek": ("tno_western_indian_ocean",),
    "tudor_creek": ("tno_western_indian_ocean",),
    "korangi_creek": ("tno_western_indian_ocean",),
    "khawr_al_hajar": ("tno_western_indian_ocean",),
    "minnie_bay": ("tno_eastern_indian_ocean",),
    "ao_tang_khen": ("tno_eastern_indian_ocean",),
    "trou_aux_biches": ("tno_southern_indian_ocean",),
    "ahipara_bay": ("tno_southwest_pacific_ocean",),
    "bootless_inlet": ("tno_west_central_pacific_ocean",),
    "gulf_of_fonseca": ("tno_east_central_pacific_ocean",),
    "hauraki_gulf": ("tno_southwest_pacific_ocean",),
    "kaimana_bay": ("tno_west_central_pacific_ocean",),
    "magdalena_bay": ("tno_northeast_pacific_ocean",),
    "matsushima_bay": ("tno_northwest_pacific_ocean",),
    "orokolo_bay": ("tno_west_central_pacific_ocean",),
    "pegasus_bay": ("tno_southwest_pacific_ocean",),
    "saint_vincent_bay": ("tno_southwest_pacific_ocean",),
    "san_diego_bay": ("tno_northeast_pacific_ocean",),
    "santa_monica_bay": ("tno_northeast_pacific_ocean",),
    "sebastian_vizcaino_bay": ("tno_northeast_pacific_ocean",),
    "tenacatita_bay": ("tno_east_central_pacific_ocean",),
    "todos_santos_bay": ("tno_northeast_pacific_ocean",),
    "tomales_bay": ("tno_northeast_pacific_ocean",),
    "wandamen_bay": ("tno_west_central_pacific_ocean",),
}
OCEAN_SECTORS = (
    ("northwest_atlantic_ocean", "Northwest Atlantic Ocean", "西北大西洋", "24047", "atlantic"),
    ("northeast_atlantic_ocean", "Northeast Atlantic Ocean", "东北大西洋", "24178", "atlantic"),
    ("southwest_atlantic_ocean", "Southwest Atlantic Ocean", "西南大西洋", "24039", "atlantic"),
    ("southeast_atlantic_ocean", "Southeast Atlantic Ocean", "东南大西洋", "24040", "atlantic"),
    ("northwest_pacific_ocean", "Northwest Pacific Ocean", "西北太平洋", "24115", "pacific"),
    ("northeast_pacific_ocean", "Northeast Pacific Ocean", "东北太平洋", "24116", "pacific"),
    ("southwest_pacific_ocean", "Southwest Pacific Ocean", "西南太平洋", "24102", "pacific"),
    ("southeast_pacific_ocean", "Southeast Pacific Ocean", "东南太平洋", "24103", "pacific"),
)

# Explicit source seam ownership. Detailed straits/bays keep their footprint;
# at basin seams the named adjoining source below supplies the shared edge.
# This reconciles independently simplified IHO/SeaVoX polygons, independent of
# input or paint order. Ocean/parent subtraction remains in the water compiler.
MARINE_BOUNDARY_EXCLUSIONS = {
    "banda_sea": ("timor_sea", "gulf_of_bone"),
    "barents_sea": ("norwegian_sea", "fram_strait", "kara_sea", "storfjorden_svalbard", "varangerfjorden"),
    "black_sea": ("sea_of_azov", "sea_of_marmara"),
    "celebes_sea": ("sulu_sea",),
    "east_china_sea": ("philippine_sea", "yellow_sea", "sea_of_japan"),
    "greenland_sea": ("norwegian_sea", "barents_sea"),
    "irish_sea": ("celtic_sea", "belfast_lough", "strangford_lough"),
    "north_sea": ("norwegian_sea",),
    "philippine_sea": ("south_china_sea", "molucca_sea", "seto_naikai", "balayan_bay", "enshu_nada", "tosa_bay"),
    "scotia_sea": ("weddell_sea",),
    "english_channel": ("rye_bay",),
    "gulf_of_papua": ("torres_strait", "kerema_bay", "orokolo_bay"),
    "great_barrier_reef_coastal_waters": ("torres_strait", "cleveland_bay", "halifax_bay"),
    "central_baltic_sea": ("lillebaelt", "gulf_of_riga"),
    "natuna_sea": ("singapore_strait", "malacca_strait"),
    "halmahera_sea": ("ceram_sea",),
    "flores_sea": ("bali_sea", "sumba_strait"),
    "aru_sea": ("ceram_sea", "kaimana_bay"),
    "kara_sea": ("laptev_sea",),
    "laptev_sea": ("east_siberian_sea",),
    "beaufort_sea": ("chukchi_sea",),
    "bering_sea": ("bering_strait",),
    "persian_gulf": ("strait_of_hormuz", "khalij_tarut"),
    "baffin_bay": ("davis_strait",),
    "labrador_sea": ("davis_strait",),
    "davis_strait": ("hudson_strait", "frobisher_bay"),
    "gulf_of_alaska": ("coastal_waters_of_southeast_alaska_and_british_columbia",),
    "coastal_waters_of_southeast_alaska_and_british_columbia": ("salish_sea",),
    "coral_sea": ("solomon_sea", "fife_bay", "kerema_bay", "bootless_inlet", "orokolo_bay", "saint_vincent_bay"),
    "white_sea": ("barents_sea",),
    "iceland_sea": ("greenland_sea", "norwegian_sea"),
    "lincoln_sea": ("baffin_bay",),
    "gulf_of_mannar": ("palk_strait_and_palk_bay",),
    "lakshadweep_sea": ("arabian_sea",),
    "bransfield_strait": ("scotia_sea", "weddell_sea"),
    "drake_passage": ("scotia_sea", "bransfield_strait"),
    "firth_of_clyde": ("north_channel",),
    "arabian_sea": ("gulf_of_kutch", "gharo_creek", "korangi_creek"),
    "andaman_sea": ("gulf_of_martaban", "minnie_bay"),
    "malacca_strait": ("phang_nga_bay", "ao_tang_khen"),
    "bay_of_bengal": ("tambalagam_bay",),
    "timor_sea": ("port_darwin", "van_diemen_gulf"),
    "arafura_sea": ("melville_bay",),
    "mozambique_channel": ("ambaro_bay",),
    "tasman_sea": ("adventure_bay", "disaster_bay", "ahipara_bay", "garretts_bight"),
    "cleveland_bay": ("coral_sea",),
    "bass_strait": ("corner_inlet",),
    "halifax_bay": ("coral_sea",),
    "south_china_sea": ("manila_bay", "nha_trang_bay"),
    "inner_seas_off_west_coast_scotland": ("firth_of_lorn", "lough_foyle", "sea_of_hebrides"),
    "sound_of_jura": ("firth_of_lorn",),
    "frobisher_bay": ("hudson_strait",),
    "norwegian_sea": ("romsdalsfjord", "vestfjorden"),
    "gulf_of_maine": ("cape_cod_bay", "massachusetts_bay"),
    "gulf_of_st_lawrence": ("gaspe_bay",),
    "gulf_of_mexico": ("bay_of_campeche",),
    "caribbean_sea": ("gulf_of_batabano", "gulf_of_honduras", "gulf_of_paria", "gulf_of_uraba", "gulf_of_venezuela"),
    "gulf_of_oman": ("khawr_al_hajar",),
}


def reconcile_marine_source_boundaries(collection):
    """Apply reviewed seam exclusions without moving the combined coverage."""
    result = deepcopy(collection)
    by_id = {f["properties"]["id"]: f for f in collection["features"]}
    for feature in result["features"]:
        feature_id = feature["properties"]["id"]
        prefix = "tno_" if feature_id.startswith("tno_") else "marine_"
        targets = MARINE_BOUNDARY_EXCLUSIONS.get(feature_id.removeprefix(prefix), ())
        masks = [shape(by_id[prefix + suffix]["geometry"]) for suffix in targets if prefix + suffix in by_id]
        if masks:
            feature["geometry"] = mapping(polygonal(shape(feature["geometry"]).difference(unary_union(masks))))
    return result


def load_collection(path):
    return json.loads(path.read_text(encoding="utf-8"))


def additional_ocean_clip_ids(slug):
    """Explicit affected TNO sectors for each source family, including seam straits."""
    if slug in ADDITIONAL_OCEAN_CLIP_OVERRIDES:
        return ADDITIONAL_OCEAN_CLIP_OVERRIDES[slug]
    if ADDITIONAL_DETAIL_PARENTS.get(slug) == "north_sea":
        return ("tno_northeast_atlantic_ocean",)
    if slug == "white_sea":
        return ("tno_eastern_arctic_ocean",)
    if slug == "iceland_sea":
        return ("tno_northeast_atlantic_ocean", "tno_western_arctic_ocean")
    if slug == "lincoln_sea":
        return ("tno_western_arctic_ocean",)
    if slug in {"gulf_of_mannar", "palk_strait_and_palk_bay", "lakshadweep_sea"}:
        return ("tno_western_indian_ocean", "tno_eastern_indian_ocean")
    if slug == "bransfield_strait":
        return ("tno_south_atlantic_antarctic_ocean",)
    if slug == "drake_passage":
        return ("tno_southwest_atlantic_ocean", "tno_south_atlantic_antarctic_ocean")
    if slug == "tryoshnikova_gulf":
        return ("tno_south_indian_antarctic_ocean",)
    if slug == "riiser_larsen_sea":
        return ("tno_south_atlantic_antarctic_ocean", "tno_south_indian_antarctic_ocean")
    if slug == "lazarev_sea":
        return ("tno_south_atlantic_antarctic_ocean",)
    if slug in {"cooperation_sea", "davis_sea", "cosmonauts_sea", "mawson_sea", "dumont_durville_sea"}:
        return ("tno_south_indian_antarctic_ocean",)
    if slug == "somov_sea":
        return ("tno_south_indian_antarctic_ocean", "tno_south_pacific_antarctic_ocean")
    if slug == "bellingshausen_sea":
        return ("tno_south_atlantic_antarctic_ocean", "tno_south_pacific_antarctic_ocean")
    if slug == "amundsen_sea":
        return ("tno_south_pacific_antarctic_ocean",)
    if slug in {"bay_of_fundy", "gulf_of_maine"}:
        return ("tno_northwest_atlantic_ocean",)
    if slug == "rio_de_la_plata":
        return ("tno_southwest_atlantic_ocean",)
    if slug == "davis_strait":
        return ("tno_northwest_atlantic_ocean",)
    if slug == "gulf_of_panama":
        # The existing TNO Atlantic sector crosses the Panama source footprint;
        # remove it there too, including during a complete scenario rebuild.
        return ("tno_west_central_pacific_ocean", "tno_west_central_atlantic_ocean")
    if slug in {"gulf_of_california", "coastal_waters_of_southeast_alaska_and_british_columbia"}:
        return ("tno_northeast_pacific_ocean",)
    if slug in {"solomon_sea", "bismarck_sea"}:
        return ("tno_west_central_pacific_ocean",)
    if slug == "florida_strait":
        return ("tno_northwest_atlantic_ocean", "tno_west_central_atlantic_ocean")
    if slug in {"kara_sea", "laptev_sea", "east_siberian_sea", "chukchi_sea", "bering_strait"}:
        return ("tno_western_arctic_ocean", "tno_eastern_arctic_ocean",
                "tno_northwest_pacific_ocean", "tno_northeast_pacific_ocean")
    if slug == "strait_of_hormuz":
        return ("tno_western_indian_ocean", "tno_eastern_indian_ocean")
    return ("tno_northwest_pacific_ocean", "tno_west_central_pacific_ocean",
            "tno_southwest_pacific_ocean", "tno_eastern_indian_ocean", "tno_southern_indian_ocean")


# Small source polygons lose substantial shape at macro precision; retain their measured detail.
ADDITIONAL_SOURCE_SIMPLIFY_OVERRIDES = {
    "mida_creek": 0.0005,
    "gharo_creek": 0.0005,
    "tudor_creek": 0.0005,
    "korangi_creek": 0.0005,
    "khawr_al_hajar": 0.0005,
    "minnie_bay": 0.0005,
    "ao_tang_khen": 0.0005,
    "bootless_inlet": 0.0005,
}


def additional_source_simplify_degrees(slug):
    """Use reviewed small-bay precision, then the existing detail/macro defaults."""
    return ADDITIONAL_SOURCE_SIMPLIFY_OVERRIDES.get(slug, 0.004 if slug in ADDITIONAL_DETAIL_PARENTS else 0.005)


def additional_source_contract(slug, mrgid):
    """Identify the exact public polygon layer and record used by an addition."""
    if slug in WORLD_BAY_GULF_SLUGS:
        return {
            "source_layer": "world_bay_gulf", "source_query": f"mrgid={mrgid}",
            "source_standard": "marine_regions_world_bay_gulf",
            "source_record_ids": [f"mrgid:{mrgid}"],
        }
    return {
        "source_layer": "seavox_v19", "source_query": f"mrgid_sr='{mrgid}'",
        "source_standard": "marine_regions_seavox_v19",
        "source_record_ids": [f"mrgid_sr:{mrgid}"],
    }


def tno_additional_specs():
    return tuple({
        "id": f"tno_{slug}", "name": name, "label": name,
        "water_type": kind,
        "region_group": "marine_detail" if slug in ADDITIONAL_DETAIL_PARENTS else "marine_macro",
        "parent_id": f"tno_{ADDITIONAL_DETAIL_PARENTS[slug]}" if slug in ADDITIONAL_DETAIL_PARENTS else "",
        "is_chokepoint": kind == "strait", **additional_source_contract(slug, mrgid),
        "subtract_base_ids": (), "simplify_tolerance": additional_source_simplify_degrees(slug),
        "clip_open_ocean_ids": additional_ocean_clip_ids(slug),
    } for slug, name, _zh, mrgid, kind in ADDITIONAL_SEAS)


def additional_snapshot_features():
    result = []
    sea_ids = {f"marine_{row[0]}" for row in ADDITIONAL_SEAS}
    for source in load_collection(ADDITIONAL_SOURCE_PATH)["features"]:
        if source["properties"]["id"] not in sea_ids:
            continue
        feature = deepcopy(source)
        feature["properties"]["id"] = feature["properties"]["id"].replace("marine_", "tno_", 1)
        if feature["properties"].get("parent_id"):
            feature["properties"]["parent_id"] = feature["properties"]["parent_id"].replace("marine_", "tno_", 1)
        result.append(feature)
    return result


def refine_base_water_regions(collection):
    """Keep durable IDs and untouched lakes/Mediterranean, replace ordinary seas.

    Source features precede physical clipping. Existing ocean parents retain
    their residual surface; documented SeaVoX children own their exact footprints.
    """
    result = deepcopy(collection)
    by_id = {f["properties"]["id"]: f for f in result["features"]}
    for source in load_collection(SOURCE_PATH)["features"]:
        feature = deepcopy(source)
        props = feature["properties"]
        if props.get("water_type") == "ocean":
            props["interactive"] = True
            parent = by_id.get(props["parent_id"])
            if parent is None:
                raise ValueError(f"Missing ocean parent {props['parent_id']}")
            # Physical parent authority prevents importing a source coast into
            # another ocean. No invented rectangular completion geometry.
            feature["geometry"] = mapping(polygonal(shape(feature["geometry"]).intersection(shape(parent["geometry"]))))
        by_id[props["id"]] = feature
    result["features"] = list(by_id.values())
    return reconcile_marine_source_boundaries(result)


def restore_ocean_parent_footprints(collection):
    """Reassemble split parents for legacy TNO source-union builders."""
    result = deepcopy(collection)
    by_id = {f["properties"]["id"]: f for f in result["features"]}
    children = {}
    for feature in result["features"]:
        props = feature["properties"]
        if props.get("water_type") == "ocean" and props.get("parent_id"):
            children.setdefault(props["parent_id"], []).append(shape(feature["geometry"]))
    for parent_id, parts in children.items():
        if parent_id in by_id:
            parent = by_id[parent_id]
            parent["geometry"] = mapping(polygonal(unary_union([shape(parent["geometry"]), *parts])))
    return result

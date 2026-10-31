"""Reviewed capital identities, separate from population-based city selection.

Stable IDs identify real points in world_cities, including same-name cities.
Evidence and intentional gaps are recorded in docs/data/scenario-capitals.md.
These rules are defaults; explicit scenario mutations remain authoritative.
"""
from __future__ import annotations

import copy


# tag: (Natural Earth city ID, or full stable city ID, English label, Chinese label).
MODERN_CAPITALS = {
    "BI": ("1159146001", "Gitega", "基特加"),
    "BJ": ("1159150345", "Porto-Novo", "波多诺伏"),
    "CI": ("1159150999", "Yamoussoukro", "亚穆苏克罗"),
    "CL": ("1159151615", "Santiago", "圣地亚哥"),
    "GP": ("1159143181", "Basse-Terre", "巴斯特尔"),
    "HK": ("1159151629", "Hong Kong", "香港"),
    "JP": ("1159151609", "Tokyo", "东京"),
    "KZ": ("1159150965", "Astana", "阿斯塔纳"),
    "LK": ("1159149593", "Sri Jayawardenepura Kotte", "斯里贾亚瓦德纳普拉科特"),
    "MC": ("1159149077", "Monaco", "摩纳哥"),
    "MM": ("1159151179", "Naypyidaw", "内比都"),
    "MO": ("1159149085", "Macau", "澳门"),
    "NG": ("1159150799", "Abuja", "阿布贾"),
    "NL": ("1159151519", "Amsterdam", "阿姆斯特丹"),
    "PH": ("1159151525", "Manila", "马尼拉"),
    "PM": ("CITY::gn::3424934", "Saint-Pierre", "圣皮埃尔"),
    "SH": ("CITY::gn::3370903", "Jamestown", "詹姆斯敦"),
    "TW": ("1159151567", "Taipei", "台北"),
    "TZ": ("1159149731", "Dodoma", "多多马"),
    "ZA": ("1159150661", "Pretoria", "比勒陀利亚"),
}
HOI4_CAPITALS = {
    "AEF": ("1159150993", "Brazzaville", "布拉柴维尔"),
    "AST": ("1159151161", "Canberra", "堪培拉"),
    "BRA": ("1159151619", "Rio de Janeiro", "里约热内卢"),
    "CHL": MODERN_CAPITALS["CL"],
    "HOL": MODERN_CAPITALS["NL"],
    "JAP": MODERN_CAPITALS["JP"],
    "LIT": ("1159136375", "Kaunas", "考纳斯"),
    "MAN": ("1159151393", "Hsinking", "新京"),
    "MEN": ("1159147139", "Xilinhot", "锡林浩特"),
    "PHI": MODERN_CAPITALS["PH"],
    "SAF": MODERN_CAPITALS["ZA"],
    "SIK": ("1159151531", "Dihua", "迪化"),
    "TAI": ("1159151567", "Taihoku", "台北"),
    "TAN": ("1159149621", "Kyzyl", "克孜勒"),
    "TIB": ("1159150879", "Lhasa", "拉萨"),
    "CAY": ("1159150911", "Cayenne", "卡宴"),
    "GDL": ("1159143181", "Basse-Terre", "巴斯特尔"),
    "MTQ": ("1159140257", "Fort-de-France", "法兰西堡"),
    "PCZ": ("1159146489", "Balboa", "巴尔博亚"),
    "RE": ("1159150179", "Saint-Denis", "圣但尼"),
    "YT": ("1159146067", "Dzaoudzi", "藻德济"),
}
# Capitals of the post-build HOI4 split overlay (data/scenario-rules/hoi4_split_overlay.json).
# Debug-oriented seats inside each split's current territory, not historical claims.
HOI4_SPLIT_CAPITALS = {
    "SSH": ("1159149741", "El Aaiún", "阿尤恩"),
    'NNI': ('1159149705', 'Kaduna', '卡杜纳'),
    'SNI': ('1159150771', 'Enugu', '埃努古'),
    'NEI': ('1159150771', 'Enugu', '埃努古'),
    'NWI': ('1159149697', 'Ibadan', '伊巴丹'),
    'NCM': ('CITY::gn::2341275', 'Gembu', '根布'),
    'SCM': ('1159119899', 'Buea', '布埃亚'),
    'AHI': ('1159148507', 'Kumasi', '库马西'),
    'GNH': ('1159141609', 'Tamale', '塔马利'),
    'WTO': ('1159141663', 'Ho', '霍'),
    'HSL': ('1159136189', 'Kenema', '凯内马'),
    'GMP': ('1159118993', 'Mansa Konko', '曼萨孔科'),
    'GAB': ('1159150913', 'Libreville', '利伯维尔'),
    'CAR': ('1159151111', 'Bangui', '班吉'),
    'CHA': ('1159150863', 'Fort-Lamy', '拉密堡'),
    'RCG': ('1159151539', 'Léopoldville', '利奥波德维尔'),
    'CQT': ('1159149849', 'Coquilhatville', '科基亚维尔'),
    'STN': ('1159149865', 'Stanleyville', '斯坦利维尔'),
    'KIV': ('1159148481', 'Costermansville', '科斯特曼斯维尔'),
    'KTG': ('1159150903', 'Élisabethville', '伊丽莎白维尔'),
    'LSP': ('1159141461', 'Lusambo', '卢桑博'),
    'CAB': ('1159144723', 'Cabinda', '卡宾达'),
    'AMH': ('1159150963', 'Gondar', '贡德尔'),
    'GSD': ('1159148639', 'Jimma', '吉马'),
    'HRR': ('1159148633', 'Harar', '哈勒尔'),
    'AOI': ('1159151549', 'Addis Ababa', '亚的斯亚贝巴'),
    'SHM': ('1159149075', 'Bir Lehlou', '比尔莱赫卢'),
    'RDO': ('CITY::scenario::agwanit', 'Agwanit', '阿格瓦尼特'),
    "FRO": ("1159146943", "Tórshavn", "托尔斯港"),
    "DOD": ("1159142253", "Rhodes", "罗德岛"),
    "SML": ("CITY::gn::57289", "Hargeysa", "哈尔格萨"),
    "NFL": ("1159151071", "St. John's", "圣约翰斯"),
    "GOA": ("1159122667", "Panaji", "帕纳吉"),
    "MCO": ("1159149077", "Monaco", "摩纳哥"),
    "AND": ("1159149089", "Andorra la Vella", "安道尔城"),
    "LIE": ("1159146061", "Vaduz", "瓦杜兹"),
    "SMN": ("1159146051", "San Marino", "圣马力诺"),
    "DNZ": ("1159149707", "Gdańsk", "但泽"),
    "TGR": ("1159148063", "Tangier", "坦吉尔"),
    "SMR": ("CITY::gn::2528910", "Tétouan", "得土安"),
    "IFN": ("CITY::gn::2534515", "Sidi Ifni", "西迪伊夫尼"),
    "KWW": ("1159149797", "Fort Bayard", "广州湾"),
    "RHO": ("1159150573", "Harare", "索尔兹伯里"),
    "NRH": ("1159150571", "Lusaka", "卢萨卡"),
    "NYS": ("1159148499", "Zomba", "松巴"),
    "BAS": ("1159150831", "Maseru", "马塞卢"),
    "SWZ": ("1159149413", "Mbabane", "姆巴巴内"),
    "HKG": ("1159151629", "Hong Kong", "香港"),
    "BHO": ("1159144449", "Belize City", "伯利兹城"),
    "BGU": ("1159150585", "Georgetown", "乔治敦"),
    "BAH": ("1159150451", "Manama", "麦纳麦"),
    "QAT": ("1159149469", "Doha", "多哈"),
    "TRU": ("1159151497", "Dubai", "迪拜"),
    "MLT": ("1159151199", "Valletta", "瓦莱塔"),
    "CYP": ("1159151209", "Nicosia", "尼科西亚"),
    "JAM": ("1159150855", "Kingston", "金斯敦"),
    "TRI": ("1159149307", "Port of Spain", "西班牙港"),
    "BHM": ("1159151207", "Nassau", "拿骚"),
    "MUR": ("1159150443", "Port Louis", "路易港"),
    "FLK": ("1159151183", "Stanley", "斯坦利"),
    "BWA": ("1159151591", "Lagos", "拉各斯"),
    "GLD": ("1159151403", "Accra", "阿克拉"),
    "SIE": ("1159150625", "Freetown", "弗里敦"),
    "GAM": ("1159149997", "Banjul", "巴瑟斯特"),
    "BEA": ("1159151597", "Nairobi", "内罗毕"),
    "UGA": ("1159135399", "Entebbe", "恩德培"),
    "TGN": ("1159151305", "Dar es Salaam", "达累斯萨拉姆"),
    "ZAN": ("1159150789", "Zanzibar City", "桑给巴尔"),
    "HYD": ("1159151407", "Hyderabad", "海得拉巴"),
    "KAS": ("1159150001", "Srinagar", "斯利那加"),
    "MYS": ("1159150017", "Mysore", "迈索尔"),
    "TVC": ("1159150007", "Thiruvananthapuram", "特里凡得琅"),
    "SKM": ("1159130849", "Gangtok", "甘托克"),
    "STR": ("1159151627", "Singapore", "新加坡"),
    "SRW": ("1159149803", "Kuching", "古晋"),
    "NBO": ("1159148333", "Sandakan", "山打根"),
    "BEI": ("1159151083", "Bandar Seri Begawan", "斯里巴加湾市"),
    "AOF": ("1159151513", "Dakar", "达喀尔"),
    "TOG": ("1159150535", "Lomé", "洛美"),
    "FCM": ("1159151115", "Yaoundé", "雅温得"),
    "DJI": ("1159149869", "Djibouti", "吉布提"),
    "VIN": ("1159151251", "Hanoi", "河内"),
    "CPV": ("1159151205", "Praia", "普拉亚"),
    "PGU": ("1159150803", "Bissau", "比绍"),
    "STP": ("1159151195", "São Tomé", "圣多美"),
    "TMR": ("1159150577", "Dili", "帝力"),
    "MCU": ("1159149085", "Macau", "澳门"),
    "SUR": ("1159150597", "Paramaribo", "帕拉马里博"),
    "RUA": ("1159150427", "Bujumbura", "乌松布拉"),
    "ALK": ("1159150555", "Juneau", "朱诺"),
    "HAW": ("1159151221", "Honolulu", "檀香山"),
    "KWT": ("1159149913", "Dalian", "大连"),
    "UKR": ("1159151495", "Kyiv", "基辅"),
    "CRM": ("CITY::gn::693805", "Simferopol", "辛菲罗波尔"),
    "BLR": ("1159151149", "Minsk", "明斯克"),
    "TSC": ("1159150961", "Tbilisi", "第比利斯"),
    "GEO": ("1159150961", "Tbilisi", "第比利斯"),
    "ARM": ("1159151119", "Yerevan", "埃里温"),
    "AZR": ("1159151123", "Baku", "巴库"),
    "KAZ": ("1159150969", "Almaty", "阿拉木图"),
    "KYR": ("1159150813", "Bishkek", "伏龙芝"),
    "UZB": ("1159151501", "Tashkent", "塔什干"),
    "KKP": ("1159149341", "Nukus", "努库斯"),
    "TMS": ("1159150567", "Ashgabat", "阿什哈巴德"),
    "TAJ": ("1159150609", "Dushanbe", "斯大林纳巴德"),
    "TAT": ("1159150705", "Kazan", "喀山"),
    "BSH": ("1159150699", "Ufa", "乌法"),
    "CVS": ("1159146557", "Cheboksary", "切博克萨雷"),
    "MRE": ("1159137563", "Yoshkar-Ola", "约什卡尔奥拉"),
    "UDM": ("1159148141", "Izhevsk", "伊热夫斯克"),
    "MRD": ("1159137403", "Saransk", "萨兰斯克"),
    "KOM": ("1159146551", "Syktyvkar", "瑟克特夫卡尔"),
    "YAK": ("1159150745", "Yakutsk", "雅库茨克"),
    "BYA": ("1159149623", "Ulan-Ude", "乌兰乌德"),
    "KRL": ("1159149535", "Petrozavodsk", "彼得罗扎沃茨克"),
    "DAG": ("1159146589", "Makhachkala", "马哈奇卡拉"),
    "KAL": ("1159148145", "Elista", "埃利斯塔"),
    "KBA": ("1159149521", "Nalchik", "纳尔奇克"),
    "NOS": ("1159137065", "Vladikavkaz", "奥尔忠尼启则"),
    "CHE": ("1159149587", "Grozny", "格罗兹尼"),
    "BOM": ("1159151359", "Prague", "布拉格"),
    "ALB": ("1159151117", "Tirana", "地拉那"),
    "EHC": ("1159147045", "Tangshan", "唐山"),
    "HBC": ("1159151595", "Beijing", "北平"),
    "HNN": ("1159151369", "Changsha", "长沙"),
    "SIC": ("CITY::gn::1787816", "Ya'an", "雅安"),
    "KHM": ("1159150883", "Hotan", "和阗"),
    "NCP": ("1159151595", "Beijing", "北平"),
    "CNZ": ("1159147043", "Zhangjiakou", "张家口"),
    "JBZ": ("1159146991", "Datong", "大同"),
    "RGC": ("1159151385", "Nanjing", "南京"),
    "JCC": ("1159151367", "Wuhan", "汉口"),
    "JSC": ("1159151331", "Guangzhou", "广州"),
    'AUNS': ('CITY::ne::1159151623', 'Sydney', '悉尼'),
    'AUQL': ('CITY::ne::1159151169', 'Brisbane', '布里斯班'),
    'AUSA': ('CITY::ne::1159151165', 'Adelaide', '阿德莱德'),
    'AUTS': ('CITY::ne::1159151171', 'Hobart', '霍巴特'),
    'AUVI': ('CITY::ne::1159151565', 'Melbourne', '墨尔本'),
    'AUWA': ('CITY::ne::1159151475', 'Perth', '珀斯'),
    'ADN': ('CITY::ne::1159150595', 'Aden', '亚丁'),
    'SEY': ('CITY::ne::1159151191', 'Victoria', '维多利亚'),
    'SWA': ('CITY::ne::1159150785', 'Windhoek', '温得和克'),
    'PAP': ('CITY::ne::1159150663', 'Port Moresby', '莫尔兹比港'),
    'NGN': ('CITY::ne::1159149499', 'Rabaul', '拉包尔'),
    'SUM': ('CITY::ne::1159151307', 'Medan', '棉兰'),
    'BOR': ('CITY::ne::1159150841', 'Banjarmasin', '马辰'),
    'CEL': ('CITY::ne::1159150843', 'Makassar', '望加锡'),
    'LSI': ('CITY::ne::1159139831', 'Singaraja', '新加拉惹'),
    'MLK': ('CITY::ne::1159149745', 'Ambon', '安汶'),
    'WNG': ('CITY::ne::1159148503', 'Manokwari', '马诺夸里'),
    'ERI': ('CITY::ne::1159150873', 'Asmara', '阿斯马拉'),
    'SOM': ('CITY::ne::1159150715', 'Mogadishu', '摩加迪休'),
    'NEA': ('CITY::ne::1159139615', 'Pingliang', '平凉'),
    'GSG': ('CITY::ne::1159151321', 'Lanzhou', '兰州'),
    'CDX': ('CITY::ne::1159151533', 'Chengdu', '成都'),
    'CSZ': ('CITY::ne::1159149899', 'Mianyang', '绵阳'),
    'CYS': ('CITY::gn::1799194', "Guang'an", '广安'),
    'NWA': ('CITY::ne::1159151363', "Xi'an", '西安'),
    'BDA': ('CITY::ne::1159149187', 'Vadodara', '巴罗达'),
    'GWA': ('CITY::ne::1159149185', 'Gwalior', '瓜廖尔'),
    'INR': ('CITY::ne::1159150161', 'Indore', '印多尔'),
    'BPL': ('CITY::ne::1159150985', 'Bhopal', '博帕尔'),
    'IRA': ('CITY::ne::1159151423', 'Jaipur', '斋浦尔'),
    'ICA': ('CITY::ne::1159142899', 'Ratlam', '拉特拉姆'),
    'KUT': ('CITY::ne::1159142973', 'Bhuj', '普杰'),
    'IWA': ('CITY::ne::1159149189', 'Rajkot', '拉杰果德'),
    'KHP': ('CITY::ne::1159150021', 'Kolhapur', '戈尔哈布尔'),
    'IPA': ('CITY::gn::1262319', 'Nabha', '纳巴'),
    'IHA': ('CITY::gn::1263862', 'Mandi', '曼迪'),
    'IEA': ('CITY::gn::1258315', 'Rourkela', '鲁尔克拉'),
    'RMP': ('CITY::ne::1159142821', 'Rampur', '兰普尔'),
    'CHB': ('CITY::gn::1266436', 'Koch Bihar', '科奇比哈尔'),
    'TPA': ('CITY::ne::1159142995', 'Agartala', '阿加尔塔拉'),
    'MNP': ('CITY::ne::1159147213', 'Imphal', '因帕尔'),
    'FND': ('CITY::ne::1159150163', 'Puducherry', '本地治里'),
    'COC': ('CITY::gn::1254187', 'Thrissur', '特里苏尔'),
    'BHW': ('CITY::ne::1159146467', 'Bahawalpur', '巴哈瓦尔布尔'),
    'KPU': ('CITY::gn::1162004', "Khairpur Mir's", '海尔布尔'),
    'KLA': ('CITY::gn::1175296', 'Kalat', '卡拉特'),
    'IFA': ('CITY::gn::1170395', 'Mingora', '明戈拉'),
    'IDA': ('CITY::ne::1159141845', 'Sangli', '桑格利'),
    'BHU': ('CITY::ne::1159121181', 'Punakha', '普那卡'),
    'SHA': ('CITY::ne::1159121797', 'Taunggyi', '东枝'),
    'KRN': ('CITY::ne::1159121199', 'Loikaw', '垒固'),
    'JOH': ('CITY::ne::1159146479', 'Johor Bahru', '新山'),
    'KED': ('CITY::ne::1159136519', 'Alor Setar', '亚罗士打'),
    'PLS': ('CITY::ne::1159117415', 'Kangar', '加央'),
    'KEL': ('CITY::ne::1159148317', 'Kota Bharu', '哥打巴鲁'),
    'TGA': ('CITY::ne::1159136553', 'Kuala Terengganu', '瓜拉登嘉楼'),
    'YOG': ('CITY::ne::1159148273', 'Yogyakarta', '日惹'),
    'MAL': ('CITY::ne::1159151317', 'Kuala Lumpur', '吉隆坡'),
    'BRM': ('CITY::ne::1159151477', 'Yangon', '仰光'),
    'CEY': ('CITY::ne::1159150719', 'Colombo', '科伦坡'),
    "IKA": ("CITY::scenario::mawkyrwat", "Mawkyrwat", "毛克尔瓦特"),
    "ABD": ("1159150565", "Abu Dhabi", "阿布扎比"),
    "DUB": ("1159151497", "Dubai", "迪拜"),
    "SHJ": ("1159126943", "Sharjah", "沙迦"),
    "RAK": ("1159134277", "Ras al-Khaimah", "拉斯海马"),
    "AJM": ("CITY::gn::292932", "Ajman", "阿治曼"),
    "UAQ": ("1159126925", "Umm al-Quwain", "乌姆盖万"),
    "FUJ": ("1159134281", "Fujairah", "富查伊拉"),
    "OMA": ("1159150717", "Muscat", "马斯喀特"),
    "IMO": ("1159148149", "Nizwa", "尼兹瓦"),
    "ALW": ("1159126139", "Latakia", "拉塔基亚"),
    "JEB": ("1159133919", "Al-Suwayda", "苏韦达"),
    "HTY": ("1159113499", "Antakya", "安塔基亚"),
    "JAZ": ("1159126219", "Al-Hasakah", "哈塞克"),
    "WDN": ("1159133947", "Lahij", "拉赫季"),
    "EDN": ("1159147531", "Mukalla", "穆卡拉"),
    "ALG": ("1159151143", "Tamanrasset", "塔曼拉塞特"),
    "KRF": ("1159149657", "Toyohara", "丰原"),
    "STH": ("CITY::gn::3370903", "Jamestown", "詹姆斯敦"),
    # The base geometry omits Saint-Pierre island; use Miquelon as the scenario seat.
    "SPM": ("CITY::scenario::miquelon", "Miquelon", "密克隆"),
    "LOL": ("CITY::scenario::meigu", "Meigu", "美姑"),
    "MUL": ("CITY::scenario::qiaowa", "Qiaowa", "乔瓦"),
    "JRG": ("CITY::scenario::barkam", "Barkam", "马尔康"),
}

TNO_CAPITALS = {
    "CLL": ('1159139989', 'Tunja', '通哈'),
    "CLC": ('1159151345', 'Cali', '卡利'),
    "JAM": ('1159150855', 'Kingston', '金斯敦'),
    "TRI": ('1159149307', 'Port of Spain', '西班牙港'),
    "BAH": ('1159151207', 'Nassau', '拿骚'),
    "BLZ": ('1159144449', 'Belize City', '伯利兹城'),
    "GUY": ('1159150585', 'Georgetown', '乔治敦'),
    "GUC": ('1159150911', 'Caiena', '卡宴'),
    "STC": ('1159151135', 'Santa Cruz', '圣克鲁斯'),
    "PUE": ('1159151181', 'San Juan', '圣胡安'),
    "PCZ": ('1159146489', 'Balboa', '巴尔博亚'),
    "SUR": ('1159150597', 'Paramaribo', '帕拉马里博'),
    "SNM": ('1159146051', 'Città di San Marino', '圣马力诺城'),
    "PAD": ('1159149089', 'Andorra la Vella', '安道尔城'),
    "OE00": ('1159150811', 'Riga', '里加'),
    "RKU": ('1159151495', 'Kiew', '基辅'),
    "RKM": ('1159151585', 'Moskau', '莫斯科'),
    "RKK": ('1159150961', 'Tiflis', '第比利斯'),
    "GCO": ('1159151539', 'Leopoldstadt', '利奥波德城'),
    "GEA": ('1159151305', 'Daressalam', '达累斯萨拉姆'),
    "IETH": ('1159151549', 'Addis Abeba', '亚的斯亚贝巴'),

    "ALB": ('1159151117', 'Tirana', '地拉那'),
    "ISUE": ('1159140377', 'Ismailia', '伊斯梅利亚'),
    "IERI": ('1159150873', 'Asmára', '阿斯马拉'),
    "ISOM": ('1159150715', 'Mogadiscio', '摩加迪沙'),
    "IKEN": ('1159151597', 'Nairobi', '内罗毕'),
    "IDJI": ('1159149869', 'Gibuti', '吉布提'),
    "BTS": ('1159151153', 'Gaborone', '加博罗内'),
    "LTH": ('1159150831', 'Maseru', '马塞卢'),
    "SWZ": ('1159149413', 'Mbabane', '姆巴巴内'),
    "ICVE": ('1159151205', 'Praia', '普拉亚'),
    "IGUI": ('1159150803', 'Bissau', '比绍'),
    "ISTP": ('1159151195', 'São Tomé', '圣多美'),
    "ITIM": ('1159150577', 'Dili', '帝力'),

    "OE01": ('1159150877', 'Reval', '雷瓦尔'),
    "OE02": ('1159136375', 'Kauen', '考恩'),
    "OE03": ('1159151149', 'Minsk', '明斯克'),
    "AYR": ('1159150627', 'Agadez', '阿加德兹'),
    "AZW": ('CITY::gn::2455290', 'Kidal', '基达尔'),
    "CHD": ('CITY::gn::2427336', 'Moussoro', '穆索罗'),
    "MAU": ('1159148579', 'Rosso', '罗索'),
    "MLI": ('1159150945', 'Bamako', '巴马科'),
    "GUI": ('1159150997', 'Conakry', '科纳克里'),
    "HAU": ('1159150605', 'Niamey', '尼亚美'),
    "SEN": ('1159151513', 'Dakar', '达喀尔'),
    "GHA": ('1159151403', 'Accra', '阿克拉'),
    "DAH": ('1159120959', 'Lokossa', '洛科萨'),
    "BKF": ('1159151173', 'Ouagadougou', '瓦加杜古'),
    "YOR": ('1159151591', 'Lagos', '拉各斯'),
    "SIE": ('1159150625', 'Freetown', '弗里敦'),
    "CAO": ('1159150315', 'Bamenda', '巴门达'),
    "NRB": ('1159149803', 'Kuching', '古晋'),
    "SHO": ('1159151627', 'Shōnan', '昭南'),
    "MLY": ('1159149765', 'George Town', '乔治市'),
    "UPH": ('1159137983', 'Tacloban', '塔克洛班'),
    "SPH": ('1159146605', 'Tuguegarao', '土格加劳'),
    "MAL": ('1159151083', 'Brunei Town', '文莱城'),
    "ALT": ("1159146581", "Oyrot-Tura", "奥伊罗特-图拉"),
    "AMR": ("1159146681", "Tynda", "滕达"),
    "BKR": ("1159128763", "Oktyabrsky", "十月城"),
    "CRI": ("CITY::gn::694423", "Theoderichshafen", "狄奥多里希港"),
    "JHAW": ("1159151221", "Tōkō", "东港"),
    "JTWN": ("1159151567", "Taihoku", "台北"),
    "BOP": ("1159137605", "Ivdel", "伊夫杰利"),
    "BRY": ("1159149623", "Ulan-Ude", "乌兰乌德"),
    "CAM": ("1159151127", "Phnom Penh", "金边"),
    "CHI": ("1159151385", "Nanjing", "南京"),
    "CHL": MODERN_CAPITALS["CL"],
    "CHT": ("1159150737", "Chita", "赤塔"),
    "FFR": ("1159151439", "Abidjan", "阿比让"),
    "FAV": ("1159150709", "Surgut", "苏尔古特"),
    "GCE": ("CITY::gn::2635412", "Truro", "特鲁罗"),
    "GAY": ("CITY::scenario::cherdyn", "Cherdyn", "切尔登"),
    "GER": ("1159151529", "Germania", "日耳曼尼亚"),
    "GNG": ("1159151331", "Kōshū", "廣州"),
    "GOR": ("CITY::gn::532715", "Lyskovo", "雷斯科沃"),
    "GUZ": ("1159151325", "Guiyang", "贵阳"),
    "IRK": ("1159150731", "Irkutsk", "伊尔库茨克"),
    "JAP": ("1159151609", "Tōkyō", "东京"),
    "KAZ": ("1159150969", "Alma-Ata", "阿拉木图"),
    "KOM": ("1159146551", "Syktyvkar", "瑟克特夫卡尔"),
    "KRS": ("1159150733", "Krasnoyarsk", "克拉斯诺亚尔斯克"),
    "LAO": ("1159139147", "Luang Prabang", "琅勃拉邦"),
    "MGN": ("1159149559", "Magnitogorsk", "马格尼托哥尔斯克"),
    "MAG": ("1159150749", "Magadan", "马加丹"),
    "MAN": ("1159151393", "Xinjing", "新京"),
    "MC": MODERN_CAPITALS["MC"],
    "NIE": ("1159149369", "Belfast", "贝尔法斯特"),
    "NRL": ("1159149617", "Norilsk", "诺里尔斯克"),
    "OMO": ("1159146493", "Omolon", "奥莫隆"),
    "ONG": ("1159148101", "Onega", "奥涅加"),
    "ORN": ("1159149571", "Orenburg", "奥伦堡"),
    "ORS": ("1159146559", "Orsk", "奥尔斯克"),
    "OUR": ("CITY::gn::555980", "Ishimbay", "伊希姆拜"),
    "PHI": MODERN_CAPITALS["PH"],
    "PRM": ("1159150775", "Perm", "彼尔姆"),
    "RGC": ("1159151533", "Chengdu", "成都"),
    "RKP": ("1159149709", "Krakau", "克拉考"),
    "SBA": ("1159146637", "Kansk", "坎斯克"),
    "SCO": ("1159146365", "Edinburgh", "爱丁堡"),
    "SVR": ("1159150701", "Sverdlovsk", "斯维尔德洛夫斯克"),
    "PRC": ("1159149621", "Kyzyl", "克孜勒"),
    "TIB": ("1159150879", "Lhasa", "拉萨"),
    "TOM": ("1159150685", "Tomsk", "托木斯克"),
    "TNS": ("CITY::gn::712886", "Balta", "巴尔塔"),
    "URA": ("1159137725", "Peregrebnoye", "佩列格列布诺耶"),
    "URL": ("CITY::gn::577881", "Beloretsk", "别洛列茨克"),
    "VIN": ("1159147549", "Huế", "顺化"),
    "VOK": ("1159149563", "Vorkuta", "沃尔库塔"),
    "VOL": ("1159149541", "Vologda", "沃洛格达"),
    "VYT": ("1159149565", "Vyatka", "维亚特卡"),
    "WRS": ("1159150693", "Arkhangelsk", "阿尔汉格尔斯克"),
    "XIK": ("CITY::gn::1810604", "Litang", "理塘"),
    "XIN": ("1159151531", "Dihua", "迪化"),
    "YAK": ("1159150745", "Yakutsk", "雅库茨克"),
    "ZLT": ("1159149567", "Nizhny Tagil", "下塔吉尔"),
}
REVIEWED_CAPITALS = {
    "blank_base": MODERN_CAPITALS,
    "modern_world": MODERN_CAPITALS,
    "hoi4_1936": {
        **HOI4_CAPITALS,
        **HOI4_SPLIT_CAPITALS,
        "CHI": ("1159151385", "Nanjing", "南京"),
        "LUQ": ("1159151379", "Jinan", "济南"),
        "YUE": ("1159151331", "Guangzhou", "广州"),
        "CHU": ("1159151327", "Chongqing", "重庆"),
        "GMA": ("1159149769", "Wuwei", "武威"),
        "PRC": ("CITY::gn::1791706", "Wayaobu", "瓦窑堡"),
        "SIC": ("CITY::gn::1802171", "Kangding", "康定"),
    },
    "hoi4_1939": {
        **HOI4_CAPITALS,
        **HOI4_SPLIT_CAPITALS,
        "CHI": ("1159151327", "Chongqing", "重庆"),
        "SHX": ("CITY::gn::13512505", "Lishi", "离石"),
        "GXC": ("1159150821", "Guilin", "桂林"),
        "SIC": ("CITY::gn::1802171", "Kangding", "康定"),
        "LBA": ("1159150951", "Sabha", "塞卜哈"),
    },
    "tno_1962": TNO_CAPITALS,
}
NO_CAPITAL_TAGS = {
    "hoi4_1936": {"DMC", "CDE", "TRU"},
    "hoi4_1939": {"JCJ", "THG", "TRU"},
    "tno_1962": {"AFA", "RFA", "ATL", "AQ", "SPR", "RKO", "AOI"},
    # Neutral/uninhabited regions or administrations seated outside the mapped
    # territory have no in-territory civilian capital marker.
    "modern_world": {"AQ", "HM", "IO", "TF"},
}

# Non-capital historical names use the same stable identities as the capital
# rules. Keep these scenario-scoped: the base world layer is modern, and TNO
# has its own political naming policy. Evidence: docs/data/scenario-capitals.md.
HOI4_CITY_NAMES = {
    "1159151531": ("Dihua", "迪化"),
    "1159150965": ("Akmolinsk", "阿克莫林斯克"),
    "1159150969": ("Alma-Ata", "阿拉木图"),
    "1159151523": ("Keijō", "京城"),
}
# Seats of TNO districts that are releasable rather than released keep their
# occupation-era names as city labels; capitals alone would not carry them.
TNO_DISTRICT_SEAT_NAMES = {
    "1159149327": ("Shitomir", "日托米尔"),
    "1159134173": ("Rowno", "罗夫诺"),
    "1159126717": ("Tschernigow", "切尔尼戈夫"),
    "1159149329": ("Reichenaustadt", "赖歇瑙施塔特"),
    "1159126699": ("Nikolajew", "尼古拉耶夫"),
    "1159134253": ("Melitopol", "梅利托波尔"),
    "1159149333": ("Charkow", "哈尔科夫"),
    "1159149331": ("Hughesdorf", "休斯多夫"),
    "1159148121": ("Wladimir", "弗拉基米尔"),
    "1159151291": ("Sankt Petersburg", "圣彼得堡"),
    "1159149531": ("Brjansk", "布良斯克"),
    "1159146521": ("Tula", "图拉"),
    "1159149557": ("Woronesch", "沃罗涅日"),
    "1159149543": ("Jaroslawl", "雅罗斯拉夫尔"),
    "1159149575": ("Platenfurt", "普拉滕富特"),
    "1159150697": ("Paulusburg", "保卢斯堡"),
    "1159151123": ("Baku", "巴库"),
    "1159149549": ("Jekaterinodar", "叶卡捷琳诺达尔"),
    "1159149523": ("Stawropol", "斯塔夫罗波尔"),
    "1159137065": ("Wladikawkaz", "弗拉季高加索"),
    "1159148145": ("Elista", "埃利斯塔"),
    "1159149529": ("Pleskau", "普斯科夫"),
    "1159150683": ("Lourenço Marques", "洛伦索·马贵斯"),
    "1159150593": ("Kampala", "坎帕拉"),
    "1159150427": ("Usumbura", "乌松布拉"),
    "1159149385": ("Barthstadt", "巴特城"),
    "1159148499": ("Zomba", "松巴"),
    "1159150571": ("Lusaka", "卢萨卡"),
    "1159150573": ("Salisbury", "索尔兹伯里"),
    "1159151469": ("Luanda", "罗安达"),
    "1159150913": ("Freistadt", "自由城"),
    "1159150993": ("Brazzastadt", "布拉柴城"),
    "1159151111": ("Bangui", "班吉"),
    "1159150903": ("Elisabethstadt", "伊丽莎白城"),
    "1159148481": ("Costermansstadt", "科斯特曼斯城"),
}
REVIEWED_CITY_NAMES = {
    "hoi4_1936": {**HOI4_CITY_NAMES, "1159151595": ("Beiping", "北平")},
    "hoi4_1939": {**HOI4_CITY_NAMES, "1159151595": ("Beiping", "北平")},
    # Local TNO victory-point names, resolved against this project's ownership:
    # KOR is a Japanese residency, KAZ is independent, and Taipei is held by CHI.
    "tno_1962": {
        **TNO_DISTRICT_SEAT_NAMES,
        "1159151523": ("Keijō", "京城"),
        "1159150965": ("Akmola", "阿克莫拉"),
        "1159151567": ("Taipei", "台北"),
    },
}

# Small settlements absent from the population-filtered world layer. Coordinates
# are sourced, not territory centroids; see the evidence document.
ADDITIONAL_CAPITAL_CITIES = {
    "CITY::scenario::agwanit": {
        "id": "CITY::scenario::agwanit", "name": "Agwanit", "name_en": "Agwanit", "name_zh": "阿格瓦尼特",
        "lon": -13.14, "lat": 22.18, "country_code": "EH", "population": 0,
        "base_tier": "regional", "capital_kind": "admin_capital", "source": "reviewed_settlement",
    },
    "CITY::gn::2341275": {'id': 'CITY::gn::2341275', 'name': 'Gembu', 'name_en': 'Gembu', 'name_zh': '根布', 'lon': 11.25652, 'lat': 6.72556, 'country_code': 'NG', 'population': 19881, 'base_tier': 'regional', 'capital_kind': 'admin_capital', 'source': 'geonames'},
    "CITY::scenario::miquelon": {
        "id": "CITY::scenario::miquelon", "name": "Miquelon", "name_en": "Miquelon", "name_zh": "密克隆",
        "lon": -56.3814, "lat": 47.0975, "country_code": "PM", "population": 0,
        "base_tier": "regional", "capital_kind": "admin_capital", "source": "reviewed_settlement",
    },
    'CITY::scenario::meigu': {'id': 'CITY::scenario::meigu', 'name': 'Meigu', 'name_en': 'Meigu', 'name_zh': '美姑', 'lon': 103.132, 'lat': 28.328, 'country_code': 'CN', 'population': 0, 'base_tier': 'regional', 'capital_kind': 'admin_capital', 'source': 'reviewed_settlement'},
    'CITY::scenario::qiaowa': {'id': 'CITY::scenario::qiaowa', 'name': 'Qiaowa', 'name_en': 'Qiaowa', 'name_zh': '乔瓦', 'lon': 101.28, 'lat': 27.928, 'country_code': 'CN', 'population': 0, 'base_tier': 'regional', 'capital_kind': 'admin_capital', 'source': 'reviewed_settlement'},
    'CITY::scenario::barkam': {'id': 'CITY::scenario::barkam', 'name': 'Barkam', 'name_en': 'Barkam', 'name_zh': '马尔康', 'lon': 102.206, 'lat': 31.905, 'country_code': 'CN', 'population': 0, 'base_tier': 'regional', 'capital_kind': 'admin_capital', 'source': 'reviewed_settlement'},
    'CITY::gn::1262319': {'id': 'CITY::gn::1262319', 'name': 'Nabha', 'name_en': 'Nabha', 'name_zh': '纳巴', 'lon': 76.15292, 'lat': 30.37577, 'country_code': 'IN', 'population': 67972, 'base_tier': 'regional', 'capital_kind': 'admin_capital', 'source': 'geonames'},
    'CITY::gn::1263862': {'id': 'CITY::gn::1263862', 'name': 'Mandi', 'name_en': 'Mandi', 'name_zh': '曼迪', 'lon': 76.93273, 'lat': 31.71194, 'country_code': 'IN', 'population': 28217, 'base_tier': 'regional', 'capital_kind': 'admin_capital', 'source': 'geonames'},
    'CITY::gn::1266436': {'id': 'CITY::gn::1266436', 'name': 'Koch Bihar', 'name_en': 'Koch Bihar', 'name_zh': '科奇比哈尔', 'lon': 89.44508, 'lat': 26.32539, 'country_code': 'IN', 'population': 78737, 'base_tier': 'regional', 'capital_kind': 'admin_capital', 'source': 'geonames'},
    'CITY::scenario::mawkyrwat': {'id': 'CITY::scenario::mawkyrwat', 'name': 'Mawkyrwat', 'name_en': 'Mawkyrwat', 'name_zh': '毛克尔瓦特', 'lon': 91.45, 'lat': 25.3, 'country_code': 'IN', 'population': 0, 'base_tier': 'regional', 'capital_kind': 'admin_capital', 'source': 'reviewed_settlement'},

    'CITY::gn::1800675': {'id': 'CITY::gn::1800675', 'name': 'Mengyin', 'name_en': 'Mengyin', 'name_zh': '蒙阴', 'lon': 117.92639, 'lat': 35.70694, 'country_code': 'CN', 'population': 65889, 'base_tier': 'regional', 'capital_kind': 'admin_capital', 'source': 'geonames'},
    'CITY::gn::1794825': {'id': 'CITY::gn::1794825', 'name': 'Shizilu', 'name_en': 'Shizilu', 'name_zh': '十字路', 'lon': 118.82889, 'lat': 35.17111, 'country_code': 'CN', 'population': 86749, 'base_tier': 'regional', 'capital_kind': 'admin_capital', 'source': 'geonames'},

    "CITY::gn::3424934": {
        "id": "CITY::gn::3424934", "name": "Saint-Pierre", "name_en": "Saint-Pierre", "name_zh": "圣皮埃尔",
        "lon": -56.17730, "lat": 46.77914, "country_code": "PM", "population": 6200,
        "base_tier": "regional", "capital_kind": "country_capital", "source": "geonames",
    },
    "CITY::gn::3370903": {
        "id": "CITY::gn::3370903", "name": "Jamestown", "name_en": "Jamestown", "name_zh": "詹姆斯敦",
        "lon": -5.71816, "lat": -15.92488, "country_code": "SH", "population": 637,
        "base_tier": "regional", "capital_kind": "country_capital", "source": "geonames",
    },
    "CITY::scenario::cherdyn": {
        "id": "CITY::scenario::cherdyn", "name": "Cherdyn", "name_en": "Cherdyn", "name_zh": "切尔登",
        "lon": 56.516667, "lat": 60.4, "country_code": "RU", "population": 0,
        "base_tier": "regional", "capital_kind": "admin_capital", "source": "reviewed_settlement",
    },
    "CITY::gn::1810604": {
        "id": "CITY::gn::1810604", "name": "Litang", "name_en": "Litang", "name_zh": "理塘",
        "lon": 100.269403, "lat": 29.988143, "country_code": "CN", "population": 0,
        "base_tier": "regional", "capital_kind": "admin_capital", "source": "geonames",
    },
}


def apply_reviewed_capitals(payload, countries, city_rows, *, scenario_id, strict=False, city_names=None):
    """Apply only reviewed defaults, preserving unrelated city edits and metadata.

    The build can operate on a partial city fixture; the repair CLI uses strict
    mode so a missing real city fails before any artifacts are written.

    ``city_names`` are the scenario's reviewed city renames by stable city ID.
    They outrank the labels in the capital rules: choosing a capital must not
    replace a scenario place name, and a city keeps its name after its tag is
    retired.
    """
    result = copy.deepcopy(payload)
    capitals = result.setdefault("capitals_by_tag", {})
    hints = result.setdefault("capital_city_hints", {})
    cities = result.setdefault("cities", {})
    applied = set()
    renames = {city_id: dict(entry["display_name"]) for city_id, entry in (city_names or {}).items()
               if city_id.startswith("CITY::") and entry.get("display_name")}

    def name_city(city_id, en, zh):
        display_name = renames.get(city_id) or {"en": en, "zh": zh}
        cities[city_id] = {
            **cities.get(city_id, {}), "city_id": city_id, "stable_key": f"id::{city_id}",
            "display_name": dict(display_name),
        }
        # Existing hints for regional capitals must agree with their labels.
        for hint in hints.values():
            if hint.get("city_id") == city_id:
                hint["city_name"] = display_name["en"]

    for city_id, display_name in renames.items():
        if city_id in cities and cities[city_id].get("display_name") != display_name:
            name_city(city_id, display_name["en"], display_name["zh"])
    for ne_id, (en, zh) in REVIEWED_CITY_NAMES.get(scenario_id, {}).items():
        city_id = f"CITY::ne::{ne_id}"
        if city_id not in city_rows:
            if strict:
                raise ValueError(f"{scenario_id}: missing reviewed city {city_id}")
            continue
        name_city(city_id, en, zh)
    for tag, (ne_id, en, zh) in REVIEWED_CAPITALS.get(scenario_id, {}).items():
        if tag not in countries:
            continue
        city_id = ne_id if ne_id.startswith("CITY::") else f"CITY::ne::{ne_id}"
        city = city_rows.get(city_id) or ADDITIONAL_CAPITAL_CITIES.get(city_id)
        if city is None:
            if strict:
                raise ValueError(f"{scenario_id}/{tag}: missing reviewed city {city_id}")
            continue
        country = countries[tag]
        hint = {key: copy.deepcopy(city.get(key)) for key in (
            "country_code", "host_feature_id", "urban_match_id", "lon", "lat",
            "population", "base_tier", "source",
        )}
        display_name = renames.get(city_id) or {"en": en, "zh": zh}
        hint.update({
            "tag": tag, "city_id": city_id, "stable_key": f"id::{city_id}",
            "city_name": display_name["en"], "name_ascii": city.get("name_ascii", en),
            "display_name": country.get("display_name", tag),
            "lookup_iso2": country.get("lookup_iso2", ""),
            "base_iso2": country.get("base_iso2", ""),
            "capital_state_id": country.get("capital_state_id"),
            "capital_kind": "country_capital", "resolution_method": "reviewed_capital",
            "confidence": "high", "candidate_count": 1,
        })
        capitals[tag] = city_id
        hints[tag] = hint
        cities[city_id] = {
            **cities.get(city_id, {}), "city_id": city_id, "stable_key": f"id::{city_id}",
            "display_name": dict(display_name),
        }
        if city_id not in city_rows:
            cities[city_id].update({**city, "city_id": city_id, "add_city": True})
        applied.add(tag)
    for tag in NO_CAPITAL_TAGS.get(scenario_id, set()):
        if tag in countries:
            capitals.pop(tag, None)
            hints[tag] = {"tag": tag, "city_id": "", "resolution_method": "no_capital"}
            applied.add(tag)
    # Existing diagnostics must not continue to report repaired entries as missing.
    audit = result.setdefault("audit", {})
    for list_key, count_key in (
        ("unresolved_capitals", "unresolved_capital_count"),
        ("unresolved_manual_capitals", "unresolved_manual_capital_count"),
        ("featured_runtime_missing_tags", "featured_runtime_missing_count"),
        ("default_capital_missing_tags", "default_capital_missing_tag_count"),
        ("default_featured_runtime_missing_tags", "default_featured_runtime_missing_count"),
        ("default_rejected_candidates", "default_rejected_candidate_count"),
    ):
        if list_key in audit:
            audit[list_key] = [e for e in audit[list_key] if (e.get("tag") if isinstance(e, dict) else e) not in applied]
            audit[count_key] = len(audit[list_key])
    for key, value in (("manual_capital_count", len(capitals)), ("capital_hint_count", len(hints)),
                       ("default_capital_entry_count", len(capitals))):
        if key in audit:
            audit[key] = value
    return result

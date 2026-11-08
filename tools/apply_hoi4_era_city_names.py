import argparse
import json
import unicodedata
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCENARIOS = ("hoi4_1936", "hoi4_1939")

# 人工审定，2026-11
# country | modern names | era English | era Chinese | scenario | admin1
ERA_CITY_NAMES = """UA|Donetsk|Stalino|斯大林诺
UA|Luhansk|Voroshilovgrad|伏罗希洛夫格勒
UA|Dnipro|Dnepropetrovsk|第聂伯罗彼得罗夫斯克
UA|Zaporizhzhia|Zaporozhye|扎波罗热
UA|Kharkiv|Kharkov|哈尔科夫
UA|Kyiv|Kiev|基辅
UA|Chernihiv|Chernigov|切尔尼戈夫
RU|Tver|Kalinin|加里宁
RU|Samara|Kuybyshev|古比雪夫
RU|Stavropol|Voroshilovsk|伏罗希洛夫斯克
RU|Novokuznetsk|Stalinsk|斯大林斯克
RU|Vladikavkaz|Ordzhonikidze|奥尔忠尼启则
RU|Gorno-Altaysk|Oyrot-Tura|卫拉特-图拉
RU|Marks|Marxstadt|马克思施塔特
RU|Orenburg|Chkalov|契卡洛夫|hoi4_1939
KG|Bishkek|Frunze|伏龙芝
TJ|Dushanbe|Stalinabad|斯大林纳巴德
KZ|Almaty|Alma-Ata|阿拉木图
TM|Ashgabat|Ashkhabad|阿什哈巴德
KZ|Semey|Semipalatinsk|塞米巴拉金斯克
KZ|Oral|Uralsk|乌拉尔斯克
KZ|Kyzylorda|Kzyl-Orda|克孜勒奥尔达
TM|Dashoguz|Tashauz|塔沙乌兹
AM|Gyumri|Leninakan|列宁纳坎
AZ|Ganja|Kirovabad|基洛瓦巴德
BY|Babruysk|Bobruysk|博布鲁伊斯克
BY|Mazyr|Mozyr|莫济里
UA|Lviv|Lwów|利沃夫
LT|Vilnius|Wilno|维尔诺
UA|Ivano-Frankivsk|Stanisławów|斯坦尼斯瓦武夫
UA|Ternopil|Tarnopol|塔尔诺波尔
UA|Lutsk|Łuck|卢茨克
UA|Rivne|Równe|罗夫诺
UA|Kovel|Kowel|科韦利
BY|Brest|Brest-Litovsk|布列斯特-立托夫斯克
BY|Hrodna|Grodno|格罗德诺
BY|Baranavichy|Baranowicze|巴拉诺维奇
PL|Wrocław|Breslau|布雷斯劳
PL|Szczecin|Stettin|斯德丁
RU|Kaliningrad|Königsberg|柯尼斯堡
PL|Gdańsk|Danzig|但泽
PL|Gliwice|Gleiwitz|格莱维茨
PL|Zabrze|Hindenburg|兴登堡
PL|Bytom|Beuthen|博伊滕
PL|Opole|Oppeln|奥珀伦
PL|Legnica|Liegnitz|利格尼茨
PL|Wałbrzych|Waldenburg|瓦尔登堡
PL|Zielona Góra|Grünberg|格吕恩贝格
PL|Gorzów Wielkopolski|Landsberg an der Warthe|瓦尔塔河畔兰茨贝格
PL|Kostrzyn nad Odrą|Küstrin|屈斯特林
PL|Koszalin|Köslin|克斯林
PL|Kołobrzeg|Kolberg|科尔贝格
PL|Słupsk|Stolp|施托尔普
PL|Elbląg|Elbing|埃尔宾
PL|Olsztyn|Allenstein|阿伦施泰因
RU|Sovetsk|Tilsit|提尔西特||Kaliningrad
RU|Chernyakhovsk|Insterburg|因斯特堡
LT|Klaipėda|Memel|梅梅尔
UA|Chernivtsi|Cernăuți|切尔诺夫策
UA|Bilhorod-Dnistrovskyi|Cetatea Albă|白堡
RO|Cluj-Napoca|Cluj|克卢日
RU|Vyborg|Viipuri|维普里
RU|Pechenga|Petsamo|佩察莫
HR|Rijeka|Fiume|阜姆
HR|Zadar|Zara|扎拉
HR|Pula|Pola|波拉
ES|A Coruña|La Coruña|拉科鲁尼亚
ES|Girona|Gerona|赫罗纳
GB|Derry;Londonderry|Londonderry|伦敦德里
FR|Cherbourg-Octeville;Cherbourg-en-Cotentin|Cherbourg|瑟堡
TR|Afyonkarahisar|Afyon|阿菲永
TR|Şanlıurfa|Urfa|乌尔法
IR|Urmia|Rezaieh|礼萨耶
IR|Bandar-e Anzali|Bandar Pahlavi|巴列维港
IN|Mumbai|Bombay|孟买
IN|Chennai|Madras|马德拉斯
IN|Kolkata|Calcutta|加尔各答
IN|Bengaluru|Bangalore|班加罗尔
IN|Pune|Poona|浦那
IN|Kanpur|Cawnpore|坎普尔
IN|Varanasi|Benares|贝拿勒斯
IN|Shimla|Simla|西姆拉
IN|Vadodara|Baroda|巴罗达
IN|Thiruvananthapuram|Trivandrum|特里凡得琅
IN|Kochi|Cochin|科钦
IN|Puducherry|Pondicherry|本地治里
BD|Dhaka|Dacca|达卡
MM|Yangon|Rangoon|仰光
MM|Mawlamyine|Moulmein|毛淡棉
MM|Pathein|Bassein|勃生
MM|Sittwe|Akyab|实兑
ID|Jakarta|Batavia|巴达维亚
ID|Bogor|Buitenzorg|茂物
ID|Jayapura|Hollandia|荷兰迪亚
MY|Kota Kinabalu|Jesselton|亚庇
BN|Bandar Seri Begawan|Brunei Town|文莱城
VN|Ho Chi Minh City|Saigon|西贡
VN|Da Nang|Tourane|岘港
CN|Beijing|Peiping|北平|hoi4_1936
CN|Beijing|Peking|北京|hoi4_1939
CN|Changchun|Hsinking|新京
CN|Shenyang|Mukden|奉天
CN|Lüshunkou;Lushun|Port Arthur|旅顺
CN|Dalian|Dairen|大连
CN|Guangzhou|Canton|广州
CN|Nanjing|Nanking|南京
CN|Tianjin|Tientsin|天津
CN|Qingdao|Tsingtao|青岛
CN|Chongqing|Chungking|重庆
CN|Xiamen|Amoy|厦门
CN|Wuhan|Hankow|汉口
CN|Zhangjiakou|Kalgan|张家口
CN|Chengde|Jehol|承德
CN|Shantou|Swatow|汕头
CN|Xi'an|Sian|西安
CN|Chengdu|Chengtu|成都
CN|Jinan|Tsinan|济南||Shandong
CN|Hangzhou|Hangchow|杭州
CN|Lanzhou|Lanchow|兰州
KR|Busan|Fusan|釜山
KP|Pyongyang|Heijō|平壤
KR|Incheon|Jinsen|仁川
KR|Daegu|Taikyū|大邱
TW|Kaohsiung|Takao|高雄
RU|Yuzhno-Sakhalinsk|Toyohara|丰原
MN|Choibalsan|Bayan Tümen|巴彦图门
CD|Kinshasa|Léopoldville|利奥波德维尔
CD|Lubumbashi|Élisabethville|伊丽莎白维尔
CD|Kisangani|Stanleyville|斯坦利维尔
CD|Kalemie|Albertville|阿尔贝维尔
CD|Mbandaka|Coquilhatville|科基拉维尔
CD|Bukavu|Costermansville|科斯特曼斯维尔
CD|Mbuji-Mayi|Bakwanga|巴宽加
BI|Bujumbura|Usumbura|乌松布拉
ZW|Harare|Salisbury|索尔兹伯里
MZ|Maputo|Lourenço Marques|洛伦索-马贵斯
AO|Huambo|Nova Lisboa|新里斯本
AO|Lubango|Sá da Bandeira|萨达班代拉
GM|Banjul|Bathurst|巴瑟斯特
GQ|Malabo|Santa Isabel|圣伊莎贝尔
TD|Sarh|Fort-Archambault|阿尔尚博堡
MR|Nouadhibou|Port-Étienne|艾蒂安港
DZ|Skikda|Philippeville|菲利普维尔
DZ|Annaba|Bône|博纳
DZ|Chlef|Orléansville|奥尔良维尔
SO|Mogadishu|Mogadiscio|摩加迪休
ER|Massawa|Massaua|马萨瓦
LY|Benghazi|Bengasi|班加西
DO|Santo Domingo|Ciudad Trujillo|特鲁希略城"""


def normalize(value):
    return "".join(
        c for c in unicodedata.normalize("NFKD", value.casefold())
        if not unicodedata.combining(c) and unicodedata.category(c) != "Pd"
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    world = json.loads((ROOT / "data/world_cities.geojson").read_text(encoding="utf-8"))
    index = {}
    for feature in world["features"]:
        city = feature["properties"]
        names = [city.get(key, "") for key in ("name_en", "name", "name_ascii")]
        names.extend(city.get("aliases", []))
        for name in {normalize(name) for name in names if name}:
            index.setdefault((city["country_code"], name), {})[city["city_id"]] = city
    report = {}
    different = False
    for scenario in SCENARIOS:
        path = ROOT / "data/scenarios" / scenario / "city_overrides.json"
        original = path.read_text(encoding="utf-8")
        data = json.loads(original)
        result = {key: [] for key in ("matched", "created", "modified", "not_found", "multiple_candidates")}
        report[scenario] = result
        for line in ERA_CITY_NAMES.splitlines():
            country, modern, en, zh, only, admin1 = (line + "|" * (6 - len(line.split("|")))).split("|")
            if only and only != scenario:
                continue
            row = {"country_code": country, "modern_name": modern, "era_name": en}
            candidates = {}
            for name in modern.split(";"):
                candidates.update(index.get((country, normalize(name)), {}))
            choices = [city for city in candidates.values()
                       if not admin1 or normalize(city["admin1_name"]) == normalize(admin1)]
            if not choices:
                result["not_found"].append(row)
                continue
            choices.sort(key=lambda city: (city["population"], {"minor": 0, "regional": 1, "major": 2}[city["base_tier"]]), reverse=True)
            city = choices[0]
            city_id = city["city_id"]
            row = {**row, "city_id": city_id}
            if len(choices) > 1:
                result["multiple_candidates"].append({**row, "candidates": [
                    {key: candidate[key] for key in ("city_id", "name_en", "population", "base_tier", "admin1_name")}
                    for candidate in choices
                ]})
            result["matched"].append(row)
            existing = data["cities"].get(city_id)
            entry = dict(existing) if existing is not None else {"city_id": city_id, "stable_key": city["stable_key"]}
            entry["display_name"] = {"en": en, "zh": zh}
            entry["aliases"] = list(dict.fromkeys([en, city["name_en"], *entry.get("aliases", [])]))
            if existing != entry:
                result["created" if existing is None else "modified"].append(row)
                data["cities"][city_id] = entry
        updated = json.dumps(data, ensure_ascii=False, indent=2) + ("\n" if original.endswith("\n") else "")
        if updated != original:
            different = True
            if not args.check:
                path.write_text(updated, encoding="utf-8", newline="\n")
        print(scenario, {key: len(rows) for key, rows in result.items()})
        for key in ("not_found", "multiple_candidates"):
            for row in result[key]:
                print(key, json.dumps(row, ensure_ascii=False))
    report_path = ROOT / ".runtime/reports/generated/hoi4_era_city_names.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    return int(args.check and different)


if __name__ == "__main__":
    raise SystemExit(main())

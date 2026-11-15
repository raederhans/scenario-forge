// Landing copy. index.html carries the English text as its default; every
// data-i18n / data-i18n-aria-label / data-i18n-alt / data-i18n-list key must exist in both tables.
// The shared key is authoritative; the two legacy keys are migration fallbacks.
// Keep this small storage contract aligned with editor bootstrap and toggleLanguage.
const LANGUAGE_STORAGE_KEYS = ["scenario_forge_language", "map_lang", "scenario_forge_landing_lang"];

function normalizeLanguage(value) {
  const language = String(value || "").trim().toLowerCase();
  if (/^zh(?:[-_]|$)/.test(language)) return "zh";
  if (/^en(?:[-_]|$)/.test(language)) return "en";
  return null;
}

export function readLanguagePreference() {
  const explicit = normalizeLanguage(new URLSearchParams(globalThis.location?.search || "").get("lang"));
  if (explicit) return explicit;
  try {
    for (const key of LANGUAGE_STORAGE_KEYS) {
      const stored = normalizeLanguage(globalThis.localStorage?.getItem(key));
      if (stored) return stored;
    }
  } catch { /* Storage can be blocked; browser language still works. */ }
  return normalizeLanguage(globalThis.navigator?.language) || "en";
}

export function persistLanguagePreference(language) {
  const normalized = normalizeLanguage(language);
  if (!normalized) return;
  for (const key of LANGUAGE_STORAGE_KEYS) {
    try { globalThis.localStorage?.setItem(key, normalized); } catch { /* Choice remains usable for this page. */ }
  }
}

export const COPY = {
  en: {
    metaTitle: "Scenario Forge — Political map studio for alternate history",
    metaDescription:
      "Redraw borders and compose political maps for alternate history and strategy games. Two browser editors: Scenario Forge and HGO Atlas.",
    skipLink: "Skip to content",
    brandHomeLabel: "Scenario Forge home",
    productsLabel: "Products",
    navEditor: "Editor",
    navHgo: "HGO Atlas",
    navGithub: "Star on GitHub",
    navGithubLabel: "Star Scenario Forge on GitHub",
    langToggle: "中文",
    langToggleLabel: "Switch to Chinese",
    headerCta: "Open editor",

    stageMark: "Europe · LAEA 52°N 10°E",
    mapLabel: "Political map of Europe, redrawn as you scroll",
    yearLabel: "Year",
    playLabel: "Play history",
    pauseLabel: "Pause history",
    stateDates: { "1936": "1 January 1936", "1939": "14 August 1939", "1962": "1962", modern: "Today", blank: "No owners" },
    stateNames: { "1936": "HOI4", "1939": "HOI4", "1962": "TNO", modern: "Modern World", blank: "Blank Map" },

    heroTitle: "Every world",
    heroAccent: "starts with a map.",
    heroBody: "Drag through the years. Then scroll on — the whole editor unfolds on this one map.",
    heroCta: "Start creating",
    heroScroll: "Scroll to explore ↓",

    editIndex: "01 · Borders & ownership",
    editTitle: "Paint it. Right here.",
    editBody: "Pick a colour and click a country. In the editor you can go down to single provinces, with presets, quick fill and 80 steps of undo.",
    editItems: "Ownership & control|Quick fill by admin level|Frontlines & strategic marks|Special zones|Releasable countries|Regional presets",
    paintPalette: "Paint colours",
    paintUndo: "Undo",
    paintReset: "Reset",
    paintCount: (n) => (n === 1 ? "1 country repainted" : `${n} countries repainted`),

    styleIndex: "02 · Cartography",
    styleTitle: "Same borders. A different atlas.",
    styleBody: "Swap palettes, borders, labels and relief, and the whole map changes character at once.",
    styleGame: "Game colours",
    styleAtlas: "Printed atlas",
    styleInk: "Night ink",
    stylePicker: "Map style",
    styleItems: "Palette library|Borders & coastlines|City labels|Legends|Relief, oceans & lakes|River painting|Unit counters",

    contextIndex: "03 · Context & data",
    contextTitle: "Real networks under your story.",
    contextBody: "Detailed roads, rail and resources for China, France, Germany, India, Japan, Russia, the UK and the US; transport networks worldwide; and thematic layers to map.",
    contextItems: "Roads|Rail|Airports|Ports|Energy|Industrial zones|Logistics hubs|Mineral resources|Population heatmap|Human development|Governance indicators|Night lights, 1930 & today|Ocean depth",
    contextNote: "Shown here: Europe's main railways and largest cities.",

    worldsIndex: "04 · Starting worlds",
    worldsTitle: "Start from history. Or from nothing.",
    worldsBody: "Each one opens as a ready project: keep editing, or export PNG or JPG at up to 4× resolution.",
    worldsPicker: "Starting worlds",
    worldOpen: "Open",
    worldDownload: "Download",
    worldBlankName: "Blank Map",
    worldBlankBody: "Every subdivision drawn, none yet claimed.",
    worldModernName: "Modern World",
    worldModernBody: "Today's borders, with a sample transport corridor in Japan.",
    world1936Name: "HOI4 · 1936",
    world1936Body: "Europe on the first day of the game.",
    world1939Name: "HOI4 · 1939",
    world1939Body: "14 August 1939, on the eve of war.",
    world1962Name: "TNO · 1962",
    world1962Body: "The New Order, and a Mediterranean half drained by Atlantropa.",

    hgoMark: "Also in the studio",
    hgoEyebrow: "HGO Atlas",
    hgoTitle1: "One mod. One enormous map.",
    hgoBody1: "A dedicated editor for the 1936 world of the Historic Geographic Overhaul mod: repaint states, shift ownership and cores, rename regions, export the full map.",
    hgoTitle2: "Down to the pixel.",
    hgoBody2: "Provinces stay exactly as the mod draws them — 5120 × 2560, pixel for pixel.",
    hgoCta: "Open HGO Atlas",
    hgoZoom: "zoom",
    hgoStates: "states",
    hgoSea: "sea states",
    hgoProvinces: "provinces",

    faqTitle: "Good to know.",
    faqOneQuestion: "Do I need to install anything?",
    faqOneAnswer: "No. Both editors run in a modern browser, and your projects are saved as files on your own computer.",
    faqTwoQuestion: "How are the two editors different?",
    faqTwoAnswer: "Scenario Forge does everything shown above, across five starting worlds. HGO Atlas works directly on one mod's own pixel map, state by state. Their project files are not interchangeable.",
    faqThreeQuestion: "Can I share the maps I make?",
    faqThreeAnswer: "Yes. Map data comes from open sources such as Natural Earth, geoBoundaries and OpenStreetMap; credit them as their licences ask when you share.",
    faqSourcesLink: "See all data sources",
    ctaTitle: "Your next world is waiting.",
    ctaPrimary: "Start creating",
    ctaGithub: "View on GitHub",
    ctaShotAlt: "The Scenario Forge editor: TNO 1962 Europe with the colour library and paint tools",
    footerNote: "A political map studio for alternate history and worldbuilding.",
  },
  zh: {
    metaTitle: "Scenario Forge — 架空历史政治地图工作室",
    metaDescription: "为架空历史与策略游戏重绘疆界、制作政治地图。两个浏览器编辑器：Scenario Forge 与 HGO 地图集。",
    skipLink: "跳到正文",
    brandHomeLabel: "Scenario Forge 首页",
    productsLabel: "产品",
    navEditor: "编辑器",
    navHgo: "HGO 地图集",
    navGithub: "在 GitHub 点 Star",
    navGithubLabel: "在 GitHub 为 Scenario Forge 点 Star",
    langToggle: "EN",
    langToggleLabel: "切换到英文",
    headerCta: "打开编辑器",

    stageMark: "欧洲 · 兰伯特方位等积投影 52°N 10°E",
    mapLabel: "随滚动不断改写的欧洲政治地图",
    yearLabel: "年份",
    playLabel: "播放历史",
    pauseLabel: "暂停历史",
    stateDates: { "1936": "1936 年 1 月 1 日", "1939": "1939 年 8 月 14 日", "1962": "1962 年", modern: "今天", blank: "无归属" },
    stateNames: { "1936": "HOI4", "1939": "HOI4", "1962": "TNO", modern: "现代世界", blank: "空白地图" },

    heroTitle: "每个世界，",
    heroAccent: "从一张地图开始。",
    heroBody: "拖动年份，看疆界更迭；向下滚动，编辑器的功能将在这张图上逐一展开。",
    heroCta: "开始制图",
    heroScroll: "向下滚动探索 ↓",

    editIndex: "01 · 疆界与归属",
    editTitle: "就在这里，动手上色。",
    editBody: "选一种颜色，点击地图上的国家。编辑器里还能细到单个地块，并提供预设、快速填充和 80 步撤销。",
    editItems: "归属与控制|按行政层级快速填充|前线与战略标记|特殊区域|可释放国家|区域预设",
    paintPalette: "画笔颜色",
    paintUndo: "撤销",
    paintReset: "重置",
    paintCount: (n) => `已为 ${n} 个国家重新上色`,

    styleIndex: "02 · 制图",
    styleTitle: "同样的疆界，另一本地图集。",
    styleBody: "换一套配色、边界、标注与地形，整张地图随之改头换面。",
    styleGame: "游戏配色",
    styleAtlas: "印刷地图集",
    styleInk: "夜色墨线",
    stylePicker: "地图风格",
    styleItems: "调色板库|国界与海岸线|城市标注|图例|地形、海洋与湖泊|河流绘制|单位计数器",

    contextIndex: "03 · 背景与数据",
    contextTitle: "在真实的交通网上，铺开你的故事。",
    contextBody: "中、法、德、印、日、俄、英、美八国的公路、铁路与资源细节，覆盖全球的交通网络，以及可直接上图的专题数据。",
    contextItems: "公路|铁路|机场|港口|能源|工业区|物流枢纽|矿产资源|人口热力图|人类发展指数|治理指标|夜间灯光（1930 与今天）|海洋深度",
    contextNote: "图中所示：欧洲铁路干线与主要城市。",

    worldsIndex: "04 · 起点世界",
    worldsTitle: "从历史出发，或者从零开始。",
    worldsBody: "每个起点都是一份现成的项目：可以接着编辑，也可以导出最高 4 倍分辨率的 PNG 或 JPG。",
    worldsPicker: "起点世界",
    worldOpen: "打开",
    worldDownload: "下载项目",
    worldBlankName: "空白地图",
    worldBlankBody: "行政区划俱全，尚无归属。",
    worldModernName: "现代世界",
    worldModernBody: "当今疆界，附日本交通走廊示例。",
    world1936Name: "HOI4 · 1936",
    world1936Body: "游戏开局第一天的欧洲。",
    world1939Name: "HOI4 · 1939",
    world1939Body: "1939 年 8 月 14 日，大战前夜。",
    world1962Name: "TNO · 1962",
    world1962Body: "新秩序下的世界，与半干涸的地中海。",

    hgoMark: "姊妹工具",
    hgoEyebrow: "HGO 地图集",
    hgoTitle1: "一个模组，一张巨幅地图。",
    hgoBody1: "专为 Historic Geographic Overhaul 模组 1936 年世界打造的编辑器：为州重新上色，调整归属与核心，重命名地区，导出整张地图。",
    hgoTitle2: "精确到像素。",
    hgoBody2: "省份保持模组原本的样子——5120 × 2560，逐像素对应。",
    hgoCta: "打开 HGO 地图集",
    hgoZoom: "缩放",
    hgoStates: "个州",
    hgoSea: "个海域州",
    hgoProvinces: "个省份",

    faqTitle: "你可能想知道。",
    faqOneQuestion: "需要安装什么吗？",
    faqOneAnswer: "不需要。两个编辑器都在现代浏览器中运行，项目以文件形式保存在你自己的电脑上。",
    faqTwoQuestion: "两个编辑器有什么区别？",
    faqTwoAnswer: "Scenario Forge 覆盖五个起点世界，上文介绍的功能都在这里；HGO 地图集直接在模组自带的像素地图上逐州编辑。两者的项目文件互不通用。",
    faqThreeQuestion: "做好的地图可以分享吗？",
    faqThreeAnswer: "可以。地图数据来自 Natural Earth、geoBoundaries、OpenStreetMap 等开放来源，分享时请按各自的许可注明出处。",
    faqSourcesLink: "查看全部数据来源",
    ctaTitle: "下一个世界，等你落笔。",
    ctaPrimary: "开始制图",
    ctaGithub: "在 GitHub 上查看",
    ctaShotAlt: "Scenario Forge 编辑器：TNO 1962 的欧洲，左侧是颜色库，下方是绘制工具",
    footerNote: "为架空历史与世界观创作打造的政治地图工作室。",
  },
};

export const LANGUAGES = Object.keys(COPY);

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
    playLabel: "Play scenario comparison",
    pauseLabel: "Pause scenario comparison",
    stateDates: { "1936": "1 January 1936", "1939": "14 August 1939", "1962": "1962", rcw: "October 1919", modern: "2026", blank: "No owners" },
    stateNames: { "1936": "HOI4", "1939": "HOI4", "1962": "TNO", rcw: "Russian Civil War", modern: "Modern World", blank: "Blank Map" },

    heroTitle: "Every world",
    heroAccent: "starts with a map.",
    heroBody: "Drag the year slider to compare Europe’s borders at three scenario starts. Scroll down to try painting the map.",
    heroCta: "Start creating",
    heroScroll: "Scroll to explore ↓",

    editIndex: "01 · Borders & ownership",
    editTitle: "Paint it. Right here.",
    editBody: "Pick a colour and click a country. In the editor, paint individual provinces to change ownership. You can undo and redo your edits.",
    editItems: "Province ownership|Quick fill by admin level|Register new countries and capitals|Releasable country borders|Preset defensive lines|Box and lasso selection",
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
    styleItems: "Palettes and borders|Map text and curved text|Labels along lines|Historical and modern place names|Automatic country names|Terrain and legends",

    contextIndex: "03 · Context & data",
    contextTitle: "Real networks under your story.",
    contextBody: "Explore roads, rail and resources in China, France, Germany, India, Japan, Russia, the UK and the US. In historical scenarios, colour the map by starting population, factories or resources.",
    contextItems: "Roads|Rail|Airports|Ports|Energy|Industrial zones|Logistics hubs|Mineral resources|Population heatmap|Human development|Governance indicators|Night lights, 1930s and 2016|Ocean depth",
    contextNote: "Shown here: Europe's main railways and largest cities.",

    worldsIndex: "04 · Starting worlds",
    worldsTitle: "Start with these six sample projects.",
    worldsBody: "Each one opens as a ready project: keep editing, or export PNG or JPG at up to 4× resolution.",
    worldsPicker: "Starting worlds",
    worldOpen: "Open",
    worldDownload: "Download",
    worldBlankName: "Blank Map",
    worldBlankBody: "Every subdivision drawn, none yet claimed.",
    worldModernName: "Modern World · 2026",
    worldModernBody: "Today's borders, with a sample transport corridor in Japan.",
    world1936Name: "HOI4 · 1936",
    world1936Body: "Europe on the first day of the game.",
    world1939Name: "HOI4 · 1939",
    world1939Body: "14 August 1939, on the eve of war.",
    world1962Name: "TNO · 1962",
    world1962Body: "The New Order, and a Mediterranean half drained by Atlantropa.",
    worldRcwName: "Russian Civil War · 1919",
    worldRcwBody: "At the height of the White advance in October 1919, this regional scenario covers only the former Russian Empire and its neighbours.",

    showcaseTitle: "Inside the editor",
    mapModesAlt: "Two views of the same part of Europe in HOI4 1939, coloured by country and by faction.",
    mapModesCaption: "Switch between countries and factions in HOI4 1939. Only the display changes.",
    labelsLinesAlt: "Europe on the eve of war in HOI4 1939, with the Maginot and Stalin lines and curved map lettering.",
    labelsLinesCaption: "Add the scenario’s preset defensive lines, then letter the map with your own curved text.",
    scenarioDataAlt: "A HOI4 1936 map shaded by starting factory count, with a legend for the colour scale.",
    scenarioDataCaption: "Compare factory counts at the start of HOI4 1936 using the colours in the legend.",
    open1939: "Open the 1939 sample",
    open1936: "Open the 1936 sample",

    hgoMark: "Also in the studio",
    hgoEyebrow: "HGO Atlas",
    hgoTitle1: "One mod. One enormous map.",
    hgoBody1: "A dedicated editor for the 1936 world of the Historic Geographical Overhaul mod: repaint states, shift ownership and cores, rename regions, export the full map.",
    hgoTitle2: "Down to the pixel.",
    hgoBody2: "Provinces stay exactly as the mod draws them — 5120 × 2560, pixel for pixel.",
    hgoCta: "Open HGO Atlas",
    hgoZoom: "zoom",
    hgoStates: "states",
    hgoSea: "sea states",
    hgoProvinces: "provinces",

    faqTitle: "Good to know.",
    faqOneQuestion: "Where are my projects saved?",
    faqOneAnswer: "Project files are saved on your computer. You can also recover an autosaved draft in your browser.",
    faqTwoQuestion: "How are the two editors different?",
    faqTwoAnswer: "Scenario Forge edits maps across different scenarios. HGO Atlas edits the mod’s pixel map state by state and requires a browser with WebGL 2 support. Each editor uses its own project file format.",
    faqThreeQuestion: "How do I share a map or project?",
    faqThreeAnswer: "Export a PNG or JPG at up to 4× resolution. To share an editable project, host its file at a public HTTPS address, then generate a share link. Map data comes from open sources including Natural Earth, geoBoundaries and OpenStreetMap. Credit them as their licences require. Mod assets follow their respective terms.",
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
    playLabel: "播放剧本开局对比",
    pauseLabel: "暂停剧本开局对比",
    stateDates: { "1936": "1936 年 1 月 1 日", "1939": "1939 年 8 月 14 日", "1962": "1962 年", rcw: "1919 年 10 月", modern: "2026 年", blank: "无归属" },
    stateNames: { "1936": "HOI4", "1939": "HOI4", "1962": "TNO", rcw: "俄国内战", modern: "现代世界", blank: "空白地图" },

    heroTitle: "每个世界，",
    heroAccent: "从一张地图开始。",
    heroBody: "拖动年份，比较三个剧本开局时的欧洲疆界。再往下，试着给地图上色。",
    heroCta: "开始制图",
    heroScroll: "向下滚动探索 ↓",

    editIndex: "01 · 疆界与归属",
    editTitle: "就在这里，动手上色。",
    editBody: "选一种颜色，点击地图上的国家。编辑器里可以逐块上色，改变地块归属。支持撤销与重做。",
    editItems: "地块归属|按行政层级快速填充|登记新国家与首都|可释放国家疆界|预置防线|框选与套索",
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
    styleItems: "配色与疆界|地图文字与弯曲文字|沿线排字|时代地名与今名对照|自动国名|地形与图例",

    contextIndex: "03 · 背景与数据",
    contextTitle: "在真实的交通网上，铺开你的故事。",
    contextBody: "查看中、法、德、印、日、俄、英、美八国的公路、铁路与资源。历史剧本还可按开局人口、工厂数或资源着色。",
    contextItems: "公路|铁路|机场|港口|能源|工业区|物流枢纽|矿产资源|人口热力图|人类发展指数|治理指标|夜光（1930 年代与 2016 年）|海洋深度",
    contextNote: "图中所示：欧洲铁路干线与主要城市。",

    worldsIndex: "04 · 起点世界",
    worldsTitle: "从这六份示例项目开始。",
    worldsBody: "每个起点都是一份现成的项目：可以接着编辑，也可以导出最高 4 倍分辨率的 PNG 或 JPG。",
    worldsPicker: "起点世界",
    worldOpen: "打开",
    worldDownload: "下载项目",
    worldBlankName: "空白地图",
    worldBlankBody: "行政区划俱全，尚无归属。",
    worldModernName: "现代世界 · 2026",
    worldModernBody: "当今疆界，附日本交通走廊示例。",
    world1936Name: "HOI4 · 1936",
    world1936Body: "游戏开局第一天的欧洲。",
    world1939Name: "HOI4 · 1939",
    world1939Body: "1939 年 8 月 14 日，大战前夜。",
    world1962Name: "TNO · 1962",
    world1962Body: "新秩序下的世界，与半干涸的地中海。",
    worldRcwName: "俄国内战 · 1919",
    worldRcwBody: "1919 年 10 月，白军推进到最远处，这个区域剧本只含前俄罗斯帝国及邻国。",

    showcaseTitle: "编辑器实景",
    mapModesAlt: "HOI4 1939 的同一片欧洲疆域，左图按国家着色，右图按阵营着色。",
    mapModesCaption: "在 HOI4 1939 中切换国家与阵营模式，只改变地图的显示方式。",
    labelsLinesAlt: "HOI4 1939 开战前夕的欧洲，标出马奇诺防线、斯大林防线和弯曲的地图文字。",
    labelsLinesCaption: "一键加入剧本预置的防线，再用弯曲的地图文字自己标注。",
    scenarioDataAlt: "HOI4 1936 按开局工厂数着色，图例标明每种颜色对应的数量范围。",
    scenarioDataCaption: "对照图例，比较 HOI4 1936 各地的开局工厂数。",
    open1939: "打开 1939 示例",
    open1936: "打开 1936 示例",

    hgoMark: "姊妹工具",
    hgoEyebrow: "HGO 地图集",
    hgoTitle1: "一个模组，一张巨幅地图。",
    hgoBody1: "专为 Historic Geographical Overhaul 模组 1936 年世界打造的编辑器：为州重新上色，调整归属与核心，重命名地区，导出整张地图。",
    hgoTitle2: "精确到像素。",
    hgoBody2: "省份保持模组原本的样子——5120 × 2560，逐像素对应。",
    hgoCta: "打开 HGO 地图集",
    hgoZoom: "缩放",
    hgoStates: "个州",
    hgoSea: "个海域州",
    hgoProvinces: "个省份",

    faqTitle: "你可能想知道。",
    faqOneQuestion: "项目存在哪里？",
    faqOneAnswer: "项目文件保存在本机。浏览器也会自动保存草稿，方便你恢复。",
    faqTwoQuestion: "两个编辑器有什么区别？",
    faqTwoAnswer: "Scenario Forge 可以编辑不同剧本的地图。HGO 地图集直接在模组的像素地图上逐州编辑，需要支持 WebGL 2 的浏览器。两款编辑器的项目文件不互通。",
    faqThreeQuestion: "怎样分享地图或项目？",
    faqThreeAnswer: "可导出最高 4 倍分辨率的 PNG 或 JPG。要分享可编辑的项目，先把项目文件放到可公开访问的 HTTPS 地址，再生成分享链接。地图数据来自 Natural Earth、geoBoundaries、OpenStreetMap 等开放来源，分享时请按各自的许可注明出处。模组素材按各自条款使用。",
    faqSourcesLink: "查看全部数据来源",
    ctaTitle: "下一个世界，等你落笔。",
    ctaPrimary: "开始制图",
    ctaGithub: "在 GitHub 上查看",
    ctaShotAlt: "Scenario Forge 编辑器：TNO 1962 的欧洲，左侧是颜色库，下方是绘制工具",
    footerNote: "为架空历史与世界观创作打造的政治地图工作室。",
  },
};

export const LANGUAGES = Object.keys(COPY);

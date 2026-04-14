const STORAGE_KEY = "scenario_forge_landing_lang";

const translations = {
  en: {
    skipLink: "Skip to content",
    navWorks: "Works",
    navWorkflow: "Workflow",
    navFeatures: "Features",
    navRoadmap: "In progress",
    headerGithub: "GitHub",
    headerOpenApp: "Open demo",
    heroEyebrow: "Scenario-first political map workbench",
    heroTitle: "Forge political maps that feel alive.",
    heroBody:
      "Build from a world state, reshape ownership and control, layer context, and export a map that can actually carry a story.",
    heroPrimaryCta: "Open live demo",
    heroSecondaryCta: "View on GitHub",
    heroFactOne:
      "Built-in world states: Blank, Modern World, HOI4 1936, HOI4 1939, and TNO 1962.",
    heroFactTwo:
      "Political editing, context layers, bilingual UI, project save/load, PNG and JPG export.",
    heroFactThree:
      "Made for alternate history, strategy modding, and geopolitical storytelling.",
    heroChipOne: "World states",
    heroChipTwo: "Political ownership",
    heroChipThree: "Context layers",
    heroChipFour: "Export-ready",
    worksEyebrow: "Selected works",
    worksTitle: "Show the result first.",
    worksBody:
      "Scenario Forge is easiest to understand when you see the maps it can produce, not when you read a wall of feature names.",
    workOneLabel: "Alternate history baseline",
    workOneTitle: "Start from a scenario, not a blank canvas.",
    workOneBody:
      "Switch between named world states, keep political context intact, and begin from something that already carries narrative meaning.",
    workTwoLabel: "Conflict and context",
    workTwoTitle: "Overlay political change with real-world texture.",
    workTwoBody:
      "Blend ownership, labels, urban lights, and context layers to move from editor output toward presentation-ready storytelling.",
    workThreeLabel: "Atlas-style output",
    workThreeTitle: "Push toward a cleaner, calmer final map.",
    workThreeBody:
      "Dial back the noise, tune the layer stack, and export a map that reads like a finished visual, not just an internal workspace snapshot.",
    whyEyebrow: "Why Scenario Forge",
    whyTitle: "Stop stitching five tools together to tell one geopolitical story.",
    problemTitle: "Typical workflow",
    problemOne: "One tool for painting political states.",
    problemTwo: "Another for labels or overlays.",
    problemThree: "Another for exports or presentation cleanup.",
    problemFour: "No real scenario baseline to start from.",
    solutionTitle: "Scenario Forge",
    solutionOne: "Begin from a named world state.",
    solutionTwo:
      "Repaint ownership, controller, and frontline logic inside one workspace.",
    solutionThree:
      "Layer context and presentation surfaces without leaving the tool.",
    solutionFour: "Save the project or export the result when the story is ready.",
    workflowEyebrow: "Workflow",
    workflowTitle: "A short path from baseline to story-ready map.",
    stepOneTitle: "Start from a world state",
    stepOneBody:
      "Use built-in baselines like Blank Map, Modern World, HOI4 1936, HOI4 1939, or TNO 1962 to begin from an explicit scenario frame.",
    stepTwoTitle: "Repaint control and ownership",
    stepTwoBody:
      "Shift who owns what, who controls what, and how the map should read politically without rebuilding the whole surface from scratch.",
    stepThreeTitle: "Layer context and export",
    stepThreeBody:
      "Add rivers, urban areas, city points, water regions, special zones, legends, and visual refinements, then export a clean PNG or JPG snapshot.",
    featuresEyebrow: "Feature groups",
    featuresTitle: "Organized around tasks, not just panels.",
    featureGroupOneTitle: "Scenario baselines",
    featureGroupOneBody:
      "Named starting points, default scenarios, palette packs, and scenario-aware startup flow.",
    featureGroupTwoTitle: "Political editing",
    featureGroupTwoBody:
      "Ownership, controller, frontline-style views, brushes, selected objects, and scenario-level map changes.",
    featureGroupThreeTitle: "Presentation layers",
    featureGroupThreeBody:
      "Physical regions, rivers, urban areas, city points, water regions, special zones, legends, and display tuning.",
    featureGroupFourTitle: "Project and export",
    featureGroupFourBody:
      "Project save/load, bilingual UI, snapshot export, and a workspace that keeps editorial polish close to the map itself.",
    audienceEyebrow: "Built for",
    audienceTitle: "People who need the map to carry the scenario.",
    audienceOne: "Alternate-history creators",
    audienceTwo: "HOI4, TNO, and Kaiserreich modders",
    audienceThree: "Scenario and campaign designers",
    audienceFour: "Geopolitical storytellers",
    audienceFive: "Researchers and presenters",
    roadmapEyebrow: "In progress",
    roadmapTitle: "Transparent about what is ready and what is not.",
    roadmapBody:
      "Scenario Forge already has a strong core. Some transport-related surfaces are still intentionally presented as work in progress.",
    roadmapOneTitle: "Transport workbench",
    roadmapOneBody:
      "Partially complete. It exists, but it is not yet the center of the product story.",
    roadmapTwoTitle: "Japan road preview",
    roadmapTwoBody: "Currently the most mature transport sample inside the project.",
    roadmapThreeTitle: "Rail and other infrastructure families",
    roadmapThreeBody:
      "Still closer to baseline or shell stage and should be treated as in-progress, not product-defining yet.",
    ctaEyebrow: "Ready to open the workbench?",
    ctaTitle: "Step into the editor when you want to move from idea to map.",
    ctaBody:
      "The showcase explains the product. The editor is where you actually shape the scenario.",
    ctaPrimary: "Open the live demo",
    ctaSecondary: "Browse the repository",
    footerNote:
      "Built from scenario-aware map data, political state editing, and presentation-focused context layers.",
    footerSources:
      "Major data families include Natural Earth, geoBoundaries, GeoNames, NOAA ETOPO, NASA Black Marble, OpenStreetMap, and Geofabrik.",
    footerDemo: "Open demo",
    footerGithub: "GitHub",
    metaTitle: "Scenario Forge — Scenario-first political map workbench",
    metaDescription:
      "Scenario Forge is a scenario-first political map workbench for alternate history, strategy modding, and geopolitical storytelling.",
    metaOgDescription:
      "Build political maps that start from a world state, reshape control, layer context, and export a story-ready result.",
  },
  zh: {
    skipLink: "跳到正文",
    navWorks: "作品",
    navWorkflow: "流程",
    navFeatures: "能力",
    navRoadmap: "进行中",
    headerGithub: "GitHub",
    headerOpenApp: "打开 Demo",
    heroEyebrow: "Scenario-first 政治地图工作台",
    heroTitle: "让政治地图真正带着故事活起来。",
    heroBody:
      "从一个世界状态出发，改写归属与控制，叠加上下文图层，再导出一张真的能讲故事的地图。",
    heroPrimaryCta: "打开在线 Demo",
    heroSecondaryCta: "查看 GitHub",
    heroFactOne: "内置 Blank、Modern World、HOI4 1936、HOI4 1939、TNO 1962 等 world states。",
    heroFactTwo: "支持政治编辑、上下文图层、中英双语、项目保存回读，以及 PNG / JPG 导出。",
    heroFactThree: "面向 alternate history、strategy modding 与 geopolitical storytelling。",
    heroChipOne: "World states",
    heroChipTwo: "政治归属",
    heroChipThree: "上下文图层",
    heroChipFour: "可直接导出",
    worksEyebrow: "作品预览",
    worksTitle: "先看结果，再理解工具。",
    worksBody: "Scenario Forge 最容易打动人的，不是面板数量，而是它最终能做出什么样的地图结果。",
    workOneLabel: "架空历史基线",
    workOneTitle: "从 scenario 开始，而不是从空白底图开始。",
    workOneBody: "在命名 world state 之间切换，保留政治语境，从一开始就站在有叙事意味的地图上工作。",
    workTwoLabel: "冲突与上下文",
    workTwoTitle: "把政治变化和真实世界纹理叠在一起。",
    workTwoBody: "把 ownership、标签、夜光和 context layers 组合起来，让地图从编辑结果更接近可展示的叙事成品。",
    workThreeLabel: "Atlas 风格输出",
    workThreeTitle: "把地图往更干净、更沉静的成品方向推。",
    workThreeBody: "收掉噪音，整理图层结构，再导出一张更像最终视觉而不是工作台快照的地图。",
    whyEyebrow: "为什么是 Scenario Forge",
    whyTitle: "别再为了讲一个地缘政治故事，把五个工具硬拼在一起。",
    problemTitle: "常见工作流",
    problemOne: "一个工具画政治状态。",
    problemTwo: "另一个工具补标签或覆盖层。",
    problemThree: "再找一个工具处理导出或展示清理。",
    problemFour: "一开始还没有真正可用的 scenario baseline。",
    solutionTitle: "Scenario Forge",
    solutionOne: "直接从一个命名 world state 出发。",
    solutionTwo: "在同一个工作台里改 ownership、controller 与 frontline 逻辑。",
    solutionThree: "不离开工具就能叠上下文和表现层。",
    solutionFour: "故事成熟之后，保存项目或直接导出结果。",
    workflowEyebrow: "工作流程",
    workflowTitle: "从 baseline 到可讲故事地图，一条更短的路。",
    stepOneTitle: "从 world state 开始",
    stepOneBody: "用 Blank Map、Modern World、HOI4 1936、HOI4 1939 或 TNO 1962 这样的基线，把工作起点锁在明确场景上。",
    stepTwoTitle: "改写控制与归属",
    stepTwoBody: "不必重画整张底图，就能直接调整谁拥有什么、谁控制什么，以及地图应该如何在政治上被阅读。",
    stepThreeTitle: "叠图层并导出",
    stepThreeBody: "叠加河流、城市点、水域、特殊区域、图例和展示层，然后导出干净的 PNG 或 JPG。",
    featuresEyebrow: "能力分组",
    featuresTitle: "围绕任务组织，而不是围绕面板名字组织。",
    featureGroupOneTitle: "Scenario baselines",
    featureGroupOneBody: "命名起点、默认场景、palette packs，以及 scenario-aware 的启动流程。",
    featureGroupTwoTitle: "Political editing",
    featureGroupTwoBody: "ownership、controller、frontline 风格视图、笔刷、选中对象与 scenario 级地图改写。",
    featureGroupThreeTitle: "Presentation layers",
    featureGroupThreeBody: "physical regions、rivers、urban areas、city points、water regions、special zones、legend 与显示调优。",
    featureGroupFourTitle: "Project and export",
    featureGroupFourBody: "项目保存回读、中英双语、快照导出，以及更贴近成品表达的工作流。",
    audienceEyebrow: "适合谁",
    audienceTitle: "适合那些需要让地图承载 scenario 的人。",
    audienceOne: "架空历史创作者",
    audienceTwo: "HOI4、TNO、Kaiserreich modder",
    audienceThree: "Scenario 与 campaign 设计者",
    audienceFour: "地缘政治叙事创作者",
    audienceFive: "研究者与展示者",
    roadmapEyebrow: "进行中",
    roadmapTitle: "清楚说明什么已经可用，什么还没完成。",
    roadmapBody: "Scenario Forge 的核心已经很鲜明，但 transport 相关能力目前仍然是有意保持透明的进行中状态。",
    roadmapOneTitle: "Transport workbench",
    roadmapOneBody: "已经有基础，但还不是这个产品当下的主叙事中心。",
    roadmapTwoTitle: "Japan road preview",
    roadmapTwoBody: "目前是 transport 相关样例里最成熟的一块。",
    roadmapThreeTitle: "Rail 和其他基础设施 family",
    roadmapThreeBody: "目前更接近 baseline 或 shell 阶段，应被视为进行中，而不是产品主卖点。",
    ctaEyebrow: "准备打开工作台了吗？",
    ctaTitle: "当你想从想法走到地图，就进入编辑器。",
    ctaBody: "展示页负责讲清楚产品，编辑器负责真正把 scenario 落到地图上。",
    ctaPrimary: "打开在线 Demo",
    ctaSecondary: "浏览仓库",
    footerNote: "围绕 scenario-aware 地图数据、政治状态编辑和偏展示表达的上下文图层构建。",
    footerSources: "主要数据家族包括 Natural Earth、geoBoundaries、GeoNames、NOAA ETOPO、NASA Black Marble、OpenStreetMap 与 Geofabrik。",
    footerDemo: "打开 Demo",
    footerGithub: "GitHub",
    metaTitle: "Scenario Forge — Scenario-first 政治地图工作台",
    metaDescription: "Scenario Forge 是一个面向 alternate history、strategy modding 与 geopolitical storytelling 的 scenario-first 政治地图工作台。",
    metaOgDescription: "从一个 world state 出发，改写控制与归属，叠加上下文图层，再导出成故事就绪的政治地图。",
  },
};

function getStoredLanguage() {
  try {
    const value = String(globalThis.localStorage?.getItem(STORAGE_KEY) || "").trim().toLowerCase();
    return value === "zh" ? "zh" : "en";
  } catch (_error) {
    return "en";
  }
}

function applyLanguage(language) {
  const copy = translations[language] || translations.en;
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    const key = node.getAttribute("data-i18n");
    if (!key || !(key in copy)) return;
    node.textContent = copy[key];
  });
  document.querySelectorAll("[data-lang]").forEach((button) => {
    const active = button.getAttribute("data-lang") === language;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });

  document.title = copy.metaTitle;
  const description = document.querySelector('meta[name="description"]');
  const ogDescription = document.querySelector('meta[property="og:description"]');
  const twitterDescription = document.querySelector('meta[name="twitter:description"]');
  const ogTitle = document.querySelector('meta[property="og:title"]');
  const twitterTitle = document.querySelector('meta[name="twitter:title"]');

  if (description) description.setAttribute("content", copy.metaDescription);
  if (ogDescription) ogDescription.setAttribute("content", copy.metaOgDescription);
  if (twitterDescription) twitterDescription.setAttribute("content", copy.metaDescription);
  if (ogTitle) ogTitle.setAttribute("content", copy.metaTitle);
  if (twitterTitle) twitterTitle.setAttribute("content", copy.metaTitle);

  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, language);
  } catch (_error) {
    // noop
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const initialLanguage = getStoredLanguage();
  applyLanguage(initialLanguage);
  document.querySelectorAll("[data-lang]").forEach((button) => {
    button.addEventListener("click", () => {
      applyLanguage(button.getAttribute("data-lang") === "zh" ? "zh" : "en");
    });
  });
});

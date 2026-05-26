export const messages = {
  "zh-CN": {
    appTitle: "Anna Researcher",
    appSubtitle: "仅研究报告",
    connected: "已连接",
    standalone: "独立模式",
    languageChinese: "中文",
    languageEnglish: "English",
    researchInputAria: "研究输入",
    queryLabel: "研究问题",
    queryPlaceholder: "想让 Anna 研究什么？",
    domainSummary: "限定网站",
    domainPlaceholder: "example.com, docs.example.com",
    startButton: "开始研究",
    startButtonBusy: "正在启动",
    advanceButton: "推进",
    statusAria: "研究状态",
    resultAria: "研究结果",
    idleStageLabel: "空闲",
    emptyMessage: "准备就绪。",
    emptyReport: "报告会显示在这里。",
    sourcesHeading: "来源",
    sourceCount: "{count} 个来源",
    enterQueryError: "请输入研究问题。",
    runtimeMissing: "Anna runtime 未连接。",
    statusUnknown: "未知状态",
    stageUnknown: "未知阶段",
    statusCreated: "已创建",
    statusRunning: "研究中",
    statusCompleted: "已完成",
    statusFailed: "失败",
    statusCancelled: "已取消",
    stageIdle: "准备就绪。",
    stageSelectRole: "正在选择研究角色。",
    stagePlanQueries: "正在规划有限搜索查询。",
    stageSearchNextQuery: "正在搜索 {current}/{total}。",
    stageSelectContext: "正在筛选上下文。",
    stageWriteReport: "正在撰写报告。",
    stageCompleted: "研究完成。",
    stageFailed: "研究失败。",
    busyStarting: "正在启动研究。",
    busyRunning: "正在推进研究。",
    busyLoadingResult: "正在加载报告。",
    completedMessage: "研究完成。",
    failedMessage: "研究失败。",
    cancelledMessage: "研究已取消。",
    errorMissingTavily: "缺少 Tavily 凭据，无法开始网页检索。",
    errorSamplingFailed: "Anna Sampling 调用失败。",
    errorRetrievalFailed: "网页检索失败。",
    errorToolFailed: "研究工具调用失败。",
    errorNotReady: "研究结果尚未准备好。",
    errorInvalidAction: "研究工具收到不支持的操作。",
    errorUnknown: "发生未知错误。",
    technicalDetails: "技术详情：{message}",
  },
  en: {
    appTitle: "Anna Researcher",
    appSubtitle: "Research Report Only",
    connected: "Connected",
    standalone: "Standalone",
    languageChinese: "中文",
    languageEnglish: "English",
    researchInputAria: "Research input",
    queryLabel: "Research query",
    queryPlaceholder: "What should Anna research?",
    domainSummary: "Domain filter",
    domainPlaceholder: "example.com, docs.example.com",
    startButton: "Start Research",
    startButtonBusy: "Starting",
    advanceButton: "Advance",
    statusAria: "Research status",
    resultAria: "Research result",
    idleStageLabel: "Idle",
    emptyMessage: "Ready.",
    emptyReport: "The report will appear here.",
    sourcesHeading: "Sources",
    sourceCount: "{count} sources",
    enterQueryError: "Enter a research query.",
    runtimeMissing: "Anna runtime is not connected.",
    statusUnknown: "Unknown status",
    stageUnknown: "Unknown stage",
    statusCreated: "Created",
    statusRunning: "Running",
    statusCompleted: "Completed",
    statusFailed: "Failed",
    statusCancelled: "Cancelled",
    stageIdle: "Ready.",
    stageSelectRole: "Selecting the research role.",
    stagePlanQueries: "Planning bounded search queries.",
    stageSearchNextQuery: "Searching {current}/{total}.",
    stageSelectContext: "Selecting context.",
    stageWriteReport: "Writing the report.",
    stageCompleted: "Research complete.",
    stageFailed: "Research failed.",
    busyStarting: "Starting research.",
    busyRunning: "Advancing research.",
    busyLoadingResult: "Loading report.",
    completedMessage: "Research complete.",
    failedMessage: "Research failed.",
    cancelledMessage: "Research cancelled.",
    errorMissingTavily: "Missing Tavily credential for web retrieval.",
    errorSamplingFailed: "Anna Sampling failed.",
    errorRetrievalFailed: "Web retrieval failed.",
    errorToolFailed: "Research tool invocation failed.",
    errorNotReady: "Research result is not ready yet.",
    errorInvalidAction: "The research tool received an unsupported action.",
    errorUnknown: "An unknown error occurred.",
    technicalDetails: "Technical details: {message}",
  },
} as const;

export type Locale = keyof typeof messages;
export type MessageKey = keyof (typeof messages)["en"];
export type MessageParams = Record<string, string | number | undefined>;

export const locales: Locale[] = ["zh-CN", "en"];
export const localeStorageKey = "anna-researcher.locale";

export function isLocale(value: string | null | undefined): value is Locale {
  return value === "zh-CN" || value === "en";
}

export function detectInitialLocale(language: string, stored?: string | null): Locale {
  if (isLocale(stored)) return stored;
  return language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function createTranslator(locale: Locale) {
  return (key: MessageKey, params: MessageParams = {}) => formatMessage(messages[locale][key], params);
}

export function formatMessage(template: string, params: MessageParams): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => String(params[key] ?? ""));
}

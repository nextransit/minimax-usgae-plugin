import * as https from "https";
import * as vscode from "vscode";
import {
  buildCompactStatusText,
  buildCompactTooltipTable,
  formatEnglishCountdownFriendly,
  formatEnglishDurationCompact,
  getCompactTooltipLabels,
  selectCompactProgressColor,
  selectCompactStateIcon,
  selectCompactStatusIcon,
} from "./compactView";

const SECRET_API_KEY = "minimaxUsage.apiKey";
const REMAINS_ENDPOINT = "https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains";

type ModelRemain = {
  start_time?: number;
  end_time?: number;
  remains_time?: number;
  current_interval_total_count?: number;
  current_interval_usage_count?: number;
  model_name?: string;
  current_weekly_total_count?: number;
  current_weekly_usage_count?: number;
  weekly_remains_time?: number;
};

type MiniMaxRawPayload = {
  base_resp?: {
    status_code?: number;
    status_msg?: string;
  };
  status_code?: number;
  status_msg?: string;
  model_remains?: ModelRemain[];
};

type UsageViewModel = {
  ok: boolean;
  statusLabel: string;
  primaryModelName: string;
  timeWindow: string;
  resetInLabel: string;
  resetTimestamp: number | null;
  totalCount: number | null;
  remainingCount: number | null;
  usedCount: number | null;
  usedPercent: number | null;
  weeklyTotalCount: number | null;
  weeklyUsedCount: number | null;
  weeklyRemainingCount: number | null;
  weeklyUsedPercent: number | null;
  weeklyResetTimestamp: number | null;
  weeklyResetInLabel: string;
  intervalLabel: string;
  models: Array<{
    name: string;
    timeWindow: string;
    totalCount: number;
    remainingCount: number;
    usedCount: number;
  }>;
  raw: unknown;
};

type RemainsResult = {
  ok: boolean;
  statusCode: number | null;
  summary: string;
  raw: unknown;
};

type LanguagePreference = "auto" | "zh-CN" | "en";
type UiLanguage = "zh-CN" | "en";

type ExtensionConfig = {
  refreshIntervalSeconds: number;
  showWeeklyInStatusBar: boolean;
  detailModelLimit: number;
  statusBarAlignment: "left" | "right";
  requestTimeoutMs: number;
  language: LanguagePreference;
};

type StatusItemSpec = {
  alignment: vscode.StatusBarAlignment;
  priority: number;
  text: string;
  tooltip?: vscode.MarkdownString | string;
  command?: string;
  color?: string | vscode.ThemeColor;
  backgroundColor?: vscode.ThemeColor;
};

type ManagedStatusItem = {
  item: vscode.StatusBarItem;
  alignment: vscode.StatusBarAlignment;
  priority: number;
  cachedTooltipRaw?: string;
};

let contextRef: vscode.ExtensionContext | undefined;
let statusItems: ManagedStatusItem[] = [];
let output: vscode.OutputChannel | undefined;
let refreshTimer: NodeJS.Timeout | undefined;
let countdownTimer: NodeJS.Timeout | undefined;
let latestVm: UsageViewModel | null = null;
let latestRawResponse: unknown = null;
let lastUpdatedAt: Date | null = null;
let hasApiKey = false;
let isRefreshing = false;
let hasAlertedHighRisk = false;
let detailsPanel: vscode.WebviewPanel | undefined;
let cachedDetailsHtml: string | undefined;
let cachedNonce: string | undefined;

const emptyUsageViewModel = {
  primaryModelName: "",
  timeWindow: "",
  resetInLabel: "",
  resetTimestamp: null,
  totalCount: null,
  remainingCount: null,
  usedCount: null,
  usedPercent: null,
  weeklyTotalCount: null,
  weeklyUsedCount: null,
  weeklyRemainingCount: null,
  weeklyUsedPercent: null,
  weeklyResetTimestamp: null,
  weeklyResetInLabel: "",
  intervalLabel: "",
  models: [],
} satisfies Omit<UsageViewModel, "ok" | "statusLabel" | "raw">;

function resolveUiLanguage(config: ExtensionConfig = readConfig()): UiLanguage {
  if (config.language === "zh-CN" || config.language === "en") {
    return config.language;
  }

  return vscode.env.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

function getRuntimeStrings(config: ExtensionConfig = readConfig()) {
  const language = resolveUiLanguage(config);
  const isEn = language === "en";

  return {
    language,
    isEn,
    outputChannelName: "MiniMax Usage",
    inputBoxTitle: "MiniMax Usage",
    inputBoxPrompt: isEn ? "Enter MiniMax API Key" : "输入 MiniMax API Key",
    inputBoxPlaceholder: "API Key",
    infoApiKeySaved: isEn ? "MiniMax API key saved" : "MiniMax API Key 已保存",
    infoApiKeyCleared: isEn ? "MiniMax API key cleared" : "MiniMax API Key 已清除",
    infoRawCopied: isEn ? "MiniMax raw response copied to clipboard" : "MiniMax 原始响应已复制到剪贴板",
    warnNoRawResponse: isEn ? "There is no raw response to copy yet" : "当前没有可复制的原始响应",
    warnSetApiKeyFirst: isEn ? "Please run \"MiniMax Usage: Set API Key\" first" : "请先运行 “MiniMax Usage: Set API Key”",
    warnRiskLowQuota:
      isEn
        ? "MiniMax risk warning: only "
        : "MiniMax 风险提示: 当前窗口剩余仅 ",
    warnRiskLowQuotaSuffix:
      isEn
        ? "% left in the current window. Consider lowering request frequency or switching models."
        : "%，即将耗尽！建议降低请求频率或切换模型。",
    errorQueryFailedPrefix: isEn ? "MiniMax query failed: " : "MiniMax 查询失败：",
    errorQueryExceptionPrefix: isEn ? "MiniMax query error: " : "MiniMax 查询异常：",
    errorUnknown: isEn ? "Unknown error" : "未知错误",
    statusQuerying: isEn ? "$(sync~spin) MiniMax: Querying..." : "$(sync~spin) MiniMax 查询中...",
    statusQueryingCompact: isEn ? "Refreshing..." : "刷新中...",
    statusSetApiKey: isEn ? "$(key) MiniMax: Set API Key" : "$(key) MiniMax: 设置 API Key",
    statusSetApiKeyCompact: isEn ? "Set API Key" : "设置 API Key",
    statusWaitingRefresh: isEn ? "$(sync) MiniMax: Waiting to refresh" : "$(sync) MiniMax: 等待刷新",
    statusWaitingRefreshCompact: isEn ? "Waiting to refresh" : "等待刷新",
    statusWeekly: isEn ? "  Week: " : "  每周: ",
    tooltipTitle: "MiniMax Token Plan",
    tooltipRefreshing: isEn ? "$(sync~spin) Refreshing data..." : "$(sync~spin) 正在刷新数据...",
    tooltipWaiting: isEn ? "Waiting for the first refresh.  \n" : "等待首次刷新。  \n",
    tooltipMissingKey: isEn ? "API key is not configured.  \n" : "未配置 API Key。  \n",
    actionRefresh: isEn ? "Refresh" : "刷新",
    actionRefreshNow: isEn ? "Refresh now" : "立即刷新",
    actionSetKey: isEn ? "Set Key" : "设置 Key",
    actionSetApiKey: isEn ? "Set API Key" : "设置 API Key",
    actionClearKey: isEn ? "Clear Key" : "清除 Key",
    actionCopyRaw: isEn ? "Copy raw response" : "复制原始响应",
    detailsPanelTitle: isEn ? "MiniMax Usage Details" : "MiniMax 用量详情",
    detailTooltipHeading: isEn ? "MiniMax Token Plan Details" : "MiniMax Token Plan 详细信息",
    detailStatus: isEn ? "Status" : "状态",
    detailPrimaryModel: isEn ? "Primary model" : "主模型",
    detailTimeWindow: isEn ? "Time window" : "时间窗口",
    detailResetCountdown: isEn ? "Window reset countdown" : "窗口重置倒计时",
    detailMetric: isEn ? "Metric" : "指标",
    detailValue: isEn ? "Value" : "数值",
    detailUsed: isEn ? "Used" : "已使用",
    detailRemaining: isEn ? "Remaining" : "剩余",
    detailTotal: isEn ? "Total quota" : "总额度",
    detailWindowProgress: isEn ? "Window progress" : "窗口进度",
    detailWeeklyUsed: isEn ? "Weekly used" : "本周已使用",
    detailWeeklyRemaining: isEn ? "Weekly remaining" : "本周剩余",
    detailWeeklyTotal: isEn ? "Weekly total" : "本周总额度",
    detailWeeklyProgress: isEn ? "Weekly progress" : "本周进度",
    detailWeeklyResetCountdown: isEn ? "Weekly reset countdown" : "本周重置倒计时",
    detailUpdatedAt: isEn ? "Updated at" : "更新时间",
    detailModelDetails: isEn ? "Model details" : "模型明细",
    detailModelListTitle: (limit: number) =>
      isEn ? `Model details (top ${limit} items)` : `模型明细（前 ${limit} 项）`,
    detailTopItemsLabel: isEn ? "top" : "前",
    detailItemsSuffix: isEn ? "items" : "项",
    unknown: isEn ? "Unknown" : "未知",
    unknownModel: isEn ? "Unknown Model" : "未知模型",
    labelSeparator: isEn ? ": " : "：",
    timeZoneSuffix: isEn ? " (UTC+8)" : "（UTC+8）",
    panelUnconfiguredKey: isEn ? "Unconfigured API Key" : "未配置加密密钥",
    panelUnconfiguredDesc:
      isEn
        ? "System core features require MiniMax API Key authorization. Please enter your access key in the console to sync data."
        : "系统核心功能需要 MiniMax API Key 授权。请在控制台中输入您的访问密钥以同步数据。",
    panelInitAccess: isEn ? "INITIALIZE ACCESS" : "配置密钥",
    panelWaitingData: isEn ? "Waiting for Data Link" : "等待数据链路",
    panelWaitingDesc:
      isEn
        ? "Attempting to connect to MiniMax servers and sync the latest Token consumption metrics. Please ensure network connectivity."
        : "正在尝试连接 MiniMax 服务器并同步最新的 Token 消耗指标。请保持网络畅通。",
    panelRetrySync: isEn ? "RETRY SYNC" : "重试同步",
    panelDataBroken: isEn ? "Data Link Broken" : "数据链路中断",
    panelReconnect: isEn ? "RECONNECT" : "重新连接",
    panelEditKey: isEn ? "EDIT KEY" : "修改密钥",
    panelTitle: isEn ? "MINIMAX USAGE PANEL" : "MINIMAX 用量监控",
    panelModel: isEn ? "MODEL" : "当前模型",
    panelWindow: isEn ? "WINDOW" : "时间窗口",
    panelCurrentInterval: isEn ? "CURRENT INTERVAL" : "当前周期",
    panelConsumed: isEn ? "CONSUMED" : "已使用",
    panelAvailable: isEn ? "AVAILABLE" : "剩余量",
    panelLimit: isEn ? "LIMIT" : "总配额",
    panelResourceUtil: isEn ? "RESOURCE UTILIZATION" : "资源使用率",
    panelWeeklyAggregate: isEn ? "WEEKLY AGGREGATE" : "本周累计",
    panelUsed: isEn ? "USED" : "已使用",
    panelLeft: isEn ? "LEFT" : "剩余量",
    panelTotal: isEn ? "TOTAL" : "总额度",
    panelWeeklyQuota: isEn ? "WEEKLY QUOTA" : "本周进度",
    panelModelDetails: isEn ? "MODEL DETAILS" : "模型明细",
    panelTopItems: isEn ? "TOP" : "前",
    panelItemsSuffix: isEn ? "ITEMS" : "项",
    panelPerModelHint: isEn ? "Expand to inspect per-model quotas" : "展开查看各模型额度",
    panelPerModelEmpty: isEn ? "No model detail data available right now." : "当前暂无模型明细数据。",
    panelModelName: isEn ? "MODEL" : "模型",
    panelModelUsed: isEn ? "USED" : "已使用",
    panelModelRemaining: isEn ? "LEFT" : "剩余",
    panelModelTotal: isEn ? "TOTAL" : "总额度",
    panelModelWindow: isEn ? "WINDOW" : "时间窗口",
    panelUpdatedAt: isEn ? "UPDATED AT" : "更新时间",
    panelSyncedAt: isEn ? "SYNCED AT: " : "最后同步: ",
    panelSyncData: isEn ? "SYNC DATA" : "刷新数据",
    panelKeyConfig: isEn ? "KEY CONFIG" : "配置密钥",
    panelReset: isEn ? "RESET" : "清除缓存",
    panelRiskTitle: isEn ? "Risk Warning" : "风险提示",
    panelRiskRemaining: isEn ? "Current window remaining only " : "当前窗口剩余仅 ",
    panelRiskExhausted:
      isEn
        ? "Quota is almost exhausted. Suggest lowering request frequency or switching models!"
        : "额度即将耗尽，建议立即降低请求频率或切换模型！",
  panelRiskFast:
  isEn
  ? "Consuming quickly. Please monitor usage to avoid rate limits."
  : "消耗较快，请注意使用配额以避免被限流。",
  languageSwitchLabel: isEn ? "Language" : "语言",
  languageZhCN: isEn ? "中文" : "中文",
  languageEn: isEn ? "English" : "English",
  validationMissingKey: isEn ? "Missing API key" : "缺少 API Key",
    validationInvalidKey: isEn ? "Invalid API key format" : "API Key 格式无效",
    validationShortKey: isEn ? "API key is too short" : "API Key 长度不足",
    fetchSummarySuccess: isEn ? "Success" : "查询成功",
    fetchSummaryCheckApiKey: isEn ? "Please check whether the API key is correct" : "请检查 API Key 是否正确",
    fetchSummaryUnknownResponse: isEn ? "MiniMax returned an unrecognized response" : "MiniMax 返回了未识别响应",
    fetchSummaryRequestFailed: isEn ? "Failed to request MiniMax" : "请求 MiniMax 失败",
    fetchSummaryTimeout: isEn ? "Request timed out, please retry" : "请求超时，请重试",
    invalidJsonMessage: (statusCode: number) =>
      isEn ? `MiniMax returned invalid JSON (HTTP ${statusCode})` : `MiniMax 返回了无效 JSON（HTTP ${statusCode}）`,
    durationDay: isEn ? "d" : "天",
    durationHour: isEn ? "h" : "小时",
    durationMinute: isEn ? "m" : "分钟",
    webviewLang: isEn ? "en" : "zh-CN",
    localeTag: isEn ? "en-US" : "zh-CN",
  } as const;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  contextRef = context;
  output = vscode.window.createOutputChannel(getRuntimeStrings().outputChannelName);
  context.subscriptions.push(output);

  registerCommands(context);

  const existingApiKey = await context.secrets.get(SECRET_API_KEY);
  hasApiKey = Boolean(existingApiKey);

  recreateStatusBarItem();
  restartRefreshTimer();
  restartCountdownTicker();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("minimaxUsage")) {
        return;
      }

      const alignmentChanged = event.affectsConfiguration("minimaxUsage.statusBarAlignment");
      const languageChanged = event.affectsConfiguration("minimaxUsage.language");
      if (alignmentChanged) {
        recreateStatusBarItem();
      }

  if (languageChanged && latestRawResponse) {
    const rebuiltVm = rebuildUsageViewModelFromRaw(latestRawResponse);
    if (rebuiltVm) {
      latestVm = rebuiltVm;
    }
  }

  restartRefreshTimer();
  updateStatusBar();
  updateDetailsPanel();
}),
  );

  await refreshUsage("startup");
}

export function deactivate(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }

  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = undefined;
  }

  if (statusItems.length > 0) {
    for (const entry of statusItems) {
      entry.item.dispose();
    }
    statusItems = [];
  }

  if (detailsPanel) {
    detailsPanel.dispose();
    detailsPanel = undefined;
  }

  cachedDetailsHtml = undefined;
  cachedNonce = undefined;
}

function registerCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("minimaxUsage.setApiKey", async () => {
      const strings = getRuntimeStrings();
      const input = await vscode.window.showInputBox({
        title: strings.inputBoxTitle,
        prompt: strings.inputBoxPrompt,
        placeHolder: strings.inputBoxPlaceholder,
        password: true,
        ignoreFocusOut: true,
      });

      if (input === undefined) {
        return;
      }

      const apiKey = input.trim();
      const validation = validateApiKey(apiKey);
      if (!validation.ok) {
        vscode.window.showErrorMessage(validation.message);
        return;
      }

      await context.secrets.store(SECRET_API_KEY, apiKey);
      hasApiKey = true;
      log("API key updated");
      vscode.window.showInformationMessage(strings.infoApiKeySaved);
      await refreshUsage("manual");
    }),

    vscode.commands.registerCommand("minimaxUsage.clearApiKey", async () => {
      const strings = getRuntimeStrings();
      await context.secrets.delete(SECRET_API_KEY);
      hasApiKey = false;
      latestVm = null;
      latestRawResponse = null;
      lastUpdatedAt = null;
      log("API key cleared");
      updateStatusBar();
      vscode.window.showInformationMessage(strings.infoApiKeyCleared);
    }),

    vscode.commands.registerCommand("minimaxUsage.refresh", async () => {
      await refreshUsage("manual");
    }),

    vscode.commands.registerCommand("minimaxUsage.showDetails", async () => {
      showDetailsPanel();
    }),

    vscode.commands.registerCommand("minimaxUsage.copyRawResponse", async () => {
      const strings = getRuntimeStrings();
      if (!latestRawResponse) {
        vscode.window.showWarningMessage(strings.warnNoRawResponse);
        return;
      }

      await vscode.env.clipboard.writeText(JSON.stringify(latestRawResponse, null, 2));
      vscode.window.showInformationMessage(strings.infoRawCopied);
    }),
  );
}

function clearStatusItems(): void {
  for (const entry of statusItems) {
    entry.item.dispose();
  }
  statusItems = [];
}

function recreateStatusBarItem(): void {
  clearStatusItems();
  updateStatusBar();
}

function addStatusItem(
  specs: StatusItemSpec[],
  alignment: vscode.StatusBarAlignment,
  priority: number,
  text: string,
  tooltip?: vscode.MarkdownString | string,
  command?: string,
  color?: string | vscode.ThemeColor,
  backgroundColor?: vscode.ThemeColor,
): void {
  specs.push({
    alignment,
    priority,
    text,
    tooltip,
    command,
    color,
    backgroundColor,
  });
}

function applyStatusItemSpec(item: vscode.StatusBarItem, spec: StatusItemSpec, existing: ManagedStatusItem): void {
  item.text = spec.text;
  const tooltipKey = typeof spec.tooltip === 'string' ? spec.tooltip : spec.tooltip?.value;
  if (existing.cachedTooltipRaw !== tooltipKey) {
    item.tooltip = spec.tooltip;
    existing.cachedTooltipRaw = tooltipKey;
  }
  item.command = spec.command;
  item.color = spec.color;
  item.backgroundColor = spec.backgroundColor;
  item.show();
}

function renderStatusItems(specs: StatusItemSpec[]): void {
  for (let index = 0; index < specs.length; index += 1) {
    const spec = specs[index];
    const existing = statusItems[index];

    if (!existing || existing.alignment !== spec.alignment || existing.priority !== spec.priority) {
      existing?.item.dispose();

      statusItems[index] = {
        item: vscode.window.createStatusBarItem(spec.alignment, spec.priority),
        alignment: spec.alignment,
        priority: spec.priority,
        cachedTooltipRaw: undefined,
      };
    }

    applyStatusItemSpec(statusItems[index].item, spec, statusItems[index]);
  }

  for (let index = specs.length; index < statusItems.length; index += 1) {
    statusItems[index].item.dispose();
  }

  statusItems.length = specs.length;
}

function restartRefreshTimer(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }

  let intervalMs = readConfig().refreshIntervalSeconds * 1000;
  
  // 动态刷新：使用率大于80%时缩短刷新时间至10s
  if (latestVm && latestVm.usedPercent !== null && latestVm.usedPercent > 80) {
    intervalMs = 10000;
  }

  refreshTimer = setInterval(() => {
    void refreshUsage("auto");
  }, intervalMs);
}

function restartCountdownTicker(): void {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = undefined;
  }

  countdownTimer = setInterval(() => {
    updateStatusBar();
  }, 1000);
}

async function refreshUsage(reason: "startup" | "auto" | "manual"): Promise<void> {
  if (!contextRef || isRefreshing) {
    return;
  }

  const strings = getRuntimeStrings();

  const apiKey = (await contextRef.secrets.get(SECRET_API_KEY))?.trim() ?? "";
  hasApiKey = Boolean(apiKey);

  if (!hasApiKey) {
    latestVm = null;
    latestRawResponse = null;
    lastUpdatedAt = null;
    updateStatusBar();

    if (reason === "manual") {
      void vscode.window.showWarningMessage(strings.warnSetApiKeyFirst);
    }

    return;
  }

  const validation = validateApiKey(apiKey);
  if (!validation.ok) {
    latestVm = buildErrorViewModel(validation.message);
    latestRawResponse = null;
    lastUpdatedAt = new Date();
    updateStatusBar();
    if (reason === "manual") {
      void vscode.window.showErrorMessage(validation.message);
    }
    return;
  }

  try {
    isRefreshing = true;
    updateStatusBar();

    const timeoutMs = readConfig().requestTimeoutMs;
    const result = await fetchRemains(apiKey, timeoutMs);

    latestVm = buildUsageViewModel(result);
    latestRawResponse = result.raw;
    lastUpdatedAt = new Date();

    const statusCodeLabel = result.statusCode === null ? "N/A" : String(result.statusCode);
    log(`refresh completed [${reason}] ok=${result.ok} status=${statusCodeLabel} summary=${result.summary}`);

    // 高风险弹窗提示逻辑
    if (result.ok && latestVm && latestVm.usedPercent !== null) {
      if (latestVm.usedPercent >= 95) {
        if (!hasAlertedHighRisk) {
          void vscode.window.showWarningMessage(
            `${strings.warnRiskLowQuota}${100 - latestVm.usedPercent}${strings.warnRiskLowQuotaSuffix}`,
          );
          hasAlertedHighRisk = true;
        }
      } else {
        hasAlertedHighRisk = false;
      }
    }

      if (!result.ok && reason === "manual") {
        void vscode.window.showErrorMessage(`${strings.errorQueryFailedPrefix}${result.summary}`);
      }
    } catch (error) {
    const message = error instanceof Error ? error.message : strings.errorUnknown;
    latestVm = buildErrorViewModel(message);
    latestRawResponse = null;
    lastUpdatedAt = new Date();
    log(`refresh exception [${reason}] ${message}`);
    if (reason === "manual") {
      void vscode.window.showErrorMessage(`${strings.errorQueryExceptionPrefix}${message}`);
    }
  } finally {
    isRefreshing = false;
    updateStatusBar();

    // 手动刷新后，短暂隐藏/显示 status bar item 以强制刷新 tooltip
    if (reason === "manual") {
      for (const entry of statusItems) {
        entry.item.hide();
      }
      setTimeout(() => {
        for (const entry of statusItems) {
          entry.item.show();
        }
      }, 50);
    }
  }
}

function updateStatusBar(): void {
  const config = readConfig();
  const strings = getRuntimeStrings(config);
  const alignment =
    config.statusBarAlignment === "right"
      ? vscode.StatusBarAlignment.Right
      : vscode.StatusBarAlignment.Left;
  const basePriority = 100;
  const specs: StatusItemSpec[] = [];

  if (isRefreshing && !latestVm) {
    addStatusItem(
      specs,
      alignment,
      basePriority,
      `${selectCompactStateIcon("refreshing")} ${strings.statusQueryingCompact}`,
      buildRefreshingTooltip(),
      "minimaxUsage.showDetails",
    );
    renderStatusItems(specs);
    updateDetailsPanel();
    return;
  }

  if (!hasApiKey) {
    addStatusItem(
      specs,
      alignment,
      basePriority,
      `${selectCompactStateIcon("missingKey")} ${strings.statusSetApiKeyCompact}`,
      buildMissingKeyTooltip(),
      "minimaxUsage.setApiKey",
      new vscode.ThemeColor("statusBarItem.warningForeground"),
    );
    renderStatusItems(specs);
    updateDetailsPanel();
    return;
  }

  if (!latestVm) {
    addStatusItem(
      specs,
      alignment,
      basePriority,
      `${selectCompactStateIcon("waiting")} ${strings.statusWaitingRefreshCompact}`,
      buildWaitingTooltip(),
      "minimaxUsage.refresh",
      new vscode.ThemeColor("statusBarItem.prominentForeground"),
    );
    renderStatusItems(specs);
    updateDetailsPanel();
    return;
  }

  if (!latestVm.ok) {
    addStatusItem(
      specs,
      alignment,
      basePriority,
      `${selectCompactStateIcon("error")} ${truncate(latestVm.statusLabel, 40)}`,
      buildDetailsTooltip(latestVm, config),
      "minimaxUsage.showDetails",
      new vscode.ThemeColor("statusBarItem.warningForeground"),
      new vscode.ThemeColor("statusBarItem.warningBackground"),
    );
    renderStatusItems(specs);
    updateDetailsPanel();
    return;
  }

  // 正常显示逻辑 - 简化格式
  const tooltip = buildDetailsTooltip(latestVm, config);
  const command = "minimaxUsage.showDetails";
  const usedPercent = latestVm.usedPercent ?? 0;
  const resetLabel = latestVm.resetTimestamp
    ? formatEnglishCountdownFriendly(latestVm.resetTimestamp)
    : "";
  const percentColor = selectCompactProgressColor(usedPercent);
  const weeklyPercent =
    config.showWeeklyInStatusBar && latestVm.weeklyUsedPercent !== null
      ? latestVm.weeklyUsedPercent ?? 0
      : null;
  const weeklyResetLabel =
    config.showWeeklyInStatusBar && latestVm.weeklyResetTimestamp
      ? formatEnglishCountdownFriendly(latestVm.weeklyResetTimestamp)
      : "";
  const statusIcon = selectCompactStatusIcon({
    currentPercent: usedPercent,
    weeklyPercent,
  });
  const compactStatusText = buildCompactStatusText({
    icon: statusIcon,
    currentPercent: usedPercent,
    currentResetLabel: resetLabel,
    weeklyPercent,
    weeklyResetLabel,
  });

  addStatusItem(
    specs,
    alignment,
    basePriority,
    `${isRefreshing ? "$(sync~spin) " : ""}${compactStatusText}`,
    tooltip,
    command,
    percentColor,
  );

  renderStatusItems(specs);
  updateDetailsPanel();
}

function buildRefreshingTooltip(): vscode.MarkdownString {
  const strings = getRuntimeStrings();
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${strings.tooltipTitle}**\n\n${strings.tooltipRefreshing}`);
  return md;
}

function buildWaitingTooltip(): vscode.MarkdownString {
  const strings = getRuntimeStrings();
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.supportThemeIcons = true;
  md.appendMarkdown(`**${strings.tooltipTitle}**\n\n${strings.tooltipWaiting}`);
  md.appendMarkdown(`[$(refresh) ${strings.actionRefreshNow}](command:minimaxUsage.refresh)`);
  return md;
}

function buildMissingKeyTooltip(): vscode.MarkdownString {
  const strings = getRuntimeStrings();
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.supportThemeIcons = true;
  md.appendMarkdown(`**${strings.tooltipTitle}**\n\n${strings.tooltipMissingKey}`);
  md.appendMarkdown(`[$(key) ${strings.actionSetApiKey}](command:minimaxUsage.setApiKey)`);
  return md;
}

function showDetailsPanel(): void {
  if (detailsPanel) {
    detailsPanel.reveal(vscode.ViewColumn.Active);
    updateDetailsPanel();
    return;
  }

  detailsPanel = vscode.window.createWebviewPanel(
    "minimaxUsage.details",
    getRuntimeStrings().detailsPanelTitle,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      enableCommandUris: true,
      retainContextWhenHidden: true,
    },
  );

  detailsPanel.onDidDispose(() => {
    detailsPanel = undefined;
  });

  detailsPanel.webview.onDidReceiveMessage(
    async (message) => {
      switch (message.command) {
        case "setLanguage":
          await setLanguage(message.language);
          break;
        case "toggleLanguage":
          await toggleLanguage();
          break;
      }
    },
    undefined,
    contextRef?.subscriptions,
  );

  updateDetailsPanel();
}

async function setLanguage(language: string): Promise<void> {
  const config = vscode.workspace.getConfiguration("minimaxUsage");
  if (language === "zh-CN" || language === "en") {
    await config.update("language", language, true);
  }
}

async function toggleLanguage(): Promise<void> {
  const config = readConfig();
  const newLang = config.language === "en" ? "zh-CN" : "en";
  await setLanguage(newLang);
}

function updateDetailsPanel(): void {
  if (!detailsPanel) {
    return;
  }

  const newHtml = renderDetailsPanelHtml();
  if (cachedDetailsHtml !== newHtml) {
    cachedDetailsHtml = newHtml;
    detailsPanel.title = getRuntimeStrings().detailsPanelTitle;
    detailsPanel.webview.html = newHtml;
  }
}

function renderDetailsPanelHtml(): string {
  const config = readConfig();
  const strings = getRuntimeStrings(config);

  const i18n = {
    labelSeparator: strings.labelSeparator,
    unconfiguredKey: strings.panelUnconfiguredKey,
    unconfiguredDesc: strings.panelUnconfiguredDesc,
    initAccess: strings.panelInitAccess,
    waitingData: strings.panelWaitingData,
    waitingDesc: strings.panelWaitingDesc,
    retrySync: strings.panelRetrySync,
    dataBroken: strings.panelDataBroken,
    reconnect: strings.panelReconnect,
    editKey: strings.panelEditKey,
    panelTitle: strings.panelTitle,
    model: strings.panelModel,
    window: strings.panelWindow,
    unknown: strings.unknown,
    na: "N/A",
    currentInterval: strings.panelCurrentInterval,
    consumed: strings.panelConsumed,
    available: strings.panelAvailable,
    limit: strings.panelLimit,
    resourceUtil: strings.panelResourceUtil,
    weeklyAggregate: strings.panelWeeklyAggregate,
    used: strings.panelUsed,
    left: strings.panelLeft,
    total: strings.panelTotal,
    weeklyQuota: strings.panelWeeklyQuota,
    modelDetails: strings.panelModelDetails,
    topItems: strings.panelTopItems,
    itemsSuffix: strings.panelItemsSuffix,
    perModelHint: strings.panelPerModelHint,
    perModelEmpty: strings.panelPerModelEmpty,
    modelName: strings.panelModelName,
    modelUsed: strings.panelModelUsed,
    modelRemaining: strings.panelModelRemaining,
    modelTotal: strings.panelModelTotal,
    modelWindow: strings.panelModelWindow,
    updatedAt: strings.panelUpdatedAt,
    syncedAt: strings.panelSyncedAt,
    syncData: strings.panelSyncData,
    keyConfig: strings.panelKeyConfig,
    reset: strings.panelReset,
    riskTitle: strings.panelRiskTitle,
    riskRemaining: strings.panelRiskRemaining,
    riskExhausted: strings.panelRiskExhausted,
  riskFast: strings.panelRiskFast,
  language: strings.languageSwitchLabel,
  languageZhCN: strings.languageZhCN,
  languageEn: strings.languageEn,
  languageSwitchLabel: strings.languageSwitchLabel,
  currentLanguage: config.language === "auto" ? (vscode.env.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en") : config.language,
};

  if (!hasApiKey) {
    return renderDetailsHtmlSkeleton(`
      <div class="empty-state">
        <div class="empty-icon-glow">🔑</div>
        <h2>${i18n.unconfiguredKey}</h2>
        <p>${i18n.unconfiguredDesc}</p>
        <div class="actions center">
          <a class="btn btn-neon" href="command:minimaxUsage.setApiKey">
            <span class="btn-text">${i18n.initAccess}</span>
          </a>
        </div>
      </div>
    `);
  }

  if (!latestVm) {
    return renderDetailsHtmlSkeleton(`
      <div class="empty-state">
        <div class="empty-icon-glow">📡</div>
        <h2>${i18n.waitingData}</h2>
        <p>${i18n.waitingDesc}</p>
        <div class="actions center">
          <a class="btn btn-neon" href="command:minimaxUsage.refresh">
            <span class="btn-text">${i18n.retrySync}</span>
          </a>
        </div>
      </div>
    `);
  }

  if (!latestVm.ok) {
    return renderDetailsHtmlSkeleton(`
      <div class="empty-state error">
        <div class="empty-icon-glow">⚠️</div>
        <h2>${i18n.dataBroken}</h2>
        <p class="error-msg">${escapeHtml(latestVm.statusLabel)}</p>
        <div class="actions center">
          <a class="btn btn-neon danger" href="command:minimaxUsage.refresh">
            <span class="btn-text">${i18n.reconnect}</span>
          </a>
          <a class="btn" href="command:minimaxUsage.setApiKey">
            <span class="btn-text">${i18n.editKey}</span>
          </a>
        </div>
      </div>
    `);
  }

  const usedPercent = latestVm.usedPercent ?? 0;
  const weeklyUsedPercent = latestVm.weeklyUsedPercent ?? 0;
  
  const windowProgress = clampPercent(usedPercent);
  const weeklyProgress = clampPercent(weeklyUsedPercent);
  const windowStatus = usedPercent >= 90 ? "critical" : usedPercent >= 70 ? "warning" : "normal";
  const weeklyStatus = weeklyUsedPercent >= 90 ? "critical" : weeklyUsedPercent >= 70 ? "warning" : "normal";
  
  const updatedAt = lastUpdatedAt ? formatDateTime(lastUpdatedAt.getTime()) : i18n.na;
  const modelDetailHtml = renderModelDetailsSection(latestVm, config, i18n, updatedAt);

  return renderDetailsHtmlSkeleton(`
    <div class="dashboard">
      <header class="main-header">
        <div class="logo-area">
          <div class="logo-pulse"></div>
          <h1 class="glow-text">${i18n.panelTitle}</h1>
        </div>
  <div class="header-info">
  <div class="info-tag">
  <span class="tag-label">${i18n.model}</span>
  <span class="tag-value">${escapeHtml(latestVm.primaryModelName || i18n.unknown)}</span>
  </div>
  <div class="info-tag">
  <span class="tag-label">${i18n.window}</span>
  <span class="tag-value">${escapeHtml(latestVm.intervalLabel || i18n.na)}</span>
  </div>
            <div class="language-switcher">
              <button id="langToggleBtn" class="lang-toggle" type="button" title="${i18n.languageSwitchLabel}">
                <span class="lang-icon">🌐</span>
                <span class="lang-option ${i18n.currentLanguage === "zh-CN" ? "active" : ""}">中</span>
                <span class="lang-divider">/</span>
                <span class="lang-option ${i18n.currentLanguage === "en" ? "active" : ""}">En</span>
              </button>
            </div>
  </div>
  </header>

      <div class="stats-container">
        <!-- Current Window Card -->
        <section class="cyber-card ${windowStatus}">
          <div class="card-glow"></div>
          <div class="card-header">
            <h3 class="card-title"><span class="icon">⚡</span> ${i18n.currentInterval}</h3>
            <div class="reset-timer">
              <span class="timer-icon">⏳</span>
              <span class="timer-value" data-timestamp="${latestVm.resetTimestamp || 0}">--:--:--</span>
            </div>
          </div>
          
          <div class="data-grid">
            <div class="data-item">
              <span class="data-label">${i18n.consumed}</span>
              <span class="data-value highlight">${formatNumber(latestVm.usedCount)}</span>
            </div>
            <div class="data-item">
              <span class="data-label">${i18n.available}</span>
              <span class="data-value success ${windowStatus}">${formatNumber(latestVm.remainingCount)}</span>
            </div>
            <div class="data-item">
              <span class="data-label">${i18n.limit}</span>
              <span class="data-value">${formatNumber(latestVm.totalCount)}</span>
            </div>
          </div>

          <div class="progress-wrap">
            <div class="progress-header">
              <span class="progress-label">${i18n.resourceUtil}</span>
              <span class="progress-percent ${windowStatus}">${latestVm.usedPercent}%</span>
            </div>
            <div class="cyber-progress-bar">
              <div class="progress-track"></div>
              <div class="progress-thumb ${windowStatus}" style="width: ${windowProgress}%">
                <div class="thumb-glow"></div>
              </div>
            </div>
          </div>
        </section>

        <!-- Weekly Card -->
        <section class="cyber-card secondary ${weeklyStatus}">
          <div class="card-glow"></div>
          <div class="card-header">
            <h3 class="card-title"><span class="icon">🗓️</span> ${i18n.weeklyAggregate}</h3>
            <div class="reset-timer">
              <span class="timer-icon">🕒</span>
              <span class="timer-value" data-timestamp="${latestVm.weeklyResetTimestamp || 0}">--:--:--</span>
            </div>
          </div>

          <div class="data-grid">
            <div class="data-item">
              <span class="data-label">${i18n.used}</span>
              <span class="data-value emphasize">${formatNumber(latestVm.weeklyUsedCount)}</span>
            </div>
            <div class="data-item">
              <span class="data-label">${i18n.left}</span>
              <span class="data-value success ${weeklyStatus}">${formatNumber(latestVm.weeklyRemainingCount)}</span>
            </div>
            <div class="data-item">
              <span class="data-label">${i18n.total}</span>
              <span class="data-value">${formatNumber(latestVm.weeklyTotalCount)}</span>
            </div>
          </div>

          <div class="progress-wrap">
            <div class="progress-header">
              <span class="progress-label">${i18n.weeklyQuota}</span>
              <span class="progress-percent ${weeklyStatus}">${latestVm.weeklyUsedPercent}%</span>
            </div>
            <div class="cyber-progress-bar">
              <div class="progress-track"></div>
              <div class="progress-thumb secondary ${weeklyStatus}" style="width: ${weeklyProgress}%">
                <div class="thumb-glow"></div>
              </div>
            </div>
          </div>
        </section>

        ${usedPercent >= 70 ? `
        <!-- Risk Warning Card -->
        <section class="cyber-card risk-alert ${windowStatus}">
          <div class="card-glow"></div>
          <div class="risk-content">
            <div class="risk-icon">${usedPercent >= 90 ? '🚨' : '⚠️'}</div>
            <div class="risk-text">
              <h3>${i18n.riskTitle}</h3>
              <ul>
                <li>${i18n.riskRemaining}${100 - usedPercent}%</li>
                <li>${usedPercent >= 90 ? i18n.riskExhausted : i18n.riskFast}</li>
              </ul>
            </div>
          </div>
        </section>
        ` : ''}
      </div>

      <footer class="cyber-footer">
        <div class="system-status">
          <div class="status-indicator"></div>
          <span class="last-update">${i18n.syncedAt}${updatedAt}</span>
        </div>
        <div class="cyber-actions">
          <a class="action-link neon" href="command:minimaxUsage.refresh">
            <span class="link-icon">🔄</span> ${i18n.syncData}
          </a>
          <a class="action-link" href="command:minimaxUsage.setApiKey">
            <span class="link-icon">🔑</span> ${i18n.keyConfig}
          </a>
          <a class="action-link danger" href="command:minimaxUsage.clearApiKey">
            <span class="link-icon">🗑️</span> ${i18n.reset}
          </a>
        </div>
      </footer>

      ${modelDetailHtml}
    </div>
  `);
}

function renderDetailsHtmlSkeleton(innerHtml: string): string {
  if (!cachedNonce) {
    cachedNonce = getNonce();
  }
  const nonce = cachedNonce;
  const strings = getRuntimeStrings();
  return `<!DOCTYPE html>
<html lang="${strings.webviewLang}">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src 'none'; img-src 'none';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    :root {
      --bg-dark: #05070a;
      --panel-bg: rgba(13, 17, 23, 0.7);
      --primary: #00d4ff;
      --secondary: #a855f7;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ff2e63;
      --text-bright: #ffffff;
      --text-dim: #94a3b8;
      --border: rgba(255, 255, 255, 0.1);
      --card-blur: blur(12px);
    }

    body {
      margin: 0;
      padding: 0;
      font-family: 'Inter', -apple-system, system-ui, sans-serif;
      color: var(--text-dim);
      background-color: var(--bg-dark);
      background-image: 
        radial-gradient(circle at 50% -20%, rgba(0, 212, 255, 0.15), transparent),
        linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px);
      background-size: 100% 100%, 30px 30px, 30px 30px;
      line-height: 1.5;
      min-height: 100vh;
      overflow-x: hidden;
    }

    .dashboard {
      max-width: 900px;
      margin: 0 auto;
      padding: 32px 24px;
    }

    .animate-in {
      animation: slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
    }

    @keyframes slideUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Header Styles */
    .main-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      margin-bottom: 40px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border);
    }

    .logo-area {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .logo-pulse {
      width: 12px;
      height: 12px;
      background: var(--primary);
      border-radius: 50%;
      box-shadow: 0 0 15px var(--primary);
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.5); opacity: 0.5; }
      100% { transform: scale(1); opacity: 1; }
    }

    .glow-text {
      font-size: 20px;
      font-weight: 900;
      letter-spacing: 4px;
      color: var(--text-bright);
      margin: 0;
      text-shadow: 0 0 10px rgba(0, 212, 255, 0.5);
    }

    .header-info {
      display: flex;
      gap: 24px;
    }

    .info-tag {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
    }

    .tag-label {
      font-size: 9px;
      font-weight: 800;
      color: var(--primary);
      letter-spacing: 1px;
    }

    .tag-value {
      font-size: 13px;
      color: var(--text-bright);
      font-weight: 600;
    }

    /* Card Styles */
    .stats-container {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
      gap: 24px;
    }

    .cyber-card {
      background: var(--panel-bg);
      backdrop-filter: var(--card-blur);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 30px;
      position: relative;
      overflow: hidden;
      transition: all 0.4s ease;
    }

    .cyber-card:hover {
      border-color: rgba(255, 255, 255, 0.3);
      background: rgba(255, 255, 255, 0.05);
    }

    .card-glow {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 4px;
      background: linear-gradient(90deg, var(--primary), var(--secondary));
      opacity: 0.6;
    }

    .cyber-card.critical .card-glow { background: var(--danger); }
    .cyber-card.warning .card-glow { background: var(--warning); }

    .card-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 24px;
    }

    .card-title {
      font-size: 14px;
      font-weight: 800;
      color: var(--text-bright);
      margin: 0;
      letter-spacing: 1px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .reset-timer {
      background: rgba(0, 0, 0, 0.3);
      padding: 4px 12px;
      border-radius: 20px;
      border: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .timer-icon { font-size: 12px; }
    .timer-value {
      font-family: 'SF Mono', monospace;
      font-size: 11px;
      color: var(--warning);
      font-weight: bold;
    }

    .data-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-bottom: 32px;
    }

    .data-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .data-label {
      font-size: 9px;
      font-weight: 700;
      color: var(--text-dim);
      letter-spacing: 0.5px;
    }

    .data-value {
      font-size: 18px;
      font-weight: 800;
      color: var(--text-bright);
      font-family: 'SF Mono', monospace;
    }

    .data-value.highlight { color: var(--primary); }
    .data-value.emphasize { color: var(--secondary); }
    .data-value.success { 
      color: var(--success); 
      animation: breathe-number 2s ease-in-out infinite;
    }
    .data-value.success.warning { color: var(--warning); }
    .data-value.success.critical { color: var(--danger); }

    @keyframes breathe-number {
      0%, 100% {
        font-size: 18px;
        opacity: 0.8;
        text-shadow: 0 0 4px var(--success);
      }
      50% {
        font-size: 22px;
        opacity: 1;
        text-shadow: 0 0 12px var(--success), 0 0 24px var(--success);
      }
    }

    /* Progress Styles */
    .progress-wrap {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .progress-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .progress-label {
      font-size: 10px;
      font-weight: 700;
      color: var(--text-dim);
    }

    .progress-percent {
      font-size: 16px;
      font-weight: 900;
      color: var(--primary);
    }

    .progress-percent.critical { color: var(--danger); }
    .progress-percent.warning { color: var(--warning); }

    .cyber-progress-bar {
      height: 6px;
      position: relative;
    }

    .progress-track {
      position: absolute;
      inset: 0;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 3px;
    }

    .progress-thumb {
      position: absolute;
      left: 0;
      top: 0;
      height: 100%;
      border-radius: 3px;
      background: linear-gradient(90deg, #3b82f6, var(--primary));
      transition: width 1s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .progress-thumb.secondary { background: linear-gradient(90deg, #8b5cf6, var(--secondary)); }
    .progress-thumb.critical { background: var(--danger); }
    .progress-thumb.warning { background: var(--warning); }

    .thumb-glow {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      width: 20px;
      background: inherit;
      filter: blur(8px);
      box-shadow: 0 0 10px rgba(0, 212, 255, 0.5);
    }

    /* Risk Alert Styles */
    .risk-alert {
      grid-column: 1 / -1;
      padding: 20px 30px;
      display: flex;
      align-items: center;
      background: rgba(245, 158, 11, 0.05);
      border-color: rgba(245, 158, 11, 0.3);
    }
    
    .risk-alert.critical {
      background: rgba(255, 46, 99, 0.05);
      border-color: rgba(255, 46, 99, 0.3);
    }
    
    .risk-content {
      display: flex;
      align-items: center;
      gap: 16px;
      width: 100%;
    }
    
    .risk-icon {
      font-size: 28px;
      filter: drop-shadow(0 0 8px var(--warning));
    }
    
    .risk-alert.critical .risk-icon {
      filter: drop-shadow(0 0 8px var(--danger));
    }
    
    .risk-text h3 {
      margin: 0 0 4px 0;
      font-size: 14px;
      color: var(--text-bright);
    }
    
    .risk-text ul {
      margin: 0;
      padding-left: 20px;
      font-size: 13px;
      color: var(--text-dim);
    }
    
    .risk-text li {
      margin-bottom: 2px;
    }

    /* Footer Styles */
    .cyber-footer {
      margin-top: 60px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 24px 0;
      border-top: 1px solid var(--border);
    }

    .system-status {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .status-indicator {
      width: 8px;
      height: 8px;
      background: var(--success);
      border-radius: 50%;
      box-shadow: 0 0 8px var(--success);
    }

    .last-update {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.5px;
    }

    .cyber-actions {
      display: flex;
      gap: 16px;
    }

    .action-link {
      color: var(--text-dim);
      text-decoration: none;
      font-size: 11px;
      font-weight: 800;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border: 1px solid var(--border);
      border-radius: 6px;
      transition: all 0.2s;
    }

    .action-link:hover {
      background: rgba(255, 255, 255, 0.05);
      color: var(--text-bright);
      border-color: var(--text-bright);
    }

    .action-link.neon {
      color: var(--primary);
      border-color: rgba(0, 212, 255, 0.3);
    }

    .action-link.neon:hover {
      box-shadow: 0 0 15px rgba(0, 212, 255, 0.2);
      border-color: var(--primary);
    }

    .action-link.danger:hover {
      color: var(--danger);
      border-color: var(--danger);
    }

    /* Model Details */
    .model-details-card {
      margin-top: 24px;
      padding: 0;
      overflow: hidden;
      transition: border-color 0.2s ease, background-color 0.2s ease;
    }

    .model-details-card:hover {
      transform: none;
      background: var(--panel-bg);
      border-color: rgba(255, 255, 255, 0.18);
    }

    .model-details {
      position: relative;
      z-index: 1;
    }

    .model-details[open] .model-details-summary {
      background: rgba(255, 255, 255, 0.04);
      border-bottom: 1px solid var(--border);
    }

    .model-details-summary {
      list-style: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 24px 30px;
      cursor: pointer;
      user-select: none;
    }

    .model-details-summary::-webkit-details-marker {
      display: none;
    }

    .model-details-summary:hover {
      background: rgba(255, 255, 255, 0.03);
    }

    .model-details-summary-left {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }

    .model-details-icon {
      font-size: 18px;
      filter: drop-shadow(0 0 8px rgba(0, 212, 255, 0.35));
    }

    .model-details-title {
      color: var(--text-bright);
      font-size: 14px;
      font-weight: 800;
      letter-spacing: 1px;
    }

    .model-details-summary-right {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-shrink: 0;
    }

    .model-details-badge {
      padding: 4px 10px;
      border-radius: 999px;
      border: 1px solid rgba(0, 212, 255, 0.28);
      background: rgba(0, 212, 255, 0.12);
      color: var(--primary);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.8px;
    }

    .model-details-hint {
      color: var(--text-dim);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.4px;
      text-align: right;
    }

    .model-details-chevron {
      width: 10px;
      height: 10px;
      border-right: 2px solid var(--primary);
      border-bottom: 2px solid var(--primary);
      transform: rotate(45deg);
      transition: transform 0.2s ease;
      margin-top: -3px;
    }

    .model-details[open] .model-details-chevron {
      transform: rotate(225deg);
      margin-top: 3px;
    }

    .model-details-body {
      padding: 0 30px 26px;
    }

    .model-details-scroll {
      overflow-x: auto;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.03);
    }

    .model-details-table {
      width: 100%;
      min-width: 720px;
      border-collapse: collapse;
    }

    .model-details-table thead th {
      padding: 14px 16px;
      text-align: left;
      color: var(--primary);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.8px;
      background: rgba(0, 0, 0, 0.16);
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }

    .model-details-table tbody td {
      padding: 14px 16px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      color: var(--text-dim);
      font-size: 13px;
      white-space: nowrap;
    }

    .model-details-table tbody tr:first-child td {
      border-top: none;
    }

    .model-details-table tbody tr:hover td {
      background: rgba(255, 255, 255, 0.03);
    }

    .model-details-table td.model-cell {
      color: var(--text-bright);
      font-weight: 700;
      max-width: 240px;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .model-details-table td.metric-cell,
    .model-details-table td.window-cell {
      font-family: 'SF Mono', monospace;
    }

    .model-details-table td.metric-cell.used {
      color: var(--primary);
    }

    .model-details-table td.metric-cell.remaining {
      color: var(--success);
    }

    .model-details-table td.metric-cell.total {
      color: var(--text-bright);
    }

    .model-details-empty {
      padding: 18px 20px;
      color: var(--text-dim);
      font-size: 13px;
    }

    .model-details-updated {
      margin-top: 14px;
      color: var(--text-dim);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.4px;
    }

    /* Empty State Styles */
    .empty-state {
      max-width: 500px;
      margin: 100px auto;
      text-align: center;
      background: var(--panel-bg);
      backdrop-filter: var(--card-blur);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 60px 40px;
    }

    .empty-icon-glow {
      font-size: 64px;
      margin-bottom: 24px;
      filter: drop-shadow(0 0 15px var(--primary));
    }

    .empty-state h2 {
      font-size: 24px;
      color: var(--text-bright);
      margin-bottom: 16px;
    }

    .error-msg {
      color: var(--danger);
      font-weight: 600;
      background: rgba(255, 46, 99, 0.1);
      padding: 12px;
      border-radius: 8px;
    }

    .btn-neon {
      background: var(--primary);
      color: #000;
      padding: 12px 32px;
      border-radius: 12px;
      font-weight: 900;
      text-decoration: none;
      display: inline-block;
      margin-top: 24px;
      transition: all 0.3s;
      box-shadow: 0 0 20px rgba(0, 212, 255, 0.4);
    }

    .btn-neon:hover {
      transform: scale(1.05);
      box-shadow: 0 0 30px rgba(0, 212, 255, 0.6);
    }

    .btn-neon.danger {
      background: var(--danger);
      box-shadow: 0 0 20px rgba(255, 46, 99, 0.4);
    }
    
  .center { justify-content: center; }

  .language-switcher {
    display: flex;
    align-items: center;
    margin-left: 16px;
    padding-left: 16px;
    border-left: 1px solid var(--border);
  }

.lang-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      user-select: none;
      padding: 6px 12px;
      border-radius: 8px;
      transition: background-color 0.2s ease, border-color 0.2s ease;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid var(--border);
      color: inherit;
      font-family: inherit;
    }

  .lang-toggle:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(0, 212, 255, 0.4);
  }

.lang-toggle:active {
      background: rgba(0, 212, 255, 0.15);
    }

  .lang-icon {
    font-size: 13px;
    opacity: 0.8;
  }

.lang-option {
      font-size: 11px;
      font-weight: 700;
      color: var(--text-dim);
      transition: color 0.2s ease, text-shadow 0.2s ease;
      padding: 2px 4px;
      border-radius: 4px;
    }

  .lang-option.active {
    color: var(--primary);
    text-shadow: 0 0 8px rgba(0, 212, 255, 0.6);
  }

  .lang-divider {
    color: var(--text-dim);
    opacity: 0.3;
    font-size: 10px;
  }
</style>
</head>
<body>
${innerHtml}
<script nonce="${nonce}">
(() => {
  const vscode = acquireVsCodeApi();
  const persistedState = vscode.getState() || {};
  const persistTargets = document.querySelectorAll("[data-persist-key]");

  for (const target of persistTargets) {
    const element = target;
    const key = element.getAttribute("data-persist-key");
    if (!key) {
      continue;
    }

    if (typeof persistedState[key] === "boolean") {
      element.open = persistedState[key];
    }

    element.addEventListener("toggle", () => {
      const nextState = Object.assign({}, vscode.getState() || {}, {
        [key]: element.open,
      });
      vscode.setState(nextState);
    });
  }

        const langToggleBtn = document.getElementById("langToggleBtn");
        if (langToggleBtn) {
          langToggleBtn.addEventListener("click", function() {
            vscode.postMessage({
              command: "toggleLanguage"
            });
          });
        }

        // 倒计时更新
        function formatCountdown(ts) {
          if (!ts || ts <= 0) return "--:--:--";
          const now = Date.now();
          const diff = ts - now;
          if (diff <= 0) return "00:00:00";
          const h = Math.floor(diff / 3600000);
          const m = Math.floor((diff % 3600000) / 60000);
          const s = Math.floor((diff % 60000) / 1000);
          return [h, m, s].map(v => String(v).padStart(2, "0")).join(":");
        }
        function updateCountdowns() {
          document.querySelectorAll(".timer-value[data-timestamp]").forEach(function(el) {
            const ts = parseInt(el.getAttribute("data-timestamp"), 10);
            if (ts > 0) {
              el.textContent = formatCountdown(ts);
            }
          });
        }
        updateCountdowns();
        setInterval(updateCountdowns, 1000);
})();
</script>
</body>
</html>`;
}

function clampPercent(value: number | null): number {
  if (value === null || Number.isNaN(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round(value)));
}

function renderModelDetailsSection(
  vm: UsageViewModel,
  config: ExtensionConfig,
  i18n: {
    labelSeparator: string;
    modelDetails: string;
    topItems: string;
    itemsSuffix: string;
    perModelHint: string;
    perModelEmpty: string;
    modelName: string;
    modelUsed: string;
    modelRemaining: string;
    modelTotal: string;
    modelWindow: string;
    updatedAt: string;
  },
  updatedAt: string,
): string {
  const modelLimit = Math.min(config.detailModelLimit, vm.models.length);

  const rows =
    modelLimit > 0
      ? vm.models
          .slice(0, modelLimit)
          .map(
            (model) => `
              <tr>
                <td class="model-cell" title="${escapeHtml(model.name)}">${escapeHtml(model.name)}</td>
                <td class="metric-cell used">${formatNumber(model.usedCount)}</td>
                <td class="metric-cell remaining">${formatNumber(model.remainingCount)}</td>
                <td class="metric-cell total">${formatNumber(model.totalCount)}</td>
                <td class="window-cell">${escapeHtml(model.timeWindow || "00:00 ~ 00:00")}</td>
              </tr>`,
          )
          .join("")
      : "";

  const body =
    modelLimit > 0
      ? `
        <div class="model-details-scroll">
          <table class="model-details-table">
            <thead>
              <tr>
                <th>${i18n.modelName}</th>
                <th>${i18n.modelUsed}</th>
                <th>${i18n.modelRemaining}</th>
                <th>${i18n.modelTotal}</th>
                <th>${i18n.modelWindow}</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`
      : `<div class="model-details-empty">${i18n.perModelEmpty}</div>`;

  return `
    <section class="cyber-card model-details-card">
      <div class="card-glow"></div>
      <details class="model-details" data-persist-key="modelDetailsOpen">
        <summary class="model-details-summary">
          <div class="model-details-summary-left">
            <span class="model-details-icon">🧩</span>
            <div>
              <div class="model-details-title">${i18n.modelDetails}</div>
            </div>
          </div>
          <div class="model-details-summary-right">
            <span class="model-details-badge">${i18n.topItems} ${modelLimit} ${i18n.itemsSuffix}</span>
            <span class="model-details-hint">${i18n.perModelHint}</span>
            <span class="model-details-chevron" aria-hidden="true"></span>
          </div>
        </summary>
        <div class="model-details-body">
          ${body}
          <div class="model-details-updated">${i18n.updatedAt}${i18n.labelSeparator}${escapeHtml(updatedAt)}</div>
        </div>
      </details>
    </section>`;
}

function buildDetailsTooltip(vm: UsageViewModel, config: ExtensionConfig): vscode.MarkdownString {
  const strings = getRuntimeStrings(config);
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.supportThemeIcons = true;
  md.supportHtml = true;

  md.appendMarkdown(`**${strings.tooltipTitle}**\n\n`);

  if (!vm.ok || vm.usedCount === null || vm.totalCount === null || vm.usedPercent === null) {
    md.appendMarkdown(`${escapeMarkdown(vm.statusLabel)}\n\n`);
    md.appendMarkdown(
      `[$(refresh) ${strings.actionRefresh}](command:minimaxUsage.refresh) · [$(key) ${strings.actionSetKey}](command:minimaxUsage.setApiKey)`,
    );
    return md;
  }

  const tooltipLabels = getCompactTooltipLabels(strings.language);
  const compactTable = buildCompactTooltipTable({
    currentLabel: tooltipLabels.current,
    currentUsed: vm.usedCount,
    currentTotal: vm.totalCount,
    currentPercent: vm.usedPercent,
    weeklyLabel:
      vm.weeklyUsedCount !== null && vm.weeklyTotalCount !== null && vm.weeklyUsedPercent !== null
        ? tooltipLabels.weekly
        : undefined,
    weeklyUsed: vm.weeklyUsedCount,
    weeklyTotal: vm.weeklyTotalCount,
    weeklyPercent: vm.weeklyUsedPercent,
  });

  md.appendMarkdown(compactTable);
  md.appendMarkdown("\n\n");
  md.appendMarkdown(
    `[$(refresh) ${strings.actionRefresh}](command:minimaxUsage.refresh) · [$(key) ${strings.actionSetKey}](command:minimaxUsage.setApiKey)`,
  );

  return md;
}

function validateApiKey(apiKey: string): { ok: boolean; message: string } {
  const strings = getRuntimeStrings();
  if (!apiKey) {
    return { ok: false, message: strings.validationMissingKey };
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(apiKey)) {
    return { ok: false, message: strings.validationInvalidKey };
  }

  if (apiKey.length < 10) {
    return { ok: false, message: strings.validationShortKey };
  }

  return { ok: true, message: "" };
}

function readConfig(): ExtensionConfig {
  const config = vscode.workspace.getConfiguration("minimaxUsage");
  const alignmentValue = config.get<string>("statusBarAlignment", "left");
  const languageValue = config.get<string>("language", "auto");

  return {
    refreshIntervalSeconds: Math.max(15, Number(config.get("refreshIntervalSeconds", 60))),
    showWeeklyInStatusBar: Boolean(config.get("showWeeklyInStatusBar", true)),
    detailModelLimit: clampNumber(Number(config.get("detailModelLimit", 8)), 1, 30),
    statusBarAlignment: alignmentValue === "right" ? "right" : "left",
    requestTimeoutMs: clampNumber(Number(config.get("requestTimeoutMs", 15000)), 3000, 60000),
    language:
      languageValue === "zh-CN" || languageValue === "en" || languageValue === "auto"
        ? languageValue
        : "auto",
  };
}

function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.floor(value)));
}

function buildErrorViewModel(message: string, raw: unknown = null): UsageViewModel {
  return {
    ok: false,
    statusLabel: message,
    raw,
    ...emptyUsageViewModel,
  };
}

function buildUsageViewModel(result: RemainsResult): UsageViewModel {
  const strings = getRuntimeStrings();
  const payload = (result.raw ?? null) as MiniMaxRawPayload | null;
  const models = Array.isArray(payload?.model_remains) ? payload.model_remains : [];
  const primaryModel = models[0];
  const statusLabel =
    result.summary ||
    payload?.status_msg ||
    payload?.base_resp?.status_msg ||
    strings.fetchSummaryUnknownResponse;

  if (!primaryModel) {
    return result.ok
      ? { ok: true, statusLabel, raw: result.raw, ...emptyUsageViewModel }
      : buildErrorViewModel(result.summary, result.raw);
  }

  const totalCount = primaryModel.current_interval_total_count ?? 0;
  const remainingCount = primaryModel.current_interval_usage_count ?? 0;
  const usedCount = Math.max(totalCount - remainingCount, 0);
  const weeklyTotalCount = primaryModel.current_weekly_total_count ?? 0;
  const weeklyRemainingCount = primaryModel.current_weekly_usage_count ?? 0;
  const weeklyUsedCount = Math.max(weeklyTotalCount - weeklyRemainingCount, 0);
  const hasWeeklyQuota = weeklyTotalCount > 0 || weeklyRemainingCount > 0;
  const hasTimeWindow =
    typeof primaryModel.start_time === "number" && typeof primaryModel.end_time === "number";

  const filteredModels = models
    .filter(
      (model) =>
        (model.current_interval_total_count ?? 0) !== 0 ||
        (model.current_interval_usage_count ?? 0) !== 0,
    )
    .map((model) => {
      const modelTotalCount = model.current_interval_total_count ?? 0;
      const modelRemainingCount = model.current_interval_usage_count ?? 0;
      return {
        name: model.model_name ?? strings.unknownModel,
        timeWindow:
          typeof model.start_time === "number" && typeof model.end_time === "number"
            ? `${formatTime(model.start_time)} ~ ${formatTime(model.end_time)}`
            : "",
        totalCount: modelTotalCount,
        remainingCount: modelRemainingCount,
        usedCount: Math.max(modelTotalCount - modelRemainingCount, 0),
      };
    });

  return {
    ok: result.ok,
    statusLabel,
    raw: result.raw,
    primaryModelName: primaryModel.model_name ?? "",
    timeWindow: hasTimeWindow
      ? `${formatDateTime(primaryModel.start_time as number)} ~ ${formatTime(primaryModel.end_time as number)}${strings.timeZoneSuffix}`
      : "",
    resetInLabel:
      typeof primaryModel.remains_time === "number"
        ? formatDuration(primaryModel.remains_time)
        : "",
    intervalLabel: hasTimeWindow
      ? formatEnglishDurationCompact(
          (primaryModel.end_time as number) - (primaryModel.start_time as number),
        )
      : "",
    resetTimestamp:
      typeof primaryModel.remains_time === "number"
        ? Date.now() + primaryModel.remains_time
        : null,
    totalCount,
    remainingCount,
    usedCount,
    usedPercent: totalCount > 0 ? Math.round((usedCount / totalCount) * 100) : 0,
    weeklyTotalCount: hasWeeklyQuota ? weeklyTotalCount : null,
    weeklyUsedCount: hasWeeklyQuota ? weeklyUsedCount : null,
    weeklyRemainingCount: hasWeeklyQuota ? weeklyRemainingCount : null,
    weeklyUsedPercent:
      hasWeeklyQuota && weeklyTotalCount > 0
        ? Math.round((weeklyUsedCount / weeklyTotalCount) * 100)
        : null,
    weeklyResetTimestamp:
      hasWeeklyQuota && typeof primaryModel.weekly_remains_time === "number"
        ? Date.now() + primaryModel.weekly_remains_time
        : null,
    weeklyResetInLabel:
      hasWeeklyQuota && typeof primaryModel.weekly_remains_time === "number"
        ? formatDuration(primaryModel.weekly_remains_time)
        : "",
    models: filteredModels,
  };
}

async function fetchRemains(apiKey: string, timeoutMs: number): Promise<RemainsResult> {
  const strings = getRuntimeStrings();
  try {
    const { statusCode, body } = await requestJson({
      url: REMAINS_ENDPOINT,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeoutMs,
    });

    const payload = body as MiniMaxRawPayload;
    return summarizeRemainsPayload(payload, statusCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : strings.fetchSummaryRequestFailed;
    return {
      ok: false,
      statusCode: null,
      summary: /timeout/i.test(message) ? strings.fetchSummaryTimeout : message,
      raw: null,
    };
  }
}

function requestJson(options: {
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
}): Promise<{ statusCode: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      options.url,
      {
        method: "GET",
        headers: options.headers,
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on("data", (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        response.on("end", () => {
          const statusCode = response.statusCode ?? 0;
          const bodyText = Buffer.concat(chunks).toString("utf8").trim();

          if (!bodyText) {
            resolve({ statusCode, body: {} });
            return;
          }

          try {
            resolve({ statusCode, body: JSON.parse(bodyText) });
          } catch {
            reject(new Error(getRuntimeStrings().invalidJsonMessage(statusCode)));
          }
        });
      },
    );

    request.setTimeout(options.timeoutMs, () => {
      request.destroy(new Error("Request timeout"));
    });

    request.on("error", (error) => {
      reject(error);
    });

    request.end();
  });
}

function formatNumber(value: number | null | undefined): string {
  if (typeof value !== "number") {
    return "-";
  }

  return new Intl.NumberFormat(getRuntimeStrings().localeTag).format(value);
}

function formatTime(timestamp: number): string {
  const parts = getDateTimeParts(timestamp);
  return `${parts.hour}:${parts.minute}`;
}

function formatDateTime(timestamp: number): string {
  const parts = getDateTimeParts(timestamp);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+\-.!|]/g, "\\$&");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isMiniMaxRawPayload(value: unknown): value is MiniMaxRawPayload {
  return typeof value === "object" && value !== null;
}

function summarizeRemainsPayload(
  payload: MiniMaxRawPayload,
  fallbackStatusCode: number | null = null,
): RemainsResult {
  const strings = getRuntimeStrings();
  const businessStatusCode = payload.status_code ?? payload.base_resp?.status_code ?? null;
  const businessStatusMessage = payload.status_msg ?? payload.base_resp?.status_msg ?? "";

  if (businessStatusCode === 0) {
    return {
      ok: true,
      statusCode: businessStatusCode,
      summary: strings.fetchSummarySuccess,
      raw: payload,
    };
  }

  if (businessStatusCode === 1004) {
    return {
      ok: false,
      statusCode: businessStatusCode,
      summary: strings.fetchSummaryCheckApiKey,
      raw: payload,
    };
  }

  if ((fallbackStatusCode ?? 0) >= 400 && !businessStatusMessage) {
    return {
      ok: false,
      statusCode: fallbackStatusCode,
      summary: `HTTP ${fallbackStatusCode}`,
      raw: payload,
    };
  }

  return {
    ok: false,
    statusCode: businessStatusCode ?? fallbackStatusCode,
    summary: businessStatusMessage || strings.fetchSummaryUnknownResponse,
    raw: payload,
  };
}

function rebuildUsageViewModelFromRaw(raw: unknown): UsageViewModel | null {
  if (!isMiniMaxRawPayload(raw)) {
    return null;
  }

  return buildUsageViewModel(summarizeRemainsPayload(raw));
}

function getDateTimeParts(timestamp: number): Record<string, string> {
  return new Intl.DateTimeFormat(getRuntimeStrings().localeTag, {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .formatToParts(new Date(timestamp))
    .reduce<Record<string, string>>((accumulator, part) => {
      if (part.type !== "literal") {
        accumulator[part.type] = part.value;
      }
      return accumulator;
    }, {});
}

function getNonce(length = 16): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";

  for (let index = 0; index < length; index += 1) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return result;
}

function log(message: string): void {
  output?.appendLine(`[${new Date().toISOString()}] ${message}`);
}

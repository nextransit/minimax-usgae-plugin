import * as https from "https";
import * as vscode from "vscode";

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

type ExtensionConfig = {
  refreshIntervalSeconds: number;
  showWeeklyInStatusBar: boolean;
  detailModelLimit: number;
  statusBarAlignment: "left" | "right";
  requestTimeoutMs: number;
};

let contextRef: vscode.ExtensionContext | undefined;
let statusItem: vscode.StatusBarItem | undefined;
let output: vscode.OutputChannel | undefined;
let refreshTimer: NodeJS.Timeout | undefined;
let countdownTimer: NodeJS.Timeout | undefined;
let latestVm: UsageViewModel | null = null;
let latestRawResponse: unknown = null;
let lastUpdatedAt: Date | null = null;
let hasApiKey = false;
let isRefreshing = false;

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

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
  models: [],
} satisfies Omit<UsageViewModel, "ok" | "statusLabel" | "raw">;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  contextRef = context;
  output = vscode.window.createOutputChannel("MiniMax Usage");
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
      if (alignmentChanged) {
        recreateStatusBarItem();
      }

      restartRefreshTimer();
      updateStatusBar();
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

  if (statusItem) {
    statusItem.dispose();
    statusItem = undefined;
  }
}

function registerCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("minimaxUsage.setApiKey", async () => {
      const input = await vscode.window.showInputBox({
        title: "MiniMax Usage",
        prompt: "输入 MiniMax API Key",
        placeHolder: "API Key",
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
      log("API Key 已更新");
      vscode.window.showInformationMessage("MiniMax API Key 已保存");
      await refreshUsage("manual");
    }),

    vscode.commands.registerCommand("minimaxUsage.clearApiKey", async () => {
      await context.secrets.delete(SECRET_API_KEY);
      hasApiKey = false;
      latestVm = null;
      latestRawResponse = null;
      lastUpdatedAt = null;
      log("API Key 已清除");
      updateStatusBar();
      vscode.window.showInformationMessage("MiniMax API Key 已清除");
    }),

    vscode.commands.registerCommand("minimaxUsage.refresh", async () => {
      await refreshUsage("manual");
    }),

    vscode.commands.registerCommand("minimaxUsage.copyRawResponse", async () => {
      if (!latestRawResponse) {
        vscode.window.showWarningMessage("当前没有可复制的原始响应");
        return;
      }

      await vscode.env.clipboard.writeText(JSON.stringify(latestRawResponse, null, 2));
      vscode.window.showInformationMessage("MiniMax 原始响应已复制到剪贴板");
    }),
  );
}

function recreateStatusBarItem(): void {
  if (statusItem) {
    statusItem.dispose();
  }

  const config = readConfig();
  const alignment =
    config.statusBarAlignment === "right"
      ? vscode.StatusBarAlignment.Right
      : vscode.StatusBarAlignment.Left;

  statusItem = vscode.window.createStatusBarItem(alignment, 100);
  statusItem.show();
  updateStatusBar();
}

function restartRefreshTimer(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }

  const intervalMs = readConfig().refreshIntervalSeconds * 1000;
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

  const apiKey = (await contextRef.secrets.get(SECRET_API_KEY))?.trim() ?? "";
  hasApiKey = Boolean(apiKey);

  if (!hasApiKey) {
    latestVm = null;
    latestRawResponse = null;
    lastUpdatedAt = null;
    updateStatusBar();

    if (reason === "manual") {
      void vscode.window.showWarningMessage("请先运行 “MiniMax Usage: Set API Key”");
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
    log(`刷新完成 [${reason}] ok=${result.ok} status=${statusCodeLabel} summary=${result.summary}`);

    if (!result.ok && reason === "manual") {
      void vscode.window.showErrorMessage(`MiniMax 查询失败：${result.summary}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    latestVm = buildErrorViewModel(message);
    latestRawResponse = null;
    lastUpdatedAt = new Date();
    log(`刷新异常 [${reason}] ${message}`);
    if (reason === "manual") {
      void vscode.window.showErrorMessage(`MiniMax 查询异常：${message}`);
    }
  } finally {
    isRefreshing = false;
    updateStatusBar();
  }
}

function updateStatusBar(): void {
  if (!statusItem) {
    return;
  }

  const config = readConfig();

  if (isRefreshing) {
    statusItem.text = "$(sync~spin) MiniMax 查询中...";
    statusItem.command = "minimaxUsage.refresh";
    statusItem.tooltip = buildRefreshingTooltip();
    return;
  }

  if (!hasApiKey) {
    statusItem.text = "$(key) MiniMax: 设置 API Key";
    statusItem.command = "minimaxUsage.setApiKey";
    statusItem.tooltip = buildMissingKeyTooltip();
    return;
  }

  if (!latestVm) {
    statusItem.text = "$(sync) MiniMax: 等待刷新";
    statusItem.command = "minimaxUsage.refresh";
    statusItem.tooltip = buildWaitingTooltip();
    return;
  }

  statusItem.command = "minimaxUsage.refresh";

  if (!latestVm.ok) {
    statusItem.text = `$(warning) MiniMax: ${truncate(latestVm.statusLabel, 40)}`;
    statusItem.tooltip = buildDetailsTooltip(latestVm, config);
    return;
  }

  const usedText = formatNumber(latestVm.usedCount);
  const totalText = formatNumber(latestVm.totalCount);
  const remainingText = formatNumber(latestVm.remainingCount);
  const percentText = latestVm.usedPercent === null ? "-" : `${latestVm.usedPercent}%`;

  const weeklyText =
    config.showWeeklyInStatusBar && latestVm.weeklyUsedPercent !== null
      ? ` · 周${latestVm.weeklyUsedPercent}%`
      : "";

  statusItem.text = `$(dashboard) MiniMax ${usedText}/${totalText} (${percentText}) · 剩余${remainingText}${weeklyText}`;
  statusItem.tooltip = buildDetailsTooltip(latestVm, config);
}

function buildRefreshingTooltip(): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown("**MiniMax Token Plan**\n\n$(sync~spin) 正在刷新数据...");
  return md;
}

function buildWaitingTooltip(): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.supportThemeIcons = true;
  md.appendMarkdown("**MiniMax Token Plan**\n\n等待首次刷新。  \n");
  md.appendMarkdown("[$(refresh) 立即刷新](command:minimaxUsage.refresh)");
  return md;
}

function buildMissingKeyTooltip(): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.supportThemeIcons = true;
  md.appendMarkdown("**MiniMax Token Plan**\n\n未配置 API Key。  \n");
  md.appendMarkdown("[$(key) 设置 API Key](command:minimaxUsage.setApiKey)");
  return md;
}

function buildDetailsTooltip(vm: UsageViewModel, config: ExtensionConfig): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.supportThemeIcons = true;

  md.appendMarkdown("**MiniMax Token Plan 详细信息**\n\n");
  md.appendMarkdown(`状态：${vm.ok ? "✅" : "❌"} ${escapeMarkdown(vm.statusLabel)}  \n`);

  if (vm.primaryModelName) {
    md.appendMarkdown(`主模型：${escapeMarkdown(vm.primaryModelName)}  \n`);
  }

  if (vm.timeWindow) {
    md.appendMarkdown(`时间窗口：${escapeMarkdown(vm.timeWindow)}  \n`);
  }

  if (vm.resetTimestamp) {
    md.appendMarkdown(`窗口重置倒计时：${formatCountdown(vm.resetTimestamp)}  \n`);
  }

  md.appendMarkdown("\n| 指标 | 数值 |\n| --- | --- |\n");
  md.appendMarkdown(`| 已使用 | ${formatNumber(vm.usedCount)} |\n`);
  md.appendMarkdown(`| 剩余 | ${formatNumber(vm.remainingCount)} |\n`);
  md.appendMarkdown(`| 总额度 | ${formatNumber(vm.totalCount)} |\n`);
  md.appendMarkdown(`| 窗口进度 | ${vm.usedPercent === null ? "-" : `${vm.usedPercent}%`} |\n`);

  if (vm.weeklyTotalCount !== null) {
    md.appendMarkdown(`| 本周已使用 | ${formatNumber(vm.weeklyUsedCount)} |\n`);
    md.appendMarkdown(`| 本周剩余 | ${formatNumber(vm.weeklyRemainingCount)} |\n`);
    md.appendMarkdown(`| 本周总额度 | ${formatNumber(vm.weeklyTotalCount)} |\n`);
    md.appendMarkdown(`| 本周进度 | ${vm.weeklyUsedPercent === null ? "-" : `${vm.weeklyUsedPercent}%`} |\n`);

    if (vm.weeklyResetTimestamp) {
      md.appendMarkdown(`| 本周重置倒计时 | ${formatCountdown(vm.weeklyResetTimestamp)} |\n`);
    }
  }

  if (vm.models.length > 0) {
    const modelLimit = Math.min(config.detailModelLimit, vm.models.length);
    md.appendMarkdown(`\n**模型明细（前 ${modelLimit} 项）**\n\n`);
    md.appendMarkdown("| 模型 | 已使用 | 剩余 | 总额度 | 时间窗口 |\n| --- | --- | --- | --- | --- |\n");

    for (const model of vm.models.slice(0, modelLimit)) {
      md.appendMarkdown(
        `| ${escapeMarkdown(model.name)} | ${formatNumber(model.usedCount)} | ${formatNumber(model.remainingCount)} | ${formatNumber(model.totalCount)} | ${escapeMarkdown(model.timeWindow || "-")} |\n`,
      );
    }
  }

  if (lastUpdatedAt) {
    md.appendMarkdown(`\n更新时间：${escapeMarkdown(formatDateTime(lastUpdatedAt.getTime()))}  \n`);
  }

  md.appendMarkdown("\n");
  md.appendMarkdown("[$(refresh) 刷新](command:minimaxUsage.refresh)");
  md.appendMarkdown(" · ");
  md.appendMarkdown("[$(key) 设置 Key](command:minimaxUsage.setApiKey)");
  md.appendMarkdown(" · ");
  md.appendMarkdown("[$(trash) 清除 Key](command:minimaxUsage.clearApiKey)");
  md.appendMarkdown(" · ");
  md.appendMarkdown("[$(copy) 复制原始响应](command:minimaxUsage.copyRawResponse)");

  return md;
}

function validateApiKey(apiKey: string): { ok: boolean; message: string } {
  if (!apiKey) {
    return { ok: false, message: "缺少 API Key" };
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(apiKey)) {
    return { ok: false, message: "API Key 格式无效" };
  }

  if (apiKey.length < 10) {
    return { ok: false, message: "API Key 长度不足" };
  }

  return { ok: true, message: "" };
}

function readConfig(): ExtensionConfig {
  const config = vscode.workspace.getConfiguration("minimaxUsage");
  const alignmentValue = config.get<string>("statusBarAlignment", "left");

  return {
    refreshIntervalSeconds: Math.max(15, Number(config.get("refreshIntervalSeconds", 60))),
    showWeeklyInStatusBar: Boolean(config.get("showWeeklyInStatusBar", true)),
    detailModelLimit: clampNumber(Number(config.get("detailModelLimit", 8)), 1, 30),
    statusBarAlignment: alignmentValue === "right" ? "right" : "left",
    requestTimeoutMs: clampNumber(Number(config.get("requestTimeoutMs", 15000)), 3000, 60000),
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
  const payload = (result.raw ?? null) as MiniMaxRawPayload | null;
  const models = Array.isArray(payload?.model_remains) ? payload.model_remains : [];
  const primaryModel = models[0];
  const statusLabel = payload?.base_resp?.status_msg ?? result.summary;

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
        name: model.model_name ?? "Unknown Model",
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
      ? `${formatDateTime(primaryModel.start_time as number)} ~ ${formatTime(primaryModel.end_time as number)} (UTC+8)`
      : "",
    resetInLabel:
      typeof primaryModel.remains_time === "number"
        ? formatDuration(primaryModel.remains_time)
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
    const businessStatusCode = payload.status_code ?? payload.base_resp?.status_code ?? null;
    const businessStatusMessage = payload.status_msg ?? payload.base_resp?.status_msg ?? "";

    if (businessStatusCode === 0) {
      return {
        ok: true,
        statusCode: businessStatusCode,
        summary: "查询成功",
        raw: payload,
      };
    }

    if (businessStatusCode === 1004) {
      return {
        ok: false,
        statusCode: businessStatusCode,
        summary: "请检查 API Key 是否正确",
        raw: payload,
      };
    }

    if (statusCode >= 400 && !businessStatusMessage) {
      return {
        ok: false,
        statusCode,
        summary: `HTTP ${statusCode}`,
        raw: payload,
      };
    }

    return {
      ok: false,
      statusCode: businessStatusCode ?? statusCode,
      summary: businessStatusMessage || "MiniMax 返回了未识别响应",
      raw: payload,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "请求 MiniMax 失败";
    return {
      ok: false,
      statusCode: null,
      summary: /timeout/i.test(message) ? "请求超时，请重试" : message,
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
            reject(new Error(`MiniMax 返回了无效 JSON（HTTP ${statusCode}）`));
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

  return value.toLocaleString("zh-CN");
}

function formatTime(timestamp: number): string {
  return timeFormatter.format(timestamp);
}

function formatDateTime(timestamp: number): string {
  return dateTimeFormatter.format(timestamp).replace(/\//g, "-");
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

function formatCountdown(targetTimestamp: number): string {
  return formatDuration(Math.max(targetTimestamp - Date.now(), 0));
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+\-.!|]/g, "\\$&");
}

function log(message: string): void {
  output?.appendLine(`[${new Date().toISOString()}] ${message}`);
}

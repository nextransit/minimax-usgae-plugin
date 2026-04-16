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
let detailsPanel: vscode.WebviewPanel | undefined;

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

  if (detailsPanel) {
    detailsPanel.dispose();
    detailsPanel = undefined;
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

    vscode.commands.registerCommand("minimaxUsage.showDetails", async () => {
      showDetailsPanel();
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
  resetStatusBarColors();

  if (isRefreshing) {
    statusItem.text = "$(sync~spin) MiniMax 查询中...";
    statusItem.command = "minimaxUsage.showDetails";
    statusItem.tooltip = buildRefreshingTooltip();
    updateDetailsPanel();
    return;
  }

  if (!hasApiKey) {
    statusItem.text = "$(key) MiniMax: 设置 API Key";
    statusItem.command = "minimaxUsage.setApiKey";
    statusItem.tooltip = buildMissingKeyTooltip();
    statusItem.color = new vscode.ThemeColor("statusBarItem.warningForeground");
    updateDetailsPanel();
    return;
  }

  if (!latestVm) {
    statusItem.text = "$(sync) MiniMax: 等待刷新";
    statusItem.command = "minimaxUsage.refresh";
    statusItem.tooltip = buildWaitingTooltip();
    statusItem.color = new vscode.ThemeColor("statusBarItem.prominentForeground");
    updateDetailsPanel();
    return;
  }

  statusItem.command = "minimaxUsage.showDetails";

  if (!latestVm.ok) {
    statusItem.text = `$(warning) MiniMax: ${truncate(latestVm.statusLabel, 40)}`;
    statusItem.tooltip = buildDetailsTooltip(latestVm, config);
    statusItem.color = new vscode.ThemeColor("statusBarItem.warningForeground");
    statusItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    updateDetailsPanel();
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

  applyUsageToneColors(latestVm.usedPercent);
  updateDetailsPanel();
}

function resetStatusBarColors(): void {
  if (!statusItem) {
    return;
  }

  statusItem.color = undefined;
  statusItem.backgroundColor = undefined;
}

function applyUsageToneColors(usedPercent: number | null): void {
  if (!statusItem) {
    return;
  }

  if (usedPercent === null) {
    statusItem.color = new vscode.ThemeColor("statusBarItem.prominentForeground");
    return;
  }

  if (usedPercent >= 90) {
    statusItem.color = new vscode.ThemeColor("statusBarItem.errorForeground");
    statusItem.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
    return;
  }

  if (usedPercent >= 75) {
    statusItem.color = new vscode.ThemeColor("statusBarItem.warningForeground");
    statusItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    return;
  }

  statusItem.color = "#2ea043";
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

function showDetailsPanel(): void {
  if (detailsPanel) {
    detailsPanel.reveal(vscode.ViewColumn.Active);
    updateDetailsPanel();
    return;
  }

  detailsPanel = vscode.window.createWebviewPanel(
    "minimaxUsage.details",
    "MiniMax 用量详情",
    vscode.ViewColumn.Active,
    {
      enableCommandUris: true,
      retainContextWhenHidden: true,
    },
  );

  detailsPanel.onDidDispose(() => {
    detailsPanel = undefined;
  });

  updateDetailsPanel();
}

function updateDetailsPanel(): void {
  if (!detailsPanel) {
    return;
  }

  detailsPanel.webview.html = renderDetailsPanelHtml();
}

function renderDetailsPanelHtml(): string {
  const actions = `
    <div class="actions">
      <a class="action-btn" href="command:minimaxUsage.refresh">刷新</a>
      <a class="action-btn" href="command:minimaxUsage.setApiKey">设置 Key</a>
      <a class="action-btn danger" href="command:minimaxUsage.clearApiKey">清除 Key</a>
    </div>
  `;

  if (!hasApiKey) {
    return renderDetailsHtmlSkeleton(`
      <h2>未配置 API Key</h2>
      <p>请先设置 MiniMax API Key，然后再查看详细数据。</p>
      ${actions}
    `);
  }

  if (!latestVm) {
    return renderDetailsHtmlSkeleton(`
      <h2>暂无数据</h2>
      <p>正在等待首次查询结果，请点击刷新。</p>
      ${actions}
    `);
  }

  if (!latestVm.ok) {
    return renderDetailsHtmlSkeleton(`
      <h2>查询失败</h2>
      <p class="error-text">${escapeHtml(latestVm.statusLabel)}</p>
      ${actions}
    `);
  }

  const windowProgress = clampPercent(latestVm.usedPercent);
  const weeklyProgress = clampPercent(latestVm.weeklyUsedPercent);
  const weeklyProgressText = latestVm.weeklyUsedPercent === null ? "-" : `${latestVm.weeklyUsedPercent}%`;
  const updatedAt = lastUpdatedAt ? formatDateTime(lastUpdatedAt.getTime()) : "-";

  return renderDetailsHtmlSkeleton(`
    <h2>MiniMax Token Plan 三行详情</h2>
    <p class="meta">主模型：${escapeHtml(latestVm.primaryModelName || "-")} ｜ 时间窗口：${escapeHtml(latestVm.timeWindow || "-")}</p>

    <div class="line-card">
      <div class="line-title">1) 当前窗口</div>
      <div class="line-content">
        <span class="kv used">已使用 ${formatNumber(latestVm.usedCount)}</span>
        <span class="kv remaining">剩余 ${formatNumber(latestVm.remainingCount)}</span>
        <span class="kv total">总额度 ${formatNumber(latestVm.totalCount)}</span>
        <span class="kv reset">窗口重置 ${escapeHtml(latestVm.resetTimestamp ? formatCountdown(latestVm.resetTimestamp) : "-")}</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill current" style="width:${windowProgress}%"></div>
      </div>
    </div>

    <div class="line-card">
      <div class="line-title">2) 本周汇总</div>
      <div class="line-content">
        <span class="kv used-week">本周已使用 ${formatNumber(latestVm.weeklyUsedCount)}</span>
        <span class="kv remaining-week">本周剩余 ${formatNumber(latestVm.weeklyRemainingCount)}</span>
        <span class="kv total-week">本周总额度 ${formatNumber(latestVm.weeklyTotalCount)}</span>
        <span class="kv reset-week">本周重置 ${escapeHtml(latestVm.weeklyResetTimestamp ? formatCountdown(latestVm.weeklyResetTimestamp) : "-")}</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill weekly" style="width:${weeklyProgress}%"></div>
      </div>
    </div>

    <div class="line-card">
      <div class="line-title">3) 本周使用进度</div>
      <div class="line-content">
        <span class="kv progress-label">本周使用进度 <strong>${escapeHtml(weeklyProgressText)}</strong></span>
      </div>
      <div class="progress-track progress-track-large">
        <div class="progress-fill weekly-strong" style="width:${weeklyProgress}%"></div>
      </div>
    </div>

    <p class="meta">更新时间：${escapeHtml(updatedAt)}</p>
    ${actions}
  `);
}

function renderDetailsHtmlSkeleton(innerHtml: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body {
      margin: 0;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
    }
    h2 {
      margin: 0 0 8px;
      font-size: 16px;
      line-height: 1.4;
    }
    p {
      margin: 0 0 12px;
      line-height: 1.5;
      color: var(--vscode-descriptionForeground);
    }
    .meta {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    .line-card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
      background: color-mix(in srgb, var(--vscode-editor-background) 80%, #000 20%);
    }
    .line-title {
      font-weight: 700;
      margin-bottom: 8px;
      color: var(--vscode-editor-foreground);
    }
    .line-content {
      display: grid;
      gap: 6px;
      margin-bottom: 8px;
      font-size: 13px;
    }
    .kv { display: inline-block; }
    .used { color: #ff6b6b; }
    .remaining { color: #2fbf71; }
    .total { color: #5aa9ff; }
    .reset { color: #f5a623; }
    .used-week { color: #ff8fab; }
    .remaining-week { color: #59cd90; }
    .total-week { color: #8e9aaf; }
    .reset-week { color: #f4a261; }
    .progress-label { color: #a78bfa; font-size: 14px; }
    .error-text { color: #ff6b6b; font-weight: 600; }
    .progress-track {
      width: 100%;
      height: 8px;
      border-radius: 99px;
      background: color-mix(in srgb, var(--vscode-editor-background) 70%, #222 30%);
      overflow: hidden;
    }
    .progress-track-large { height: 12px; }
    .progress-fill {
      height: 100%;
      transition: width 220ms ease;
    }
    .progress-fill.current { background: linear-gradient(90deg, #5aa9ff, #2dd4bf); }
    .progress-fill.weekly { background: linear-gradient(90deg, #f59e0b, #ef4444); }
    .progress-fill.weekly-strong { background: linear-gradient(90deg, #a78bfa, #f472b6); }
    .actions {
      margin-top: 8px;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .action-btn {
      display: inline-block;
      text-decoration: none;
      font-size: 12px;
      padding: 4px 10px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 6px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }
    .action-btn:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .action-btn.danger {
      background: #7f1d1d;
      color: #fff;
      border-color: #991b1b;
    }
  </style>
</head>
<body>
  ${innerHtml}
</body>
</html>`;
}

function clampPercent(value: number | null): number {
  if (value === null || Number.isNaN(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round(value)));
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function log(message: string): void {
  output?.appendLine(`[${new Date().toISOString()}] ${message}`);
}

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

type ExtensionConfig = {
  refreshIntervalSeconds: number;
  showWeeklyInStatusBar: boolean;
  detailModelLimit: number;
  statusBarAlignment: "left" | "right";
  requestTimeoutMs: number;
};

let contextRef: vscode.ExtensionContext | undefined;
let statusItems: vscode.StatusBarItem[] = [];
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
  intervalLabel: "",
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

  if (statusItems.length > 0) {
    for (const item of statusItems) {
      item.dispose();
    }
    statusItems = [];
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

function clearStatusItems(): void {
  for (const item of statusItems) {
    item.dispose();
  }
  statusItems = [];
}

function recreateStatusBarItem(): void {
  clearStatusItems();
  updateStatusBar();
}

function addStatusItem(
  alignment: vscode.StatusBarAlignment,
  priority: number,
  text: string,
  tooltip?: vscode.MarkdownString | string,
  command?: string,
  color?: string | vscode.ThemeColor,
  backgroundColor?: vscode.ThemeColor,
): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(alignment, priority);
  item.text = text;
  if (tooltip) {
    item.tooltip = tooltip;
  }
  if (command) {
    item.command = command;
  }
  if (color) {
    item.color = color;
  }
  if (backgroundColor) {
    item.backgroundColor = backgroundColor;
  }
  item.show();
  statusItems.push(item);
  return item;
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

    // 高风险弹窗提示逻辑
    if (result.ok && latestVm && latestVm.usedPercent !== null) {
      if (latestVm.usedPercent >= 95) {
        if (!hasAlertedHighRisk) {
          void vscode.window.showWarningMessage(`MiniMax 风险提示: 当前窗口剩余仅 ${100 - latestVm.usedPercent}%，即将耗尽！建议降低请求频率或切换模型。`);
          hasAlertedHighRisk = true;
        }
      } else {
        hasAlertedHighRisk = false;
      }
    }

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
  clearStatusItems();

  const config = readConfig();
  const alignment =
    config.statusBarAlignment === "right"
      ? vscode.StatusBarAlignment.Right
      : vscode.StatusBarAlignment.Left;
  const basePriority = 100;

  if (isRefreshing) {
    addStatusItem(
      alignment,
      basePriority,
      "$(sync~spin) MiniMax 查询中...",
      buildRefreshingTooltip(),
      "minimaxUsage.showDetails",
    );
    updateDetailsPanel();
    return;
  }

  if (!hasApiKey) {
    addStatusItem(
      alignment,
      basePriority,
      "$(key) MiniMax: 设置 API Key",
      buildMissingKeyTooltip(),
      "minimaxUsage.setApiKey",
      new vscode.ThemeColor("statusBarItem.warningForeground"),
    );
    updateDetailsPanel();
    return;
  }

  if (!latestVm) {
    addStatusItem(
      alignment,
      basePriority,
      "$(sync) MiniMax: 等待刷新",
      buildWaitingTooltip(),
      "minimaxUsage.refresh",
      new vscode.ThemeColor("statusBarItem.prominentForeground"),
    );
    updateDetailsPanel();
    return;
  }

  if (!latestVm.ok) {
    addStatusItem(
      alignment,
      basePriority,
      `$(warning) MiniMax: ${truncate(latestVm.statusLabel, 40)}`,
      buildDetailsTooltip(latestVm, config),
      "minimaxUsage.showDetails",
      new vscode.ThemeColor("statusBarItem.warningForeground"),
      new vscode.ThemeColor("statusBarItem.warningBackground"),
    );
    updateDetailsPanel();
    return;
  }

  // 正常显示逻辑 - 分段显示
  const tooltip = buildDetailsTooltip(latestVm, config);
  const command = "minimaxUsage.showDetails";
  const priorityStep = alignment === vscode.StatusBarAlignment.Left ? -1 : 1;
  let currentPriority = basePriority;

  // 1. 周期时长
  if (latestVm.intervalLabel) {
    addStatusItem(
      alignment,
      currentPriority,
      `${latestVm.intervalLabel}: `,
      tooltip,
      command,
      "#888888",
    );
    currentPriority += priorityStep;
  }

  // 2. 当前配额百分比
  const percentText = latestVm.usedPercent === null ? "-" : `${latestVm.usedPercent}%`;
  addStatusItem(
    alignment,
    currentPriority,
    percentText,
    tooltip,
    command,
    getPercentColor(latestVm.usedPercent),
  );
  currentPriority += priorityStep;

  // 3. 当前重置时间
  const resetLabel = latestVm.resetTimestamp ? formatCountdownFriendly(latestVm.resetTimestamp) : "";
  if (resetLabel) {
    addStatusItem(
      alignment,
      currentPriority,
      ` $(clock) ${resetLabel}`,
      tooltip,
      command,
      "#888888",
    );
    currentPriority += priorityStep;
  }

  // 4. 每周配额 (可选)
  if (config.showWeeklyInStatusBar && latestVm.weeklyUsedPercent !== null) {
    addStatusItem(alignment, currentPriority, "  每周: ", tooltip, command, "#888888");
    currentPriority += priorityStep;

    addStatusItem(
      alignment,
      currentPriority,
      `${latestVm.weeklyUsedPercent}%`,
      tooltip,
      command,
      getPercentColor(latestVm.weeklyUsedPercent),
    );
    currentPriority += priorityStep;

    const weeklyResetLabel = latestVm.weeklyResetTimestamp
      ? formatCountdownFriendly(latestVm.weeklyResetTimestamp)
      : "";
    if (weeklyResetLabel) {
      addStatusItem(
        alignment,
        currentPriority,
        ` $(clock) ${weeklyResetLabel}`,
        tooltip,
        command,
        "#888888",
      );
      currentPriority += priorityStep;
    }
  }

  updateDetailsPanel();
}

function getPercentColor(percent: number | null): string {
  if (percent === null) {
    return "#888888";
  }

  if (percent >= 90) {
    return "#ff4d4f"; // 红色
  }
  if (percent >= 70) {
    return "#faad14"; // 橙色/黄色
  }
  return "#52c41a"; // 绿色
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
  if (!hasApiKey) {
    return renderDetailsHtmlSkeleton(`
      <div class="empty-state animate-in">
        <div class="empty-icon-glow">🔑</div>
        <h2>未配置加密密钥</h2>
        <p>系统核心功能需要 MiniMax API Key 授权。请在控制台中输入您的访问密钥以同步数据。</p>
        <div class="actions center">
          <a class="btn btn-neon" href="command:minimaxUsage.setApiKey">
            <span class="btn-text">INITIALIZE ACCESS</span>
          </a>
        </div>
      </div>
    `);
  }

  if (!latestVm) {
    return renderDetailsHtmlSkeleton(`
      <div class="empty-state animate-in">
        <div class="empty-icon-glow">📡</div>
        <h2>等待数据链路</h2>
        <p>正在尝试连接 MiniMax 服务器并同步最新的 Token 消耗指标。请保持网络畅通。</p>
        <div class="actions center">
          <a class="btn btn-neon" href="command:minimaxUsage.refresh">
            <span class="btn-text">RETRY SYNC</span>
          </a>
        </div>
      </div>
    `);
  }

  if (!latestVm.ok) {
    return renderDetailsHtmlSkeleton(`
      <div class="empty-state error animate-in">
        <div class="empty-icon-glow">⚠️</div>
        <h2>数据链路中断</h2>
        <p class="error-msg">${escapeHtml(latestVm.statusLabel)}</p>
        <div class="actions center">
          <a class="btn btn-neon danger" href="command:minimaxUsage.refresh">
            <span class="btn-text">RECONNECT</span>
          </a>
          <a class="btn" href="command:minimaxUsage.setApiKey">
            <span class="btn-text">EDIT KEY</span>
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
  
  const updatedAt = lastUpdatedAt ? formatDateTime(lastUpdatedAt.getTime()) : "N/A";

  return renderDetailsHtmlSkeleton(`
    <div class="dashboard animate-in">
      <header class="main-header">
        <div class="logo-area">
          <div class="logo-pulse"></div>
          <h1 class="glow-text">MINIMAX USAGE PANEL</h1>
        </div>
        <div class="header-info">
          <div class="info-tag">
            <span class="tag-label">MODEL</span>
            <span class="tag-value">${escapeHtml(latestVm.primaryModelName || "UNKNOWN")}</span>
          </div>
          <div class="info-tag">
            <span class="tag-label">WINDOW</span>
            <span class="tag-value">${escapeHtml(latestVm.intervalLabel || "N/A")}</span>
          </div>
        </div>
      </header>

      <div class="stats-container">
        <!-- Current Window Card -->
        <section class="cyber-card ${windowStatus}">
          <div class="card-glow"></div>
          <div class="card-header">
            <h3 class="card-title"><span class="icon">⚡</span> CURRENT INTERVAL</h3>
            <div class="reset-timer">
              <span class="timer-icon">⏳</span>
              <span class="timer-value">${escapeHtml(latestVm.resetTimestamp ? formatCountdown(latestVm.resetTimestamp) : "--:--:--")}</span>
            </div>
          </div>
          
          <div class="data-grid">
            <div class="data-item">
              <span class="data-label">CONSUMED</span>
              <span class="data-value highlight">${formatNumber(latestVm.usedCount)}</span>
            </div>
            <div class="data-item">
              <span class="data-label">AVAILABLE</span>
              <span class="data-value success">${formatNumber(latestVm.remainingCount)}</span>
            </div>
            <div class="data-item">
              <span class="data-label">LIMIT</span>
              <span class="data-value">${formatNumber(latestVm.totalCount)}</span>
            </div>
          </div>

          <div class="progress-wrap">
            <div class="progress-header">
              <span class="progress-label">RESOURCE UTILIZATION</span>
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

        ${usedPercent >= 70 ? `
        <!-- Risk Warning Card -->
        <section class="cyber-card risk-alert ${windowStatus}">
          <div class="card-glow"></div>
          <div class="risk-content">
            <div class="risk-icon">${usedPercent >= 90 ? '🚨' : '⚠️'}</div>
            <div class="risk-text">
              <h3>风险提示</h3>
              <ul>
                <li>当前窗口剩余仅 ${100 - usedPercent}%</li>
                <li>${usedPercent >= 90 ? '额度即将耗尽，建议立即降低请求频率或切换模型！' : '消耗较快，请注意使用配额以避免被限流。'}</li>
              </ul>
            </div>
          </div>
        </section>
        ` : ''}

        <!-- Weekly Card -->
        <section class="cyber-card secondary ${weeklyStatus}">
          <div class="card-glow"></div>
          <div class="card-header">
            <h3 class="card-title"><span class="icon">🗓️</span> WEEKLY AGGREGATE</h3>
            <div class="reset-timer">
              <span class="timer-icon">🕒</span>
              <span class="timer-value">${escapeHtml(latestVm.weeklyResetTimestamp ? formatCountdown(latestVm.weeklyResetTimestamp) : "--:--")}</span>
            </div>
          </div>

          <div class="data-grid">
            <div class="data-item">
              <span class="data-label">USED</span>
              <span class="data-value emphasize">${formatNumber(latestVm.weeklyUsedCount)}</span>
            </div>
            <div class="data-item">
              <span class="data-label">LEFT</span>
              <span class="data-value success">${formatNumber(latestVm.weeklyRemainingCount)}</span>
            </div>
            <div class="data-item">
              <span class="data-label">TOTAL</span>
              <span class="data-value">${formatNumber(latestVm.weeklyTotalCount)}</span>
            </div>
          </div>

          <div class="progress-wrap">
            <div class="progress-header">
              <span class="progress-label">WEEKLY QUOTA</span>
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
      </div>

      <footer class="cyber-footer">
        <div class="system-status">
          <div class="status-indicator"></div>
          <span class="last-update">SYNCED AT: ${updatedAt}</span>
        </div>
        <div class="cyber-actions">
          <a class="action-link neon" href="command:minimaxUsage.refresh">
            <span class="link-icon">🔄</span> SYNC DATA
          </a>
          <a class="action-link" href="command:minimaxUsage.setApiKey">
            <span class="link-icon">🔑</span> KEY CONFIG
          </a>
          <a class="action-link danger" href="command:minimaxUsage.clearApiKey">
            <span class="link-icon">🗑️</span> RESET
          </a>
        </div>
      </footer>
    </div>
  `);
}

function renderDetailsHtmlSkeleton(innerHtml: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
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
      transform: translateY(-5px);
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
    .data-value.success { color: var(--success); }

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
    intervalLabel: hasTimeWindow
      ? formatDurationCompact(
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

function formatDurationCompact(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const days = Math.floor(totalSeconds / (3600 * 24));
  const hours = Math.floor((totalSeconds % (3600 * 24)) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) {
    return `${days}天`;
  }
  if (hours > 0) {
    return `${hours}小时`;
  }
  return `${minutes}分钟`;
}

function formatCountdownFriendly(targetTimestamp: number): string {
  const diff = Math.max(targetTimestamp - Date.now(), 0);
  const totalSeconds = Math.ceil(diff / 1000);
  const days = Math.floor(totalSeconds / (24 * 3600));
  const hours = Math.floor((totalSeconds % (24 * 3600)) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) {
    return `${days}d${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h${minutes}m`;
  }
  return `${minutes}m`;
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

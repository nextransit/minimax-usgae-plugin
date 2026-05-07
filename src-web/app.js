// MiniMax Usage Monitor - Tauri Frontend

const transientDialogIds = [
  'api-key-dialog',
  'key-management-modal',
  'key-edit-dialog',
];
const DIALOG_OPEN_ATTR = 'data-minimax-dialog-open';

let uiReady = false;
let modalOpenIntentDepth = 0;

function withUserModalIntent(action) {
  if (!uiReady) return;
  if (document.visibilityState !== 'visible') return;
  if (typeof document.hasFocus === 'function' && !document.hasFocus()) return;
  modalOpenIntentDepth += 1;
  try {
    return action();
  } finally {
    modalOpenIntentDepth = Math.max(0, modalOpenIntentDepth - 1);
  }
}

function runTrustedModalAction(event, action) {
  if (!event?.isTrusted) return;
  withUserModalIntent(action);
}

function canOpenTransientDialog() {
  return uiReady && modalOpenIntentDepth > 0;
}

function setDialogVisibility(dialogId, isOpen) {
  const el = document.getElementById(dialogId);
  if (!el) return;
  if (isOpen) {
    el.setAttribute(DIALOG_OPEN_ATTR, '1');
    el.style.display = 'flex';
  } else {
    el.removeAttribute(DIALOG_OPEN_ATTR);
    el.style.display = 'none';
  }
}

function closeTransientDialogs() {
  transientDialogIds.forEach((id) => setDialogVisibility(id, false));

  const apiKeyInput = document.getElementById('api-key-input');
  if (apiKeyInput) apiKeyInput.blur();

  const keyEditApiKeyInput = document.getElementById('key-edit-api-key');
  if (keyEditApiKeyInput) keyEditApiKeyInput.value = '';
}

window.__MINIMAX_CLOSE_TRANSIENT_DIALOGS__ = closeTransientDialogs;
closeTransientDialogs();

// Global error handler
window.onerror = function(msg, url, line, col, error) {
    console.error('[GLOBAL ERROR]', msg, 'at line', line, 'col', col);
    return false;
};

let tauriInvoke = null;
let tauriListen = null;
let uiHandlersInitialized = false;
let tauriEventListenersInitialized = false;
let settingsHandlersInitialized = false;

const DEFAULT_CONFIG = Object.freeze({
  config_version: 2,
  refresh_interval_seconds: 20,
  show_weekly_in_status: true,
  show_percent_in_tray: true,
  detail_model_limit: 8,
  language: 'auto',
  first_run: false,
  start_minimized: false,
  enable_notifications: true,
  api_keys: [],
});

const TAURI_API_READY_TIMEOUT_MS = 3500;
const BOOT_IPC_TIMEOUT_MS = 3000;
const SETTINGS_IPC_TIMEOUT_MS = 3000;
const REFRESH_IPC_TIMEOUT_MS = 18000;
const WRITE_IPC_TIMEOUT_MS = 15000;

function defaultConfig() {
  return { ...DEFAULT_CONFIG, api_keys: [] };
}

function getTauriAPI() {
  const tauri = window.__TAURI__;
  if (!tauri?.core?.invoke || !tauri?.event?.listen) {
    return null;
  }
  return {
    invoke: tauri.core.invoke,
    listen: tauri.event.listen,
  };
}

async function waitForTauriAPI(timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const api = getTauriAPI();
    if (api) return api;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Tauri API not available');
}

function invokeWithTimeout(command, args, timeoutMs = BOOT_IPC_TIMEOUT_MS) {
  if (!tauriInvoke) {
    return Promise.reject(new Error('Tauri API not ready'));
  }

  let timer = null;
  const invokePromise = args === undefined ? tauriInvoke(command) : tauriInvoke(command, args);
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([invokePromise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function invokeOrFallback(command, args, fallback, timeoutMs = BOOT_IPC_TIMEOUT_MS) {
  try {
    return await invokeWithTimeout(command, args, timeoutMs);
  } catch (error) {
    console.warn(`${command} failed:`, error);
    return typeof fallback === 'function' ? fallback(error) : fallback;
  }
}

function runInBackground(label, action) {
  setTimeout(() => {
    Promise.resolve()
      .then(action)
      .catch((error) => console.error(`${label} failed:`, error));
  }, 0);
}

// i18n translations
const i18n = {
  'zh-CN': {
    settings: '设置',
    refreshInterval: '刷新时间（秒）',
    startMinimized: '启动时最小化到菜单栏',
    autoStart: '开机自动启动',
    enableNotifications: '启用系统通知',
    showPercentInTray: '托盘栏显示使用比例',
    trayIconStyle: '托盘图标风格',
    trayIconStyleDefault: '默认（数字）',
    trayIconStyleMinimal: '简约（圆点）',
    trayIconStyleGauge: '仪表（环形）',
    unconfiguredKey: '未配置加密密钥',
    unconfiguredDesc: '系统核心功能需要 MiniMax API Key 授权。请在控制台中输入您的访问密钥以同步数据。',
    initAccess: '配置密钥',
    waitingData: '等待数据链路',
    waitingDesc: '正在尝试连接 MiniMax 服务器并同步最新的 Token 消耗指标。请保持网络畅通。',
    retrySync: '重试同步',
    dataBroken: '数据链路中断',
    reconnect: '重新连接',
    editKey: '修改密钥',
    panelTitle: 'MINIMAX 用量监控',
    model: '当前模型',
    window: '时间窗口',
    currentInterval: '当前周期',
    consumed: '已使用',
    available: '剩余量',
    limit: '总配额',
    resourceUtil: '资源使用率',
    weeklyAggregate: '本周累计',
    used: '已使用',
    left: '剩余量',
    total: '总额度',
    weeklyQuota: '本周进度',
    modelDetails: '模型明细',
    topItems: '前',
    itemsSuffix: '项',
    perModelHint: '展开查看各模型额度',
    perModelEmpty: '当前暂无模型明细数据。',
    modelName: '模型',
    modelUsed: '已使用',
    modelRemaining: '剩余',
    modelTotal: '总额度',
    modelWindow: '时间窗口',
    syncedAt: '最后同步: ',
    syncUnavailable: '同步失败，页面保持可用',
    syncData: '刷新数据',
    keyConfig: '配置密钥',
    reset: '清除缓存',
    riskTitle: '风险提示',
    riskRemaining: '当前窗口剩余仅 ',
    riskExhausted: '额度即将耗尽，建议立即降低请求频率或切换模型！',
    riskFast: '消耗较快，请注意使用配额以避免被限流。',
    languageSwitchLabel: '语言',
    inputBoxTitle: 'MiniMax Usage',
    inputBoxPrompt: '输入 MiniMax API Key',
    cancel: '取消',
    save: '保存',
    na: '--',
    unknown: '未知',
    keyManagement: 'API Key 管理',
    keyName: '名称',
    keyColor: '颜色',
    keyRefresh: '刷新间隔（秒）',
    apiKey: 'API Key',
  },
  en: {
    settings: 'Settings',
    refreshInterval: 'Refresh interval (seconds)',
    startMinimized: 'Start minimized to menu bar',
    autoStart: 'Launch at login',
    enableNotifications: 'Enable system notifications',
    showPercentInTray: 'Show usage percent in tray',
    trayIconStyle: 'Tray icon style',
    trayIconStyleDefault: 'Default (Digital)',
    trayIconStyleMinimal: 'Minimal (Dot)',
    trayIconStyleGauge: 'Gauge (Ring)',
    unconfiguredKey: 'Unconfigured API Key',
    unconfiguredDesc: 'System core features require MiniMax API Key authorization. Please enter your access key to sync data.',
    initAccess: 'INITIALIZE ACCESS',
    waitingData: 'Waiting for Data Link',
    waitingDesc: 'Attempting to connect to MiniMax servers and sync the latest Token consumption metrics.',
    retrySync: 'RETRY SYNC',
    dataBroken: 'Data Link Broken',
    reconnect: 'RECONNECT',
    editKey: 'EDIT KEY',
    panelTitle: 'MINIMAX USAGE PANEL',
    model: 'MODEL',
    window: 'WINDOW',
    currentInterval: 'CURRENT INTERVAL',
    consumed: 'CONSUMED',
    available: 'AVAILABLE',
    limit: 'LIMIT',
    resourceUtil: 'RESOURCE UTILIZATION',
    weeklyAggregate: 'WEEKLY AGGREGATE',
    used: 'USED',
    left: 'LEFT',
    total: 'TOTAL',
    weeklyQuota: 'WEEKLY QUOTA',
    modelDetails: 'MODEL DETAILS',
    topItems: 'TOP',
    itemsSuffix: 'ITEMS',
    perModelHint: 'Expand to inspect per-model quotas',
    perModelEmpty: 'No model detail data available right now.',
    modelName: 'MODEL',
    modelUsed: 'USED',
    modelRemaining: 'LEFT',
    modelTotal: 'TOTAL',
    modelWindow: 'WINDOW',
    syncedAt: 'SYNCED AT: ',
    syncUnavailable: 'Sync failed, page remains available',
    syncData: 'SYNC DATA',
    keyConfig: 'KEY CONFIG',
    reset: 'RESET',
    riskTitle: 'Risk Warning',
    riskRemaining: 'Current window remaining only ',
    riskExhausted: 'Quota is almost exhausted. Suggest lowering request frequency or switching models!',
    riskFast: 'Consuming quickly. Please monitor usage to avoid rate limits.',
    languageSwitchLabel: 'Language',
    inputBoxTitle: 'MiniMax Usage',
    inputBoxPrompt: 'Enter MiniMax API Key',
    cancel: 'Cancel',
    save: 'Save',
    na: '--',
    unknown: 'Unknown',
    keyManagement: 'API Key Management',
    keyName: 'Name',
    keyColor: 'Color',
    keyRefresh: 'Refresh Interval (seconds)',
    apiKey: 'API Key',
  },
};

// App State
let state = {
  apiKeys: [],
  usageData: {},
  config: null,
  language: 'zh-CN',
  isBooting: true,
  isLoading: false,
  lastError: '',
};

// Settings state
let settings = {
  refresh_interval_seconds: 20,
  start_minimized: false,
  autostart: false,
  enable_notifications: true,
  show_percent_in_tray: true,
  tray_icon_style: 'default',
};

let renderScheduled = false;
let usageRenderTimer = null;
const modelTableHtmlCache = new WeakMap();
const USAGE_RENDER_DEBOUNCE_MS = 120;
let modelDetailsSignature = '';

function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  const flush = () => {
    renderScheduled = false;
    render();
  };
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(flush);
  } else {
    setTimeout(flush, 16);
  }
}

function scheduleUsageRender() {
  if (usageRenderTimer) {
    clearTimeout(usageRenderTimer);
  }
  usageRenderTimer = setTimeout(() => {
    usageRenderTimer = null;
    scheduleRender();
  }, USAGE_RENDER_DEBOUNCE_MS);
}

function setElementDisplay(el, display) {
  if (el && el.style.display !== display) {
    el.style.display = display;
  }
}

function setElementClass(el, className) {
  if (el && el.className !== className) {
    el.className = className;
  }
}

function setElementAttr(el, attrName, value) {
  if (!el) return;
  const next = String(value);
  if (el.getAttribute(attrName) !== next) {
    el.setAttribute(attrName, next);
  }
}

function hasUsableUsageData() {
  return Object.values(state.usageData || {}).some(data => data && data.ok);
}

// Initialize app
async function init() {
  uiReady = false;
  closeTransientDialogs();
  state.config = defaultConfig();
  state.language = 'zh-CN';
  state.isBooting = true;
  state.isLoading = true;
  state.lastError = '';
  applyI18n();
  setupUiHandlers();
  render();
  startCountdownTimer();
  uiReady = true;

  try {
    const tauri = await waitForTauriAPI(TAURI_API_READY_TIMEOUT_MS);
    tauriInvoke = tauri.invoke;
    tauriListen = tauri.listen;

    const [config, fetchedApiKeys, allData] = await Promise.all([
      invokeOrFallback('cmd_get_config', undefined, defaultConfig, BOOT_IPC_TIMEOUT_MS),
      invokeOrFallback('cmd_get_api_keys', undefined, [], BOOT_IPC_TIMEOUT_MS),
      invokeOrFallback('cmd_get_all_usage_data', undefined, {}, BOOT_IPC_TIMEOUT_MS),
    ]);

    state.config = { ...defaultConfig(), ...(config || {}) };
    state.language = state.config?.language === 'auto' ? 'zh-CN' : (state.config?.language || 'zh-CN');
    state.apiKeys = fetchedApiKeys || [];
    state.usageData = allData || {};

    // Apply i18n
    applyI18n();

    // Setup event listeners
    await setupEventListeners();
    closeTransientDialogs();

    // Initial render
    state.isBooting = false;
    state.isLoading = false;
    render();
    closeTransientDialogs();

    runInBackground('loadSettings', async () => {
      await loadSettings();
      closeTransientDialogs();
      restartAutoRefreshTimer();
    });

    // The native backend starts the initial refresh. Keep the first screen
    // responsive and let the user-triggered retry handle manual refreshes.
  } catch (error) {
    state.isBooting = false;
    state.isLoading = false;
    state.lastError = String(error);
    uiReady = true;
    console.error('Init error:', error);
    showStartupError(error, { recoverable: true });
  }
}

async function setupEventListeners() {
  if (!tauriListen || tauriEventListenersInitialized) return;
  tauriEventListenersInitialized = true;

  // Listen for usage updates from backend (multi-key format: [keyId, UsageData])
  await tauriListen('usage-updated', (event) => {
    const payload = event.payload;
    if (Array.isArray(payload) && payload.length === 2) {
      // New multi-key format: [keyId, data]
      state.usageData[payload[0]] = payload[1];
    } else if (payload && typeof payload === 'object' && !payload.keyId) {
      // Legacy single-key format (raw UsageData)
      state.usageData['default'] = payload;
    }
    state.lastError = '';
    scheduleUsageRender();
  });

  await tauriListen('usage-error', (event) => {
    console.error('Usage refresh error:', event.payload);
    if (Array.isArray(event.payload) && event.payload.length === 2) {
      if (!hasUsableUsageData()) {
        state.lastError = String(event.payload[1]);
      }
    } else {
      if (!hasUsableUsageData()) {
        state.lastError = String(event.payload || '');
      }
    }
    scheduleUsageRender();
  });

  // Listen for show set key dialog event
  await tauriListen('show-set-key-dialog', () => {
    // Disable auto modal popup from background events; user opens it explicitly from UI.
    return;
  });

  // Reset transient UI whenever the native shell is about to reveal the window.
  await tauriListen('app-window-will-show', () => {
    closeTransientDialogs();
    scheduleRender();
  });

  // Listen for window-hidden event - close all dialogs when window is about to hide
  await tauriListen('window-hidden', () => {
    closeTransientDialogs();
  });
}

function showStartupError(error, options = {}) {
  const recoverable = options.recoverable !== false;
  const emptyNoKey = document.getElementById('empty-state-no-key');
  const emptyLoading = document.getElementById('empty-state-loading');
  const dashboard = document.getElementById('dashboard');
  const emptyError = document.getElementById('empty-state-error');
  const errorMsg = document.getElementById('error-message');

  [emptyNoKey, emptyLoading].forEach((el) => {
    if (el) el.style.display = 'none';
  });

  if (dashboard) {
    dashboard.style.display = recoverable && state.apiKeys.length > 0 ? 'block' : 'none';
  }

  if (emptyError) emptyError.style.display = 'block';
  if (errorMsg) {
    errorMsg.textContent = recoverable
      ? `启动后台连接失败，页面已进入离线模式: ${String(error)}`
      : `Startup failed: ${String(error)}`;
  }
}

function setupUiHandlers() {
  if (uiHandlersInitialized) return;
  uiHandlersInitialized = true;
  // Set API Key button
  document.getElementById('btn-set-key')?.addEventListener('click', (e) => {
    runTrustedModalAction(e, showApiKeyDialog);
  });

  // Retry sync button
  document.getElementById('btn-retry-sync')?.addEventListener('click', refreshAllUsage);

  // Reconnect button
  document.getElementById('btn-reconnect')?.addEventListener('click', refreshAllUsage);

  // Edit key button
  document.getElementById('btn-edit-key')?.addEventListener('click', (e) => {
    runTrustedModalAction(e, showApiKeyDialog);
  });

  // Refresh button
  document.getElementById('btn-refresh')?.addEventListener('click', refreshAllUsage);

  // Config key button
  document.getElementById('btn-config-key')?.addEventListener('click', (e) => {
    runTrustedModalAction(e, showKeyManagementModal);
  });

  // Clear cache button
  document.getElementById('btn-clear-cache')?.addEventListener('click', clearApiKey);

  // Language toggle
  document.getElementById('langToggleBtn')?.addEventListener('click', toggleLanguage);

  // Dialog cancel button
  document.getElementById('btn-cancel-key')?.addEventListener('click', hideApiKeyDialog);

  // Dialog save button
  document.getElementById('btn-save-key')?.addEventListener('click', saveApiKey);

  // Enter key in input
  document.getElementById('api-key-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') saveApiKey();
  });

  // Close dialog on overlay click
  document.getElementById('api-key-dialog')?.addEventListener('click', (e) => {
    if (e.target.classList.contains('dialog-overlay')) {
      hideApiKeyDialog();
    }
  });

  // Key management modal handlers
  document.getElementById('btn-add-key-modal')?.addEventListener('click', (e) => {
    runTrustedModalAction(e, () => openKeyEditDialog());
  });
  document.getElementById('btn-save-key-edit')?.addEventListener('click', saveKeyEdit);
  document.getElementById('btn-cancel-key-edit')?.addEventListener('click', closeKeyEditDialog);
  document.getElementById('btn-close-modal')?.addEventListener('click', () => {
    setDialogVisibility('key-management-modal', false);
  });

  // Key edit dialog overlay click
  document.getElementById('key-edit-dialog')?.addEventListener('click', (e) => {
    if (e.target.classList.contains('dialog-overlay')) {
      closeKeyEditDialog();
    }
  });

  document.getElementById('key-list')?.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    const editBtn = e.target.closest('.js-edit-key');
    if (editBtn) {
      const keyId = editBtn.getAttribute('data-key-id');
      withUserModalIntent(() => openKeyEditDialog(keyId));
      return;
    }
    const deleteBtn = e.target.closest('.js-delete-key');
    if (deleteBtn) {
      const keyId = deleteBtn.getAttribute('data-key-id');
      deleteKey(keyId);
    }
  });
}

async function refreshAllUsage() {
  if (!tauriInvoke || state.apiKeys.length === 0 || state.isLoading) return;

  const hadUsageData = Object.keys(state.usageData).length > 0;
  state.isLoading = true;
  scheduleRender();

  try {
    // Force backend to fetch latest data from API, then return refreshed HashMap.
    const allData = await invokeWithTimeout(
      'cmd_refresh_all_usage_data',
      undefined,
      REFRESH_IPC_TIMEOUT_MS,
    );
    state.usageData = allData || {};
    state.lastError = '';
    scheduleRender();
  } catch (error) {
    console.error('Fetch error:', error);
    if (!hasUsableUsageData()) {
      state.lastError = String(error);
    }
    if (!hadUsageData) {
      state.apiKeys.forEach(key => {
        state.usageData[key.id] = makeErrorUsageData(String(error));
      });
    }
    scheduleRender();
  } finally {
    state.isLoading = false;
    scheduleRender();
  }
}

function makeErrorUsageData(message) {
  return {
    ok: false,
    status_label: message || 'Unknown error',
    primary_model_name: '',
    time_window: '',
    reset_timestamp: null,
    reset_in_label: '',
    total_count: null,
    remaining_count: null,
    used_count: null,
    used_percent: null,
    weekly_total_count: null,
    weekly_used_count: null,
    weekly_remaining_count: null,
    weekly_used_percent: null,
    weekly_reset_timestamp: null,
    weekly_reset_in_label: '',
    interval_label: '',
    models: [],
    last_updated: new Date().toLocaleString(),
  };
}

async function saveApiKey() {
  const input = document.getElementById('api-key-input');
  const apiKey = input?.value?.trim();

  if (!apiKey) {
    return;
  }

  try {
    // Use cmd_add_api_key for multi-key support
    await invokeWithTimeout('cmd_add_api_key', {
      name: 'Key ' + (state.apiKeys.length + 1),
      color: '#00d4ff',
      api_key: apiKey,
      refresh_interval: settings.refresh_interval_seconds || 20
    }, WRITE_IPC_TIMEOUT_MS);
    hideApiKeyDialog();
    await loadApiKeys();
    runInBackground('refresh after saving API key', refreshAllUsage);
  } catch (error) {
    console.error('Save API key error:', error);
    alert(state.language === 'zh-CN' ? '保存失败: ' + error : 'Failed to save: ' + error);
  }
}

async function clearApiKey() {
  if (!tauriInvoke) return;

  if (!confirm(state.language === 'zh-CN' ? 'Clear all API keys and data?' : 'Clear all API keys and data?')) return;

  try {
    // Delete all keys
    for (const key of state.apiKeys) {
      await invokeWithTimeout('cmd_delete_api_key', { id: key.id }, WRITE_IPC_TIMEOUT_MS);
    }
    state.apiKeys = [];
    state.usageData = {};
    scheduleRender();
  } catch (error) {
    console.error('Clear API key error:', error);
  }
}

function showApiKeyDialog() {
  if (!canOpenTransientDialog()) return;
  // Guard: if init() hasn't completed yet, do nothing
  // (state.config is null before init finishes loading config and keys)
  if (state.config === null) {
    return;
  }
  // If API keys already exist, open the management modal instead
  if (state.apiKeys.length > 0) {
    showKeyManagementModal();
    return;
  }
  const dialog = document.getElementById('api-key-dialog');
  const input = document.getElementById('api-key-input');
  if (dialog) {
    setDialogVisibility('api-key-dialog', true);
    if (input) {
      input.value = '';
      input.focus();
    }
  }
}

function hideApiKeyDialog() {
  setDialogVisibility('api-key-dialog', false);
}

async function toggleLanguage() {
  if (!tauriInvoke) return;

  state.language = state.language === 'zh-CN' ? 'en' : 'zh-CN';

  // Save preference
  try {
    const newConfig = { ...state.config, language: state.language };
    await invokeWithTimeout('cmd_save_config', { config: newConfig }, WRITE_IPC_TIMEOUT_MS);
    state.config = newConfig;
  } catch (error) {
    console.error('Save language error:', error);
  }

  applyI18n();
  scheduleRender();
}

async function loadSettings() {
  if (!tauriInvoke) return;

  try {
    const config = await invokeWithTimeout('cmd_get_config', undefined, SETTINGS_IPC_TIMEOUT_MS);
    settings.refresh_interval_seconds = normalizeRefreshIntervalSeconds(config.refresh_interval_seconds);
    settings.start_minimized = config.start_minimized || false;
    settings.enable_notifications = config.enable_notifications !== false;
    settings.show_percent_in_tray = config.show_percent_in_tray !== false;
    settings.tray_icon_style = config.tray_icon_style || 'default';

    // Load autostart status
    settings.autostart = await invokeOrFallback(
      'cmd_get_autostart',
      undefined,
      false,
      SETTINGS_IPC_TIMEOUT_MS,
    );

    // Update UI
    const startMinimizedEl = document.getElementById('setting-start-minimized');
    const autostartEl = document.getElementById('setting-autostart');
    const notificationsEl = document.getElementById('setting-notifications');
    const showPercentInTrayEl = document.getElementById('setting-show-percent-in-tray');
    const refreshIntervalEl = document.getElementById('setting-refresh-interval');

    if (refreshIntervalEl) refreshIntervalEl.value = String(settings.refresh_interval_seconds);
    if (startMinimizedEl) startMinimizedEl.checked = settings.start_minimized;
    if (autostartEl) autostartEl.checked = settings.autostart;
    if (notificationsEl) notificationsEl.checked = settings.enable_notifications;
    if (showPercentInTrayEl) showPercentInTrayEl.checked = settings.show_percent_in_tray;

    attachSettingsHandlers();

    // Tray icon style
    const trayIconStyleEl = document.getElementById('setting-tray-icon-style');
    if (trayIconStyleEl) {
      trayIconStyleEl.value = settings.tray_icon_style;
      trayIconStyleEl.addEventListener('change', (e) => {
        saveSetting('tray_icon_style', e.target.value);
      });
    }
  } catch (error) {
    console.error('Load settings error:', error);
  }
}

function attachSettingsHandlers() {
  if (settingsHandlersInitialized) return;
  settingsHandlersInitialized = true;

  const startMinimizedEl = document.getElementById('setting-start-minimized');
  const autostartEl = document.getElementById('setting-autostart');
  const notificationsEl = document.getElementById('setting-notifications');
  const showPercentInTrayEl = document.getElementById('setting-show-percent-in-tray');
  const refreshIntervalEl = document.getElementById('setting-refresh-interval');

  startMinimizedEl?.addEventListener('change', (e) => {
    saveSetting('start_minimized', e.target.checked);
  });

  autostartEl?.addEventListener('change', (e) => {
    saveAutostart(e.target.checked);
  });

  notificationsEl?.addEventListener('change', (e) => {
    saveSetting('enable_notifications', e.target.checked);
  });

  showPercentInTrayEl?.addEventListener('change', (e) => {
    saveSetting('show_percent_in_tray', e.target.checked);
  });

  refreshIntervalEl?.addEventListener('change', async (e) => {
    const normalized = normalizeRefreshIntervalSeconds(e.target.value);
    e.target.value = String(normalized);
    await saveSetting('refresh_interval_seconds', normalized);
    restartAutoRefreshTimer();
  });
}

async function saveSetting(key, value) {
  if (!tauriInvoke) return;

  try {
    const config = await invokeWithTimeout('cmd_get_config', undefined, SETTINGS_IPC_TIMEOUT_MS);
    config[key] = value;
    await invokeWithTimeout('cmd_save_config', { config }, WRITE_IPC_TIMEOUT_MS);
    settings[key] = value;
    state.config = { ...state.config, ...config };
  } catch (error) {
    console.error('Save setting error:', error);
  }
}

function normalizeRefreshIntervalSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 20;
  return Math.min(3600, Math.max(5, Math.round(parsed)));
}

async function saveAutostart(enabled) {
  if (!tauriInvoke) return;

  try {
    await invokeWithTimeout('cmd_set_autostart', { enabled }, WRITE_IPC_TIMEOUT_MS);
    settings.autostart = enabled;
  } catch (error) {
    console.error('Save autostart error:', error);
    // Revert UI state
    const autostartEl = document.getElementById('setting-autostart');
    if (autostartEl) autostartEl.checked = !enabled;
  }
}

function t(key) {
  return i18n[state.language]?.[key] || i18n['zh-CN'][key] || key;
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });

  // Update active language indicator
  const langZh = document.getElementById('lang-zh');
  const langEn = document.getElementById('lang-en');
  if (langZh) langZh.classList.toggle('active', state.language === 'zh-CN');
  if (langEn) langEn.classList.toggle('active', state.language === 'en');

  // Update document lang
  document.documentElement.lang = state.language === 'zh-CN' ? 'zh-CN' : 'en';
}

function render() {
  const emptyNoKey = document.getElementById('empty-state-no-key');
  const emptyLoading = document.getElementById('empty-state-loading');
  const emptyError = document.getElementById('empty-state-error');
  const dashboard = document.getElementById('dashboard');
  // Hide all states
  setElementDisplay(emptyNoKey, 'none');
  setElementDisplay(emptyLoading, 'none');
  setElementDisplay(emptyError, 'none');
  setElementDisplay(dashboard, 'none');
  setDialogVisibility('api-key-dialog', false);

  if (state.isBooting) {
    setElementDisplay(emptyLoading, 'block');
    return;
  }

  if (state.apiKeys.length === 0) {
    setElementDisplay(emptyNoKey, 'block');
    return;
  }

  // Render dashboard
  setElementDisplay(dashboard, 'block');
  renderDashboard();
}

function renderDashboard() {
  // Calculate aggregate data from all keys
  let totalUsed = 0, totalRemaining = 0, totalCount = 0;
  let hasData = false;
  let primaryModelName = '';
  let intervalLabel = '';

  state.apiKeys.forEach(key => {
    const data = state.usageData[key.id];
    if (data && data.ok) {
      hasData = true;
      totalUsed += data.used_count || 0;
      totalRemaining += data.remaining_count || 0;
      totalCount += data.total_count || 0;
      if (!primaryModelName && data.primary_model_name) {
        primaryModelName = data.primary_model_name;
        intervalLabel = data.interval_label || '';
      }
    }
  });

  // Header info
  setText('primary-model', primaryModelName || t('unknown'));
  const hasAnyUsage = Object.keys(state.usageData).length > 0;
  const statusLabel = state.lastError && !hasData
    ? t('syncUnavailable')
    : (state.isLoading && !hasData ? t('waitingData') : t('na'));
  setText('interval-label', intervalLabel || statusLabel);

  // Current interval aggregate
  const currentPercent = totalCount > 0 ? (totalUsed / totalCount) * 100 : 0;
  const currentStatus = getStatus(currentPercent);

  setText('current-used', formatNumber(totalUsed));
  setFlipNumber('current-remaining-container', 'current-remaining', formatNumber(totalRemaining));
  setText('current-total', formatNumber(totalCount));
  setText('current-percent', `${Math.round(currentPercent)}%`);

  updateProgressBar('current-card', 'current-progress', currentPercent, currentStatus);
  updateRemainingBreath('current-remaining', 'current-remaining-wrapper', currentStatus);

  // Find earliest reset timestamp
  let earliestReset = 0;
  state.apiKeys.forEach(key => {
    const data = state.usageData[key.id];
    if (data && data.reset_timestamp && (earliestReset === 0 || data.reset_timestamp < earliestReset)) {
      earliestReset = data.reset_timestamp;
    }
  });
  if (earliestReset > 0) {
    const timerEl = document.getElementById('window-countdown');
    setElementAttr(timerEl, 'data-timestamp', earliestReset);
  }

  // Weekly interval aggregate (use first key's weekly data for now)
  let weeklyUsed = 0, weeklyRemaining = 0, weeklyTotal = 0;
  let weeklyPercent = 0;
  let weeklyStatus = 'normal';

  state.apiKeys.forEach(key => {
    const data = state.usageData[key.id];
    if (data && data.ok) {
      weeklyUsed += data.weekly_used_count || 0;
      weeklyRemaining += data.weekly_remaining_count || 0;
      weeklyTotal += data.weekly_total_count || 0;
    }
  });

  if (weeklyTotal > 0) {
    weeklyPercent = (weeklyUsed / weeklyTotal) * 100;
    weeklyStatus = getStatus(weeklyPercent);
  }

  setText('weekly-used', formatNumber(weeklyUsed));
  setFlipNumber('weekly-remaining-container', 'weekly-remaining', formatNumber(weeklyRemaining));
  setText('weekly-total', formatNumber(weeklyTotal));
  setText('weekly-percent', `${Math.round(weeklyPercent)}%`);

  updateProgressBar('weekly-card', 'weekly-progress', weeklyPercent, weeklyStatus);
  updateRemainingBreath('weekly-remaining', 'weekly-remaining-wrapper', weeklyStatus);

  // Find earliest weekly reset
  let earliestWeeklyReset = 0;
  state.apiKeys.forEach(key => {
    const data = state.usageData[key.id];
    if (data && data.weekly_reset_timestamp && (earliestWeeklyReset === 0 || data.weekly_reset_timestamp < earliestWeeklyReset)) {
      earliestWeeklyReset = data.weekly_reset_timestamp;
    }
  });
  if (earliestWeeklyReset > 0) {
    const timerEl = document.getElementById('weekly-countdown');
    setElementAttr(timerEl, 'data-timestamp', earliestWeeklyReset);
  }

  // Risk alert - show if any key is at risk
  const riskCard = document.getElementById('risk-alert-card');
  const anyKeyAtRisk = state.apiKeys.some(key => {
    const data = state.usageData[key.id];
    return data && data.used_percent >= 70;
  });

  if (anyKeyAtRisk) {
    if (riskCard) {
      setElementDisplay(riskCard, 'flex');
      setElementClass(riskCard, `cyber-card risk-alert ${currentStatus}`);
      setText('risk-remaining-percent', String(Math.round(100 - currentPercent)));
      const riskMsg = document.getElementById('risk-message');
      if (riskMsg) {
        const riskKey = currentPercent >= 90 ? 'riskExhausted' : 'riskFast';
        setElementAttr(riskMsg, 'data-i18n', riskKey);
        const riskText = t(riskKey);
        if (riskMsg.textContent !== riskText) {
          riskMsg.textContent = riskText;
        }
      }
      const riskIcon = document.getElementById('risk-icon');
      if (riskIcon) {
        const riskIconText = currentPercent >= 90 ? '🚨' : '⚠️';
        if (riskIcon.textContent !== riskIconText) {
          riskIcon.textContent = riskIconText;
        }
      }
    }
  } else {
    setElementDisplay(riskCard, 'none');
  }

  // Model details - combine from all keys (take first key's models for now)
  const firstKeyWithData = state.apiKeys.find(key => {
    const data = state.usageData[key.id];
    return data && data.ok && data.models && data.models.length > 0;
  });
  if (firstKeyWithData) {
    renderModelDetails(state.usageData[firstKeyWithData.id]);
  } else {
    renderModelDetails(null);
  }

  // Last updated - use first key's timestamp
  const firstKeyData = state.apiKeys.length > 0 ? state.usageData[state.apiKeys[0].id] : null;
  setText('last-updated', firstKeyData?.last_updated || (state.lastError || (hasAnyUsage ? t('na') : t('waitingData'))));
}

function renderModelDetails(data) {
  const tbody = document.getElementById('model-table-body');
  if (!tbody) return;

  if (!data || !data.models || data.models.length === 0) {
    modelDetailsSignature = '';
    const emptyRows = `<tr><td colspan="5" class="model-details-empty">${t('perModelEmpty')}</td></tr>`;
    if (tbody.innerHTML !== emptyRows) {
      tbody.innerHTML = emptyRows;
      modelTableHtmlCache.set(tbody, emptyRows);
    }
    const badge = document.getElementById('model-count-badge');
    if (badge) {
      const badgeText = `${t('topItems')} 0 ${t('itemsSuffix')}`;
      if (badge.textContent !== badgeText) {
        badge.textContent = badgeText;
      }
    }
    return;
  }

  const modelLimit = Math.min(state.config?.detail_model_limit || 8, data.models.length);

  const signatureParts = [
    String(modelLimit),
    String(data.last_updated || ''),
  ];
  for (let i = 0; i < modelLimit; i += 1) {
    const model = data.models[i];
    signatureParts.push(
      `${model.name}|${model.used_count}|${model.remaining_count}|${model.total_count}|${model.time_window || ''}`,
    );
  }
  const nextSignature = signatureParts.join('||');
  const modelDataChanged = nextSignature !== modelDetailsSignature;
  modelDetailsSignature = nextSignature;

  if (modelDataChanged) {
    const rows = data.models.slice(0, modelLimit).map(model => `
      <tr>
        <td class="model-cell" title="${escapeHtml(model.name)}">${escapeHtml(model.name)}</td>
        <td class="metric-cell used">${formatNumber(model.used_count)}</td>
        <td class="metric-cell remaining">${formatNumber(model.remaining_count)}</td>
        <td class="metric-cell total">${formatNumber(model.total_count)}</td>
        <td class="window-cell">${escapeHtml(model.time_window || '00:00 ~ 00:00')}</td>
      </tr>
    `).join('');

    if (modelTableHtmlCache.get(tbody) !== rows) {
      tbody.innerHTML = rows;
      modelTableHtmlCache.set(tbody, rows);
    }
  }

  // Update badge
  const badge = document.getElementById('model-count-badge');
  if (badge) {
    const badgeText = `${t('topItems')} ${modelLimit} ${t('itemsSuffix')}`;
    if (badge.textContent !== badgeText) {
      badge.textContent = badgeText;
    }
  }

  // Update timestamp
  const updated = document.getElementById('model-updated');
  if (updated) {
    const updatedText = `${t('modelDetails')}${t('unknown')}: ${data.last_updated || t('na')}`;
    if (updated.textContent !== updatedText) {
      updated.textContent = updatedText;
    }
  }
}

function updateProgressBar(cardId, progressId, percent, status) {
  const card = document.getElementById(cardId);
  const progress = document.getElementById(progressId);

  setElementClass(card, `cyber-card ${status}`);
  if (progress) {
    const width = `${percent}%`;
    if (progress.style.width !== width) {
      progress.style.width = width;
    }
    setElementClass(progress, `progress-thumb ${status === 'secondary' ? 'secondary' : ''} ${status}`);
  }
}

function updateRemainingBreath(valueId, wrapperId, status) {
  const valueEl = document.getElementById(valueId);
  const wrapper = document.getElementById(wrapperId);

  setElementClass(valueEl, `data-value success remaining-breath ${status}`);
  setElementClass(wrapper, `data-item breathing-metric ${status}`);
}

const flipTimers = new WeakMap();

function setFlipNumber(containerId, valueId, nextValue) {
  const valueEl = document.getElementById(valueId);
  if (!valueEl) return;

  const container = document.getElementById(containerId);
  const next = String(nextValue);

  if (!container) {
    valueEl.textContent = next;
    return;
  }

  const previous = container.dataset.value;
  const changed = previous !== next;
  container.dataset.value = next;

  if (!changed) return;

  valueEl.textContent = next;
  if (!previous) return;

  container.classList.remove('flipping');
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        container.classList.add('flipping');
      });
    });
  } else {
    setTimeout(() => {
      container.classList.add('flipping');
    }, 0);
  }

  const timer = flipTimers.get(container);
  if (timer) clearTimeout(timer);
  const cleanupTimer = setTimeout(() => {
    container.classList.remove('flipping');
  }, 2020);
  flipTimers.set(container, cleanupTimer);
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const next = String(value);
  if (el.textContent !== next) {
    el.textContent = next;
  }
}

function formatNumber(value) {
  if (typeof value !== 'number') return '-';
  return new Intl.NumberFormat().format(value);
}

function clampPercent(value) {
  if (value === null || value === undefined || isNaN(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function getStatus(percent) {
  if (percent >= 90) return 'critical';
  if (percent >= 70) return 'warning';
  return 'normal';
}

function escapeHtml(value) {
  if (!value) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let countdownInterval = null;
let autoRefreshInterval = null;
const countdownTargets = [];

function syncCountdownTargets() {
  countdownTargets.length = 0;
  const windowCountdownEl = document.getElementById('window-countdown');
  const weeklyCountdownEl = document.getElementById('weekly-countdown');
  if (windowCountdownEl) countdownTargets.push(windowCountdownEl);
  if (weeklyCountdownEl) countdownTargets.push(weeklyCountdownEl);
}

function startCountdownTimer() {
  if (countdownInterval) clearInterval(countdownInterval);
  syncCountdownTargets();
  countdownInterval = setInterval(() => {
    countdownTargets.forEach((el) => {
      const ts = parseInt(el.getAttribute('data-timestamp'), 10);
      if (ts > 0) {
        const nextText = formatCountdown(ts);
        if (el.textContent !== nextText) {
          el.textContent = nextText;
        }
      }
    });
  }, 1000);
}

function restartAutoRefreshTimer() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }

  // Native backend owns periodic refresh so the tray title keeps updating
  // even when the WebView window is hidden or throttled.
}

// Multi-key functions
async function loadApiKeys() {
  if (!tauriInvoke) return;
  try {
    const keys = await invokeWithTimeout('cmd_get_api_keys', undefined, BOOT_IPC_TIMEOUT_MS);
    state.apiKeys = keys || [];
  } catch (e) {
    console.error('Failed to load API keys:', e);
    state.apiKeys = [];
  }
}

async function loadAllUsageData() {
  if (!tauriInvoke) return;
  try {
    const allData = await invokeWithTimeout('cmd_get_all_usage_data', undefined, BOOT_IPC_TIMEOUT_MS);
    state.usageData = allData || {};
  } catch (e) {
    console.error('Failed to load usage data:', e);
    state.usageData = {};
  }
}

// Key management modal functions
function showKeyManagementModal() {
  if (!canOpenTransientDialog()) return;
  const modal = document.getElementById('key-management-modal');
  if (!modal) return;

  closeTransientDialogs();
  renderKeyList();
  setDialogVisibility('key-management-modal', true);
}

function renderKeyList() {
  const container = document.getElementById('key-list');
  if (!container) return;

  if (state.apiKeys.length === 0) {
    container.innerHTML = `<div class="empty-state" style="display: block; margin: 0; padding: 40px 20px;">
      <p style="margin: 0;">No API keys configured.</p>
    </div>`;
    return;
  }

  container.innerHTML = state.apiKeys.map(key => {
    const data = state.usageData[key.id];
    const percent = data?.used_percent || 0;
    const statusClass = percent >= 90 ? 'critical' : percent >= 70 ? 'warning' : 'normal';
    return `
      <div class="key-list-item">
        <span class="key-color-dot" style="background: ${key.color}; width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0;"></span>
        <span class="key-name">${escapeHtml(key.name)}</span>
        <span class="key-interval">${key.refresh_interval}s</span>
        <button class="js-edit-key" data-key-id="${escapeHtml(key.id)}">Edit</button>
        <button class="danger js-delete-key" data-key-id="${escapeHtml(key.id)}">Delete</button>
      </div>
    `;
  }).join('');
}

function openKeyEditDialog(keyId = null) {
  if (!canOpenTransientDialog()) return;
  const dialog = document.getElementById('key-edit-dialog');
  const title = document.getElementById('key-edit-title');
  const idInput = document.getElementById('key-edit-id');
  const nameInput = document.getElementById('key-edit-name');
  const colorInput = document.getElementById('key-edit-color');
  const intervalInput = document.getElementById('key-edit-interval');
  const apiKeyInput = document.getElementById('key-edit-api-key');

  if (keyId) {
    // Edit mode
    const key = state.apiKeys.find(k => k.id === keyId);
    if (key) {
      title.textContent = state.language === 'zh-CN' ? 'Edit API Key' : 'Edit API Key';
      idInput.value = key.id;
      nameInput.value = key.name;
      colorInput.value = key.color;
      intervalInput.value = key.refresh_interval;
      apiKeyInput.value = '';
      apiKeyInput.placeholder = state.language === 'zh-CN' ? 'Leave empty to keep current key' : 'Leave empty to keep current key';
    }
  } else {
    // Add mode
    title.textContent = state.language === 'zh-CN' ? 'Add API Key' : 'Add API Key';
    idInput.value = '';
    nameInput.value = '';
    colorInput.value = '#00d4ff';
    intervalInput.value = '20';
    apiKeyInput.value = '';
    apiKeyInput.placeholder = 'API Key';
  }

  setDialogVisibility('key-edit-dialog', true);
}

function closeKeyEditDialog() {
  setDialogVisibility('key-edit-dialog', false);
}

window.addEventListener('focus', () => {
  closeTransientDialogs();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    closeTransientDialogs();
  }
});

async function saveKeyEdit() {
  const id = document.getElementById('key-edit-id').value;
  const name = document.getElementById('key-edit-name').value.trim();
  const color = document.getElementById('key-edit-color').value;
  const interval = parseInt(document.getElementById('key-edit-interval').value) || 20;
  const apiKey = document.getElementById('key-edit-api-key').value.trim();

  if (!name) {
    alert(state.language === 'zh-CN' ? 'Please enter a name' : 'Please enter a name');
    return;
  }

  try {
    if (id) {
      await invokeWithTimeout('cmd_update_api_key', {
        id, name, color, refresh_interval: interval, api_key: apiKey || null
      }, WRITE_IPC_TIMEOUT_MS);
    } else {
      if (!apiKey) {
        alert(state.language === 'zh-CN' ? 'Please enter an API key' : 'Please enter an API key');
        return;
      }
      await invokeWithTimeout('cmd_add_api_key', {
        name, color, api_key: apiKey, refresh_interval: interval
      }, WRITE_IPC_TIMEOUT_MS);
    }
    closeKeyEditDialog();
    await loadApiKeys();
    await loadAllUsageData();
    renderKeyList();
    scheduleRender();
    runInBackground('refresh after key edit', refreshAllUsage);
  } catch (e) {
    alert(state.language === 'zh-CN' ? 'Failed to save: ' + e : 'Failed to save: ' + e);
  }
}

async function deleteKey(keyId) {
  if (!confirm(state.language === 'zh-CN' ? 'Delete this API key?' : 'Delete this API key?')) return;
  try {
    await invokeWithTimeout('cmd_delete_api_key', { id: keyId }, WRITE_IPC_TIMEOUT_MS);
    await loadApiKeys();
    await loadAllUsageData();
    renderKeyList();
    scheduleRender();
  } catch (e) {
    alert(state.language === 'zh-CN' ? 'Failed to delete: ' + e : 'Failed to delete: ' + e);
  }
}

function formatCountdown(timestamp) {
  if (!timestamp || timestamp <= 0) return '--:--:--';
  const now = Date.now();
  const diff = timestamp - now;
  if (diff <= 0) return '00:00:00';

  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);

  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

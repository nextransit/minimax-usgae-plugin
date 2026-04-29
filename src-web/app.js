// MiniMax Usage Monitor - Tauri Frontend
console.log('[DEBUG] app.js script loaded');

// Immediately hide the API key dialog on script load (belt and suspenders)
(function() {
    var dialog = document.getElementById('api-key-dialog');
    if (dialog) {
        dialog.style.display = 'none';
        console.log('[DEBUG] Hidden api-key-dialog on load');
    }
})();

// Global error handler
window.onerror = function(msg, url, line, col, error) {
    console.error('[GLOBAL ERROR]', msg, 'at line', line, 'col', col);
    return false;
};

let tauriInvoke = null;
let tauriListen = null;

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
  },
};

// App State
let state = {
  apiKey: null,
  usageData: null,
  config: null,
  language: 'zh-CN',
  isLoading: false,
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

// Initialize app
async function init() {
  console.log('[DEBUG init] Function started');
  try {
    console.log('[DEBUG init] Waiting for Tauri API...');
    const tauri = await waitForTauriAPI();
    console.log('[DEBUG init] Tauri API found');
    tauriInvoke = tauri.invoke;
    tauriListen = tauri.listen;

    // Load config
    console.log('[DEBUG init] Loading config...');
    state.config = await tauriInvoke('cmd_get_config');
    state.language = state.config?.language === 'auto' ? 'zh-CN' : (state.config?.language || 'zh-CN');

    // Load API key
    console.log('[DEBUG init] Loading API key...');
    const fetchedApiKey = await tauriInvoke('cmd_get_api_key');
    console.log('[DEBUG init] Got API key:', fetchedApiKey ? '***' + fetchedApiKey.slice(-8) : 'null');
    state.apiKey = fetchedApiKey;

    // Apply i18n
    console.log('[DEBUG init] Applying i18n...');
    applyI18n();

    // Setup event listeners
    console.log('[DEBUG init] Setting up event listeners...');
    await setupEventListeners();

    // Setup UI event handlers
    console.log('[DEBUG init] Setting up UI handlers...');
    setupUiHandlers();

    // Initial render
    console.log('[DEBUG init] Rendering...');
    render();

    // Start countdown timer
    console.log('[DEBUG init] Starting countdown timer...');
    startCountdownTimer();

    // Load settings
    console.log('[DEBUG init] Loading settings...');
    await loadSettings();
    restartAutoRefreshTimer();

    // If we have API key, fetch usage data
    console.log('[DEBUG init] API key check:', !!state.apiKey);
    if (state.apiKey) {
      console.log('[DEBUG init] Fetching usage data...');
      await refreshUsage();
    }
    console.log('[DEBUG init] Done!');
  } catch (error) {
    console.error('[DEBUG init] Error:', error);
    showStartupError(error);
  }
}

async function setupEventListeners() {
  if (!tauriListen) return;

  // Listen for usage updates from backend
  await tauriListen('usage-updated', (event) => {
    state.usageData = event.payload;
    render();
  });

  // Listen for show set key dialog event
  await tauriListen('show-set-key-dialog', () => {
    // Disable auto modal popup from background events; user opens it explicitly from UI.
    return;
  });
}

function showStartupError(error) {
  const emptyNoKey = document.getElementById('empty-state-no-key');
  const emptyLoading = document.getElementById('empty-state-loading');
  const dashboard = document.getElementById('dashboard');
  const emptyError = document.getElementById('empty-state-error');
  const errorMsg = document.getElementById('error-message');

  [emptyNoKey, emptyLoading, dashboard].forEach((el) => {
    if (el) el.style.display = 'none';
  });

  if (emptyError) emptyError.style.display = 'block';
  if (errorMsg) errorMsg.textContent = `Startup failed: ${String(error)}`;
}

function setupUiHandlers() {
  // Set API Key button
  document.getElementById('btn-set-key')?.addEventListener('click', showApiKeyDialog);

  // Retry sync button
  document.getElementById('btn-retry-sync')?.addEventListener('click', refreshUsage);

  // Reconnect button
  document.getElementById('btn-reconnect')?.addEventListener('click', refreshUsage);

  // Edit key button
  document.getElementById('btn-edit-key')?.addEventListener('click', showApiKeyDialog);

  // Refresh button
  document.getElementById('btn-refresh')?.addEventListener('click', refreshUsage);

  // Config key button
  document.getElementById('btn-config-key')?.addEventListener('click', showApiKeyDialog);

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
}

async function refreshUsage() {
  if (!tauriInvoke || !state.apiKey || state.isLoading) return;

  state.isLoading = true;
  render();

  try {
    const data = await tauriInvoke('cmd_fetch_usage', { apiKey: state.apiKey, timeoutMs: 15000 });
    state.usageData = data;
    await tauriInvoke('cmd_update_usage_data', { data });
    render();
  } catch (error) {
    console.error('Fetch error:', error);
    state.usageData = { ok: false, status_label: String(error) };
    render();
  } finally {
    state.isLoading = false;
  }
}

async function saveApiKey() {
  const input = document.getElementById('api-key-input');
  const apiKey = input?.value?.trim();

  if (!apiKey) {
    return;
  }

  try {
    await tauriInvoke('cmd_set_api_key', { key: apiKey });
    state.apiKey = apiKey;
    restartAutoRefreshTimer();
    hideApiKeyDialog();
    render();
    await refreshUsage();
  } catch (error) {
    console.error('Save API key error:', error);
  }
}

async function clearApiKey() {
  if (!tauriInvoke) return;

  try {
    await tauriInvoke('cmd_clear_api_key');
    state.apiKey = null;
    state.usageData = null;
    restartAutoRefreshTimer();
    render();
  } catch (error) {
    console.error('Clear API key error:', error);
  }
}

function showApiKeyDialog() {
  const dialog = document.getElementById('api-key-dialog');
  const input = document.getElementById('api-key-input');
  if (dialog) {
    dialog.style.display = 'flex';
    if (input) {
      input.value = '';
      input.focus();
    }
  }
}

function hideApiKeyDialog() {
  const dialog = document.getElementById('api-key-dialog');
  if (dialog) {
    dialog.style.display = 'none';
  }
}

async function toggleLanguage() {
  if (!tauriInvoke) return;

  state.language = state.language === 'zh-CN' ? 'en' : 'zh-CN';

  // Save preference
  try {
    const newConfig = { ...state.config, language: state.language };
    await tauriInvoke('cmd_save_config', { config: newConfig });
    state.config = newConfig;
  } catch (error) {
    console.error('Save language error:', error);
  }

  applyI18n();
  render();
}

async function loadSettings() {
  if (!tauriInvoke) return;

  try {
    const config = await tauriInvoke('cmd_get_config');
    settings.refresh_interval_seconds = normalizeRefreshIntervalSeconds(config.refresh_interval_seconds);
    settings.start_minimized = config.start_minimized || false;
    settings.enable_notifications = config.enable_notifications !== false;
    settings.show_percent_in_tray = config.show_percent_in_tray !== false;
    settings.tray_icon_style = config.tray_icon_style || 'default';

    // Load autostart status
    settings.autostart = await tauriInvoke('cmd_get_autostart');

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

    // Tray icon style
    const trayIconStyleEl = document.getElementById('setting-tray-icon-style');
    if (trayIconStyleEl) {
      trayIconStyleEl.value = settings.tray_icon_style;
      trayIconStyleEl.addEventListener('change', (e) => {
        saveSetting('tray_icon_style', e.target.value);
      });
    }

    // Add event listeners
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
  } catch (error) {
    console.error('Load settings error:', error);
  }
}

async function saveSetting(key, value) {
  if (!tauriInvoke) return;

  try {
    const config = await tauriInvoke('cmd_get_config');
    config[key] = value;
    await tauriInvoke('cmd_save_config', { config });
    settings[key] = value;
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
    await tauriInvoke('cmd_set_autostart', { enabled });
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
  console.log('[DEBUG render] state.apiKey:', state.apiKey ? '***' + state.apiKey.slice(-8) : 'null');

  const emptyNoKey = document.getElementById('empty-state-no-key');
  const emptyLoading = document.getElementById('empty-state-loading');
  const emptyError = document.getElementById('empty-state-error');
  const dashboard = document.getElementById('dashboard');
  const apiKeyDialog = document.getElementById('api-key-dialog');

  // Hide all states
  [emptyNoKey, emptyLoading, emptyError, dashboard, apiKeyDialog].forEach(el => {
    if (el) el.style.display = 'none';
  });

  if (!state.apiKey) {
    console.log('[DEBUG render] Showing empty-state-no-key');
    if (emptyNoKey) emptyNoKey.style.display = 'block';
    return;
  }

  if (state.isLoading && !state.usageData) {
    console.log('[DEBUG render] Showing empty-state-loading');
    if (emptyLoading) emptyLoading.style.display = 'block';
    return;
  }

  if (state.usageData && !state.usageData.ok) {
    console.log('[DEBUG render] Showing empty-state-error');
    if (emptyError) {
      emptyError.style.display = 'block';
      const errorMsg = document.getElementById('error-message');
      if (errorMsg) errorMsg.textContent = state.usageData.status_label || 'Unknown error';
    }
    return;
  }

  if (!state.usageData) {
    console.log('[DEBUG render] Showing empty-state-loading (no data)');
    if (emptyLoading) emptyLoading.style.display = 'block';
    return;
  }

  // Render dashboard
  console.log('[DEBUG render] Showing dashboard');
  if (dashboard) dashboard.style.display = 'block';
  renderDashboard();
}

function renderDashboard() {
  const data = state.usageData;
  if (!data || !data.ok) return;

  // Header info
  setText('primary-model', data.primary_model_name || t('unknown'));
  setText('interval-label', data.interval_label || t('na'));

  // Current interval
  const currentPercent = clampPercent(data.used_percent);
  const currentStatus = getStatus(currentPercent);

  setText('current-used', formatNumber(data.used_count));
  setFlipNumber('current-remaining-container', 'current-remaining', formatNumber(data.remaining_count));
  setText('current-total', formatNumber(data.total_count));
  setText('current-percent', `${Math.round(currentPercent)}%`);

  updateProgressBar('current-card', 'current-progress', currentPercent, currentStatus);
  updateRemainingBreath('current-remaining', 'current-remaining-wrapper', currentStatus);

  if (data.reset_timestamp) {
    const timerEl = document.getElementById('window-countdown');
    if (timerEl) timerEl.setAttribute('data-timestamp', String(data.reset_timestamp));
  }

  // Weekly interval
  const weeklyPercent = clampPercent(data.weekly_used_percent);
  const weeklyStatus = getStatus(weeklyPercent);

  setText('weekly-used', formatNumber(data.weekly_used_count));
  setFlipNumber('weekly-remaining-container', 'weekly-remaining', formatNumber(data.weekly_remaining_count));
  setText('weekly-total', formatNumber(data.weekly_total_count));
  setText('weekly-percent', `${Math.round(weeklyPercent)}%`);

  updateProgressBar('weekly-card', 'weekly-progress', weeklyPercent, weeklyStatus);
  updateRemainingBreath('weekly-remaining', 'weekly-remaining-wrapper', weeklyStatus);

  if (data.weekly_reset_timestamp) {
    const timerEl = document.getElementById('weekly-countdown');
    if (timerEl) timerEl.setAttribute('data-timestamp', String(data.weekly_reset_timestamp));
  }

  // Risk alert
  const riskCard = document.getElementById('risk-alert-card');
  if (currentPercent >= 70) {
    if (riskCard) {
      riskCard.style.display = 'flex';
      riskCard.className = `cyber-card risk-alert ${currentStatus}`;
      setText('risk-remaining-percent', String(Math.round(100 - currentPercent)));
      const riskMsg = document.getElementById('risk-message');
      if (riskMsg) {
        riskMsg.setAttribute('data-i18n', currentPercent >= 90 ? 'riskExhausted' : 'riskFast');
        riskMsg.textContent = t(currentPercent >= 90 ? 'riskExhausted' : 'riskFast');
      }
      const riskIcon = document.getElementById('risk-icon');
      if (riskIcon) riskIcon.textContent = currentPercent >= 90 ? '🚨' : '⚠️';
    }
  } else {
    if (riskCard) riskCard.style.display = 'none';
  }

  // Model details
  renderModelDetails(data);

  // Last updated
  setText('last-updated', data.last_updated || t('na'));
}

function renderModelDetails(data) {
  const tbody = document.getElementById('model-table-body');
  if (!tbody) return;

  const modelLimit = Math.min(state.config?.detail_model_limit || 8, data.models?.length || 0);

  if (!data.models || data.models.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="model-details-empty">${t('perModelEmpty')}</td></tr>`;
    return;
  }

  const rows = data.models.slice(0, modelLimit).map(model => `
    <tr>
      <td class="model-cell" title="${escapeHtml(model.name)}">${escapeHtml(model.name)}</td>
      <td class="metric-cell used">${formatNumber(model.used_count)}</td>
      <td class="metric-cell remaining">${formatNumber(model.remaining_count)}</td>
      <td class="metric-cell total">${formatNumber(model.total_count)}</td>
      <td class="window-cell">${escapeHtml(model.time_window || '00:00 ~ 00:00')}</td>
    </tr>
  `).join('');

  tbody.innerHTML = rows;

  // Update badge
  const badge = document.getElementById('model-count-badge');
  if (badge) {
    badge.textContent = `${t('topItems')} ${modelLimit} ${t('itemsSuffix')}`;
  }

  // Update timestamp
  const updated = document.getElementById('model-updated');
  if (updated) {
    updated.textContent = `${t('modelDetails')}${t('unknown')}: ${data.last_updated || t('na')}`;
  }
}

function updateProgressBar(cardId, progressId, percent, status) {
  const card = document.getElementById(cardId);
  const progress = document.getElementById(progressId);

  if (card) card.className = `cyber-card ${status}`;
  if (progress) {
    progress.style.width = `${percent}%`;
    progress.className = `progress-thumb ${status === 'secondary' ? 'secondary' : ''} ${status}`;
  }
}

function updateRemainingBreath(valueId, wrapperId, status) {
  const valueEl = document.getElementById(valueId);
  const wrapper = document.getElementById(wrapperId);

  if (valueEl) {
    valueEl.className = `data-value success remaining-breath ${status}`;
  }
  if (wrapper) {
    wrapper.className = `data-item breathing-metric ${status}`;
  }
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
  void container.offsetWidth;
  container.classList.add('flipping');

  const timer = flipTimers.get(container);
  if (timer) clearTimeout(timer);
  const cleanupTimer = setTimeout(() => {
    container.classList.remove('flipping');
  }, 2020);
  flipTimers.set(container, cleanupTimer);
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
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

function startCountdownTimer() {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    document.querySelectorAll('.timer-value[data-timestamp]').forEach((el) => {
      const ts = parseInt(el.getAttribute('data-timestamp'), 10);
      if (ts > 0) {
        el.textContent = formatCountdown(ts);
      }
    });
  }, 1000);
}

function restartAutoRefreshTimer() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }

  if (!state.apiKey) return;

  const intervalSeconds = normalizeRefreshIntervalSeconds(settings.refresh_interval_seconds);
  autoRefreshInterval = setInterval(() => {
    refreshUsage();
  }, intervalSeconds * 1000);
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
console.log('[DEBUG] readyState:', document.readyState);
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    console.log('[DEBUG] DOM already loaded, calling init directly');
    init();
}

// Global error handler
window.onerror = function(msg, url, line, col, error) {
    console.error('[GLOBAL ERROR]', msg, 'at line', line, 'col', col);
    return false;
};

// Ping test
setInterval(async () => {
    if (window.__TAURI__) {
        try {
            const result = await window.__TAURI__.core.invoke('cmd_debug_state');
            console.log('[PING]', result);
        } catch (e) {
            console.log('[PING ERROR]', e);
        }
    } else {
        console.log('[PING] Tauri not ready');
    }
}, 5000);

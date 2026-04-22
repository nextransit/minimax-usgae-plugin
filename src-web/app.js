// MiniMax Usage Monitor - Tauri Frontend
// Wait for Tauri API to be available
function getTauriAPI() {
  if (typeof window.__TAURI__ === 'undefined') {
    console.error('Tauri API not available');
    return null;
  }
  return {
    invoke: window.__TAURI__.core?.invoke,
    listen: window.__TAURI__.event?.listen
  };
}

// i18n translations
const i18n = {
  'zh-CN': {
    settings: '设置',
    startMinimized: '启动时最小化到菜单栏',
    autoStart: '开机自动启动',
    enableNotifications: '启用系统通知',
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
    startMinimized: 'Start minimized to menu bar',
    autoStart: 'Launch at login',
    enableNotifications: 'Enable system notifications',
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
  start_minimized: false,
  autostart: false,
  enable_notifications: true,
};

// Initialize app
async function init() {
  try {
    // Load config
    state.config = await invoke('cmd_get_config');
    state.language = state.config?.language === 'auto' ? 'zh-CN' : (state.config?.language || 'zh-CN');
    
    // Load API key
    state.apiKey = await invoke('cmd_get_api_key');
    
    // Apply i18n
    applyI18n();
    
    // Setup event listeners
    await setupEventListeners();
    
    // Setup UI event handlers
    setupUiHandlers();
    
    // Initial render
    render();
    
    // Start countdown timer
    startCountdownTimer();

    // Load settings
    await loadSettings();

    // If we have API key, fetch usage data
    if (state.apiKey) {
      await refreshUsage();
    }
  } catch (error) {
    console.error('Init error:', error);
  }
}

async function setupEventListeners() {
  // Listen for usage updates from backend
  await listen('usage-updated', (event) => {
    state.usageData = event.payload;
    render();
  });
  
  // Listen for show set key dialog event
  await listen('show-set-key-dialog', () => {
    showApiKeyDialog();
  });
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
  if (!state.apiKey || state.isLoading) return;
  
  state.isLoading = true;
  render();
  
  try {
    const data = await invoke('cmd_fetch_usage', { apiKey: state.apiKey, timeoutMs: 15000 });
    state.usageData = data;
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
    await invoke('cmd_set_api_key', { key: apiKey });
    state.apiKey = apiKey;
    hideApiKeyDialog();
    render();
    await refreshUsage();
  } catch (error) {
    console.error('Save API key error:', error);
  }
}

async function clearApiKey() {
  try {
    await invoke('cmd_clear_api_key');
    state.apiKey = null;
    state.usageData = null;
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
  state.language = state.language === 'zh-CN' ? 'en' : 'zh-CN';
  
  // Save preference
  try {
    const newConfig = { ...state.config, language: state.language };
    await invoke('cmd_save_config', { config: newConfig });
    state.config = newConfig;
  } catch (error) {
    console.error('Save language error:', error);
  }
  
  applyI18n();
  render();
}

async function loadSettings() {
  try {
    const config = await invoke('cmd_get_config');
    settings.start_minimized = config.start_minimized || false;
    settings.enable_notifications = config.enable_notifications !== false;

    // Load autostart status
    settings.autostart = await invoke('cmd_get_autostart');

    // Update UI
    document.getElementById('setting-start-minimized').checked = settings.start_minimized;
    document.getElementById('setting-autostart').checked = settings.autostart;
    document.getElementById('setting-notifications').checked = settings.enable_notifications;

    // Add event listeners
    document.getElementById('setting-start-minimized').addEventListener('change', (e) => {
      saveSetting('start_minimized', e.target.checked);
    });

    document.getElementById('setting-autostart').addEventListener('change', (e) => {
      saveAutostart(e.target.checked);
    });

    document.getElementById('setting-notifications').addEventListener('change', (e) => {
      saveSetting('enable_notifications', e.target.checked);
    });
  } catch (error) {
    console.error('Load settings error:', error);
  }
}

async function saveSetting(key, value) {
  try {
    const config = await invoke('cmd_get_config');
    config[key] = value;
    await invoke('cmd_save_config', { config });
    settings[key] = value;
  } catch (error) {
    console.error('Save setting error:', error);
  }
}

async function saveAutostart(enabled) {
  try {
    await invoke('cmd_set_autostart', { enabled });
    settings.autostart = enabled;
  } catch (error) {
    console.error('Save autostart error:', error);
    // Revert UI state
    document.getElementById('setting-autostart').checked = !enabled;
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
  [emptyNoKey, emptyLoading, emptyError, dashboard].forEach(el => {
    if (el) el.style.display = 'none';
  });
  
  if (!state.apiKey) {
    if (emptyNoKey) emptyNoKey.style.display = 'block';
    return;
  }
  
  if (state.isLoading && !state.usageData) {
    if (emptyLoading) emptyLoading.style.display = 'block';
    return;
  }
  
  if (state.usageData && !state.usageData.ok) {
    if (emptyError) {
      emptyError.style.display = 'block';
      const errorMsg = document.getElementById('error-message');
      if (errorMsg) errorMsg.textContent = state.usageData.status_label || 'Unknown error';
    }
    return;
  }
  
  if (!state.usageData) {
    if (emptyLoading) emptyLoading.style.display = 'block';
    return;
  }
  
  // Render dashboard
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
  setText('current-remaining', formatNumber(data.remaining_count));
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
  setText('weekly-remaining', formatNumber(data.weekly_remaining_count));
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
document.addEventListener('DOMContentLoaded', init);
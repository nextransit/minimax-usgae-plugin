// MiniMax Monitor - __TAURI__ Bridge for VS Code Webview
// VS Code 环境下注入 window.__TAURI__ 模拟对象，
// 将 Tauri invoke/listen 桥接到 VS Code webview message passing。
// Tauri 原生环境下不做任何事。

(function () {
  if (window.__TAURI__) {
    return;
  }

  var vscodeApi;
  try {
    vscodeApi = acquireVsCodeApi();
  } catch (e) {
    return;
  }

  var invokeId = 0;
  var pendingInvokes = {};
  var eventListeners = {};
  var queuedEvents = {};

  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (!msg || !msg.type) return;

    if (msg.type === 'invoke_result') {
      var pending = pendingInvokes[msg.id];
      if (pending) {
        clearTimeout(pending.timer);
        delete pendingInvokes[msg.id];
        if (msg.ok) {
          pending.resolve(msg.data);
        } else {
          pending.reject(new Error(msg.error || 'Unknown error'));
        }
      }
    } else if (msg.type === 'event') {
      var listeners = eventListeners[msg.name];
      if (listeners) {
        for (var i = 0; i < listeners.length; i++) {
          try {
            listeners[i]({ payload: msg.payload });
          } catch (e) {
            console.error('[tauri-bridge] event listener error:', e);
          }
        }
      } else {
        if (!queuedEvents[msg.name]) queuedEvents[msg.name] = [];
        queuedEvents[msg.name].push(msg.payload);
      }
    }
  });

  function invoke(cmd, args) {
    return new Promise(function (resolve, reject) {
      var id = ++invokeId;
      var timer = setTimeout(function () {
        delete pendingInvokes[id];
        reject(new Error(cmd + ' timed out'));
      }, 30000);

      pendingInvokes[id] = { resolve: resolve, reject: reject, timer: timer };

      vscodeApi.postMessage({
        type: 'invoke',
        id: id,
        cmd: cmd,
        args: args,
      });
    });
  }

  function listen(eventName, callback) {
    if (!eventListeners[eventName]) {
      eventListeners[eventName] = [];
    }
    eventListeners[eventName].push(callback);

    var queued = queuedEvents[eventName];
    if (queued && queued.length > 0) {
      delete queuedEvents[eventName];
      setTimeout(function () {
        queued.forEach(function (payload) {
          try {
            callback({ payload: payload });
          } catch (e) {
            console.error('[tauri-bridge] queued event listener error:', e);
          }
        });
      }, 0);
    }

    return Promise.resolve(function () {
      var list = eventListeners[eventName];
      if (list) {
        var idx = list.indexOf(callback);
        if (idx >= 0) list.splice(idx, 1);
      }
    });
  }

  window.__TAURI__ = {
    platform: 'vscode',
    core: { invoke: invoke },
    event: { listen: listen },
  };
})();

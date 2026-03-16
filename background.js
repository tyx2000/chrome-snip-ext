const PAGE_CAPTURE_MENU_ID = "capture-visible-area";
const ACTION_SELECTION_MENU_ID = "launch-selection-mode";
const SIDE_PANEL_PATH = "sidepanel.html";
const SUCCESS_BADGE_DURATION_MS = 3000;

let clearBadgeTimer = null;
const selectionSessions = new Map();

chrome.runtime.onInstalled.addListener(() => {
  void setupExtensionUi();
});

chrome.runtime.onStartup.addListener(() => {
  void setupExtensionUi();
});

chrome.action.onClicked.addListener((tab) => {
  void openSelectionSidePanel(tab);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === PAGE_CAPTURE_MENU_ID) {
    void captureAndCopy(tab);
    return;
  }

  if (info.menuItemId === ACTION_SELECTION_MENU_ID) {
    void openSelectionSidePanel(tab);
  }
});

chrome.tabs.onActivated.addListener(() => {
  void broadcastStateForActiveTab();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    selectionSessions.delete(tabId);
  }

  void broadcastStateForActiveTab();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  selectionSessions.delete(tabId);
  void broadcastStateForActiveTab();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "capture-visible-area") {
    void handleCaptureVisibleArea(sender, sendResponse);
    return true;
  }

  if (message?.type === "selection-state-changed") {
    handleSelectionStateChanged(sender.tab, message.state);
    return undefined;
  }

  if (message?.type === "selection-session-closed") {
    handleSelectionSessionClosed(sender.tab);
    return undefined;
  }

  if (message?.type === "selection-copy-success") {
    void handleSelectionCopySuccess(sender.tab);
    return undefined;
  }

  if (message?.type === "selection-copy-failure") {
    void handleSelectionCopyFailure(sender.tab, message.error);
    return undefined;
  }

  if (message?.type === "sidepanel-request-state") {
    void handleSidePanelStateRequest(sendResponse);
    return true;
  }

  if (message?.type === "sidepanel-command") {
    void handleSidePanelCommand(message, sendResponse);
    return true;
  }

  return undefined;
});

async function setupExtensionUi() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
    await removeAllContextMenus();
    await createContextMenu({
      id: PAGE_CAPTURE_MENU_ID,
      title: "截取当前可视区域并复制到剪贴板",
      contexts: ["page"]
    });
    await createContextMenu({
      id: ACTION_SELECTION_MENU_ID,
      title: "打开选区侧边栏",
      contexts: ["action"]
    });
  } catch (error) {
    console.error("Failed to initialize extension UI:", error);
  }
}

async function captureAndCopy(invokedTab) {
  await setActionState({
    badgeText: "...",
    badgeColor: "#4b5563",
    title: "正在截取当前可视区域"
  });

  try {
    const tab = invokedTab?.id ? invokedTab : await getCurrentTab();
    if (!tab?.id) {
      throw new Error("未找到当前活动标签页。");
    }

    const imageDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "png"
    });

    await copyImageToClipboardInTab(tab, imageDataUrl);

    await setSuccessActionState({
      badgeText: "OK",
      badgeColor: "#15803d",
      title: "截图已复制到剪贴板"
    });
  } catch (error) {
    console.error("Capture or clipboard write failed:", error);

    await setActionState({
      badgeText: "",
      badgeColor: "#b91c1c",
      title: `截图失败：${getErrorMessage(error)}`
    });

    try {
      await notifyCaptureFailure(getErrorMessage(error));
    } catch (notificationError) {
      console.error("Failed to show capture failure notification:", notificationError);
    }
  }
}

async function openSelectionSidePanel(invokedTab) {
  const tab = invokedTab?.id ? invokedTab : await getCurrentTab();
  if (!tab?.id) {
    return;
  }

  await chrome.sidePanel.setOptions({
    tabId: tab.id,
    path: SIDE_PANEL_PATH,
    enabled: true
  });

  if (isInjectablePageUrl(tab.url)) {
    await launchSelectionMode(tab);
  } else {
    selectionSessions.set(tab.id, buildSelectionState(tab.id, tab.url, {
      supported: false,
      statusMessage: "当前页面不支持选区模式。请切换到普通网页后重试。"
    }));
  }

  await chrome.sidePanel.open({ tabId: tab.id });
  await broadcastStateForActiveTab();
}

async function launchSelectionMode(tab) {
  const previewDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: "png"
  });

  selectionSessions.set(tab.id, buildSelectionState(tab.id, tab.url, {
    isOpen: true,
    statusMessage: "拖动鼠标开始选择区域"
  }));

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: setSelectionBootstrapData,
    args: [{ previewDataUrl }]
  });

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["selection-ui.js"]
  });

  await setActionState({
    badgeText: "",
    badgeColor: "#4b5563",
    title: "选区模式已启动"
  });
}

async function handleSidePanelCommand(message, sendResponse) {
  try {
    const tab = await getCurrentTab();
    if (!tab?.id) {
      throw new Error("未找到当前活动标签页。");
    }

    if (message.command === "start-selection") {
      await openSelectionSidePanel(tab);
      sendResponse({
        ok: true,
        state: getSelectionStateForTab(tab.id, tab.url)
      });
      return;
    }

    if (!isInjectablePageUrl(tab.url)) {
      throw new Error("当前页面不支持选区模式。");
    }

    await relaySelectionCommand(tab.id, {
      type: "selection-ui-command",
      command: message.command,
      mode: message.mode,
      enabled: message.enabled
    });

    sendResponse({
      ok: true,
      state: getSelectionStateForTab(tab.id, tab.url)
    });
  } catch (error) {
    sendResponse({
      ok: false,
      error: getErrorMessage(error)
    });
  }
}

async function handleSidePanelStateRequest(sendResponse) {
  try {
    const tab = await getCurrentTab();
    sendResponse({
      ok: true,
      state: tab?.id ? getSelectionStateForTab(tab.id, tab.url) : buildSelectionState(null, "")
    });
  } catch (error) {
    sendResponse({
      ok: false,
      error: getErrorMessage(error)
    });
  }
}

function handleSelectionStateChanged(tab, state) {
  if (!tab?.id) {
    return;
  }

  selectionSessions.set(tab.id, buildSelectionState(tab.id, tab.url, state));
  void broadcastStateForActiveTab();
}

function handleSelectionSessionClosed(tab) {
  if (!tab?.id) {
    return;
  }

  selectionSessions.set(tab.id, buildSelectionState(tab.id, tab.url, {
    isOpen: false,
    statusMessage: "选区模式已关闭"
  }));
  void broadcastStateForActiveTab();
}

async function handleSelectionCopySuccess(tab) {
  await setSuccessActionState({
    badgeText: "OK",
    badgeColor: "#15803d",
    title: "选区截图已复制到剪贴板"
  });

  if (tab?.id) {
    selectionSessions.set(tab.id, buildSelectionState(tab.id, tab.url, {
      isOpen: false,
      statusMessage: "已复制到剪贴板"
    }));
  }

  await broadcastStateForActiveTab();
}

async function handleSelectionCopyFailure(tab, errorMessage) {
  const message = errorMessage || "选区截图失败。";

  await setActionState({
    badgeText: "",
    badgeColor: "#b91c1c",
    title: `截图失败：${message}`
  });

  if (tab?.id) {
    selectionSessions.set(tab.id, buildSelectionState(tab.id, tab.url, {
      isOpen: true,
      statusMessage: message
    }));
  }

  try {
    await notifyCaptureFailure(message);
  } catch (notificationError) {
    console.error("Failed to show selection failure notification:", notificationError);
  }

  await broadcastStateForActiveTab();
}

async function relaySelectionCommand(tabId, payload) {
  try {
    await chrome.tabs.sendMessage(tabId, payload);
  } catch (error) {
    if (String(error).includes("Receiving end does not exist")) {
      throw new Error("选区模式未启动，请先点击“开始选区”。");
    }

    throw error;
  }
}

async function copyImageToClipboardInTab(tab, imageDataUrl) {
  if (!tab.id) {
    throw new Error("未找到可注入脚本的标签页。");
  }

  if (!isWritablePageUrl(tab.url)) {
    throw new Error("当前页面不支持直接写入剪贴板。请切换到普通网页后重试。");
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: writeImageToClipboard,
    args: [imageDataUrl]
  });

  const [{ result }] = results;
  if (!result?.ok) {
    throw new Error(result?.error || "写入剪贴板失败。");
  }
}

async function handleCaptureVisibleArea(sender, sendResponse) {
  try {
    const tab = sender.tab;
    if (!tab?.windowId) {
      throw new Error("未找到可截图的标签页窗口。");
    }

    const imageDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "png"
    });

    sendResponse({
      ok: true,
      imageDataUrl
    });
  } catch (error) {
    console.error("Failed to capture visible area:", error);
    sendResponse({
      ok: false,
      error: getErrorMessage(error)
    });
  }
}

async function broadcastStateForActiveTab() {
  try {
    const tab = await getCurrentTab();
    const state = tab?.id ? getSelectionStateForTab(tab.id, tab.url) : buildSelectionState(null, "");

    await chrome.runtime.sendMessage({
      type: "selection-state-changed",
      state
    });
  } catch (error) {
    // Side panel may not be open.
  }
}

function getSelectionStateForTab(tabId, url) {
  const existing = selectionSessions.get(tabId);
  return buildSelectionState(tabId, url, existing || {});
}

function buildSelectionState(tabId, url, overrides = {}) {
  return {
    tabId,
    isOpen: false,
    mode: "rect",
    zoomEnabled: false,
    hasSelection: false,
    canCopy: false,
    isBusy: false,
    supported: isInjectablePageUrl(url),
    statusMessage: "",
    ...overrides
  };
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });

  return tab;
}

async function setActionState({ badgeText, badgeColor, title }) {
  clearScheduledBadgeReset();
  await chrome.action.setBadgeText({ text: badgeText });
  await chrome.action.setBadgeBackgroundColor({ color: badgeColor });
  await chrome.action.setTitle({ title });
}

async function setSuccessActionState({ badgeText, badgeColor, title }) {
  clearScheduledBadgeReset();
  await chrome.action.setBadgeText({ text: badgeText });
  await chrome.action.setBadgeBackgroundColor({ color: badgeColor });
  await chrome.action.setTitle({ title });

  clearBadgeTimer = setTimeout(() => {
    clearBadgeTimer = null;
    void chrome.action.setBadgeText({ text: "" });
  }, SUCCESS_BADGE_DURATION_MS);
}

function clearScheduledBadgeReset() {
  if (clearBadgeTimer) {
    clearTimeout(clearBadgeTimer);
    clearBadgeTimer = null;
  }
}

function notifyCaptureFailure(message) {
  return new Promise((resolve, reject) => {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon-128.png",
      title: "截图失败",
      message
    }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve();
    });
  });
}

function removeAllContextMenus() {
  return new Promise((resolve, reject) => {
    chrome.contextMenus.removeAll(() => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve();
    });
  });
}

function createContextMenu(properties) {
  return new Promise((resolve, reject) => {
    chrome.contextMenus.create(properties, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve();
    });
  });
}

function isWritablePageUrl(url) {
  if (!url) {
    return false;
  }

  return url.startsWith("https://") || url.startsWith("http://");
}

function isInjectablePageUrl(url) {
  return isWritablePageUrl(url);
}

function getErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function writeImageToClipboard(imageDataUrl) {
  try {
    if (!window.isSecureContext) {
      throw new Error("当前页面不是安全上下文，无法写入图片到剪贴板。");
    }

    if (!document.hasFocus()) {
      window.focus();
    }

    const response = await fetch(imageDataUrl);
    const blob = await response.blob();
    const mimeType = blob.type || "image/png";

    await navigator.clipboard.write([
      new ClipboardItem({
        [mimeType]: blob
      })
    ]);

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function setSelectionBootstrapData(bootstrapData) {
  const bootstrapKey = "__chromeSnipSelectionBootstrapData";
  const instanceKey = "__chromeSnipSelectionUi";

  window[bootstrapKey] = bootstrapData;

  if (window[instanceKey]?.setBootstrapData) {
    window[instanceKey].setBootstrapData(bootstrapData);
  }
}

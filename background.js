const PAGE_CAPTURE_MENU_ID = "capture-visible-area";
const ACTION_SELECTION_MENU_ID = "launch-selection-mode";
const SUCCESS_BADGE_DURATION_MS = 3000;
const DOUBLE_CLICK_DELAY_MS = 280;

let clearBadgeTimer = null;
let pendingActionClick = null;

chrome.runtime.onInstalled.addListener(() => {
  void setupExtensionUi();
});

chrome.runtime.onStartup.addListener(() => {
  void setupExtensionUi();
});

chrome.action.onClicked.addListener((tab) => {
  handleActionClick(tab);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === PAGE_CAPTURE_MENU_ID) {
    void captureAndCopy(tab);
    return;
  }

  if (info.menuItemId === ACTION_SELECTION_MENU_ID) {
    void launchSelectionMode(tab);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "capture-visible-area") {
    void handleCaptureVisibleArea(sender, sendResponse);
    return true;
  }

  if (message?.type === "copy-image-to-clipboard") {
    void handleCopyImageToClipboard(sender, message, sendResponse);
    return true;
  }

  if (message?.type === "selection-copy-success") {
    void handleSelectionCopySuccess();
    return undefined;
  }

  if (message?.type === "selection-copy-failure") {
    void handleSelectionCopyFailure(message.error);
    return undefined;
  }

  return undefined;
});

async function setupExtensionUi() {
  try {
    await removeAllContextMenus();
    await createContextMenu({
      id: PAGE_CAPTURE_MENU_ID,
      title: "截取当前可视区域并复制到剪贴板",
      contexts: ["page"]
    });
    await createContextMenu({
      id: ACTION_SELECTION_MENU_ID,
      title: "进入选区模式",
      contexts: ["action"]
    });
  } catch (error) {
    console.error("Failed to initialize extension UI:", error);
  }
}

function handleActionClick(tab) {
  if (!tab?.id) {
    void captureAndCopy(tab);
    return;
  }

  const isRepeatedClick = pendingActionClick
    && pendingActionClick.tabId === tab.id
    && pendingActionClick.windowId === tab.windowId;

  if (isRepeatedClick) {
    clearTimeout(pendingActionClick.timerId);
    pendingActionClick = null;
    void launchSelectionMode(tab);
    return;
  }

  if (pendingActionClick) {
    clearTimeout(pendingActionClick.timerId);
    const previousTab = pendingActionClick.tab;
    pendingActionClick = null;
    void captureAndCopy(previousTab);
  }

  const timerId = setTimeout(() => {
    const scheduledTab = pendingActionClick?.tab;
    pendingActionClick = null;
    void captureAndCopy(scheduledTab || tab);
  }, DOUBLE_CLICK_DELAY_MS);

  pendingActionClick = {
    tabId: tab.id,
    windowId: tab.windowId,
    tab,
    timerId
  };
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

async function launchSelectionMode(tab) {
  try {
    const targetTab = tab?.id ? tab : await getCurrentTab();
    if (!targetTab?.id) {
      throw new Error("未找到当前活动标签页。");
    }

    if (!isInjectablePageUrl(targetTab.url)) {
      throw new Error("当前页面不支持选区模式。请切换到普通网页后重试。");
    }

    const previewDataUrl = await chrome.tabs.captureVisibleTab(targetTab.windowId, {
      format: "png"
    });

    await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
      func: setSelectionBootstrapData,
      args: [{ previewDataUrl }]
    });

    await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
      files: ["selection-ui.js"]
    });

    await setActionState({
      badgeText: "",
      badgeColor: "#4b5563",
      title: "选区模式已启动"
    });
  } catch (error) {
    console.error("Failed to launch selection mode:", error);

    await setActionState({
      badgeText: "",
      badgeColor: "#b91c1c",
      title: `选区模式启动失败：${getErrorMessage(error)}`
    });

    try {
      await notifyCaptureFailure(getErrorMessage(error));
    } catch (notificationError) {
      console.error("Failed to show selection launch notification:", notificationError);
    }
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

async function handleCopyImageToClipboard(sender, message, sendResponse) {
  try {
    if (!message?.imageDataUrl) {
      throw new Error("缺少截图数据。");
    }

    if (!sender.tab?.id) {
      throw new Error("未找到可写入剪贴板的标签页。");
    }

    await copyImageToClipboardInTab(sender.tab, message.imageDataUrl);

    sendResponse({ ok: true });
  } catch (error) {
    console.error("Failed to write image to clipboard:", error);
    sendResponse({
      ok: false,
      error: getErrorMessage(error)
    });
  }
}

async function handleSelectionCopySuccess() {
  await setSuccessActionState({
    badgeText: "OK",
    badgeColor: "#15803d",
    title: "选区截图已复制到剪贴板"
  });
}

async function handleSelectionCopyFailure(errorMessage) {
  const message = errorMessage || "选区截图失败。";

  await setActionState({
    badgeText: "",
    badgeColor: "#b91c1c",
    title: `截图失败：${message}`
  });

  try {
    await notifyCaptureFailure(message);
  } catch (notificationError) {
    console.error("Failed to show selection failure notification:", notificationError);
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

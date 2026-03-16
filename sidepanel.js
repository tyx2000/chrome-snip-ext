const state = {
  isOpen: false,
  mode: "rect",
  zoomEnabled: false,
  hasSelection: false,
  canCopy: false,
  isBusy: false,
  supported: true,
  statusMessage: "正在连接当前标签页…"
};

const elements = {
  startButton: document.getElementById("startButton"),
  rectButton: document.getElementById("rectButton"),
  circleButton: document.getElementById("circleButton"),
  zoomButton: document.getElementById("zoomButton"),
  copyButton: document.getElementById("copyButton"),
  cancelButton: document.getElementById("cancelButton"),
  statusText: document.getElementById("statusText")
};

elements.startButton.addEventListener("click", () => {
  void sendCommand({ command: "start-selection" });
});

elements.rectButton.addEventListener("click", () => {
  void sendCommand({ command: "set-mode", mode: "rect" });
});

elements.circleButton.addEventListener("click", () => {
  void sendCommand({ command: "set-mode", mode: "circle" });
});

elements.zoomButton.addEventListener("click", () => {
  void sendCommand({ command: "toggle-zoom" });
});

elements.copyButton.addEventListener("click", () => {
  void sendCommand({ command: "copy-selection" });
});

elements.cancelButton.addEventListener("click", () => {
  void sendCommand({ command: "cancel-selection" });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "selection-state-changed") {
    return undefined;
  }

  applyState(message.state);
  return undefined;
});

void initialize();

async function initialize() {
  const response = await chrome.runtime.sendMessage({
    type: "sidepanel-request-state"
  });

  if (!response?.ok) {
    setStatus(response?.error || "无法获取当前状态。", "error");
    return;
  }

  applyState(response.state);
}

async function sendCommand(payload) {
  setPending(true);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "sidepanel-command",
      ...payload
    });

    if (!response?.ok) {
      throw new Error(response?.error || "命令执行失败。");
    }

    if (response.state) {
      applyState(response.state);
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    setPending(false);
  }
}

function applyState(nextState) {
  Object.assign(state, nextState || {});

  elements.rectButton.classList.toggle("active", state.mode === "rect");
  elements.circleButton.classList.toggle("active", state.mode === "circle");
  elements.zoomButton.classList.toggle("active", Boolean(state.zoomEnabled));

  const selectionReady = Boolean(state.isOpen);
  const supported = state.supported !== false;

  elements.startButton.textContent = selectionReady ? "重新开始选区" : "开始选区";
  elements.startButton.disabled = !supported;

  elements.rectButton.disabled = !selectionReady;
  elements.circleButton.disabled = !selectionReady;
  elements.zoomButton.disabled = !selectionReady;
  elements.copyButton.disabled = !selectionReady || !state.canCopy;
  elements.cancelButton.disabled = !selectionReady;

  if (!supported) {
    setStatus(state.statusMessage || "当前页面不支持选区模式。", "error");
    return;
  }

  if (state.isBusy) {
    setStatus("正在复制到剪贴板…");
    return;
  }

  if (state.statusMessage) {
    if (state.statusMessage.includes("已复制")) {
      setStatus(state.statusMessage, "success");
      return;
    }

    if (state.statusMessage.includes("失败") || state.statusMessage.includes("无法")) {
      setStatus(state.statusMessage, "error");
      return;
    }

    setStatus(state.statusMessage);
    return;
  }

  setStatus(selectionReady ? "拖动网页中的区域开始选择。" : "点击“开始选区”进入当前页面。");
}

function setPending(isPending) {
  if (isPending) {
    elements.startButton.disabled = true;
    elements.rectButton.disabled = true;
    elements.circleButton.disabled = true;
    elements.zoomButton.disabled = true;
    elements.copyButton.disabled = true;
    elements.cancelButton.disabled = true;
  } else {
    applyState(state);
  }
}

function setStatus(message, tone = "info") {
  elements.statusText.textContent = message;
  elements.statusText.className = `status-text ${tone === "info" ? "" : tone}`.trim();
}

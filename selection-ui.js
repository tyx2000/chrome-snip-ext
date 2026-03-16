(function bootstrapSelectionUi() {
  const GLOBAL_KEY = "__chromeSnipSelectionUi";
  const BOOTSTRAP_KEY = "__chromeSnipSelectionBootstrapData";
  const BORDER_WIDTH = 2;

  if (window[GLOBAL_KEY]?.open) {
    if (window[GLOBAL_KEY]?.setBootstrapData) {
      window[GLOBAL_KEY].setBootstrapData(readBootstrapData());
    }
    window[GLOBAL_KEY].open();
    return;
  }

  class ChromeSnipSelectionUi {
    constructor() {
      this.mode = "rect";
      this.zoomEnabled = false;
      this.isOpen = false;
      this.isBusy = false;
      this.isDragging = false;
      this.pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      this.selection = null;
      this.bootstrapData = readBootstrapData();
      this.previewDataUrl = this.bootstrapData?.previewDataUrl || null;
      this.previewPromise = null;

      this.buildUi();
      this.attachListeners();
      this.attachRuntimeListener();
    }

    open() {
      if (!this.host.isConnected) {
        document.documentElement.appendChild(this.host);
      }

      this.isOpen = true;
      this.isBusy = false;
      this.isDragging = false;
      this.selection = null;
      this.mode = "rect";
      this.zoomEnabled = false;
      this.bootstrapData = readBootstrapData();
      this.previewDataUrl = this.bootstrapData?.previewDataUrl || null;
      this.previewPromise = null;
      this.root.hidden = false;
      this.root.style.visibility = "visible";
      this.updateVeilViewport();
      this.updateSelection();
      this.updateLens();
      this.notifyState();
    }

    close({ notify = true } = {}) {
      if (!this.isOpen) {
        return;
      }

      this.isOpen = false;
      this.isBusy = false;
      this.isDragging = false;
      this.selection = null;
      this.previewPromise = null;
      this.previewDataUrl = this.bootstrapData?.previewDataUrl || null;
      this.root.hidden = true;
      this.root.style.visibility = "visible";
      this.lens.hidden = true;
      this.updateVeilCutout();

      if (notify) {
        this.notifySessionClosed();
      }
    }

    setBootstrapData(bootstrapData) {
      this.bootstrapData = bootstrapData || null;
      this.previewDataUrl = this.bootstrapData?.previewDataUrl || null;
      this.previewPromise = null;
      this.updateLens();
    }

    buildUi() {
      this.host = document.createElement("div");
      this.host.id = "chrome-snip-selection-host";

      const shadowRoot = this.host.attachShadow({ mode: "open" });
      shadowRoot.innerHTML = `
        <style>
          :host {
            all: initial;
          }

          .root {
            position: fixed;
            inset: 0;
            z-index: 2147483647;
            cursor: crosshair;
          }

          .veil {
            position: absolute;
            inset: 0;
            pointer-events: none;
          }

          .veil-svg {
            width: 100%;
            height: 100%;
            display: block;
          }

          .veil-fill {
            fill: rgba(2, 6, 23, 0.24);
          }

          .selection-stroke {
            fill: none;
            stroke: #ef4444;
            stroke-width: 2;
            vector-effect: non-scaling-stroke;
            filter: drop-shadow(0 0 0.75px rgba(127, 29, 29, 0.66));
          }

          .lens {
            position: fixed;
            width: 168px;
            height: 168px;
            border-radius: 50%;
            border: 3px solid rgba(125, 211, 252, 0.96);
            box-shadow: 0 22px 40px rgba(2, 6, 23, 0.34);
            overflow: hidden;
            pointer-events: none;
            background-color: #0f172a;
            background-repeat: no-repeat;
          }

          .lens::after {
            content: "";
            position: absolute;
            inset: 0;
            pointer-events: none;
            background:
              linear-gradient(to right, transparent calc(50% - 0.5px), rgba(239, 68, 68, 0.9) calc(50% - 0.5px), rgba(239, 68, 68, 0.9) calc(50% + 0.5px), transparent calc(50% + 0.5px)),
              linear-gradient(to bottom, transparent calc(50% - 0.5px), rgba(239, 68, 68, 0.9) calc(50% - 0.5px), rgba(239, 68, 68, 0.9) calc(50% + 0.5px), transparent calc(50% + 0.5px));
          }

          .hidden {
            display: none;
          }
        </style>
        <div class="root" hidden>
          <div class="veil">
            <svg class="veil-svg" aria-hidden="true">
              <defs>
                <mask id="chrome-snip-selection-mask">
                  <rect x="0" y="0" width="100%" height="100%" fill="white"></rect>
                  <rect class="veil-hole-rect" x="0" y="0" width="0" height="0" fill="black"></rect>
                  <ellipse class="veil-hole-circle" cx="0" cy="0" rx="0" ry="0" fill="black"></ellipse>
                </mask>
              </defs>
              <rect class="veil-fill" x="0" y="0" width="100%" height="100%" mask="url(#chrome-snip-selection-mask)"></rect>
              <rect class="selection-stroke selection-stroke-rect" x="0" y="0" width="0" height="0"></rect>
              <ellipse class="selection-stroke selection-stroke-circle" cx="0" cy="0" rx="0" ry="0"></ellipse>
            </svg>
          </div>
          <div class="lens hidden"></div>
        </div>
      `;

      this.root = shadowRoot.querySelector(".root");
      this.veilSvg = shadowRoot.querySelector(".veil-svg");
      this.veilHoleRect = shadowRoot.querySelector(".veil-hole-rect");
      this.veilHoleCircle = shadowRoot.querySelector(".veil-hole-circle");
      this.selectionStrokeRect = shadowRoot.querySelector(".selection-stroke-rect");
      this.selectionStrokeCircle = shadowRoot.querySelector(".selection-stroke-circle");
      this.lens = shadowRoot.querySelector(".lens");
    }

    attachListeners() {
      this.root.addEventListener("pointerdown", (event) => this.handlePointerDown(event));
      window.addEventListener("pointermove", (event) => this.handlePointerMove(event), true);
      window.addEventListener("pointerup", (event) => this.handlePointerUp(event), true);
      window.addEventListener("keydown", (event) => this.handleKeyDown(event), true);
      window.addEventListener("wheel", (event) => this.handleWheel(event), {
        capture: true,
        passive: false
      });
      window.addEventListener("resize", () => this.handleResize(), true);
    }

    attachRuntimeListener() {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.type !== "selection-ui-command") {
          return undefined;
        }

        void this.handleRuntimeCommand(message, sendResponse);
        return true;
      });
    }

    async handleRuntimeCommand(message, sendResponse) {
      try {
        if (message.command === "start-selection") {
          this.open();
          sendResponse({ ok: true, state: this.getStateSnapshot() });
          return;
        }

        if (message.command === "set-mode") {
          this.mode = message.mode === "circle" ? "circle" : "rect";
          this.updateSelection();
          this.notifyState();
          sendResponse({ ok: true, state: this.getStateSnapshot() });
          return;
        }

        if (message.command === "toggle-zoom") {
          const nextEnabled = typeof message.enabled === "boolean" ? message.enabled : !this.zoomEnabled;
          this.zoomEnabled = nextEnabled;

          if (this.zoomEnabled) {
            await this.ensurePreviewData();
          }

          this.updateLens();
          this.notifyState();
          sendResponse({ ok: true, state: this.getStateSnapshot() });
          return;
        }

        if (message.command === "copy-selection") {
          await this.copySelection();
          sendResponse({ ok: true });
          return;
        }

        if (message.command === "cancel-selection") {
          this.close();
          sendResponse({ ok: true, state: this.getStateSnapshot() });
          return;
        }

        if (message.command === "get-state") {
          sendResponse({ ok: true, state: this.getStateSnapshot() });
          return;
        }

        sendResponse({ ok: false, error: "未知命令。" });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    handlePointerDown(event) {
      if (!this.isOpen || this.isBusy || event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      this.isDragging = true;
      this.pointer = { x: event.clientX, y: event.clientY };
      this.dragStart = { x: event.clientX, y: event.clientY };
      this.selection = {
        x: event.clientX,
        y: event.clientY,
        width: 0,
        height: 0
      };

      this.updateSelection();
      this.updateLens();
      this.notifyState();
    }

    handlePointerMove(event) {
      if (!this.isOpen) {
        return;
      }

      this.pointer = { x: event.clientX, y: event.clientY };

      if (this.isDragging) {
        event.preventDefault();
        event.stopPropagation();
        this.selection = normalizeRect(this.dragStart.x, this.dragStart.y, event.clientX, event.clientY);
        this.updateSelection();
      }

      this.updateLens();
    }

    handlePointerUp(event) {
      if (!this.isOpen || !this.isDragging) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      this.isDragging = false;

      if (!this.selection || this.selection.width < 4 || this.selection.height < 4) {
        this.selection = null;
      }

      this.updateSelection();
      this.notifyState();
    }

    handleKeyDown(event) {
      if (!this.isOpen) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.close();
        return;
      }

      if (event.key === "Enter" && this.selection && !this.isBusy) {
        event.preventDefault();
        event.stopPropagation();
        void this.copySelection();
      }
    }

    handleWheel(event) {
      if (!this.isOpen) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    }

    handleResize() {
      if (!this.isOpen) {
        return;
      }

      this.previewDataUrl = null;
      this.previewPromise = null;
      this.updateVeilViewport();
      this.updateSelection();
      this.updateLens();
    }

    updateSelection() {
      this.updateVeilViewport();
      this.updateVeilCutout();
    }

    updateLens() {
      if (!this.isOpen || !this.zoomEnabled || !this.previewDataUrl) {
        this.lens.hidden = true;
        return;
      }

      const lensSize = 168;
      const zoom = 2.4;
      const x = clamp(this.pointer.x, 0, window.innerWidth);
      const y = clamp(this.pointer.y, 0, window.innerHeight);

      this.lens.hidden = false;
      this.lens.style.left = `${clamp(x + 22, 16, window.innerWidth - lensSize - 16)}px`;
      this.lens.style.top = `${clamp(y + 22, 16, window.innerHeight - lensSize - 16)}px`;
      this.lens.style.backgroundImage = `url("${this.previewDataUrl}")`;
      this.lens.style.backgroundSize = `${window.innerWidth * zoom}px ${window.innerHeight * zoom}px`;
      this.lens.style.backgroundPosition = `${-(x * zoom - lensSize / 2)}px ${-(y * zoom - lensSize / 2)}px`;
    }

    async ensurePreviewData() {
      if (this.previewDataUrl) {
        return this.previewDataUrl;
      }

      if (this.previewPromise) {
        return this.previewPromise;
      }

      this.previewPromise = this.captureVisibleArea().then((imageDataUrl) => {
        this.previewDataUrl = imageDataUrl;
        this.updateLens();
        return imageDataUrl;
      }).finally(() => {
        this.previewPromise = null;
      });

      return this.previewPromise;
    }

    hideOverlayForCapture() {
      this.root.style.visibility = "hidden";
      this.lens.hidden = true;
    }

    restoreOverlayAfterCapture() {
      this.root.style.visibility = "visible";
      this.updateSelection();
      this.updateLens();
    }

    async captureVisibleArea({ restoreOverlay = true } = {}) {
      this.hideOverlayForCapture();
      await nextFrame();
      await nextFrame();

      try {
        const response = await chrome.runtime.sendMessage({
          type: "capture-visible-area"
        });

        if (!response?.ok) {
          throw new Error(response?.error || "截图失败。");
        }

        return response.imageDataUrl;
      } finally {
        if (restoreOverlay) {
          this.restoreOverlayAfterCapture();
        }
      }
    }

    async copySelection() {
      if (!this.selection) {
        throw new Error("请先拖动选择截图区域。");
      }

      this.isBusy = true;
      this.notifyState();

      try {
        const imageDataUrl = await this.captureVisibleArea({ restoreOverlay: false });
        const blob = await cropSelectionToBlob(imageDataUrl, this.selection, this.mode);
        await writeBlobToClipboard(blob);
        chrome.runtime.sendMessage({ type: "selection-copy-success" });
        this.close({ notify: false });
      } catch (error) {
        this.restoreOverlayAfterCapture();
        const message = error instanceof Error ? error.message : String(error);
        chrome.runtime.sendMessage({
          type: "selection-copy-failure",
          error: message
        });
        this.isBusy = false;
        this.notifyState();
        throw error;
      }
    }

    updateVeilViewport() {
      const width = window.innerWidth;
      const height = window.innerHeight;
      this.veilSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    }

    updateVeilCutout() {
      const strokeCenterOffset = BORDER_WIDTH / 2;
      const innerInset = BORDER_WIDTH;

      if (!this.selection) {
        this.veilHoleRect.setAttribute("width", 0);
        this.veilHoleRect.setAttribute("height", 0);
        this.veilHoleCircle.setAttribute("rx", 0);
        this.veilHoleCircle.setAttribute("ry", 0);
        this.selectionStrokeRect.setAttribute("width", 0);
        this.selectionStrokeRect.setAttribute("height", 0);
        this.selectionStrokeCircle.setAttribute("rx", 0);
        this.selectionStrokeCircle.setAttribute("ry", 0);
        return;
      }

      if (this.mode === "circle") {
        const centerX = this.selection.x + this.selection.width / 2;
        const centerY = this.selection.y + this.selection.height / 2;
        const strokeRx = Math.max(0, this.selection.width / 2 - strokeCenterOffset);
        const strokeRy = Math.max(0, this.selection.height / 2 - strokeCenterOffset);

        this.veilHoleRect.setAttribute("width", 0);
        this.veilHoleRect.setAttribute("height", 0);
        this.veilHoleCircle.setAttribute("cx", centerX);
        this.veilHoleCircle.setAttribute("cy", centerY);
        this.veilHoleCircle.setAttribute("rx", Math.max(0, strokeRx - strokeCenterOffset));
        this.veilHoleCircle.setAttribute("ry", Math.max(0, strokeRy - strokeCenterOffset));

        this.selectionStrokeRect.setAttribute("width", 0);
        this.selectionStrokeRect.setAttribute("height", 0);
        this.selectionStrokeCircle.setAttribute("cx", centerX);
        this.selectionStrokeCircle.setAttribute("cy", centerY);
        this.selectionStrokeCircle.setAttribute("rx", strokeRx);
        this.selectionStrokeCircle.setAttribute("ry", strokeRy);
        return;
      }

      this.veilHoleCircle.setAttribute("rx", 0);
      this.veilHoleCircle.setAttribute("ry", 0);
      this.selectionStrokeCircle.setAttribute("rx", 0);
      this.selectionStrokeCircle.setAttribute("ry", 0);

      this.veilHoleRect.setAttribute("x", this.selection.x + innerInset);
      this.veilHoleRect.setAttribute("y", this.selection.y + innerInset);
      this.veilHoleRect.setAttribute("width", Math.max(0, this.selection.width - innerInset * 2));
      this.veilHoleRect.setAttribute("height", Math.max(0, this.selection.height - innerInset * 2));

      this.selectionStrokeRect.setAttribute("x", this.selection.x + strokeCenterOffset);
      this.selectionStrokeRect.setAttribute("y", this.selection.y + strokeCenterOffset);
      this.selectionStrokeRect.setAttribute("width", Math.max(0, this.selection.width - strokeCenterOffset * 2));
      this.selectionStrokeRect.setAttribute("height", Math.max(0, this.selection.height - strokeCenterOffset * 2));
    }

    getStateSnapshot() {
      return {
        isOpen: this.isOpen,
        mode: this.mode,
        zoomEnabled: this.zoomEnabled,
        hasSelection: Boolean(this.selection),
        canCopy: Boolean(this.selection) && !this.isBusy,
        isBusy: this.isBusy,
        statusMessage: this.describeSelection()
      };
    }

    describeSelection() {
      if (!this.selection) {
        return this.isOpen ? "拖动鼠标开始选择区域" : "选区模式未启动";
      }

      return `${this.mode === "circle" ? "圈选" : "框选"} ${Math.round(this.selection.width)} × ${Math.round(this.selection.height)}`;
    }

    notifyState() {
      try {
        chrome.runtime.sendMessage({
          type: "selection-state-changed",
          state: this.getStateSnapshot()
        });
      } catch (error) {
        // Ignore when the background is restarting.
      }
    }

    notifySessionClosed() {
      try {
        chrome.runtime.sendMessage({
          type: "selection-session-closed"
        });
      } catch (error) {
        // Ignore when the background is restarting.
      }
    }
  }

  function normalizeRect(startX, startY, endX, endY) {
    const x = Math.min(startX, endX);
    const y = Math.min(startY, endY);
    const width = Math.abs(endX - startX);
    const height = Math.abs(endY - startY);

    return { x, y, width, height };
  }

  async function cropSelectionToBlob(imageDataUrl, selection, mode) {
    const image = await loadImage(imageDataUrl);
    const scaleX = image.naturalWidth / window.innerWidth;
    const scaleY = image.naturalHeight / window.innerHeight;
    const sourceX = Math.max(0, Math.round(selection.x * scaleX));
    const sourceY = Math.max(0, Math.round(selection.y * scaleY));
    const sourceWidth = Math.max(1, Math.round(selection.width * scaleX));
    const sourceHeight = Math.max(1, Math.round(selection.height * scaleY));
    const canvas = document.createElement("canvas");

    canvas.width = sourceWidth;
    canvas.height = sourceHeight;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("无法创建截图画布。");
    }

    if (mode === "circle") {
      context.beginPath();
      context.ellipse(
        sourceWidth / 2,
        sourceHeight / 2,
        sourceWidth / 2,
        sourceHeight / 2,
        0,
        0,
        Math.PI * 2
      );
      context.clip();
    }

    context.drawImage(
      image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      sourceWidth,
      sourceHeight
    );

    return canvasToBlob(canvas);
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("无法生成截图数据。"));
          return;
        }

        resolve(blob);
      }, "image/png");
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("无法加载截图数据。"));
      image.src = src;
    });
  }

  async function writeBlobToClipboard(blob) {
    if (!window.isSecureContext) {
      throw new Error("当前页面不是安全上下文，无法写入图片到剪贴板。");
    }

    if (!document.hasFocus()) {
      window.focus();
    }

    await navigator.clipboard.write([
      new ClipboardItem({
        [blob.type || "image/png"]: blob
      })
    ]);
  }

  function nextFrame() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function readBootstrapData() {
    return window[BOOTSTRAP_KEY] || null;
  }

  const instance = new ChromeSnipSelectionUi();
  window[GLOBAL_KEY] = instance;
  instance.open();
})();

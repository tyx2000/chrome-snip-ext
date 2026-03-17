(function bootstrapSelectionUi() {
  const GLOBAL_KEY = "__chromeSnipSelectionUi";
  const BOOTSTRAP_KEY = "__chromeSnipSelectionBootstrapData";

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
      this.dragMode = null;
      this.pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      this.dragStart = null;
      this.dragOffset = null;
      this.dragSelectionOrigin = null;
      this.selection = null;
      this.bootstrapData = readBootstrapData();
      this.previewDataUrl = this.bootstrapData?.previewDataUrl || null;
      this.previewPromise = null;

      this.buildUi();
      this.attachListeners();
    }

    open() {
      if (!this.host.isConnected) {
        document.documentElement.appendChild(this.host);
      }

      this.isOpen = true;
      this.isBusy = false;
      this.isDragging = false;
      this.dragMode = null;
      this.dragStart = null;
      this.dragOffset = null;
      this.dragSelectionOrigin = null;
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
      this.updateToolbar();
    }

    close() {
      if (!this.isOpen) {
        return;
      }

      this.isOpen = false;
      this.isBusy = false;
      this.isDragging = false;
      this.dragMode = null;
      this.dragStart = null;
      this.dragOffset = null;
      this.dragSelectionOrigin = null;
      this.selection = null;
      this.previewPromise = null;
      this.previewDataUrl = this.bootstrapData?.previewDataUrl || null;
      this.root.hidden = true;
      this.root.style.visibility = "visible";
      this.lens.hidden = true;
      this.updateVeilCutout();
      this.updateToolbar();
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
            user-select: none;
          }

          .veil {
            position: absolute;
            inset: 0;
            pointer-events: none;
            z-index: 1;
          }

          .veil-svg {
            width: 100%;
            height: 100%;
            display: block;
          }

          .veil-fill {
            fill: rgba(2, 6, 23, 0.26);
          }

          .selection-stroke {
            fill: none;
            stroke: #ef4444;
            stroke-width: 2;
            vector-effect: non-scaling-stroke;
            filter: drop-shadow(0 0 0.75px rgba(127, 29, 29, 0.66));
          }

          .toolbar {
            position: fixed;
            top: 16px;
            right: 16px;
            z-index: 3;
            display: flex;
            align-items: center;
            gap: 4px;
            height: 36px;
            padding: 4px 6px;
            border-radius: 999px;
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.99), rgba(248, 250, 252, 0.98));
            border: 1px solid rgba(148, 163, 184, 0.72);
            box-shadow:
              0 18px 40px rgba(15, 23, 42, 0.34),
              0 6px 16px rgba(15, 23, 42, 0.18),
              0 0 0 1px rgba(255, 255, 255, 0.72) inset;
            backdrop-filter: blur(14px) saturate(1.12);
            cursor: default;
          }

          .divider {
            width: 1px;
            align-self: stretch;
            margin: 2px 1px;
            background: rgba(100, 116, 139, 0.28);
          }

          .tool-button {
            width: 28px;
            height: 28px;
            padding: 0;
            border: none;
            border-radius: 999px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            background: transparent;
            color: #0f172a;
            cursor: pointer;
            transition: background-color 120ms ease, color 120ms ease, transform 120ms ease, box-shadow 120ms ease;
          }

          .tool-button:hover:not(:disabled) {
            background: rgba(226, 232, 240, 0.9);
            box-shadow: 0 1px 0 rgba(255, 255, 255, 0.7) inset;
          }

          .tool-button:active:not(:disabled) {
            transform: scale(0.96);
          }

          .tool-button:disabled {
            opacity: 0.4;
            cursor: default;
          }

          .tool-button svg {
            width: 18px;
            height: 18px;
            stroke: currentColor;
            fill: none;
            stroke-width: 2;
            stroke-linecap: round;
            stroke-linejoin: round;
          }

          .tool-button[data-tool="rect"],
          .tool-button[data-tool="circle"] {
            color: #dc2626;
          }

          .tool-button[data-tool="zoom"] {
            color: #0f172a;
          }

          .tool-button[data-tool="copy"] {
            color: #15803d;
          }

          .tool-button[data-tool="cancel"] {
            color: #b91c1c;
          }

          .tool-button.active[data-tool="rect"],
          .tool-button.active[data-tool="circle"] {
            background: rgba(254, 226, 226, 0.98);
            box-shadow: 0 0 0 1px rgba(220, 38, 38, 0.12) inset;
          }

          .tool-button.active[data-tool="zoom"] {
            background: rgba(219, 234, 254, 0.98);
            color: #2563eb;
            box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.12) inset;
          }

          .lens {
            position: fixed;
            z-index: 2;
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
          <div class="toolbar" role="toolbar" aria-label="选区工具">
            <button class="tool-button" type="button" data-tool="rect" title="框选 (R)" aria-label="框选">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="5" y="5" width="14" height="14" rx="1.5"></rect>
              </svg>
            </button>
            <button class="tool-button" type="button" data-tool="circle" title="圈选 (C)" aria-label="圈选">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <ellipse cx="12" cy="12" rx="7" ry="6"></ellipse>
              </svg>
            </button>
            <button class="tool-button" type="button" data-tool="zoom" title="区域放大 (Z)" aria-label="区域放大">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="10.5" cy="10.5" r="5.5"></circle>
                <path d="M10.5 8v5"></path>
                <path d="M8 10.5h5"></path>
                <path d="M15 15l4 4"></path>
              </svg>
            </button>
            <div class="divider" aria-hidden="true"></div>
            <button class="tool-button" type="button" data-tool="copy" title="复制选区 (Enter)" aria-label="复制选区">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12.5l4.2 4.2L19 7.5"></path>
              </svg>
            </button>
            <button class="tool-button" type="button" data-tool="cancel" title="取消 (Esc)" aria-label="取消">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12"></path>
                <path d="M18 6L6 18"></path>
              </svg>
            </button>
          </div>
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
      this.toolbar = shadowRoot.querySelector(".toolbar");
      this.rectButton = shadowRoot.querySelector('[data-tool="rect"]');
      this.circleButton = shadowRoot.querySelector('[data-tool="circle"]');
      this.zoomButton = shadowRoot.querySelector('[data-tool="zoom"]');
      this.copyButton = shadowRoot.querySelector('[data-tool="copy"]');
      this.cancelButton = shadowRoot.querySelector('[data-tool="cancel"]');
      this.veilSvg = shadowRoot.querySelector(".veil-svg");
      this.veilHoleRect = shadowRoot.querySelector(".veil-hole-rect");
      this.veilHoleCircle = shadowRoot.querySelector(".veil-hole-circle");
      this.selectionStrokeRect = shadowRoot.querySelector(".selection-stroke-rect");
      this.selectionStrokeCircle = shadowRoot.querySelector(".selection-stroke-circle");
      this.lens = shadowRoot.querySelector(".lens");
    }

    attachListeners() {
      this.root.addEventListener("pointerdown", (event) => this.handlePointerDown(event));
      this.toolbar.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      this.toolbar.addEventListener("click", (event) => this.handleToolbarClick(event));
      window.addEventListener("pointermove", (event) => this.handlePointerMove(event), true);
      window.addEventListener("pointerup", (event) => this.handlePointerUp(event), true);
      window.addEventListener("keydown", (event) => this.handleKeyDown(event), true);
      window.addEventListener("wheel", (event) => this.handleWheel(event), {
        capture: true,
        passive: false
      });
      window.addEventListener("resize", () => this.handleResize(), true);
    }

    handleToolbarClick(event) {
      const button = event.target.closest("[data-tool]");
      if (!button || this.isBusy) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const tool = button.dataset.tool;
      if (tool === "rect" || tool === "circle") {
        this.mode = tool;
        this.updateSelection();
        this.updateToolbar();
        return;
      }

      if (tool === "zoom") {
        void this.toggleZoom();
        return;
      }

      if (tool === "copy") {
        if (this.selection) {
          void this.copySelection();
        }
        return;
      }

      if (tool === "cancel") {
        this.close();
      }
    }

    handlePointerDown(event) {
      if (!this.isOpen || this.isBusy || event.button !== 0) {
        return;
      }

      if (event.composedPath().includes(this.toolbar)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      this.isDragging = true;
      this.pointer = { x: event.clientX, y: event.clientY };
      const hitExistingSelection = this.selection && this.isPointInsideSelection(event.clientX, event.clientY);

      if (hitExistingSelection) {
        this.dragMode = "move";
        this.dragOffset = {
          x: event.clientX - this.selection.x,
          y: event.clientY - this.selection.y
        };
        this.dragSelectionOrigin = { ...this.selection };
      } else {
        this.dragMode = "create";
        this.dragStart = { x: event.clientX, y: event.clientY };
        this.selection = {
          x: event.clientX,
          y: event.clientY,
          width: 0,
          height: 0
        };
      }

      this.updateSelection();
      this.updateLens();
      this.updateToolbar();
    }

    handlePointerMove(event) {
      if (!this.isOpen) {
        return;
      }

      this.pointer = { x: event.clientX, y: event.clientY };

      if (this.isDragging) {
        event.preventDefault();
        event.stopPropagation();
        if (this.dragMode === "move" && this.selection) {
          this.selection = moveRect(
            this.dragSelectionOrigin || this.selection,
            event.clientX - (this.dragOffset?.x || 0),
            event.clientY - (this.dragOffset?.y || 0)
          );
        } else if (this.dragStart) {
          this.selection = normalizeRect(this.dragStart.x, this.dragStart.y, event.clientX, event.clientY);
        }
        this.updateSelection();
      } else {
        this.root.style.cursor = this.selection && this.isPointInsideSelection(event.clientX, event.clientY)
          ? "move"
          : "crosshair";
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
      this.dragMode = null;
      this.dragOffset = null;
      this.dragSelectionOrigin = null;

      if (!this.selection || this.selection.width < 4 || this.selection.height < 4) {
        this.selection = null;
      }

      this.updateSelection();
      this.updateToolbar();
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

      if ((event.key === "r" || event.key === "R") && !this.isBusy) {
        event.preventDefault();
        event.stopPropagation();
        this.mode = "rect";
        this.updateSelection();
        this.updateToolbar();
        return;
      }

      if ((event.key === "c" || event.key === "C") && !this.isBusy) {
        event.preventDefault();
        event.stopPropagation();
        this.mode = "circle";
        this.updateSelection();
        this.updateToolbar();
        return;
      }

      if ((event.key === "z" || event.key === "Z") && !this.isBusy) {
        event.preventDefault();
        event.stopPropagation();
        void this.toggleZoom();
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

      this.updateVeilViewport();
      this.updateSelection();
      this.updateLens();
    }

    updateToolbar() {
      this.rectButton.classList.toggle("active", this.mode === "rect");
      this.circleButton.classList.toggle("active", this.mode === "circle");
      this.zoomButton.classList.toggle("active", this.zoomEnabled);
      this.copyButton.disabled = !this.selection || this.isBusy;
      this.rectButton.disabled = this.isBusy;
      this.circleButton.disabled = this.isBusy;
      this.zoomButton.disabled = this.isBusy;
      this.cancelButton.disabled = this.isBusy;
    }

    updateSelection() {
      this.updateVeilViewport();
      this.updateVeilCutout();
      this.updateToolbar();
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
      this.lens.style.top = `${clamp(y + 22, 60, window.innerHeight - lensSize - 16)}px`;
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

    async toggleZoom() {
      this.zoomEnabled = !this.zoomEnabled;

      if (this.zoomEnabled) {
        await this.ensurePreviewData();
      }

      this.updateLens();
      this.updateToolbar();
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

    async prepareCopySelection() {
      if (!this.selection) {
        throw new Error("请先拖动选择截图区域。");
      }

      this.isBusy = true;
      this.updateToolbar();

      try {
        const imageDataUrl = await this.captureVisibleArea({ restoreOverlay: false });
        const blob = await cropSelectionToBlob(imageDataUrl, this.selection, this.mode);
        return await blobToDataUrl(blob);
      } catch (error) {
        this.restoreOverlayAfterCapture();
        this.isBusy = false;
        this.updateToolbar();
        throw error;
      }
    }

    async copySelection() {
      try {
        const imageDataUrl = await this.prepareCopySelection();
        const response = await chrome.runtime.sendMessage({
          type: "copy-image-to-clipboard",
          imageDataUrl
        });

        if (!response?.ok) {
          throw new Error(response?.error || "写入剪贴板失败。");
        }

        this.finishCopySelection();
      } catch (error) {
        this.abortCopySelection();
        const message = error instanceof Error ? error.message : String(error);
        chrome.runtime.sendMessage({
          type: "selection-copy-failure",
          error: message
        });
      }
    }

    finishCopySelection() {
      chrome.runtime.sendMessage({ type: "selection-copy-success" });
      this.close();
    }

    abortCopySelection() {
      this.restoreOverlayAfterCapture();
      this.isBusy = false;
      this.updateToolbar();
    }

    isPointInsideSelection(pointX, pointY) {
      if (!this.selection) {
        return false;
      }

      if (this.mode === "circle") {
        const radiusX = this.selection.width / 2;
        const radiusY = this.selection.height / 2;
        if (radiusX <= 0 || radiusY <= 0) {
          return false;
        }

        const centerX = this.selection.x + radiusX;
        const centerY = this.selection.y + radiusY;
        const normalizedX = (pointX - centerX) / radiusX;
        const normalizedY = (pointY - centerY) / radiusY;
        return normalizedX * normalizedX + normalizedY * normalizedY <= 1;
      }

      return pointX >= this.selection.x
        && pointX <= this.selection.x + this.selection.width
        && pointY >= this.selection.y
        && pointY <= this.selection.y + this.selection.height;
    }

    updateVeilViewport() {
      const width = window.innerWidth;
      const height = window.innerHeight;
      this.veilSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    }

    updateVeilCutout() {
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
        const radiusX = Math.max(0, this.selection.width / 2 - 1);
        const radiusY = Math.max(0, this.selection.height / 2 - 1);

        this.veilHoleRect.setAttribute("width", 0);
        this.veilHoleRect.setAttribute("height", 0);
        this.veilHoleCircle.setAttribute("cx", centerX);
        this.veilHoleCircle.setAttribute("cy", centerY);
        this.veilHoleCircle.setAttribute("rx", radiusX);
        this.veilHoleCircle.setAttribute("ry", radiusY);

        this.selectionStrokeRect.setAttribute("width", 0);
        this.selectionStrokeRect.setAttribute("height", 0);
        this.selectionStrokeCircle.setAttribute("cx", centerX);
        this.selectionStrokeCircle.setAttribute("cy", centerY);
        this.selectionStrokeCircle.setAttribute("rx", radiusX);
        this.selectionStrokeCircle.setAttribute("ry", radiusY);
        return;
      }

      const x = this.selection.x + 1;
      const y = this.selection.y + 1;
      const width = Math.max(0, this.selection.width - 2);
      const height = Math.max(0, this.selection.height - 2);

      this.veilHoleCircle.setAttribute("rx", 0);
      this.veilHoleCircle.setAttribute("ry", 0);
      this.selectionStrokeCircle.setAttribute("rx", 0);
      this.selectionStrokeCircle.setAttribute("ry", 0);

      this.veilHoleRect.setAttribute("x", x);
      this.veilHoleRect.setAttribute("y", y);
      this.veilHoleRect.setAttribute("width", width);
      this.veilHoleRect.setAttribute("height", height);

      this.selectionStrokeRect.setAttribute("x", x);
      this.selectionStrokeRect.setAttribute("y", y);
      this.selectionStrokeRect.setAttribute("width", width);
      this.selectionStrokeRect.setAttribute("height", height);
    }
  }

  function normalizeRect(startX, startY, endX, endY) {
    const x = Math.min(startX, endX);
    const y = Math.min(startY, endY);
    const width = Math.abs(endX - startX);
    const height = Math.abs(endY - startY);

    return { x, y, width, height };
  }

  function moveRect(rect, nextX, nextY) {
    return {
      x: clamp(nextX, 0, Math.max(0, window.innerWidth - rect.width)),
      y: clamp(nextY, 0, Math.max(0, window.innerHeight - rect.height)),
      width: rect.width,
      height: rect.height
    };
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

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("无法读取截图数据。"));
      reader.readAsDataURL(blob);
    });
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

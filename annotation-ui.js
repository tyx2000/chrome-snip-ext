(function bootstrapAnnotationUi() {
  const GLOBAL_KEY = "__chromeSnipAnnotationUi";
  const BOOTSTRAP_KEY = "__chromeSnipAnnotationBootstrapData";
  const STROKE_COLOR = "#dc2626";
  const STROKE_WIDTH = 4;
  const FONT_SIZE = 22;
  const PROMPT_IDLE_MS = 3000;
  const PROMPT_TRANSITION_MS = 180;
  const EDITOR_TRANSITION_MS = 220;
  const DRAG_THRESHOLD = 2;
  const MAX_HISTORY_ENTRIES = 50;

  if (window[GLOBAL_KEY]?.openPrompt) {
    if (window[GLOBAL_KEY]?.setBootstrapData) {
      window[GLOBAL_KEY].setBootstrapData(readBootstrapData());
    }
    window[GLOBAL_KEY].openPrompt();
    return;
  }

  class ChromeSnipAnnotationUi {
    constructor() {
      this.bootstrapData = readBootstrapData();
      this.imageDataUrl = this.bootstrapData?.imageDataUrl || null;
      this.image = null;
      this.tool = "rect";
      this.isPromptOpen = false;
      this.isEditorOpen = false;
      this.isDrawing = false;
      this.draft = null;
      this.dragState = null;
      this.compositionInput = null;
      this.annotations = [];
      this.history = [[]];
      this.nextAnnotationId = 1;
      this.promptIdleTimer = null;
      this.promptVisibilityTimer = null;
      this.editorVisibilityTimer = null;

      this.buildUi();
      this.attachListeners();
    }

    setBootstrapData(bootstrapData) {
      this.bootstrapData = bootstrapData || null;
      this.imageDataUrl = this.bootstrapData?.imageDataUrl || null;
      this.image = null;
    }

    openPrompt() {
      if (!this.imageDataUrl) {
        return;
      }

      this.ensureHost();
      this.closeEditor({ keepPrompt: false });
      this.isPromptOpen = true;
      this.showPrompt();
      this.schedulePromptAutoHide();
    }

    ensureHost() {
      if (!this.host.isConnected) {
        document.documentElement.appendChild(this.host);
      }
    }

    buildUi() {
      this.host = document.createElement("div");
      this.host.id = "chrome-snip-annotation-host";

      const shadowRoot = this.host.attachShadow({ mode: "open" });
      shadowRoot.innerHTML = `
        <style>
          :host {
            all: initial;
          }

          .prompt {
            position: fixed;
            top: 16px;
            right: 16px;
            z-index: 2147483647;
            display: flex;
            align-items: center;
            gap: 8px;
            height: 40px;
            padding: 0 8px 0 12px;
            border-radius: 999px;
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.99), rgba(248, 250, 252, 0.98));
            border: 1px solid rgba(148, 163, 184, 0.72);
            box-shadow:
              0 18px 40px rgba(15, 23, 42, 0.34),
              0 6px 16px rgba(15, 23, 42, 0.18),
              0 0 0 1px rgba(255, 255, 255, 0.72) inset;
            backdrop-filter: blur(14px) saturate(1.12);
            color: #0f172a;
            font: 500 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            opacity: 0;
            transform: translateY(-8px) scale(0.98);
            transition: opacity 180ms ease, transform 180ms ease;
            pointer-events: none;
          }

          .prompt[data-visible="true"] {
            opacity: 1;
            transform: translateY(0) scale(1);
            pointer-events: auto;
          }

          .prompt-label {
            white-space: nowrap;
          }

          .prompt-button,
          .tool-button {
            border: none;
            border-radius: 999px;
            background: transparent;
            color: inherit;
            cursor: pointer;
          }

          .prompt-button {
            height: 28px;
            padding: 0 12px;
            font: inherit;
          }

          .prompt-button.primary {
            background: rgba(254, 226, 226, 0.98);
            color: ${STROKE_COLOR};
          }

          .prompt-button:hover,
          .tool-button:hover {
            background: rgba(226, 232, 240, 0.9);
          }

          .editor {
            position: fixed;
            inset: 0;
            z-index: 2147483646;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(2, 6, 23, 0.72);
            backdrop-filter: blur(5px);
            opacity: 0;
            transition: opacity 220ms ease;
            pointer-events: none;
          }

          .editor[data-visible="true"] {
            opacity: 1;
            pointer-events: auto;
          }

          .shell {
            position: relative;
            width: calc(100vw - 20px);
            height: calc(100vh - 20px);
            padding: 54px 10px 10px;
            box-sizing: border-box;
            border-radius: 24px;
            background:
              radial-gradient(circle at top right, rgba(248, 113, 113, 0.08), transparent 26%),
              linear-gradient(180deg, rgba(255, 255, 255, 0.97), rgba(248, 250, 252, 0.98));
            box-shadow:
              0 28px 60px rgba(15, 23, 42, 0.4),
              0 0 0 1px rgba(255, 255, 255, 0.58) inset;
            opacity: 0;
            transform: translateY(12px) scale(0.985);
            transition: opacity 220ms ease, transform 220ms ease;
          }

          .editor[data-visible="true"] .shell {
            opacity: 1;
            transform: translateY(0) scale(1);
          }

          .toolbar {
            position: absolute;
            top: 10px;
            right: 10px;
            display: flex;
            align-items: center;
            gap: 4px;
            height: 36px;
            padding: 4px 6px;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.96);
            border: 1px solid rgba(148, 163, 184, 0.7);
            box-shadow: 0 12px 26px rgba(15, 23, 42, 0.18);
          }

          .divider {
            width: 1px;
            align-self: stretch;
            margin: 2px 1px;
            background: rgba(100, 116, 139, 0.24);
          }

          .tool-button {
            width: 30px;
            height: 30px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: #0f172a;
            transition: background-color 120ms ease, color 120ms ease, transform 120ms ease;
          }

          .tool-button:active:not(:disabled) {
            transform: scale(0.96);
          }

          .tool-button:disabled {
            opacity: 0.35;
            cursor: default;
          }

          .tool-button.active,
          .tool-button[data-tool="undo"],
          .tool-button[data-tool="copy"] {
            color: ${STROKE_COLOR};
          }

          .tool-button.active {
            background: rgba(254, 226, 226, 0.98);
          }

          .tool-button[data-tool="cancel"] {
            color: #991b1b;
          }

          .tool-button svg {
            width: 16px;
            height: 16px;
            display: block;
            overflow: visible;
            stroke: currentColor;
            fill: none;
            stroke-width: 2;
            stroke-linecap: round;
            stroke-linejoin: round;
          }

          .workspace {
            position: relative;
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            padding: 10px;
            box-sizing: border-box;
            border-radius: 20px;
            background:
              linear-gradient(45deg, rgba(226, 232, 240, 0.72) 25%, transparent 25%, transparent 75%, rgba(226, 232, 240, 0.72) 75%, rgba(226, 232, 240, 0.72)),
              linear-gradient(45deg, rgba(226, 232, 240, 0.72) 25%, transparent 25%, transparent 75%, rgba(226, 232, 240, 0.72) 75%, rgba(226, 232, 240, 0.72));
            background-size: 24px 24px;
            background-position: 0 0, 12px 12px;
          }

          .viewport {
            position: relative;
            box-shadow: 0 22px 50px rgba(15, 23, 42, 0.18);
            background: white;
            cursor: crosshair;
          }

          .canvas-layer {
            position: absolute;
            inset: 0;
            display: block;
          }

          .base-canvas {
            z-index: 1;
          }

          .overlay-canvas {
            z-index: 2;
            pointer-events: none;
          }

          .text-input {
            position: absolute;
            z-index: 3;
            min-width: 140px;
            min-height: 34px;
            padding: 2px 4px;
            border: 1px dashed rgba(220, 38, 38, 0.45);
            outline: none;
            resize: both;
            overflow: hidden;
            background: rgba(255, 255, 255, 0.92);
            color: ${STROKE_COLOR};
            font: 600 ${FONT_SIZE}px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            white-space: pre-wrap;
          }

          [hidden] {
            display: none !important;
          }
        </style>
        <div class="prompt" hidden>
          <div class="prompt-label">截图已复制</div>
          <button class="prompt-button primary" type="button" data-action="annotate">标注</button>
          <button class="prompt-button" type="button" data-action="dismiss" aria-label="关闭">关闭</button>
        </div>
        <div class="editor" hidden>
          <div class="shell">
            <div class="toolbar" role="toolbar" aria-label="标注工具">
              <button class="tool-button active" type="button" data-tool="rect" title="矩形 (R)" aria-label="矩形">
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.75" y="4.75" width="14.5" height="14.5" rx="1.75"></rect></svg>
              </button>
              <button class="tool-button" type="button" data-tool="arrow" title="箭头 (A)" aria-label="箭头">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 18L17.5 5.5"></path><path d="M11 5.5h6.5V12"></path></svg>
              </button>
              <button class="tool-button" type="button" data-tool="brush" title="画笔 (B)" aria-label="画笔">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 18c1.8 0 3 1 3 2.5S8.1 23 6.5 23 3.5 22.1 3.5 20.4C3.5 18.8 4.7 18 6.5 18z"></path><path d="M8.5 17.2L17.8 7.9a2.2 2.2 0 113.1 3.1L11.6 20.3"></path></svg>
              </button>
              <button class="tool-button" type="button" data-tool="text" title="文字 (T)" aria-label="文字">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14"></path><path d="M12 6v12"></path><path d="M8.5 18h7"></path></svg>
              </button>
              <button class="tool-button" type="button" data-tool="zoom" title="区域放大 (Z)" aria-label="区域放大">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.25" cy="10.25" r="5.25"></circle><path d="M10.25 7.6v5.3"></path><path d="M7.6 10.25h5.3"></path><path d="M14.6 14.6L19 19"></path></svg>
              </button>
              <div class="divider" aria-hidden="true"></div>
              <button class="tool-button" type="button" data-tool="undo" title="撤销 (Cmd/Ctrl+Z)" aria-label="撤销">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6.5L5 11l4.5 4.5"></path><path d="M6 11h7a5.5 5.5 0 010 11h-3"></path></svg>
              </button>
              <button class="tool-button" type="button" data-tool="copy" title="复制 (Enter)" aria-label="复制">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.75l4.1 4.1L19 7"></path></svg>
              </button>
              <button class="tool-button" type="button" data-tool="cancel" title="取消 (Esc)" aria-label="取消">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.25 6.25l11.5 11.5"></path><path d="M17.75 6.25L6.25 17.75"></path></svg>
              </button>
            </div>
            <div class="workspace">
              <div class="viewport">
                <canvas class="canvas-layer base-canvas"></canvas>
                <canvas class="canvas-layer overlay-canvas"></canvas>
              </div>
            </div>
          </div>
        </div>
      `;

      this.prompt = shadowRoot.querySelector(".prompt");
      this.editor = shadowRoot.querySelector(".editor");
      this.toolbar = shadowRoot.querySelector(".toolbar");
      this.workspace = shadowRoot.querySelector(".workspace");
      this.viewport = shadowRoot.querySelector(".viewport");
      this.baseCanvas = shadowRoot.querySelector(".base-canvas");
      this.overlayCanvas = shadowRoot.querySelector(".overlay-canvas");
      this.baseContext = this.baseCanvas.getContext("2d");
      this.overlayContext = this.overlayCanvas.getContext("2d");
      this.toolButtons = Array.from(
        shadowRoot.querySelectorAll(".tool-button[data-tool]"),
      );
    }

    attachListeners() {
      this.prompt.addEventListener("click", (event) =>
        this.handlePromptClick(event),
      );
      this.editor.addEventListener("click", (event) => {
        if (event.target === this.editor) {
          this.closeAll();
        }
      });
      this.editor.addEventListener("click", (event) =>
        this.handleToolbarClick(event),
      );
      this.viewport.addEventListener("pointerdown", (event) =>
        this.handlePointerDown(event),
      );
      window.addEventListener(
        "pointermove",
        (event) => this.handlePointerMove(event),
        true,
      );
      window.addEventListener(
        "pointerup",
        (event) => this.handlePointerUp(event),
        true,
      );
      window.addEventListener(
        "keydown",
        (event) => this.handleKeyDown(event),
        true,
      );
      window.addEventListener("resize", () => this.handleResize(), true);
    }

    handlePromptClick(event) {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (!action) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (action === "annotate") {
        void this.openEditor();
        return;
      }

      if (action === "dismiss") {
        this.closeAll();
      }
    }

    async openEditor() {
      if (!this.imageDataUrl) {
        return;
      }

      try {
        this.ensureHost();
        await this.ensureImageLoaded();
        this.clearPromptAutoHide();
        this.hidePrompt();
        this.isPromptOpen = false;
        this.isEditorOpen = true;
        this.showEditor();
        this.syncCanvases();
        this.resetEditor();
      } catch (error) {
        console.error("Failed to open annotation editor:", error);
        this.closeAll();
        chrome.runtime.sendMessage({
          type: "annotation-copy-failure",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    closeEditor({ keepPrompt = false } = {}) {
      this.isEditorOpen = false;
      this.hideEditor();
      this.isDrawing = false;
      this.draft = null;
      this.dragState = null;
      this.clearOverlay();
      this.removeTextInput();

      if (keepPrompt && this.imageDataUrl) {
        this.isPromptOpen = true;
        this.showPrompt();
        this.schedulePromptAutoHide();
      }
    }

    closeAll() {
      this.clearPromptAutoHide();
      this.closeEditor({ keepPrompt: false });
      this.hidePrompt();
      this.isPromptOpen = false;
    }

    schedulePromptAutoHide() {
      this.clearPromptAutoHide();

      if (!this.isPromptOpen) {
        return;
      }

      this.promptIdleTimer = setTimeout(() => {
        this.promptIdleTimer = null;

        if (this.isPromptOpen) {
          this.isPromptOpen = false;
          this.hidePrompt();
        }
      }, PROMPT_IDLE_MS);
    }

    clearPromptAutoHide() {
      if (this.promptIdleTimer) {
        clearTimeout(this.promptIdleTimer);
        this.promptIdleTimer = null;
      }
    }

    showPrompt() {
      if (this.promptVisibilityTimer) {
        clearTimeout(this.promptVisibilityTimer);
        this.promptVisibilityTimer = null;
      }

      this.prompt.hidden = false;
      requestAnimationFrame(() => {
        this.prompt.dataset.visible = "true";
      });
    }

    hidePrompt() {
      if (this.promptVisibilityTimer) {
        clearTimeout(this.promptVisibilityTimer);
      }

      this.prompt.dataset.visible = "false";
      this.promptVisibilityTimer = setTimeout(() => {
        this.promptVisibilityTimer = null;
        if (this.prompt.dataset.visible !== "true") {
          this.prompt.hidden = true;
        }
      }, PROMPT_TRANSITION_MS);
    }

    showEditor() {
      if (this.editorVisibilityTimer) {
        clearTimeout(this.editorVisibilityTimer);
        this.editorVisibilityTimer = null;
      }

      this.editor.hidden = false;
      requestAnimationFrame(() => {
        this.editor.dataset.visible = "true";
      });
    }

    hideEditor() {
      if (this.editorVisibilityTimer) {
        clearTimeout(this.editorVisibilityTimer);
      }

      this.editor.dataset.visible = "false";
      this.editorVisibilityTimer = setTimeout(() => {
        this.editorVisibilityTimer = null;
        if (this.editor.dataset.visible !== "true") {
          this.editor.hidden = true;
        }
      }, EDITOR_TRANSITION_MS);
    }

    async ensureImageLoaded() {
      if (this.image) {
        return this.image;
      }

      this.image = await loadImage(this.imageDataUrl);
      return this.image;
    }

    syncCanvases() {
      if (!this.image || !this.baseContext || !this.overlayContext) {
        return;
      }

      const workspaceWidth =
        this.workspace?.clientWidth || Math.round(window.innerWidth * 0.82);
      const workspaceHeight =
        this.workspace?.clientHeight || Math.round(window.innerHeight * 0.72);
      const availableWidth = Math.max(1, workspaceWidth - 20);
      const availableHeight = Math.max(1, workspaceHeight - 20);
      const scale = Math.min(
        availableWidth / this.image.naturalWidth,
        availableHeight / this.image.naturalHeight,
        1,
      );
      const displayWidth = Math.max(
        1,
        Math.round(this.image.naturalWidth * scale),
      );
      const displayHeight = Math.max(
        1,
        Math.round(this.image.naturalHeight * scale),
      );

      this.viewport.style.width = `${displayWidth}px`;
      this.viewport.style.height = `${displayHeight}px`;

      this.baseCanvas.width = this.image.naturalWidth;
      this.baseCanvas.height = this.image.naturalHeight;
      this.overlayCanvas.width = this.image.naturalWidth;
      this.overlayCanvas.height = this.image.naturalHeight;

      this.baseCanvas.style.width = `${displayWidth}px`;
      this.baseCanvas.style.height = `${displayHeight}px`;
      this.overlayCanvas.style.width = `${displayWidth}px`;
      this.overlayCanvas.style.height = `${displayHeight}px`;
    }

    resetEditor() {
      this.annotations = [];
      this.history = [[]];
      this.nextAnnotationId = 1;
      this.dragState = null;
      this.draft = null;
      this.removeTextInput();
      this.setTool(this.tool || "rect");
      this.clearOverlay();
      this.renderScene();
      this.updateUndoButton();
    }

    renderScene() {
      if (!this.image || !this.baseContext) {
        return;
      }

      this.baseContext.clearRect(
        0,
        0,
        this.baseCanvas.width,
        this.baseCanvas.height,
      );
      this.baseContext.drawImage(this.image, 0, 0);

      const zoomAnnotations = [];
      for (const annotation of this.annotations) {
        if (annotation.type === "zoom") {
          zoomAnnotations.push(annotation);
          continue;
        }

        drawAnnotation(this.baseContext, annotation);
      }

      if (!zoomAnnotations.length) {
        return;
      }

      const snapshot = cloneCanvas(this.baseCanvas);
      for (const annotation of zoomAnnotations) {
        drawZoomAnnotation(this.baseContext, snapshot, annotation);
      }
    }

    renderDraft() {
      this.clearOverlay();

      if (!this.draft) {
        return;
      }

      this.overlayContext.save();
      if (this.draft.type === "rect") {
        drawRectAnnotation(this.overlayContext, {
          x: this.draft.rect.x,
          y: this.draft.rect.y,
          width: this.draft.rect.width,
          height: this.draft.rect.height,
        });
      } else if (this.draft.type === "arrow") {
        drawArrowAnnotation(this.overlayContext, {
          start: this.draft.start,
          end: this.draft.end,
        });
      } else if (this.draft.type === "brush") {
        drawBrushAnnotation(this.overlayContext, {
          points: this.draft.points,
        });
      } else if (this.draft.type === "zoom") {
        drawZoomDraft(
          this.overlayContext,
          this.draft.sourceRect,
          this.draft.calloutRect,
        );
      }
      this.overlayContext.restore();
    }

    setTool(tool) {
      this.tool = tool;
      for (const button of this.toolButtons) {
        button.classList.toggle("active", button.dataset.tool === tool);
      }
      this.viewport.style.cursor = tool === "text" ? "text" : "crosshair";
      this.updateUndoButton();
    }

    updateUndoButton() {
      const undoButton = this.toolButtons.find(
        (button) => button.dataset.tool === "undo",
      );
      if (undoButton) {
        undoButton.disabled = this.history.length <= 1;
      }
    }

    handleToolbarClick(event) {
      const tool = event.target.closest("[data-tool]")?.dataset.tool;
      if (!tool) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (tool === "copy") {
        void this.copyAnnotatedImage();
        return;
      }

      if (tool === "undo") {
        this.undo();
        return;
      }

      if (tool === "cancel") {
        this.closeAll();
        return;
      }

      this.commitTextInput();
      this.setTool(tool);
    }

    handlePointerDown(event) {
      if (!this.isEditorOpen || event.button !== 0) {
        return;
      }

      if (event.composedPath().includes(this.toolbar)) {
        return;
      }

      const point = this.getCanvasPoint(event);
      if (!point) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      this.commitTextInput();

      const hit = this.hitTestAnnotations(point);
      if (hit) {
        this.dragState = {
          annotationId: hit.id,
          startPoint: point,
          origin: cloneAnnotation(hit.annotation),
          moved: false,
        };
        return;
      }

      if (this.tool === "text") {
        this.beginTextInput(point);
        return;
      }

      this.isDrawing = true;

      if (this.tool === "brush") {
        this.draft = {
          type: "brush",
          points: [point],
        };
        this.renderDraft();
        return;
      }

      if (this.tool === "zoom") {
        this.draft = {
          type: "zoom",
          start: point,
          end: point,
          sourceRect: { x: point.x, y: point.y, width: 0, height: 0 },
          calloutRect: null,
        };
        this.renderDraft();
        return;
      }

      this.draft = {
        type: this.tool,
        start: point,
        end: point,
        rect: { x: point.x, y: point.y, width: 0, height: 0 },
      };
      this.renderDraft();
    }

    handlePointerMove(event) {
      if (!this.isEditorOpen) {
        return;
      }

      const point = this.getCanvasPoint(event);
      if (!point) {
        return;
      }

      if (this.dragState) {
        event.preventDefault();
        event.stopPropagation();

        const dx = point.x - this.dragState.startPoint.x;
        const dy = point.y - this.dragState.startPoint.y;
        if (!this.dragState.moved && Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
          this.dragState.moved = true;
          bringAnnotationToFront(this.annotations, this.dragState.annotationId);
        }

        if (!this.dragState.moved) {
          return;
        }

        const current = this.findAnnotationById(this.dragState.annotationId);
        if (!current) {
          return;
        }

        const moved = translateAnnotationWithinBounds(
          this.dragState.origin,
          dx,
          dy,
          this.baseCanvas.width,
          this.baseCanvas.height,
        );

        replaceAnnotation(this.annotations, moved);
        this.renderScene();
        return;
      }

      if (!this.isDrawing || !this.draft) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (this.draft.type === "brush") {
        const last = this.draft.points[this.draft.points.length - 1];
        if (!last || distanceBetween(last, point) >= 1) {
          this.draft.points.push(point);
          this.renderDraft();
        }
        return;
      }

      if (this.draft.type === "zoom") {
        this.draft.end = point;
        this.draft.sourceRect = normalizeRect(this.draft.start, point);
        this.draft.calloutRect = null;
        this.renderDraft();
        return;
      }

      this.draft.end = point;
      this.draft.rect = normalizeRect(this.draft.start, point);
      this.renderDraft();
    }

    handlePointerUp(event) {
      if (!this.isEditorOpen) {
        return;
      }

      const point = this.getCanvasPoint(event);

      if (this.dragState) {
        event.preventDefault();
        event.stopPropagation();
        if (this.dragState.moved) {
          this.recordHistory();
        }
        this.dragState = null;
        return;
      }

      if (!this.isDrawing || !this.draft) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      this.isDrawing = false;

      if (this.draft.type === "brush") {
        const annotation = buildBrushAnnotation(
          this.nextAnnotationId,
          this.draft.points,
        );
        this.draft = null;
        this.clearOverlay();

        if (annotation) {
          this.annotations.push(annotation);
          this.nextAnnotationId += 1;
          this.recordHistory();
          this.renderScene();
        }
        return;
      }

      if (this.draft.type === "zoom") {
        if (point) {
          this.draft.sourceRect = normalizeRect(this.draft.start, point);
          if (
            this.draft.sourceRect.width >= 12 &&
            this.draft.sourceRect.height >= 12
          ) {
            const annotation = {
              id: this.nextAnnotationId,
              type: "zoom",
              sourceRect: this.draft.sourceRect,
              calloutRect: chooseZoomCalloutRect(
                this.draft.sourceRect,
                this.baseCanvas.width,
                this.baseCanvas.height,
                this.annotations,
              ),
            };
            this.annotations.push(annotation);
            this.nextAnnotationId += 1;
            this.recordHistory();
            this.renderScene();
          }
        }

        this.draft = null;
        this.clearOverlay();
        return;
      }

      if (!point) {
        this.draft = null;
        this.clearOverlay();
        return;
      }

      this.draft.end = point;
      const rect = normalizeRect(this.draft.start, point);
      let annotation = null;

      if (this.draft.type === "rect" && rect.width >= 4 && rect.height >= 4) {
        annotation = {
          id: this.nextAnnotationId,
          type: "rect",
          ...rect,
        };
      }

      if (
        this.draft.type === "arrow" &&
        (rect.width >= 4 || rect.height >= 4)
      ) {
        annotation = {
          id: this.nextAnnotationId,
          type: "arrow",
          start: this.draft.start,
          end: point,
        };
      }

      this.draft = null;
      this.clearOverlay();

      if (annotation) {
        this.annotations.push(annotation);
        this.nextAnnotationId += 1;
        this.recordHistory();
        this.renderScene();
      }
    }

    handleKeyDown(event) {
      if (!this.isPromptOpen && !this.isEditorOpen) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (this.compositionInput) {
          this.removeTextInput();
          return;
        }
        this.closeAll();
        return;
      }

      if (!this.isEditorOpen) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.stopPropagation();
        this.undo();
        return;
      }

      if (event.key === "Enter" && !this.compositionInput) {
        event.preventDefault();
        event.stopPropagation();
        void this.copyAnnotatedImage();
        return;
      }

      const hotkeys = {
        r: "rect",
        a: "arrow",
        b: "brush",
        t: "text",
        z: "zoom",
      };

      const nextTool = hotkeys[event.key.toLowerCase()];
      if (nextTool && !this.compositionInput) {
        event.preventDefault();
        event.stopPropagation();
        this.setTool(nextTool);
      }
    }

    handleResize() {
      if (!this.isEditorOpen || !this.image) {
        return;
      }

      this.syncCanvases();
      this.renderScene();
      this.renderDraft();
      this.positionTextInput();
    }

    getCanvasPoint(event) {
      const rect = this.viewport.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        return null;
      }

      const x = clamp(event.clientX - rect.left, 0, rect.width);
      const y = clamp(event.clientY - rect.top, 0, rect.height);

      return {
        x: x * (this.baseCanvas.width / rect.width),
        y: y * (this.baseCanvas.height / rect.height),
      };
    }

    getDisplayPoint(point) {
      const rect = this.viewport.getBoundingClientRect();
      return {
        x: point.x * (rect.width / this.baseCanvas.width),
        y: point.y * (rect.height / this.baseCanvas.height),
      };
    }

    beginTextInput(point) {
      this.removeTextInput();

      const displayPoint = this.getDisplayPoint(point);
      const input = document.createElement("textarea");
      input.className = "text-input";
      input.style.left = `${displayPoint.x}px`;
      input.style.top = `${displayPoint.y}px`;
      input.dataset.canvasX = String(point.x);
      input.dataset.canvasY = String(point.y);
      this.viewport.appendChild(input);
      this.compositionInput = input;

      const commit = () => this.commitTextInput();
      input.addEventListener("blur", commit, { once: true });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          commit();
        }
      });

      input.focus();
    }

    positionTextInput() {
      if (!this.compositionInput) {
        return;
      }

      const point = {
        x: Number(this.compositionInput.dataset.canvasX || "0"),
        y: Number(this.compositionInput.dataset.canvasY || "0"),
      };
      const displayPoint = this.getDisplayPoint(point);
      this.compositionInput.style.left = `${displayPoint.x}px`;
      this.compositionInput.style.top = `${displayPoint.y}px`;
    }

    removeTextInput() {
      if (!this.compositionInput) {
        return;
      }

      this.compositionInput.remove();
      this.compositionInput = null;
    }

    commitTextInput() {
      if (!this.compositionInput) {
        return;
      }

      const input = this.compositionInput;
      this.compositionInput = null;
      const text = input.value.trim();
      input.remove();

      if (!text) {
        return;
      }

      const x = Number(input.dataset.canvasX || "0");
      const y = Number(input.dataset.canvasY || "0");
      const lines = text.split(/\n+/);
      const metrics = measureTextBlock(this.baseContext, lines);

      this.annotations.push({
        id: this.nextAnnotationId,
        type: "text",
        x,
        y,
        lines,
        width: metrics.width,
        height: metrics.height,
      });
      this.nextAnnotationId += 1;
      this.recordHistory();
      this.renderScene();
    }

    recordHistory() {
      this.history.push(cloneAnnotations(this.annotations));
      if (this.history.length > MAX_HISTORY_ENTRIES) {
        this.history.splice(0, this.history.length - MAX_HISTORY_ENTRIES);
      }
      this.updateUndoButton();
    }

    undo() {
      this.commitTextInput();

      if (this.history.length <= 1) {
        this.updateUndoButton();
        return;
      }

      this.history.pop();
      this.annotations = cloneAnnotations(
        this.history[this.history.length - 1],
      );
      this.nextAnnotationId =
        this.annotations.reduce(
          (maxId, annotation) => Math.max(maxId, annotation.id),
          0,
        ) + 1;
      this.dragState = null;
      this.draft = null;
      this.clearOverlay();
      this.renderScene();
      this.updateUndoButton();
    }

    hitTestAnnotations(point) {
      for (let index = this.annotations.length - 1; index >= 0; index -= 1) {
        const annotation = this.annotations[index];
        if (hitTestAnnotation(annotation, point)) {
          return {
            id: annotation.id,
            annotation,
          };
        }
      }

      return null;
    }

    findAnnotationById(annotationId) {
      return (
        this.annotations.find((annotation) => annotation.id === annotationId) ||
        null
      );
    }

    clearOverlay() {
      this.overlayContext.clearRect(
        0,
        0,
        this.overlayCanvas.width,
        this.overlayCanvas.height,
      );
    }

    async copyAnnotatedImage() {
      try {
        this.commitTextInput();
        this.renderScene();

        const imageBlob = await canvasToBlob(this.baseCanvas);
        const imageDataUrl = await blobToDataUrl(imageBlob);
        const response = await chrome.runtime.sendMessage({
          type: "copy-image-to-clipboard",
          imageDataUrl,
        });

        if (!response?.ok) {
          throw new Error(response?.error || "写入剪贴板失败。");
        }

        chrome.runtime.sendMessage({ type: "annotation-copy-success" });
        this.closeAll();
      } catch (error) {
        chrome.runtime.sendMessage({
          type: "annotation-copy-failure",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  function drawAnnotation(context, annotation) {
    context.save();

    if (annotation.type === "rect") {
      drawRectAnnotation(context, annotation);
    } else if (annotation.type === "arrow") {
      drawArrowAnnotation(context, annotation);
    } else if (annotation.type === "brush") {
      drawBrushAnnotation(context, annotation);
    } else if (annotation.type === "text") {
      drawTextAnnotation(context, annotation);
    }

    context.restore();
  }

  function drawRectAnnotation(context, annotation) {
    applyStrokeStyle(context);
    context.strokeRect(
      annotation.x,
      annotation.y,
      annotation.width,
      annotation.height,
    );
  }

  function drawArrowAnnotation(context, annotation) {
    drawArrow(context, annotation.start, annotation.end);
  }

  function drawBrushAnnotation(context, annotation) {
    const points = annotation.points || [];
    if (points.length < 1) {
      return;
    }

    applyStrokeStyle(context);
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      context.lineTo(points[index].x, points[index].y);
    }
    context.stroke();
  }

  function drawTextAnnotation(context, annotation) {
    context.fillStyle = STROKE_COLOR;
    context.textBaseline = "top";
    context.font = `600 ${FONT_SIZE}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;

    for (let index = 0; index < annotation.lines.length; index += 1) {
      context.fillText(
        annotation.lines[index],
        annotation.x,
        annotation.y + index * Math.round(FONT_SIZE * 1.35),
      );
    }
  }

  function drawZoomDraft(context, sourceRect, calloutRect) {
    applyStrokeStyle(context);
    context.strokeRect(
      sourceRect.x,
      sourceRect.y,
      sourceRect.width,
      sourceRect.height,
    );

    if (!calloutRect) {
      return;
    }

    context.strokeRect(
      calloutRect.x,
      calloutRect.y,
      calloutRect.width,
      calloutRect.height,
    );
    const [sourceAnchor, targetAnchor] = getCalloutAnchors(
      sourceRect,
      calloutRect,
    );
    drawBezierConnector(context, sourceAnchor, targetAnchor);
  }

  function drawArrow(context, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);

    if (length < 8) {
      return;
    }

    const points = getArrowPolygon(start, end, length);
    context.save();
    context.fillStyle = STROKE_COLOR;
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      context.lineTo(points[index].x, points[index].y);
    }
    context.closePath();
    context.fill();
    context.restore();
  }

  function getArrowPolygon(start, end, providedLength) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = providedLength || Math.hypot(dx, dy);
    const unitX = dx / length;
    const unitY = dy / length;
    const normalX = -unitY;
    const normalY = unitX;
    const headLength = clamp(length * 0.3, 22, 52);
    const headWidth = clamp(length * 0.24, 24, 42);
    const tailWidth = clamp(length * 0.018, 2, 5.5);
    const neckWidth = clamp(length * 0.09, STROKE_WIDTH + 3, 20);
    const headBaseX = end.x - unitX * headLength;
    const headBaseY = end.y - unitY * headLength;

    return [
      {
        x: start.x + normalX * (tailWidth / 2),
        y: start.y + normalY * (tailWidth / 2),
      },
      {
        x: headBaseX + normalX * (neckWidth / 2),
        y: headBaseY + normalY * (neckWidth / 2),
      },
      {
        x: headBaseX + normalX * (headWidth / 2),
        y: headBaseY + normalY * (headWidth / 2),
      },
      { x: end.x, y: end.y },
      {
        x: headBaseX - normalX * (headWidth / 2),
        y: headBaseY - normalY * (headWidth / 2),
      },
      {
        x: headBaseX - normalX * (neckWidth / 2),
        y: headBaseY - normalY * (neckWidth / 2),
      },
      {
        x: start.x - normalX * (tailWidth / 2),
        y: start.y - normalY * (tailWidth / 2),
      },
    ];
  }

  function drawZoomAnnotation(context, sourceCanvas, annotation) {
    const { sourceRect, calloutRect } = annotation;
    applyStrokeStyle(context);

    context.save();
    context.shadowColor = "rgba(220, 38, 38, 0.28)";
    context.shadowBlur = 18;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 6;
    context.strokeRect(
      sourceRect.x,
      sourceRect.y,
      sourceRect.width,
      sourceRect.height,
    );
    context.restore();

    context.save();
    context.fillStyle = "rgba(255, 255, 255, 0.92)";
    context.shadowColor = "rgba(15, 23, 42, 0.18)";
    context.shadowBlur = 22;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 10;
    context.fillRect(
      calloutRect.x,
      calloutRect.y,
      calloutRect.width,
      calloutRect.height,
    );
    context.restore();

    context.drawImage(
      sourceCanvas,
      sourceRect.x,
      sourceRect.y,
      sourceRect.width,
      sourceRect.height,
      calloutRect.x,
      calloutRect.y,
      calloutRect.width,
      calloutRect.height,
    );

    context.save();
    context.shadowColor = "rgba(15, 23, 42, 0.2)";
    context.shadowBlur = 20;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 8;
    context.strokeRect(
      calloutRect.x,
      calloutRect.y,
      calloutRect.width,
      calloutRect.height,
    );
    context.restore();

    const [sourceAnchor, targetAnchor] = getCalloutAnchors(
      sourceRect,
      calloutRect,
    );
    context.save();
    context.shadowColor = "rgba(220, 38, 38, 0.14)";
    context.shadowBlur = 8;
    drawBezierConnector(context, sourceAnchor, targetAnchor);
    context.restore();
  }

  function chooseZoomCalloutRect(
    sourceRect,
    canvasWidth,
    canvasHeight,
    annotations,
  ) {
    const preferredScale = 1.8;
    const safeSourceWidth = Math.max(sourceRect.width, 1);
    const safeSourceHeight = Math.max(sourceRect.height, 1);
    const maxScale = Math.min(
      (canvasWidth * 0.38) / safeSourceWidth,
      (canvasHeight * 0.38) / safeSourceHeight,
    );
    const minScale = Math.max(96 / safeSourceWidth, 72 / safeSourceHeight, 1);
    const scale =
      maxScale >= minScale
        ? clamp(preferredScale, minScale, maxScale)
        : Math.max(1, maxScale);
    const width = Math.max(1, Math.round(safeSourceWidth * scale));
    const height = Math.max(1, Math.round(safeSourceHeight * scale));
    const offset = 28;
    const existing = annotations
      .filter((annotation) => annotation.type === "zoom")
      .map((annotation) => annotation.calloutRect);

    const sourceCenter = rectCenter(sourceRect);
    const candidates = [];
    const xAnchors = [
      sourceRect.x + sourceRect.width + offset,
      sourceRect.x - width - offset,
      sourceCenter.x - width / 2,
      12,
      canvasWidth - width - 12,
    ];
    const yAnchors = [
      sourceRect.y + sourceRect.height / 2 - height / 2,
      sourceRect.y - height - offset,
      sourceRect.y + sourceRect.height + offset,
      sourceCenter.y - height / 2,
      12,
      canvasHeight - height - 12,
    ];

    for (const x of xAnchors) {
      for (const y of yAnchors) {
        candidates.push({
          x: clamp(x, 12, canvasWidth - width - 12),
          y: clamp(y, 12, canvasHeight - height - 12),
          width,
          height,
        });
      }
    }

    const uniqueCandidates = dedupeRects(candidates);

    let best = uniqueCandidates[0];
    let bestScore = Number.POSITIVE_INFINITY;

    for (const candidate of uniqueCandidates) {
      const overlapArea = existing.reduce(
        (total, rect) => total + rectIntersectionArea(candidate, rect),
        0,
      );
      const sourceOverlapArea = rectIntersectionArea(candidate, sourceRect);
      const distanceScore = distanceBetween(
        rectCenter(candidate),
        sourceCenter,
      );
      const edgePenalty = edgeTouchPenalty(
        candidate,
        canvasWidth,
        canvasHeight,
      );
      const score =
        overlapArea * 12 +
        sourceOverlapArea * 24 +
        distanceScore * 0.03 +
        edgePenalty;

      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    return best;
  }

  function getCalloutAnchors(sourceRect, targetRect) {
    const sourceCenter = rectCenter(sourceRect);
    const targetCenter = rectCenter(targetRect);
    const deltaX = targetCenter.x - sourceCenter.x;
    const deltaY = targetCenter.y - sourceCenter.y;

    if (Math.abs(deltaX) >= Math.abs(deltaY)) {
      if (deltaX >= 0) {
        return [
          { x: sourceRect.x + sourceRect.width, y: sourceCenter.y },
          { x: targetRect.x, y: targetCenter.y },
        ];
      }

      return [
        { x: sourceRect.x, y: sourceCenter.y },
        { x: targetRect.x + targetRect.width, y: targetCenter.y },
      ];
    }

    if (deltaY >= 0) {
      return [
        { x: sourceCenter.x, y: sourceRect.y + sourceRect.height },
        { x: targetCenter.x, y: targetRect.y },
      ];
    }

    return [
      { x: sourceCenter.x, y: sourceRect.y },
      { x: targetCenter.x, y: targetRect.y + targetRect.height },
    ];
  }

  function drawBezierConnector(context, sourceAnchor, targetAnchor) {
    const dx = targetAnchor.x - sourceAnchor.x;
    const dy = targetAnchor.y - sourceAnchor.y;
    const controlDistanceX = Math.max(26, Math.abs(dx) * 0.35);
    const controlDistanceY = Math.max(26, Math.abs(dy) * 0.35);
    const control1 = {
      x: sourceAnchor.x + Math.sign(dx || 1) * controlDistanceX,
      y:
        sourceAnchor.y +
        Math.sign(dy || 1) * Math.min(18, controlDistanceY * 0.2),
    };
    const control2 = {
      x: targetAnchor.x - Math.sign(dx || 1) * controlDistanceX,
      y:
        targetAnchor.y -
        Math.sign(dy || 1) * Math.min(18, controlDistanceY * 0.2),
    };

    context.beginPath();
    context.moveTo(sourceAnchor.x, sourceAnchor.y);
    context.bezierCurveTo(
      control1.x,
      control1.y,
      control2.x,
      control2.y,
      targetAnchor.x,
      targetAnchor.y,
    );
    context.stroke();
  }

  function hitTestAnnotation(annotation, point) {
    if (annotation.type === "rect") {
      return isPointInExpandedRect(point, annotation, 8);
    }

    if (annotation.type === "text") {
      return isPointInExpandedRect(point, annotation, 8);
    }

    if (annotation.type === "arrow") {
      return hitTestArrow(annotation, point);
    }

    return false;
  }

  function hitTestBrush(annotation, point) {
    if (!isPointInExpandedRect(point, annotation.bounds, 12)) {
      return false;
    }

    for (let index = 1; index < annotation.points.length; index += 1) {
      if (
        distanceToSegment(
          point,
          annotation.points[index - 1],
          annotation.points[index],
        ) <=
        STROKE_WIDTH + 6
      ) {
        return true;
      }
    }

    return false;
  }

  function hitTestArrow(annotation, point) {
    const polygon = getArrowPolygon(annotation.start, annotation.end);
    return isPointInPolygon(point, polygon);
  }

  function translateAnnotationWithinBounds(
    annotation,
    dx,
    dy,
    canvasWidth,
    canvasHeight,
  ) {
    const bounds = getAnnotationBounds(annotation);
    const clampedDx = clamp(
      dx,
      -bounds.x,
      canvasWidth - (bounds.x + bounds.width),
    );
    const clampedDy = clamp(
      dy,
      -bounds.y,
      canvasHeight - (bounds.y + bounds.height),
    );

    if (annotation.type === "rect" || annotation.type === "text") {
      return {
        ...annotation,
        x: annotation.x + clampedDx,
        y: annotation.y + clampedDy,
      };
    }

    if (annotation.type === "arrow") {
      return {
        ...annotation,
        start: translatePoint(annotation.start, clampedDx, clampedDy),
        end: translatePoint(annotation.end, clampedDx, clampedDy),
      };
    }

    return annotation;
  }

  function getAnnotationBounds(annotation) {
    if (annotation.type === "rect" || annotation.type === "text") {
      return {
        x: annotation.x,
        y: annotation.y,
        width: annotation.width,
        height: annotation.height,
      };
    }

    if (annotation.type === "arrow") {
      const polygon = getArrowPolygon(annotation.start, annotation.end);
      return polygonBounds(polygon);
    }

    if (annotation.type === "brush") {
      return annotation.bounds;
    }

    if (annotation.type === "zoom") {
      return unionRects(annotation.sourceRect, annotation.calloutRect);
    }

    return { x: 0, y: 0, width: 0, height: 0 };
  }

  function buildBrushAnnotation(id, points) {
    if (!points || points.length < 2) {
      return null;
    }

    const bounds = polygonBounds(points);
    return {
      id,
      type: "brush",
      points,
      bounds: {
        x: bounds.x - STROKE_WIDTH,
        y: bounds.y - STROKE_WIDTH,
        width: bounds.width + STROKE_WIDTH * 2,
        height: bounds.height + STROKE_WIDTH * 2,
      },
    };
  }

  function measureTextBlock(context, lines) {
    context.save();
    context.font = `600 ${FONT_SIZE}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    const width =
      Math.max(...lines.map((line) => context.measureText(line).width), 0) + 8;
    context.restore();

    return {
      width,
      height: Math.max(1, lines.length) * Math.round(FONT_SIZE * 1.35),
    };
  }

  function cloneAnnotations(annotations) {
    return annotations.map((annotation) => cloneAnnotation(annotation));
  }

  function cloneAnnotation(annotation) {
    return JSON.parse(JSON.stringify(annotation));
  }

  function replaceAnnotation(annotations, replacement) {
    const index = annotations.findIndex(
      (annotation) => annotation.id === replacement.id,
    );
    if (index >= 0) {
      annotations.splice(index, 1, replacement);
    }
  }

  function bringAnnotationToFront(annotations, annotationId) {
    const index = annotations.findIndex(
      (annotation) => annotation.id === annotationId,
    );
    if (index >= 0 && index !== annotations.length - 1) {
      const [annotation] = annotations.splice(index, 1);
      annotations.push(annotation);
    }
  }

  function applyStrokeStyle(context) {
    context.strokeStyle = STROKE_COLOR;
    context.fillStyle = STROKE_COLOR;
    context.lineWidth = STROKE_WIDTH;
    context.lineCap = "round";
    context.lineJoin = "round";
  }

  function normalizeRect(start, end) {
    return {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    };
  }

  function translatePoint(point, dx, dy) {
    return {
      x: point.x + dx,
      y: point.y + dy,
    };
  }

  function translateRect(rect, dx, dy) {
    return {
      x: rect.x + dx,
      y: rect.y + dy,
      width: rect.width,
      height: rect.height,
    };
  }

  function rectCenter(rect) {
    return {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    };
  }

  function unionRects(a, b) {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const right = Math.max(a.x + a.width, b.x + b.width);
    const bottom = Math.max(a.y + a.height, b.y + b.height);
    return {
      x,
      y,
      width: right - x,
      height: bottom - y,
    };
  }

  function polygonBounds(points) {
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  function isPointInExpandedRect(point, rect, padding) {
    return (
      point.x >= rect.x - padding &&
      point.x <= rect.x + rect.width + padding &&
      point.y >= rect.y - padding &&
      point.y <= rect.y + rect.height + padding
    );
  }

  function isPointInPolygon(point, polygon) {
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;

      const intersect =
        yi > point.y !== yj > point.y &&
        point.x < ((xj - xi) * (point.y - yi)) / (yj - yi || 1e-6) + xi;

      if (intersect) {
        inside = !inside;
      }
    }

    return inside;
  }

  function distanceToSegment(point, a, b) {
    const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    if (l2 === 0) {
      return distanceBetween(point, a);
    }

    let t =
      ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / l2;
    t = clamp(t, 0, 1);

    return distanceBetween(point, {
      x: a.x + t * (b.x - a.x),
      y: a.y + t * (b.y - a.y),
    });
  }

  function distanceBetween(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function rectIntersectionArea(a, b) {
    const width = Math.max(
      0,
      Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    );
    const height = Math.max(
      0,
      Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
    );
    return width * height;
  }

  function dedupeRects(rects) {
    const seen = new Set();
    const unique = [];

    for (const rect of rects) {
      const key = `${Math.round(rect.x)}:${Math.round(rect.y)}:${Math.round(rect.width)}:${Math.round(rect.height)}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      unique.push(rect);
    }

    return unique;
  }

  function edgeTouchPenalty(rect, canvasWidth, canvasHeight) {
    let penalty = 0;

    if (rect.x <= 12 || rect.x + rect.width >= canvasWidth - 12) {
      penalty += 60;
    }

    if (rect.y <= 12 || rect.y + rect.height >= canvasHeight - 12) {
      penalty += 60;
    }

    return penalty;
  }

  function cloneCanvas(sourceCanvas) {
    const canvas = document.createElement("canvas");
    canvas.width = sourceCanvas.width;
    canvas.height = sourceCanvas.height;
    canvas.getContext("2d").drawImage(sourceCanvas, 0, 0);
    return canvas;
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("无法生成标注图片。"));
          return;
        }

        resolve(blob);
      }, "image/png");
    });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("无法读取标注图片。"));
      reader.readAsDataURL(blob);
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

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function readBootstrapData() {
    return window[BOOTSTRAP_KEY] || null;
  }

  const instance = new ChromeSnipAnnotationUi();
  window[GLOBAL_KEY] = instance;
  instance.openPrompt();
})();

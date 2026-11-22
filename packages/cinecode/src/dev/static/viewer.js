// Cinecode viewer client: strict element creation and textContent only
const listEl = document.getElementById("list");
const previewEl = document.getElementById("preview");
const emptyEl = document.getElementById("empty-state");
const dotEl = document.getElementById("dot");
const statusTextEl = document.getElementById("statusText");
const overlayEl = document.getElementById("overlay");
const fitViewBtn = document.getElementById("fitView");
const resetViewBtn = document.getElementById("resetView");

let nodes = [];
let selectedNode = null;
let currentFrame = 0;
const staleNodes = new Set();

let zoomLevel = 1;
let panX = 0;
let panY = 0;
let isDragging = false;
let startX = 0;
let startY = 0;
let currentImg = null;

function applyTransform() {
  if (currentImg) {
    currentImg.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
  }
}

function resetTransform() {
  zoomLevel = 1;
  panX = 0;
  panY = 0;
  applyTransform();
}

function fitTransform() {
  resetTransform();
}

function clearPreview() {
  currentImg = null;
  const scrubEl = document.getElementById("scrub");
  if (scrubEl) scrubEl.remove();

  const toRemove = [];
  for (const child of previewEl.children) {
    if (child.id !== "empty-state" && child.id !== "view-controls" && child.id !== "view-help") {
      toRemove.push(child);
    }
  }
  for (const el of toRemove) el.remove();
  if (emptyEl) emptyEl.style.display = "none";
}

function renderNode(node, frame = 0) {
  clearPreview();
  if (!node) {
    if (emptyEl) emptyEl.style.display = "block";
    return;
  }

  if (node.kind === "audio") {
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.autoplay = false;
    audio.src = `/preview/${encodeURIComponent(node.id)}?v=${Date.now()}`;
    previewEl.appendChild(audio);
    return;
  }

  const img = document.createElement("img");
  img.alt = node.name;
  img.src = `/preview/${encodeURIComponent(node.id)}?frame=${frame}&v=${Date.now()}`;
  currentImg = img;
  applyTransform();

  img.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = img.getBoundingClientRect();
    const cursorX = e.clientX - rect.left - rect.width / 2;
    const cursorY = e.clientY - rect.top - rect.height / 2;
    const worldX = (cursorX - panX) / zoomLevel;
    const worldY = (cursorY - panY) / zoomLevel;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const nextZoom = Math.max(0.1, Math.min(10, zoomLevel * factor));
    panX = cursorX - worldX * nextZoom;
    panY = cursorY - worldY * nextZoom;
    zoomLevel = nextZoom;
    applyTransform();
  }, { passive: false });

  img.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    isDragging = true;
    startX = e.clientX - panX;
    startY = e.clientY - panY;
  });

  previewEl.appendChild(img);

  if (node.kind === "scene" || node.kind === "timeline") {
    renderScrubber(node, frame);
  }
}

function renderScrubber(node, initialFrame) {
  const bar = document.createElement("div");
  bar.id = "scrub";

  const label = document.createElement("span");
  label.textContent = `frame ${initialFrame}`;

  const range = document.createElement("input");
  range.type = "range";
  range.min = "0";
  range.max = "0";
  range.value = String(initialFrame);

  const num = document.createElement("input");
  num.type = "number";
  num.min = "0";
  num.max = "0";
  num.value = String(initialFrame);

  fetch(`/frames/${encodeURIComponent(node.id)}`)
    .then((r) => r.json())
    .then((info) => {
      if (!info || typeof info.frames !== "number") return;
      const maxF = Math.max(0, info.frames - 1);
      range.max = String(maxF);
      num.max = String(maxF);
      label.textContent = `frame ${initialFrame} / ${info.frames}`;
    })
    .catch(() => void 0);

  const onFrameChange = (val) => {
    const frame = Number.parseInt(val, 10);
    const safeFrame = Number.isFinite(frame) ? Math.max(0, frame) : 0;
    currentFrame = safeFrame;
    range.value = String(safeFrame);
    num.value = String(safeFrame);
    label.textContent = `frame ${safeFrame}`;
    if (currentImg) {
      currentImg.src = `/preview/${encodeURIComponent(node.id)}?frame=${safeFrame}&v=${Date.now()}`;
    }
  };

  range.addEventListener("input", () => onFrameChange(range.value));
  num.addEventListener("change", () => onFrameChange(num.value));

  bar.appendChild(label);
  bar.appendChild(range);
  bar.appendChild(num);
  previewEl.appendChild(bar);
}

function updateOverlay(issues) {
  while (overlayEl.firstChild) overlayEl.removeChild(overlayEl.firstChild);
  if (!issues || issues.length === 0) {
    overlayEl.style.display = "none";
    return;
  }
  overlayEl.style.display = "block";

  const head = document.createElement("div");
  head.className = "ov-head";
  head.textContent = `Check: ${issues.length} issue(s)`;
  overlayEl.appendChild(head);

  for (const item of issues) {
    const itemEl = document.createElement("div");
    itemEl.className = item.severity === "warning" ? "ov-item warning" : "ov-item";

    const codeEl = document.createElement("span");
    codeEl.className = "ov-code";
    codeEl.textContent = `[${item.code || "CC"}]`;
    itemEl.appendChild(codeEl);

    const msgEl = document.createElement("div");
    msgEl.className = "ov-message";
    msgEl.textContent = item.message || String(item);
    itemEl.appendChild(msgEl);

    if (item.file) {
      const fileEl = document.createElement("div");
      fileEl.className = "ov-file";
      fileEl.textContent = item.line ? `${item.file}:${item.line}` : item.file;
      itemEl.appendChild(fileEl);
    }

    if (item.fixHint) {
      const fixEl = document.createElement("div");
      fixEl.className = "ov-fix";
      fixEl.textContent = `Fix: ${item.fixHint}`;
      itemEl.appendChild(fixEl);
    }

    overlayEl.appendChild(itemEl);
  }
}

function selectNode(node) {
  selectedNode = node;
  currentFrame = 0;
  staleNodes.delete(node.id);

  for (const el of listEl.querySelectorAll(".node")) {
    const isActive = el.getAttribute("data-id") === node.id;
    el.classList.toggle("active", isActive);
    if (isActive) el.classList.remove("stale");
  }

  renderNode(node, 0);
}

function buildNodeList() {
  while (listEl.firstChild) listEl.removeChild(listEl.firstChild);

  for (const node of nodes) {
    const el = document.createElement("div");
    el.className = "node";
    el.setAttribute("data-id", node.id);

    const kindEl = document.createElement("span");
    kindEl.className = "kind";
    kindEl.textContent = node.kind;

    const nameEl = document.createElement("span");
    nameEl.textContent = node.name;

    const dirtyEl = document.createElement("span");
    dirtyEl.className = "dirty";

    el.appendChild(kindEl);
    el.appendChild(nameEl);
    el.appendChild(dirtyEl);

    el.addEventListener("click", () => selectNode(node));
    listEl.appendChild(el);
  }

  if (nodes.length > 0 && !selectedNode) {
    selectNode(nodes[0]);
  }
}

function initListeners() {
  if (fitViewBtn) fitViewBtn.addEventListener("click", fitTransform);
  if (resetViewBtn) resetViewBtn.addEventListener("click", resetTransform);

  window.addEventListener("dblclick", () => resetTransform());

  window.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    panX = e.clientX - startX;
    panY = e.clientY - startY;
    applyTransform();
  });

  window.addEventListener("mouseup", () => {
    isDragging = false;
  });

  window.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "r") resetTransform();
    if (e.key.toLowerCase() === "f") fitTransform();
    if (e.key === "1") {
      zoomLevel = 1;
      panX = 0;
      panY = 0;
      applyTransform();
    }
  });
}

function connectWs() {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${proto}//${window.location.host}/ws`;
  const ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";

  ws.addEventListener("open", () => {
    dotEl.className = "on";
    statusTextEl.textContent = "connected";
  });

  ws.addEventListener("close", () => {
    dotEl.className = "";
    statusTextEl.textContent = "reconnecting…";
    setTimeout(connectWs, 1000);
  });

  ws.addEventListener("message", (event) => {
    if (event.data instanceof ArrayBuffer) {
      const view = new DataView(event.data);
      if (view.byteLength >= 20) {
        const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
        if (magic === "CCFR") {
          const frameIndex = view.getUint32(4);
          const width = view.getUint32(8);
          const height = view.getUint32(12);
          const format = view.getUint8(16);
          const blob = new Blob([new Uint8Array(event.data, 20)], { type: format === 1 ? "image/png" : "image/jpeg" });
          const blobUrl = URL.createObjectURL(blob);
          if (currentImg) {
            currentImg.src = blobUrl;
          }
          currentFrame = frameIndex;
          statusTextEl.textContent = `frame ${frameIndex} (${width}x${height})`;
          return;
        }
      }
    }
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "welcome" || msg.type === "hello") {
        nodes = Array.isArray(msg.nodes) ? msg.nodes : [];
        buildNodeList();
        if (msg.error) updateOverlay([{ code: "STARTUP", message: msg.error }]);
      } else if (msg.type === "status") {
        statusTextEl.textContent = `scale: ${msg.scale}x, cached: ${msg.cachedFrames}`;
      } else if (msg.type === "update") {
        statusTextEl.textContent = `updated ${new Date(msg.at || Date.now()).toLocaleTimeString()}`;
        if (selectedNode && selectedNode.id === msg.node) {
          renderNode(selectedNode, currentFrame);
        } else {
          staleNodes.add(msg.node);
          const el = listEl.querySelector(`[data-id="${msg.node}"]`);
          if (el) el.classList.add("stale");
        }
      } else if (msg.type === "error") {
        statusTextEl.textContent = `error: ${msg.message}`;
        dotEl.className = "err";
      } else if (msg.type === "validation") {
        const r = msg.report || {};
        const issues = (r.errors || []).concat(r.warnings || []);
        updateOverlay(issues);
        if (r.ok && issues.length === 0) {
          statusTextEl.textContent = "check passed";
          dotEl.className = "on";
        } else if (r.ok) {
          statusTextEl.textContent = `check: ${issues.length} warning(s)`;
        } else {
          statusTextEl.textContent = `check failed: ${(r.errors || []).length} error(s)`;
          dotEl.className = "err";
        }
      }
    } catch {
      // Non-JSON message ignored
    }
  });
}
      } else if (msg.type === "error") {
        statusTextEl.textContent = `error: ${msg.message}`;
        dotEl.className = "err";
      } else if (msg.type === "validation") {
        const r = msg.report || {};
        const issues = (r.errors || []).concat(r.warnings || []);
        updateOverlay(issues);
        if (r.ok && issues.length === 0) {
          statusTextEl.textContent = "check passed";
          dotEl.className = "on";
        } else if (r.ok) {
          statusTextEl.textContent = `check: ${issues.length} warning(s)`;
        } else {
          statusTextEl.textContent = `check failed: ${(r.errors || []).length} error(s)`;
          dotEl.className = "err";
        }
      }
    } catch {
      // Non-JSON message ignored
    }
  });
}

initListeners();
connectWs();

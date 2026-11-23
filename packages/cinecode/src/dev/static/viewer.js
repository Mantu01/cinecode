// Cinecode read-only viewer: textContent only, no transport controls
const listEl = document.getElementById("list");
const stageEl = document.getElementById("stage");
const frameEl = document.getElementById("frame");
const emptyEl = document.getElementById("empty-state");
const dotEl = document.getElementById("dot");
const statusTextEl = document.getElementById("statusText");
const retryBtn = document.getElementById("retry");
const fitBtn = document.getElementById("fitView");
const resetBtn = document.getElementById("resetView");

const MAX_RECONNECT = 8;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;

let nodes = [];
let selected = null;
let socket = null;
let reconnectAttempts = 0;
let retryTimer = null;
let latestRequest = 0;
let latestGeneration = -1;
let pendingFrame = null;
let objectUrl = null;
let zoom = 1;
let dragging = false;
let dragStart = { x: 0, y: 0 };
let dragMoved = false;
let orbit = { theta: 0, phi: 0 };
let state = { connection: "connecting", kind: "-", frame: 0, scale: null, cached: false };

function renderStatus() {
  const parts = [
    state.connection,
    `kind ${state.kind}`,
    `frame ${state.frame}`,
    `zoom ${zoom.toFixed(2)}x`,
    state.scale === null ? "scale -" : `scale ${state.scale}x`,
    state.cached ? "cached" : "live",
  ];
  statusTextEl.textContent = parts.join(" · ");
  dotEl.className = state.connection === "connected" ? "on" : state.connection.startsWith("reconnecting") ? "" : "err";
}

function applyZoom(next) {
  zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
  frameEl.style.transform = `scale(${zoom})`;
  renderStatus();
}

function fitView() {
  if (!frameEl.naturalWidth || !frameEl.naturalHeight) {
    applyZoom(1);
    return;
  }
  const box = stageEl.getBoundingClientRect();
  applyZoom(Math.min(box.width / frameEl.naturalWidth, box.height / frameEl.naturalHeight, 1));
}

function resetView() {
  orbit = { theta: 0, phi: 0 };
  applyZoom(1);
}

function selectNode(node) {
  selected = node;
  latestRequest += 1;
  latestGeneration = -1;
  pendingFrame = null;
  state.kind = node.kind;
  state.frame = 0;
  state.scale = null;
  state.cached = false;
  for (const el of listEl.children) {
    el.classList.toggle("active", el.getAttribute("data-id") === node.id);
  }
  resetView();
  frameEl.hidden = true;
  emptyEl.style.display = "block";
  sendMessage({ type: "select", node: node.id });
  renderStatus();
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
    el.appendChild(kindEl);
    el.appendChild(nameEl);
    el.addEventListener("click", () => selectNode(node));
    listEl.appendChild(el);
  }
  if (nodes.length > 0 && !selected) selectNode(nodes[0]);
}

function setFrame(blob) {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(blob);
  frameEl.src = objectUrl;
  frameEl.hidden = false;
  emptyEl.style.display = "none";
}

function handleBinary(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 20) return;
  if (view.getUint8(0) !== 0x43 || view.getUint8(1) !== 0x43 || view.getUint8(2) !== 0x46 || view.getUint8(3) !== 0x52) return;
  const message = pendingFrame;
  if (!message || !selected || message.node !== selected.id) return;
  if (message.generation < latestGeneration) return;
  const format = view.getUint8(16);
  const blob = new Blob([new Uint8Array(buffer, 20)], { type: format === 2 ? "image/jpeg" : "image/png" });
  setFrame(blob);
  state.frame = view.getUint32(4);
  state.scale = message.scale;
  state.cached = message.cached === true;
  renderStatus();
}

function handleJson(message) {
  if (message.type === "welcome") {
    nodes = Array.isArray(message.nodes) ? message.nodes : [];
    selected = null;
    buildNodeList();
  } else if (message.type === "frame") {
    if (!selected || message.node !== selected.id || message.generation < latestGeneration) return;
    latestGeneration = message.generation;
    pendingFrame = message;
  } else if (message.type === "preview:unavailable") {
    if (!selected || message.node !== selected.id) return;
    frameEl.hidden = true;
    emptyEl.style.display = "block";
    emptyEl.textContent = message.reason;
    state.frame = 0;
    renderStatus();
  } else if (message.type === "status") {
    state.scale = message.scale;
    renderStatus();
  } else if (message.type === "error") {
    state.connection = `error ${message.code ?? ""}`;
    statusTextEl.textContent = message.message;
    dotEl.className = "err";
  } else if (message.type === "validation") {
    const report = message.report || {};
    if (report.ok === false) {
      emptyEl.textContent = `Check failed: ${(report.errors || []).length} error(s)`;
      if (frameEl.hidden) emptyEl.style.display = "block";
    }
  }
}

function scheduleReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT) {
    state.connection = "disconnected";
    retryBtn.hidden = false;
    statusTextEl.textContent = `disconnected after ${MAX_RECONNECT} attempts`;
    dotEl.className = "err";
    return;
  }
  const delay = Math.min(30000, 500 * Math.pow(2, reconnectAttempts));
  reconnectAttempts += 1;
  state.connection = `reconnecting in ${Math.round(delay / 1000)}s`;
  retryBtn.hidden = true;
  renderStatus();
  retryTimer = setTimeout(connect, delay);
}

function connect() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
  ws.binaryType = "arraybuffer";
  socket = ws;

  ws.addEventListener("open", () => {
    reconnectAttempts = 0;
    state.connection = "connected";
    renderStatus();
  });
  ws.addEventListener("close", () => {
    if (socket !== ws) return;
    socket = null;
    scheduleReconnect();
  });
  ws.addEventListener("message", (event) => {
    if (event.data instanceof ArrayBuffer) {
      handleBinary(event.data);
      return;
    }
    try {
      handleJson(JSON.parse(event.data));
    } catch {
      statusTextEl.textContent = "malformed server message";
    }
  });
}

function sendMessage(message) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

let cameraTimer = null;

function sendCameraZoom() {
  if (cameraTimer) clearTimeout(cameraTimer);
  cameraTimer = setTimeout(() => sendMessage({ type: "camera:zoom", zoom }), 80);
}

frameEl.addEventListener("wheel", (event) => {
  event.preventDefault();
  const factor = event.deltaY < 0 ? 1.1 : 0.9;
  applyZoom(zoom * factor);
  if (selected && selected.kind === "3d") sendCameraZoom();
}, { passive: false });

frameEl.addEventListener("pointerdown", (event) => {
  if (!selected || selected.kind !== "3d" || event.button !== 0) return;
  dragging = true;
  dragMoved = false;
  dragStart = { x: event.clientX, y: event.clientY };
  frameEl.setPointerCapture(event.pointerId);
});

frameEl.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  const dx = event.clientX - dragStart.x;
  const dy = event.clientY - dragStart.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true;
});

frameEl.addEventListener("pointerup", (event) => {
  if (!dragging) return;
  dragging = false;
  const dx = event.clientX - dragStart.x;
  const dy = event.clientY - dragStart.y;
  if (!dragMoved) return;
  orbit = {
    theta: orbit.theta + dx * 0.01,
    phi: Math.max(-1.5, Math.min(1.5, orbit.phi + dy * 0.01)),
  };
  sendMessage({ type: "camera:orbit", theta: orbit.theta, phi: orbit.phi });
});

fitBtn.addEventListener("click", fitView);
resetBtn.addEventListener("click", resetView);
retryBtn.addEventListener("click", () => {
  reconnectAttempts = 0;
  state.connection = "connecting";
  connect();
});

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (key === "r") resetView();
  if (key === "f") fitView();
});

renderStatus();
connect();

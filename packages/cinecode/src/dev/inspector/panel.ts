export interface InspectorPanelOptions {
  readonly host: string;
  readonly port: number;
}

const INSPECTOR_CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; background: #0b0b0d; color: #e8e6e1; overflow: hidden; height: 100vh; }
  header { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-bottom: 1px solid #232227; background: #111114; }
  header b { color: #f5b544; letter-spacing: .08em; font-size: 13px; }
  .room-tag { background: #1e1e24; border: 1px solid #33333d; border-radius: 4px; padding: 2px 6px; font-size: 11px; color: #9f7aea; }
  #presence { display: flex; gap: 4px; align-items: center; }
  .user-badge { width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold; color: #000; }
  #status { margin-left: auto; font-size: 11px; color: #8a8781; }
  .top-btn { background: #1a1a1f; color: #e8e6e1; border: 1px solid #2e2e36; border-radius: 4px; padding: 3px 8px; cursor: pointer; font-size: 11px; }
  .top-btn:hover { background: #26262e; }
  .top-btn.active { background: #f5b544; color: #000; font-weight: bold; }

  main { display: grid; grid-template-columns: 1fr 340px; height: calc(100vh - 45px); }
  .stage { display: flex; flex-direction: column; min-width: 0; background: #08080a; position: relative; }
  .viewport { flex: 1; display: flex; align-items: center; justify-content: center; overflow: auto; padding: 16px; position: relative; }
  .frame-wrap { position: relative; line-height: 0; user-select: none; }
  #frame { max-width: 100%; max-height: 100%; background: #000; border: 1px solid #232227; border-radius: 6px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
  #diffFrame { position: absolute; top: 0; left: 0; width: 100%; height: 100%; mix-blend-mode: difference; display: none; opacity: 0.8; pointer-events: none; }
  #gizmoCanvas { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: auto; cursor: crosshair; }
  #hud { position: absolute; top: 12px; left: 12px; border-radius: 6px; display: none; box-shadow: 0 2px 10px rgba(0,0,0,0.6); pointer-events: none; }

  .controls { display: flex; align-items: center; gap: 6px; padding: 6px 14px 4px; background: #111114; border-top: 1px solid #232227; }
  .controls button { background: #1a1a1f; color: #e8e6e1; border: 1px solid #2c2c33; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 11px; }
  .controls button:hover { background: #26262e; }
  .controls select { background: #1a1a1f; color: #e8e6e1; border: 1px solid #2c2c33; border-radius: 4px; padding: 3px 6px; font-size: 11px; }
  .spacer { flex: 1; }

  .timeline { padding: 4px 14px 8px; background: #111114; }
  .timeline input[type=range] { width: 100%; accent-color: #f5b544; }
  .timeline .meta { display: flex; justify-content: space-between; font-size: 10px; color: #8a8781; }
  .loop-points { font-size: 10px; color: #f5b544; }

  aside { border-left: 1px solid #232227; background: #0e0e11; display: flex; flex-direction: column; overflow: hidden; }
  .tab-bar { display: flex; border-bottom: 1px solid #232227; background: #141418; }
  .tab-btn { flex: 1; padding: 8px 4px; background: transparent; border: none; color: #8a8781; cursor: pointer; font-size: 11px; border-bottom: 2px solid transparent; }
  .tab-btn.active { color: #f5b544; border-bottom-color: #f5b544; background: #17171d; font-weight: bold; }
  .tab-content { flex: 1; overflow-y: auto; padding: 12px; display: none; }
  .tab-content.active { display: block; }

  h3 { margin: 12px 0 6px; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: #8a8781; }
  .prop-group { background: #141418; border: 1px solid #232227; border-radius: 6px; padding: 8px; margin-bottom: 8px; }
  .prop-row { display: flex; align-items: center; justify-content: space-between; margin: 4px 0; }
  .prop-row label { font-size: 11px; color: #a0a0a8; }
  .prop-row input[type=number], .prop-row input[type=text], .prop-row select { width: 110px; background: #1a1a20; color: #e8e6e1; border: 1px solid #2e2e38; border-radius: 4px; padding: 2px 6px; font-size: 11px; }
  .prop-row input[type=color] { border: none; width: 32px; height: 22px; cursor: pointer; background: transparent; }
  .prop-row input[type=range] { width: 100px; accent-color: #f5b544; }

  .track-item { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 4px; }
  .track-item:hover { background: #1a1a20; }
  .track-item small { color: #6f6c66; margin-left: auto; }

  .net-log { font-size: 10px; font-family: monospace; max-height: 300px; overflow-y: auto; border: 1px solid #232227; border-radius: 4px; background: #070709; padding: 4px; }
  .net-entry { padding: 2px 4px; border-bottom: 1px solid #141418; cursor: pointer; display: flex; justify-content: space-between; }
  .net-entry:hover { background: #16161c; }
  .net-entry.error { color: #fc8181; }

  .history-list { font-size: 11px; max-height: 180px; overflow-y: auto; border: 1px solid #232227; border-radius: 4px; background: #070709; padding: 4px; }
  .history-item { padding: 3px 6px; cursor: pointer; border-radius: 3px; }
  .history-item:hover { background: #1a1a20; }
  .history-item.active { background: #2b2512; color: #f5b544; }

  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: none; align-items: center; justify-content: center; z-index: 100; }
  .modal-box { background: #141418; border: 1px solid #33333d; border-radius: 8px; width: 440px; max-width: 90vw; padding: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.8); }
  .modal-box h2 { margin: 0 0 12px; font-size: 14px; color: #f5b544; }
  .modal-box table { width: 100%; border-collapse: collapse; font-size: 11px; }
  .modal-box td { padding: 4px 6px; border-bottom: 1px solid #22222a; }
  .modal-box kbd { background: #22222a; border: 1px solid #3a3a46; border-radius: 3px; padding: 1px 4px; color: #f5b544; font-size: 10px; }
`;

const INSPECTOR_JS = `
  const HOST = "__HOST__";
  const PORT = "__PORT__";
  const urlParams = new URLSearchParams(window.location.search);
  const roomName = urlParams.get("room") || "default";
  const userName = urlParams.get("user") || "User " + Math.floor(Math.random() * 1000);

  const state = {
    node: null,
    frame: 0,
    total: 1,
    fps: 30,
    playing: false,
    shuttleSpeed: 1,
    loop: true,
    inPoint: 0,
    outPoint: 0,
    hidden: new Set(),
    selectedClipId: null,
    viewMode: "single",
    differenceMode: false,
    isHostMode: false,
    renderMs: 0,
    lastFrameAt: 0,
    history: [],
    historyIndex: -1,
    netLogs: [],
    selectedClipProps: { x: 960, y: 540, scale: 1, rotation: 0, opacity: 1, speed: 1, color: "#ffffff" },
  };

  const frameEl = document.getElementById("frame");
  const diffFrame = document.getElementById("diffFrame");
  const gizmoCanvas = document.getElementById("gizmoCanvas");
  const gizmoCtx = gizmoCanvas.getContext("2d");
  const hud = document.getElementById("hud");
  const hudCtx = hud.getContext("2d");
  const status = document.getElementById("status");
  const range = document.getElementById("scrub");
  const num = document.getElementById("frameNumber");
  const timeEl = document.getElementById("time");
  const loopPointsEl = document.getElementById("loopPoints");
  const presenceEl = document.getElementById("presence");
  const netLogEl = document.getElementById("netLog");
  const historyListEl = document.getElementById("historyList");
  const payloadViewer = document.getElementById("payloadViewer");
  const latencyBadge = document.getElementById("latencyBadge");

  let ws = null;
  let metricsTimer = null;
  let lastPingTime = 0;
  let isDraggingGizmo = false;
  let dragHandle = null;
  let dragStart = { x: 0, y: 0 };

  function connect() {
    status.textContent = "connecting…";
    ws = new WebSocket("ws://" + HOST + ":" + PORT + "/hmr?room=" + encodeURIComponent(roomName) + "&user=" + encodeURIComponent(userName));
    ws.onopen = () => {
      status.textContent = "connected (" + roomName + ")";
      logEvent("ws:open", "Connected to room: " + roomName);
      ws.send(JSON.stringify({ type: "room:join", room: roomName, user: userName }));
    };
    ws.onclose = () => {
      status.textContent = "disconnected (reconnecting…)";
      logEvent("ws:close", "Connection lost");
      setTimeout(connect, 1000);
    };
    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      try {
        const msg = JSON.parse(event.data);
        logEvent(msg.type, msg);
        handleMessage(msg);
      } catch (e) {
        logEvent("error", event.data);
      }
    };
  }

  function logEvent(type, payload) {
    const time = new Date().toISOString().substring(11, 19);
    const size = typeof payload === "string" ? payload.length : JSON.stringify(payload).length;
    const item = { time, type, size, payload };
    state.netLogs.unshift(item);
    if (state.netLogs.length > 50) state.netLogs.pop();
    renderNetLogs();
  }

  function renderNetLogs() {
    if (!netLogEl) return;
    netLogEl.innerHTML = "";
    for (const log of state.netLogs) {
      const row = document.createElement("div");
      row.className = "net-entry" + (log.type === "error" ? " error" : "");
      row.innerHTML = "<span>" + log.time + " " + log.type + "</span><span style='color:#6f6c66'>" + log.size + "b</span>";
      row.onclick = () => {
        if (payloadViewer) payloadViewer.textContent = JSON.stringify(log.payload, null, 2);
      };
      netLogEl.appendChild(row);
    }
  }

  function handleMessage(msg) {
    if (msg.type === "hello") {
      loadNodes(msg.nodes);
    } else if (msg.type === "frame") {
      onFrame(msg);
    } else if (msg.type === "room:user_joined" || msg.type === "room:user_left") {
      updatePresence(msg.presence || []);
    } else if (msg.type === "room:host_update") {
      if (!state.isHostMode && msg.playhead !== undefined) {
        requestFrame(msg.playhead);
      }
    } else if (msg.type === "clip:updated") {
      if (msg.clipId === state.selectedClipId) {
        state.selectedClipProps[msg.propertyPath] = msg.value;
        syncInspectorInputs();
        requestFrame(state.frame);
      }
    }
  }

  function updatePresence(users) {
    if (!presenceEl) return;
    presenceEl.innerHTML = "";
    for (const u of users) {
      const b = document.createElement("div");
      b.className = "user-badge";
      b.style.backgroundColor = u.color || "#48bb78";
      b.textContent = (u.name || "U").substring(0, 2).toUpperCase();
      b.title = u.name + (u.isHost ? " (Host)" : "");
      presenceEl.appendChild(b);
    }
  }

  function loadNodes(nodes) {
    const select = document.getElementById("nodes");
    select.innerHTML = "";
    const playable = nodes.filter((node) => node.kind === "scene" || node.kind === "timeline");
    for (const node of playable) {
      const opt = document.createElement("option");
      opt.value = node.id;
      opt.textContent = node.kind + " · " + node.name;
      select.appendChild(opt);
    }
    select.onchange = () => selectNode(playable.find((n) => n.id === select.value));
    if (playable.length > 0) selectNode(playable[0]);
  }

  function selectNode(node) {
    state.node = node || null;
    state.frame = 0;
    state.hidden.clear();
    if (!state.node) return;
    fetch("/composition/" + encodeURIComponent(state.node.id))
      .then((r) => r.json())
      .then((comp) => {
        state.total = Math.max(1, comp.frames || 1);
        state.fps = comp.fps || 30;
        state.inPoint = 0;
        state.outPoint = state.total - 1;
        range.max = String(state.total - 1);
        num.max = String(state.total - 1);
        updateLoopPointsDisplay();
        requestFrame(0);
      });
  }

  function requestFrame(targetFrame) {
    if (!ws || ws.readyState !== 1 || !state.node) return;
    const start = state.inPoint;
    const end = state.outPoint || state.total - 1;
    let next = targetFrame;
    if (next > end) next = state.loop ? start : end;
    if (next < start) next = start;
    state.frame = Math.max(0, Math.min(state.total - 1, Math.round(next)));
    range.value = String(state.frame);
    num.value = String(state.frame);
    lastPingTime = performance.now();
    ws.send(JSON.stringify({ type: "preview:frame", node: state.node.id, frame: state.frame, hidden: [...state.hidden] }));

    if (state.isHostMode) {
      ws.send(JSON.stringify({ type: "room:sync_host", playhead: state.frame, selection: state.selectedClipId }));
    }
  }

  function onFrame(msg) {
    const rtt = Math.round(performance.now() - lastPingTime);
    if (latencyBadge) latencyBadge.textContent = rtt + "ms RTT";
    state.renderMs = msg.renderMs || 0;
    state.lastFrameAt = performance.now();
    frameEl.src = msg.dataUrl;
    timeEl.textContent = (msg.frame / state.fps).toFixed(2) + "s / " + (msg.totalFrames / state.fps).toFixed(2) + "s";
    drawGizmo();

    if (state.playing) {
      const step = state.shuttleSpeed;
      requestFrame(state.frame + step);
    }
  }

  function setPlaying(play, speed = 1) {
    state.playing = play;
    state.shuttleSpeed = speed;
    const btn = document.getElementById("play");
    if (btn) btn.textContent = play ? (speed !== 1 ? speed + "x" : "pause") : "play";
    if (play) requestFrame(state.frame);
  }

  function updateLoopPointsDisplay() {
    if (!loopPointsEl) return;
    loopPointsEl.textContent = "Loop [" + state.inPoint + " - " + state.outPoint + "]";
  }

  function pushHistory(name, undoFn, redoFn) {
    state.history = state.history.slice(0, state.historyIndex + 1);
    state.history.push({ name, undoFn, redoFn });
    state.historyIndex++;
    renderHistory();
  }

  function undo() {
    if (state.historyIndex >= 0) {
      const item = state.history[state.historyIndex];
      item.undoFn();
      state.historyIndex--;
      renderHistory();
    }
  }

  function redo() {
    if (state.historyIndex + 1 < state.history.length) {
      state.historyIndex++;
      const item = state.history[state.historyIndex];
      item.redoFn();
      renderHistory();
    }
  }

  function renderHistory() {
    if (!historyListEl) return;
    historyListEl.innerHTML = "";
    state.history.forEach((h, idx) => {
      const div = document.createElement("div");
      div.className = "history-item" + (idx === state.historyIndex ? " active" : "");
      div.textContent = (idx + 1) + ". " + h.name;
      div.onclick = () => {
        while (state.historyIndex > idx) undo();
        while (state.historyIndex < idx) redo();
      };
      historyListEl.appendChild(div);
    });
  }

  function drawGizmo() {
    if (!gizmoCanvas) return;
    const rect = frameEl.getBoundingClientRect();
    gizmoCanvas.width = rect.width;
    gizmoCanvas.height = rect.height;
    gizmoCtx.clearRect(0, 0, gizmoCanvas.width, gizmoCanvas.height);

    if (!state.selectedClipId) return;

    const scaleX = rect.width / 1920;
    const scaleY = rect.height / 1080;
    const cx = state.selectedClipProps.x * scaleX;
    const cy = state.selectedClipProps.y * scaleY;
    const boxW = 200 * (state.selectedClipProps.scale || 1) * scaleX;
    const boxH = 120 * (state.selectedClipProps.scale || 1) * scaleY;

    gizmoCtx.save();
    gizmoCtx.translate(cx, cy);
    gizmoCtx.rotate(((state.selectedClipProps.rotation || 0) * Math.PI) / 180);

    gizmoCtx.strokeStyle = "#f5b544";
    gizmoCtx.lineWidth = 2;
    gizmoCtx.strokeRect(-boxW / 2, -boxH / 2, boxW, boxH);

    gizmoCtx.fillStyle = "#ffffff";
    const handles = [
      { x: -boxW / 2, y: -boxH / 2 },
      { x: boxW / 2, y: -boxH / 2 },
      { x: boxW / 2, y: boxH / 2 },
      { x: -boxW / 2, y: boxH / 2 },
      { x: 0, y: -boxH / 2 - 20, rot: true },
    ];
    for (const h of handles) {
      gizmoCtx.beginPath();
      gizmoCtx.arc(h.x, h.y, h.rot ? 5 : 4, 0, Math.PI * 2);
      gizmoCtx.fill();
      gizmoCtx.stroke();
    }
    gizmoCtx.restore();
  }

  gizmoCanvas.onmousedown = (e) => {
    state.selectedClipId = state.selectedClipId || "clip_0";
    isDraggingGizmo = true;
    dragStart = { x: e.offsetX, y: e.offsetY };
    drawGizmo();
  };

  window.onmousemove = (e) => {
    if (!isDraggingGizmo) return;
    const rect = frameEl.getBoundingClientRect();
    const dx = (e.clientX - dragStart.x) * (1920 / rect.width);
    const dy = (e.clientY - dragStart.y) * (1080 / rect.height);
    const oldX = state.selectedClipProps.x;
    const oldY = state.selectedClipProps.y;
    state.selectedClipProps.x += dx * 0.05;
    state.selectedClipProps.y += dy * 0.05;
    syncInspectorInputs();
    drawGizmo();
  };

  window.onmouseup = () => {
    if (isDraggingGizmo) {
      isDraggingGizmo = false;
      dispatchClipUpdate("x", state.selectedClipProps.x);
      dispatchClipUpdate("y", state.selectedClipProps.y);
    }
  };

  function dispatchClipUpdate(prop, value) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({
      type: "clip:update",
      clipId: state.selectedClipId || "clip_0",
      propertyPath: prop,
      value: value,
    }));
  }

  function syncInspectorInputs() {
    const propX = document.getElementById("propX");
    const propY = document.getElementById("propY");
    const propScale = document.getElementById("propScale");
    const propRot = document.getElementById("propRot");
    const propOpacity = document.getElementById("propOpacity");
    if (propX) propX.value = Math.round(state.selectedClipProps.x);
    if (propY) propY.value = Math.round(state.selectedClipProps.y);
    if (propScale) propScale.value = (state.selectedClipProps.scale || 1).toFixed(2);
    if (propRot) propRot.value = Math.round(state.selectedClipProps.rotation || 0);
    if (propOpacity) propOpacity.value = state.selectedClipProps.opacity || 1;
  }

  function drawHud() {
    if (!hudCtx) return;
    hud.width = 200;
    hud.height = 140;
    hudCtx.fillStyle = "rgba(10, 10, 14, 0.82)";
    hudCtx.fillRect(0, 0, hud.width, hud.height);

    const fps = state.renderMs > 0 ? 1000 / state.renderMs : 60;
    hudCtx.fillStyle = fps >= 55 ? "#48bb78" : fps >= 30 ? "#ecc94b" : "#f56565";
    hudCtx.font = "bold 12px monospace";
    hudCtx.fillText("FPS: " + fps.toFixed(1), 10, 20);

    hudCtx.fillStyle = "#a0a0a8";
    hudCtx.font = "10px monospace";
    hudCtx.fillText("Render: " + state.renderMs.toFixed(1) + "ms", 10, 40);
    hudCtx.fillText("Frame: #" + state.frame + " / " + state.total, 10, 58);
    hudCtx.fillText("Shuttle: " + state.shuttleSpeed + "x", 10, 76);
    hudCtx.fillText("Mode: " + state.viewMode, 10, 94);
    hudCtx.fillText("Room: " + roomName, 10, 112);
    hudCtx.fillText("Host Sync: " + (state.isHostMode ? "ON" : "OFF"), 10, 130);
  }

  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;

    if (e.key === " ") {
      e.preventDefault();
      setPlaying(!state.playing);
    } else if (e.key === "k" || e.key === "K") {
      setPlaying(false);
    } else if (e.key === "l" || e.key === "L") {
      const nextSpeed = state.playing && state.shuttleSpeed > 0 ? (state.shuttleSpeed >= 4 ? 1 : state.shuttleSpeed * 2) : 1;
      setPlaying(true, nextSpeed);
    } else if (e.key === "j" || e.key === "J") {
      const nextSpeed = state.playing && state.shuttleSpeed < 0 ? (state.shuttleSpeed <= -4 ? -1 : state.shuttleSpeed * 2) : -1;
      setPlaying(true, nextSpeed);
    } else if (e.key === "ArrowLeft") {
      setPlaying(false);
      requestFrame(state.frame - (e.shiftKey ? 10 : 1));
    } else if (e.key === "ArrowRight") {
      setPlaying(false);
      requestFrame(state.frame + (e.shiftKey ? 10 : 1));
    } else if (e.key === "Home") {
      requestFrame(0);
    } else if (e.key === "End") {
      requestFrame(state.total - 1);
    } else if (e.key === "i" || e.key === "I") {
      state.inPoint = state.frame;
      updateLoopPointsDisplay();
    } else if (e.key === "o" || e.key === "O") {
      state.outPoint = state.frame;
      updateLoopPointsDisplay();
    } else if (e.key === "f" || e.key === "F") {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen();
      else document.exitFullscreen();
    } else if (e.key === "r" || e.key === "R") {
      frameEl.style.transform = "none";
    } else if (e.key === "?") {
      const m = document.getElementById("shortcutModal");
      if (m) m.style.display = m.style.display === "flex" ? "none" : "flex";
    } else if (e.key === "p" && e.shiftKey) {
      hud.style.display = hud.style.display === "block" ? "none" : "block";
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
    }
  });

  window.switchTab = (tabId) => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    const btn = document.getElementById("tabBtn_" + tabId);
    const content = document.getElementById("tab_" + tabId);
    if (btn) btn.classList.add("active");
    if (content) content.classList.add("active");
  };

  window.exportStill = (format = "png") => {
    if (!state.node) return;
    window.open("/export-frame?node=" + encodeURIComponent(state.node.id) + "&frame=" + state.frame + "&format=" + format);
  };

  window.toggleHostMode = () => {
    state.isHostMode = !state.isHostMode;
    const btn = document.getElementById("hostBtn");
    if (btn) btn.classList.toggle("active", state.isHostMode);
  };

  window.toggleDifference = () => {
    state.differenceMode = !state.differenceMode;
    diffFrame.style.display = state.differenceMode ? "block" : "none";
  };

  window.persistCode = () => {
    fetch("/persist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clipId: state.selectedClipId, props: state.selectedClipProps }),
    }).then(() => alert("Saved properties to code!"));
  };

  range.oninput = () => { setPlaying(false); requestFrame(Number(range.value)); };
  num.oninput = () => { setPlaying(false); requestFrame(Number(num.value)); };
  document.getElementById("play").onclick = () => setPlaying(!state.playing);
  document.getElementById("prev").onclick = () => { setPlaying(false); requestFrame(state.frame - 1); };
  document.getElementById("next").onclick = () => { setPlaying(false); requestFrame(state.frame + 1); };
  document.getElementById("undoBtn").onclick = () => undo();
  document.getElementById("redoBtn").onclick = () => redo();

  metricsTimer = setInterval(drawHud, 500);
  connect();
`;

export function renderInspectorHtml(options: InspectorPanelOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Cinecode Studio Inspector</title>
<style>${INSPECTOR_CSS}</style>
</head>
<body>
<header>
  <b>CINECODE</b>
  <select id="nodes"></select>
  <span class="room-tag" id="roomTag">room: default</span>
  <div id="presence"></div>
  <button class="top-btn" id="hostBtn" onclick="toggleHostMode()">Host Follow</button>
  <button class="top-btn" id="diffBtn" onclick="toggleDifference()">Diff Mode</button>
  <span class="spacer"></span>
  <span id="latencyBadge" style="font-size:10px; color:#48bb78; margin-right:8px;">0ms RTT</span>
  <span id="status">connecting…</span>
  <button class="top-btn" onclick="document.getElementById('shortcutModal').style.display='flex'">?</button>
</header>
<main>
  <section class="stage">
    <div class="viewport">
      <div class="frame-wrap">
        <img id="frame" alt="preview" />
        <img id="diffFrame" alt="diff" />
        <canvas id="gizmoCanvas"></canvas>
        <canvas id="hud"></canvas>
      </div>
    </div>
    <div class="controls">
      <button id="prev" title="Step back 1 frame (Left)">◀</button>
      <button id="play" title="Play/Pause (Space)">play</button>
      <button id="next" title="Step forward 1 frame (Right)">▶</button>
      <button id="undoBtn" title="Undo (Ctrl+Z)">↶</button>
      <button id="redoBtn" title="Redo (Ctrl+Y)">↷</button>
      <span class="spacer"></span>
      <button onclick="exportStill('png')">PNG</button>
      <button onclick="exportStill('svg')">SVG</button>
      <input id="frameNumber" type="number" min="0" value="0" style="width:60px;" />
    </div>
    <div class="timeline">
      <input id="scrub" type="range" min="0" max="0" value="0" step="1" />
      <div class="meta">
        <span id="time">0.00s</span>
        <span class="loop-points" id="loopPoints">Loop [0 - 0]</span>
        <span>J/K/L Shuttle · I/O In-Out · Shift+P HUD</span>
      </div>
    </div>
  </section>
  <aside>
    <div class="tab-bar">
      <button class="tab-btn active" id="tabBtn_props" onclick="switchTab('props')">Inspector</button>
      <button class="tab-btn" id="tabBtn_comp" onclick="switchTab('comp')">Settings</button>
      <button class="tab-btn" id="tabBtn_net" onclick="switchTab('net')">Network</button>
      <button class="tab-btn" id="tabBtn_history" onclick="switchTab('history')">History</button>
    </div>

    <div class="tab-content active" id="tab_props">
      <h3>Selected Clip</h3>
      <div class="prop-group">
        <div class="prop-row"><label>Position X</label><input type="number" id="propX" value="960" /></div>
        <div class="prop-row"><label>Position Y</label><input type="number" id="propY" value="540" /></div>
        <div class="prop-row"><label>Scale</label><input type="number" id="propScale" step="0.05" value="1.0" /></div>
        <div class="prop-row"><label>Rotation</label><input type="number" id="propRot" value="0" /></div>
        <div class="prop-row"><label>Opacity</label><input type="range" id="propOpacity" min="0" max="1" step="0.01" value="1" /></div>
      </div>
      <button class="top-btn" style="width:100%; padding:6px; margin-top:8px;" onclick="persistCode()">Persist to Code</button>
    </div>

    <div class="tab-content" id="tab_comp">
      <h3>Composition</h3>
      <div class="prop-group">
        <div class="prop-row"><label>Preset</label>
          <select id="compPreset">
            <option>16:9 (1920x1080)</option>
            <option>9:16 (1080x1920)</option>
            <option>1:1 (1080x1080)</option>
            <option>4K (3840x2160)</option>
          </select>
        </div>
        <div class="prop-row"><label>FPS</label><input type="number" id="compFps" value="30" /></div>
        <div class="prop-row"><label>Background</label><input type="color" id="compBg" value="#000000" /></div>
      </div>
    </div>

    <div class="tab-content" id="tab_net">
      <h3>WebSocket Telemetry</h3>
      <div class="net-log" id="netLog"></div>
      <h3 style="margin-top:12px;">Payload</h3>
      <pre id="payloadViewer" style="font-size:10px; color:#a0a0a8; max-height:140px; overflow:auto;"></pre>
    </div>

    <div class="tab-content" id="tab_history">
      <h3>Undo Stack</h3>
      <div class="history-list" id="historyList"></div>
    </div>
  </aside>
</main>

<div class="modal-overlay" id="shortcutModal" onclick="this.style.display='none'">
  <div class="modal-box" onclick="event.stopPropagation()">
    <h2>Keyboard Shortcuts</h2>
    <table>
      <tr><td><kbd>Space</kbd></td><td>Play / Pause</td></tr>
      <tr><td><kbd>J</kbd> / <kbd>K</kbd> / <kbd>L</kbd></td><td>Shuttle Reverse / Pause / Forward (1x, 2x, 4x)</td></tr>
      <tr><td><kbd>←</kbd> / <kbd>→</kbd></td><td>Step 1 Frame</td></tr>
      <tr><td><kbd>Shift</kbd> + <kbd>←</kbd> / <kbd>→</kbd></td><td>Step 10 Frames</td></tr>
      <tr><td><kbd>I</kbd> / <kbd>O</kbd></td><td>Set In / Out Loop Points</td></tr>
      <tr><td><kbd>F</kbd></td><td>Toggle Fullscreen</td></tr>
      <tr><td><kbd>R</kbd></td><td>Reset Zoom / Fit</td></tr>
      <tr><td><kbd>Shift</kbd> + <kbd>P</kbd></td><td>Toggle Performance HUD</td></tr>
      <tr><td><kbd>Ctrl</kbd> + <kbd>Z</kbd> / <kbd>Y</kbd></td><td>Undo / Redo</td></tr>
      <tr><td><kbd>?</kbd></td><td>Open Shortcuts Modal</td></tr>
    </table>
    <button class="top-btn" style="width:100%; margin-top:12px;" onclick="document.getElementById('shortcutModal').style.display='none'">Close</button>
  </div>
</div>

<script>${INSPECTOR_JS.replace(/__HOST__/g, options.host).replace(/__PORT__/g, String(options.port))}</script>
</body>
</html>`;
}

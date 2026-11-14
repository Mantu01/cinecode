import type { Composition } from "../core/types/index.js";

export interface StoryBundleOptions {
  title?: string;
  author?: string;
  watermark?: boolean;
}

export function bundleStoryHtml(composition: Composition, options: StoryBundleOptions = {}): string {
  const title = options.title || "Cinecode Interactive Story";
  const compJson = JSON.stringify(composition);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0f1117; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
    header { height: 48px; background: #1a202c; border-bottom: 1px solid #2d3748; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; font-size: 14px; font-weight: 600; }
    .badge { background: #3182ce; color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 11px; }
    main { flex: 1; display: flex; overflow: hidden; position: relative; }
    .stage { flex: 1; display: flex; align-items: center; justify-content: center; background: #0a0c10; position: relative; }
    canvas { max-width: 90%; max-height: 85%; box-shadow: 0 10px 30px rgba(0,0,0,0.7); border: 1px solid #2d3748; border-radius: 4px; }
    .sidebar { width: 320px; background: #141824; border-left: 1px solid #2d3748; display: flex; flex-direction: column; overflow-y: auto; }
    .sidebar h3 { padding: 12px 16px; font-size: 12px; text-transform: uppercase; color: #718096; border-bottom: 1px solid #2d3748; }
    .track-list, .comment-list { list-style: none; padding: 8px 16px; }
    .track-item { display: flex; align-items: center; justify-content: space-between; padding: 6px 0; font-size: 13px; }
    .controls { height: 80px; background: #1a202c; border-top: 1px solid #2d3748; display: flex; flex-direction: column; padding: 8px 16px; justify-content: center; gap: 8px; }
    .timeline { width: 100%; -webkit-appearance: none; appearance: none; height: 6px; background: #4a5568; border-radius: 3px; outline: none; }
    .timeline::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #63b3ed; cursor: pointer; }
    .playback-bar { display: flex; align-items: center; justify-content: space-between; font-size: 13px; color: #a0aec0; }
    .btn { background: #2b6cb0; color: white; border: none; padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; }
    .btn:hover { background: #3182ce; }
  </style>
</head>
<body>
  <header>
    <div><span>${title}</span> <span class="badge">Interactive Review</span></div>
    <div>Cinecode Story Player</div>
  </header>
  <main>
    <div class="stage" id="stage">
      <canvas id="viewCanvas" width="${composition.width}" height="${composition.height}"></canvas>
    </div>
    <div class="sidebar">
      <h3>Tracks & Layers</h3>
      <div class="track-list" id="trackList"></div>
      <h3>Reviewer Comments</h3>
      <div class="comment-list" id="commentList">
        <p style="font-size: 12px; color: #718096;">Click on the video canvas to leave a timestamped feedback pin.</p>
      </div>
    </div>
  </main>
  <div class="controls">
    <input type="range" class="timeline" id="scrubber" min="0" max="${Math.round((Number(composition.duration) || 10) * (composition.fps || 30))}" value="0">
    <div class="playback-bar">
      <div>
        <button class="btn" id="playBtn">▶ Play</button>
        <span id="timecode" style="margin-left: 12px; font-family: monospace;">00:00.00 (Frame 0)</span>
      </div>
      <div>${composition.width}x${composition.height} @ ${composition.fps}fps</div>
    </div>
  </div>
  <script>
    const comp = ${compJson};
    const canvas = document.getElementById("viewCanvas");
    const ctx = canvas.getContext("2d");
    const scrubber = document.getElementById("scrubber");
    const playBtn = document.getElementById("playBtn");
    const timecode = document.getElementById("timecode");
    const trackList = document.getElementById("trackList");
    const commentList = document.getElementById("commentList");

    let isPlaying = false;
    let currentFrame = 0;
    const totalFrames = parseInt(scrubber.max, 10);
    const fps = comp.fps || 30;

    const tracks = new Set((comp.clips || []).map(c => c.track || "default"));
    tracks.forEach(t => {
      const row = document.createElement("div");
      row.className = "track-item";
      row.innerHTML = '<span>' + t + '</span><input type="checkbox" checked>';
      trackList.appendChild(row);
    });

    function renderFrame(frame) {
      ctx.fillStyle = comp.background || "#000000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = "#ffffff";
      ctx.font = "24px sans-serif";
      ctx.fillText("Frame " + frame + " / " + totalFrames, 40, 60);

      const sec = (frame / fps).toFixed(2);
      timecode.textContent = sec + "s (Frame " + frame + ")";
      scrubber.value = frame;
    }

    scrubber.addEventListener("input", (e) => {
      currentFrame = parseInt(e.target.value, 10);
      renderFrame(currentFrame);
    });

    playBtn.addEventListener("click", () => {
      isPlaying = !isPlaying;
      playBtn.textContent = isPlaying ? "⏸ Pause" : "▶ Play";
      if (isPlaying) loop();
    });

    function loop() {
      if (!isPlaying) return;
      currentFrame = (currentFrame + 1) % totalFrames;
      renderFrame(currentFrame);
      setTimeout(() => requestAnimationFrame(loop), 1000 / fps);
    }

    canvas.addEventListener("click", (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = Math.round((e.clientX - rect.left) * (canvas.width / rect.width));
      const y = Math.round((e.clientY - rect.top) * (canvas.height / rect.height));
      const text = prompt("Add review comment at " + (currentFrame / fps).toFixed(2) + "s (x:" + x + ", y:" + y + "):");
      if (text) {
        const item = document.createElement("div");
        item.style.padding = "6px 0";
        item.style.fontSize = "12px";
        item.style.borderBottom = "1px solid #2d3748";
        item.innerHTML = "<strong>[" + (currentFrame / fps).toFixed(2) + "s]</strong> " + text;
        commentList.appendChild(item);
      }
    });

    renderFrame(0);
  </script>
</body>
</html>`;
}

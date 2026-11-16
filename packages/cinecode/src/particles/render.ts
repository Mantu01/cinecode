import type { SKRSContext2D } from "@napi-rs/canvas";
import type { Particle, ParticleState } from "./types.js";

export interface ParticleRenderOptions {
  readonly speedBrightness?: boolean;
  readonly motionBlur?: boolean;
  readonly debugMode?: boolean;
  readonly viewport?: { readonly width: number; readonly height: number };
}

const DEBUG_VELOCITY_VECTOR_LIMIT = 50;
const DEBUG_EDGE_PROXIMITY = 10;

let lastDebugTimestamp = -1;
let smoothedDebugFps = 0;

function monotonicMs(): number {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

/** Renders particles onto the canvas; debug overlay only runs when options.debugMode is true. */
export function renderParticles(
  ctx: SKRSContext2D,
  state: ParticleState,
  blending: "additive" | "normal",
  options: ParticleRenderOptions = {},
): void {
  if (state.count === 0 && options.debugMode !== true) return;
  ctx.save();
  ctx.globalCompositeOperation = blending === "additive" ? "lighter" : "source-over";
  for (let i = 0; i < state.count; i += 1) {
    const particle = state.particles[i]!;
    if (particle.a <= 0 || particle.size <= 0) continue;
    if (particle.maxLife > 0 && particle.age > particle.maxLife) continue;
    const speed = Math.hypot(particle.vx, particle.vy);
    const boost = options.speedBrightness ? 1 + Math.min(0.8, speed / 800) : 1;
    const alpha = Math.min(1, particle.a * boost);
    const radius = (particle.size / 2) * (options.speedBrightness ? 1 + Math.min(0.4, speed / 2000) : 1);
    ctx.beginPath();
    ctx.fillStyle = `rgba(${Math.round(Math.min(255, particle.r * boost))}, ${Math.round(Math.min(255, particle.g * boost))}, ${Math.round(Math.min(255, particle.b * boost))}, ${alpha})`;
    ctx.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
    ctx.fill();
    if (options.motionBlur && speed > 80) {
      const trail = Math.min(6, speed / 120);
      ctx.beginPath();
      ctx.strokeStyle = `rgba(${Math.round(particle.r)}, ${Math.round(particle.g)}, ${Math.round(particle.b)}, ${alpha * 0.25})`;
      ctx.lineWidth = Math.max(1, radius * 0.8);
      ctx.moveTo(particle.x, particle.y);
      ctx.lineTo(particle.x - (particle.vx / speed) * trail, particle.y - (particle.vy / speed) * trail);
      ctx.stroke();
    }
  }
  ctx.restore();
  if (options.debugMode === true) drawDebugOverlay(ctx, state, options);
}

function drawDebugOverlay(ctx: SKRSContext2D, state: ParticleState, options: ParticleRenderOptions): void {
  const viewport = options.viewport;
  const width = viewport?.width ?? 0;
  const height = viewport?.height ?? 0;
  ctx.save();
  if (width > 0 && height > 0) {
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(255, 0, 0, 0.9)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
    ctx.setLineDash([]);
  }
  if (state.count <= DEBUG_VELOCITY_VECTOR_LIMIT) {
    drawVelocityVectors(ctx, state);
  }
  if (width > 0 && height > 0) {
    drawBoundaryGlow(ctx, state, width, height);
  }
  drawDebugHud(ctx, state);
  ctx.restore();
}

function drawVelocityVectors(ctx: SKRSContext2D, state: ParticleState): void {
  ctx.strokeStyle = "rgba(0, 255, 255, 0.85)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < state.count; i += 1) {
    const particle = state.particles[i]!;
    const speed = Math.hypot(particle.vx, particle.vy);
    if (speed < 0.0001) continue;
    const length = Math.min(30, 6 + speed / 40);
    ctx.moveTo(particle.x, particle.y);
    ctx.lineTo(particle.x + (particle.vx / speed) * length, particle.y + (particle.vy / speed) * length);
  }
  ctx.stroke();
}

function drawBoundaryGlow(ctx: SKRSContext2D, state: ParticleState, width: number, height: number): void {
  ctx.fillStyle = "rgba(255, 255, 0, 0.35)";
  for (let i = 0; i < state.count; i += 1) {
    const particle = state.particles[i]!;
    if (!nearEdge(particle, width, height)) continue;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function nearEdge(particle: Particle, width: number, height: number): boolean {
  const margin = DEBUG_EDGE_PROXIMITY + particle.size / 2;
  return (
    particle.x - particle.size / 2 <= DEBUG_EDGE_PROXIMITY
    || particle.x + particle.size / 2 >= width - DEBUG_EDGE_PROXIMITY
    || particle.y - particle.size / 2 <= DEBUG_EDGE_PROXIMITY
    || particle.y + particle.size / 2 >= height - DEBUG_EDGE_PROXIMITY
  ) && particle.x >= -margin && particle.x <= width + margin && particle.y >= -margin && particle.y <= height + margin;
}

function drawDebugHud(ctx: SKRSContext2D, state: ParticleState): void {
  const now = monotonicMs();
  if (lastDebugTimestamp >= 0) {
    const delta = now - lastDebugTimestamp;
    if (delta > 0) {
      const instant = 1000 / delta;
      smoothedDebugFps = smoothedDebugFps === 0 ? instant : smoothedDebugFps * 0.9 + instant * 0.1;
    }
  }
  lastDebugTimestamp = now;
  const fps = smoothedDebugFps > 0 ? Math.round(smoothedDebugFps) : 0;
  const text = `${fps} | ${state.count} particles`;
  ctx.globalCompositeOperation = "source-over";
  ctx.font = "12px monospace";
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  ctx.fillRect(4, 4, ctx.measureText(text).width + 8, 18);
  ctx.fillStyle = "rgba(0, 255, 0, 0.95)";
  ctx.fillText(text, 8, 7);
}

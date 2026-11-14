import type { SKRSContext2D } from "@napi-rs/canvas";
import type { ParticleState } from "./types.js";

export interface ParticleRenderOptions {
  readonly speedBrightness?: boolean;
  readonly motionBlur?: boolean;
}

export function renderParticles(
  ctx: SKRSContext2D,
  state: ParticleState,
  blending: "additive" | "normal",
  options: ParticleRenderOptions = {},
): void {
  if (state.count === 0) return;
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
}

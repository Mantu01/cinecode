import { simulateParticles } from "./emitter.js";
import { resolveParticleParticleCollisions } from "./physics.js";
import type { EmitterConfig, Particle, ParticleState } from "./types.js";
import { MAX_PARTICLES } from "./types.js";

export interface ParticleContext {
  readonly pool: Particle[];
  lastFrame: number;
}

export function createParticleContext(capacity: number = MAX_PARTICLES): ParticleContext {
  const size = Math.max(0, Math.min(MAX_PARTICLES, Math.floor(capacity)));
  const pool: Particle[] = new Array(size);
  for (let i = 0; i < size; i += 1) {
    pool[i] = { x: 0, y: 0, vx: 0, vy: 0, age: 0, maxLife: 0, size: 0, r: 0, g: 0, b: 0, a: 0, mass: 1 };
  }
  return { pool, lastFrame: -1 };
}

const contexts = new WeakMap<object, ParticleContext>();

export function getParticleContext(clip: object, frame: number): ParticleContext {
  let context = contexts.get(clip);
  if (context === undefined) {
    context = createParticleContext(MAX_PARTICLES);
    contexts.set(clip, context);
  }
  if (frame < context.lastFrame) {
    context.lastFrame = -1;
  }
  return context;
}

export function updateParticleContext(
  context: ParticleContext,
  elapsed: number,
  frame: number,
  config: EmitterConfig,
  bounds: { width: number; height: number },
): ParticleState {
  context.lastFrame = frame;
  const count = simulateParticles(config, elapsed, bounds, context.pool);
  if (config.physics?.particleCollision) {
    resolveParticleParticleCollisions(context.pool, count, {
      restitution: config.physics.restitution ?? 0.8,
    });
  }
  return { particles: context.pool, count };
}

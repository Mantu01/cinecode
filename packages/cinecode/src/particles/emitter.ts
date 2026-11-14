import { createRng } from "./random.js";
import { simulateParticlePath } from "./physics.js";
import type { EmitterConfig, Particle } from "./types.js";

const TWO_PI = Math.PI * 2;

export function simulateParticles(config: EmitterConfig, elapsed: number, bounds: { width: number; height: number }, pool: Particle[]): number {
  if (config.emitRate <= 0 || elapsed < 0) return 0;
  const interval = 1 / config.emitRate;
  const totalSpawned = Math.floor(elapsed / interval) + 1;
  const capacity = pool.length;
  const first = Math.max(0, totalSpawned - capacity);
  const count = Math.min(totalSpawned, capacity);
  const originX = bounds.width / 2;
  const originY = bounds.height / 2;
  let alive = 0;

  for (let slot = 0; slot < count; slot += 1) {
    const index = first + slot;
    const spawnTime = index * interval;
    const age = elapsed - spawnTime;
    if (age < 0 || age > config.lifetime) {
      continue;
    }
    const particle = pool[alive]!;
    alive += 1;
    configureParticle(particle, config, index, age, originX, originY);
  }
  return alive;
}

function configureParticle(particle: Particle, config: EmitterConfig, index: number, age: number, originX: number, originY: number): void {
  const rng = createRng(seedFor(config.seed, index));
  const lifeRatio = age / config.lifetime;
  let vx = 0;
  let vy = 0;
  if (config.velocity > 0) {
    const angle = rng() * TWO_PI;
    vx = Math.cos(angle) * config.velocity;
    vy = Math.sin(angle) * config.velocity;
  }
  let x = originX;
  let y = originY;
  if (config.emitterShape === "circle") {
    const radius = config.emitterRadius * Math.sqrt(rng());
    const angle = rng() * TWO_PI;
    x += Math.cos(angle) * radius;
    y += Math.sin(angle) * radius;
  } else if (config.emitterShape === "rectangle") {
    x += (rng() - 0.5) * config.emitterWidth;
    y += (rng() - 0.5) * config.emitterHeight;
  }
  if (config.physics) {
    const physics = config.physics;
    const startVelocity = { x: vx, y: vy };
    const path = simulateParticlePath({ x, y }, startVelocity, age, physics, seedFor(config.seed, index), particle);
    const hasLegacyGravity = config.gravity !== 0 && physics.gravity === undefined;
    particle.x = path.x;
    particle.y = path.y + (hasLegacyGravity ? 0.5 * config.gravity * age * age : 0);
    particle.vx = path.vx;
    particle.vy = path.vy + (hasLegacyGravity ? config.gravity * age : 0);
  } else {
    particle.x = x + vx * age;
    particle.y = y + vy * age + 0.5 * config.gravity * age * age;
    particle.vx = vx;
    particle.vy = vy + config.gravity * age;
  }
  particle.age = age;
  particle.maxLife = config.lifetime;
  particle.size = config.sizeStart + (config.sizeEnd - config.sizeStart) * lifeRatio;
  particle.r = config.colorStart.r + (config.colorEnd.r - config.colorStart.r) * lifeRatio;
  particle.g = config.colorStart.g + (config.colorEnd.g - config.colorStart.g) * lifeRatio;
  particle.b = config.colorStart.b + (config.colorEnd.b - config.colorStart.b) * lifeRatio;
  particle.a = config.colorStart.a * (1 - lifeRatio);
  particle.mass = 1;
}

function seedFor(seed: number, index: number): number {
  return (Math.imul(seed, 0x9e3779b1) ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0;
}

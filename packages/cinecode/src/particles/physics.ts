import { noise2d } from "../core/random/index.js";
import type {
  Particle,
  ParticleCollider,
  ParticleForce,
  ParticlePhysicsConfig,
  ParticleVector,
} from "./types.js";
import { resolveCollisions } from "./collision.js";

const DEFAULT_TIME_STEP = 1 / 60;
const DEFAULT_MAX_SPEED = 4000;
const MAX_SUBSTEPS = 240;

export function gravityVector(physics: ParticlePhysicsConfig): ParticleVector {
  const gravity = physics.gravity;
  if (gravity === undefined) return { x: 0, y: 0 };
  if (typeof gravity === "number") return { x: 0, y: gravity };
  return { x: gravity.x ?? 0, y: gravity.y ?? 0 };
}

function forceAcceleration(
  particle: Particle,
  force: ParticleForce,
  time: number,
  seed: number,
): ParticleVector {
  switch (force.type) {
    case "gravity":
      return { x: force.x ?? 0, y: force.y ?? 0 };
    case "wind": {
      const angle = ((force.directionDegrees ?? 0) * Math.PI) / 180;
      const turbulence = force.turbulence ?? 0;
      const noise = turbulence > 0
        ? noise2d(seed, particle.x * 0.005 + time * 0.3, particle.y * 0.005) * 2 - 1
        : 0;
      return {
        x: Math.cos(angle) * (force.speed ?? 0) + noise * turbulence,
        y: Math.sin(angle) * (force.speed ?? 0) + noise * turbulence * 0.6,
      };
    }
    case "attraction": {
      const dx = (force.x ?? 0) - particle.x;
      const dy = (force.y ?? 0) - particle.y;
      const distanceSquared = dx * dx + dy * dy + 1;
      const distance = Math.sqrt(distanceSquared);
      const strength = (force.strength ?? 100) / distanceSquared;
      return { x: (dx / distance) * strength, y: (dy / distance) * strength };
    }
    case "vortex": {
      const dx = particle.x - (force.x ?? 0);
      const dy = particle.y - (force.y ?? 0);
      const distance = Math.max(1, Math.hypot(dx, dy));
      const strength = (force.strength ?? 100) / distance;
      return { x: (-dy / distance) * strength, y: (dx / distance) * strength };
    }
    case "turbulence": {
      const magnitude = force.strength ?? 50;
      const scale = force.scale ?? 0.01;
      return {
        x: (noise2d(seed + 1, particle.x * scale + time * 0.5, particle.y * scale) * 2 - 1) * magnitude,
        y: (noise2d(seed + 2, particle.x * scale, particle.y * scale + time * 0.5) * 2 - 1) * magnitude,
      };
    }
    case "drag":
      return { x: 0, y: 0 };
    default:
      return { x: 0, y: 0 };
  }
}

export function stepParticle(
  particle: Particle,
  physics: ParticlePhysicsConfig,
  deltaTime: number,
  time: number,
  seed: number,
  colliders: readonly ParticleCollider[] = physics.colliders ?? [],
): void {
  const gravity = gravityVector(physics);
  let accelerationX = gravity.x;
  let accelerationY = gravity.y;
  for (const force of physics.forces ?? []) {
    const contribution = forceAcceleration(particle, force, time, seed);
    accelerationX += contribution.x;
    accelerationY += contribution.y;
  }

  const wind = physics.wind;
  if (wind) {
    const windForce: ParticleForce = { type: "wind", ...wind };
    const contribution = forceAcceleration(particle, windForce, time, seed);
    accelerationX += contribution.x;
    accelerationY += contribution.y;
  }

  const mass = Math.max(0.0001, particle.mass ?? 1);
  particle.vx += (accelerationX / mass) * deltaTime;
  particle.vy += (accelerationY / mass) * deltaTime;

  const drag = Math.max(0, Math.min(1, physics.drag ?? 0));
  if (drag > 0) {
    const damping = Math.exp(-drag * deltaTime * 4);
    particle.vx *= damping;
    particle.vy *= damping;
  }

  const maxSpeed = Math.max(1, physics.maxSpeed ?? DEFAULT_MAX_SPEED);
  const speed = Math.hypot(particle.vx, particle.vy);
  if (speed > maxSpeed) {
    particle.vx = (particle.vx / speed) * maxSpeed;
    particle.vy = (particle.vy / speed) * maxSpeed;
  }

  particle.x += particle.vx * deltaTime;
  particle.y += particle.vy * deltaTime;
  particle.ax = accelerationX;
  particle.ay = accelerationY;

  if (colliders.length > 0) {
    resolveCollisions(particle, colliders, physics.restitution ?? 0.6, physics.friction ?? 0.1);
  }
}

export interface SimulatedPath {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly collisions: number;
}

export function simulateParticlePath(
  start: ParticleVector,
  velocity: ParticleVector,
  age: number,
  physics: ParticlePhysicsConfig,
  seed: number,
  particle?: Particle,
): SimulatedPath {
  const timeStep = Math.max(0.001, physics.timeStep ?? DEFAULT_TIME_STEP);
  const steps = Math.max(1, Math.min(MAX_SUBSTEPS, Math.ceil(age / timeStep)));
  const deltaTime = age / steps;
  const working: Particle = particle ?? {
    x: start.x,
    y: start.y,
    vx: velocity.x,
    vy: velocity.y,
    age: 0,
    maxLife: 1,
    size: 1,
    r: 255,
    g: 255,
    b: 255,
    a: 1,
    mass: 1,
  };
  working.x = start.x;
  working.y = start.y;
  working.vx = velocity.x;
  working.vy = velocity.y;
  let collisions = 0;
  for (let step = 0; step < steps; step += 1) {
    stepParticle(working, physics, deltaTime, step * deltaTime, seed);
  }
  collisions += working.vx !== velocity.x || working.vy !== velocity.y ? 1 : 0;
  return { x: working.x, y: working.y, vx: working.vx, vy: working.vy, collisions };
}

export function resolveParticleParticleCollisions(
  particles: Particle[],
  count: number,
  options: { readonly radiusFactor?: number; readonly restitution?: number } = {},
): void {
  if (count < 2) return;
  const radiusFactor = options.radiusFactor ?? 0.6;
  const restitution = options.restitution ?? 0.8;
  const cellSize = 16;
  const grid = new Map<string, number[]>();
  for (let index = 0; index < count; index += 1) {
    const particle = particles[index]!;
    const key = `${Math.floor(particle.x / cellSize)},${Math.floor(particle.y / cellSize)}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(index);
    else grid.set(key, [index]);
  }

  for (let index = 0; index < count; index += 1) {
    const particle = particles[index]!;
    const cellX = Math.floor(particle.x / cellSize);
    const cellY = Math.floor(particle.y / cellSize);
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        const bucket = grid.get(`${cellX + offsetX},${cellY + offsetY}`);
        if (!bucket) continue;
        for (const otherIndex of bucket) {
          if (otherIndex <= index) continue;
          const other = particles[otherIndex]!;
          const dx = other.x - particle.x;
          const dy = other.y - particle.y;
          const distance = Math.hypot(dx, dy);
          const minimum = (particle.size + other.size) * 0.5 * radiusFactor;
          if (distance <= 0.0001 || distance >= minimum) continue;
          const nx = dx / distance;
          const ny = dy / distance;
          const overlap = (minimum - distance) / 2;
          particle.x -= nx * overlap;
          particle.y -= ny * overlap;
          other.x += nx * overlap;
          other.y += ny * overlap;
          const relativeVelocity = (other.vx - particle.vx) * nx + (other.vy - particle.vy) * ny;
          if (relativeVelocity > 0) continue;
          const impulse = -relativeVelocity * restitution;
          particle.vx -= nx * impulse;
          particle.vy -= ny * impulse;
          other.vx += nx * impulse;
          other.vy += ny * impulse;
        }
      }
    }
  }
}

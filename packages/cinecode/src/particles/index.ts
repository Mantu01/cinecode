export { createRng } from "./random.js";
export { simulateParticles } from "./emitter.js";
export {
  createParticleContext,
  getParticleContext,
  updateParticleContext,
  type ParticleContext,
} from "./context.js";
export { renderParticles, type ParticleRenderOptions } from "./render.js";
export * from "./physics.js";
export * from "./collision.js";
export {
  resolveEmitterConfig,
  MAX_PARTICLES,
  type EmitterConfig,
  type Particle,
  type ParticleState,
  type ParticleVector,
  type ParticleForce,
  type ParticleCollider,
  type ParticlePhysicsConfig,
  type GravityForceConfig,
  type WindForceConfig,
  type AttractionForceConfig,
  type VortexForceConfig,
  type TurbulenceForceConfig,
  type BoxColliderConfig,
  type CircleColliderConfig,
  type LineColliderConfig,
  type PolygonColliderConfig,
} from "./types.js";

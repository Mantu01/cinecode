import type { Particle, ParticleCollider, ParticleVector } from "./types.js";

export interface CollisionContact {
  readonly normal: ParticleVector;
  readonly penetration: number;
  readonly collider: ParticleCollider;
}

function boxContact(particle: Particle, collider: Extract<ParticleCollider, { type: "box" }>): CollisionContact | null {
  const radius = particle.size / 2;
  const left = collider.x + radius;
  const right = collider.x + collider.width - radius;
  const top = collider.y + radius;
  const bottom = collider.y + collider.height - radius;
  if (particle.x < left) return { normal: { x: 1, y: 0 }, penetration: left - particle.x, collider };
  if (particle.x > right) return { normal: { x: -1, y: 0 }, penetration: particle.x - right, collider };
  if (particle.y < top) return { normal: { x: 0, y: 1 }, penetration: top - particle.y, collider };
  if (particle.y > bottom) return { normal: { x: 0, y: -1 }, penetration: particle.y - bottom, collider };
  return null;
}

function circleContact(particle: Particle, collider: Extract<ParticleCollider, { type: "circle" }>): CollisionContact | null {
  const radius = particle.size / 2;
  const dx = particle.x - collider.x;
  const dy = particle.y - collider.y;
  const distance = Math.hypot(dx, dy);
  const maximum = collider.radius - radius;
  if (distance <= maximum) return null;
  if (distance < 0.0001) return { normal: { x: 1, y: 0 }, penetration: maximum, collider };
  return {
    normal: { x: -dx / distance, y: -dy / distance },
    penetration: distance - maximum,
    collider,
  };
}

function lineContact(particle: Particle, collider: Extract<ParticleCollider, { type: "line" }>): CollisionContact | null {
  const radius = particle.size / 2;
  const normalLength = Math.hypot(collider.normal.x, collider.normal.y) || 1;
  const nx = collider.normal.x / normalLength;
  const ny = collider.normal.y / normalLength;
  const signed = (particle.x - collider.x) * nx + (particle.y - collider.y) * ny;
  if (signed >= radius) return null;
  return { normal: { x: nx, y: ny }, penetration: radius - signed, collider };
}

function pointInPolygon(x: number, y: number, points: readonly ParticleVector[]): boolean {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const currentPoint = points[index]!;
    const previousPoint = points[previous]!;
    const intersects = (currentPoint.y > y) !== (previousPoint.y > y)
      && x < ((previousPoint.x - currentPoint.x) * (y - currentPoint.y)) / (previousPoint.y - currentPoint.y || 1e-6) + currentPoint.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function polygonContact(particle: Particle, collider: Extract<ParticleCollider, { type: "polygon" }>): CollisionContact | null {
  const points = collider.points;
  if (points.length < 3) return null;
  const radius = particle.size / 2;
  let contact: CollisionContact | null = null;
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index]!;
    const end = points[(index + 1) % points.length]!;
    const edgeX = end.x - start.x;
    const edgeY = end.y - start.y;
    const length = Math.hypot(edgeX, edgeY) || 1;
    let normalX = -edgeY / length;
    let normalY = edgeX / length;
    const middleX = (start.x + end.x) / 2;
    const middleY = (start.y + end.y) / 2;
    const centroidX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
    const centroidY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
    if ((middleX - centroidX) * normalX + (middleY - centroidY) * normalY < 0) {
      normalX = -normalX;
      normalY = -normalY;
    }
    const signed = (particle.x - start.x) * normalX + (particle.y - start.y) * normalY;
    if (signed >= radius) continue;
    const inside = pointInPolygon(particle.x, particle.y, points);
    if (!inside) continue;
    const candidate: CollisionContact = {
      normal: { x: -normalX, y: -normalY },
      penetration: radius - signed,
      collider,
    };
    if (!contact || candidate.penetration > contact.penetration) contact = candidate;
  }
  return contact;
}

export function detectCollision(particle: Particle, collider: ParticleCollider): CollisionContact | null {
  switch (collider.type) {
    case "box":
      return boxContact(particle, collider);
    case "circle":
      return circleContact(particle, collider);
    case "line":
      return lineContact(particle, collider);
    case "polygon":
      return polygonContact(particle, collider);
    default:
      return null;
  }
}

export function resolveCollisions(
  particle: Particle,
  colliders: readonly ParticleCollider[],
  restitution = 0.6,
  friction = 0.1,
): number {
  let contacts = 0;
  for (const collider of colliders) {
    const contact = detectCollision(particle, collider);
    if (!contact) continue;
    contacts += 1;
    particle.x += contact.normal.x * contact.penetration;
    particle.y += contact.normal.y * contact.penetration;
    const velocityAlongNormal = particle.vx * contact.normal.x + particle.vy * contact.normal.y;
    if (velocityAlongNormal < 0) {
      particle.vx -= (1 + restitution) * velocityAlongNormal * contact.normal.x;
      particle.vy -= (1 + restitution) * velocityAlongNormal * contact.normal.y;
      const tangentX = particle.vx - (particle.vx * contact.normal.x + particle.vy * contact.normal.y) * contact.normal.x;
      const tangentY = particle.vy - (particle.vx * contact.normal.x + particle.vy * contact.normal.y) * contact.normal.y;
      particle.vx -= tangentX * friction;
      particle.vy -= tangentY * friction;
    }
  }
  return contacts;
}

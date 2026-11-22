import type { SKRSContext2D } from "@napi-rs/canvas";
import type { Vec3 } from "./sdf.js";
import { vec3Length, vec3Sub, vec3Add } from "./sdf.js";

export type SDFEvaluator = (p: Vec3) => number;

export interface RaymarchOptions {
  maxSteps?: number;
  epsilon?: number;
  maxDistance?: number;
  cameraPosition?: Vec3;
  cameraTarget?: Vec3;
  cameraUp?: Vec3;
  fov?: number;
  lightPosition?: Vec3;
  lightColor?: Vec3;
  ambientColor?: Vec3;
  fogColor?: Vec3;
  fogDensity?: number;
  aoSteps?: number;
  aoDelta?: number;
}

export interface RaymarchHit {
  hit: boolean;
  distance: number;
  steps: number;
  point: Vec3;
  normal: Vec3;
  ao: number;
}

export function computeNormal(p: Vec3, sdf: SDFEvaluator, eps = 0.001): Vec3 {
  const k: [number, number, number][] = [
    [1, -1, -1],
    [-1, -1, 1],
    [-1, 1, -1],
    [1, 1, 1],
  ];

  let nx = 0;
  let ny = 0;
  let nz = 0;

  for (let i = 0; i < 4; i++) {
    const entry = k[i];
    if (!entry) continue;
    const [kx, ky, kz] = entry;
    const samplePoint: Vec3 = [p[0] + kx * eps, p[1] + ky * eps, p[2] + kz * eps];
    const d = sdf(samplePoint);
    nx += kx * d;
    ny += ky * d;
    nz += kz * d;
  }

  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

export function computeAO(p: Vec3, normal: Vec3, sdf: SDFEvaluator, steps = 5, delta = 0.05): number {
  let occ = 0;
  let weight = 0.5;

  for (let i = 1; i <= steps; i++) {
    const d = i * delta;
    const samplePos: Vec3 = [
      p[0] + normal[0] * d,
      p[1] + normal[1] * d,
      p[2] + normal[2] * d,
    ];
    const dist = sdf(samplePos);
    occ += (d - dist) * weight;
    weight *= 0.5;
  }

  return Math.max(0, Math.min(1, 1.0 - occ * 2.0));
}

export function sphereTrace(
  ro: Vec3,
  rd: Vec3,
  sdf: SDFEvaluator,
  options: RaymarchOptions = {},
): RaymarchHit {
  const maxSteps = options.maxSteps ?? 128;
  const eps = options.epsilon ?? 0.001;
  const maxDist = options.maxDistance ?? 50.0;

  let t = 0.01;
  let step = 0;

  for (; step < maxSteps; step++) {
    const p: Vec3 = [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t];
    const d = sdf(p);

    if (d < eps) {
      const normal = computeNormal(p, sdf, eps);
      const ao = computeAO(p, normal, sdf, options.aoSteps ?? 5, options.aoDelta ?? 0.05);
      return { hit: true, distance: t, steps: step, point: p, normal, ao };
    }

    t += d;
    if (t >= maxDist) break;
  }

  const farPoint: Vec3 = [ro[0] + rd[0] * maxDist, ro[1] + rd[1] * maxDist, ro[2] + rd[2] * maxDist];
  return { hit: false, distance: maxDist, steps: step, point: farPoint, normal: [0, 1, 0], ao: 1 };
}

export class RaymarchEngine {
  public static renderCPU(
    ctx: SKRSContext2D | CanvasRenderingContext2D,
    width: number,
    height: number,
    sdf: SDFEvaluator,
    options: RaymarchOptions = {},
  ): { depthBuffer: Float32Array } {
    const camPos = options.cameraPosition ?? [0, 1.5, 4];
    const camTarget = options.cameraTarget ?? [0, 0, 0];
    const camUp = options.cameraUp ?? [0, 1, 0];
    const fov = (options.fov ?? 45) * (Math.PI / 180);
    const lightPos = options.lightPosition ?? [2, 5, 3];
    const lightCol = options.lightColor ?? [1, 1, 1];
    const ambCol = options.ambientColor ?? [0.05, 0.05, 0.08];
    const fogCol = options.fogColor ?? [0.08, 0.08, 0.12];
    const fogDensity = options.fogDensity ?? 0.04;

    const fwd = vec3Sub(camTarget, camPos);
    const fwdLen = vec3Length(fwd) || 1;
    const fz: Vec3 = [fwd[0] / fwdLen, fwd[1] / fwdLen, fwd[2] / fwdLen];

    const rx = camUp[1] * fz[2] - camUp[2] * fz[1];
    const ry = camUp[2] * fz[0] - camUp[0] * fz[2];
    const rz = camUp[0] * fz[1] - camUp[1] * fz[0];
    const rLen = Math.hypot(rx, ry, rz) || 1;
    const fx: Vec3 = [rx / rLen, ry / rLen, rz / rLen];

    const fy: Vec3 = [
      fz[1] * fx[2] - fz[2] * fx[1],
      fz[2] * fx[0] - fz[0] * fx[2],
      fz[0] * fx[1] - fz[1] * fx[0],
    ];

    const tanHalfFov = Math.tan(fov * 0.5);
    const aspect = width / height;

    const img = ctx.createImageData(width, height);
    const data = img.data;
    const depthBuffer = new Float32Array(width * height);

    for (let y = 0; y < height; y++) {
      const v = (1.0 - (2.0 * (y + 0.5)) / height) * tanHalfFov;
      for (let x = 0; x < width; x++) {
        const u = ((2.0 * (x + 0.5)) / width - 1.0) * aspect * tanHalfFov;

        const rdx = fx[0] * u + fy[0] * v + fz[0];
        const rdy = fx[1] * u + fy[1] * v + fz[1];
        const rdz = fx[2] * u + fy[2] * v + fz[2];
        const rdLen = Math.hypot(rdx, rdy, rdz) || 1;
        const rd: Vec3 = [rdx / rdLen, rdy / rdLen, rdz / rdLen];

        const hit = sphereTrace(camPos, rd, sdf, options);
        const pixelIdx = (y * width + x) * 4;
        depthBuffer[y * width + x] = hit.distance;

        if (hit.hit) {
          const lVec = vec3Sub(lightPos, hit.point);
          const lDist = vec3Length(lVec) || 1;
          const lDir: Vec3 = [lVec[0] / lDist, lVec[1] / lDist, lVec[2] / lDist];

          const diff = Math.max(0, hit.normal[0] * lDir[0] + hit.normal[1] * lDir[1] + hit.normal[2] * lDir[2]);
          const shadowHit = sphereTrace(
            [hit.point[0] + hit.normal[0] * 0.01, hit.point[1] + hit.normal[1] * 0.01, hit.point[2] + hit.normal[2] * 0.01],
            lDir,
            sdf,
            { maxSteps: 32, maxDistance: lDist },
          );
          const shadow = shadowHit.hit && shadowHit.distance < lDist ? 0.2 : 1.0;

          const r = ambCol[0] * hit.ao + lightCol[0] * diff * shadow * hit.ao;
          const g = ambCol[1] * hit.ao + lightCol[1] * diff * shadow * hit.ao;
          const b = ambCol[2] * hit.ao + lightCol[2] * diff * shadow * hit.ao;

          const fog = 1.0 - Math.exp(-hit.distance * fogDensity);
          const fr = r * (1 - fog) + fogCol[0] * fog;
          const fg = g * (1 - fog) + fogCol[1] * fog;
          const fb = b * (1 - fog) + fogCol[2] * fog;

          data[pixelIdx] = Math.max(0, Math.min(255, Math.round(fr * 255)));
          data[pixelIdx + 1] = Math.max(0, Math.min(255, Math.round(fg * 255)));
          data[pixelIdx + 2] = Math.max(0, Math.min(255, Math.round(fb * 255)));
          data[pixelIdx + 3] = 255;
        } else {
          data[pixelIdx] = Math.round(fogCol[0] * 255);
          data[pixelIdx + 1] = Math.round(fogCol[1] * 255);
          data[pixelIdx + 2] = Math.round(fogCol[2] * 255);
          data[pixelIdx + 3] = 255;
        }
      }
    }

    ctx.putImageData(img as any, 0, 0); // Note: Canvas ImageData type boundary
    return { depthBuffer };
  }

  public static generateWebGPUShader(sdfWgslBody: string): string {
    return `
struct Uniforms {
  cameraPos: vec3<f32>,
  aspect: f32,
  cameraTarget: vec3<f32>,
  tanHalfFov: f32,
  lightPos: vec3<f32>,
  fogDensity: f32,
  lightColor: vec3<f32>,
  maxSteps: u32,
  fogColor: vec3<f32>,
  epsilon: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var outTexture: texture_storage_2d<rgba8unorm, write>;

fn evaluateSDF(p: vec3<f32>) -> f32 {
  ${sdfWgslBody}
}

fn computeNormal(p: vec3<f32>, eps: f32) -> vec3<f32> {
  let k0 = vec3<f32>(1.0, -1.0, -1.0);
  let k1 = vec3<f32>(-1.0, -1.0, 1.0);
  let k2 = vec3<f32>(-1.0, 1.0, -1.0);
  let k3 = vec3<f32>(1.0, 1.0, 1.0);
  return normalize(
    k0 * evaluateSDF(p + k0 * eps) +
    k1 * evaluateSDF(p + k1 * eps) +
    k2 * evaluateSDF(p + k2 * eps) +
    k3 * evaluateSDF(p + k3 * eps)
  );
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let dims = textureDimensions(outTexture);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let uv = (vec2<f32>(id.xy) + 0.5) / vec2<f32>(dims);
  let ndc = vec2<f32>((uv.x * 2.0 - 1.0) * u.aspect * u.tanHalfFov, (1.0 - uv.y * 2.0) * u.tanHalfFov);

  let fwd = normalize(u.cameraTarget - u.cameraPos);
  let right = normalize(cross(vec3<f32>(0.0, 1.0, 0.0), fwd));
  let up = cross(fwd, right);
  let rd = normalize(right * ndc.x + up * ndc.y + fwd);

  var t = 0.01;
  var hit = false;
  var p = u.cameraPos;

  for (var i = 0u; i < u.maxSteps; i = i + 1u) {
    p = u.cameraPos + rd * t;
    let d = evaluateSDF(p);
    if (d < u.epsilon) {
      hit = true;
      break;
    }
    t = t + d;
    if (t > 50.0) { break; }
  }

  var color = u.fogColor;
  if (hit) {
    let n = computeNormal(p, u.epsilon);
    let lDir = normalize(u.lightPos - p);
    let diff = max(dot(n, lDir), 0.0);
    let surfaceCol = u.lightColor * diff + vec3<f32>(0.05, 0.05, 0.08);
    let fog = 1.0 - exp(-t * u.fogDensity);
    color = mix(surfaceCol, u.fogColor, fog);
  }

  textureStore(outTexture, id.xy, vec4<f32>(color, 1.0));
}
`;
  }
}

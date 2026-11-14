import { createCanvas } from "@napi-rs/canvas";
import type { Canvas } from "@napi-rs/canvas";
import type { GLTFAPI } from "./gltf-parser.js";
import { getAccessorData } from "./gltf-parser.js";
import type { Mat4, SkeletonState, SkinBinding } from "./skeleton/types.js";
import { buildSkinBindings, buildSkeletonState } from "./skeleton/parse.js";
import { applySkinning } from "./skeleton/animateMesh.js";
import { computeSkinMatrices, identityMat4 } from "./skeleton/skinning.js";
import type { PBRMaterial, PbrLight, RgbColor, MaterialSlotOverride } from "./materials/types.js";
import { DEFAULT_MATERIAL } from "./materials/types.js";
import { resolveMaterialOverrides } from "./materials/override.js";
import { computeVertexColors } from "./materials/pbr.js";
import { sampleEnvMap } from "./environment/reflection.js";
import type { CubeTexture } from "./environment/cubeMap.js";

export interface Model3dOptions {
  readonly src: string;
  readonly width: number;
  readonly height: number;
  readonly camera?: CameraConfig;
  readonly viewMatrix?: Mat4 | readonly number[];
  readonly projectionMatrix?: Mat4 | readonly number[];
  readonly lighting?: LightingConfig;
  readonly background?: string;
  readonly animation?: AnimationConfig;
  readonly skeletal?: SkeletalAnimationConfig;
  readonly environment?: CubeTexture;
  readonly materialOverrides?: readonly MaterialSlotOverride[];
}

export interface SkeletalAnimationConfig {
  readonly clipName?: string;
  readonly speed?: number;
  readonly loop?: boolean;
}

export interface CameraConfig {
  readonly position?: number[];
  readonly target?: number[];
  readonly up?: number[];
  readonly fov?: number;
  readonly near?: number;
  readonly far?: number;
}

export interface LightingConfig {
  readonly ambient?: { color?: string; intensity?: number };
  readonly directional?: { color?: string; intensity?: number; direction?: number[] };
}

export interface AnimationConfig {
  readonly type: "orbit" | "dolly" | "path";
  readonly duration: number;
  readonly orbitRadius?: number;
  readonly orbitSpeed?: number;
  readonly path?: Point3d[];
}

export interface Point3d {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Model3dResult {
  readonly canvas: Canvas;
  readonly frameNumber: number;
}

type Gl = any;

function parseHexColor(value: string): RgbColor {
  const hex = value.startsWith("#") ? value.slice(1) : value;
  if (hex.length === 3) {
    return [
      parseInt(hex[0]! + hex[0]!, 16) / 255,
      parseInt(hex[1]! + hex[1]!, 16) / 255,
      parseInt(hex[2]! + hex[2]!, 16) / 255,
    ];
  }
  if (hex.length >= 6) {
    return [
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255,
    ];
  }
  return [1, 1, 1];
}

export class Model3dRenderer {
  private gl: Gl | null = null;
  private program: Gl | null = null;
  private api: GLTFAPI | null = null;
  private vertexBuffer: Gl | null = null;
  private colorBuffer: Gl | null = null;
  private indexBuffer: Gl | null = null;
  private skeleton: SkeletonState | null = null;
  private skinBindings: readonly SkinBinding[] = [];
  private selectedClip: string | null = null;
  private skinCacheFrame = -1;
  private skinCacheMatrices: Map<number, Mat4> | null = null;
  private currentFrame = 0;
  private currentFps = 30;

  async loadModel(src: string): Promise<void> {
    const { readFile } = await import("node:fs/promises");
    const buffer = await readFile(src);
    const api = await import("./gltf-parser.js").then(m => m.parseGLB(new Uint8Array(buffer)));
    this.api = api;
    this.skeleton = buildSkeletonState(api, 0);
    this.skinBindings = buildSkinBindings(api);
    this.selectedClip = this.skeleton?.animClips[0]?.name ?? null;
  }

  playAnimation(clipName?: string): void {
    if (!this.skeleton) return;
    if (clipName !== undefined && this.skeleton.animClips.some((clip) => clip.name === clipName)) {
      this.selectedClip = clipName;
    } else if (clipName === undefined) {
      this.selectedClip = this.skeleton.animClips[0]?.name ?? null;
    }
    this.skinCacheFrame = -1;
  }

  getAnimationClips(): readonly string[] {
    return this.skeleton?.animClips.map((clip) => clip.name) ?? [];
  }

  async renderFrame(frame: number, fps: number, options: Model3dOptions): Promise<Canvas> {
    const canvas = createCanvas(options.width, options.height);

    let gl: Gl | null = null;
    try {
      const offscreen = new (globalThis as any).OffscreenCanvas(options.width, options.height);
      gl = offscreen.getContext("webgl2") as Gl;
    } catch {
      gl = canvas.getContext("webgl2" as never) as Gl;
    }

    if (!gl) {
      throw new Error("WebGL not supported in this environment. Use Node.js 22+ for 3D rendering.");
    }

    this.gl = gl;
    this.setupGL(gl, options);
    if (options.skeletal?.clipName !== undefined) {
      this.playAnimation(options.skeletal.clipName);
    }

    if (this.api) {
      await this.renderScene(gl, frame, fps, options);
    }

    return canvas;
  }

  private setupGL(gl: Gl, _options: Model3dOptions): void {
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
  }

  private async renderScene(
    gl: Gl,
    frame: number,
    fps: number,
    options: Model3dOptions,
  ): Promise<void> {
    if (!this.api) return;

    const { width, height } = options;
    const time = frame / fps;
    this.currentFrame = frame;
    this.currentFps = fps;

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const projection = options.projectionMatrix
      ? new Float32Array(options.projectionMatrix)
      : this.perspective(
          options.camera?.fov ?? Math.PI / 4,
          width / height,
          options.camera?.near ?? 0.1,
          options.camera?.far ?? 1000,
        );

    const view = options.viewMatrix
      ? new Float32Array(options.viewMatrix)
      : this.computeCameraView(time, options);

    const scene = this.api.scenes[this.api.scene] ?? this.api.scenes[0];
    if (!scene) return;

    for (const nodeIndex of scene.nodes) {
      await this.renderNode(gl, this.api!, nodeIndex, projection, view, options);
    }
  }

  private async renderNode(
    gl: Gl,
    api: GLTFAPI,
    nodeIndex: number,
    projection: Mat4,
    view: Mat4,
    options: Model3dOptions,
    parentMatrix?: Mat4,
  ): Promise<void> {
    const node = api.nodes[nodeIndex]!;
    if (!node) return;

    let localMatrix = this.identity();

    if (node.matrix) {
      localMatrix = new Float32Array(node.matrix as readonly number[]);
    } else {
      const translation = node.translation ?? [0, 0, 0];
      const rotation = node.rotation ?? [0, 0, 0, 1];
      const scale = node.scale ?? [1, 1, 1];
      localMatrix = this.multiply(
        this.fromRotationTranslationScale(rotation as readonly number[], translation as readonly number[], scale as readonly number[]),
        localMatrix,
      );
    }

    const worldMatrix = parentMatrix ? this.multiply(localMatrix, parentMatrix) : localMatrix;

    if (node.mesh !== undefined) {
      await this.renderMesh(gl, api, node.mesh, node.skin, projection, view, worldMatrix, options);
    }

    if (node.children) {
      for (const childIndex of node.children) {
        await this.renderNode(gl, api, childIndex, projection, view, options, worldMatrix);
      }
    }
  }

  private async renderMesh(
    gl: Gl,
    api: GLTFAPI,
    meshIndex: number,
    skinIndex: number | undefined,
    projection: Mat4,
    view: Mat4,
    modelMatrix: Mat4,
    options: Model3dOptions,
  ): Promise<void> {
    const mesh = api.meshes[meshIndex]!;
    if (!mesh) return;

    const mvp = this.multiply(projection, this.multiply(view, modelMatrix));
    const skinMatrices = skinIndex !== undefined ? this.resolveSkinMatrices(skinIndex, options) : null;

    for (const primitive of mesh.primitives) {
      const posAccessor = primitive.attributes.POSITION;
      if (posAccessor === undefined) continue;

      let positions = getAccessorData(api, posAccessor) as Float32Array;
      let normals: Float32Array | undefined;
      const normalAccessor = primitive.attributes.NORMAL;
      if (normalAccessor !== undefined) {
        normals = getAccessorData(api, normalAccessor) as Float32Array;
      }

      if (skinMatrices) {
        const jointsAccessor = primitive.attributes.JOINTS_0;
        const weightsAccessor = primitive.attributes.WEIGHTS_0;
        if (jointsAccessor !== undefined && weightsAccessor !== undefined) {
          const boneIndices = Float32Array.from(getAccessorData(api, jointsAccessor) as unknown as ArrayLike<number>);
          const rawWeights = getAccessorData(api, weightsAccessor);
          const boneWeights = rawWeights instanceof Uint8Array || rawWeights instanceof Uint16Array
            ? Float32Array.from(rawWeights as unknown as ArrayLike<number>, (value: number) => value / 255)
            : Float32Array.from(rawWeights as unknown as ArrayLike<number>);
          const skinned = applySkinning(positions, normals, boneIndices, boneWeights, skinMatrices, null);
          positions = skinned.vertices;
          normals = skinned.normals;
        }
      }

      let indices: Uint16Array | Uint32Array | null = null;
      if (primitive.indices !== undefined) {
        const idxData = getAccessorData(api, primitive.indices);
        indices = idxData instanceof Uint32Array
          ? idxData
          : new Uint16Array(idxData as unknown as ArrayLike<number>);
      }

      const material = this.resolveMaterial(api, primitive.material, options);
      const environmentColor = options.environment ? sampleEnvMap(options.environment, [0, 0, 1]) : undefined;
      const colors = computeVertexColors(normals, Math.floor(positions.length / 3), {
        material,
        light: this.resolveLight(options),
        environment: {
          ambientColor: environmentColor ?? [1, 1, 1],
          ambientIntensity: environmentColor ? 1 : 0.1,
          specularBoost: environmentColor ? 1 : 0,
        },
        viewDirection: [0, 0, 1],
      });

      await this.drawTriangles(gl, positions, indices, mvp, colors);
    }
  }

  private resolveSkinMatrices(skinIndex: number, options: Model3dOptions): readonly Mat4[] | null {
    const binding = this.skinBindings[skinIndex];
    if (!this.skeleton || !binding) return null;
    const clip = this.skeleton.animClips.find((entry) => entry.name === this.selectedClip);
    if (this.skinCacheFrame !== this.currentFrame || this.skinCacheMatrices === null) {
      this.skinCacheMatrices = computeSkinMatrices(this.skeleton, {
        clip,
        time: this.currentFrame / this.currentFps,
        speed: options.skeletal?.speed ?? 1,
        loop: options.skeletal?.loop ?? true,
      });
      this.skinCacheFrame = this.currentFrame;
    }
    return binding.joints.map((nodeIndex) => this.skinCacheMatrices?.get(nodeIndex) ?? identityMat4());
  }

  private async drawTriangles(
    gl: Gl,
    positions: Float32Array,
    indices: Uint16Array | Uint32Array | null,
    mvp: Mat4,
    colors: Uint8Array,
  ): Promise<void> {
    const program = this.getOrCreateShaderProgram(gl);
    gl.useProgram(program);

    if (!this.vertexBuffer) this.vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);

    if (!this.colorBuffer) this.colorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
    const colorLoc = gl.getAttribLocation(program, "aColor");
    if (colorLoc >= 0) {
      gl.enableVertexAttribArray(colorLoc);
      gl.vertexAttribPointer(colorLoc, 4, gl.UNSIGNED_BYTE, true, 0, 0);
    }

    if (indices) {
      if (!this.indexBuffer) this.indexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    }

    const mvpLoc = gl.getUniformLocation(program, "uMVP");
    if (mvpLoc) gl.uniformMatrix4fv(mvpLoc, false, mvp as never);

    if (indices) {
      const type = indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
      gl.drawElements(gl.TRIANGLES, indices.length, type, 0);
    } else {
      gl.drawArrays(gl.TRIANGLES, 0, positions.length / 3);
    }
  }

  private getOrCreateShaderProgram(gl: Gl): Gl {
    if (this.program) return this.program;

    const vsSource = `
      attribute vec3 aPosition;
      attribute vec4 aColor;
      uniform mat4 uMVP;
      varying vec4 vColor;
      void main() {
        vColor = aColor;
        gl_Position = uMVP * vec4(aPosition, 1.0);
      }
    `;
    const fsSource = `
      precision mediump float;
      varying vec4 vColor;
      void main() {
        gl_FragColor = vColor;
      }
    `;

    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vsSource);
    gl.compileShader(vs);

    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fsSource);
    gl.compileShader(fs);

    this.program = gl.createProgram();
    gl.attachShader(this.program, vs);
    gl.attachShader(this.program, fs);
    gl.linkProgram(this.program);

    return this.program;
  }

  private resolveMaterial(
    api: GLTFAPI,
    materialIndex: number | undefined,
    options: Model3dOptions,
  ): PBRMaterial {
    if (materialIndex === undefined) {
      return resolveMaterialOverrides(DEFAULT_MATERIAL, undefined, options.materialOverrides);
    }
    const definition = api.materials[materialIndex];
    if (!definition) {
      return resolveMaterialOverrides(DEFAULT_MATERIAL, materialIndex, options.materialOverrides);
    }
    const pbr = definition.pbrMetallicRoughness;
    const baseColor = pbr?.baseColorFactor;
    const emissive = definition.emissiveFactor;
    const parsed: PBRMaterial = {
      name: definition.name,
      baseColorFactor: baseColor && baseColor.length >= 4
        ? [baseColor[0]!, baseColor[1]!, baseColor[2]!, baseColor[3]!]
        : DEFAULT_MATERIAL.baseColorFactor,
      metallicFactor: pbr?.metallicFactor ?? DEFAULT_MATERIAL.metallicFactor,
      roughnessFactor: pbr?.roughnessFactor ?? DEFAULT_MATERIAL.roughnessFactor,
      emissiveFactor: emissive && emissive.length >= 3
        ? [emissive[0]!, emissive[1]!, emissive[2]!]
        : [0, 0, 0],
      normalScale: 1,
      doubleSided: definition.doubleSided ?? false,
    };
    return resolveMaterialOverrides(parsed, materialIndex, options.materialOverrides);
  }

  private resolveLight(options: Model3dOptions): PbrLight {
    const directional = options.lighting?.directional;
    const direction = directional?.direction;
    const color = parseHexColor(directional?.color ?? "#ffffff");
    return {
      direction: direction && direction.length >= 3
        ? [direction[0]!, direction[1]!, direction[2]!]
        : [0.4, -1, 0.6],
      color,
      intensity: directional?.intensity ?? 1,
    };
  }

  private identity(): Mat4 {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  }

  private perspective(fov: number, aspect: number, near: number, far: number): Mat4 {
    const f = 1.0 / Math.tan(fov / 2);
    const nf = 1 / (near - far);
    const m = new Float32Array(16);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = (far + near) * nf;
    m[11] = -1;
    m[14] = 2 * far * near * nf;
    return m;
  }

  private lookAt(eye: readonly number[], center: readonly number[], up: readonly number[]): Mat4 {
    const e0 = eye[0] ?? 0, e1 = eye[1] ?? 0, e2 = eye[2] ?? 0;
    const c0 = center[0] ?? 0, c1 = center[1] ?? 0, c2 = center[2] ?? 0;
    const u0 = up[0] ?? 0, u1 = up[1] ?? 0, u2 = up[2] ?? 0;

    const zx = e0 - c0, zy = e1 - c1, zz = e2 - c2;
    const len = Math.sqrt(zx * zx + zy * zy + zz * zz);
    const z0 = len ? zx / len : 0, z1 = len ? zy / len : 0, z2 = len ? zz / len : 1;

    const xx = u1 * z2 - u2 * z1;
    const xy = u2 * z0 - u0 * z2;
    const xz = u0 * z1 - u1 * z0;
    const lenX = Math.sqrt(xx * xx + xy * xy + xz * xz);
    const x0 = lenX ? xx / lenX : 1;
    const x1 = lenX ? xy / lenX : 0;
    const x2 = lenX ? xz / lenX : 0;

    const y0 = z1 * x2 - z2 * x1;
    const y1 = z2 * x0 - z0 * x2;
    const y2 = z0 * x1 - z1 * x0;

    const m = new Float32Array(16);
    m[0] = x0; m[1] = y0; m[2] = z0;
    m[4] = x1; m[5] = y1; m[6] = z1;
    m[8] = x2; m[9] = y2; m[10] = z2;
    m[12] = -(x0 * e0 + x1 * e1 + x2 * e2);
    m[13] = -(y0 * e0 + y1 * e1 + y2 * e2);
    m[14] = -(z0 * e0 + z1 * e1 + z2 * e2);
    m[15] = 1;
    return m;
  }

  private multiply(a: Mat4, b: Mat4): Mat4 {
    const r = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += (a[i * 4 + k] ?? 0) * (b[k * 4 + j] ?? 0);
        r[i * 4 + j] = sum;
      }
    }
    return r;
  }

  private fromRotationTranslationScale(
    quat: readonly number[],
    translation: readonly number[],
    scale: readonly number[],
  ): Mat4 {
    const x = quat[0] ?? 0, y = quat[1] ?? 0, z = quat[2] ?? 0, w = quat[3] ?? 1;
    const xx = x * x, yy = y * y, zz = z * z;
    const xy = x * y, xz = x * z, yz = y * z;
    const wx = w * x, wy = w * y, wz = w * z;
    const sx = scale[0] ?? 1, sy = scale[1] ?? 1, sz = scale[2] ?? 1;

    const m = new Float32Array(16);
    m[0]  = (1 - 2 * (yy + zz)) * sx;
    m[1]  = 2 * (xy + wz) * sx;
    m[2]  = 2 * (xz - wy) * sx;
    m[4]  = 2 * (xy - wz) * sy;
    m[5]  = (1 - 2 * (xx + zz)) * sy;
    m[6]  = 2 * (yz + wx) * sy;
    m[8]  = 2 * (xz + wy) * sz;
    m[9]  = 2 * (yz - wx) * sz;
    m[10] = (1 - 2 * (xx + yy)) * sz;
    m[12] = translation[0] ?? 0;
    m[13] = translation[1] ?? 0;
    m[14] = translation[2] ?? 0;
    m[15] = 1;
    return m;
  }

  private computeCameraView(time: number, options: Model3dOptions): Mat4 {
    const eye: number[] = options.camera?.position ?? [0, 0, 5];
    const center: number[] = options.camera?.target ?? [0, 0, 0];
    const up: number[] = options.camera?.up ?? [0, 1, 0];

    if (!options.animation) {
      return this.lookAt(eye, center, up);
    }

    switch (options.animation.type) {
      case "orbit": {
        const angle = time * (options.animation.orbitSpeed ?? 0.5);
        const radius = options.animation.orbitRadius ?? 5;
        const pos: number[] = [
          Math.cos(angle) * radius,
          eye[1] ?? 0,
          Math.sin(angle) * radius,
        ];
        return this.lookAt(pos, center, up);
      }
      case "dolly": {
        const zoom = Math.sin(time * 0.5) * 0.5 + 1;
        const pos: number[] = [(eye[0] ?? 0) * zoom, (eye[1] ?? 0) * zoom, (eye[2] ?? 0) * zoom];
        return this.lookAt(pos, center, up);
      }
      case "path": {
        if (!options.animation.path || options.animation.path.length < 2) {
          return this.lookAt(eye, center, up);
        }
        const dur = options.animation.duration;
        const t = (time % dur) / dur;
        const idx = t * (options.animation.path.length - 1);
        const i = Math.floor(idx);
        const frac = idx - i;
        const p1 = options.animation.path[Math.min(i, options.animation.path.length - 1)] ?? { x: 0, y: 0, z: 0 };
        const p2 = options.animation.path[Math.min(i + 1, options.animation.path.length - 1)] ?? { x: 0, y: 0, z: 0 };
        const pos: number[] = [
          p1.x + (p2.x - p1.x) * frac,
          p1.y + (p2.y - p1.y) * frac,
          p1.z + (p2.z - p1.z) * frac,
        ];
        return this.lookAt(pos, center, up);
      }
    }
  }
}

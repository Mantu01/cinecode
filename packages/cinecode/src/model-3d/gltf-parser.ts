export interface GLTFBuffer {
  readonly data: Uint8Array;
  readonly uri?: string;
}

export interface GLTFAccessor {
  readonly bufferView?: number;
  readonly byteOffset: number;
  readonly componentType: 5121 | 5123 | 5125 | 5126 | 5120 | 5122;
  readonly count: number;
  readonly type: "SCALAR" | "VEC2" | "VEC3" | "VEC4" | "MAT4";
  readonly normalized?: boolean;
  readonly max?: number[];
  readonly min?: number[];
}

export interface GLTFBufferView {
  readonly buffer: number;
  readonly byteOffset: number;
  readonly byteLength: number;
  readonly byteStride?: number;
  readonly target?: 34962 | 34963;
}

export interface GLTFMeshPrimitive {
  readonly attributes: Record<string, number>;
  readonly indices?: number;
  readonly material?: number;
  readonly mode?: number;
}

export interface GLTFMesh {
  readonly primitives: GLTFMeshPrimitive[];
  readonly name?: string;
}

export interface GLTFMaterial {
  readonly pbrMetallicRoughness?: {
    readonly baseColorFactor?: number[];
    readonly metallicFactor?: number;
    readonly roughnessFactor?: number;
    readonly baseColorTexture?: { index: number; texCoord: number };
    readonly metallicRoughnessTexture?: { index: number; texCoord: number };
  };
  readonly emissiveFactor?: number[];
  readonly doubleSided?: boolean;
  readonly name?: string;
}

export interface GLTFSkin {
  readonly joints: number[];
  readonly inverseBindMatrices?: number;
  readonly skeleton?: number;
  readonly name?: string;
}

export interface GLTFNode {
  readonly mesh?: number;
  readonly skin?: number;
  readonly translation?: number[];
  readonly rotation?: number[];
  readonly scale?: number[];
  readonly children?: number[];
  readonly name?: string;
  readonly matrix?: number[];
}

export interface GLTFScene {
  readonly nodes: number[];
  readonly name?: string;
}

export interface GLTFSampler {
  readonly magFilter?: number;
  readonly minFilter?: number;
  readonly wrapS?: number;
  readonly wrapT?: number;
}

export interface GLTFTexture {
  readonly sampler?: number;
  readonly source?: number;
}

export interface GLTFAnimation {
  readonly name?: string;
  readonly channels: GLTFAnimationChannel[];
  readonly samplers: GLTFAnimationSampler[];
}

export interface GLTFAnimationChannel {
  readonly sampler: number;
  readonly target: { path: "translation" | "rotation" | "scale" | "weights"; node: number };
}

export interface GLTFAnimationSampler {
  readonly input: number;
  readonly output: number;
  readonly interpolation?: "LINEAR" | "STEP" | "CUBICSPLINE";
}

export interface GLTFImage {
  readonly uri?: string;
  readonly bufferView?: number;
  readonly mimeType?: string;
  readonly name?: string;
}

export interface GLTFAPI {
  readonly scenes: GLTFScene[];
  readonly scene: number;
  readonly nodes: GLTFNode[];
  readonly meshes: GLTFMesh[];
  readonly skins: GLTFSkin[];
  readonly images?: GLTFImage[];
  readonly materials: GLTFMaterial[];
  readonly accessors: GLTFAccessor[];
  readonly bufferViews: GLTFBufferView[];
  readonly buffers: GLTFBuffer[];
  readonly samplers: GLTFSampler[];
  readonly textures: GLTFTexture[];
  readonly animations?: GLTFAnimation[];
}

export async function parseGLB(buffer: Uint8Array): Promise<GLTFAPI> {
  const view = new DataView(buffer.buffer);

  const magic = view.getUint32(0);
  if (magic !== 0x46546C67) throw new Error(`Not a valid GLB file (magic: 0x${magic.toString(16)})`);

  const version = view.getUint32(4);
  if (version !== 2) throw new Error(`Unsupported GLB version: ${version} (only 2.0 is supported)`);

  let offset = 12;

  const jsonLength = view.getUint32(offset);
  offset += 4;
  const jsonBytes = buffer.subarray(offset, offset + jsonLength);
  offset += jsonLength;
  const jsonPadding = (4 - (jsonLength % 4)) % 4;
  offset += jsonPadding;

  const binaryLength = view.getUint32(offset);
  offset += 4;
  const binaryType = view.getUint32(offset);
  if (binaryType !== 0x4E4F5342) {
    throw new Error(`Expected binary chunk type 0x4E4F5342, got 0x${binaryType.toString(16)}`);
  }
  offset += 4;
  const binaryData = buffer.subarray(offset, offset + binaryLength);

  const json = JSON.parse(new TextDecoder().decode(jsonBytes)) as Record<string, unknown>;
  return buildGLTFAPI(json, binaryData);
}

function buildGLTFAPI(json: Record<string, unknown>, binaryData: Uint8Array): GLTFAPI {
  const buffers = (json.buffers as Array<{ byteLength: number; uri?: string }>)?.map((b, i) => ({
    data: i === 0 ? binaryData : new Uint8Array(b.byteLength),
    uri: b.uri,
  })) ?? [];

  const bufferViews = (json.bufferViews as Array<{
    buffer: number; byteOffset: number; byteLength: number; byteStride?: number; target?: number;
  }>)?.map(bv => ({
    ...bv,
    target: bv.target as 34962 | 34963 | undefined,
  })) ?? [];

  const accessors = (json.accessors as Array<{
    bufferView?: number; byteOffset?: number; componentType: number; count: number;
    type: string; normalized?: boolean; max?: number[]; min?: number[];
  }>)?.map(a => ({
    ...a,
    componentType: a.componentType as 5121 | 5123 | 5125 | 5126 | 5120,
    byteOffset: a.byteOffset ?? 0,
    type: a.type as "SCALAR" | "VEC2" | "VEC3" | "VEC4" | "MAT4",
  })) ?? [];

  const meshes = (json.meshes as Array<{
    primitives: Array<{
      attributes: Record<string, number>;
      indices?: number;
      material?: number;
      mode?: number;
    }>;
    name?: string;
  }>)?.map(m => ({
    ...m,
    primitives: m.primitives.map(p => ({ ...p, mode: p.mode ?? 4 })),
  })) ?? [];

  const materials = (json.materials as Array<Record<string, unknown>>) ?? [];
  const nodes = (json.nodes as Array<Record<string, unknown>>) ?? [];
  const scenes = (json.scenes as Array<{ nodes: number[]; name?: string }>) ?? [];
  const samplers = (json.samplers as Array<Record<string, unknown>>) ?? [];
  const textures = (json.textures as Array<{ sampler?: number; source?: number }>) ?? [];

  return {
    scenes,
    scene: (json.scene as number) ?? 0,
    nodes: nodes.map(n => ({
      mesh: n.mesh as number | undefined,
      skin: n.skin as number | undefined,
      translation: n.translation as number[] | undefined,
      rotation: n.rotation as number[] | undefined,
      scale: n.scale as number[] | undefined,
      children: n.children as number[] | undefined,
      name: n.name as string | undefined,
      matrix: n.matrix as number[] | undefined,
    })),
    meshes,
    materials: materials.map(m => ({
      pbrMetallicRoughness: m.pbrMetallicRoughness as GLTFMaterial["pbrMetallicRoughness"],
      emissiveFactor: m.emissiveFactor as number[] | undefined,
      doubleSided: m.doubleSided as boolean | undefined,
      name: m.name as string | undefined,
    })),
    accessors,
    bufferViews,
    buffers,
    skins: ((json.skins as Array<{ joints: number[]; inverseBindMatrices?: number; skeleton?: number; name?: string }>) ?? []).map((s) => ({
      joints: s.joints,
      inverseBindMatrices: s.inverseBindMatrices,
      skeleton: s.skeleton,
      name: s.name,
    })),
    images: (json.images as GLTFImage[] | undefined) ?? undefined,
    samplers: samplers.map(s => ({
      magFilter: s.magFilter as number | undefined,
      minFilter: s.minFilter as number | undefined,
      wrapS: s.wrapS as number | undefined,
      wrapT: s.wrapT as number | undefined,
    })),
    textures,
    animations: json.animations ? buildAnimations(json.animations as Array<Record<string, unknown>>, accessors) : undefined,
  };
}

function buildAnimations(
  anims: Array<Record<string, unknown>>,
  accessors: GLTFAccessor[],
): GLTFAnimation[] {
  return anims.map(anim => ({
    name: anim.name as string | undefined,
    channels: (anim.channels as Array<{ sampler: number; target: { path: string; node: number } }>)?.map(c => ({
      ...c,
      target: { ...c.target, path: c.target.path as "translation" | "rotation" | "scale" | "weights" },
    })) ?? [],
    samplers: (anim.samplers as Array<{ input: number; output: number; interpolation?: string }>)?.map(s => ({
      ...s,
      interpolation: s.interpolation as "LINEAR" | "STEP" | "CUBICSPLINE" | undefined,
    })) ?? [],
  }));
}

export function getAccessorData(
  api: GLTFAPI,
  accessorIndex: number,
): Float32Array | Uint16Array | Uint8Array | Int16Array | Int8Array | Uint32Array {
  const accessor = api.accessors[accessorIndex]!;
  const bufferViewIdx = accessor.bufferView ?? 0;
  const bufferView = api.bufferViews[bufferViewIdx]!;
  if (!bufferView) throw new Error(`Accessor ${accessorIndex} references missing buffer view`);
  const buffer = api.buffers[bufferView.buffer]!;
  const offset = bufferView.byteOffset + accessor.byteOffset;
  const length = accessor.count * getComponentSize(accessor.componentType) * getTypeSize(accessor.type);

  const bytes = buffer.data.subarray(offset, offset + length);
  const componentBytes = getComponentSize(accessor.componentType);
  const elementCount = Math.floor(bytes.byteLength / componentBytes);

  switch (accessor.componentType) {
    case 5120: return new Int8Array(bytes.buffer, bytes.byteOffset, elementCount);
    case 5121: return new Uint8Array(bytes.buffer, bytes.byteOffset, elementCount);
    case 5122: return new Int16Array(bytes.buffer, bytes.byteOffset, elementCount);
    case 5123: return new Uint16Array(bytes.buffer, bytes.byteOffset, elementCount);
    case 5125: return new Uint32Array(bytes.buffer, bytes.byteOffset, elementCount);
    case 5126: return new Float32Array(bytes.buffer, bytes.byteOffset, elementCount);
    default: throw new Error(`Unknown component type: ${accessor.componentType}`);
  }
}

function getComponentSize(componentType: number): number {
  return [1, 1, 2, 2, 4, 4][componentType] ?? 4;
}

function getTypeSize(type: string): number {
  switch (type) {
    case "SCALAR": return 1;
    case "VEC2": return 2;
    case "VEC3": return 3;
    case "VEC4": return 4;
    case "MAT4": return 16;
    default: return 1;
  }
}

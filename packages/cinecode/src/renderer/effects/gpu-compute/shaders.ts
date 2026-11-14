const BLOOM_WGSL = `
struct BloomParams {
  width: u32,
  height: u32,
  threshold: f32,
  strength: f32,
  radius: i32,
  sigma: f32,
  pad0: u32,
  pad1: u32,
};

@group(0) @binding(0) var<uniform> params: BloomParams;
@group(0) @binding(1) var sourceTex: texture_2d<f32>;
@group(0) @binding(2) var tempTex: texture_2d<f32>;
@group(0) @binding(3) var destTex: texture_storage_2d<rgba8unorm, write>;

fn luma(color: vec3f) -> f32 {
  return dot(color, vec3f(0.2126, 0.7152, 0.0722));
}

fn gaussian(offset: i32) -> f32 {
  let sigma = max(params.sigma, 0.0001);
  let x = f32(offset);
  return exp(-(x * x) / (2.0 * sigma * sigma));
}

@compute @workgroup_size(8, 8)
fn highpass(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= params.width || id.y >= params.height) {
    return;
  }
  let coord = vec2i(i32(id.x), i32(id.y));
  let color = textureLoad(sourceTex, coord, 0);
  let value = luma(color.rgb);
  var extracted = vec3f(0.0);
  if (value > params.threshold) {
    let scale = (value - params.threshold) / max(1.0 - params.threshold, 0.0001);
    extracted = color.rgb * scale;
  }
  textureStore(destTex, coord, vec4f(extracted, color.a));
}

@compute @workgroup_size(8, 8)
fn blurHorizontal(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= params.width || id.y >= params.height) {
    return;
  }
  var sum = vec3f(0.0);
  var weightSum = 0.0;
  let radius = clamp(params.radius, 0, 64);
  for (var offset = -radius; offset <= radius; offset += 1) {
    let sampleX = clamp(i32(id.x) + offset, 0, i32(params.width) - 1);
    let weight = gaussian(offset);
    sum += textureLoad(tempTex, vec2i(sampleX, i32(id.y)), 0).rgb * weight;
    weightSum += weight;
  }
  textureStore(destTex, vec2i(i32(id.x), i32(id.y)), vec4f(sum / max(weightSum, 0.0001), 1.0));
}

@compute @workgroup_size(8, 8)
fn blurVertical(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= params.width || id.y >= params.height) {
    return;
  }
  var sum = vec3f(0.0);
  var weightSum = 0.0;
  let radius = clamp(params.radius, 0, 64);
  for (var offset = -radius; offset <= radius; offset += 1) {
    let sampleY = clamp(i32(id.y) + offset, 0, i32(params.height) - 1);
    let weight = gaussian(offset);
    sum += textureLoad(tempTex, vec2i(i32(id.x), sampleY), 0).rgb * weight;
    weightSum += weight;
  }
  textureStore(destTex, vec2i(i32(id.x), i32(id.y)), vec4f(sum / max(weightSum, 0.0001), 1.0));
}

@compute @workgroup_size(8, 8)
fn composite(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= params.width || id.y >= params.height) {
    return;
  }
  let coord = vec2i(i32(id.x), i32(id.y));
  let base = textureLoad(sourceTex, coord, 0);
  let bloom = textureLoad(tempTex, coord, 0);
  let combined = base.rgb + bloom.rgb * params.strength;
  textureStore(destTex, coord, vec4f(clamp(combined, vec3f(0.0), vec3f(1.0)), base.a));
}
`;

const BLUR_WGSL = `
struct BlurParams {
  width: u32,
  height: u32,
  radius: i32,
  sigma: f32,
};

@group(0) @binding(0) var<uniform> params: BlurParams;
@group(0) @binding(1) var sourceTex: texture_2d<f32>;
@group(0) @binding(2) var destTex: texture_storage_2d<rgba8unorm, write>;

fn gaussian(offset: i32) -> f32 {
  let sigma = max(params.sigma, 0.0001);
  let x = f32(offset);
  return exp(-(x * x) / (2.0 * sigma * sigma));
}

@compute @workgroup_size(8, 8)
fn blurHorizontal(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= params.width || id.y >= params.height) {
    return;
  }
  var sum = vec4f(0.0);
  var weightSum = 0.0;
  let radius = clamp(params.radius, 0, 64);
  for (var offset = -radius; offset <= radius; offset += 1) {
    let sampleX = clamp(i32(id.x) + offset, 0, i32(params.width) - 1);
    let weight = gaussian(offset);
    sum += textureLoad(sourceTex, vec2i(sampleX, i32(id.y)), 0) * weight;
    weightSum += weight;
  }
  textureStore(destTex, vec2i(i32(id.x), i32(id.y)), sum / max(weightSum, 0.0001));
}

@compute @workgroup_size(8, 8)
fn blurVertical(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= params.width || id.y >= params.height) {
    return;
  }
  var sum = vec4f(0.0);
  var weightSum = 0.0;
  let radius = clamp(params.radius, 0, 64);
  for (var offset = -radius; offset <= radius; offset += 1) {
    let sampleY = clamp(i32(id.y) + offset, 0, i32(params.height) - 1);
    let weight = gaussian(offset);
    sum += textureLoad(sourceTex, vec2i(i32(id.x), sampleY), 0) * weight;
    weightSum += weight;
  }
  textureStore(destTex, vec2i(i32(id.x), i32(id.y)), sum / max(weightSum, 0.0001));
}
`;

const COLOR_GRADING_WGSL = `
struct GradeParams {
  width: u32,
  height: u32,
  lift: vec3f,
  gamma: vec3f,
  gain: vec3f,
  saturation: f32,
  lutEnabled: u32,
  pad0: u32,
  pad1: u32,
};

@group(0) @binding(0) var<uniform> params: GradeParams;
@group(0) @binding(1) var sourceTex: texture_2d<f32>;
@group(0) @binding(2) var lutTex: texture_3d<f32>;
@group(0) @binding(3) var destTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(4) var lutSampler: sampler;

@compute @workgroup_size(8, 8)
fn grade(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= params.width || id.y >= params.height) {
    return;
  }
  let coord = vec2i(i32(id.x), i32(id.y));
  let source = textureLoad(sourceTex, coord, 0);
  var color = source.rgb;
  if (params.lutEnabled == 1u) {
    color = textureSampleLevel(lutTex, lutSampler, color, 0.0).rgb;
  }
  color = pow(max(color * params.gain + params.lift, vec3f(0.0)), vec3f(1.0) / max(params.gamma, vec3f(0.0001)));
  let luma = dot(color, vec3f(0.2126, 0.7152, 0.0722));
  color = mix(vec3f(luma), color, params.saturation);
  textureStore(destTex, coord, vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), source.a));
}
`;

const DENOISE_WGSL = `
struct DenoiseParams {
  width: u32,
  height: u32,
  radius: i32,
  sigmaColor: f32,
  sigmaSpace: f32,
  pad0: u32,
};

@group(0) @binding(0) var<uniform> params: DenoiseParams;
@group(0) @binding(1) var sourceTex: texture_2d<f32>;
@group(0) @binding(2) var destTex: texture_storage_2d<rgba8unorm, write>;

fn luminance(color: vec3f) -> f32 {
  return dot(color, vec3f(0.2126, 0.7152, 0.0722));
}

@compute @workgroup_size(8, 8)
fn denoise(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= params.width || id.y >= params.height) {
    return;
  }
  let radius = clamp(params.radius, 0, 8);
  let center = textureLoad(sourceTex, vec2i(i32(id.x), i32(id.y)), 0);
  let centerLuma = luminance(center.rgb);
  var accum = vec3f(0.0);
  var alpha = 0.0;
  var weightSum = 0.0;
  for (var dy = -radius; dy <= radius; dy += 1) {
    for (var dx = -radius; dx <= radius; dx += 1) {
      let sampleX = clamp(i32(id.x) + dx, 0, i32(params.width) - 1);
      let sampleY = clamp(i32(id.y) + dy, 0, i32(params.height) - 1);
      let sampleColor = textureLoad(sourceTex, vec2i(sampleX, sampleY), 0);
      let luma = luminance(sampleColor.rgb);
      let spatial = exp(-f32(dx * dx + dy * dy) / (2.0 * params.sigmaSpace * params.sigmaSpace));
      let range = exp(-(luma - centerLuma) * (luma - centerLuma) / (2.0 * params.sigmaColor * params.sigmaColor));
      let weight = spatial * range;
      accum += sampleColor.rgb * weight;
      alpha += sampleColor.a * weight;
      weightSum += weight;
    }
  }
  let result = accum / max(weightSum, 0.0001);
  textureStore(destTex, vec2i(i32(id.x), i32(id.y)), vec4f(result, alpha / max(weightSum, 0.0001)));
}
`;

export const WGSL_SHADER_SOURCES: Readonly<Record<string, string>> = {
  bloom: BLOOM_WGSL,
  blur: BLUR_WGSL,
  "color-grading": COLOR_GRADING_WGSL,
  denoise: DENOISE_WGSL,
};

export interface ComputeShaderDescriptor {
  readonly name: string;
  readonly source: string;
  readonly entryPoint: string;
  readonly workgroupSize: readonly [number, number, number];
}

export const COMPUTE_SHADERS: Readonly<Record<string, ComputeShaderDescriptor>> = {
  bloom: { name: "bloom", source: BLOOM_WGSL, entryPoint: "highpass", workgroupSize: [8, 8, 1] },
  "bloom-composite": { name: "bloom", source: BLOOM_WGSL, entryPoint: "composite", workgroupSize: [8, 8, 1] },
  "blur-horizontal": { name: "blur", source: BLUR_WGSL, entryPoint: "blurHorizontal", workgroupSize: [8, 8, 1] },
  "blur-vertical": { name: "blur", source: BLUR_WGSL, entryPoint: "blurVertical", workgroupSize: [8, 8, 1] },
  "color-grading": { name: "color-grading", source: COLOR_GRADING_WGSL, entryPoint: "grade", workgroupSize: [8, 8, 1] },
  denoise: { name: "denoise", source: DENOISE_WGSL, entryPoint: "denoise", workgroupSize: [8, 8, 1] },
};

const compiledShaderCache = new Map<string, string>();

export function getShaderSource(name: string): string {
  const cached = compiledShaderCache.get(name);
  if (cached !== undefined) return cached;
  const descriptor = COMPUTE_SHADERS[name];
  if (!descriptor) {
    throw new Error(`[CC2104] Unknown compute shader "${name}"`);
  }
  compiledShaderCache.set(name, descriptor.source);
  return descriptor.source;
}

export function listComputeShaders(): readonly string[] {
  return Object.keys(COMPUTE_SHADERS);
}

export function clearShaderCache(): void {
  compiledShaderCache.clear();
}

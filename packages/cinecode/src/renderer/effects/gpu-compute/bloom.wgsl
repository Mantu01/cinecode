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

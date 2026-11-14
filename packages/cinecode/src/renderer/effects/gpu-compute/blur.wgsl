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

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

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

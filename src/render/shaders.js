// Fragment shaders (PixiJS v7 filters) — the “take advantage of shaders” bits.
// Water: animated waves + sub-surface tint, no transparency/reflection (visual spec §6).
// Clouds: slow-cycling fbm vapor used as an overhead occluder layer.

/* global PIXI */

const WATER_FRAG = `
precision highp float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec4 inputSize;
uniform vec4 outputFrame;
uniform float uTime;
uniform vec3 uFoam;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1.,0.)), u.x),
             mix(hash(i+vec2(0.,1.)), hash(i+vec2(1.,1.)), u.x), u.y);
}

void main(void){
  vec4 src = texture2D(uSampler, vTextureCoord);
  if (src.a < 0.01) { gl_FragColor = src; return; }

  // tile-ish space regardless of the river's bounding box
  vec2 uv = vTextureCoord * inputSize.xy / outputFrame.zw;
  vec2 wuv = uv * outputFrame.zw / 48.0;
  float t = uTime;

  // deep/shallow comes pre-painted in the source cells; add crossing wave
  // trains + a drifting noise shimmer on top
  float w1 = sin(wuv.x*2.6 - t*1.4 + sin(wuv.y*3.4)*0.9);
  float w2 = sin(wuv.x*4.2 + wuv.y*3.1 + t*0.9);
  float n  = noise(wuv*2.4 + vec2(t*0.35, -t*0.22));
  vec3 col = src.rgb / max(src.a, 0.001);
  col += 0.10*w1 + 0.08*w2 + 0.14*(n - 0.5);

  // shoreline foam: probe the water mask's alpha around this pixel — works
  // for any organic river/pond shape, no straight-band assumption
  vec2 px = inputSize.zw * 6.0;
  float edge = 1.0;
  edge = min(edge, texture2D(uSampler, vTextureCoord + vec2(px.x, 0.0)).a);
  edge = min(edge, texture2D(uSampler, vTextureCoord - vec2(px.x, 0.0)).a);
  edge = min(edge, texture2D(uSampler, vTextureCoord + vec2(0.0, px.y)).a);
  edge = min(edge, texture2D(uSampler, vTextureCoord - vec2(0.0, px.y)).a);
  float lap = 0.6 + 0.4*sin(t*1.7 + wuv.x*4.0 + wuv.y*4.0);   // lapping pulse
  float foam = (1.0 - edge) * lap;
  float crest = smoothstep(0.82, 0.98, 0.5 + 0.5*w1) * smoothstep(0.6, 0.9, n);
  col = mix(col, uFoam, clamp(foam*0.7 + crest*0.3, 0.0, 1.0));

  gl_FragColor = vec4(col, 1.0) * src.a;
}`;

const CLOUD_FRAG = `
precision highp float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec4 inputSize;
uniform vec4 outputFrame;
uniform float uTime;
uniform float uSeed;
uniform float uDensity;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5453123); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1.,0.)), u.x),
             mix(hash(i+vec2(0.,1.)), hash(i+vec2(1.,1.)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.55;
  }
  return v;
}

void main(void){
  vec2 uv = vTextureCoord * inputSize.xy / outputFrame.zw;
  vec4 src = texture2D(uSampler, vTextureCoord);
  if (src.a < 0.01) { gl_FragColor = vec4(0.0); return; }

  // vapor cycles slowly: two fbm fields advected against each other
  vec2 p = uv * vec2(3.0, 2.0);
  float f1 = fbm(p + vec2(uTime*0.05, uTime*0.012));
  float f2 = fbm(p*1.7 - vec2(uTime*0.03, -uTime*0.02) + f1);
  float d = fbm(p + f2*0.9);

  // rounded mask so the quad edge never shows
  vec2 c = uv - 0.5;
  float edge = smoothstep(0.5, 0.18, length(c*vec2(1.0,1.6)));
  float a = smoothstep(0.42, 0.75, d*uDensity) * edge;

  vec3 col = mix(vec3(0.86, 0.90, 0.95), vec3(1.0), d);
  gl_FragColor = vec4(col*a, a) ;
}`;

export function makeWaterFilter(palette) {
  const toV3 = (c) => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
  return new PIXI.Filter(undefined, WATER_FRAG, {
    uTime: 0,
    uFoam: toV3(palette.waterFoam),
  });
}

export function makeCloudFilter(seed, density = 1.6) {
  return new PIXI.Filter(undefined, CLOUD_FRAG, { uTime: 0, uSeed: seed, uDensity: density });
}

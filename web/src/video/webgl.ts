// The screen in WebGL 2, in two passes.
//
// 1. Decode: the frame's palette indices (an R8UI texture, 352 × 296) through the palette into colour, into a texture
//    of the same size. For the television it is decoded as a PAL set decodes it: the luminance a little softened (the
//    RF modulator), the colour difference much more (PAL's chroma has about 1.3 MHz against the ULA's 7 MHz pixel
//    clock) and averaged with the line above (the PAL delay line), which is the colour bleed of the real thing.
// 2. Present, at the canvas's size: sharp, each Spectrum pixel a square of whole device pixels; or the television:
//    the tube's curve, each line drawn by a beam that widens as it brightens, the dark between lines, the aperture
//    grille's stripes, a glow around what is bright, darker corners.

import { FRAME_HEIGHT, FRAME_WIDTH } from '../emulator/emulator';
import type { Crop, DisplayMode, Fit } from './fit';
import type { Pixels, Renderer } from './renderer';

const VERTEX = `#version 300 es
void main() {
  // One triangle that covers the viewport.
  vec2 p = vec2(float((gl_VertexID & 1) << 2) - 1.0, float((gl_VertexID & 2) << 1) - 1.0);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const DECODE = `#version 300 es
precision highp float;
precision highp usampler2D;
uniform usampler2D u_index;
uniform vec3 u_palette[16];
uniform bool u_pal;
out vec4 o;

vec3 colour(ivec2 p) {
  p = clamp(p, ivec2(0), ivec2(${FRAME_WIDTH - 1}, ${FRAME_HEIGHT - 1}));
  return u_palette[texelFetch(u_index, p, 0).r & 15u];
}

// Y'UV, as PAL has it (ITU-R BT.470 / BT.601 coefficients).
vec3 yuv(vec3 c) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  return vec3(y, 0.492 * (c.b - y), 0.877 * (c.r - y));
}

vec3 rgb(vec3 c) {
  float r = c.x + c.z / 0.877;
  float b = c.x + c.y / 0.492;
  float g = (c.x - 0.299 * r - 0.114 * b) / 0.587;
  return vec3(r, g, b);
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (!u_pal) {
    o = vec4(colour(p), 1.0);
    return;
  }
  float y = 0.15 * yuv(colour(p + ivec2(-1, 0))).x + 0.7 * yuv(colour(p)).x + 0.15 * yuv(colour(p + ivec2(1, 0))).x;
  vec2 uv = vec2(0.0);
  for (int i = -2; i <= 2; i++) {
    float w = float(3 - abs(i));
    uv += w * (yuv(colour(p + ivec2(i, 0))).yz + yuv(colour(p + ivec2(i, -1))).yz);
  }
  uv /= 18.0;
  o = vec4(clamp(rgb(vec3(y, uv)), 0.0, 1.0), 1.0);
}`;

const SHARP = `#version 300 es
precision highp float;
uniform sampler2D u_rgb;
uniform vec4 u_crop;
uniform vec2 u_out;
uniform float u_scale;
out vec4 o;
void main() {
  vec2 frag = vec2(gl_FragCoord.x, u_out.y - gl_FragCoord.y);
  o = vec4(texelFetch(u_rgb, ivec2(u_crop.xy + floor(frag / u_scale)), 0).rgb, 1.0);
}`;

const TELEVISION = `#version 300 es
precision highp float;
uniform sampler2D u_rgb;
uniform vec4 u_crop;      // x, y, width, height in frame pixels
uniform vec2 u_out;       // the canvas, device pixels
uniform float u_curve;    // how much the tube bulges
uniform float u_mask;     // the aperture grille's strength
uniform float u_bloom;
out vec4 o;

const vec2 FRAME = vec2(${FRAME_WIDTH}.0, ${FRAME_HEIGHT}.0);

vec3 lin(vec3 c) { return c * c * (0.3 + 0.7 * c); } // close to a 2.2 power, and cheap
// Along a line, the beam goes from one pixel to the next over the middle 40% of their boundary: soft, as a set of the
// time was, but not smeared.
vec3 row(float x, float y) {
  float px = x - 0.5;
  float i = floor(px);
  float f = clamp((px - i - 0.5) * 2.5 + 0.5, 0.0, 1.0);
  return lin(texture(u_rgb, vec2(i + f + 0.5, y + 0.5) / FRAME).rgb);
}

// A beam's profile across its line: wider the brighter it is.
vec3 beam(float d, vec3 level) {
  vec3 sigma = mix(vec3(0.21), vec3(0.37), sqrt(level));
  return exp(-0.5 * (d * d) / (sigma * sigma));
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, u_out.y - gl_FragCoord.y);
  vec2 c = frag / u_out * 2.0 - 1.0;
  vec2 d = c * (1.0 + u_curve * vec2(c.y * c.y, c.x * c.x));
  // The picture's rounded edge, softened over a device pixel or two.
  vec2 q = abs(d) - vec2(1.0 - 0.06);
  float edge = length(max(q, 0.0)) - 0.06;
  float inside = 1.0 - smoothstep(-2.0 / u_out.y, 0.0, edge);
  vec2 uv = d * 0.5 + 0.5;
  vec2 src = u_crop.xy + uv * u_crop.zw;

  float line = floor(src.y);
  float f = src.y - line - 0.5;
  float other = f < 0.0 ? line - 1.0 : line + 1.0;
  vec3 a = row(src.x, line);
  vec3 b = row(src.x, other);
  vec3 col = a * beam(abs(f), a) + b * beam(1.0 - abs(f), b);
  // Made up for the dark between the lines, but not so far that the beam's peak clips: a hard clip there would make
  // a normal colour (85%) as bright as its BRIGHT one, and BRIGHT, half of the Spectrum's palette, would all but go.
  col *= 1.2;

  // The aperture grille: red, green and blue stripes a device pixel each.
  int stripe = int(mod(gl_FragCoord.x, 3.0));
  vec3 mask = vec3(stripe == 0 ? 1.0 : 1.0 - u_mask, stripe == 1 ? 1.0 : 1.0 - u_mask, stripe == 2 ? 1.0 : 1.0 - u_mask);
  col *= mask / (1.0 - u_mask * 2.0 / 3.0);

  // The glow of the bright parts in the glass: the decoded frame's own blurred levels.
  vec2 suv = src / FRAME;
  vec3 glow = lin(textureLod(u_rgb, suv, 2.5).rgb) * 0.55 + lin(textureLod(u_rgb, suv, 4.5).rgb) * 0.45;
  col += glow * u_bloom;

  // Darker towards the corners.
  float vignette = pow(clamp(16.0 * uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y), 0.0, 1.0), 0.14);
  col *= vignette;

  // The glass: a soft reflection of the room high on the left, and around the picture the tube's dark face lit a
  // little by what it shows.
  vec2 sheen = (uv - vec2(0.24, 0.14)) * vec2(1.6, 2.6);
  col += vec3(0.022) * exp(-dot(sheen, sheen) * 2.0);
  vec3 face = lin(textureLod(u_rgb, clamp(suv, 0.0, 1.0), 6.0).rgb) * 0.022;

  // A soft shoulder over the top quarter rather than a clip: BRIGHT stays brighter than normal wherever the beam is.
  const vec3 KNEE = vec3(0.75);
  col = min(col, KNEE + (1.0 - KNEE) * (1.0 - exp(-max(col - KNEE, 0.0) / (1.0 - KNEE))));

  col = pow(clamp(mix(face, col, inside), 0.0, 1.0), vec3(1.0 / 2.2));
  o = vec4(col, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, fragment: string): WebGLProgram {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('WebGL: no shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(`WebGL: ${gl.getShaderInfoLog(shader)}`);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`WebGL: ${gl.getProgramInfoLog(program)}`);
  return program;
}

interface Programs {
  decode: WebGLProgram;
  sharp: WebGLProgram;
  television: WebGLProgram;
  index: WebGLTexture;
  rgb: WebGLTexture;
  fbo: WebGLFramebuffer;
  vao: WebGLVertexArrayObject;
}

export class WebGlRenderer implements Renderer {
  readonly kind = 'webgl2';
  readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private p: Programs;
  private palette = new Float32Array(48);
  private mode: DisplayMode = 'sharp';
  private crop: Crop = { id: 'full', name: '', x: 0, y: 0, width: FRAME_WIDTH, height: FRAME_HEIGHT };
  private scale = 1;
  private last = new Uint8Array(FRAME_WIDTH * FRAME_HEIGHT);
  private decoded = false;

  static create(canvas: HTMLCanvasElement): WebGlRenderer | null {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) return null;
    try {
      return new WebGlRenderer(canvas, gl);
    } catch (e) {
      console.warn('WebGL 2 would not start; drawing in 2D instead.', e);
      return null;
    }
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    this.p = this.build();
    // A lost context (a driver reset, too many contexts) comes back with nothing in it: build it again.
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    canvas.addEventListener('webglcontextrestored', () => {
      this.p = this.build();
      this.decoded = false;
      this.present();
    });
  }

  private build(): Programs {
    const gl = this.gl;
    const texture = (internal: number, format: number, type: number, filter: number): WebGLTexture => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, FRAME_WIDTH, FRAME_HEIGHT, 0, format, type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gl.LINEAR_MIPMAP_LINEAR ? gl.LINEAR : filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    const index = texture(gl.R8UI, gl.RED_INTEGER, gl.UNSIGNED_BYTE, gl.NEAREST);
    const rgb = texture(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR_MIPMAP_LINEAR);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rgb, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    return { decode: compile(gl, DECODE), sharp: compile(gl, SHARP), television: compile(gl, TELEVISION), index, rgb, fbo, vao: gl.createVertexArray() };
  }

  setPalette(rgb: Uint8Array): void {
    for (let i = 0; i < 48; i++) this.palette[i] = rgb[i] / 255;
    this.decoded = false;
  }

  setView(mode: DisplayMode, crop: Crop): void {
    if (mode !== this.mode) this.decoded = false;
    this.mode = mode;
    this.crop = crop;
  }

  setSize(size: Fit): void {
    this.canvas.width = size.width;
    this.canvas.height = size.height;
    this.canvas.style.width = `${size.cssWidth}px`;
    this.canvas.style.height = `${size.cssHeight}px`;
    this.scale = size.scale;
  }

  draw(frame: Uint8Array): void {
    this.last.set(frame);
    this.decoded = false;
    this.present();
  }

  present(): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    const p = this.p;
    gl.bindVertexArray(p.vao);
    if (!this.decoded) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, p.index);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, FRAME_WIDTH, FRAME_HEIGHT, gl.RED_INTEGER, gl.UNSIGNED_BYTE, this.last);
      gl.bindFramebuffer(gl.FRAMEBUFFER, p.fbo);
      gl.viewport(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
      gl.useProgram(p.decode);
      gl.uniform1i(gl.getUniformLocation(p.decode, 'u_index'), 0);
      gl.uniform3fv(gl.getUniformLocation(p.decode, 'u_palette'), this.palette);
      gl.uniform1i(gl.getUniformLocation(p.decode, 'u_pal'), this.mode === 'tv' ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, p.rgb);
      // The glow reads the smaller levels; and a texture without them is incomplete, which reads as black even to
      // texelFetch, so sharp mode needs them too.
      gl.generateMipmap(gl.TEXTURE_2D);
      this.decoded = true;
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, p.rgb);
    const program = this.mode === 'tv' ? p.television : p.sharp;
    gl.useProgram(program);
    const u = (name: string) => gl.getUniformLocation(program, name);
    gl.uniform1i(u('u_rgb'), 0);
    gl.uniform4f(u('u_crop'), this.crop.x, this.crop.y, this.crop.width, this.crop.height);
    gl.uniform2f(u('u_out'), this.canvas.width, this.canvas.height);
    if (this.mode === 'tv') {
      gl.uniform1f(u('u_curve'), 0.045);
      // The grille's stripes need three device pixels or so of a Spectrum pixel, or they beat against it.
      gl.uniform1f(u('u_mask'), Math.min(1, Math.max(0, (this.scale - 2) / 3)) * 0.3);
      gl.uniform1f(u('u_bloom'), 0.16);
    } else {
      gl.uniform1f(u('u_scale'), this.scale);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  readPixels(): Pixels {
    this.present(); // the drawing buffer is not kept between frames: draw it again and read it at once
    const gl = this.gl;
    const { width, height } = this.canvas;
    const flipped = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, flipped);
    const data = new Uint8Array(flipped.length);
    const stride = width * 4;
    for (let y = 0; y < height; y++) data.set(flipped.subarray((height - 1 - y) * stride, (height - y) * stride), y * stride);
    return { width, height, data };
  }
}

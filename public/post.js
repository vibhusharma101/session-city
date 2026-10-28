// The finishing pass: renders the scene into an HDR target, then draws it to the
// screen with bloom (lit windows and lamps glow at night), a tilt-shift blur
// (the "miniature model" look: sharp in a band across the middle, softer
// towards the top and bottom), a little extra saturation, ACES tone mapping and
// a soft vignette.
import * as THREE from './three.js';

const TAPS = 12;
const vertexShader = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export class Post {
  constructor(renderer) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    // bloom works at quarter resolution: a bright pass, then a separable blur
    const small = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.bloomA = small();
    this.bloomB = small();
    this.uniforms = {
      tScene: { value: this.target.texture },
      tBloom: { value: this.bloomA.texture },
      uRes: { value: new THREE.Vector2(1, 1) },
      uFocus: { value: 0.5 },     // screen height (0 bottom, 1 top) that stays sharp
      uBand: { value: 0.2 },      // half-height of the sharp band
      uBlur: { value: 1 },        // blur strength towards the edges
      uSaturation: { value: 1.1 },
      uVignette: { value: 0.28 },
      uBloom: { value: 0.3 },     // bloom strength
      uThreshold: { value: 1.0 }, // brightness where bloom starts
    };
    const pass = (fragmentShader, uniforms) => new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, depthTest: false, depthWrite: false });
    this.bright = pass(`
      uniform sampler2D tScene; uniform vec2 uTexel; uniform float uThreshold;
      varying vec2 vUv;
      void main() {
        vec3 c = vec3(0.0);
        for (int i = 0; i < 4; i++) {
          vec2 o = vec2(float(i / 2) - 0.5, float(i - (i / 2) * 2) - 0.5) * uTexel * 2.0;
          c += texture2D(tScene, vUv + o).rgb;
        }
        c *= 0.25;
        float l = max(c.r, max(c.g, c.b));
        gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold + 0.6, l), 1.0);
      }`, { tScene: { value: this.target.texture }, uTexel: { value: new THREE.Vector2() }, uThreshold: this.uniforms.uThreshold });
    this.blur = pass(`
      uniform sampler2D tSrc; uniform vec2 uDir;
      varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tSrc, vUv).rgb * 0.2270;
        c += (texture2D(tSrc, vUv + uDir * 1.3846).rgb + texture2D(tSrc, vUv - uDir * 1.3846).rgb) * 0.3162;
        c += (texture2D(tSrc, vUv + uDir * 3.2308).rgb + texture2D(tSrc, vUv - uDir * 3.2308).rgb) * 0.0703;
        gl_FragColor = vec4(c, 1.0);
      }`, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
    const material = pass(`
        uniform sampler2D tScene, tBloom;
        uniform vec2 uRes;
        uniform float uFocus, uBand, uBlur, uSaturation, uVignette, uBloom;
        varying vec2 vUv;
        void main() {
          vec4 c = texture2D(tScene, vUv);
          float d = max(0.0, abs(vUv.y - uFocus) - uBand) / (1.0 - uBand);
          float radius = d * d * uBlur * 10.0; // in pixels
          if (radius > 0.25) {
            vec4 sum = c;
            for (int i = 0; i < ${TAPS}; i++) {
              float a = float(i) * 2.39996; // golden-angle spiral
              float r = sqrt((float(i) + 0.5) / float(${TAPS})) * radius;
              sum += texture2D(tScene, vUv + vec2(cos(a), sin(a)) * r / uRes);
            }
            c = sum / float(${TAPS + 1});
          }
          c.rgb += texture2D(tBloom, vUv).rgb * uBloom;
          float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
          c.rgb = max(mix(vec3(l), c.rgb, uSaturation), 0.0);
          gl_FragColor = c;
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          float v = distance(vUv, vec2(0.5));
          gl_FragColor.rgb *= 1.0 - uVignette * smoothstep(0.4, 0.85, v);
        }`, this.uniforms);
    material.toneMapped = true;
    this.final = material;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(w, h) {
    const dpr = this.renderer.getPixelRatio();
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    this.target.setSize(W, H);
    const bw = Math.max(1, Math.round(W / 4)), bh = Math.max(1, Math.round(H / 4));
    this.bloomA.setSize(bw, bh);
    this.bloomB.setSize(bw, bh);
    this.bright.uniforms.uTexel.value.set(1 / W, 1 / H);
    this.texel = new THREE.Vector2(1 / bw, 1 / bh);
    this.uniforms.uRes.value.set(W, H);
  }

  draw(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  render(scene, camera) {
    const r = this.renderer;
    r.setRenderTarget(this.target);
    r.render(scene, camera);
    if (this.uniforms.uBloom.value > 0.01) {
      this.draw(this.bright, this.bloomA);
      const b = this.blur.uniforms;
      for (const spread of [1, 2]) { // two rounds widen the glow cheaply
        b.tSrc.value = this.bloomA.texture; b.uDir.value.set(this.texel.x * spread, 0);
        this.draw(this.blur, this.bloomB);
        b.tSrc.value = this.bloomB.texture; b.uDir.value.set(0, this.texel.y * spread);
        this.draw(this.blur, this.bloomA);
      }
    }
    this.draw(this.final, null);
  }
}

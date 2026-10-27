// The finishing pass: renders the scene into an HDR target, then draws it to the
// screen with a tilt-shift blur (the "miniature model" look: sharp in a band
// across the middle, softer towards the top and bottom), a little extra
// saturation, ACES tone mapping and a soft vignette.
import * as THREE from './three.js';

const TAPS = 12;

export class Post {
  constructor(renderer) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.uniforms = {
      tScene: { value: this.target.texture },
      uRes: { value: new THREE.Vector2(1, 1) },
      uFocus: { value: 0.5 },     // screen height (0 bottom, 1 top) that stays sharp
      uBand: { value: 0.2 },      // half-height of the sharp band
      uBlur: { value: 1 },        // blur strength towards the edges
      uSaturation: { value: 1.1 },
      uVignette: { value: 0.28 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `
        uniform sampler2D tScene;
        uniform vec2 uRes;
        uniform float uFocus, uBand, uBlur, uSaturation, uVignette;
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
          float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
          c.rgb = max(mix(vec3(l), c.rgb, uSaturation), 0.0);
          gl_FragColor = c;
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          float v = distance(vUv, vec2(0.5));
          gl_FragColor.rgb *= 1.0 - uVignette * smoothstep(0.4, 0.85, v);
        }`,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(w, h) {
    const dpr = this.renderer.getPixelRatio();
    this.target.setSize(Math.round(w * dpr), Math.round(h * dpr));
    this.uniforms.uRes.value.set(w * dpr, h * dpr);
  }

  render(scene, camera) {
    const r = this.renderer;
    r.setRenderTarget(this.target);
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.scene, this.camera);
  }
}

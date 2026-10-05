import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Runs after tone mapping, on display-referred colour.
const FilmShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uGrain: { value: 0.05 },
    uVignette: { value: 1.0 },
    uFade: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uFade;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main() {
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);

      // A little lens fringing toward the corners.
      vec2 off = d * r2 * 0.012;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;

      // Cool, teal-leaning shadows; neutral-warm highlights; a touch desaturated.
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      vec3 tint = mix(vec3(0.84, 0.99, 1.0), vec3(1.03, 1.0, 0.96), smoothstep(0.04, 0.55, l));
      col *= tint;
      col = mix(vec3(l), col, 0.9);

      // Heavy vignette, like peering in from the dark.
      float v = smoothstep(0.95, 0.18, length(d * vec2(1.05, 1.25)));
      col *= mix(1.0, mix(0.18, 1.0, v), uVignette);

      // Film grain, stronger in the mids.
      float g = hash(vUv * uResolution + fract(uTime * 7.31) * 517.0) - 0.5;
      col += g * uGrain * (0.35 + 0.65 * smoothstep(0.0, 0.35, l));

      col *= 1.0 - uFade;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

export function createPostFX(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: 4,
  });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.35, 0.4, 1.1);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const film = new ShaderPass(FilmShader);
  composer.addPass(film);

  function setSize(w, h, pixelRatio) {
    composer.setPixelRatio(pixelRatio);
    composer.setSize(w, h);
    film.uniforms.uResolution.value.set(w * pixelRatio, h * pixelRatio);
  }

  function render(t, fade = 0) {
    film.uniforms.uTime.value = t;
    film.uniforms.uFade.value = fade;
    composer.render();
  }

  return { composer, bloom, film, setSize, render };
}

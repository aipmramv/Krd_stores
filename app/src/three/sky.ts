// Physical sky and sunlight for a site: the sun sits at its true position for the site's
// latitude/longitude and the selected date and time, and lights the scene through the sky's
// image-based environment.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

const RAD = Math.PI / 180;

/** Sun altitude and azimuth (radians; azimuth clockwise from north). Accurate to well under a degree. */
export function sunPosition(date: Date, lat: number, lon: number) {
  const d = date.getTime() / 86400000 - 10957.5; // days since J2000.0
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const H = (gmst * 15 + lon) * RAD - ra;
  const la = lat * RAD;
  const alt = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(H));
  return { alt, az };
}

/** Scene direction to the sun: x east, y up, z south. */
export function sunDirection(alt: number, az: number) {
  return new THREE.Vector3(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt)).normalize();
}

export class SkyRig {
  readonly sky = new Sky();
  readonly sun = new THREE.DirectionalLight(0xfff1dc, 3);
  readonly fill = new THREE.HemisphereLight(0xdfe9f5, 0x6b6450, .6);
  /** 0 at night, 1 in full daylight. */
  day = 1;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envRT: THREE.WebGLRenderTarget | null = null;
  /** Low-cost stand-in sky for reflections: a gradient dome and a sun disc. Prefiltered with PMREM. */
  private envScene = new THREE.Scene();
  private envDome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private envSun: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private lastKey = '';

  constructor(private scene: THREE.Scene, private span: number) {
    this.sky.scale.setScalar(40000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 7; u.rayleigh.value = 1.6; u.mieCoefficient.value = .006; u.mieDirectionalG.value = .82;
    this.envDome = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, ground: { value: new THREE.Color() } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; varying vec3 vDir; void main(){ float h = vDir.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.6)) : mix(horizon, ground, min(1.0, -h * 4.0)); gl_FragColor = vec4(c, 1.0); }',
    }));
    this.envSun = new THREE.Mesh(new THREE.SphereGeometry(40, 16, 8), new THREE.MeshBasicMaterial({ color: '#FFF4E0' }));
    this.envScene.add(this.envDome, this.envSun);
    const s = this.sun.shadow;
    this.sun.castShadow = true;
    s.mapSize.set(4096, 4096);
    Object.assign(s.camera, { left: -span, right: span, top: span, bottom: -span, near: 10, far: span * 6 });
    s.bias = -.0004; s.normalBias = .6;
    scene.add(this.sky, this.sun, this.sun.target, this.fill);
  }

  /** Place the sun; rebuilds the reflection environment when it moved noticeably. */
  update(R: THREE.WebGLRenderer, date: Date, lat: number, lon: number) {
    const { alt, az } = sunPosition(date, lat, lon);
    const dir = sunDirection(alt, az);
    this.sky.material.uniforms.sunPosition.value.copy(dir);
    this.day = THREE.MathUtils.smoothstep(Math.sin(alt), -.08, .18);
    const d = this.day, dusk = 1 - Math.abs(d - .5) * 2;
    const u = this.envDome.material.uniforms;
    u.top.value.setRGB(.18 * d + .01, .32 * d + .015, .62 * d + .04);
    u.horizon.value.setRGB(.75 * d + .25 * dusk * .8 + .02, .78 * d + .1 * dusk + .02, .82 * d + .03);
    u.ground.value.setRGB(.22 * d + .01, .2 * d + .01, .16 * d + .01);
    this.envSun.position.copy(dir).multiplyScalar(820);
    this.envSun.visible = alt > -.02;
    this.envSun.material.color.setRGB(6, 5.6 - 2 * dusk, 4.8 - 3 * dusk);
    // Light from the sun, or from a low moon-like key light at night so the scene stays readable.
    const lightDir = alt > -.05 ? dir : sunDirection(.6, az + Math.PI);
    this.sun.position.copy(lightDir).multiplyScalar(this.span * 3);
    this.sun.intensity = .35 + 2.9 * this.day;
    this.sun.color.set(this.day > .6 ? 0xfff1dc : this.day > .05 ? 0xffb070 : 0x9fb4ff);
    this.fill.intensity = .25 + .55 * this.day;
    const key = `${alt.toFixed(2)}:${az.toFixed(2)}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.pmrem ??= new THREE.PMREMGenerator(R);
      this.envRT?.dispose();
      this.envRT = this.pmrem.fromScene(this.envScene, 0, 1, 2000);
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = .25 + .75 * this.day;
    }
    return { alt, az };
  }
}

// Optional photorealistic mode: Google Photorealistic 3D Tiles (real photogrammetry of every
// building) placed at the site's origin. Served either through Cesium ion (asset 2275207, needs only an
// ion token) or straight from Google (needs a Maps Platform key with the Map Tiles API and billing).
import * as THREE from 'three';
import { TilesRenderer } from '3d-tiles-renderer';
import { CesiumIonAuthPlugin, GLTFExtensionsPlugin, GoogleCloudAuthPlugin, ReorientationPlugin, TileCompressionPlugin, UnloadTilesPlugin } from '3d-tiles-renderer/plugins';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import type { TileSource } from '../state/store';

const draco = new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
const RAD = Math.PI / 180;
/** Cesium ion's copy of Google Photorealistic 3D Tiles. */
const ION_GOOGLE_ASSET = '2275207';

export class PhotorealTiles {
  readonly tiles: TilesRenderer;
  private ray = new THREE.Raycaster();
  private grounded = false;

  constructor(src: TileSource, lat: number, lon: number, camera: THREE.Camera, R: THREE.WebGLRenderer) {
    const t = this.tiles = new TilesRenderer();
    t.registerPlugin(src.kind === 'ion'
      ? new CesiumIonAuthPlugin({ apiToken: src.token, assetId: ION_GOOGLE_ASSET, autoRefreshToken: true })
      : new GoogleCloudAuthPlugin({ apiToken: src.key, autoRefreshToken: true }));
    t.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));
    t.registerPlugin(new TileCompressionPlugin());
    t.registerPlugin(new UnloadTilesPlugin());
    t.registerPlugin(new ReorientationPlugin({ lat: lat * RAD, lon: lon * RAD, height: 0, recenter: true }));
    t.errorTarget = 6;
    t.setCamera(camera);
    t.setResolutionFromRenderer(camera, R);
    t.group.traverse(o => { o.receiveShadow = true; });
  }

  get group() { return this.tiles.group; }

  update(camera: THREE.Camera, R: THREE.WebGLRenderer) {
    this.tiles.setResolutionFromRenderer(camera, R);
    this.tiles.update();
    // Photogrammetry heights are ellipsoidal; drop the tileset so the ground at the site sits at y = 0.
    if (!this.grounded) {
      this.ray.set(new THREE.Vector3(0, 4000, 0), new THREE.Vector3(0, -1, 0));
      const hit = this.ray.intersectObject(this.tiles.group, true)[0];
      if (hit) { this.tiles.group.position.y -= hit.point.y; this.grounded = true; }
    }
  }

  /** Data credits the tiles currently on screen require (Google's terms ask for these to be shown). */
  credits(): string {
    const out: { type: string; value: unknown }[] = [];
    this.tiles.getAttributions(out);
    return [...new Set(out.filter(a => a.type === 'string').map(a => String(a.value)))].join(' · ');
  }

  dispose() { this.tiles.dispose(); }
}

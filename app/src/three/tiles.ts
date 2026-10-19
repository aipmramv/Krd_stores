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
  /** Holds the tileset in scene axes: the reorientation gives X west / Z north, the scene uses X east / Z south. */
  readonly group = new THREE.Group();
  private ray = new THREE.Raycaster();
  private checks = 0;
  private lastCheck = 0;

  constructor(src: TileSource, lat: number, lon: number, ellH: number, camera: THREE.Camera, R: THREE.WebGLRenderer) {
    const t = this.tiles = new TilesRenderer(src.kind === 'url' ? src.url : undefined);
    if (src.kind === 'ion') t.registerPlugin(new CesiumIonAuthPlugin({ apiToken: src.token, assetId: ION_GOOGLE_ASSET, autoRefreshToken: true }));
    if (src.kind === 'google') t.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: src.key, autoRefreshToken: true }));
    t.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));
    t.registerPlugin(new TileCompressionPlugin());
    t.registerPlugin(new UnloadTilesPlugin());
    // Seat the site's real ground (ellipsoidal height) at y = 0.
    t.registerPlugin(new ReorientationPlugin({ lat: lat * RAD, lon: lon * RAD, height: ellH, recenter: true }));
    t.errorTarget = 6;
    t.setCamera(camera);
    t.setResolutionFromRenderer(camera, R);
    this.group.rotation.y = Math.PI;
    this.group.add(t.group);
  }

  update(camera: THREE.Camera, R: THREE.WebGLRenderer) {
    this.tiles.setResolutionFromRenderer(camera, R);
    this.tiles.update();
    // Fine-tune the ground once detailed tiles are in: only small corrections, so a coarse
    // whole-earth tile can never throw the site hundreds of metres off.
    const now = performance.now();
    if (this.checks < 12 && this.tiles.rootTileset && now - this.lastCheck > 1500) {
      this.lastCheck = now;
      this.ray.set(new THREE.Vector3(0, 1500, 0), new THREE.Vector3(0, -1, 0));
      const hit = this.ray.intersectObject(this.tiles.group, true)[0];
      if (hit) {
        const y = hit.point.y - this.group.position.y;
        if (Math.abs(y) < 60) { this.group.position.y = -y; this.checks++; }
      }
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

// Optional photorealistic mode: Google Photorealistic 3D Tiles (real photogrammetry of every
// building) placed at the site's origin. Needs a Google Maps Platform key with the Map Tiles API.
import * as THREE from 'three';
import { TilesRenderer } from '3d-tiles-renderer';
import { GLTFExtensionsPlugin, GoogleCloudAuthPlugin, ReorientationPlugin, TileCompressionPlugin, UnloadTilesPlugin } from '3d-tiles-renderer/plugins';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const draco = new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
const RAD = Math.PI / 180;

export class PhotorealTiles {
  readonly tiles: TilesRenderer;
  private ray = new THREE.Raycaster();
  private grounded = false;

  constructor(key: string, lat: number, lon: number, camera: THREE.Camera, R: THREE.WebGLRenderer) {
    const t = this.tiles = new TilesRenderer();
    t.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: key, autoRefreshToken: true }));
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

  dispose() { this.tiles.dispose(); }
}

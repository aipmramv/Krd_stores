export type ScreenId = 'network' | 'routes' | 'site' | 'store' | 'shipments' | 'movements' | 'reports' | 'mobile';
export type MapScreen = 'network' | 'routes' | 'shipments';
export type ThreeScreen = 'site' | 'movements' | 'store';
export type ColorMode = 'occupancy' | 'ageing' | 'project' | 'hazard' | 'activity' | 'value';
export type LatLng = [number, number];

export type SiteKind = 'rnd' | 'factory' | 'warehouse';
export type Facade = 'glass' | 'metal' | 'concrete';

/** A KONE facility on a site. Facilities are matched to the nearest large OSM buildings. */
export interface Facility {
  k: string;
  /** Label name. */
  n: string;
  /** Label status line. */
  s: string;
  /** Longer description for the drawer. */
  info: string;
  /** Roof / highlight colour. */
  col: string;
  facade: Facade;
  alert?: boolean;
  /** The facility's floors bottom to top; only the primary facility has them and peels open. */
  floors?: [name: string, space: string][];
  /** Building level of each entry in `floors` (0 = ground), when the model has a group per level. */
  levels?: number[];
  /** Index of the floor holding the electronics store. */
  storeFloor?: number;
  /** Placed by the app instead of matched to OSM: a Blender model or an open yard. */
  modelled?: 'test_tower' | 'yard';
}

export interface Site {
  id: string;
  name: string;
  /** Short name for crumbs and map labels. */
  short: string;
  type: string;
  kind: SiteKind;
  address: string;
  ll: LatLng;
  /** Ground height above the WGS84 ellipsoid in metres (elevation + geoid undulation), to seat 3D tiles. */
  ellH: number;
  space: number;
  value: string;
  ship: number;
  /** Where the callout sits relative to the pin: right (false), left (true) or below ('b'). */
  left: boolean | 'b';
  /** First facility is the primary building (floors, store twin entry). */
  facilities: Facility[];
  /** Internal flows: [from, to, colour, label, layer]. */
  flows: [string, string, string, string, 'flows' | 'scrapf'][];
  /** [title, detail, colour]. */
  alerts: [string, string, string][];
}

export interface RouteOption {
  mode: string;
  carrier: string;
  eta: string;
  cost: string;
  co2: string;
  tag: string;
  tagBg: string;
  geom: 'road' | 'air' | 'rail';
  /** Fraction along the geometry where the map tag is anchored. */
  fr?: number;
  ox?: number;
  oy?: number;
}

export interface Shipment {
  id: string;
  carrier: string;
  from: string;
  to: string;
  eta: string;
  status: string;
  dot: string;
  dir: 'in' | 'out';
  /** Seconds for one animated pass along the lane. */
  dur?: number;
  /** Where an exception is holding the shipment. */
  hold?: LatLng;
}

/** [part no., rev, description, category, UoM, hazard, export, on hand, reserved, location, owner project, status] */
export type Part = [string, string, string, string, string, string, string, number, number, string, string, PartStatus];
export type PartStatus = 'Available' | 'Reserved' | 'Quarantined' | 'In transit' | 'Consumed' | 'Planned' | 'Scrap pending';

export interface Bin { r: number; i: number; k: number }

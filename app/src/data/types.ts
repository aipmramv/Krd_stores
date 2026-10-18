export type ScreenId = 'network' | 'routes' | 'site' | 'store' | 'shipments' | 'movements' | 'reports' | 'mobile';
export type MapScreen = 'network' | 'routes' | 'shipments';
export type ThreeScreen = 'site' | 'movements' | 'store';
export type ColorMode = 'occupancy' | 'ageing' | 'project' | 'hazard';
export type LatLng = [number, number];

export interface Site {
  id: string;
  name: string;
  type: string;
  ll: LatLng;
  space: number;
  value: string;
  ship: number;
  alerts: number;
  /** Where the callout sits relative to the pin: right (false), left (true) or below ('b'). */
  left: boolean | 'b';
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

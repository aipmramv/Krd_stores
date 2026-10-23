// Document shapes for the Materials Twin data store. The same shapes are used by the in-browser
// demo database and by the MongoDB / Azure Cosmos DB (MongoDB API) server, so the app does not
// care which one it talks to. Every document has a string `_id`; documents that belong to a site
// carry `site`, which is also the shard (partition) key on Cosmos DB.
import type { LatLng, PartStatus } from '../data/types';

export type Role = 'clerk' | 'storeManager' | 'logistics' | 'engineer' | 'ehs' | 'finance' | 'leadership' | 'admin';
export const ROLE_LABEL: Record<Role, string> = {
  clerk: 'Store clerk', storeManager: 'Store manager', logistics: 'Logistics manager', engineer: 'Lab owner',
  ehs: 'EHS', finance: 'Finance controller', leadership: 'Leadership', admin: 'Administrator',
};

export interface Doc { _id: string; createdAt?: string; updatedAt?: string }

export interface User extends Doc { name: string; initials: string; email: string; role: Role; sites: string[] }

export interface Part extends Doc {
  partNo: string; rev: string; description: string; category: string; uom: string;
  hazard: string; exportClass: string; project: string; unitCost: number;
  /** Shipping weight per unit of measure, kg. */
  weightKg: number;
}

export type Zone = 'ESD' | 'General' | 'Hazmat' | 'Quarantine' | 'Heavy' | 'Yard' | 'Lab' | 'Test';
export interface Location extends Doc {
  site: string; store: string; code: string; zone: Zone;
  /** Rack row, bay and level for bins in a modelled store; absent for areas. */
  rack?: number; bay?: number; level?: number;
  capacity: number;
}

export interface StockLot extends Doc {
  site: string; partNo: string; locationId: string; lot: string;
  qty: number; reserved: number; status: PartStatus; project: string; receivedAt: string;
}

export type ApprovalDecision = 'pending' | 'approved' | 'rejected';
export interface Approval { role: Role; user?: string; decision: ApprovalDecision; at?: string; note?: string }

export type MovementType = 'move' | 'pick' | 'putaway' | 'count' | 'reserve' | 'issue' | 'transfer';
export type MovementStatus = 'requested' | 'approved' | 'done' | 'rejected' | 'cancelled';
export interface Movement extends Doc {
  site: string; type: MovementType; partNo: string; qty: number;
  lotId?: string; from?: string; to?: string; ref?: string; reason?: string;
  status: MovementStatus; requestedBy: string; approvals: Approval[];
  /** Counted quantity, for counts. */
  counted?: number;
  /** Expected date of a planned receipt (put-away without stock yet). */
  due?: string;
  /** Who is doing the work on the floor, and when they started (task board); null when unassigned or not started. */
  assignee?: string | null;
  startedAt?: string | null;
  /** Sensor events (camera, scan, tag) that confirm this movement happened. */
  evidence?: string[];
}

export type ScrapStep = 'tag' | 'reason' | 'approval' | 'move' | 'dispose' | 'writeoff' | 'closed';
export interface CaseEvent { at: string; user: string; step: ScrapStep; note: string }
export interface ScrapCase extends Doc {
  site: string; partNo: string; qty: number; value: number; reason: string; detail: string;
  step: ScrapStep; photos: string[]; approvals: Approval[];
  /** The stock lot the units come from, and the scrap-yard lot once moved. */
  lotId?: string; yardLotId?: string;
  disposal?: string; vendor?: string; pickupDate?: string;
  certificate?: string; certificateFile?: string; writeOffRef?: string;
  outcome?: 'written-off' | 'rejected' | 'cancelled';
  owner: string; history?: CaseEvent[];
}

export interface Milestone { label: string; at?: string; done: boolean; note?: string }
export interface ShipmentItem { partNo: string; qty: number }
export interface Allocation { lotId: string; partNo: string; qty: number }
export interface Claim { at: string; by: string; kind: 'Damage' | 'Shortage' | 'Delay'; amount: number; note: string; status: 'Open' | 'Settled' }
export type ShipStatus = 'Awaiting EHS approval' | 'Booked' | 'Picked up' | 'In transit' | 'Out for delivery' | 'Delivered' | 'E-way bill hold' | 'Delay risk' | 'Cancelled';
export interface Shipment extends Doc {
  site: string; carrier: string; mode: 'road' | 'air' | 'rail' | 'courier';
  from: string; to: string; eta: string; status: ShipStatus | string; dir: 'in' | 'out';
  items: ShipmentItem[]; milestones: Milestone[]; docs: string[];
  hold?: LatLng; cost?: number;
  /** Booking made in the app: option, booking reference, who booked, allocated stock. */
  option?: string; ref?: string; bookedBy?: string; pickupAt?: string; etaAt?: string; co2?: string; weightKg?: number;
  alloc?: Allocation[]; approvals?: Approval[]; hazmat?: boolean;
  notifiedAt?: string; claims?: Claim[];
}

export interface Carrier extends Doc { name: string; modes: Shipment['mode'][]; contact: string }

export interface ApprovalRule extends Doc { kind: 'scrap' | 'move' | 'shipment'; minValue: number; chain: Role[]; note: string }

export type Severity = 'high' | 'medium' | 'info';
export interface Alert extends Doc {
  site: string; title: string; detail: string; severity: Severity; status: 'open' | 'ack' | 'closed'; at: string; ref?: string;
  /** For alerts raised by the rules engine: which rule, the event behind it, and where. */
  rule?: RuleId; eventId?: string; loc?: string;
}

// ---------- Sensors: cameras, scans, trackers ----------
export type EventSource = 'cctv' | 'scan' | 'rfid' | 'ble' | 'sensor';
export type EventKind =
  | 'bin_take' | 'bin_put'                       // a person takes from or puts into a bin (camera)
  | 'zone_entry' | 'motion'                      // entry to a restricted area, any motion (camera)
  | 'no_esd_coat' | 'forklift_speed' | 'aisle_blocked' | 'smoke' // safety (camera)
  | 'vehicle_arrived' | 'boxes_counted'          // dock (camera)
  | 'scan'                                       // QR or barcode scan (phone)
  | 'tag_exit'                                   // RFID gate at the store door
  | 'temperature';                               // environment sensor
export type RuleId = 'unrecorded' | 'zone' | 'after_hours' | 'ppe' | 'forklift' | 'aisle' | 'smoke' | 'dock_vehicle' | 'dock_count' | 'wrong_bin' | 'asset_exit' | 'temperature';
/** A clip of camera footage around an event; `held` keeps it past the retention period (it is evidence). */
export interface Clip { camera: string; from: string; to: string; held?: boolean }
export interface SensorEvent extends Doc {
  site: string; at: string; source: EventSource; kind: EventKind;
  camera?: string; device?: string;
  /** Location id (site:code) or area id the event is about. */
  loc?: string;
  /** Badge holder seen (BLE badge or scanner sign-in), tracker tag, scanned code. */
  person?: string; tag?: string; code?: string;
  /** Units seen, speed km/h, minutes, boxes, °C: depends on the kind. */
  qty?: number; value?: number;
  carrier?: string; plate?: string; ref?: string;
  /** Detector confidence 0–1 for camera analytics. */
  conf?: number;
  /** What the rules engine made of it. */
  outcome?: 'matched' | 'alert' | 'logged' | 'ignored'; note?: string; matched?: string; alert?: string;
  clip?: Clip | null;
  /** Generated by the demo simulator rather than a real device. */
  simulated?: boolean;
}
export interface Camera extends Doc {
  site: string; code: string; name: string;
  /** Position and aim in the store twin's metres; field of view in degrees. */
  pos: [number, number, number]; look: [number, number, number]; fov: number;
  status: 'online' | 'offline'; analytics: EventKind[];
}
export interface Tracker extends Doc {
  site: string; label: string; kind: 'trolley' | 'forklift' | 'badge' | 'asset'; tech: 'BLE' | 'UWB' | 'RFID';
  user?: string; partNo?: string; battery: number;
  /** Last known position in the store twin (metres) and zone. */
  x?: number; z?: number; zone?: string; lastSeen?: string;
}

/** Why stock moves (picks, issues, moves): masters behind the purpose and reason lists. */
export interface Purpose extends Doc { name: string; kind: MovementType; costCentre: string; active: boolean }
/** Standard store or area layouts used when a site's store is configured. */
export interface AreaTemplate extends Doc { name: string; zone: Zone; racks: number; bays: number; levels: number; binCapacity: number; note: string }
export interface CostCentre extends Doc { code: string; name: string; site: string; owner: string }

export interface AuditEntry extends Doc { at: string; user: string; action: 'insert' | 'update' | 'remove' | 'view' | 'unblur'; coll: Coll; docId: string; change?: Record<string, unknown> }

export interface Collections {
  users: User; parts: Part; locations: Location; stockLots: StockLot; movements: Movement;
  scrapCases: ScrapCase; shipments: Shipment; carriers: Carrier; approvalRules: ApprovalRule;
  alerts: Alert; auditLog: AuditEntry; purposes: Purpose; areaTemplates: AreaTemplate; costCentres: CostCentre;
  events: SensorEvent; cameras: Camera; trackers: Tracker;
}
export type Coll = keyof Collections;
export const COLLECTIONS: Coll[] = ['users', 'parts', 'locations', 'stockLots', 'movements', 'scrapCases', 'shipments', 'carriers', 'approvalRules', 'alerts', 'auditLog', 'purposes', 'areaTemplates', 'costCentres', 'events', 'cameras', 'trackers'];

/** Indexes the server creates; the demo database scans in memory and ignores them. */
export const INDEXES: Partial<Record<Coll, Record<string, 1 | -1>[]>> = {
  locations: [{ site: 1, code: 1 }],
  stockLots: [{ site: 1, partNo: 1 }, { site: 1, locationId: 1 }],
  movements: [{ site: 1, status: 1 }, { site: 1, createdAt: -1 }],
  scrapCases: [{ site: 1, step: 1 }],
  events: [{ site: 1, at: -1 }, { site: 1, loc: 1, at: -1 }],
  shipments: [{ site: 1, status: 1 }],
  alerts: [{ site: 1, status: 1 }],
  auditLog: [{ at: -1 }, { coll: 1, docId: 1 }],
};

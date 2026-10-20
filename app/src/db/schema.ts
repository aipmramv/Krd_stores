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
}

export type ScrapStep = 'tag' | 'reason' | 'approval' | 'move' | 'dispose' | 'writeoff' | 'closed';
export interface ScrapCase extends Doc {
  site: string; partNo: string; qty: number; value: number; reason: string; detail: string;
  step: ScrapStep; photos: string[]; approvals: Approval[];
  disposal?: string; certificate?: string; owner: string;
}

export interface Milestone { label: string; at?: string; done: boolean }
export interface ShipmentItem { partNo: string; qty: number }
export interface Shipment extends Doc {
  site: string; carrier: string; mode: 'road' | 'air' | 'rail' | 'courier';
  from: string; to: string; eta: string; status: string; dir: 'in' | 'out';
  items: ShipmentItem[]; milestones: Milestone[]; docs: string[];
  hold?: LatLng; cost?: number;
}

export interface Carrier extends Doc { name: string; modes: Shipment['mode'][]; contact: string }

export interface ApprovalRule extends Doc { kind: 'scrap' | 'move' | 'shipment'; minValue: number; chain: Role[]; note: string }

export type Severity = 'high' | 'medium' | 'info';
export interface Alert extends Doc { site: string; title: string; detail: string; severity: Severity; status: 'open' | 'ack' | 'closed'; at: string; ref?: string }

export interface AuditEntry extends Doc { at: string; user: string; action: 'insert' | 'update' | 'remove'; coll: Coll; docId: string; change?: Record<string, unknown> }

export interface Collections {
  users: User; parts: Part; locations: Location; stockLots: StockLot; movements: Movement;
  scrapCases: ScrapCase; shipments: Shipment; carriers: Carrier; approvalRules: ApprovalRule;
  alerts: Alert; auditLog: AuditEntry;
}
export type Coll = keyof Collections;
export const COLLECTIONS: Coll[] = ['users', 'parts', 'locations', 'stockLots', 'movements', 'scrapCases', 'shipments', 'carriers', 'approvalRules', 'alerts', 'auditLog'];

/** Indexes the server creates; the demo database scans in memory and ignores them. */
export const INDEXES: Partial<Record<Coll, Record<string, 1 | -1>[]>> = {
  locations: [{ site: 1, code: 1 }],
  stockLots: [{ site: 1, partNo: 1 }, { site: 1, locationId: 1 }],
  movements: [{ site: 1, status: 1 }, { site: 1, createdAt: -1 }],
  scrapCases: [{ site: 1, step: 1 }],
  shipments: [{ site: 1, status: 1 }],
  alerts: [{ site: 1, status: 1 }],
  auditLog: [{ at: -1 }, { coll: 1, docId: 1 }],
};

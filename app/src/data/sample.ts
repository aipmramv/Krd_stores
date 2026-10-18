// Sample data for the first build. Replace these exports with API-backed sources later;
// the rest of the app only depends on the shapes in ./types.
import type { ColorMode, LatLng, Part, PartStatus, RouteOption, ScreenId, Shipment, Site } from './types';

export const MODULES: [ScreenId, string][] = [
  ['network', 'Network'], ['routes', 'Routes'], ['site', 'Site twin'], ['store', 'Store twin'],
  ['shipments', 'Shipments'], ['movements', 'Moves & scrap'], ['reports', 'Reports & masters'], ['mobile', 'Mobile'],
];

export const SITES: Site[] = [
  { id: 'ktec', name: 'KTEC Chennai', type: 'R&D centre · Sriperumbudur', ll: [12.9280, 79.9130], space: 78, value: '₹152 Cr', ship: 37, alerts: 4, left: false },
  { id: 'chw', name: 'Chennai central warehouse', type: 'Warehouse · Oragadam', ll: [12.8340, 79.9530], space: 71, value: '₹64 Cr', ship: 22, alerts: 1, left: 'b' },
  { id: 'blr', name: 'Bengaluru test lab', type: 'Lab · Electronic City', ll: [12.8452, 77.6602], space: 55, value: '₹38 Cr', ship: 14, alerts: 0, left: true },
  { id: 'pnq', name: 'KTEC Pune', type: 'R&D centre · Hinjewadi', ll: [18.5913, 73.7389], space: 64, value: '₹71 Cr', ship: 19, alerts: 1, left: false },
  { id: 'bom', name: 'Bhiwandi logistics hub', type: '3PL hub · Bhiwandi', ll: [19.2960, 73.0630], space: 83, value: '₹29 Cr', ship: 31, alerts: 1, left: true },
  { id: 'del', name: 'Manesar regional store', type: 'Store · Manesar', ll: [28.3540, 76.9400], space: 47, value: '₹22 Cr', ship: 11, alerts: 0, left: false },
];
export const SITE_BY_ID: Record<string, Site> = Object.fromEntries(SITES.map(s => [s.id, s]));

/** [layer id, label, on by default] per screen. */
export const LAYERS: Partial<Record<ScreenId, [string, string, number][]>> = {
  network: [['sites', 'Sites', 1], ['ship', 'Shipments in transit', 1], ['xfer', 'Site-to-site transfers', 1], ['alerts', 'Alerts', 1]],
  routes: [['traffic', 'Live traffic', 1], ['weather', 'Weather risk', 1], ['hubs', 'Airports and rail heads', 1]],
  shipments: [['inb', 'Inbound', 1], ['outb', 'Outbound', 1], ['trail', 'Milestone trails', 1]],
  site: [['ctx', 'Neighbouring buildings', 1], ['img', 'Satellite ground', 1], ['lbl', 'Labels', 1], ['alerts3', 'Alerts', 1]],
  movements: [['flows', 'Internal moves', 1], ['scrapf', 'Scrap flows', 1], ['ctx', 'Neighbouring buildings', 1], ['lbl', 'Labels', 1]],
  store: [['ghost', 'Planned inbound', 1], ['resv', 'Reservations', 1], ['exc', 'Exceptions', 1], ['lbl', 'Labels', 1]],
};

export const LEGENDS: Record<ColorMode, [string, string][]> = {
  occupancy: [['#D0DCFD', 'Under 25%'], ['#A1B9FB', '25–50%'], ['#5F88F8', '50–75%'], ['#1450F5', '75–92%'], ['#FFE141', 'Near full']],
  ageing: [['#AAE1C8', 'Under 30 days'], ['#F3EEEA', '30–90 days'], ['#FFE141', '90–180 days'], ['#FFCDD7', 'Over 180 days']],
  project: [['#1450F5', 'DX Class 2027'], ['#D2F5FF', 'MonoSpace retrofit'], ['#AAE1C8', 'Escalator drive test'], ['#C4C7CD', 'Unassigned']],
  hazard: [['#D2F5FF', 'ESD sensitive'], ['#A1B9FB', 'Temperature controlled'], ['#FFCDD7', 'Hazmat'], ['#DEE0E4', 'General']],
};
export const COLOR_MODES: [ColorMode, string][] = [['occupancy', 'Occupancy'], ['ageing', 'Ageing'], ['project', 'Project'], ['hazard', 'Hazard']];

export const PARTS: Part[] = [
  ['KM-DX-ACT-220', 'C', 'Door operator actuator', 'Electromech', 'pcs', 'ESD', '—', 12, 4, 'D-05-04 · Chennai', 'DX Class 2027', 'Available'],
  ['KM-MS-CTL-118', 'B', 'MonoSpace controller board', 'Electronics', 'pcs', 'ESD', 'EAR99', 36, 10, 'A-02-03 · Chennai', 'MonoSpace retrofit', 'Available'],
  ['KM-ESC-DRV-040', 'A', 'Escalator drive gearbox', 'Mechanical', 'pcs', '—', '—', 4, 3, 'Heavy L0 · Chennai', 'Escalator drive test', 'Reserved'],
  ['KM-BAT-LI-500', 'D', 'Li-ion backup pack 48 V', 'Energy', 'pcs', 'UN3480', '5A992', 18, 0, 'Hazmat H-01 · Chennai', 'DX Class 2027', 'Quarantined'],
  ['KM-SNS-LDR-077', 'A', 'Lidar door sensor', 'Sensors', 'pcs', 'ESD', '5A991', 54, 12, 'B-08-02 · Chennai', 'People flow sensing', 'Available'],
  ['KM-RPE-HSR-210', 'F', 'Hoisting rope sample', 'Ropes', 'm', '—', '—', 240, 80, 'Test tower · Chennai', 'UltraRope trial', 'In transit'],
  ['KM-GUI-RAL-016', 'B', 'Guide rail T89 section', 'Structural', 'pcs', '—', '—', 22, 0, 'Yard Y-02 · Pune', '—', 'Available'],
  ['KM-CAB-PNL-301', 'C', 'Car panel prototype', 'Interior', 'pcs', '—', '—', 4, 4, 'Lab L-03 · Chennai', 'DX Class 2027', 'Consumed'],
  ['KM-LUB-SYN-005', 'A', 'Synthetic lubricant 5 L', 'Consumable', 'L', 'Flammable', '—', 60, 0, 'Hazmat H-02 · Chennai', '—', 'Available'],
  ['KM-MOT-PM-150', 'E', 'PM motor 15 kW', 'Electromech', 'pcs', '—', 'EAR99', 2, 1, 'Heavy L0 · Chennai', 'Escalator drive test', 'Planned'],
  ['KM-PCB-IOT-022', 'A', 'IoT gateway PCB', 'Electronics', 'pcs', 'ESD', '5A992', 120, 48, 'C-10-04 · Chennai', '24/7 Connected', 'Available'],
  ['KM-SFT-BRK-090', 'B', 'Safety brake assembly', 'Safety', 'pcs', '—', '—', 6, 2, 'Scrap yard · Chennai', 'DX Class 2027', 'Scrap pending'],
];
export const STATUS_DOT: Record<PartStatus, string> = {
  'Available': '#1B7F4E', 'Reserved': '#1450F5', 'Quarantined': '#C77700', 'In transit': '#A1B9FB',
  'Consumed': '#767A82', 'Planned': '#C4C7CD', 'Scrap pending': '#C8312B',
};

/** Fallback road geometry Chennai → Pune along NH48; replaced by OSRM when reachable. */
export const NH48: LatLng[] = [[12.928, 79.913], [12.92, 79.13], [12.52, 78.21], [12.97, 77.59], [13.34, 77.10], [14.23, 76.40], [14.46, 75.92], [15.36, 75.12], [15.85, 74.50], [16.70, 74.24], [17.68, 74.00], [18.5913, 73.7389]];
export const RAIL: LatLng[] = [[12.928, 79.913], [13.08, 80.27], [13.08, 79.67], [13.63, 79.51], [15.17, 77.37], [16.20, 77.36], [17.06, 76.99], [17.66, 75.91], [18.46, 74.58], [18.53, 73.87], [18.5913, 73.7389]];
/** Site → MAA airport, flight, PNQ airport → site. */
export const AIR: { siteA: LatLng; airportA: LatLng; airportB: LatLng; siteB: LatLng } = {
  siteA: [12.928, 79.913], airportA: [12.99, 80.17], airportB: [18.58, 73.92], siteB: [18.5913, 73.7389],
};

export const ROUTES: RouteOption[] = [
  { mode: 'Road · full truckload', carrier: 'Delhivery FTL · NH48 via Bengaluru', eta: '2.5 days', cost: '₹38,500', co2: '0.62 t', tag: 'Recommended', tagBg: '#AAE1C8', geom: 'road', fr: .38, ox: -110, oy: 0 },
  { mode: 'Air cargo', carrier: 'Blue Dart Aviation · MAA → PNQ', eta: '1 day', cost: '₹1,12,000', co2: '1.9 t', tag: 'Fastest', tagBg: '#D2F5FF', geom: 'air', fr: .5, ox: 0, oy: -46 },
  { mode: 'Rail container', carrier: 'CONCOR · Chennai → Pune via Solapur', eta: '4 days', cost: '₹22,800', co2: '0.18 t', tag: 'Lowest CO₂', tagBg: '#EFF1F4', geom: 'rail', fr: .62, ox: 120, oy: 10 },
  { mode: 'Express courier, split 2 + 4', carrier: 'DTDC Express + Delhivery FTL', eta: '1 / 2.5 days', cost: '₹61,400', co2: '0.9 t', tag: 'Split', tagBg: '#EFF1F4', geom: 'air' },
];

export const SHIPS: Shipment[] = [
  { id: 'DEL 2210 9934 7781', carrier: 'Delhivery', from: 'ktec', to: 'bom', eta: 'ETA 21 Oct', status: 'E-way bill hold', dot: '#C8312B', hold: [15.36, 75.12], dir: 'out' },
  { id: 'BD 88213 4410', carrier: 'Blue Dart', from: 'blr', to: 'del', eta: 'ETA 19 Oct', status: 'In transit', dot: '#1450F5', dur: 16, dir: 'out' },
  { id: 'GATI 5510 2231', carrier: 'Gati', from: 'chw', to: 'ktec', eta: 'Today 17:00', status: 'Out for delivery', dot: '#1B7F4E', dur: 6, dir: 'in' },
  { id: 'DTDC 7731 0020', carrier: 'DTDC', from: 'pnq', to: 'ktec', eta: 'ETA 20 Oct', status: 'In transit', dot: '#1450F5', dur: 14, dir: 'in' },
  { id: 'TCI 44120 889', carrier: 'TCI Freight', from: 'del', to: 'bom', eta: 'ETA 22 Oct', status: 'Delay risk', dot: '#C77700', dur: 18, dir: 'out' },
  { id: 'SFX 6612 0034', carrier: 'Safexpress', from: 'bom', to: 'pnq', eta: 'ETA 19 Oct', status: 'In transit', dot: '#1450F5', dur: 8, dir: 'in' },
  { id: 'DHL 7834 5521', carrier: 'DHL', from: 'ktec', to: 'blr', eta: 'ETA 19 Oct', status: 'In transit', dot: '#1450F5', dur: 9, dir: 'out' },
];

export const XFERS: [string, string][] = [['ktec', 'pnq'], ['chw', 'ktec'], ['ktec', 'blr'], ['bom', 'del']];

/** India extent used to frame the network map. */
export const INDIA_BOUNDS: [LatLng, LatLng] = [[8, 70], [29.5, 86]];

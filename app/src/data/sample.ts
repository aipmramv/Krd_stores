// Sample data for the first build. Replace these exports with API-backed sources later;
// the rest of the app only depends on the shapes in ./types.
import type { ColorMode, LatLng, Part, PartStatus, RouteOption, ScreenId, Shipment } from './types';

export const MODULES: [ScreenId, string][] = [
  ['network', 'Network'], ['routes', 'Routes'], ['site', 'Site twin'], ['store', 'Store twin'],
  ['shipments', 'Shipments'], ['movements', 'Moves & scrap'], ['reports', 'Reports & masters'], ['mobile', 'Mobile'],
];

export { SITE_BY_ID, SITES } from './sites';

/** [layer id, label, on by default] per screen. */
export const LAYERS: Partial<Record<ScreenId, [string, string, number][]>> = {
  network: [['sites', 'Sites', 1], ['ship', 'Shipments in transit', 1], ['xfer', 'Site-to-site transfers', 1], ['alerts', 'Alerts', 1]],
  routes: [['traffic', 'Live traffic', 1], ['weather', 'Weather risk', 1], ['hubs', 'Airports and rail heads', 1]],
  shipments: [['inb', 'Inbound', 1], ['outb', 'Outbound', 1], ['trail', 'Milestone trails', 1]],
  site: [['ctx', 'Neighbouring buildings', 1], ['img', 'OSM map ground', 1], ['trees', 'Trees', 1], ['veh', 'Vehicles', 1], ['photos', 'Photos', 1], ['lbl', 'Labels', 1], ['alerts3', 'Alerts', 1]],
  movements: [['flows', 'Internal moves', 1], ['scrapf', 'Scrap flows', 1], ['ctx', 'Neighbouring buildings', 1], ['trees', 'Trees', 1], ['veh', 'Vehicles', 1], ['lbl', 'Labels', 1]],
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

/** Fallback road geometry KTEC Chennai (Ambattur) → KTEC Pune (Aundh) along NH48 via Bengaluru; replaced by OSRM when reachable. */
export const NH48: LatLng[] = [[13.09217, 80.16324], [13.04, 79.93], [12.92, 79.13], [12.52, 78.21], [12.97, 77.59], [13.34, 77.10], [14.23, 76.40], [14.46, 75.92], [15.36, 75.12], [15.85, 74.50], [16.70, 74.24], [17.68, 74.00], [18.46, 73.85], [18.5631, 73.8078]];
/** Chennai Central → Pune Junction via Renigunta, Guntakal and Solapur. */
export const RAIL: LatLng[] = [[13.09217, 80.16324], [13.0827, 80.2757], [13.08, 79.67], [13.63, 79.51], [15.17, 77.37], [16.20, 77.36], [17.06, 76.99], [17.66, 75.91], [18.46, 74.58], [18.5285, 73.8743], [18.5631, 73.8078]];
/** Site → MAA airport, flight, PNQ airport → site. */
export const AIR: { siteA: LatLng; airportA: LatLng; airportB: LatLng; siteB: LatLng } = {
  siteA: [13.09217, 80.16324], airportA: [12.99, 80.17], airportB: [18.58, 73.92], siteB: [18.5631, 73.8078],
};

export const ROUTES: RouteOption[] = [
  { mode: 'Road · full truckload', carrier: 'Delhivery FTL · NH48 via Bengaluru', eta: '2.5 days', cost: '₹38,500', co2: '0.62 t', tag: 'Recommended', tagBg: '#AAE1C8', geom: 'road', fr: .38, ox: -110, oy: 0 },
  { mode: 'Air cargo', carrier: 'Blue Dart Aviation · MAA → PNQ', eta: '1 day', cost: '₹1,12,000', co2: '1.9 t', tag: 'Fastest', tagBg: '#D2F5FF', geom: 'air', fr: .5, ox: 0, oy: -46 },
  { mode: 'Rail container', carrier: 'CONCOR · Chennai → Pune via Solapur', eta: '4 days', cost: '₹22,800', co2: '0.18 t', tag: 'Lowest CO₂', tagBg: '#EFF1F4', geom: 'rail', fr: .62, ox: 120, oy: 10 },
  { mode: 'Express courier, split 2 + 4', carrier: 'DTDC Express + Delhivery FTL', eta: '1 / 2.5 days', cost: '₹61,400', co2: '0.9 t', tag: 'Split', tagBg: '#EFF1F4', geom: 'air' },
];

export const SHIPS: Shipment[] = [
  { id: 'DEL 2210 9934 7781', carrier: 'Delhivery', from: 'isu', to: 'pnq', eta: 'ETA 21 Oct', status: 'E-way bill hold', dot: '#C8312B', hold: [15.36, 75.12], dir: 'out' },
  { id: 'BD 88213 4410', carrier: 'Blue Dart', from: 'ktec', to: 'pnq', eta: 'ETA 19 Oct', status: 'In transit', dot: '#1450F5', dur: 16, dir: 'out' },
  { id: 'GATI 5510 2231', carrier: 'Gati', from: 'dhl', to: 'isu', eta: 'Today 17:00', status: 'Out for delivery', dot: '#1B7F4E', dur: 6, dir: 'in' },
  { id: 'DTDC 7731 0020', carrier: 'DTDC', from: 'pnq', to: 'ktec', eta: 'ETA 20 Oct', status: 'Delay risk', dot: '#C77700', dur: 14, dir: 'in' },
  { id: 'TCI 44120 889', carrier: 'TCI Freight', from: 'dhl', to: 'pnq', eta: 'ETA 22 Oct', status: 'In transit', dot: '#1450F5', dur: 18, dir: 'out' },
  { id: 'SFX 6612 0034', carrier: 'Safexpress', from: 'isu', to: 'ktec', eta: 'Today 15:30', status: 'In transit', dot: '#1450F5', dur: 8, dir: 'in' },
  { id: 'DHL 7834 5521', carrier: 'DHL', from: 'dhl', to: 'ktec', eta: 'ETA 19 Oct', status: 'In transit', dot: '#1450F5', dur: 9, dir: 'out' },
];

export const XFERS: [string, string][] = [['ktec', 'pnq'], ['dhl', 'isu'], ['isu', 'ktec'], ['dhl', 'ktec']];

/** Frames all key sites (Chennai cluster and Pune) with room for labels. */
export const NETWORK_BOUNDS: [LatLng, LatLng] = [[11.6, 72.6], [19.6, 81.4]];

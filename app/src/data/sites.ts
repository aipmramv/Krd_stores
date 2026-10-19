// The four key KONE sites in India. Coordinates and addresses are real; facility roles are
// matched at runtime to the nearest large OpenStreetMap buildings around each coordinate.
import type { Facility, Site } from './types';

const HAZMAT: Facility = { k: 'haz', n: 'Hazmat store', s: '31 °C · limit 25 °C', info: 'Li-ion packs and flammables · temperature 31 °C, limit 25 °C', col: '#FFCDD7', facade: 'concrete', alert: true };
const QUARANTINE: Facility = { k: 'qua', n: 'Quarantine', s: '2 lots on hold', info: '2 lots on hold · awaiting QA release', col: '#FFE141', facade: 'metal' };

export const SITES: Site[] = [
  {
    id: 'ktec', name: 'KTEC Chennai', short: 'KTEC Chennai', type: 'R&D centre · Ambattur', kind: 'rnd',
    address: 'Tower-B, Kosmo One (One India Bulls Tech Park), Plot No. 14, 3rd Main Rd, Sai Nagar, Ambattur Industrial Estate, Chennai, Tamil Nadu 600058',
    ll: [13.09217, 80.16324], ellH: -74, space: 78, value: '₹152 Cr', ship: 37, left: false,
    facilities: [
      { k: 'main', n: 'Tower-B · KTEC', s: 'Labs, prototype store, engineering', info: 'KTEC labs, prototype and electronics store on the lower floors, engineering above', col: '#A1B9FB', facade: 'glass',
        floors: [['Lower floors · labs and electronics store', '84%'], ['Middle floors · engineering', '61%'], ['Upper floors · offices', '—']], storeFloor: 0 },
      { k: 'twa', n: 'Tower-A · tech park', s: 'Shared amenities', info: 'Neighbouring tower in Kosmo One · shared cafeteria and training rooms', col: '#D2F5FF', facade: 'glass' },
      { k: 'park', n: 'Multi-level parking', s: 'Visitor and staff', info: 'Parking and courier drop-off', col: '#F7F8FA', facade: 'concrete' },
      { k: 'stg', n: 'Service yard and receiving', s: '5 inbound today', info: 'Goods receiving for the tech park · 5 inbound today, 2 slots free', col: '#AAE1C8', facade: 'metal' },
      HAZMAT,
    ],
    flows: [
      ['stg', 'main', '#AAE1C8', 'Put-away · 18 cartons', 'flows'],
      ['main', 'haz', '#FFCDD7', 'Li-ion packs to hazmat · 4', 'flows'],
      ['main', 'stg', '#A1B9FB', 'Prototypes to ISU · 6 crates', 'flows'],
      ['main', 'park', '#C8312B', 'E-waste · SC-2026-0421', 'scrapf'],
    ],
    alerts: [
      ['Hazmat store temperature 31 °C', 'Limit 25 °C · 12 min ago', '#C8312B'],
      ['Cycle count variance, C-10-04', 'System 40 · scanned 36', '#C8312B'],
      ['Inbound pressure on receiving, 21 Oct', '5 deliveries planned · 2 slots free', '#C77700'],
    ],
  },
  {
    id: 'isu', name: 'KONE ISU & Test Tower', short: 'ISU Sriperumbudur', type: 'Factory and test tower · SIPCOT Sriperumbudur', kind: 'factory',
    address: 'KONE Elevator India Private Limited Factory, Plot No: A 28, SIPCOT Industrial Park, Irumbedu Main Road, Pillaipakkam, Sriperumbudur Taluk, Kancheepuram District, Tamil Nadu 602105',
    ll: [12.9868, 79.9922], ellH: -45, space: 71, value: '₹212 Cr', ship: 44, left: true,
    facilities: [
      { k: 'main', n: 'ISU production hall', s: 'Assembly lines · mezzanine store', info: 'Elevator and door-operator assembly · electronics store on the mezzanine', col: '#A1B9FB', facade: 'metal',
        floors: [['Ground · assembly lines', '72%'], ['Mezzanine · electronics store', '84%'], ['Roof · solar and plant', '—']], storeFloor: 1 },
      { k: 'tow', n: 'KONE test tower', s: 'Shaft 2 in test', info: 'Lift test tower · shaft 2 running a 15 kW PM motor endurance test', col: '#1450F5', facade: 'concrete', modelled: 'test_tower' },
      { k: 'wh', n: 'Component warehouse', s: 'Line-side supply', info: 'Kitting and line-side supply for the assembly lines', col: '#D2F5FF', facade: 'metal' },
      { k: 'adm', n: 'Admin and training', s: 'Badge access', info: 'Offices, training centre and visitor reception', col: '#F7F8FA', facade: 'glass' },
      { k: 'stg', n: 'Dispatch docks', s: '14 crates today', info: 'Outbound dispatch to sites and the DHL warehouse · 14 crates today', col: '#AAE1C8', facade: 'metal' },
      HAZMAT, QUARANTINE,
      { k: 'scr', n: 'Scrap yard', s: '4 open cases', info: '4 open scrap cases · disposal vendor pick-up Friday', col: '#F3EEEA', facade: 'concrete', modelled: 'yard' },
    ],
    flows: [
      ['wh', 'main', '#D2F5FF', 'Line feed · 120 kits', 'flows'],
      ['main', 'tow', '#A1B9FB', 'Tower test · 2 drives', 'flows'],
      ['tow', 'scr', '#C8312B', 'Scrap · SC-2026-0418', 'scrapf'],
      ['main', 'qua', '#FFE141', 'Quarantine · 2 lots', 'flows'],
      ['main', 'stg', '#AAE1C8', 'Dispatch · 14 crates', 'flows'],
    ],
    alerts: [
      ['Hazmat store temperature 29 °C', 'Limit 25 °C · 40 min ago', '#C8312B'],
      ['Test tower shaft 2 vibration high', 'Endurance run paused · engineer notified', '#C77700'],
    ],
  },
  {
    id: 'dhl', name: 'KONE – DHL Warehouse', short: 'DHL Oragadam', type: '3PL warehouse · IndoSpace Oragadam', kind: 'warehouse',
    address: 'DHL Supply Chain India, S.F. No. 2/5, IndoSpace Oragadam 3, ILP 3 India 13 Private Limited, Ezhichur Road, Oragadam, Kancheepuram District, Tamil Nadu 631606',
    ll: [12.8105, 79.9575], ellH: -25, space: 83, value: '₹96 Cr', ship: 52, left: 'b',
    facilities: [
      { k: 'main', n: 'DHL KONE distribution centre', s: 'Racking · small-parts mezzanine', info: 'Pallet racking on the ground floor, small parts and electronics on the mezzanine', col: '#A1B9FB', facade: 'metal',
        floors: [['Ground · pallet racking', '86%'], ['Mezzanine · small parts and electronics', '84%'], ['Roof · solar', '—']], storeFloor: 1 },
      { k: 'dc2', n: 'IndoSpace building 2', s: 'Overflow · cross-dock', info: 'Shared IndoSpace building used for overflow and cross-docking', col: '#D2F5FF', facade: 'metal' },
      { k: 'stg', n: 'Gate and security', s: '9 trucks in yard', info: 'Truck gate, weighbridge and security · 9 trucks in the yard', col: '#AAE1C8', facade: 'concrete' },
      QUARANTINE,
    ],
    flows: [
      ['dc2', 'main', '#D2F5FF', 'Cross-dock · 22 pallets', 'flows'],
      ['main', 'qua', '#FFE141', 'Quarantine · 2 lots', 'flows'],
      ['main', 'stg', '#AAE1C8', 'Outbound to ISU · 3 trucks', 'flows'],
      ['main', 'stg', '#C8312B', 'Damaged returns · SC-2026-0425', 'scrapf'],
    ],
    alerts: [['Inbound pressure on docks, 21 Oct', '9 trucks booked · 6 doors free', '#C77700']],
  },
  {
    id: 'pnq', name: 'KTEC Pune', short: 'KTEC Pune', type: 'R&D centre · Aundh', kind: 'rnd',
    address: 'KONE Technology & Engineering Center (KTEC), Westend Icon, Westend Mall Campus, Ward No. 8, Wireless Colony, Aundh, Pune, Maharashtra 411067',
    ll: [18.5631, 73.8078], ellH: 497, space: 64, value: '₹71 Cr', ship: 19, left: false,
    facilities: [
      { k: 'main', n: 'Westend Icon · KTEC', s: 'Labs and engineering', info: 'KTEC Pune labs and stores on the lower floors, engineering and offices above', col: '#A1B9FB', facade: 'glass',
        floors: [['Lower floors · labs and electronics store', '78%'], ['Middle floors · engineering', '58%'], ['Upper floors · offices', '—']], storeFloor: 0 },
      { k: 'mall', n: 'Westend Mall', s: 'Campus neighbour', info: 'Westend Mall on the same campus · visitor parking', col: '#F7F8FA', facade: 'glass' },
      { k: 'stg', n: 'Service yard and receiving', s: '3 inbound today', info: 'Goods receiving for the campus · 3 inbound today', col: '#AAE1C8', facade: 'concrete' },
      { k: 'park', n: 'Parking structure', s: 'Staff parking', info: 'Staff parking and courier drop-off', col: '#F3EEEA', facade: 'concrete' },
    ],
    flows: [
      ['stg', 'main', '#AAE1C8', 'Put-away · 6 cartons', 'flows'],
      ['main', 'stg', '#A1B9FB', 'Samples to Chennai · 2 crates', 'flows'],
    ],
    alerts: [['DTDC 7731 0020 to Chennai delayed', 'Pickup missed · rebooked for today', '#C77700']],
  },
];

export const SITE_BY_ID: Record<string, Site> = Object.fromEntries(SITES.map(s => [s.id, s]));
export const primary = (s: Site) => s.facilities[0];

// Photos around a site. With a Google Maps Platform key: Google Places photos of nearby buildings and
// Street View images aimed at each KONE facility from the nearest road. Always: geotagged Wikimedia
// Commons photos, plus Mapillary when a token is configured. Results are cached per site for the session.
import { SITE_BY_ID } from '../data/sites';
import { getState, setState, type Photo, type PhotoState } from '../state/store';

const RADIUS_M = 2000;
const strip = (html = '') => html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

interface CommonsPage {
  pageid: number;
  title: string;
  coordinates?: { lat: number; lon: number }[];
  imageinfo?: { thumburl?: string; url: string; descriptionurl: string; extmetadata?: Record<string, { value: string }> }[];
}

async function commons(lat: number, lon: number): Promise<Photo[]> {
  const q = new URLSearchParams({
    action: 'query', format: 'json', origin: '*', generator: 'geosearch',
    ggscoord: `${lat}|${lon}`, ggsradius: String(RADIUS_M), ggslimit: '40', ggsnamespace: '6',
    prop: 'imageinfo|coordinates', iiprop: 'url|extmetadata', iiurlwidth: '640',
  });
  const r = await fetch(`https://commons.wikimedia.org/w/api.php?${q}`);
  const j: { query?: { pages?: Record<string, CommonsPage> } } = await r.json();
  return Object.values(j.query?.pages ?? {}).flatMap(p => {
    const ii = p.imageinfo?.[0];
    if (!ii || !/\.(jpe?g|png|webp)$/i.test(ii.url)) return [];
    const m = ii.extmetadata ?? {};
    const c = p.coordinates?.[0];
    return [{
      id: 'c' + p.pageid,
      title: strip(m.ObjectName?.value) || p.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, ''),
      thumb: ii.thumburl ?? ii.url, full: ii.url, page: ii.descriptionurl,
      credit: strip(m.Artist?.value) || 'Wikimedia Commons contributor',
      licence: strip(m.LicenseShortName?.value) || 'See source',
      ll: c ? [c.lat, c.lon] : null, source: 'Wikimedia Commons' as const,
    }];
  });
}

async function mapillary(lat: number, lon: number, token: string): Promise<Photo[]> {
  const d = 0.006;
  const q = new URLSearchParams({
    access_token: token, fields: 'id,thumb_1024_url,thumb_256_url,computed_geometry,captured_at,creator', limit: '24',
    bbox: [lon - d, lat - d, lon + d, lat + d].join(','),
  });
  const r = await fetch(`https://graph.mapillary.com/images?${q}`);
  const j: { data?: { id: string; thumb_256_url?: string; thumb_1024_url?: string; computed_geometry?: { coordinates: [number, number] }; captured_at?: number; creator?: { username?: string } }[] } = await r.json();
  return (j.data ?? []).filter(x => x.thumb_1024_url).map(x => ({
    id: 'm' + x.id,
    title: 'Street view' + (x.captured_at ? ` · ${new Date(x.captured_at).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}` : ''),
    thumb: x.thumb_256_url ?? x.thumb_1024_url!, full: x.thumb_1024_url!, page: `https://www.mapillary.com/app/?pKey=${x.id}`,
    credit: x.creator?.username ?? 'Mapillary contributor', licence: 'CC BY-SA 4.0',
    ll: x.computed_geometry ? [x.computed_geometry.coordinates[1], x.computed_geometry.coordinates[0]] : null,
    source: 'Mapillary' as const,
  }));
}

interface PlacesPhoto { name: string; authorAttributions?: { displayName?: string; uri?: string }[] }
interface Place { id: string; displayName?: { text: string }; location?: { latitude: number; longitude: number }; photos?: PlacesPhoto[] }

/** Google Places (New): photos of places within 700 m. Needs the Places API enabled on the key. */
async function googlePlaces(lat: number, lon: number, key: string): Promise<Photo[]> {
  const r = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.photos' },
    body: JSON.stringify({ maxResultCount: 20, rankPreference: 'DISTANCE', locationRestriction: { circle: { center: { latitude: lat, longitude: lon }, radius: 700 } } }),
  });
  if (!r.ok) throw new Error('places ' + r.status);
  const j: { places?: Place[] } = await r.json();
  const media = (name: string, w: number) => `https://places.googleapis.com/v1/${name}/media?maxWidthPx=${w}&key=${encodeURIComponent(key)}`;
  return (j.places ?? []).flatMap(p => (p.photos ?? []).slice(0, 2).map((ph, i) => ({
    id: `g${p.id}-${i}`, title: p.displayName?.text ?? 'Nearby place',
    thumb: media(ph.name, 400), full: media(ph.name, 1600),
    page: ph.authorAttributions?.[0]?.uri ?? `https://www.google.com/maps/place/?q=place_id:${p.id}`,
    credit: ph.authorAttributions?.map(a => a.displayName).filter(Boolean).join(', ') || 'Google Maps contributor',
    licence: 'Google Maps', ll: p.location ? [p.location.latitude, p.location.longitude] as [number, number] : null,
    source: 'Google Places' as const,
  }))).slice(0, 24);
}

/** A Street View shot: stand at `from` and look along `heading` (degrees from north) at a facility. */
export interface StreetViewTarget { title: string; from: [number, number]; heading: number }
const svTargets: Record<string, StreetViewTarget[]> = {};

function streetView(t: StreetViewTarget, key: string, i: number): Photo {
  const [lat, lon] = t.from;
  const url = (size: string) => `https://maps.googleapis.com/maps/api/streetview?size=${size}&location=${lat.toFixed(6)},${lon.toFixed(6)}&heading=${t.heading.toFixed(0)}&pitch=6&fov=75&radius=120&source=outdoor&return_error_code=true&key=${encodeURIComponent(key)}`;
  return {
    id: `sv${i}-${lat.toFixed(5)}`, title: `Street View · ${t.title}`, thumb: url('400x400'), full: url('1280x800'),
    page: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}&heading=${t.heading.toFixed(0)}`,
    credit: 'Google Street View', licence: 'Google Maps', ll: t.from, source: 'Google Street View',
  };
}

/** Put Street View shots first once both the photo list and the facility viewpoints are known. */
function mergeStreetViews(siteId: string) {
  const key = getState().googleKey, ph = getState().photos[siteId], targets = svTargets[siteId];
  if (!key || !targets || ph?.status !== 'ready' || ph.items.some(p => p.source === 'Google Street View')) return;
  setState(s => ({ photos: { ...s.photos, [siteId]: { status: 'ready', items: [...targets.map((t, i) => streetView(t, key, i)), ...ph.items] } } }));
}

/** Called by the site scene once facilities are matched to real buildings and roads. */
export function setStreetViewTargets(siteId: string, targets: StreetViewTarget[]) {
  svTargets[siteId] = targets;
  mergeStreetViews(siteId);
}

/** Forget loaded photos, e.g. after the Google key changes, and reload the current site's. */
export function reloadPhotos(siteId: string) {
  setState({ photos: {} });
  loadPhotos(siteId);
}

/** Load photos for a site once; components read them from the store. */
export function loadPhotos(siteId: string) {
  if (getState().photos[siteId]) return;
  const site = SITE_BY_ID[siteId];
  const set = (v: PhotoState) => setState(s => ({ photos: { ...s.photos, [siteId]: v } }));
  set({ status: 'loading' });
  const [lat, lon] = site.ll;
  const token = import.meta.env.VITE_MAPILLARY_TOKEN, key = getState().googleKey;
  Promise.allSettled([
    commons(lat, lon),
    token ? mapillary(lat, lon, token) : Promise.resolve([]),
    key ? googlePlaces(lat, lon, key) : Promise.resolve([]),
  ]).then(([c, m, g]) => {
    const ok = (r: PromiseSettledResult<Photo[]>) => (r.status === 'fulfilled' ? r.value : []);
    const items = [...ok(g), ...ok(m), ...ok(c)];
    if (!items.length && c.status === 'rejected' && !key) set({ status: 'error' });
    else set({ status: 'ready', items });
    mergeStreetViews(siteId);
  });
}

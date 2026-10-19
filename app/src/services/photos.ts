// Photos around a site: geotagged Wikimedia Commons photos (open, no key) and, when a token is
// configured, Mapillary street-level imagery. Results are cached per site for the session.
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

/** Load photos for a site once; components read them from the store. */
export function loadPhotos(siteId: string) {
  if (getState().photos[siteId]) return;
  const site = SITE_BY_ID[siteId];
  const set = (v: PhotoState) => setState(s => ({ photos: { ...s.photos, [siteId]: v } }));
  set({ status: 'loading' });
  const [lat, lon] = site.ll;
  const token = import.meta.env.VITE_MAPILLARY_TOKEN;
  Promise.allSettled([commons(lat, lon), token ? mapillary(lat, lon, token) : Promise.resolve([])]).then(([c, m]) => {
    const ok = (r: PromiseSettledResult<Photo[]>) => (r.status === 'fulfilled' ? r.value : []);
    const items = [...ok(m), ...ok(c)];
    if (!items.length && c.status === 'rejected') set({ status: 'error' });
    else set({ status: 'ready', items });
  });
}

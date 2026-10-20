// Scrap cases, in the order the steps happen:
//   tag      units of a stock lot are tagged (held so nobody uses them), with photos
//   reason   reason and detail; submitting picks the approval chain by value (approvalRules 'scrap')
//   approval each approver in turn approves (rejecting releases the units and closes the case)
//   move     store staff move the units to the scrap yard
//   dispose  EHS or a store manager records the disposal route, vendor and pick-up
//   writeoff finance attaches the disposal certificate and posts the write-off
//   closed   written off, rejected or cancelled
import { db, newId } from '../db';
import type { Approval, Role, ScrapCase, ScrapStep, User } from '../db/schema';

export const STEPS: [ScrapStep, string][] = [['tag', 'Tag'], ['reason', 'Reason'], ['approval', 'Approval'], ['move', 'Move'], ['dispose', 'Dispose'], ['writeoff', 'Write-off']];
export const REASONS = ['Destructive test · not reusable', 'Damaged in handling', 'Failed QA or burn-in', 'Obsolete revision', 'Expired shelf life', 'E-waste · end of life'];
export const DISPOSALS = ['Recycle · authorised metals vendor', 'E-waste recycler · CPCB authorised', 'Hazardous waste · TSDF', 'Return to supplier'];

/** Roles that may act on each step (admin may always). */
const ACTORS: Partial<Record<ScrapStep, Role[]>> = {
  reason: ['engineer', 'clerk', 'storeManager', 'ehs'],
  move: ['clerk', 'storeManager'],
  dispose: ['ehs', 'storeManager'],
  writeoff: ['finance'],
};

async function who(userId: string) {
  const u = await db.get('users', userId);
  if (!u) throw new Error('Unknown user');
  return u;
}
async function load(id: string) {
  const c = await db.get('scrapCases', id);
  if (!c) throw new Error('Scrap case not found');
  return c;
}
const event = (c: ScrapCase, user: User, step: ScrapStep, note: string) => [...(c.history ?? []), { at: new Date().toISOString(), user: user._id, step, note }];

export function canAct(c: ScrapCase, user: User | null): boolean {
  if (!user || c.step === 'closed') return false;
  if (user.role === 'admin') return true;
  if (c.step === 'approval') return nextApproval(c, user) !== null;
  if (c.step === 'tag') return c.owner === user._id;
  return (ACTORS[c.step] ?? []).includes(user.role);
}

export function nextApproval(c: ScrapCase, user: User | null): Approval | null {
  if (!user || c.step !== 'approval') return null;
  const next = c.approvals.find(a => a.decision === 'pending');
  return next && (next.role === user.role || user.role === 'admin') ? next : null;
}

/** Step 1: tag units of a lot for scrap; they are held immediately. */
export async function tag(input: { lotId: string; qty: number; photos: string[]; note?: string }, userId: string) {
  const [user, lot] = await Promise.all([who(userId), db.get('stockLots', input.lotId)]);
  if (!lot) throw new Error('Choose the stock to scrap');
  const free = lot.qty - lot.reserved;
  if (!Number.isInteger(input.qty) || input.qty < 1) throw new Error('Enter a quantity of at least 1');
  if (input.qty > free) throw new Error(`Only ${free} unreserved ${free === 1 ? 'unit' : 'units'} in this lot`);
  const part = await db.get('parts', lot.partNo);
  await db.update('stockLots', lot._id, { reserved: lot.reserved + input.qty, status: lot.reserved + input.qty >= lot.qty ? 'Scrap pending' : lot.status });
  const id = newId('SC');
  const c: Omit<ScrapCase, '_id'> = {
    site: lot.site, partNo: lot.partNo, qty: input.qty, value: input.qty * (part?.unitCost ?? 0), reason: '', detail: input.note ?? '',
    step: 'reason', photos: input.photos.slice(0, 4), approvals: [], lotId: lot._id, owner: user._id,
    history: [{ at: new Date().toISOString(), user: user._id, step: 'tag', note: `Tagged ${input.qty} in ${lot.locationId.split(':')[1]}` }],
  };
  return db.insert('scrapCases', { ...c, _id: id });
}

/** Step 2: give the reason and send for approval; the chain depends on the value. */
export async function submitReason(id: string, reason: string, detail: string, userId: string) {
  const [c, user] = await Promise.all([load(id), who(userId)]);
  if (c.step !== 'reason' || !canAct(c, user)) throw new Error('This case is not waiting for a reason from you');
  if (!reason) throw new Error('Choose a reason');
  const rules = (await db.find('approvalRules', { kind: 'scrap', minValue: { $lte: c.value } }, { sort: { minValue: -1 }, limit: 1 }));
  const chain = rules[0]?.chain ?? ['ehs'];
  const approvals: Approval[] = chain.map(role => ({ role, decision: 'pending' }));
  return db.update('scrapCases', id, { reason, detail, approvals, step: 'approval', history: event(c, user, 'reason', `${reason} · sent to ${chain.join(' → ')}`) });
}

export async function addPhotos(id: string, photos: string[], userId: string) {
  const [c, user] = await Promise.all([load(id), who(userId)]);
  return db.update('scrapCases', id, { photos: [...c.photos, ...photos].slice(0, 4), history: event(c, user, c.step, `Added ${photos.length} photo${photos.length === 1 ? '' : 's'}`) });
}

/** Step 3: the next approver decides. Rejecting releases the held units and closes the case. */
export async function decide(id: string, decision: 'approved' | 'rejected', userId: string, note = '') {
  const [c, user] = await Promise.all([load(id), who(userId)]);
  const next = nextApproval(c, user);
  if (!next) throw new Error(`Waiting for ${c.approvals.find(a => a.decision === 'pending')?.role ?? 'nobody'}`);
  const approvals = c.approvals.map(a => (a === next ? { ...a, user: user._id, decision, at: new Date().toISOString(), note } : a));
  if (decision === 'rejected') {
    await release(c);
    return db.update('scrapCases', id, { approvals, step: 'closed', outcome: 'rejected', history: event(c, user, 'approval', `Rejected${note ? ` · ${note}` : ''}`) });
  }
  const done = approvals.every(a => a.decision === 'approved');
  return db.update('scrapCases', id, { approvals, step: done ? 'move' : 'approval', history: event(c, user, 'approval', `Approved as ${next.role}${note ? ` · ${note}` : ''}`) });
}

/** Step 4: units go to the scrap yard (already there for cases raised in the yard). */
export async function moveToYard(id: string, userId: string) {
  const [c, user] = await Promise.all([load(id), who(userId)]);
  if (c.step !== 'move' || !canAct(c, user)) throw new Error('Only store staff can move approved scrap');
  const lot = c.lotId ? await db.get('stockLots', c.lotId) : null;
  if (!lot) throw new Error('The tagged stock lot no longer exists');
  const yard = `${c.site}:Scrap yard`;
  let yardLotId = lot._id;
  if (lot.locationId !== yard) {
    const rest = lot.qty - c.qty;
    if (rest > 0) await db.update('stockLots', lot._id, { qty: rest, reserved: Math.max(0, lot.reserved - c.qty), status: lot.reserved - c.qty > 0 ? lot.status : 'Available' });
    else await db.remove('stockLots', lot._id);
    yardLotId = (await db.insert('stockLots', { site: c.site, partNo: c.partNo, locationId: yard, lot: lot.lot, qty: c.qty, reserved: c.qty, status: 'Scrap pending', project: lot.project, receivedAt: lot.receivedAt }, 'LOT'))._id;
  }
  return db.update('scrapCases', id, { step: 'dispose', yardLotId, history: event(c, user, 'move', lot.locationId === yard ? 'Confirmed in scrap yard' : `Moved ${c.qty} to scrap yard`) });
}

/** Step 5: record how and by whom it is disposed of; the units leave stock. */
export async function dispose(id: string, input: { disposal: string; vendor: string; pickupDate: string }, userId: string) {
  const [c, user] = await Promise.all([load(id), who(userId)]);
  if (c.step !== 'dispose' || !canAct(c, user)) throw new Error('Only EHS or a store manager can record disposal');
  if (!input.disposal || !input.vendor.trim()) throw new Error('Choose the disposal route and enter the vendor');
  const lot = c.yardLotId ? await db.get('stockLots', c.yardLotId) : null;
  if (lot) {
    if (lot.qty - c.qty > 0) await db.update('stockLots', lot._id, { qty: lot.qty - c.qty, reserved: Math.max(0, lot.reserved - c.qty) });
    else await db.remove('stockLots', lot._id);
  }
  return db.update('scrapCases', id, { ...input, vendor: input.vendor.trim(), step: 'writeoff', history: event(c, user, 'dispose', `${input.disposal} · ${input.vendor.trim()} · pick-up ${input.pickupDate}`) });
}

/** Step 6: finance attaches the certificate and posts the write-off. */
export async function writeOff(id: string, input: { certificate: string; certificateFile?: string }, userId: string) {
  const [c, user] = await Promise.all([load(id), who(userId)]);
  if (c.step !== 'writeoff' || !canAct(c, user)) throw new Error('Only finance can post the write-off');
  if (!input.certificate.trim()) throw new Error('Enter the disposal certificate number');
  const writeOffRef = newId('FI-WO');
  return db.update('scrapCases', id, { ...input, certificate: input.certificate.trim(), writeOffRef, step: 'closed', outcome: 'written-off', history: event(c, user, 'writeoff', `Certificate ${input.certificate.trim()} · write-off ${writeOffRef} posted`) });
}

/** The owner can withdraw a case until it is approved. */
export async function cancelCase(id: string, userId: string) {
  const [c, user] = await Promise.all([load(id), who(userId)]);
  if (!['reason', 'approval'].includes(c.step) || (c.owner !== user._id && user.role !== 'admin')) throw new Error('Only the owner can withdraw a case before approval');
  await release(c);
  return db.update('scrapCases', id, { step: 'closed', outcome: 'cancelled', history: event(c, user, c.step, 'Withdrawn by owner') });
}

async function release(c: ScrapCase) {
  const lot = c.lotId ? await db.get('stockLots', c.lotId) : null;
  if (!lot) return;
  const reserved = Math.max(0, lot.reserved - c.qty);
  await db.update('stockLots', lot._id, { reserved, status: lot.status === 'Scrap pending' && reserved < lot.qty ? 'Available' : lot.status });
}

/** Shrink a photo to a JPEG data URL so it can be stored with the case. */
export async function photoToDataUrl(file: File, max = 720): Promise<string> {
  const img = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', .72);
}

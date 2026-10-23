// Who may see camera footage (India's DPDP Act 2023: purpose limitation and access by role).
//   view    live view and clips: store management, EHS, logistics, administrators
//   unblur  faces are pixelated for everyone; only EHS and administrators may unblur, and every
//           unblur is audited with the reason
//   hold    keep a clip past the 30-day retention as evidence: store manager, EHS, administrators
// Store clerks see the event log and the detections, not the footage.
import type { Role, User } from '../db/schema';

const VIEW: Role[] = ['storeManager', 'ehs', 'logistics', 'admin', 'leadership'];
const UNBLUR: Role[] = ['ehs', 'admin'];
const HOLD: Role[] = ['storeManager', 'ehs', 'admin'];
export const canView = (u: User | null | undefined) => !!u && VIEW.includes(u.role);
export const canUnblur = (u: User | null | undefined) => !!u && UNBLUR.includes(u.role);
export const canHold = (u: User | null | undefined) => !!u && HOLD.includes(u.role);
export const PRIVACY_NOTE = 'Faces are blurred by default. Viewing and unblurring are recorded in the audit log. Footage is deleted after 30 days unless it is held as evidence.';

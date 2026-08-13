/**
 * The whole data model, which is rather the point.
 *
 * The full app has nine rider statuses, a transition table the database
 * enforces, trips, and a custody record. None of that is here. This app knows
 * about **buses, stops, and where a bus currently is** — and nothing at all
 * about where a child is.
 *
 * If you find yourself adding a type that asserts something about a child's
 * whereabouts, you are rebuilding the full app. Read AGENTS.md.
 */

/** Five roles become three. There is no driver in this app. */
export type Role = 'student' | 'parent' | 'admin';

/**
 * Kept from the full app because it is the one piece of its auth model worth
 * every line: nobody picks their own role. It comes off the invite.
 */
export type AccountStatus = 'pending' | 'active' | 'suspended';

export interface Profile {
  id: string;
  role: Role;
  full_name: string;
  email: string | null;
  phone: string | null;
  status: AccountStatus;
  created_at: string;
}

export interface Organization {
  id: number;
  name: string;
  /**
   * The timezone the buses run in — a region name like 'America/New_York', not
   * an abbreviation like 'EST' (a fixed −05:00, wrong all summer).
   *
   * Nothing here compares a wall clock yet, because there are no planned times.
   * It is stored from the first schema anyway: the full app shipped without it
   * and every time comparison was silently four hours out, and retrofitting it
   * touched five functions.
   */
  time_zone: string;
  /** Minutes-away milestones that trigger a notification. */
  alert_minutes: number[];
  /** How close the bus must be to count as "at the stop", in metres. */
  geofence_radius_m: number;
}

/** A vehicle. It has no driver in this app — a tracker reports its position. */
export interface Bus {
  id: string;
  label: string;
  plate: string | null;
  active: boolean;
}

export interface Stop {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  active: boolean;
}

/** One stop's place in one bus's ordered run. This replaces the full app's routes. */
export interface BusStop {
  id: string;
  bus_id: string;
  stop_id: string;
  position: number;
}

/**
 * Which bus a student rides and which stop they use.
 *
 * `uses_it` is the opt-out: a student assigned to a bus can be marked as not
 * using a particular stop. It is the only thing a family's setup can express.
 */
export interface StudentStop {
  id: string;
  student_id: string;
  bus_id: string;
  stop_id: string;
  uses_it: boolean;
}

/** A position report from the tracker in the vehicle. Never from a phone. */
export interface BusLocation {
  id: number;
  bus_id: string;
  lat: number;
  lng: number;
  heading: number | null;
  speed: number | null;
  recorded_at: string;
}

/**
 * How an account comes into existence. Ported intact from the full app, because
 * the rule it encodes is the one worth keeping: the role lives on the INVITE,
 * and the signup trigger reads it from there rather than from anything the
 * client sends.
 */
export interface Invite {
  id: string;
  code: string;
  role: Role;
  full_name: string;
  /** If set, only this address may redeem the code. */
  email: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  expires_at: string;
  used_by: string | null;
  used_at: string | null;
  revoked_at: string | null;
}

export const ROLE_LABEL: Record<Role, string> = {
  student: 'Student',
  parent: 'Parent',
  admin: 'Administrator',
};

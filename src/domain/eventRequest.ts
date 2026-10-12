import { getActiveProfiles, getFirstName, isChild } from './family';
import { getMoodScale } from './reference';
import { formatVolume, getPreferredUnits, millilitersToOunces, ouncesToMilliliters } from './units';
import type { BabyProfile, BottleContents, CreateCareEventInput, DiaperKind, DiaperPoopSize, FeedMethod, NursingSide } from './types';

/**
 * The structured request an integration (a voice assistant, Home Assistant, a
 * script) sends to log one entry, and the rules that turn it into the same
 * `CreateCareEventInput` the quick-add dialog builds.
 *
 * The request is deliberately **not** the sheet's row: it says "a 4 oz feed",
 * and this module decides that is a bottle with `amountOz: 4`. Callers never
 * learn a column name, so the sheet schema can keep moving underneath them.
 * Natural language stays outside — this takes JSON that has already been
 * parsed into fields, and refuses anything it cannot read exactly rather than
 * guessing, because a wrong guess lands in a log several people rely on.
 *
 * A new type is one entry in `builders`; everything else here is shared.
 *
 * **Starting an entry.** A feed, pump, sleep or tummy time can be logged as it
 * begins and finished in the app. That takes an explicit `"started": true`:
 * without it a missing amount or length is still an error, because the usual
 * reason for one is voice glue that lost it, not someone mid-feed. A started
 * entry is an ordinary row with the value blank — the app's own timers live on
 * one device and cannot be started from here — so it reads as a sleep "in
 * progress", or a pump or tummy time of 0 until someone edits it.
 */

/** A bottle over this is a typo or a misheard unit, not a feed. */
export const MAX_FEED_OZ = 16;
/** Over this is a timer left running — the `feedClock` cutoff. */
export const MAX_FEED_MINUTES = 4 * 60;
/** Over this is a timer left running — the `parentReport` cutoff. */
export const MAX_SLEEP_MINUTES = 16 * 60;
/** Tummy time comes in minutes; past this it is a timer left running. */
export const MAX_TUMMY_MINUTES = 2 * 60;
/** Clock skew allowance for a timestamp a little ahead of ours. */
export const MAX_FUTURE_MINUTES = 5;
/** Further back than this is almost certainly a wrong date, not a late entry. */
export const MAX_PAST_DAYS = 30;
const MAX_NOTES_LENGTH = 500;
const MS_PER_MINUTE = 60_000;

export type EventInput = DistributiveOmit<CreateCareEventInput, 'babyId'>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type ParseResult<T> = { errors: string[]; ok: false } | { ok: true; value: T };

type Body = Record<string, unknown>;
type Builder = (body: Body, at: Date | undefined, now: Date, errors: string[]) => EventInput | undefined;

const VOLUME_UNITS: Record<string, 'ml' | 'oz'> = {
  'fl oz': 'oz',
  milliliter: 'ml',
  milliliters: 'ml',
  millilitre: 'ml',
  millilitres: 'ml',
  ml: 'ml',
  ounce: 'oz',
  ounces: 'oz',
  oz: 'oz'
};

const DIAPER_KINDS: Record<string, DiaperKind> = {
  both: 'both',
  dirty: 'dirty',
  mixed: 'both',
  pee: 'wet',
  poo: 'dirty',
  poop: 'dirty',
  poopy: 'dirty',
  wet: 'wet'
};

const FEED_METHODS: Record<string, FeedMethod> = {
  bottle: 'bottle',
  breast: 'nursing',
  breastfeed: 'nursing',
  nursing: 'nursing'
};

const BOTTLE_CONTENTS: readonly BottleContents[] = ['breastmilk', 'formula', 'mixed', 'other'];
const NURSING_SIDES: readonly NursingSide[] = ['both', 'left', 'right'];
const POOP_SIZES: readonly DiaperPoopSize[] = ['large', 'medium', 'small'];

/**
 * Mood by word as well as by number, because nobody says "mood three". The
 * scale's own labels come from `mood-scale.csv`; the rest are what people
 * actually say for the same level.
 */
const MOOD_WORDS: Record<string, number> = {
  ...Object.fromEntries(getMoodScale().map((mood) => [mood.label.toLowerCase(), mood.level])),
  alert: 2,
  calm: 1,
  cranky: 3,
  crying: 4,
  happy: 1,
  settled: 1,
  upset: 4
};

const builders = {
  diaper(body, at, now, errors) {
    const kind = pickWord(body, ['diaperType', 'kind'], DIAPER_KINDS, errors, 'diaperType', true);
    const poopSize = pickWord(body, ['poopSize'], asMap(POOP_SIZES), errors, 'poopSize');

    if (poopSize && kind === 'wet') {
      errors.push('poopSize only applies to a dirty or both diaper.');
    }

    return kind ? { kind, ...(poopSize ? { poopSize } : {}), startedAt: iso(at ?? now), type: 'diaper' } : undefined;
  },

  feed(body, at, now, errors) {
    const amount = readAmountOz(body, errors);
    const durationMinutes = readMinutes(body, 'durationMinutes', MAX_FEED_MINUTES, errors);
    const named = pickWord(body, ['method'], FEED_METHODS, errors, 'method');
    const contents = pickWord(body, ['contents'], asMap(BOTTLE_CONTENTS), errors, 'contents');
    const side = pickWord(body, ['side'], asMap(NURSING_SIDES), errors, 'side');
    // An amount is a bottle unless someone says otherwise; a bare duration is nursing.
    const method: FeedMethod = named ?? (amount === undefined && durationMinutes !== undefined ? 'nursing' : 'bottle');

    if (amount === undefined && durationMinutes === undefined && !errors.length) {
      if (!isStarted(body)) {
        errors.push('A feed needs an amount (with a unit) or a durationMinutes — or "started": true to fill it in later.');
      } else if (!named) {
        // Nothing else says which: a started feed has to name its method.
        errors.push('A started feed needs a method (bottle or nursing).');
      }
    }

    if (side && method !== 'nursing') {
      errors.push('side only applies to a nursing feed.');
    }

    if (contents && method !== 'bottle') {
      errors.push('contents only applies to a bottle feed.');
    }

    return {
      ...(amount !== undefined ? { amountOz: amount } : {}),
      ...(contents ? { contents } : {}),
      ...(durationMinutes !== undefined ? { durationMinutes } : {}),
      method,
      ...(side ? { side } : {}),
      startedAt: iso(startOf(at, now, durationMinutes)),
      type: 'feed'
    };
  },

  bath(_body, at, now) {
    return { startedAt: iso(at ?? now), type: 'bath' };
  },

  /** Mood 1–5 (`mood-scale.csv`), as `level` or as a word such as "fussy". */
  mood(body, at, now, errors) {
    const raw = body.level ?? body.mood;
    const word = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    const level = has(MOOD_WORDS, word) ? MOOD_WORDS[word] : readNumber(raw);

    if (level === undefined || !Number.isInteger(level) || level < 1 || level > 5) {
      errors.push(`level must be 1–5 or one of: ${Object.keys(MOOD_WORDS).sort().join(', ')}.`);
      return undefined;
    }

    return { level, startedAt: iso(at ?? now), type: 'mood' };
  },

  /** A note is its text — `notes`, or `text` for callers that think of it that way. */
  note(body, at, now, errors) {
    const text = typeof body.text === 'string' && body.text.trim() ? body.text : body.notes;

    if (typeof text !== 'string' || !text.trim()) {
      errors.push('A note needs its text (notes or text).');
      return undefined;
    }

    if (text.length > MAX_NOTES_LENGTH) {
      errors.push(`A note must be at most ${MAX_NOTES_LENGTH} characters.`);
      return undefined;
    }

    return { notes: text.trim(), startedAt: iso(at ?? now), type: 'note' };
  },

  /** Pumped milk: an amount with its unit, and the side (both unless said). */
  pump(body, at, now, errors) {
    const amount = readAmountOz(body, errors);
    const side = pickWord(body, ['side'], asMap(NURSING_SIDES), errors, 'side') ?? 'both';

    if (amount === undefined) {
      if (!errors.length && isStarted(body)) {
        return { amountOz: 0, side, startedAt: iso(at ?? now), type: 'pump' };
      }

      if (!errors.length) {
        errors.push('A pump needs an amount with a unit (oz or ml) — or "started": true to fill it in later.');
      }

      return undefined;
    }

    return { amountOz: amount, side, startedAt: iso(at ?? now), type: 'pump' };
  },

  /**
   * A sleep is a span. Given a duration it ends at `timestamp` (or now) — "slept
   * for 45 minutes" is said on waking — unless a start is given instead. Given
   * only a start, it is still going, the way the app records a running sleep.
   */
  sleep(body, at, now, errors) {
    const durationMinutes = readMinutes(body, 'durationMinutes', MAX_SLEEP_MINUTES, errors);
    const start = readTimestamp(body, ['startedAt', 'start', 'startTime'], now, errors);
    const end = readTimestamp(body, ['endedAt', 'end', 'endTime'], now, errors);

    if (errors.length) {
      return undefined;
    }

    if (durationMinutes !== undefined) {
      if (start && (end || at)) {
        errors.push('Give a sleep a durationMinutes or a start and end, not all three.');
        return undefined;
      }

      const endedAt = start ? new Date(start.getTime() + durationMinutes * MS_PER_MINUTE) : end ?? at ?? now;
      const startedAt = start ?? new Date(endedAt.getTime() - durationMinutes * MS_PER_MINUTE);
      return checkSpan(startedAt, endedAt, now, errors);
    }

    if (!start) {
      // Started now (or at `timestamp`), still going.
      if (isStarted(body)) {
        return { startedAt: iso(at ?? now), type: 'sleep' };
      }

      errors.push('A sleep needs a durationMinutes or a startedAt — or "started": true to fill it in later.');
      return undefined;
    }

    return end ? checkSpan(start, end, now, errors) : { startedAt: iso(start), type: 'sleep' };
  },

  tummytime(body, at, now, errors) {
    const durationMinutes = readMinutes(body, 'durationMinutes', MAX_TUMMY_MINUTES, errors);

    if (durationMinutes === undefined) {
      if (!errors.length && isStarted(body)) {
        return { durationMinutes: 0, startedAt: iso(at ?? now), type: 'tummytime' };
      }

      if (!errors.length) {
        errors.push('Tummy time needs a durationMinutes — or "started": true to fill it in later.');
      }

      return undefined;
    }

    return { durationMinutes, startedAt: iso(startOf(at, now, durationMinutes)), type: 'tummytime' };
  }
} satisfies Record<string, Builder>;

export type SupportedEventType = keyof typeof builders;
export const SUPPORTED_EVENT_TYPES = Object.keys(builders).sort() as SupportedEventType[];

/** Other names callers use for a type — the app's own id stays canonical. */
const TYPE_ALIASES: Record<string, SupportedEventType> = {
  tummy: 'tummytime',
  'tummy time': 'tummytime',
  tummy_time: 'tummytime'
};

/** Validate and normalize one request into an entry, or say every reason it cannot be one. */
export function parseEventRequest(body: unknown, now = new Date()): ParseResult<EventInput> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: ['The request body must be a JSON object.'], ok: false };
  }

  const record = body as Body;
  const named = typeof record.type === 'string' ? record.type.trim().toLowerCase() : '';
  const type = has(TYPE_ALIASES, named) ? TYPE_ALIASES[named] : named;

  if (!has(builders, type)) {
    return { errors: [`type must be one of: ${SUPPORTED_EVENT_TYPES.join(', ')}.`], ok: false };
  }

  const errors: string[] = [];
  const at = readTimestamp(record, ['timestamp'], now, errors);
  // A note carries its text as the entry itself, not as an extra.
  const notes = type === 'note' ? undefined : readNotes(record, errors);
  const event = builders[type as SupportedEventType](record, at, now, errors);

  if (errors.length || !event) {
    return { errors, ok: false };
  }

  return { ok: true, value: notes ? { ...event, notes } : event };
}

/**
 * Which child an entry is for. Named by id or by name (first name is enough);
 * with nothing named, the family's only child. More than one child and no name
 * is refused rather than defaulted — logging twin A's feed against twin B is
 * worse than asking again.
 */
export function resolveChild(profiles: BabyProfile[], ref: unknown): ParseResult<BabyProfile> {
  const children = getActiveProfiles(profiles).filter(isChild);
  const wanted = typeof ref === 'string' ? ref.trim().toLowerCase() : '';

  if (ref !== undefined && ref !== null && typeof ref !== 'string') {
    return { errors: ['child must be a string.'], ok: false };
  }

  if (!wanted) {
    if (children.length === 1) {
      return { ok: true, value: children[0] };
    }

    return {
      errors: [children.length ? `Name the child: ${children.map((child) => getFirstName(child)).join(', ')}.` : 'This family has no children to log for.'],
      ok: false
    };
  }

  const match =
    children.find((child) => child.id.toLowerCase() === wanted) ??
    children.find((child) => child.name.trim().toLowerCase() === wanted) ??
    unique(children.filter((child) => getFirstName(child).toLowerCase() === wanted));

  return match ? { ok: true, value: match } : { errors: [`No child named "${String(ref).trim()}".`], ok: false };
}

/** A sentence an assistant can read back, in the child's own units and timezone. */
export function describeLoggedEvent(event: EventInput, child: BabyProfile): string {
  const name = getFirstName(child);
  const time = formatSpokenTime(event.startedAt, child.timezone);

  switch (event.type) {
    case 'diaper':
      return `Logged a ${event.kind} diaper for ${name} at ${time}.`;
    case 'feed': {
      if (event.amountOz === undefined && event.durationMinutes === undefined) {
        return `Started ${event.method === 'nursing' ? 'nursing' : 'a bottle'} for ${name} at ${time}. Add the ${event.method === 'nursing' ? 'length' : 'amount'} in BabySteps when it's done.`;
      }

      const amount = event.amountOz !== undefined ? `${formatVolume(event.amountOz, getPreferredUnits(child).system)} ` : '';
      const length = event.durationMinutes !== undefined ? ` for ${event.durationMinutes} minutes` : '';
      return `Logged a ${amount}${event.method === 'nursing' ? 'nursing feed' : 'bottle'}${length} for ${name} at ${time}.`;
    }
    case 'bath':
      return `Logged a bath for ${name} at ${time}.`;
    case 'mood': {
      const label = getMoodScale().find((mood) => mood.level === event.level)?.label ?? `level ${event.level}`;
      return `Logged ${name}'s mood as ${label.toLowerCase()} at ${time}.`;
    }
    case 'note':
      return `Saved a note for ${name} at ${time}.`;
    case 'pump':
      if (event.amountOz === 0) {
        return `Started pumping at ${time}. Add the amount in BabySteps when it's done.`;
      }

      return `Logged ${formatVolume(event.amountOz, getPreferredUnits(child).system)} pumped${event.side === 'both' ? '' : ` on the ${event.side} side`} at ${time}.`;
    case 'tummytime':
      if (event.durationMinutes === 0) {
        return `Started tummy time for ${name} at ${time}. Add the length in BabySteps when it's done.`;
      }

      return `Logged ${event.durationMinutes} minutes of tummy time for ${name}, starting ${time}.`;
    case 'sleep':
      return event.endedAt
        ? `Logged ${formatSpokenMinutes(event.startedAt, event.endedAt)} of sleep for ${name}, from ${time} to ${formatSpokenTime(event.endedAt, child.timezone)}.`
        : `Logged ${name} asleep since ${time}.`;
    default:
      return `Logged a ${event.type} for ${name} at ${time}.`;
  }
}

function asMap<T extends string>(values: readonly T[]) {
  return Object.fromEntries(values.map((value) => [value, value])) as Record<string, T>;
}

function checkSpan(start: Date, end: Date, now: Date, errors: string[]): EventInput | undefined {
  const minutes = (end.getTime() - start.getTime()) / MS_PER_MINUTE;

  if (minutes <= 0) {
    errors.push('A sleep must end after it starts.');
  } else if (minutes > MAX_SLEEP_MINUTES) {
    errors.push(`A sleep longer than ${MAX_SLEEP_MINUTES / 60} hours is a timer left running, not a sleep.`);
  } else if (end.getTime() > now.getTime() + MAX_FUTURE_MINUTES * MS_PER_MINUTE) {
    errors.push('A sleep cannot end in the future.');
  } else {
    return { endedAt: iso(end), startedAt: iso(start), type: 'sleep' };
  }

  return undefined;
}

function formatSpokenMinutes(startedAt: string, endedAt: string) {
  const total = Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / MS_PER_MINUTE);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const parts = [hours ? `${hours} hour${hours === 1 ? '' : 's'}` : '', minutes ? `${minutes} minute${minutes === 1 ? '' : 's'}` : ''];
  return parts.filter(Boolean).join(' ') || 'under a minute';
}

function formatSpokenTime(value: string, timeZone: string) {
  const options: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };

  try {
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone }).format(new Date(value));
  } catch {
    // A zone this runtime does not know still has a time worth saying.
    return new Intl.DateTimeFormat('en-US', options).format(new Date(value));
  }
}

/** Own keys only — a request naming `constructor` is not a type. (`Object.hasOwn` is past this build's ES2020 lib.) */
function has(record: object, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/** `"started": true` (or the string, from templating) — see the module comment. */
function isStarted(body: Body) {
  return body.started === true || body.started === 'true';
}

/**
 * When a timed entry began. A `timestamp` is the start; without one the entry is
 * being reported as it ends — "20 minutes of tummy time" is said afterwards —
 * so it began that long ago.
 */
function startOf(at: Date | undefined, now: Date, durationMinutes: number | undefined) {
  return at ?? new Date(now.getTime() - (durationMinutes ?? 0) * MS_PER_MINUTE);
}

function iso(date: Date) {
  return date.toISOString();
}

/** A word from a fixed list, case-insensitively, or an error naming the list. */
function pickWord<T extends string>(body: Body, keys: string[], allowed: Record<string, T>, errors: string[], label: string, required = false): T | undefined {
  const key = keys.find((name) => body[name] !== undefined && body[name] !== null && body[name] !== '');
  const raw = key ? body[key] : undefined;

  if (raw === undefined) {
    if (required) {
      errors.push(`${label} is required (${Object.keys(allowed).join(', ')}).`);
    }

    return undefined;
  }

  const word = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  const value = has(allowed, word) ? allowed[word] : undefined;

  if (!value) {
    errors.push(`${label} must be one of: ${Object.keys(allowed).join(', ')}.`);
  }

  return value;
}

/** The amount in canonical ounces — the unit every feed is stored in. */
function readAmountOz(body: Body, errors: string[]) {
  if (body.amount === undefined || body.amount === null || body.amount === '') {
    if (body.unit !== undefined) {
      errors.push('unit was given without an amount.');
    }

    return undefined;
  }

  const amount = readNumber(body.amount);
  const unitName = typeof body.unit === 'string' ? body.unit.trim().toLowerCase().replace(/\.$/, '') : '';
  const unit = has(VOLUME_UNITS, unitName) ? VOLUME_UNITS[unitName] : undefined;

  if (amount === undefined) {
    errors.push('amount must be a number.');
    return undefined;
  }

  // No default unit: "4" is a bottle in ounces and a sip in millilitres.
  if (!unit) {
    errors.push('unit is required with an amount (oz or ml).');
    return undefined;
  }

  const ounces = unit === 'ml' ? millilitersToOunces(amount) : amount;

  if (ounces <= 0 || ounces > MAX_FEED_OZ) {
    errors.push(`amount must be more than 0 and at most ${MAX_FEED_OZ} oz (${Math.round(ouncesToMilliliters(MAX_FEED_OZ))} ml).`);
    return undefined;
  }

  return ounces;
}

function readMinutes(body: Body, key: string, max: number, errors: string[]) {
  if (body[key] === undefined || body[key] === null || body[key] === '') {
    return undefined;
  }

  const minutes = readNumber(body[key]);

  if (minutes === undefined || minutes <= 0 || minutes > max) {
    errors.push(`${key} must be a number of minutes above 0 and at most ${max}.`);
    return undefined;
  }

  return minutes;
}

function readNotes(body: Body, errors: string[]) {
  if (body.notes === undefined || body.notes === null) {
    return undefined;
  }

  if (typeof body.notes !== 'string' || body.notes.length > MAX_NOTES_LENGTH) {
    errors.push(`notes must be text of at most ${MAX_NOTES_LENGTH} characters.`);
    return undefined;
  }

  return body.notes.trim() || undefined;
}

/** A finite number, or a numeric string such as "2.5" — voice glue often sends text. */
function readNumber(value: unknown) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
}

/**
 * An ISO 8601 instant **with** a UTC offset. Without one, "14:32" means a
 * different moment on the Pi than in the kitchen, so it is refused rather than
 * read in whatever zone the server happens to run in.
 */
function readTimestamp(body: Body, keys: string[], now: Date, errors: string[]) {
  const key = keys.find((name) => body[name] !== undefined && body[name] !== null && body[name] !== '');

  if (!key) {
    return undefined;
  }

  const raw = body[key];
  const date = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/i.test(raw.trim()) ? new Date(raw.trim()) : undefined;

  if (!date || Number.isNaN(date.getTime())) {
    errors.push(`${key} must be an ISO 8601 time with an offset, like 2026-10-12T14:32:00-07:00.`);
    return undefined;
  }

  if (date.getTime() > now.getTime() + MAX_FUTURE_MINUTES * MS_PER_MINUTE) {
    errors.push(`${key} is in the future.`);
    return undefined;
  }

  if (date.getTime() < now.getTime() - MAX_PAST_DAYS * 24 * 60 * MS_PER_MINUTE) {
    errors.push(`${key} is more than ${MAX_PAST_DAYS} days ago.`);
    return undefined;
  }

  return date;
}

function unique<T>(items: T[]) {
  return items.length === 1 ? items[0] : undefined;
}

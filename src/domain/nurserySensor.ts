/**
 * The nursery sensor phone's tabs on the family sheet, and the slice of them
 * the app reads back. The phone (`oneplus` project) writes these through the
 * Pi's `POST /api/nursery`; the server's parser and this reader share the one
 * column list below, so the two cannot drift apart.
 *
 * Everything here is an experimental sound measurement, never a care record:
 * a "cry" is a model's guess at what a microphone heard, and how much it hears
 * depends on where the phone was left.
 */
export const NURSERY_SCHEMAS = {
  night: {
    columns: ['sourceDeviceId', 'nightOf', 'timezone', 'windowStartUtc', 'windowEndUtc', 'status', 'observedThroughUtc', 'expectedMs', 'capturedMs', 'validMs', 'coveragePercent', 'sessions', 'soundLevelDbfs', 'peakDbfs', 'cryEpisodes', 'cryMs', 'longestCryMs', 'speechEpisodes', 'speechMs', 'snoringEpisodes', 'snoringMs', 'coughEpisodes', 'ambientNoiseMs'],
    tab: 'Nursery Nightly Summaries'
  },
  episode: {
    columns: ['sourceDeviceId', 'sessionId', 'episodeId', 'label', 'startUtc', 'endUtc', 'durationMs', 'maxScore', 'source'],
    tab: 'Nursery Sound Episodes'
  },
  interval: {
    columns: ['sourceDeviceId', 'sessionId', 'startUtc', 'endUtc', 'durationMs', 'validMs', 'coveragePercent', 'soundLevelDbfs', 'peakDbfs', 'clippedWindows'],
    tab: 'Nursery Sound Levels'
  },
  session: {
    columns: ['sourceDeviceId', 'sessionId', 'startUtc', 'endUtc', 'status', 'elapsedMs', 'validMs', 'coveragePercent', 'capturedMs', 'silencedMs', 'observedThroughUtc', 'soundLevelDbfs', 'peakDbfs', 'error', 'model', 'modelSha256', 'modelError', 'modelStatus', 'predictions', 'droppedWindows', 'meanInferenceMs', 'maxInferenceMs', 'appVersion', 'timezone', 'sleepState', 'movementState'],
    tab: 'Nursery Sessions'
  }
} as const;

/** One night's capture on one phone: how much of it was heard, and what. */
export interface NurseryNightSummary {
  /** The evening the night started — the phone's noon-to-noon `nightOf`. */
  nightOf: string;
  coveragePercent: number;
  cryEpisodes: number;
  /** `complete` once the night's noon has passed. */
  status: string;
}

export interface NurserySoundEpisode {
  label: string;
  startedAt: string;
  endedAt: string;
  maxScore: number;
}

export interface NurseryData {
  nights: NurseryNightSummary[];
  episodes: NurserySoundEpisode[];
}

/** The two tabs the night report reads; levels and sessions stay on the sheet. */
export const NURSERY_READ_TABS = [NURSERY_SCHEMAS.night.tab, NURSERY_SCHEMAS.episode.tab];

/** Rows as records keyed by the tab's own header (row 1), so a moved column still reads. */
function records(values: unknown[][]) {
  const [header = [], ...rows] = values;
  const names = header.map((cell) => String(cell ?? ''));

  return rows.map((row) => Object.fromEntries(names.map((name, index) => [name, row[index]])) as Record<string, unknown>);
}

const isoOf = (value: unknown) => (typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null);
const numberOf = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : Number(value) || 0);

/**
 * Reads the nightly-summary and episode tabs back out of a `values:batchGet`.
 * A row that does not parse is skipped rather than failing the read: this is a
 * report's extra, and one odd row must not take the rest of it away.
 */
export function readNurseryValues(nightValues: unknown[][], episodeValues: unknown[][]): NurseryData {
  const nights = records(nightValues).flatMap((row): NurseryNightSummary[] => {
    const nightOf = String(row.nightOf ?? '');

    return /^\d{4}-\d{2}-\d{2}$/.test(nightOf)
      ? [{ coveragePercent: numberOf(row.coveragePercent), cryEpisodes: numberOf(row.cryEpisodes), nightOf, status: String(row.status ?? '') }]
      : [];
  });
  const episodes = records(episodeValues).flatMap((row): NurserySoundEpisode[] => {
    const startedAt = isoOf(row.startUtc);
    const endedAt = isoOf(row.endUtc);

    return startedAt && endedAt && typeof row.label === 'string'
      ? [{ endedAt, label: row.label, maxScore: numberOf(row.maxScore), startedAt }]
      : [];
  });

  return { episodes, nights };
}

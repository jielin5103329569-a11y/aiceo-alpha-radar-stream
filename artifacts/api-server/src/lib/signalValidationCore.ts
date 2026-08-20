import { createHash } from "node:crypto";

export const SIGNAL_RECORD_SCHEMA_VERSION = 1;
export const VALIDATION_HORIZONS = [1, 3, 5, 10, 20] as const;
export const VALIDATION_HIT_THRESHOLD_PERCENT = 2;
export const MINIMUM_VALIDATION_SAMPLE = 20;
export const MAX_CHECKPOINT_OBSERVATION_DELAY_MS = 4 * 60 * 60 * 1_000;

export type ValidationHorizonDays = (typeof VALIDATION_HORIZONS)[number];
export type ValidationSignalState =
  | "watch"
  | "latent"
  | "breakout_critical"
  | "confirmed";
export type ValidationSignalType = "state_transition" | "confirmation_transition";
export type ValidationDirection = "upside" | "downside" | "neutral";
export type ValidationCheckpointStatus = "pending" | "complete" | "unavailable";

export type TriggerEvidenceItem = {
  key: string;
  label: string;
  satisfied: boolean;
  detail: string;
};

export type TriggerFreshnessSnapshot = {
  marketFeedState: string;
  dataQuality: string;
  scoreState: string;
  momentum: string;
  volume: string;
  orderFlow: string;
  spread: string;
};

export type SignalTriggerInput = {
  symbol: string;
  occurredAt: Date;
  fromState: string;
  state: ValidationSignalState;
  confirmationStatus: string;
  signalType: ValidationSignalType;
  direction: ValidationDirection;
  triggerPrice: number;
  alphaScore: number | null;
  signalScore: number | null;
  confidence: number;
  volumeValue: number | null;
  volumeScore: number | null;
  velocity30s: number | null;
  velocity60s: number | null;
  momentumAcceleration: number | null;
  volumeAcceleration: number | null;
  orderFlowShift: number | null;
  spreadTightening: number | null;
  sector: string | null;
  sectorConfirmation: "confirmed" | "insufficient" | "unavailable";
  sectorConfirmationReason: string;
  evidenceCount: number;
  evidenceSummary: TriggerEvidenceItem[];
  satisfiedEvidence: string[];
  missingEvidence: string[];
  dataFresh: boolean;
  freshness: TriggerFreshnessSnapshot;
  source: "Databento EQUS.MINI live";
  catalystStatus: "unavailable";
};

export type ImmutableSignalRecord = SignalTriggerInput & {
  eventKey: string;
  schemaVersion: number;
  recordHash: string;
};

export type ValidationPriceObservation = {
  observedAt: Date;
  price: number;
};

export type CalculatedCheckpoint = {
  horizonDays: ValidationHorizonDays;
  checkpointStatus: ValidationCheckpointStatus;
  targetAt: Date;
  observedAt: Date | null;
  observedPrice: number | null;
  rawReturnPercent: number | null;
  favorableReturnPercent: number | null;
  maxDrawdownPercent: number | null;
  hit: boolean | null;
  leadTimeMinutes: number | null;
  reason: string;
};

export type ValidationMetricInput = {
  hit: boolean;
  rawReturnPercent: number;
  favorableReturnPercent: number;
  maxDrawdownPercent: number;
  leadTimeMinutes: number | null;
};

export type ValidationMetrics = {
  sampleState: "insufficient_sample" | "available";
  sampleSize: number;
  minimumSampleSize: number;
  hitRatePercent: number | null;
  averageReturnPercent: number | null;
  maximumDrawdownPercent: number | null;
  falsePositiveRatePercent: number | null;
  averageLeadTimeMinutes: number | null;
};

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function immutableRecordHash(input: SignalTriggerInput): string {
  const canonical = JSON.stringify(canonicalize({
    schemaVersion: SIGNAL_RECORD_SCHEMA_VERSION,
    ...input,
  }));
  return createHash("sha256").update(canonical).digest("hex");
}

export function buildImmutableSignalRecord(input: SignalTriggerInput): ImmutableSignalRecord {
  const normalizedSymbol = input.symbol.trim().toUpperCase();
  const normalized = {
    ...input,
    symbol: normalizedSymbol,
    evidenceSummary: input.evidenceSummary.map((item) => ({ ...item })),
    satisfiedEvidence: [...input.satisfiedEvidence],
    missingEvidence: [...input.missingEvidence],
    freshness: { ...input.freshness },
  };
  const identity = [
    normalizedSymbol,
    input.occurredAt.toISOString(),
    input.state,
    input.confirmationStatus,
    input.signalType,
  ].join("|");
  return {
    ...normalized,
    eventKey: createHash("sha256").update(identity).digest("hex"),
    schemaVersion: SIGNAL_RECORD_SCHEMA_VERSION,
    recordHash: immutableRecordHash(normalized),
  };
}

export function signalRecordIntegrityIsValid(record: ImmutableSignalRecord): boolean {
  const {
    eventKey: _eventKey,
    schemaVersion,
    recordHash,
    ...trigger
  } = record;
  return (
    schemaVersion === SIGNAL_RECORD_SCHEMA_VERSION
    && recordHash === immutableRecordHash(trigger)
  );
}

type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

const EASTERN_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const EASTERN_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function numericParts(
  formatter: Intl.DateTimeFormat,
  date: Date,
): Record<string, number> {
  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}

function easternCalendarDate(date: Date): CalendarDate {
  const parts = numericParts(EASTERN_DATE_FORMATTER, date);
  return { year: parts.year, month: parts.month, day: parts.day };
}

function dateKey(date: CalendarDate): string {
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

function utcCalendarDate(date: CalendarDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

function fromUtcCalendarDate(date: Date): CalendarDate {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const next = utcCalendarDate(date);
  next.setUTCDate(next.getUTCDate() + days);
  return fromUtcCalendarDate(next);
}

function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  occurrence: number,
): CalendarDate {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return { year, month, day: 1 + offset + (occurrence - 1) * 7 };
}

function lastWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
): CalendarDate {
  const last = new Date(Date.UTC(year, month, 0));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return { year, month, day: last.getUTCDate() - offset };
}

function observedFixedHoliday(year: number, month: number, day: number): CalendarDate {
  const holiday = new Date(Date.UTC(year, month - 1, day));
  if (holiday.getUTCDay() === 6) holiday.setUTCDate(holiday.getUTCDate() - 1);
  if (holiday.getUTCDay() === 0) holiday.setUTCDate(holiday.getUTCDate() + 1);
  return fromUtcCalendarDate(holiday);
}

function easterSunday(year: number): CalendarDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { year, month, day };
}

function exchangeHolidayKeys(year: number): Set<string> {
  const holidays = new Set<string>();
  const add = (date: CalendarDate): void => {
    holidays.add(dateKey(date));
  };
  add(observedFixedHoliday(year, 1, 1));
  add(observedFixedHoliday(year + 1, 1, 1));
  add(nthWeekdayOfMonth(year, 1, 1, 3));
  add(nthWeekdayOfMonth(year, 2, 1, 3));
  add(addCalendarDays(easterSunday(year), -2));
  add(lastWeekdayOfMonth(year, 5, 1));
  if (year >= 2022) add(observedFixedHoliday(year, 6, 19));
  add(observedFixedHoliday(year, 7, 4));
  add(nthWeekdayOfMonth(year, 9, 1, 1));
  add(nthWeekdayOfMonth(year, 11, 4, 4));
  add(observedFixedHoliday(year, 12, 25));
  return holidays;
}

export function isUsEquitiesTradingDate(date: CalendarDate): boolean {
  const utcDate = utcCalendarDate(date);
  const weekday = utcDate.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  return !exchangeHolidayKeys(date.year).has(dateKey(date));
}

function isEarlyCloseDate(date: CalendarDate): boolean {
  if (!isUsEquitiesTradingDate(date)) return false;
  const thanksgiving = nthWeekdayOfMonth(date.year, 11, 4, 4);
  const dayAfterThanksgiving = addCalendarDays(thanksgiving, 1);
  if (dateKey(date) === dateKey(dayAfterThanksgiving)) return true;
  if (date.month === 7 && date.day === 3) return true;
  return date.month === 12 && date.day === 24;
}

function easternMarketClose(date: CalendarDate): Date {
  const closeHour = isEarlyCloseDate(date) ? 13 : 16;
  const desiredLocalAsUtc = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    closeHour,
    0,
    0,
  );
  let candidate = new Date(desiredLocalAsUtc);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = numericParts(EASTERN_DATE_TIME_FORMATTER, candidate);
    const renderedLocalAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const correction = desiredLocalAsUtc - renderedLocalAsUtc;
    if (correction === 0) break;
    candidate = new Date(candidate.getTime() + correction);
  }
  return candidate;
}

export function targetAtForHorizon(
  occurredAt: Date,
  horizonDays: ValidationHorizonDays,
): Date {
  let targetDate = easternCalendarDate(occurredAt);
  let remaining = horizonDays;
  while (remaining > 0) {
    targetDate = addCalendarDays(targetDate, 1);
    if (isUsEquitiesTradingDate(targetDate)) remaining -= 1;
  }
  return easternMarketClose(targetDate);
}

function directionalReturn(
  rawReturnPercent: number,
  direction: ValidationDirection,
): number {
  if (direction === "downside") return -rawReturnPercent;
  return rawReturnPercent;
}

export function calculateOutcomeCheckpoint(
  signal: Pick<SignalTriggerInput, "occurredAt" | "triggerPrice" | "direction">,
  observations: ValidationPriceObservation[],
  horizonDays: ValidationHorizonDays,
): CalculatedCheckpoint {
  const targetAt = targetAtForHorizon(signal.occurredAt, horizonDays);
  const eligible = observations
    .filter((item) => (
      Number.isFinite(item.price)
      && item.price > 0
      && item.observedAt.getTime() > signal.occurredAt.getTime()
    ))
    .sort((left, right) => left.observedAt.getTime() - right.observedAt.getTime());
  const completion = eligible.find(
    (item) => item.observedAt.getTime() >= targetAt.getTime(),
  );
  if (!completion) {
    return {
      horizonDays,
      checkpointStatus: "pending",
      targetAt,
      observedAt: null,
      observedPrice: null,
      rawReturnPercent: null,
      favorableReturnPercent: null,
      maxDrawdownPercent: null,
      hit: null,
      leadTimeMinutes: null,
      reason: `Waiting for the first fresh observed price at or after the ${horizonDays}D target.`,
    };
  }
  if (
    completion.observedAt.getTime() - targetAt.getTime()
    > MAX_CHECKPOINT_OBSERVATION_DELAY_MS
  ) {
    return {
      horizonDays,
      checkpointStatus: "unavailable",
      targetAt,
      observedAt: completion.observedAt,
      observedPrice: null,
      rawReturnPercent: null,
      favorableReturnPercent: null,
      maxDrawdownPercent: null,
      hit: null,
      leadTimeMinutes: null,
      reason: "No fresh price was observed within four hours after the target session close; the checkpoint is unavailable rather than backfilled.",
    };
  }

  const throughCompletion = eligible.filter(
    (item) => item.observedAt.getTime() <= completion.observedAt.getTime(),
  );
  const directionalReturns = throughCompletion.map((item) => directionalReturn(
    ((item.price - signal.triggerPrice) / signal.triggerPrice) * 100,
    signal.direction,
  ));
  const firstHitIndex = directionalReturns.findIndex(
    (value) => value >= VALIDATION_HIT_THRESHOLD_PERCENT,
  );
  const rawReturnPercent = ((completion.price - signal.triggerPrice) / signal.triggerPrice) * 100;
  const favorableReturnPercent = directionalReturn(rawReturnPercent, signal.direction);
  const maxDrawdownPercent = Math.min(0, ...directionalReturns);
  const firstHit = firstHitIndex >= 0 ? throughCompletion[firstHitIndex] : null;

  return {
    horizonDays,
    checkpointStatus: "complete",
    targetAt,
    observedAt: completion.observedAt,
    observedPrice: round(completion.price),
    rawReturnPercent: round(rawReturnPercent),
    favorableReturnPercent: round(favorableReturnPercent),
    maxDrawdownPercent: round(maxDrawdownPercent),
    hit: firstHit !== null,
    leadTimeMinutes: firstHit
      ? round((firstHit.observedAt.getTime() - signal.occurredAt.getTime()) / 60_000, 2)
      : null,
    reason: firstHit
      ? `A ${VALIDATION_HIT_THRESHOLD_PERCENT}% direction-adjusted move was observed using post-signal prices only.`
      : `No ${VALIDATION_HIT_THRESHOLD_PERCENT}% direction-adjusted move was observed by this checkpoint.`,
  };
}

export function aggregateValidationMetrics(
  rows: ValidationMetricInput[],
  minimumSampleSize = MINIMUM_VALIDATION_SAMPLE,
): ValidationMetrics {
  if (rows.length < minimumSampleSize) {
    return {
      sampleState: "insufficient_sample",
      sampleSize: rows.length,
      minimumSampleSize,
      hitRatePercent: null,
      averageReturnPercent: null,
      maximumDrawdownPercent: null,
      falsePositiveRatePercent: null,
      averageLeadTimeMinutes: null,
    };
  }
  const hitCount = rows.filter((row) => row.hit).length;
  const leadTimes = rows
    .map((row) => row.leadTimeMinutes)
    .filter((value): value is number => value !== null);
  return {
    sampleState: "available",
    sampleSize: rows.length,
    minimumSampleSize,
    hitRatePercent: round((hitCount / rows.length) * 100, 2),
    averageReturnPercent: round(
      rows.reduce((total, row) => total + row.favorableReturnPercent, 0) / rows.length,
      4,
    ),
    maximumDrawdownPercent: round(
      Math.min(...rows.map((row) => row.maxDrawdownPercent)),
      4,
    ),
    falsePositiveRatePercent: round(((rows.length - hitCount) / rows.length) * 100, 2),
    averageLeadTimeMinutes: leadTimes.length > 0
      ? round(leadTimes.reduce((total, value) => total + value, 0) / leadTimes.length, 2)
      : null,
  };
}
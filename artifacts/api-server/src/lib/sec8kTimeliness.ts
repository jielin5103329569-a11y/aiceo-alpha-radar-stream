import { isUsEquitiesTradingDate } from "./signalValidationCore";

export const SEC_8K_TIMELINESS_RULE_VERSION = "sec-8k-rth-v1";

type CalendarDate = { year: number; month: number; day: number };

const EASTERN_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function parts(date: Date): Record<string, number> {
  return Object.fromEntries(
    EASTERN_FORMATTER.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}

function easternDate(date: Date): CalendarDate {
  const value = parts(date);
  return { year: value.year, month: value.month, day: value.day };
}

function addDays(date: CalendarDate, days: number): CalendarDate {
  const value = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  };
}

function easternRthOpen(date: CalendarDate): Date {
  const target = Date.UTC(date.year, date.month - 1, date.day, 9, 30, 0);
  let candidate = new Date(target);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rendered = parts(candidate);
    const renderedAsUtc = Date.UTC(
      rendered.year,
      rendered.month - 1,
      rendered.day,
      rendered.hour,
      rendered.minute,
      rendered.second,
    );
    const correction = target - renderedAsUtc;
    if (correction === 0) break;
    candidate = new Date(candidate.getTime() + correction);
  }
  return candidate;
}

function currentRthOpen(now: Date): Date {
  let date = easternDate(now);
  while (!isUsEquitiesTradingDate(date)) date = addDays(date, -1);
  return easternRthOpen(date);
}

function firstFullRthOpenAfter(filedAt: Date): Date {
  let date = easternDate(filedAt);
  for (;;) {
    if (isUsEquitiesTradingDate(date)) {
      const open = easternRthOpen(date);
      if (open.getTime() > filedAt.getTime()) return open;
    }
    date = addDays(date, 1);
  }
}

export function isTimelySec8K(filedAt: Date, now = new Date()): boolean {
  const filedTime = filedAt.getTime();
  const nowTime = now.getTime();
  if (!Number.isFinite(filedTime) || filedTime > nowTime) return false;
  const open = currentRthOpen(now);
  const within24HoursBeforeOpen = filedTime <= open.getTime()
    && filedTime >= open.getTime() - 24 * 60 * 60_000;
  const firstFullSession = firstFullRthOpenAfter(filedAt).getTime() === open.getTime();
  return within24HoursBeforeOpen || firstFullSession;
}
// Opening periods as stored in opening_hours: minutes from midnight in the restaurant's time zone.
export interface OpeningHoursRow {
  dayOfWeek: number;
  opensAt: number;
  closesAt: number;
}

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const formatters = new Map<string, Intl.DateTimeFormat>();

// 750 becomes "12:30"; 1440 becomes "24:00".
export const formatMinutes = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

// The weekday (0 = Sunday) and minute of the day at `at` in the time zone. Throws a
// RangeError for an unknown time zone.
function localTime(at: Date, timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return { day: weekdays.indexOf(part("weekday")), minute: Number(part("hour")) * 60 + Number(part("minute")) };
}

// A period that ends after midnight (closesAt not after opensAt) also covers the early hours of
// the next day.
export function isWithinHours(hours: OpeningHoursRow[], timeZone: string, at: Date) {
  let now: ReturnType<typeof localTime>;
  try {
    now = localTime(at, timeZone);
  } catch {
    return false; // An unknown time zone: shown as closed rather than failing the whole page.
  }
  const yesterday = (now.day + 6) % 7;
  return hours.some(({ dayOfWeek, opensAt, closesAt }) => closesAt > opensAt
    ? dayOfWeek === now.day && now.minute >= opensAt && now.minute < closesAt
    : (dayOfWeek === now.day && now.minute >= opensAt) || (dayOfWeek === yesterday && now.minute < closesAt));
}

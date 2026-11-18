const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const MAX_INTERVAL_MS = 36_525 * DAY_MS;
const EVALUATION_TYPES = ['好评正向', '中评', '好评负向', '差评'];

function record(value, field) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value;
}

function dateMidnight(value, field) {
  const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new TypeError(`${field} must use YYYY-MM-DD`);
  const [, y, m, d] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const ms = Date.UTC(year, month - 1, day);
  const date = new Date(ms);
  if (year < MIN_YEAR || year > MAX_YEAR || date.getUTCFullYear() !== year
      || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new RangeError(`${field} must be a real date in ${MIN_YEAR}..${MAX_YEAR}`);
  }
  return ms;
}

function clockMinutes(value, field) {
  const match = typeof value === 'string' && /^(\d{2}):(\d{2})$/.exec(value);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    throw new TypeError(`${field} must use HH:mm in 00:00..23:59`);
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function offsetMinutes(value, field, prefix = '') {
  const pattern = prefix ? /^UTC([+-])(\d{2}):(\d{2})$/ : /^([+-])(\d{2}):(\d{2})$/;
  const match = typeof value === 'string' && pattern.exec(value);
  if (!match || Number(match[2]) > 14 || Number(match[3]) > 59
      || (Number(match[2]) === 14 && Number(match[3]) !== 0)) {
    throw new TypeError(`${field} must be a fixed ${prefix} offset within -14:00..+14:00`);
  }
  return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
}

function dates(values, field) {
  if (values === undefined) return [];
  if (!Array.isArray(values)) throw new TypeError(`${field} must be an array`);
  for (const value of values) dateMidnight(value, field);
  if (new Set(values).size !== values.length) throw new TypeError(`${field} contains duplicates`);
  return [...values].sort();
}

/**
 * Return a normalized copy; the caller's calendar is never modified.
 * Weekdays are Mon..Sun, dates are real YYYY-MM-DD values in 2000..2100.
 * Only one same-day HH:mm window and fixed UTC offsets are supported.
 * Missing holiday/makeup lists become []; a date cannot appear in both.
 */
export function validateCalendar(calendar) {
  record(calendar, 'calendar');
  const rawDays = calendar.workdays === 'Mon-Fri' ? WEEKDAYS.slice(0, 5) : calendar.workdays;
  if (!Array.isArray(rawDays) || rawDays.length === 0) {
    throw new TypeError('calendar.workdays must be Mon-Fri or a nonempty Mon..Sun array');
  }
  const dayNames = Array.from(rawDays, day => typeof day === 'string' ? day.trim() : day);
  if (dayNames.some(day => !WEEKDAYS.includes(day)) || new Set(dayNames).size !== dayNames.length) {
    throw new TypeError('calendar.workdays contains an unknown or duplicate weekday');
  }
  const start = clockMinutes(calendar.workStart, 'calendar.workStart');
  const end = clockMinutes(calendar.workEnd, 'calendar.workEnd');
  if (end <= start) throw new RangeError('calendar.workEnd must be after workStart; overnight windows are unsupported');
  const offset = offsetMinutes(calendar.timezone, 'calendar.timezone', 'UTC');
  const holidays = dates(calendar.holidays, 'calendar.holidays');
  const workingDates = dates(calendar.workingDates, 'calendar.workingDates');
  const holidaySet = new Set(holidays);
  if (workingDates.some(day => holidaySet.has(day))) {
    throw new TypeError('calendar.holidays and workingDates must not contain the same date');
  }
  return {
    workdays: WEEKDAYS.filter(day => dayNames.includes(day)),
    workStart: calendar.workStart,
    workEnd: calendar.workEnd,
    timezone: offset === 0 ? 'UTC+00:00' : calendar.timezone,
    holidays,
    workingDates,
  };
}

function timestampMs(value, field) {
  const match = typeof value === 'string'
    && /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new TypeError(`${field} must be zoned ISO with at most millisecond precision`);
  const [, date, h, m, s = '0', fraction = '', zone] = match;
  const midnight = dateMidnight(date, field);
  const hour = Number(h), minute = Number(m), second = Number(s);
  if (hour > 23 || minute > 59 || second > 59) throw new RangeError(`${field} contains an invalid clock time`);
  const offset = zone === 'Z' ? 0 : offsetMinutes(zone, field);
  return midnight + hour * HOUR_MS + minute * MINUTE_MS + second * 1000
    + Number(fraction.padEnd(3, '0')) - offset * MINUTE_MS;
}

function interval(startISO, endISO) {
  const start = timestampMs(startISO, 'startISO');
  const end = timestampMs(endISO, 'endISO');
  if (end < start) throw new RangeError('endISO must not be before startISO');
  if (end - start > MAX_INTERVAL_MS) throw new RangeError('interval must not exceed 36525 days');
  return { start, end };
}

/**
 * Exact integer milliseconds intersecting each eligible [workStart, workEnd).
 * ISO sources require Z or a numeric offset; fractional seconds allow 1..3 digits.
 * Both source dates and calendar-local dates must be in 2000..2100. Intervals
 * are capped at 36525 days, so the loop examines at most 36526 daily windows.
 * workingDates opens explicit makeup days; holidays closes ordinary workdays.
 * There is no implicit lunch break, overnight window, DST, or host timezone use.
 */
export function workingDurationMs(startISO, endISO, calendar) {
  const normalized = validateCalendar(calendar);
  const { start, end } = interval(startISO, endISO);
  const shift = offsetMinutes(normalized.timezone, 'calendar.timezone', 'UTC') * MINUTE_MS;
  const localStart = start + shift;
  const localEnd = end + shift;
  for (const value of [localStart, localEnd]) {
    const year = new Date(value).getUTCFullYear();
    if (year < MIN_YEAR || year > MAX_YEAR) throw new RangeError('calendar-local date must be in 2000..2100');
  }
  const open = clockMinutes(normalized.workStart, 'calendar.workStart') * MINUTE_MS;
  const close = clockMinutes(normalized.workEnd, 'calendar.workEnd') * MINUTE_MS;
  const workdays = new Set(normalized.workdays);
  const holidays = new Set(normalized.holidays);
  const workingDates = new Set(normalized.workingDates);
  let total = 0;
  for (let day = Math.floor(localStart / DAY_MS) * DAY_MS; day < localEnd; day += DAY_MS) {
    const date = new Date(day);
    const key = date.toISOString().slice(0, 10);
    const weekday = WEEKDAYS[(date.getUTCDay() + 6) % 7];
    const eligible = workingDates.has(key) || (workdays.has(weekday) && !holidays.has(key));
    if (eligible) total += Math.max(0, Math.min(localEnd, day + close) - Math.max(localStart, day + open));
  }
  return total;
}

/**
 * Read only timeRule.mode and, for workingHours, timeRule.calendar.
 * Continuous mode needs no calendar. Both modes share ISO/range validation.
 * Thresholds and unrepliedRule do not affect elapsed duration.
 */
export function timeDurationMs(startISO, endISO, timeRule) {
  record(timeRule, 'timeRule');
  if (timeRule.mode === 'workingHours') return workingDurationMs(startISO, endISO, timeRule.calendar);
  if (timeRule.mode === 'continuous') {
    const { start, end } = interval(startISO, endISO);
    return end - start;
  }
  throw new TypeError('timeRule.mode must be workingHours or continuous');
}

function positiveHours(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0
      || value * HOUR_MS > Number.MAX_SAFE_INTEGER) {
    throw new TypeError(`${field} must be a finite positive hour value within the safe millisecond range`);
  }
  return value;
}

/**
 * Resolve only timeRule.thresholds = { default: positiveHours, byType?: {...} }.
 * byType allows the four exact labels; no type or threshold is inferred.
 * Trim a provided evaluationType, preserving unknown nonempty values in metadata.
 * Known configured types use byType; absent/unknown/unconfigured types use default.
 * Returns { thresholdHours, thresholdMs, source: 'byType'|'default', evaluationType }.
 * Missing/invalid defaults or invalid byType entries throw even if unused.
 * This function does not decide a verdict or implement unrepliedRule semantics.
 */
export function resolveTimeThreshold(timeRule, evaluationType) {
  record(timeRule, 'timeRule');
  const thresholds = record(timeRule.thresholds, 'timeRule.thresholds');
  const defaultHours = positiveHours(thresholds.default, 'timeRule.thresholds.default');
  const byType = thresholds.byType === undefined ? {} : record(thresholds.byType, 'timeRule.thresholds.byType');
  for (const [type, value] of Object.entries(byType)) {
    if (!EVALUATION_TYPES.includes(type)) throw new TypeError(`timeRule.thresholds.byType contains unknown type: ${type}`);
    positiveHours(value, `timeRule.thresholds.byType.${type}`);
  }
  if (evaluationType !== undefined && evaluationType !== null && typeof evaluationType !== 'string') {
    throw new TypeError('evaluationType must be a string, null, or undefined');
  }
  const type = typeof evaluationType === 'string' ? evaluationType.trim() || null : null;
  const hasType = EVALUATION_TYPES.includes(type) && Object.hasOwn(byType, type);
  const thresholdHours = hasType ? byType[type] : defaultHours;
  return { thresholdHours, thresholdMs: thresholdHours * HOUR_MS, source: hasType ? 'byType' : 'default', evaluationType: type };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const moduleUrl = new URL('../server/working-time.mjs', import.meta.url);
const HOUR_MS = 3_600_000;
const calendar = (changes = {}) => ({
  workdays: 'Mon-Fri',
  workStart: '09:00',
  workEnd: '18:00',
  timezone: 'UTC+08:00',
  holidays: [],
  ...changes,
});
const timeRule = (changes = {}) => ({
  mode: 'workingHours',
  calendar: calendar(),
  thresholds: {
    default: 24,
    byType: { '好评正向': 72, '中评': 48, '好评负向': 24, '差评': 24 },
  },
  unrepliedRule: true,
  ...changes,
});
async function subject() {
  assert.ok(existsSync(moduleUrl), 'working-time pure module must exist');
  return import(moduleUrl);
}

test('calendar expands Mon-Fri and returns an independent normalized copy', async () => {
  const { validateCalendar } = await subject();
  const input = calendar();
  assert.deepEqual(validateCalendar(input), {
    ...input,
    workdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    workingDates: [],
  });
  const normalized = validateCalendar(input);
  normalized.holidays.push('2026-11-02');
  normalized.workdays.pop();
  assert.deepEqual(input, calendar());
});

test('calendar sorts explicit weekdays and exception dates deterministically', async () => {
  const { validateCalendar } = await subject();
  const normalized = validateCalendar(calendar({
    workdays: [' Sun ', 'Wed', 'Mon'],
    holidays: ['2026-12-25', '2024-02-29'],
    workingDates: ['2026-11-08', '2026-11-07'],
  }));
  assert.deepEqual(normalized.workdays, ['Mon', 'Wed', 'Sun']);
  assert.deepEqual(normalized.holidays, ['2024-02-29', '2026-12-25']);
  assert.deepEqual(normalized.workingDates, ['2026-11-07', '2026-11-08']);
});

test('calendar accepts both fixed offset endpoints and canonicalizes zero', async () => {
  const { validateCalendar } = await subject();
  for (const timezone of ['UTC+14:00', 'UTC-14:00', 'UTC-03:30', 'UTC+05:45']) {
    assert.equal(validateCalendar(calendar({ timezone })).timezone, timezone);
  }
  assert.equal(validateCalendar(calendar({ timezone: 'UTC-00:00' })).timezone, 'UTC+00:00');
});

for (const [name, input, message] of [
  ['missing calendar', undefined, /calendar/],
  ['non-object calendar', [], /calendar/],
  ['missing workdays', calendar({ workdays: undefined }), /workdays/],
  ['empty weekdays', calendar({ workdays: [] }), /workdays/],
  ['unknown range shorthand', calendar({ workdays: 'Mon-Sat' }), /workdays/],
  ['unknown weekday', calendar({ workdays: ['Monday'] }), /workdays/],
  ['numeric weekday', calendar({ workdays: [1] }), /workdays/],
  ['sparse weekday array', calendar({ workdays: Array(1) }), /workdays/],
  ['duplicate weekday', calendar({ workdays: ['Mon', ' Mon '] }), /workdays/],
  ['missing start', calendar({ workStart: undefined }), /workStart/],
  ['non-padded start', calendar({ workStart: '9:00' }), /workStart/],
  ['invalid minute', calendar({ workEnd: '18:60' }), /workEnd/],
  ['24:00 end', calendar({ workEnd: '24:00' }), /workEnd/],
  ['zero window', calendar({ workEnd: '09:00' }), /workEnd/],
  ['overnight window', calendar({ workStart: '18:00', workEnd: '09:00' }), /workEnd/],
  ['IANA timezone', calendar({ timezone: 'Asia/Shanghai' }), /timezone/],
  ['missing timezone', calendar({ timezone: undefined }), /timezone/],
  ['out of range offset', calendar({ timezone: 'UTC+15:00' }), /timezone/],
  ['offset beyond +14:00', calendar({ timezone: 'UTC+14:01' }), /timezone/],
  ['invalid offset minute', calendar({ timezone: 'UTC-08:60' }), /timezone/],
  ['holidays not an array', calendar({ holidays: '2026-11-02' }), /holidays/],
  ['non-date holiday', calendar({ holidays: ['2026-11-02T00:00:00Z'] }), /holidays/],
  ['impossible date', calendar({ holidays: ['2026-02-30'] }), /holidays/],
  ['non-leap February 29', calendar({ holidays: ['2100-02-29'] }), /holidays/],
  ['date before supported range', calendar({ holidays: ['1999-12-31'] }), /holidays/],
  ['date after supported range', calendar({ holidays: ['2101-01-01'] }), /holidays/],
  ['duplicate holiday', calendar({ holidays: ['2026-11-02', '2026-11-02'] }), /holidays/],
  ['working dates not an array', calendar({ workingDates: {} }), /workingDates/],
  ['invalid makeup date', calendar({ workingDates: ['2026-04-31'] }), /workingDates/],
  ['duplicate makeup date', calendar({ workingDates: ['2026-11-07', '2026-11-07'] }), /workingDates/],
  ['holiday and makeup conflict', calendar({ holidays: ['2026-11-07'], workingDates: ['2026-11-07'] }), /holidays|workingDates/],
]) {
  test(`calendar rejects ${name}`, async () => {
    const { validateCalendar } = await subject();
    assert.throws(() => validateCalendar(input), message);
  });
}

for (const [name, start, end, expected, changes] of [
  ['Friday 17 to Monday 10 is two net hours', '2026-11-06T17:00:00+08:00', '2026-11-09T10:00:00+08:00', 2 * HOUR_MS],
  ['72 hours requires eight nine-hour workdays', '2026-11-02T09:00:00+08:00', '2026-11-11T18:00:00+08:00', 72 * HOUR_MS],
  ['mid-window overlap includes lunch without an invented break', '2026-11-02T10:30:00+08:00', '2026-11-02T12:45:00+08:00', 2.25 * HOUR_MS],
  ['full date contains only the nine-hour window', '2026-11-02T00:00:00+08:00', '2026-11-03T00:00:00+08:00', 9 * HOUR_MS],
  ['before opening contains no working time', '2026-11-02T06:00:00+08:00', '2026-11-02T08:59:59.999+08:00', 0],
  ['after closing contains no working time', '2026-11-02T18:00:00+08:00', '2026-11-02T23:00:00+08:00', 0],
  ['weekend contains no working time', '2026-11-07T00:00:00+08:00', '2026-11-08T23:59:59.999+08:00', 0],
  ['closing to next opening excludes both endpoints', '2026-11-06T18:00:00+08:00', '2026-11-09T09:00:00+08:00', 0],
  ['same instant contains no working time', '2026-11-02T09:00:00+08:00', '2026-11-02T09:00:00+08:00', 0],
  ['first millisecond counts exactly', '2026-11-02T09:00:00+08:00', '2026-11-02T09:00:00.001+08:00', 1],
  ['start precision remains exact', '2026-11-02T09:00:00.001+08:00', '2026-11-02T18:00:00+08:00', 9 * HOUR_MS - 1],
  ['short fractions represent decimal seconds', '2026-11-02T09:00:00.01+08:00', '2026-11-02T09:00:00.1+08:00', 90],
  ['holiday removes the Monday window', '2026-11-06T17:00:00+08:00', '2026-11-10T10:00:00+08:00', 2 * HOUR_MS, { holidays: ['2026-11-09'] }],
  ['holiday excludes a whole weekday', '2026-11-02T09:00:00+08:00', '2026-11-02T18:00:00+08:00', 0, { holidays: ['2026-11-02'] }],
  ['explicit makeup date opens a Saturday', '2026-11-07T09:00:00+08:00', '2026-11-07T18:00:00+08:00', 9 * HOUR_MS, { workingDates: ['2026-11-07'] }],
  ['explicit weekday list controls the weekend', '2026-11-08T09:00:00+08:00', '2026-11-09T18:00:00+08:00', 9 * HOUR_MS, { workdays: ['Sun'] }],
  ['UTC source is shifted once into +08 calendar', '2026-11-02T01:00:00Z', '2026-11-02T02:00:00Z', HOUR_MS],
  ['different source offsets can name the same instant', '2026-11-02T09:00:00+08:00', '2026-11-02T01:00:00Z', 0],
  ['quarter-hour calendar offset works', '2026-11-02T03:15:00Z', '2026-11-02T04:15:00Z', HOUR_MS, { timezone: 'UTC+05:45' }],
  ['negative half-hour calendar offset works', '2026-11-02T12:30:00Z', '2026-11-02T13:30:00Z', HOUR_MS, { timezone: 'UTC-03:30' }],
  ['positive offset endpoint works across UTC date boundary', '2026-11-02T09:00:00+14:00', '2026-11-02T10:00:00+14:00', HOUR_MS, { timezone: 'UTC+14:00' }],
  ['negative offset endpoint works', '2026-11-02T09:00:00-14:00', '2026-11-02T10:00:00-14:00', HOUR_MS, { timezone: 'UTC-14:00' }],
  ['leap date is a real Thursday', '2024-02-29T09:00:00+08:00', '2024-02-29T18:00:00+08:00', 9 * HOUR_MS],
  ['year boundary retains each daily window', '2026-12-31T17:00:00+08:00', '2027-01-01T10:00:00+08:00', 2 * HOUR_MS],
  ['zoned minute precision is accepted', '2026-11-02T09:00+08:00', '2026-11-02T10:00+08:00', HOUR_MS],
]) {
  test(`working duration: ${name}`, async () => {
    const { workingDurationMs } = await subject();
    assert.equal(typeof workingDurationMs, 'function', 'workingDurationMs must be exported');
    const input = calendar(changes);
    const before = structuredClone(input);
    assert.equal(workingDurationMs(start, end, input), expected);
    assert.deepEqual(input, before);
  });
}

for (const [name, start, end, changes, message] of [
  ['un-zoned source', '2026-11-02T09:00:00', '2026-11-02T10:00:00+08:00', {}, /startISO/],
  ['space-separated source', '2026-11-02 09:00:00+08:00', '2026-11-02T10:00:00+08:00', {}, /startISO/],
  ['impossible source date', '2026-02-30T09:00:00+08:00', '2026-11-02T10:00:00+08:00', {}, /startISO/],
  ['non-leap source date', '2100-02-29T09:00:00+08:00', '2100-03-01T10:00:00+08:00', {}, /startISO/],
  ['invalid source hour', '2026-11-02T24:00:00+08:00', '2026-11-03T10:00:00+08:00', {}, /startISO/],
  ['invalid source minute', '2026-11-02T09:60:00+08:00', '2026-11-02T10:00:00+08:00', {}, /startISO/],
  ['leap second', '2026-11-02T09:00:60+08:00', '2026-11-02T10:00:00+08:00', {}, /startISO/],
  ['sub-millisecond source', '2026-11-02T09:00:00.0001+08:00', '2026-11-02T10:00:00+08:00', {}, /startISO/],
  ['invalid source offset', '2026-11-02T09:00:00+14:01', '2026-11-02T10:00:00+08:00', {}, /startISO/],
  ['non-string source', new Date('2026-11-02T01:00:00Z'), '2026-11-02T10:00:00+08:00', {}, /startISO/],
  ['invalid end source', '2026-11-02T09:00:00+08:00', '2026-11-02', {}, /endISO/],
  ['end before start', '2026-11-02T10:00:00+08:00', '2026-11-02T09:00:00+08:00', {}, /endISO/],
  ['source before supported years', '1999-12-31T09:00:00+08:00', '2026-11-02T10:00:00+08:00', {}, /startISO/],
  ['source after supported years', '2026-11-02T09:00:00+08:00', '2101-01-01T10:00:00+08:00', {}, /endISO/],
  ['interval above 36525 days', '2000-01-01T00:00:00Z', '2100-01-01T00:00:00.001Z', {}, /interval/],
  ['calendar-local date outside supported years', '2000-01-01T00:00:00+14:00', '2000-01-01T01:00:00+14:00', { timezone: 'UTC-14:00' }, /calendar.*date/],
  ['invalid calendar even for zero duration', '2026-11-02T09:00:00+08:00', '2026-11-02T09:00:00+08:00', { workdays: [] }, /workdays/],
]) {
  test(`working duration rejects ${name}`, async () => {
    const { workingDurationMs } = await subject();
    assert.equal(typeof workingDurationMs, 'function', 'workingDurationMs must be exported');
    assert.throws(() => workingDurationMs(start, end, calendar(changes)), message);
  });
}

test('time duration selects net working hours or continuous elapsed time from config', async () => {
  const { timeDurationMs } = await subject();
  assert.equal(typeof timeDurationMs, 'function', 'timeDurationMs must be exported');
  const start = '2026-11-06T17:00:00+08:00', end = '2026-11-09T10:00:00+08:00';
  const input = timeRule();
  const before = structuredClone(input);
  assert.equal(timeDurationMs(start, end, input), 2 * HOUR_MS);
  assert.equal(timeDurationMs(start, end, timeRule({ mode: 'continuous' })), 65 * HOUR_MS);
  assert.deepEqual(input, before);
});

test('continuous time accepts equivalent zoned instants without requiring a calendar', async () => {
  const { timeDurationMs } = await subject();
  assert.equal(typeof timeDurationMs, 'function', 'timeDurationMs must be exported');
  assert.equal(timeDurationMs('2026-11-02T09:00:00+08:00', '2026-11-02T01:00:00Z', { mode: 'continuous' }), 0);
});

for (const [name, rule, start, end, message] of [
  ['missing config', undefined, '2026-11-02T09:00:00Z', '2026-11-02T10:00:00Z', /timeRule/],
  ['missing mode', {}, '2026-11-02T09:00:00Z', '2026-11-02T10:00:00Z', /mode/],
  ['unrecognized mode', timeRule({ mode: 'working' }), '2026-11-02T09:00:00Z', '2026-11-02T10:00:00Z', /mode/],
  ['working mode without calendar', { mode: 'workingHours' }, '2026-11-02T09:00:00Z', '2026-11-02T10:00:00Z', /calendar/],
  ['continuous end before start', { mode: 'continuous' }, '2026-11-02T10:00:00Z', '2026-11-02T09:00:00Z', /endISO/],
  ['continuous un-zoned input', { mode: 'continuous' }, '2026-11-02T09:00:00', '2026-11-02T10:00:00Z', /startISO/],
  ['continuous interval above bound', { mode: 'continuous' }, '2000-01-01T00:00:00Z', '2100-01-01T00:00:00.001Z', /interval/],
]) {
  test(`time duration rejects ${name}`, async () => {
    const { timeDurationMs } = await subject();
    assert.equal(typeof timeDurationMs, 'function', 'timeDurationMs must be exported');
    assert.throws(() => timeDurationMs(start, end, rule), message);
  });
}

for (const [evaluationType, expected] of [['好评正向', 72], ['中评', 48], ['好评负向', 24], ['差评', 24]]) {
  test(`threshold resolves explicitly configured ${evaluationType}`, async () => {
    const { resolveTimeThreshold } = await subject();
    assert.equal(typeof resolveTimeThreshold, 'function', 'resolveTimeThreshold must be exported');
    const input = timeRule();
    const before = structuredClone(input);
    assert.deepEqual(resolveTimeThreshold(input, ` ${evaluationType} `), {
      thresholdHours: expected,
      thresholdMs: expected * HOUR_MS,
      source: 'byType',
      evaluationType,
    });
    assert.deepEqual(input, before);
  });
}

for (const evaluationType of [undefined, null, '', '  ', '待分类', '好评', 'toString']) {
  test(`threshold uses configured default for missing or unknown type ${String(evaluationType)}`, async () => {
    const { resolveTimeThreshold } = await subject();
    assert.equal(typeof resolveTimeThreshold, 'function', 'resolveTimeThreshold must be exported');
    assert.deepEqual(resolveTimeThreshold(timeRule({ thresholds: { default: 17 } }), evaluationType), {
      thresholdHours: 17,
      thresholdMs: 17 * HOUR_MS,
      source: 'default',
      evaluationType: typeof evaluationType === 'string' ? evaluationType.trim() || null : null,
    });
  });
}

test('known type missing from byType uses the configured default without built-in values', async () => {
  const { resolveTimeThreshold } = await subject();
  assert.equal(typeof resolveTimeThreshold, 'function', 'resolveTimeThreshold must be exported');
  assert.equal(resolveTimeThreshold(timeRule({ thresholds: { default: 19, byType: { '中评': 41 } } }), '好评正向').thresholdHours, 19);
  assert.equal(resolveTimeThreshold(timeRule({ thresholds: { default: 19, byType: { '好评正向': 96 } } }), '好评正向').thresholdHours, 96);
  assert.equal(resolveTimeThreshold(timeRule({ thresholds: { default: 0.5, byType: {} } }), '差评').thresholdMs, HOUR_MS / 2);
});

for (const [name, rule, evaluationType, message] of [
  ['missing config', undefined, '差评', /timeRule/],
  ['missing thresholds', {}, '差评', /thresholds/],
  ['thresholds array', { thresholds: [] }, '差评', /thresholds/],
  ['missing default despite known type', { thresholds: { byType: { '差评': 24 } } }, '差评', /default/],
  ['zero default', { thresholds: { default: 0 } }, null, /default/],
  ['negative default', { thresholds: { default: -24 } }, null, /default/],
  ['string default', { thresholds: { default: '24' } }, null, /default/],
  ['infinite default', { thresholds: { default: Infinity } }, null, /default/],
  ['NaN default', { thresholds: { default: NaN } }, null, /default/],
  ['unsafe millisecond threshold', { thresholds: { default: Number.MAX_VALUE } }, null, /default/],
  ['byType array', { thresholds: { default: 24, byType: [] } }, null, /byType/],
  ['unknown byType label', { thresholds: { default: 24, byType: { '好评': 72 } } }, null, /byType/],
  ['zero per-type threshold', { thresholds: { default: 24, byType: { '差评': 0 } } }, '差评', /byType/],
  ['invalid unused per-type threshold', { thresholds: { default: 24, byType: { '中评': -1 } } }, '差评', /byType/],
  ['non-string evaluation type', timeRule(), 1, /evaluationType/],
]) {
  test(`threshold rejects ${name}`, async () => {
    const { resolveTimeThreshold } = await subject();
    assert.equal(typeof resolveTimeThreshold, 'function', 'resolveTimeThreshold must be exported');
    assert.throws(() => resolveTimeThreshold(rule, evaluationType), message);
  });
}

for (const [mode, end] of [
  ['continuous', '2026-11-03T08:59:59.999+08:00'],
  ['continuous', '2026-11-03T09:00:00.000+08:00'],
  ['continuous', '2026-11-03T09:00:00.001+08:00'],
  ['workingHours', '2026-11-04T14:59:59.999+08:00'],
  ['workingHours', '2026-11-04T15:00:00.000+08:00'],
  ['workingHours', '2026-11-04T15:00:00.001+08:00'],
]) {
  test(`${mode} retains exact 24-hour threshold boundary at ${end}`, async () => {
    const { timeDurationMs, resolveTimeThreshold } = await subject();
    assert.equal(typeof timeDurationMs, 'function', 'timeDurationMs must be exported');
    assert.equal(typeof resolveTimeThreshold, 'function', 'resolveTimeThreshold must be exported');
    const rule = timeRule({ mode });
    const threshold = resolveTimeThreshold(rule, '差评');
    const actual = timeDurationMs('2026-11-02T09:00:00+08:00', end, rule);
    const expectedDelta = end.includes('59.999') ? -1 : end.includes('00.001') ? 1 : 0;
    assert.equal(actual - threshold.thresholdMs, expectedDelta);
    assert.equal(Object.hasOwn(threshold, 'verdict'), false);
  });
}

test('the maximum accepted interval is bounded and includes only its eligible windows', async () => {
  const { workingDurationMs, timeDurationMs } = await subject();
  const start = '2000-01-01T00:00:00Z', end = '2100-01-01T00:00:00Z';
  assert.equal(timeDurationMs(start, end, { mode: 'continuous' }), 36_525 * 24 * HOUR_MS);
  // 5217 whole weeks plus Saturday..Thursday = 26089 Monday..Friday dates.
  assert.equal(workingDurationMs(start, end, calendar({ timezone: 'UTC+00:00' })), 26_089 * 9 * HOUR_MS);
});

test('duration does not depend on the host process timezone', async () => {
  await subject();
  const source = `import {workingDurationMs,timeDurationMs} from ${JSON.stringify(moduleUrl.href)};
    const start='2026-11-06T17:00:00+08:00', end='2026-11-09T10:00:00+08:00';
    console.log(JSON.stringify([workingDurationMs(start,end,${JSON.stringify(calendar())}),
      timeDurationMs(start,end,{mode:'continuous'})]));`;
  for (const timezone of ['UTC', 'Pacific/Honolulu', 'Europe/Berlin']) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, TZ: timezone },
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr || String(result.error || timezone));
    assert.deepEqual(JSON.parse(result.stdout), [2 * HOUR_MS, 65 * HOUR_MS], timezone);
  }
});

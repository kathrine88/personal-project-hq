import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dateKey, calendarDate, monday, addDays, validDate } from '../js/dates.js';

test('Monday-first weeks handle Sundays, month and year boundaries', () => {
  assert.equal(dateKey(monday(calendarDate('2026-11-01'))), '2026-10-26');
  assert.equal(dateKey(monday(calendarDate('2026-10-26'))), '2026-10-26');
  assert.equal(dateKey(addDays(monday(calendarDate('2027-01-01')), 6)), '2027-01-03');
  assert.equal(dateKey(addDays(calendarDate('2026-12-28'), 7)), '2027-01-04');
  assert.equal(dateKey(addDays(calendarDate('2026-01-05'), -7)), '2025-12-29');
});

test('DATE validation rejects impossible dates, accepts leap days', () => {
  for (const value of ['2026-02-29','2026-04-31','2026-13-01','invalid','2026-1-1']) assert.equal(validDate(value), false, value);
  for (const value of ['2028-02-29','2026-12-31','0001-01-01']) assert.equal(validDate(value), true, value);
});

test('local calendar dates survive DST and UTC offsets', () => {
  const moduleUrl = new URL('../js/dates.js', import.meta.url).href;
  for (const timezone of ['Europe/London','America/Los_Angeles','Pacific/Auckland']) {
    const script = `import {calendarDate,dateKey,addDays,monday} from '${moduleUrl}';
      import assert from 'node:assert/strict';
      for (const day of ['2026-03-08','2026-03-29','2026-10-25','2026-11-01']) {
        assert.equal(dateKey(calendarDate(day)),day);
        assert.equal(dateKey(addDays(addDays(calendarDate(day),7),-7)),day);
      }
      assert.equal(dateKey(new Date(2026,9,26,0,15)),'2026-10-26');
      assert.equal(dateKey(monday(calendarDate('2026-11-01'))),'2026-10-26');`;
    const result=spawnSync(process.execPath,['--input-type=module','-e',script],{env:{...process.env,TZ:timezone},encoding:'utf8'});
    assert.equal(result.status,0,timezone + ': ' + result.stderr);
  }
});

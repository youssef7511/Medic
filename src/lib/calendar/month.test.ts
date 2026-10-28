import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMonth } from './layout';

test('a six-row month includes every date and adjacent Monday/Sunday edges', () => {
  const days = buildMonth({ anchor: new Date('2026-03-15T12:00:00Z'), timezone: 'Africa/Tunis', locale: 'fr' });
  assert.equal(days.length, 42);
  assert.equal(days[0]!.isoDate, '2026-02-23');
  assert.equal(days.at(-1)?.isoDate, '2026-04-05');
  assert.equal(new Set(days.map(day => day.isoDate)).size, 42);
  assert.equal(days.filter(day => day.isoDate.startsWith('2026-03')).length, 31);
});

test('month and today are determined by the practice timezone at a UTC boundary', () => {
  const instant = new Date('2026-09-30T23:30:00Z');
  const days = buildMonth({ anchor: instant, now: instant, timezone: 'Africa/Tunis', locale: 'ar' });
  assert.equal(days.filter(day => day.isoDate.startsWith('2026-10')).length, 31);
  assert.equal(days.find(day => day.isToday)?.isoDate, '2026-10-01');
  assert.equal(days[0]!.weekday, 1);
  assert.equal(days.at(-1)?.weekday, 0);
});

test('month rows stay contiguous through Morocco DST changes', () => {
  const days = buildMonth({ anchor: new Date('2026-02-15T12:00:00Z'), timezone: 'Africa/Casablanca', locale: 'ar' });
  assert.equal(new Set(days.map(day => day.isoDate)).size, days.length);
  assert.equal(days.filter(day => day.isoDate.startsWith('2026-02')).length, 28);
  for (let index = 1; index < days.length; index++) {
    assert.equal(new Date(days[index]!.isoDate).getTime() - new Date(days[index - 1]!.isoDate).getTime(), 86400000);
  }
});

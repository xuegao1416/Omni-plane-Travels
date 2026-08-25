import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

describe('trial reservation lease migration', () => {
  test('defines independently expiring reservations', () => {
    const migration = readFileSync(new URL('../../migrations/0009_trial_reservation_leases.sql', import.meta.url), 'utf8');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS trial_reservations');
    expect(migration).toContain('expires_at INTEGER NOT NULL');
    expect(migration).toContain('UPDATE trial_usage SET reserved_count = 0');
  });
});

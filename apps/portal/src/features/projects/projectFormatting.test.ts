import { describe, expect, it } from 'vitest';

import {
  daysUntil,
  formatAddress,
  formatDeliveryDate,
  formatProjectBadgeLabel,
  formatProjectLifecycleLabel,
  isProjectArchived,
  projectBadgeClasses,
  projectDotClasses,
  statusBadgeClasses,
  statusDotClasses,
} from './projectFormatting';

describe('formatProjectLifecycleLabel', () => {
  it('returns "Archived" for archived state', () => {
    expect(formatProjectLifecycleLabel('archived')).toBe('Archived');
  });

  it('returns "Removed" for removed state', () => {
    expect(formatProjectLifecycleLabel('removed')).toBe('Removed');
  });

  it('returns "Active" for active state', () => {
    expect(formatProjectLifecycleLabel('active')).toBe('Active');
  });
});

describe('isProjectArchived', () => {
  it('returns true for archived projects', () => {
    expect(isProjectArchived({ lifecycle_state: 'archived' })).toBe(true);
  });

  it('returns false for active projects', () => {
    expect(isProjectArchived({ lifecycle_state: 'active' })).toBe(false);
  });
});

describe('projectBadgeClasses', () => {
  it('returns status classes for active projects', () => {
    const result = projectBadgeClasses({ status: 'ontwerp', lifecycle_state: 'active' });
    expect(result).toContain('sky');
  });

  it('returns lifecycle classes for archived projects', () => {
    const result = projectBadgeClasses({ status: 'ontwerp', lifecycle_state: 'archived' });
    expect(result).toContain('white');
  });
});

describe('projectDotClasses', () => {
  it('returns status dot for active projects', () => {
    const result = projectDotClasses({ status: 'uitvoering', lifecycle_state: 'active' });
    expect(result).toContain('green');
  });

  it('returns lifecycle dot for archived projects', () => {
    const result = projectDotClasses({ status: 'uitvoering', lifecycle_state: 'archived' });
    expect(result).toBe('bg-white');
  });
});

describe('formatProjectBadgeLabel', () => {
  it('returns statusLabel for active projects', () => {
    const result = formatProjectBadgeLabel(
      { status: 'ontwerp', lifecycle_state: 'active' },
      'Design',
    );
    expect(result).toBe('Design');
  });

  it('returns lifecycle label for non-active projects', () => {
    const result = formatProjectBadgeLabel(
      { status: 'ontwerp', lifecycle_state: 'archived' },
      'Design',
    );
    expect(result).toBe('Archived');
  });
});

describe('statusBadgeClasses / statusDotClasses', () => {
  it('returns badge classes for a status', () => {
    expect(statusBadgeClasses('planning')).toContain('slate');
  });

  it('returns dot classes for a status', () => {
    expect(statusDotClasses('on_hold')).toContain('rose');
  });
});

describe('formatAddress', () => {
  it('formats a full address', () => {
    const result = formatAddress({
      street: 'Kerkstraat',
      house_number: '12',
      postal_code: '1234 AB',
      city: 'Amsterdam',
    });
    expect(result).toBe('Kerkstraat 12, 1234 AB Amsterdam');
  });

  it('returns null for all-null parts', () => {
    expect(formatAddress({
      street: null,
      house_number: null,
      postal_code: null,
      city: null,
    })).toBeNull();
  });

  it('handles partial address (city only)', () => {
    expect(formatAddress({
      street: null,
      house_number: null,
      postal_code: null,
      city: 'Utrecht',
    })).toBe('Utrecht');
  });

  it('handles street without house number', () => {
    expect(formatAddress({
      street: 'Dorpsweg',
      house_number: null,
      postal_code: null,
      city: 'Leiden',
    })).toBe('Dorpsweg, Leiden');
  });
});

describe('daysUntil', () => {
  it('returns 0 for today', () => {
    const today = new Date();
    expect(daysUntil(today.toISOString())).toBe(0);
  });

  it('returns positive for future dates', () => {
    const future = new Date();
    future.setDate(future.getDate() + 10);
    expect(daysUntil(future.toISOString())).toBe(10);
  });

  it('returns negative for past dates', () => {
    const past = new Date();
    past.setDate(past.getDate() - 5);
    expect(daysUntil(past.toISOString())).toBe(-5);
  });
});

describe('formatDeliveryDate', () => {
  it('formats a valid date in English locale', () => {
    const result = formatDeliveryDate('2025-06-15', 'en');
    expect(result).toContain('2025');
    expect(result).toContain('15');
  });

  it('formats a valid date in Dutch locale', () => {
    const result = formatDeliveryDate('2025-06-15', 'nl');
    expect(result).toContain('2025');
    expect(result).toContain('15');
  });

  it('returns raw string for invalid date', () => {
    expect(formatDeliveryDate('not-a-date', 'en')).toBe('not-a-date');
  });
});

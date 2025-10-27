/**
 * Constants for reminder functionality
 */

// Default snooze durations in minutes
export const SNOOZE_DURATIONS = [
  { minutes: 0, label: 'Now' },
  { minutes: 10, label: '+10m' },
  { minutes: 30, label: '+30m' },
  { minutes: 60, label: '+1h' },
  { minutes: 120, label: '+2h' }
]

// Default reminder offset (30 minutes from now)
export const DEFAULT_REMINDER_OFFSET_MINUTES = 30


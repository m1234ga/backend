/**
 * Timezone utility for consistent timestamp handling across the application.
 * Reads timezone offset from TIMEZONE_OFFSET_HOURS environment variable.
 * Defaults to +2 (Cairo timezone) if not set.
 */

// Get timezone offset from environment variable (in hours)
// Default to +2 (Cairo timezone) if not set
export function getTimezoneOffsetHours(): number {
    const envOffset = process.env.TIMEZONE_OFFSET_HOURS;
    if (envOffset !== undefined && envOffset !== '') {
        const parsed = Number(envOffset);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return 0; // Default to UTC
}

/**
 * Adjusts a timestamp to the configured timezone.
 * @param timestamp - The Date object to adjust
 * @returns A new Date object adjusted for the configured timezone
 */
export function adjustToConfiguredTimezone(timestamp: Date): Date {
    const offsetHours = getTimezoneOffsetHours();
    const offsetMs = offsetHours * 60 * 60 * 1000;
    return new Date(timestamp.getTime() + offsetMs);
}

/**
 * Gets the current time adjusted to the configured timezone.
 * @returns A new Date object representing the current time in the configured timezone
 */
export function getCurrentTimeInTimezone(): Date {
    return adjustToConfiguredTimezone(new Date());
}

/**
 * Alias for adjustToConfiguredTimezone for backward compatibility.
 * @deprecated Use adjustToConfiguredTimezone instead
 */
export function adjustToCairoTime(timestamp: Date): Date {
    return adjustToConfiguredTimezone(timestamp);
}

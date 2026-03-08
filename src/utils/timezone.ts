/**
 * Timezone utility for consistent timestamp handling across the application.
 *
 * UTC-only mode:
 * - Backend stores and processes all timestamps in UTC.
 * - TIMEZONE_OFFSET_HOURS is intentionally ignored to prevent accidental shifts.
 */

export function getTimezoneOffsetHours(): number {
    return 0;
}

/**
 * Adjusts a timestamp to the configured timezone.
 * @param timestamp - The Date object to adjust
 * @returns A new Date object adjusted for the configured timezone
 */
export function adjustToConfiguredTimezone(timestamp: Date): Date {
    // Check if timestamp is valid
    if (!(timestamp instanceof Date) || isNaN(timestamp.getTime())) {
        // Fallback to current UTC time if invalid
        return new Date();
    }

    // Preserve UTC instant exactly as-is.
    return new Date(timestamp.getTime());
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

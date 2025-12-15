"use strict";
/**
 * Timezone utility for consistent timestamp handling across the application.
 * Reads timezone offset from TIMEZONE_OFFSET_HOURS environment variable.
 * Defaults to +2 (Cairo timezone) if not set.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTimezoneOffsetHours = getTimezoneOffsetHours;
exports.adjustToConfiguredTimezone = adjustToConfiguredTimezone;
exports.getCurrentTimeInTimezone = getCurrentTimeInTimezone;
exports.adjustToCairoTime = adjustToCairoTime;
// Get timezone offset from environment variable (in hours)
// Default to +2 (Cairo timezone) if not set
function getTimezoneOffsetHours() {
    const envOffset = process.env.TIMEZONE_OFFSET_HOURS;
    if (envOffset !== undefined && envOffset !== '') {
        const parsed = parseFloat(envOffset);
        if (!isNaN(parsed)) {
            return parsed;
        }
    }
    return 2; // Default to Cairo timezone (UTC+2)
}
/**
 * Adjusts a timestamp to the configured timezone.
 * @param timestamp - The Date object to adjust
 * @returns A new Date object adjusted for the configured timezone
 */
function adjustToConfiguredTimezone(timestamp) {
    const offsetHours = getTimezoneOffsetHours();
    const offsetMs = offsetHours * 60 * 60 * 1000;
    return new Date(timestamp.getTime() + offsetMs);
}
/**
 * Gets the current time adjusted to the configured timezone.
 * @returns A new Date object representing the current time in the configured timezone
 */
function getCurrentTimeInTimezone() {
    return adjustToConfiguredTimezone(new Date());
}
/**
 * Alias for adjustToConfiguredTimezone for backward compatibility.
 * @deprecated Use adjustToConfiguredTimezone instead
 */
function adjustToCairoTime(timestamp) {
    return adjustToConfiguredTimezone(timestamp);
}

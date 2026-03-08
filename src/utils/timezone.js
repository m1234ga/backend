"use strict";
/**
 * Timezone utility for consistent timestamp handling across the application.
 *
 * UTC-only mode:
 * - Backend stores and processes all timestamps in UTC.
 * - TIMEZONE_OFFSET_HOURS is intentionally ignored to prevent accidental shifts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTimezoneOffsetHours = getTimezoneOffsetHours;
exports.adjustToConfiguredTimezone = adjustToConfiguredTimezone;
exports.getCurrentTimeInTimezone = getCurrentTimeInTimezone;
exports.adjustToCairoTime = adjustToCairoTime;
function getTimezoneOffsetHours() {
    return 0;
}
/**
 * Adjusts a timestamp to the configured timezone.
 * @param timestamp - The Date object to adjust
 * @returns A new Date object adjusted for the configured timezone
 */
function adjustToConfiguredTimezone(timestamp) {
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

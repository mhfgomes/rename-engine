/** Largest pad width accepted by sequence rules and the custom-rule `pad` helper. */
export const MAX_PAD_WIDTH = 255;

/** Maximum file or directory name length: UTF-8 bytes on posix, UTF-16 code units on win32. */
export const MAX_NAME_LENGTH = 255;

/**
 * Maximum length of a user-supplied regular expression pattern (find/replace with `useRegex`
 * and the custom-rule `regexReplace` helper). This bounds input size only; it cannot prevent
 * catastrophic backtracking, so callers should evaluate untrusted rules off the main thread.
 */
export const MAX_REGEX_PATTERN_LENGTH = 1000;

/** Maximum length of any text value produced while evaluating a custom rule expression. */
export const MAX_CUSTOM_RULE_TEXT_LENGTH = 4096;

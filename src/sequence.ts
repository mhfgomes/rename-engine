// Internal sequence helpers. Not part of the public API (not re-exported from `index.ts`).

/** Largest letter-sequence value is `Number.MAX_SAFE_INTEGER`, which needs 12 letters. */
const MAX_LETTER_SEQUENCE_LENGTH = 12;

/**
 * Computes `start + index * step` for a sequence rule and rejects values that cannot be
 * represented exactly: non-finite inputs, non-finite results, or magnitudes above
 * `Number.MAX_SAFE_INTEGER` (for example `step: 1e308` overflowing to `Infinity`).
 */
export function computeSequenceValue(start: number, step: number, index: number) {
  if (!Number.isFinite(start) || !Number.isFinite(step)) {
    throw new Error('Sequence start and step must be finite numbers.');
  }

  const value = start + index * step;
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
    throw new Error(
      `Sequence value for item ${index + 1} is outside the supported range of ±${Number.MAX_SAFE_INTEGER}.`,
    );
  }

  return value;
}

/**
 * Formats a 1-based value as a spreadsheet-style letter sequence (`1` → `A`, `27` → `AA`).
 * Values below 1 are clamped to 1 and fractions are floored. Throws for values that are not
 * finite or whose floor is not a safe integer, so the loop below always terminates.
 */
export function formatLetterSequence(value: number, casing: 'upper' | 'lower') {
  if (!Number.isFinite(value)) {
    throw new Error('Letter sequence value must be a finite number.');
  }

  const normalizedValue = Math.max(1, Math.floor(value));
  if (!Number.isSafeInteger(normalizedValue)) {
    throw new Error(`Letter sequence value must not exceed ${Number.MAX_SAFE_INTEGER}.`);
  }

  const alphabetStart = casing === 'upper' ? 65 : 97;
  let remaining = normalizedValue;
  let sequence = '';

  for (let iteration = 0; remaining > 0; iteration += 1) {
    if (iteration >= MAX_LETTER_SEQUENCE_LENGTH) {
      throw new Error('Letter sequence value is too large.');
    }
    remaining -= 1;
    sequence = String.fromCharCode(alphabetStart + (remaining % 26)) + sequence;
    remaining = Math.floor(remaining / 26);
  }

  return sequence;
}

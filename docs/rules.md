# Rename rule reference

[Documentation home](../README.md) · [API](api.md) · [Custom expressions](custom-expressions.md)

## Common fields and processing

Every rule has `id: string`, `enabled: boolean`, and optional `label: string`, plus a `type` discriminator. Rules run in array order; disabled rules do nothing. There is no implicit priority or per-rule sort. The planner does not use ids to deduplicate rules. A nonempty trimmed label is used in generic failure messages.

Unless explicitly optional below, fields are required by the TypeScript interfaces. For example, `extension_handling.replacement` is required even when its mode does not use it. The planner trusts the typed shape; applications accepting JSON should validate its schema before planning.

Files are split into a stem and an extension without a leading dot. Most rules transform the current stem and keep the extension. Directories have no extension and use their entire name as the stem. Original values remain available to templates and custom expressions throughout the pipeline.

Examples below show one file at index 0 unless another index is stated. All rule objects also need common `id` and `enabled` fields.

## `new_name` — `NewNameRule`

| Field | Type | Meaning |
| --- | --- | --- |
| `type` | `'new_name'` | Discriminator |
| `template` | `string` | Replaces the current stem; current extension is kept |
| `reverseSequence` | `boolean?` | Reverses numeric template sequence index; defaults to false |

```ts
{ id: 'name', enabled: true, type: 'new_name', template: '{seq:001}_{original}' }
// Report.pdf -> 001_Report.pdf
```

The template is a stem, not a full filename. A template of `report.txt` applied to `old.pdf` yields `report.txt.pdf`. To return a full name, use `custom_rule` or combine a stem template with `extension_handling`.

Tokens are matched case-insensitively. Unknown tokens remain verbatim. There is no escaping syntax for recognized tokens and no arbitrary expression evaluation within braces.

| Token and aliases | Meaning |
| --- | --- |
| `{current}`, `{current_stem}` | Stem after previous enabled rules |
| `{original}`, `{original_stem}` | Stem of the original input name |
| `{parent}`, `{parent_name}` | Basename of the original input parent path, not its renamed target |
| `{seq}`, `{seq_num}` | One-based numeric sequence |
| `{seq:001}`, `{seq_num:001}` | Start at numeric argument; pad according to argument width |
| `{seq_letter}`, `{letter_seq}` | One-based spreadsheet letters, uppercase by default |
| `{seq_letter:lower}`, `{letter_seq:a}` | Lowercase letters; `lower` or `a` selects lowercase (case-insensitively) |
| `{seq_letter_rev}`, `{seq_letter_reverse}`, `{reverse_seq_letter}`, `{reverse_letter_seq}` | Letters based on `max(1, total - index)`; accepts the same casing argument |
| `{date}`, `{date:YYYYMMDD}` | Local date; default `YYYY-MM-DD` |
| `{time}`, `{time:HH-mm-ss}` | Local time; default `HHmmss` |

A numeric argument must contain only digits. If absent or nonnumeric, the value is `index + 1`. A digit argument sets the start to `Number(argument)` and the value to start plus index. Padding is enabled for multi-digit arguments or arguments beginning with zero: `{seq:10}` starts at `10` with minimum width 2; `{seq:000}` starts at `000`; `{seq:5}` starts at `5` without padding. The width is a minimum, so `{seq:099}` eventually produces `100`.

With `reverseSequence: true`, numeric tokens use `max(0, total - index - 1)` instead of index. Forward letter tokens remain forward; reverse letter tokens remain reverse. Sequence tokens operate globally across all rows, not per folder. The template sequence implementation does not use the `sequence_insert.padWidth` cap; final name validation still applies in previews.

## `custom_rule` — `CustomRule`

| Field | Type | Meaning |
| --- | --- | --- |
| `type` | `'custom_rule'` | Discriminator |
| `expression` | `string` | Expression returning the entire new name |

```ts
{
  id: 'custom', enabled: true, type: 'custom_rule',
  expression: 'snake(originalStem) + "_" + pad(index, 3) + ext(lower(extension))',
}
// My File.TXT -> my_file_001.txt
```

The expression must return text. The returned full name is split into stem/extension for subsequent rules. Omitting `ext(extension)` removes the previous extension; it is not automatically kept. For directories, the returned text remains one whole stem.

See the [complete language reference](custom-expressions.md) for all identifiers, helpers, operators, limits, and error behavior.

## `find_replace` — `FindReplaceRule`

| Field | Type | Meaning |
| --- | --- | --- |
| `type` | `'find_replace'` | Discriminator |
| `find` | `string` | Literal text or regex source; empty is a no-op |
| `replace` | `string` | Replacement |
| `matchCase` | `boolean` | Case-sensitive matching when true |
| `useRegex` | `boolean` | Interpret `find` as regex source when true |
| `replaceAll` | `boolean` | Replace all matches when true, otherwise the first |

```ts
{
  id: 'spaces', enabled: true, type: 'find_replace',
  find: ' ', replace: '-', matchCase: true, useRegex: false, replaceAll: true,
}
// My File.txt -> My-File.txt
```

Only the stem is searched. Literal replacement inserts replacement text literally, including `$&` or `$1`. Case-insensitive literal matching uses escaped Unicode-aware `iu`/`giu` regexes to preserve offsets when case conversion changes string length.

Regex mode uses `i` if case-insensitive and `g` if replacing all; it does not automatically add `u`, `m`, or `s`. Supply the pattern source without `/.../` delimiters. Regex replacement uses JavaScript replacement-string semantics (`$&`, `$1`, named captures, and so on). Invalid regex syntax and patterns longer than 1000 UTF-16 code units fail the rule. See [worker isolation](guide.md#running-untrusted-rules-in-a-worker).

```ts
{
  id: 'capture', enabled: true, type: 'find_replace',
  find: '^(.*) ([0-9]+)$', replace: '$2_$1',
  matchCase: true, useRegex: true, replaceAll: false,
}
// Photo 12.jpg -> 12_Photo.jpg
```

## `prefix_suffix` — `PrefixSuffixRule`

| Field | Type | Meaning |
| --- | --- | --- |
| `type` | `'prefix_suffix'` | Discriminator |
| `prefix` | `string` | Prepended to stem |
| `suffix` | `string` | Appended to stem, before extension |

```ts
{ id: 'decorate', enabled: true, type: 'prefix_suffix', prefix: 'draft_', suffix: '_v2' }
// Report.pdf -> draft_Report_v2.pdf
```

Strings are literal, without token expansion. Supply separators explicitly.

## `case_transform` — `CaseTransformRule`

`type: 'case_transform'`, `mode` is one of:

| Mode | Behavior | Example stem: `My File_name` |
| --- | --- | --- |
| `lower` | JavaScript lowercase | `my file_name` |
| `upper` | JavaScript uppercase | `MY FILE_NAME` |
| `title` | Lowercase, split whitespace/underscore/dash, capitalize each segment, join spaces | `My File Name` |
| `sentence` | Lowercase all, uppercase first character | `My file_name` |
| `camel` | Split words, lowercase first, capitalize following words | `myFileName` |
| `pascal` | Split words, capitalize each | `MyFileName` |
| `kebab` | Split words, lowercase, join dashes | `my-file-name` |
| `snake` | Split words, lowercase, join underscores | `my_file_name` |

Word splitting for camel/pascal/kebab/snake inserts a boundary between ASCII lowercase/digit and uppercase, then splits whitespace, dots, underscores, and dashes. It is not a full Unicode linguistic tokenizer or acronym detector. Title mode has a different splitter and does not split dots or existing camelCase boundaries. Extensions are unchanged.

```ts
{ id: 'case', enabled: true, type: 'case_transform', mode: 'kebab' }
// MyReport.PDF -> my-report.PDF
```

## `trim_text` — `TrimTextRule`

`type: 'trim_text'`, `mode` is one of:

| Mode | Stem operation |
| --- | --- |
| `trim` | Remove surrounding JavaScript whitespace |
| `trim_start` | Remove leading whitespace |
| `trim_end` | Remove trailing whitespace |
| `collapse_spaces` | Replace each whitespace run with one ASCII space, then trim |
| `remove_spaces` | Remove all whitespace (`\s`), including tabs/newlines |
| `remove_dashes` | Remove every ASCII `-` |
| `remove_underscores` | Remove every `_` |

```ts
{ id: 'trim', enabled: true, type: 'trim_text', mode: 'collapse_spaces' }
// "  My   File  .txt" -> "My File.txt"
```

## `remove_text` — `RemoveTextRule`

| Field | Type | Meaning |
| --- | --- | --- |
| `type` | `'remove_text'` | Discriminator |
| `text` | `string` | Literal text to remove; empty is a no-op |
| `matchCase` | `boolean` | Case-sensitive when true |

Removes every occurrence from the stem with an escaped Unicode-aware regex. It does not interpret `text` as regex syntax.

```ts
{ id: 'remove', enabled: true, type: 'remove_text', text: 'copy', matchCase: false }
// COPY_report_copy.txt -> _report_.txt
```

## Sequence/date insertion positions

`sequence_insert`, `letter_sequence_insert`, and `date_time` share `position` and `separator`. A separator is inserted even if the original name or token is empty; it is not trimmed automatically.

| Position | With `Report.txt`, token `001`, separator `_` |
| --- | --- |
| `prefix` | `001_Report.txt` |
| `before_extension` | `Report_001.txt` |
| `suffix` | `Report.txt_001` |

`prefix`/`suffix` decorate the whole current name and split it again afterward. Thus the suffix example's new extension is `txt_001`; a following extension rule operates on that value. For directories and extensionless files, `suffix` and `before_extension` usually produce the same result, but inserted dots can affect subsequent file splitting.

## `sequence_insert` — `SequenceInsertRule`

| Field | Type | Meaning |
| --- | --- | --- |
| `type` | `'sequence_insert'` | Discriminator |
| `position` | `'prefix' \| 'suffix' \| 'before_extension'` | Placement above |
| `start` | `number` | First value |
| `step` | `number` | Increment per zero-based global index |
| `padWidth` | `number` | Minimum digit width; at most 255 |
| `separator` | `string` | Literal separator |

Value is `start + index * step`. Start and step must be finite; zero, negative, and fractional values are accepted. Padding width is floored, negative widths become zero, and nonfinite widths or widths above 255 fail. The sign is outside the padding: value -1, width 3 yields `-001`.

```ts
{
  id: 'number', enabled: true, type: 'sequence_insert',
  position: 'before_extension', start: 1, step: 1, padWidth: 3, separator: '_',
}
// Report.txt -> Report_001.txt
```

Use integer start/step for conventional numbering. The computed value must be finite and its absolute magnitude must not exceed `Number.MAX_SAFE_INTEGER` (9007199254740991). Overflow or out-of-range values fail the rule for the affected item. Fractional values are still accepted; this is a magnitude bound, not an integer-only restriction.

## `letter_sequence_insert` — `LetterSequenceInsertRule`

| Field | Type | Meaning |
| --- | --- | --- |
| `type` | `'letter_sequence_insert'` | Discriminator |
| `position` | `'prefix' \| 'suffix' \| 'before_extension'` | Placement above |
| `start` | `number` | Spreadsheet index: 1=A, 26=Z, 27=AA |
| `step` | `number` | Increment per global index |
| `casing` | `'upper' \| 'lower'` | Alphabet case |
| `separator` | `string` | Literal separator |

Start/step must be finite. The computed value must also be finite and within ±`Number.MAX_SAFE_INTEGER`; otherwise the rule fails for the affected item. A supported value is floored and clamped to at least 1. A decreasing sequence can therefore repeat A/a after reaching 1. There is no letter padding.

```ts
{
  id: 'letters', enabled: true, type: 'letter_sequence_insert',
  position: 'prefix', start: 27, step: 1, casing: 'upper', separator: '_',
}
// Report.txt -> AA_Report.txt
```

## `date_time` — `DateTimeRule`

| Field | Type | Meaning |
| --- | --- | --- |
| `type` | `'date_time'` | Discriminator |
| `position` | `'prefix' \| 'suffix' \| 'before_extension'` | Placement above |
| `format` | `string` | Local date/time token string |
| `separator` | `string` | Literal separator |

Supported tokens are case-sensitive:

| Token | Meaning |
| --- | --- |
| `YYYY` | Full local year |
| `MM` | Two-digit local month, 01–12 |
| `DD` | Two-digit day of month |
| `HH` | Two-digit hour, 00–23 |
| `mm` | Two-digit minutes |
| `ss` | Two-digit seconds |

Other text is kept literally. This is token substitution, not a general date-format library: there are no timezone/UTC options, milliseconds, locale names, or escaping rules. It uses the planning time, not file creation/modification dates. One timestamp is shared across a `generatePreview` call.

```ts
{
  id: 'date', enabled: true, type: 'date_time',
  position: 'prefix', format: 'YYYY-MM-DD', separator: '_',
}
// On local 2026-10-07: Report.txt -> 2026-10-07_Report.txt
```

## `extension_handling` — `ExtensionHandlingRule`

| Field | Type | Meaning |
| --- | --- | --- |
| `type` | `'extension_handling'` | Discriminator |
| `mode` | `'keep' \| 'lowercase' \| 'uppercase' \| 'replace' \| 'remove'` | Extension operation |
| `replacement` | `string` | Used by replace mode; required in all modes |

| Mode | Example |
| --- | --- |
| `keep` | `Report.TXT` → `Report.TXT` |
| `lowercase` | `Report.TXT` → `Report.txt` |
| `uppercase` | `Report.txt` → `Report.TXT` |
| `replace`, replacement `.md` | `Report.txt` → `Report.md` |
| `remove` | `Report.txt` → `Report` |

Replace strips at most one leading dot and does not trim whitespace. An empty replacement removes the extension. A nonempty replacement can add an extension to an extensionless file. A dotfile such as `.gitignore` has no extension unless it contains another later dot. Every extension mode is a no-op for directories.

```ts
{ id: 'ext', enabled: true, type: 'extension_handling', mode: 'replace', replacement: 'md' }
```

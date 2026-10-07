# Planning and platform behavior

[Documentation home](../README.md) · [API](api.md) · [Integration](guide.md)

## Planning phases

1. Sort a copy of the items using the chosen mode, fixed `en` collation, and code point tie-breaks.
2. Adjust ordering so included ancestor directories precede descendants.
3. Apply enabled rules in that final order, assigning global indices and one shared current timestamp. Validate proposed names and retain per-row rule failures.
4. Index source keys, retain duplicate inputs, and compute each target using renamed ancestor directories. Missing intermediate directory rows preserve their own names.
5. Allocate unique row ids, check destination collisions and optional external occupancy, then determine statuses and summary counts.

This is synchronous in-memory planning. Determinism means ordering/numbering does not depend on input order or the host's default locale for distinguishable items. Date/time rules depend on time and local timezone; filesystem callbacks depend on caller state. Indistinguishable duplicate objects can compare equal and retain input order. Fixed locale is not a guarantee across all future ICU/runtime versions.

The base comparator does not encode ancestry. Consumers sorting via `array.sort(compareItemsBySortMode)` do not receive the planner's parent-before-child guarantee; use `sortItemsByMode` instead.

## Filesystem syntax versus comparison keys

Two different operations are involved:

- Internal filesystem-path normalization uses target `path.win32` or `path.posix`, resolves redundant separators and `.`/`..` segments, and removes trailing separators except roots.
- Public `normalizePathKey` only adjusts Unicode/case matching. It does not canonicalize filesystem syntax, resolve symlinks, or query a volume.

| Target | Path implementation | Key case behavior | Key Unicode behavior | Final basename length |
| --- | --- | --- | --- | --- |
| `linux` | `path.posix` | Exact | Exact code points | 255 UTF-8 bytes |
| `darwin` | `path.posix` | Lowercase | NFC | 255 UTF-8 bytes |
| `win32` | `path.win32` | Lowercase | Exact code points | 255 UTF-16 units |

The engine models `darwin`/`win32` as case-insensitive irrespective of actual volume settings. It does not support an option for case-sensitive APFS/NTFS or case-insensitive Linux volumes. Comparison normalization does not rewrite the proposed name's case or Unicode spelling.

On `darwin`, `/d/A.txt` and `/d/a.txt` share a source key, as do NFC and NFD spellings of `é.txt`. On `linux`, both case and Unicode spellings remain distinct. On `win32`, case variants share a key but canonical Unicode variants remain distinct.

`changed` compares the normalized source path with the final target using exact string equality, not path-key equality. Case-only and normalization-only spelling changes can therefore be changed rows even when both paths share a key. `sourcePath` and `directoryPath` in the result retain original caller spelling; `nextPath` is normalized. A redundant-separator input such as `/d//a.txt` does not count as changed if its target is `/d/a.txt`.

## Ancestor target propagation

Given a directory `/p/old` renamed to `/p/new`, descendants resolve under `/p/new` even if they are not directly beneath an included directory row. For example, a supplied file `/p/old/middle/file.txt` resolves under `/p/new/middle` even when `middle` is not itself in the batch.

A child's rules still use the original parent name/path context. `{parent}` and custom `parent` are not recomputed from the final directory target. Name calculation and target propagation are separate.

If an ancestor is invalid or conflicts, the batch is blocked. The planner still computes descendant targets from that ancestor's proposed name; a child is not automatically assigned the ancestor's invalid/conflict status. Inspect the entire summary before execution.

## Status precedence and blocking

| Status | Meaning |
| --- | --- |
| `invalid` | Rule execution failed or the proposed basename violates validation |
| `conflict` | Duplicate source, colliding target, or occupied external target, without an invalid status taking precedence |
| `ok` | Path changes and neither invalid nor conflict applies |
| `unchanged` | Path does not change and neither invalid nor conflict applies |

Priority is `invalid` > `conflict` > changed/`ok` > `unchanged`. Invalid rows skip later destination and occupancy checks, although they can still receive a duplicate-source reason. Their proposed targets remain in the destination index, so valid rows may conflict with them.

`summary.blocked` is true if any row is invalid or conflict. `summary.changed` counts changed flags across all statuses, including blocked rows. An unchanged item can be invalid or conflict, and a changed item is not necessarily ok. An empty batch or a fully unchanged valid batch is unblocked.

`reasons` is not a boolean error signal. Unchanged rows commonly have no reasons; ok rows may carry a case-only staging advisory. Use `status` and `summary.blocked` for control flow.

## Conflict detection

### Duplicate sources

Every item is retained. Items sharing a normalized source key receive `Another item in the batch has the same source path.` and conflict status unless invalid takes priority.

The first row for that key gets the plain key as `id`. Later rows get the lowest free suffix beginning at `#2`, skipping real source keys and already allocated ids. For sources `/d/a`, `/d/a`, `/d/a#2`, the duplicate skips `/d/a#2` and uses `/d/a#3`. These suffixes identify rows; they do not change source or target paths.

### Duplicate targets

Two or more distinct source keys resolving to one final target key conflict. This includes a changed item targeting an unchanged item's path. Target matching uses platform case/Unicode policy. Duplicate rows from the same source key are handled by the duplicate-source rule, not counted as distinct destination owners.

### Existing targets outside the batch

If `existingPathExists(nextPath)` returns true for a changed, noninvalid row and that target key is not a source key in the batch, the row conflicts. Without the callback the planner cannot detect external occupancy.

The callback is cached per target key for one call. It is not called for unchanged or invalid rows, and is not used to verify source existence. A callback exception propagates.

Existing paths that match batch source keys are not external conflicts. Swaps and chains can thus be allowed, but direct sequential execution could overwrite data or fail; staging is the caller's responsibility.

## Name validation

Selected filesystem roots (`/`, a Windows drive root, or a UNC share root) are rejected before rule application with `A filesystem root cannot be renamed.` Their target remains the normalized source path, and their selected children are still planned normally. Rules and normal basename validation are skipped for root rows.

For other items, validation runs even with no enabled rules. It operates on the proposed basename, not the full target path.

On all targets, names are invalid when:

- Empty or whitespace-only under JavaScript `trim()`.
- Containing `/`.
- Containing any control character U+0000 through U+001F.
- Exactly `.` or `..`.
- Exceeding the target basename length limit.

Additionally, if rules empty a previously nonempty file stem while an extension remains (`abc.txt` → `.txt`), the row is invalid. Existing dotfiles such as `.txt` are not automatically invalid: they split as a stem with no extension. Backslash is allowed as a literal POSIX name character but rejected on Windows.

On `win32`, also reject:

- `< > : " \ | ? *`.
- An ASCII space or period at the end of the name.
- Reserved device names, case-insensitively, for files and directories. Matching uses the part before the first dot after removing trailing ASCII spaces: `CON.tar.gz` and `nul .txt` are reserved.

The reserved set is `CON`, `PRN`, `AUX`, `NUL`, `CONIN$`, `CONOUT$`, `COM0`–`COM9`, `LPT0`–`LPT9`, and COM/LPT followed by one superscript digit `¹`, `²`, or `³` (for example `COM¹`, `LPT³`). `COM¹²³` is not a single reserved entry in this implementation.

POSIX length uses UTF-8 byte count; Windows uses JavaScript `.length` (UTF-16 code units). Emoji and combining marks therefore consume different budgets. The engine does not check filesystem-specific exceptions, total path length, permissions, symlinks, or mount/device constraints.

## Diagnostics

Diagnostics are human-readable strings, not exported error codes. Prefer status-based program logic and display the reasons; regex-engine error details may vary with the runtime.

| Reason | Trigger |
| --- | --- |
| `A filesystem root cannot be renamed.` | Selected filesystem root; target remains its normalized original path |
| `Name is empty.` | Empty or whitespace-only basename |
| `Name is empty; only the extension would remain.` | Previously nonempty file stem removed while extension remains |
| `Name contains unsupported path characters.` | Forward slash in name |
| `Name contains control characters.` | U+0000–U+001F |
| `Name contains Windows-reserved characters.` | Windows reserved character |
| `Windows names cannot end with a space or period.` | Windows trailing ASCII space/dot |
| `Name is reserved on Windows.` | Windows device-name match |
| `Name is longer than 255 characters.` | Windows UTF-16 limit exceeded |
| `Name is longer than 255 bytes.` | POSIX UTF-8 limit exceeded |
| `Dot-only names are not allowed.` | Exactly `.` or `..` |
| `Another item in the batch has the same source path.` | Duplicate source key |
| `Another item in the batch resolves to the same final path.` | Distinct source keys share destination key |
| `Target path already exists outside the current batch.` | Positive callback result without batch source owner |
| `Case-only rename will be staged safely during execution.` | Changed unconflicted noninvalid row on a case-insensitive platform whose original/proposed name keys match |
| `Rule "<label-or-type>" failed: <detail>` | Generic rule failure; label trimmed and used if nonempty |
| `Custom rule failed: <detail>` | Custom expression failure (does not use rule label) |
| `Rename rules failed: <detail>` | Unexpected failure caught around rule processing |

The case-only advisory is emitted by the engine, but staging itself is not implemented here. Because its condition uses normalized name keys, it can also appear for Unicode-equivalent spellings on darwin or a parent-only move with an unchanged basename. It is advice, not an execution guarantee.

Common detail messages include `Sequence start and step must be finite numbers.`, `Sequence value for item <n> is outside the supported range of ±9007199254740991.`, `Pad width must be a number no greater than 255.`, and `Regular expression is longer than 1000 characters.` Custom diagnostics include unknown values/helpers, parser character positions, wrong types/arity, `Custom rule expressions must return text.`, and `Text is longer than 4096 characters.`

## Migrating to v0.2.0

Node.js 22 or newer is required; Node.js 20 is no longer supported. Published declarations do not require Node type definitions solely to import this package.

There are no new status values, but stricter validation and corrected ordering can change results:

- Use `sortItemsByMode` for hierarchy-aware sorting; `compareItemsBySortMode` now defines only a total-order base comparator.
- Sequence numbers follow the corrected final ancestor-first order, which may change targets from older previews.
- Child targets now consistently use their parent's computed target.
- Do not assume one row per source key. Duplicate sources are retained and conflict; ids may have `#n` suffixes.
- Darwin keys now use NFC and locale-independent lowercasing. Linux/Windows preserve Unicode spelling differences; Windows still lowercases keys.
- Bad regex/padding/custom configurations become invalid rows in `generatePreview`; direct `applyRulesToName` still throws.
- Selected filesystem roots are invalid without recursive target resolution; selected children are still planned normally.
- Numeric and letter sequence rules reject nonfinite computed values and magnitudes above `Number.MAX_SAFE_INTEGER`, even when start/step themselves are finite.
- New caps bound numeric padding, regex pattern length, custom helper text outputs, and the internal expression cache.
- Windows reserved-name and control/length checks are stricter. POSIX length is checked in UTF-8 bytes.
- Literal case-insensitive replacement preserves correct offsets, and replacement `$` tokens remain literal in built-in literal `find_replace`.
- Negative numeric sequence padding puts the minus sign outside zero padding.
- Source syntax normalization avoids false changes from redundant separators.
- Emptying a file stem while keeping only its extension is now invalid.
- Target platform selects path syntax independently of host OS.

New root exports are `MAX_NAME_LENGTH`, `MAX_PAD_WIDTH`, `MAX_REGEX_PATTERN_LENGTH`, `MAX_CUSTOM_RULE_TEXT_LENGTH`, and `compareCodePoints`; `SortItemsOptions` is a new type export. `sortItemsByMode` accepts optional `{ platform }`, and `ApplyRulesContext` accepts optional `platform`. The internal evaluator's path option is not a supported package API.

Regenerate and review stored previews before executing under v0.2.0. Update dependent package ranges to `^0.2.0` after it is published. No execution or undo API is added by this release.

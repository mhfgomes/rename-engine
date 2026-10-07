# Custom expression language

[Documentation home](../README.md) · [Rule reference](rules.md#custom_rule--customrule) · [API](api.md)

A `custom_rule` evaluates a small expression language and returns a complete name. It is parsed by this package, without evaluating arbitrary JavaScript. Access is limited to the identifiers and helper calls below; no filesystem operations are performed by the helpers.

```ts
{
  id: 'custom', enabled: true, type: 'custom_rule',
  expression: 'snake(originalStem) + "_" + pad(index, 3) + ext(lower(extension))',
}
```

For `My File.TXT` at the first row, this produces `my_file_001.txt`. The expression must return a string. `len(currentStem)` alone fails because it returns a number; `concat(len(currentStem))` converts it to text.

The evaluator is not exposed through a supported package entry. Use `applyRulesToName` or `generatePreview` with this rule type.

## Context identifiers

Identifiers and helper names are case-sensitive.

| Identifier | Type | Value |
| --- | --- | --- |
| `currentName` | string | Whole name after previous enabled rules |
| `currentStem` | string | Current stem |
| `extension` | string | Current extension without leading dot; empty for directories |
| `originalName` | string | Whole initial input name |
| `originalStem` | string | Initial stem |
| `originalExtension` | string | Initial extension without leading dot |
| `parent` | string | Basename of original parent path (not its full path or renamed name) |
| `sourcePath` | string | Input source path; in direct transforms, defaults to parent joined with original name |
| `isDirectory` | boolean | Input item kind |
| `index` | number | One-based final batch index |
| `zeroIndex` | number | Zero-based final batch index |
| `total` | number | Total batch item count |

These indices differ from `ApplyRulesContext.index`, which is zero-based. Sequence context is global and includes invalid/unchanged rows and directories.

## Literals and syntax

- Single- or double-quoted string literals, decimal numbers starting with a digit, `true`, `false`, and `null`.
- Parentheses and comma-separated helper arguments; zero arguments are allowed syntactically.
- Whitespace is ignored outside strings.
- Strings support escapes for newline (`\n`), carriage return (`\r`), tab (`\t`), backslash (`\\`), and either quote. Other escape sequences discard the backslash and keep the next character; `\uXXXX` is not a Unicode escape in this language.
- Numbers use decimal syntax such as `12`, `12.5`, or `0.5`; a leading minus is an operator. No exponent notation, hex literals, or leading-dot decimals.
- No comments, statements, assignment, loops, arrays, objects, member access, template literals, regex literals, user functions, or access to JavaScript globals.

### Operators, highest precedence first

| Precedence | Operators | Behavior |
| --- | --- | --- |
| 1 | Unary `!`, unary `-` | Truthiness negation; numeric negation |
| 2 | `*`, `/`, `%` | Numeric operands only |
| 3 | `+`, `-` | `+` adds two numbers, otherwise concatenates primitive text; `-` requires numbers |
| 4 | `<`, `<=`, `>`, `>=` | Numeric if both are numbers; otherwise compare converted strings |
| 5 | `==`, `!=` | Strict equality/inequality; no coercion |
| 6 | `&&` | Short-circuits; returns an operand |
| 7 | `\|\|` | Short-circuits; returns an operand |
| 8 | `condition ? yes : no` | Evaluates only the chosen branch |

Arithmetic follows JavaScript numbers, including precision limitations and division by zero. Numeric helpers reject NaN where they require numbers but are not a general finite-number policy. Truthiness follows JavaScript primitives: empty text, zero, false, and null are false. Text conversion maps null to empty text and numbers/booleans through `String(...)`.

`when(condition, yes, no)` is an ordinary helper: all arguments are evaluated before the helper chooses a result. Use the ternary operator when the unused branch might fail or is expensive.

```text
isDirectory ? upper(currentName) : lower(currentStem) + ext(extension)
index > 1 && includes(currentStem, "draft") ? "batch_" + currentName : currentName
```

## Helpers

Arguments are type-checked as shown. Except `concat` and the text/value parameters of `pad`, helpers do not implicitly convert numeric/boolean arguments to strings. Most wrong types/arity errors name the helper argument involved.

### Text and case

| Helper | Result and semantics |
| --- | --- |
| `concat(...values)` | Concatenates any number of primitive values; null becomes empty, zero args returns empty |
| `lower(text)` | Lowercase string |
| `upper(text)` | Uppercase string |
| `trim(text)` | Strip surrounding whitespace |
| `trimStart(text)` | Strip leading whitespace |
| `trimEnd(text)` | Strip trailing whitespace |
| `title(text)` | Lowercase segments split on whitespace/underscore/dash, capitalize each, join spaces |
| `sentence(text)` | Lowercase text, uppercase first character |
| `camel(text)` | Lower camel case |
| `pascal(text)` | Upper camel case |
| `kebab(text)` | Lowercase dash-separated words |
| `snake(text)` | Lowercase underscore-separated words |

Case helpers share the [rule case-transform algorithms](rules.md#case_transform--casetransformrule); they do not guarantee linguistic title casing or Unicode word segmentation.

### Replacement and slicing

| Helper | Result and semantics |
| --- | --- |
| `replace(text, search, replacement)` | First literal match, case-sensitive |
| `replaceAll(text, search, replacement)` | All literal matches, case-sensitive |
| `regexReplace(text, pattern, replacement, flags?)` | JavaScript regex replacement; flags default to empty (first match), use `g` for all |
| `pad(value, width, fill?)` | Left-pad converted primitive text to width; fill defaults to `'0'` |
| `slice(text, start, end?)` | JavaScript string slicing, end-exclusive, supports negative indices |
| `len(text)` | UTF-16 code unit length, not bytes or graphemes |

All replacement arguments are strings. Unlike literal `find_replace` rules, the custom `replace`/`replaceAll` helpers use JavaScript replacement-string expansion: `$&`, `$1` where applicable, and other replacement tokens are interpreted by the underlying method. Regex source is a string without `/.../` delimiters, and flags are passed directly to `RegExp`; malformed syntax/flags fail.

`pad` width must be an integer from 0 through 255, and fill cannot be empty. Width is a minimum, not truncation. Padding is ordinary text padding: `pad(-1, 3)` returns `0-1`, while a numeric sequence rule pads the absolute value and returns `-001` at width 3.

### Conditions

| Helper | Result and semantics |
| --- | --- |
| `startsWith(text, search)` | Case-sensitive prefix test |
| `endsWith(text, search)` | Case-sensitive suffix test |
| `includes(text, search)` | Case-sensitive containment test |
| `matchCase(text, search, caseSensitive)` | Containment; the third argument must be boolean; false lowercases both strings |
| `equals(left, right)` | Strict equality of primitives |
| `bool(value)` | Primitive truthiness |
| `not(value)` | Negated truthiness |
| `when(condition, yes, no)` | Select an argument by truthiness; arguments evaluate eagerly |

### Paths and extensions

| Helper | Result and semantics |
| --- | --- |
| `ext(text)` | Trim whitespace, return empty if empty, otherwise ensure one leading dot (existing leading dot retained) |
| `basename(path)` | Target-platform basename |
| `dirname(path)` | Target-platform directory path |

In a preview, path helpers use `path.win32` for `win32`, `path.posix` otherwise. In `applyRulesToName`, set `context.platform` for the same behavior; if omitted, they use the host path implementation. `ext` does not remove multiple dots or validate extension characters.

## Escaping a regex expression inside TypeScript

There are two string parsers: the host TypeScript/JavaScript parser and the custom language parser. A backslash needed by the regex must survive both. For example:

```ts
const rule = {
  id: 'digits', enabled: true, type: 'custom_rule' as const,
  expression: 'regexReplace(currentStem, "\\\\d+", "#", "g") + ext(extension)',
};
// file12.txt -> file#.txt
```

The host string contains two backslashes inside the custom quoted pattern; the language parser turns them into one for `RegExp`. JSON storage also requires normal JSON escaping. Avoid copying JavaScript regex-literal syntax into a custom expression.

## Recipes

Each expression below returns a complete name:

| Goal | Expression |
| --- | --- |
| Preserve extension while changing case | `lower(currentStem) + ext(extension)` |
| Use original name after earlier rules | `originalName` |
| Prefix with original parent basename | `parent + "_" + currentName` |
| Reverse numeric numbering | `pad(total - zeroIndex, 3) + "_" + currentName` |
| Transform only directories | `isDirectory ? upper(currentName) : currentName` |
| Transform only files | `isDirectory ? currentName : snake(currentStem) + ext(extension)` |
| Strip a known prefix | `startsWith(currentStem, "draft_") ? slice(currentStem, 6) + ext(extension) : currentName` |
| Change TXT extension only | `currentStem + ext(lower(extension) == "txt" ? "md" : extension)` |

## Errors and resource limits

Unknown identifiers/helpers, malformed expressions, wrong argument counts/types, invalid regexes, oversized helper results, and a nonstring final result fail the rule. `generatePreview` reports `Custom rule failed: <detail>` as an invalid row; `applyRulesToName` throws.

Prototype names such as `constructor`, `toString`, and `__proto__` do not resolve as values/helpers. Compiled successful expressions are cached by exact source string in a 100-entry LRU shared within the module instance. Results are never cached, and callers cannot inspect or manage the cache through the public API.

Regex patterns are capped at 1000 UTF-16 units. Each helper string result and each concatenated string is checked against 4096 UTF-16 units. In v0.2.0, bare string literals/context identifiers are not themselves checked by that text-limit hook; do not treat it as an unconditional limit on all expression values or final names. Preview final-name validation is separate and stricter.

There is no global expression-source size, recursion depth, or runtime limit. Helper checks occur after constructing their outputs, so they are not a complete memory allocation bound. Run untrusted rules in a [terminable worker](guide.md#running-untrusted-rules-in-a-worker).

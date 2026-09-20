import path from 'node:path';

interface CustomRuleContext {
  currentName: string;
  currentStem: string;
  extension: string;
  originalName: string;
  originalStem: string;
  originalExtension: string;
  parent: string;
  sourcePath: string;
  isDirectory: boolean;
  index: number;
  zeroIndex: number;
  total: number;
}

type ExpressionValue = string | number | boolean | null;

type ExpressionNode =
  | { type: 'literal'; value: ExpressionValue }
  | { type: 'identifier'; name: string }
  | { type: 'call'; callee: string; args: ExpressionNode[] }
  | { type: 'unary'; operator: '!' | '-'; argument: ExpressionNode }
  | {
      type: 'binary';
      operator: '+' | '-' | '*' | '/' | '%' | '==' | '!=' | '<' | '<=' | '>' | '>=' | '&&' | '||';
      left: ExpressionNode;
      right: ExpressionNode;
    }
  | { type: 'conditional'; test: ExpressionNode; consequent: ExpressionNode; alternate: ExpressionNode };

interface Token {
  type: 'identifier' | 'number' | 'string' | 'operator' | 'punctuation' | 'eof';
  value: string;
  index: number;
}

const compiledExpressionCache = new Map<string, ExpressionNode>();

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split(/[\s_-]+/g)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function words(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s._-]+/g)
    .filter(Boolean);
}

function sentenceCase(value: string) {
  const lower = value.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function camelCase(value: string) {
  const segments = words(value).map((segment) => segment.toLowerCase());
  return segments
    .map((segment, index) =>
      index === 0 ? segment : segment.charAt(0).toUpperCase() + segment.slice(1),
    )
    .join('');
}

function pascalCase(value: string) {
  return words(value)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join('');
}

function kebabCase(value: string) {
  return words(value)
    .map((segment) => segment.toLowerCase())
    .join('-');
}

function snakeCase(value: string) {
  return words(value)
    .map((segment) => segment.toLowerCase())
    .join('_');
}

function assertArity(name: string, args: unknown[], min: number, max = min) {
  if (args.length < min || args.length > max) {
    if (min === max) {
      throw new Error(`${name} expects ${min} argument${min === 1 ? '' : 's'}.`);
    }
    throw new Error(`${name} expects between ${min} and ${max} arguments.`);
  }
}

function asString(value: unknown, name: string) {
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string.`);
  }
  return value;
}

function asNumber(value: unknown, name: string) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`${name} must be a number.`);
  }
  return value;
}

function asBoolean(value: unknown, name: string) {
  if (typeof value !== 'boolean') {
    throw new Error(`${name} must be true or false.`);
  }
  return value;
}

function toStringValue(value: unknown) {
  if (value === null) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  throw new Error('Value cannot be converted to text.');
}

function isTruthy(value: unknown) {
  return Boolean(value);
}

const helpers: Record<string, (...args: ExpressionValue[]) => ExpressionValue> = {
  concat: (...args) => args.map((value) => toStringValue(value)).join(''),
  lower: (...args) => {
    assertArity('lower', args, 1);
    return asString(args[0], 'lower(value)').toLowerCase();
  },
  upper: (...args) => {
    assertArity('upper', args, 1);
    return asString(args[0], 'upper(value)').toUpperCase();
  },
  trim: (...args) => {
    assertArity('trim', args, 1);
    return asString(args[0], 'trim(value)').trim();
  },
  trimStart: (...args) => {
    assertArity('trimStart', args, 1);
    return asString(args[0], 'trimStart(value)').trimStart();
  },
  trimEnd: (...args) => {
    assertArity('trimEnd', args, 1);
    return asString(args[0], 'trimEnd(value)').trimEnd();
  },
  title: (...args) => {
    assertArity('title', args, 1);
    return titleCase(asString(args[0], 'title(value)'));
  },
  sentence: (...args) => {
    assertArity('sentence', args, 1);
    return sentenceCase(asString(args[0], 'sentence(value)'));
  },
  camel: (...args) => {
    assertArity('camel', args, 1);
    return camelCase(asString(args[0], 'camel(value)'));
  },
  pascal: (...args) => {
    assertArity('pascal', args, 1);
    return pascalCase(asString(args[0], 'pascal(value)'));
  },
  kebab: (...args) => {
    assertArity('kebab', args, 1);
    return kebabCase(asString(args[0], 'kebab(value)'));
  },
  snake: (...args) => {
    assertArity('snake', args, 1);
    return snakeCase(asString(args[0], 'snake(value)'));
  },
  replace: (...args) => {
    assertArity('replace', args, 3);
    return asString(args[0], 'replace(text)').replace(
      asString(args[1], 'replace(search)'),
      asString(args[2], 'replace(replacement)'),
    );
  },
  replaceAll: (...args) => {
    assertArity('replaceAll', args, 3);
    return asString(args[0], 'replaceAll(text)').replaceAll(
      asString(args[1], 'replaceAll(search)'),
      asString(args[2], 'replaceAll(replacement)'),
    );
  },
  regexReplace: (...args) => {
    assertArity('regexReplace', args, 3, 4);
    const value = asString(args[0], 'regexReplace(text)');
    const pattern = asString(args[1], 'regexReplace(pattern)');
    const replacement = asString(args[2], 'regexReplace(replacement)');
    const flags = args[3] === undefined ? '' : asString(args[3], 'regexReplace(flags)');

    let expression: RegExp;
    try {
      expression = new RegExp(pattern, flags);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid regular expression.';
      throw new Error(`regexReplace failed: ${message}`);
    }

    return value.replace(expression, replacement);
  },
  pad: (...args) => {
    assertArity('pad', args, 2, 3);
    const value = toStringValue(args[0]);
    const width = asNumber(args[1], 'pad(width)');
    const fill = args[2] === undefined ? '0' : asString(args[2], 'pad(fill)');

    if (!Number.isInteger(width) || width < 0) {
      throw new Error('pad(width) must be a non-negative integer.');
    }

    if (fill.length === 0) {
      throw new Error('pad(fill) cannot be empty.');
    }

    return value.padStart(width, fill);
  },
  slice: (...args) => {
    assertArity('slice', args, 2, 3);
    const value = asString(args[0], 'slice(value)');
    const start = asNumber(args[1], 'slice(start)');
    const end = args[2] === undefined ? undefined : asNumber(args[2], 'slice(end)');
    return value.slice(start, end);
  },
  startsWith: (...args) => {
    assertArity('startsWith', args, 2);
    return asString(args[0], 'startsWith(value)').startsWith(asString(args[1], 'startsWith(search)'));
  },
  endsWith: (...args) => {
    assertArity('endsWith', args, 2);
    return asString(args[0], 'endsWith(value)').endsWith(asString(args[1], 'endsWith(search)'));
  },
  includes: (...args) => {
    assertArity('includes', args, 2);
    return asString(args[0], 'includes(value)').includes(asString(args[1], 'includes(search)'));
  },
  ext: (...args) => {
    assertArity('ext', args, 1);
    const value = asString(args[0], 'ext(value)').trim();
    if (!value) {
      return '';
    }
    return value.startsWith('.') ? value : `.${value}`;
  },
  basename: (...args) => {
    assertArity('basename', args, 1);
    return path.basename(asString(args[0], 'basename(value)'));
  },
  dirname: (...args) => {
    assertArity('dirname', args, 1);
    return path.dirname(asString(args[0], 'dirname(value)'));
  },
  len: (...args) => {
    assertArity('len', args, 1);
    return asString(args[0], 'len(value)').length;
  },
  bool: (...args) => {
    assertArity('bool', args, 1);
    return isTruthy(args[0]);
  },
  not: (...args) => {
    assertArity('not', args, 1);
    return !isTruthy(args[0]);
  },
  when: (...args) => {
    assertArity('when', args, 3);
    return isTruthy(args[0]) ? args[1] : args[2];
  },
  equals: (...args) => {
    assertArity('equals', args, 2);
    return args[0] === args[1];
  },
  matchCase: (...args) => {
    assertArity('matchCase', args, 3);
    return asBoolean(args[2], 'matchCase(caseSensitive)')
      ? asString(args[0], 'matchCase(value)').includes(asString(args[1], 'matchCase(search)'))
      : asString(args[0], 'matchCase(value)').toLowerCase().includes(asString(args[1], 'matchCase(search)').toLowerCase());
  },
};

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  const pushToken = (type: Token['type'], value: string, start: number) => {
    tokens.push({ type, value, index: start });
  };

  while (index < expression.length) {
    const char = expression[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    const start = index;
    const twoCharacterOperator = expression.slice(index, index + 2);
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(twoCharacterOperator)) {
      pushToken('operator', twoCharacterOperator, start);
      index += 2;
      continue;
    }

    if ('+-*/%<>!?:(),'.includes(char)) {
      pushToken(char === '(' || char === ')' || char === ',' || char === '?' || char === ':' ? 'punctuation' : 'operator', char, start);
      index += 1;
      continue;
    }

    if (char === '\'' || char === '"') {
      const quote = char;
      index += 1;
      let value = '';
      let closed = false;

      while (index < expression.length) {
        const current = expression[index];
        if (current === '\\') {
          const next = expression[index + 1];
          if (next === undefined) {
            throw new Error(`Unterminated string at character ${start + 1}.`);
          }

          switch (next) {
            case 'n':
              value += '\n';
              break;
            case 'r':
              value += '\r';
              break;
            case 't':
              value += '\t';
              break;
            case '\\':
              value += '\\';
              break;
            case '\'':
              value += '\'';
              break;
            case '"':
              value += '"';
              break;
            default:
              value += next;
              break;
          }
          index += 2;
          continue;
        }

        if (current === quote) {
          index += 1;
          pushToken('string', value, start);
          closed = true;
          break;
        }

        value += current;
        index += 1;
      }

      if (!closed) {
        throw new Error(`Unterminated string at character ${start + 1}.`);
      }
      continue;
    }

    if (/\d/.test(char)) {
      index += 1;
      while (index < expression.length && /[\d.]/.test(expression[index])) {
        index += 1;
      }
      pushToken('number', expression.slice(start, index), start);
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      index += 1;
      while (index < expression.length && /[A-Za-z0-9_]/.test(expression[index])) {
        index += 1;
      }
      pushToken('identifier', expression.slice(start, index), start);
      continue;
    }

    throw new Error(`Unexpected character "${char}" at character ${start + 1}.`);
  }

  tokens.push({ type: 'eof', value: '', index: expression.length });
  return tokens;
}

class Parser {
  private readonly tokens: Token[];
  private position = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse() {
    const expression = this.parseConditional();
    this.expect('eof');
    return expression;
  }

  private parseConditional(): ExpressionNode {
    const test = this.parseLogicalOr();
    if (this.match('punctuation', '?')) {
      const consequent = this.parseConditional();
      this.expect('punctuation', ':');
      const alternate = this.parseConditional();
      return { type: 'conditional', test, consequent, alternate };
    }
    return test;
  }

  private parseLogicalOr(): ExpressionNode {
    let expression = this.parseLogicalAnd();
    while (this.match('operator', '||')) {
      expression = {
        type: 'binary',
        operator: '||',
        left: expression,
        right: this.parseLogicalAnd(),
      };
    }
    return expression;
  }

  private parseLogicalAnd(): ExpressionNode {
    let expression = this.parseEquality();
    while (this.match('operator', '&&')) {
      expression = {
        type: 'binary',
        operator: '&&',
        left: expression,
        right: this.parseEquality(),
      };
    }
    return expression;
  }

  private parseEquality(): ExpressionNode {
    let expression = this.parseComparison();
    while (true) {
      if (this.match('operator', '==')) {
        expression = {
          type: 'binary',
          operator: '==',
          left: expression,
          right: this.parseComparison(),
        };
        continue;
      }
      if (this.match('operator', '!=')) {
        expression = {
          type: 'binary',
          operator: '!=',
          left: expression,
          right: this.parseComparison(),
        };
        continue;
      }
      return expression;
    }
  }

  private parseComparison(): ExpressionNode {
    let expression = this.parseTerm();
    while (true) {
      if (this.match('operator', '<')) {
        expression = { type: 'binary', operator: '<', left: expression, right: this.parseTerm() };
        continue;
      }
      if (this.match('operator', '<=')) {
        expression = { type: 'binary', operator: '<=', left: expression, right: this.parseTerm() };
        continue;
      }
      if (this.match('operator', '>')) {
        expression = { type: 'binary', operator: '>', left: expression, right: this.parseTerm() };
        continue;
      }
      if (this.match('operator', '>=')) {
        expression = { type: 'binary', operator: '>=', left: expression, right: this.parseTerm() };
        continue;
      }
      return expression;
    }
  }

  private parseTerm(): ExpressionNode {
    let expression = this.parseFactor();
    while (true) {
      if (this.match('operator', '+')) {
        expression = { type: 'binary', operator: '+', left: expression, right: this.parseFactor() };
        continue;
      }
      if (this.match('operator', '-')) {
        expression = { type: 'binary', operator: '-', left: expression, right: this.parseFactor() };
        continue;
      }
      return expression;
    }
  }

  private parseFactor(): ExpressionNode {
    let expression = this.parseUnary();
    while (true) {
      if (this.match('operator', '*')) {
        expression = { type: 'binary', operator: '*', left: expression, right: this.parseUnary() };
        continue;
      }
      if (this.match('operator', '/')) {
        expression = { type: 'binary', operator: '/', left: expression, right: this.parseUnary() };
        continue;
      }
      if (this.match('operator', '%')) {
        expression = { type: 'binary', operator: '%', left: expression, right: this.parseUnary() };
        continue;
      }
      return expression;
    }
  }

  private parseUnary(): ExpressionNode {
    if (this.match('operator', '!')) {
      return { type: 'unary', operator: '!', argument: this.parseUnary() };
    }
    if (this.match('operator', '-')) {
      return { type: 'unary', operator: '-', argument: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ExpressionNode {
    const token = this.peek();

    if (token.type === 'number') {
      this.position += 1;
      const value = Number(token.value);
      if (Number.isNaN(value)) {
        throw new Error(`Invalid number "${token.value}" at character ${token.index + 1}.`);
      }
      return { type: 'literal', value };
    }

    if (token.type === 'string') {
      this.position += 1;
      return { type: 'literal', value: token.value };
    }

    if (token.type === 'identifier') {
      this.position += 1;
      if (token.value === 'true' || token.value === 'false') {
        return { type: 'literal', value: token.value === 'true' };
      }
      if (token.value === 'null') {
        return { type: 'literal', value: null };
      }

      if (this.match('punctuation', '(')) {
        const args: ExpressionNode[] = [];
        if (!this.match('punctuation', ')')) {
          do {
            args.push(this.parseConditional());
          } while (this.match('punctuation', ','));
          this.expect('punctuation', ')');
        }
        return { type: 'call', callee: token.value, args };
      }

      return { type: 'identifier', name: token.value };
    }

    if (this.match('punctuation', '(')) {
      const expression = this.parseConditional();
      this.expect('punctuation', ')');
      return expression;
    }

    throw new Error(`Unexpected token "${token.value || 'end of expression'}" at character ${token.index + 1}.`);
  }

  private match(type: Token['type'], value?: string) {
    const token = this.peek();
    if (token.type !== type) {
      return false;
    }
    if (value !== undefined && token.value !== value) {
      return false;
    }
    this.position += 1;
    return true;
  }

  private expect(type: Token['type'], value?: string) {
    const token = this.peek();
    if (this.match(type, value)) {
      return;
    }
    const expected = value ?? type;
    throw new Error(`Expected ${expected} at character ${token.index + 1}.`);
  }

  private peek() {
    return this.tokens[this.position];
  }
}

function compareValues(left: ExpressionValue, right: ExpressionValue, operator: '<' | '<=' | '>' | '>=') {
  if (typeof left === 'number' && typeof right === 'number') {
    switch (operator) {
      case '<':
        return left < right;
      case '<=':
        return left <= right;
      case '>':
        return left > right;
      case '>=':
        return left >= right;
    }
  }

  const leftValue = toStringValue(left);
  const rightValue = toStringValue(right);
  switch (operator) {
    case '<':
      return leftValue < rightValue;
    case '<=':
      return leftValue <= rightValue;
    case '>':
      return leftValue > rightValue;
    case '>=':
      return leftValue >= rightValue;
  }
}

function evaluate(node: ExpressionNode, context: CustomRuleContext): ExpressionValue {
  switch (node.type) {
    case 'literal':
      return node.value;
    case 'identifier': {
      if (node.name in context) {
        return context[node.name as keyof CustomRuleContext];
      }
      throw new Error(`Unknown value "${node.name}".`);
    }
    case 'call': {
      const helper = helpers[node.callee];
      if (!helper) {
        throw new Error(`Unknown helper "${node.callee}".`);
      }
      const args = node.args.map((argument) => evaluate(argument, context));
      return helper(...args);
    }
    case 'unary': {
      const value = evaluate(node.argument, context);
      if (node.operator === '!') {
        return !isTruthy(value);
      }
      return -asNumber(value, 'Unary value');
    }
    case 'binary': {
      if (node.operator === '&&') {
        const left = evaluate(node.left, context);
        return isTruthy(left) ? evaluate(node.right, context) : left;
      }
      if (node.operator === '||') {
        const left = evaluate(node.left, context);
        return isTruthy(left) ? left : evaluate(node.right, context);
      }

      const left = evaluate(node.left, context);
      const right = evaluate(node.right, context);

      switch (node.operator) {
        case '+':
          if (typeof left === 'number' && typeof right === 'number') {
            return left + right;
          }
          return toStringValue(left) + toStringValue(right);
        case '-':
          return asNumber(left, 'Left operand') - asNumber(right, 'Right operand');
        case '*':
          return asNumber(left, 'Left operand') * asNumber(right, 'Right operand');
        case '/':
          return asNumber(left, 'Left operand') / asNumber(right, 'Right operand');
        case '%':
          return asNumber(left, 'Left operand') % asNumber(right, 'Right operand');
        case '==':
          return left === right;
        case '!=':
          return left !== right;
        case '<':
        case '<=':
        case '>':
        case '>=':
          return compareValues(left, right, node.operator);
      }
    }
    case 'conditional':
      return isTruthy(evaluate(node.test, context))
        ? evaluate(node.consequent, context)
        : evaluate(node.alternate, context);
  }
}

function compileExpression(expression: string) {
  const cached = compiledExpressionCache.get(expression);
  if (cached) {
    return cached;
  }

  if (!expression.trim()) {
    throw new Error('Custom rule expression is required.');
  }

  const tokens = tokenize(expression);
  const ast = new Parser(tokens).parse();
  compiledExpressionCache.set(expression, ast);
  return ast;
}

export function evaluateCustomRuleExpression(expression: string, context: CustomRuleContext) {
  const ast = compileExpression(expression);
  const result = evaluate(ast, context);

  if (typeof result !== 'string') {
    throw new Error('Custom rule expressions must return text.');
  }

  return result;
}

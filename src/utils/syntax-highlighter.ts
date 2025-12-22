/**
 * Simple Syntax Highlighter
 * Provides basic syntax highlighting for common programming languages
 */

export type TokenType =
  | 'keyword'
  | 'string'
  | 'number'
  | 'comment'
  | 'operator'
  | 'function'
  | 'type'
  | 'variable'
  | 'punctuation'
  | 'text';

export interface Token {
  type: TokenType;
  value: string;
}

type LanguageRules = {
  keywords: Set<string>;
  types: Set<string>;
  operators: RegExp;
  lineComment: string;
  blockCommentStart: string;
  blockCommentEnd: string;
  stringDelimiters: string[];
};

const LANGUAGES: Record<string, LanguageRules> = {
  javascript: {
    keywords: new Set([
      'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
      'default', 'delete', 'do', 'else', 'export', 'extends', 'finally',
      'for', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new',
      'return', 'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var',
      'void', 'while', 'with', 'yield', 'async', 'await', 'of', 'from', 'as',
      'static', 'get', 'set', 'true', 'false', 'null', 'undefined',
    ]),
    types: new Set([
      'Array', 'Boolean', 'Date', 'Error', 'Function', 'JSON', 'Map',
      'Math', 'Number', 'Object', 'Promise', 'Proxy', 'RegExp', 'Set',
      'String', 'Symbol', 'WeakMap', 'WeakSet',
    ]),
    operators: /^(=>|\.\.\.|\?\.|&&|\|\||[+\-*/%=<>!&|^~?:]+)/,
    lineComment: '//',
    blockCommentStart: '/*',
    blockCommentEnd: '*/',
    stringDelimiters: ['"', "'", '`'],
  },
  typescript: {
    keywords: new Set([
      'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
      'default', 'delete', 'do', 'else', 'export', 'extends', 'finally',
      'for', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new',
      'return', 'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var',
      'void', 'while', 'with', 'yield', 'async', 'await', 'of', 'from', 'as',
      'static', 'get', 'set', 'true', 'false', 'null', 'undefined',
      'interface', 'type', 'enum', 'namespace', 'module', 'declare',
      'abstract', 'implements', 'private', 'protected', 'public', 'readonly',
      'override', 'satisfies', 'keyof', 'infer', 'never', 'unknown', 'any',
    ]),
    types: new Set([
      'Array', 'Boolean', 'Date', 'Error', 'Function', 'JSON', 'Map',
      'Math', 'Number', 'Object', 'Promise', 'Proxy', 'RegExp', 'Set',
      'String', 'Symbol', 'WeakMap', 'WeakSet', 'Partial', 'Required',
      'Readonly', 'Record', 'Pick', 'Omit', 'Exclude', 'Extract',
      'NonNullable', 'Parameters', 'ReturnType', 'InstanceType',
    ]),
    operators: /^(=>|\.\.\.|\?\.|&&|\|\||[+\-*/%=<>!&|^~?:]+)/,
    lineComment: '//',
    blockCommentStart: '/*',
    blockCommentEnd: '*/',
    stringDelimiters: ['"', "'", '`'],
  },
  python: {
    keywords: new Set([
      'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await',
      'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
      'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is',
      'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try',
      'while', 'with', 'yield', 'self', 'cls',
    ]),
    types: new Set([
      'int', 'float', 'str', 'bool', 'list', 'dict', 'set', 'tuple',
      'bytes', 'bytearray', 'complex', 'frozenset', 'range', 'type',
    ]),
    operators: /^(->|:=|[+\-*/%=<>!&|^~@]+)/,
    lineComment: '#',
    blockCommentStart: '"""',
    blockCommentEnd: '"""',
    stringDelimiters: ['"', "'"],
  },
  rust: {
    keywords: new Set([
      'as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn',
      'else', 'enum', 'extern', 'false', 'fn', 'for', 'if', 'impl', 'in',
      'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return',
      'self', 'Self', 'static', 'struct', 'super', 'trait', 'true', 'type',
      'unsafe', 'use', 'where', 'while', 'macro_rules',
    ]),
    types: new Set([
      'i8', 'i16', 'i32', 'i64', 'i128', 'isize', 'u8', 'u16', 'u32', 'u64',
      'u128', 'usize', 'f32', 'f64', 'bool', 'char', 'str', 'String',
      'Vec', 'Option', 'Result', 'Box', 'Rc', 'Arc', 'Cell', 'RefCell',
      'HashMap', 'HashSet', 'BTreeMap', 'BTreeSet',
    ]),
    operators: /^(=>|->|::|\.\.=?|&&|\|\||[+\-*/%=<>!&|^~?]+)/,
    lineComment: '//',
    blockCommentStart: '/*',
    blockCommentEnd: '*/',
    stringDelimiters: ['"'],
  },
  go: {
    keywords: new Set([
      'break', 'case', 'chan', 'const', 'continue', 'default', 'defer',
      'else', 'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import',
      'interface', 'map', 'package', 'range', 'return', 'select', 'struct',
      'switch', 'type', 'var', 'true', 'false', 'nil', 'iota',
    ]),
    types: new Set([
      'bool', 'byte', 'complex64', 'complex128', 'error', 'float32',
      'float64', 'int', 'int8', 'int16', 'int32', 'int64', 'rune',
      'string', 'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'uintptr',
    ]),
    operators: /^(:=|<-|&&|\|\||[+\-*/%=<>!&|^]+)/,
    lineComment: '//',
    blockCommentStart: '/*',
    blockCommentEnd: '*/',
    stringDelimiters: ['"', "'", '`'],
  },
  css: {
    keywords: new Set([
      'important', 'inherit', 'initial', 'unset', 'none', 'auto',
    ]),
    types: new Set([]),
    operators: /^[+>~*=^$|]+/,
    lineComment: '',
    blockCommentStart: '/*',
    blockCommentEnd: '*/',
    stringDelimiters: ['"', "'"],
  },
  html: {
    keywords: new Set([]),
    types: new Set([]),
    operators: /^[=]/,
    lineComment: '',
    blockCommentStart: '<!--',
    blockCommentEnd: '-->',
    stringDelimiters: ['"', "'"],
  },
  json: {
    keywords: new Set(['true', 'false', 'null']),
    types: new Set([]),
    operators: /^[:]/,
    lineComment: '',
    blockCommentStart: '',
    blockCommentEnd: '',
    stringDelimiters: ['"'],
  },
};

// File extension to language mapping
const EXT_TO_LANG: Record<string, string> = {
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.py': 'python',
  '.pyw': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.css': 'css',
  '.scss': 'css',
  '.less': 'css',
  '.html': 'html',
  '.htm': 'html',
  '.xml': 'html',
  '.svg': 'html',
  '.json': 'json',
  '.jsonc': 'json',
};

/**
 * Detect language from file path
 */
export function detectLanguage(filePath: string): string | null {
  const ext = filePath.substring(filePath.lastIndexOf('.'));
  return EXT_TO_LANG[ext.toLowerCase()] ?? null;
}

/**
 * Tokenize a line of code
 */
export function tokenizeLine(line: string, language: string | null): Token[] {
  if (!language || !LANGUAGES[language]) {
    return [{ type: 'text', value: line }];
  }

  const rules = LANGUAGES[language];
  const tokens: Token[] = [];
  let i = 0;

  while (i < line.length) {
    // Skip whitespace
    if (/\s/.test(line[i])) {
      let ws = '';
      while (i < line.length && /\s/.test(line[i])) {
        ws += line[i++];
      }
      tokens.push({ type: 'text', value: ws });
      continue;
    }

    // Line comment
    if (rules.lineComment && line.substring(i).startsWith(rules.lineComment)) {
      tokens.push({ type: 'comment', value: line.substring(i) });
      break;
    }

    // Block comment start (on same line)
    if (rules.blockCommentStart && line.substring(i).startsWith(rules.blockCommentStart)) {
      const endIdx = line.indexOf(rules.blockCommentEnd, i + rules.blockCommentStart.length);
      if (endIdx !== -1) {
        tokens.push({ type: 'comment', value: line.substring(i, endIdx + rules.blockCommentEnd.length) });
        i = endIdx + rules.blockCommentEnd.length;
      } else {
        tokens.push({ type: 'comment', value: line.substring(i) });
        break;
      }
      continue;
    }

    // String literals
    let foundString = false;
    for (const delim of rules.stringDelimiters) {
      if (line.substring(i).startsWith(delim)) {
        let str = delim;
        let j = i + delim.length;
        while (j < line.length) {
          if (line[j] === '\\' && j + 1 < line.length) {
            str += line[j] + line[j + 1];
            j += 2;
          } else if (line.substring(j).startsWith(delim)) {
            str += delim;
            j += delim.length;
            break;
          } else {
            str += line[j++];
          }
        }
        tokens.push({ type: 'string', value: str });
        i = j;
        foundString = true;
        break;
      }
    }
    if (foundString) continue;

    // Numbers
    const numMatch = line.substring(i).match(/^(?:0x[\da-fA-F]+|0b[01]+|0o[0-7]+|\d+\.?\d*(?:e[+-]?\d+)?)/);
    if (numMatch && numMatch[0]) {
      tokens.push({ type: 'number', value: numMatch[0] });
      i += numMatch[0].length;
      continue;
    }

    // Operators
    const opMatch = line.substring(i).match(rules.operators);
    if (opMatch && opMatch[0]) {
      tokens.push({ type: 'operator', value: opMatch[0] });
      i += opMatch[0].length;
      continue;
    }

    // Identifiers (keywords, types, variables)
    const idMatch = line.substring(i).match(/^[a-zA-Z_$][a-zA-Z0-9_$]*/);
    if (idMatch) {
      const word = idMatch[0];
      if (rules.keywords.has(word)) {
        tokens.push({ type: 'keyword', value: word });
      } else if (rules.types.has(word)) {
        tokens.push({ type: 'type', value: word });
      } else if (i + word.length < line.length && line[i + word.length] === '(') {
        tokens.push({ type: 'function', value: word });
      } else {
        tokens.push({ type: 'variable', value: word });
      }
      i += word.length;
      continue;
    }

    // Punctuation
    if (/[()[\]{},;.]/.test(line[i])) {
      tokens.push({ type: 'punctuation', value: line[i] });
      i++;
      continue;
    }

    // Unknown character
    tokens.push({ type: 'text', value: line[i] });
    i++;
  }

  return tokens;
}

/**
 * Get CSS color for a token type
 */
export function getTokenColor(type: TokenType): string {
  switch (type) {
    case 'keyword':
      return 'var(--syntax-keyword, #c678dd)';
    case 'string':
      return 'var(--syntax-string, #98c379)';
    case 'number':
      return 'var(--syntax-number, #d19a66)';
    case 'comment':
      return 'var(--syntax-comment, #5c6370)';
    case 'operator':
      return 'var(--syntax-operator, #56b6c2)';
    case 'function':
      return 'var(--syntax-function, #61afef)';
    case 'type':
      return 'var(--syntax-type, #e5c07b)';
    case 'variable':
      return 'var(--syntax-variable, #e06c75)';
    case 'punctuation':
      return 'var(--syntax-punctuation, #abb2bf)';
    default:
      return 'inherit';
  }
}

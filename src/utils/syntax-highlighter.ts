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
  xml: {
    keywords: new Set([]),
    types: new Set([]),
    operators: /^[=]/,
    lineComment: '',
    blockCommentStart: '<!--',
    blockCommentEnd: '-->',
    stringDelimiters: ['"', "'"],
  },
  c: {
    keywords: new Set([
      'auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do',
      'double', 'else', 'enum', 'extern', 'float', 'for', 'goto', 'if',
      'inline', 'int', 'long', 'register', 'restrict', 'return', 'short',
      'signed', 'sizeof', 'static', 'struct', 'switch', 'typedef', 'union',
      'unsigned', 'void', 'volatile', 'while', '_Bool', '_Complex', '_Imaginary',
      'NULL', 'true', 'false',
    ]),
    types: new Set([
      'int8_t', 'int16_t', 'int32_t', 'int64_t', 'uint8_t', 'uint16_t',
      'uint32_t', 'uint64_t', 'size_t', 'ptrdiff_t', 'intptr_t', 'uintptr_t',
      'FILE', 'bool',
    ]),
    operators: /^(->|<<|>>|<=|>=|==|!=|&&|\|\||[+\-*/%=<>!&|^~?:]+)/,
    lineComment: '//',
    blockCommentStart: '/*',
    blockCommentEnd: '*/',
    stringDelimiters: ['"', "'"],
  },
  cpp: {
    keywords: new Set([
      'alignas', 'alignof', 'and', 'and_eq', 'asm', 'auto', 'bitand', 'bitor',
      'bool', 'break', 'case', 'catch', 'char', 'char16_t', 'char32_t', 'class',
      'compl', 'concept', 'const', 'consteval', 'constexpr', 'constinit',
      'const_cast', 'continue', 'co_await', 'co_return', 'co_yield', 'decltype',
      'default', 'delete', 'do', 'double', 'dynamic_cast', 'else', 'enum',
      'explicit', 'export', 'extern', 'false', 'float', 'for', 'friend', 'goto',
      'if', 'inline', 'int', 'long', 'mutable', 'namespace', 'new', 'noexcept',
      'not', 'not_eq', 'nullptr', 'operator', 'or', 'or_eq', 'private',
      'protected', 'public', 'register', 'reinterpret_cast', 'requires',
      'return', 'short', 'signed', 'sizeof', 'static', 'static_assert',
      'static_cast', 'struct', 'switch', 'template', 'this', 'thread_local',
      'throw', 'true', 'try', 'typedef', 'typeid', 'typename', 'union',
      'unsigned', 'using', 'virtual', 'void', 'volatile', 'wchar_t', 'while',
      'xor', 'xor_eq', 'override', 'final',
    ]),
    types: new Set([
      'string', 'vector', 'map', 'set', 'list', 'deque', 'array', 'pair',
      'tuple', 'unique_ptr', 'shared_ptr', 'weak_ptr', 'optional', 'variant',
      'any', 'string_view', 'span', 'function', 'thread', 'mutex', 'atomic',
    ]),
    operators: /^(->|::|<<|>>|<=|>=|==|!=|&&|\|\||[+\-*/%=<>!&|^~?:]+)/,
    lineComment: '//',
    blockCommentStart: '/*',
    blockCommentEnd: '*/',
    stringDelimiters: ['"', "'"],
  },
  java: {
    keywords: new Set([
      'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char',
      'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum',
      'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements',
      'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new',
      'package', 'private', 'protected', 'public', 'return', 'short', 'static',
      'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws',
      'transient', 'try', 'void', 'volatile', 'while', 'true', 'false', 'null',
      'var', 'yield', 'record', 'sealed', 'permits', 'non-sealed',
    ]),
    types: new Set([
      'String', 'Integer', 'Long', 'Double', 'Float', 'Boolean', 'Character',
      'Byte', 'Short', 'Object', 'Class', 'System', 'Math', 'List', 'ArrayList',
      'Map', 'HashMap', 'Set', 'HashSet', 'Optional', 'Stream', 'Consumer',
      'Supplier', 'Function', 'Predicate', 'Runnable', 'Callable', 'Future',
      'Exception', 'RuntimeException', 'Thread', 'Comparable', 'Iterable',
    ]),
    operators: /^(->|::|<<|>>|<=|>=|==|!=|&&|\|\||[+\-*/%=<>!&|^~?:]+)/,
    lineComment: '//',
    blockCommentStart: '/*',
    blockCommentEnd: '*/',
    stringDelimiters: ['"', "'"],
  },
  shell: {
    keywords: new Set([
      'if', 'then', 'else', 'elif', 'fi', 'case', 'esac', 'for', 'while', 'until',
      'do', 'done', 'in', 'function', 'select', 'time', 'coproc', 'return',
      'exit', 'break', 'continue', 'local', 'declare', 'typeset', 'export',
      'readonly', 'unset', 'shift', 'eval', 'exec', 'source', 'true', 'false',
    ]),
    types: new Set([]),
    operators: /^(&&|\|\||[|&;<>()$`\\]+)/,
    lineComment: '#',
    blockCommentStart: '',
    blockCommentEnd: '',
    stringDelimiters: ['"', "'", '`'],
  },
  yaml: {
    keywords: new Set(['true', 'false', 'null', 'yes', 'no', 'on', 'off']),
    types: new Set([]),
    operators: /^[:\-|>]/,
    lineComment: '#',
    blockCommentStart: '',
    blockCommentEnd: '',
    stringDelimiters: ['"', "'"],
  },
  sql: {
    keywords: new Set([
      'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN',
      'IS', 'NULL', 'AS', 'ON', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER',
      'FULL', 'CROSS', 'GROUP', 'BY', 'HAVING', 'ORDER', 'ASC', 'DESC',
      'LIMIT', 'OFFSET', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
      'CREATE', 'TABLE', 'INDEX', 'VIEW', 'DROP', 'ALTER', 'ADD', 'COLUMN',
      'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'UNIQUE', 'CHECK', 'DEFAULT',
      'CONSTRAINT', 'CASCADE', 'TRUNCATE', 'UNION', 'ALL', 'DISTINCT', 'TOP',
      'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'EXISTS', 'ANY', 'SOME',
      'select', 'from', 'where', 'and', 'or', 'not', 'in', 'like', 'between',
      'is', 'null', 'as', 'on', 'join', 'left', 'right', 'inner', 'outer',
      'full', 'cross', 'group', 'by', 'having', 'order', 'asc', 'desc',
      'limit', 'offset', 'insert', 'into', 'values', 'update', 'set', 'delete',
      'create', 'table', 'index', 'view', 'drop', 'alter', 'add', 'column',
      'primary', 'key', 'foreign', 'references', 'unique', 'check', 'default',
      'constraint', 'cascade', 'truncate', 'union', 'all', 'distinct', 'top',
      'case', 'when', 'then', 'else', 'end', 'exists', 'any', 'some',
    ]),
    types: new Set([
      'INT', 'INTEGER', 'BIGINT', 'SMALLINT', 'TINYINT', 'DECIMAL', 'NUMERIC',
      'FLOAT', 'REAL', 'DOUBLE', 'CHAR', 'VARCHAR', 'TEXT', 'NCHAR', 'NVARCHAR',
      'NTEXT', 'BINARY', 'VARBINARY', 'IMAGE', 'DATE', 'TIME', 'DATETIME',
      'TIMESTAMP', 'BOOLEAN', 'BOOL', 'BIT', 'BLOB', 'CLOB', 'JSON', 'XML',
      'int', 'integer', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric',
      'float', 'real', 'double', 'char', 'varchar', 'text', 'nchar', 'nvarchar',
      'ntext', 'binary', 'varbinary', 'image', 'date', 'time', 'datetime',
      'timestamp', 'boolean', 'bool', 'bit', 'blob', 'clob', 'json', 'xml',
    ]),
    operators: /^(<=|>=|<>|!=|[=<>+\-*/%])/,
    lineComment: '--',
    blockCommentStart: '/*',
    blockCommentEnd: '*/',
    stringDelimiters: ["'"],
  },
  markdown: {
    keywords: new Set([]),
    types: new Set([]),
    operators: /^[#*_\-[\]()!`]/,
    lineComment: '',
    blockCommentStart: '',
    blockCommentEnd: '',
    stringDelimiters: ['`'],
  },
  toml: {
    keywords: new Set(['true', 'false']),
    types: new Set([]),
    operators: /^[=[\].]/,
    lineComment: '#',
    blockCommentStart: '',
    blockCommentEnd: '',
    stringDelimiters: ['"', "'"],
  },
  kotlin: {
    keywords: new Set([
      'as', 'break', 'class', 'continue', 'do', 'else', 'false', 'for', 'fun',
      'if', 'in', 'interface', 'is', 'null', 'object', 'package', 'return',
      'super', 'this', 'throw', 'true', 'try', 'typealias', 'typeof', 'val',
      'var', 'when', 'while', 'by', 'catch', 'constructor', 'delegate',
      'dynamic', 'field', 'file', 'finally', 'get', 'import', 'init', 'param',
      'property', 'receiver', 'set', 'setparam', 'where', 'actual', 'abstract',
      'annotation', 'companion', 'const', 'crossinline', 'data', 'enum',
      'expect', 'external', 'final', 'infix', 'inline', 'inner', 'internal',
      'lateinit', 'noinline', 'open', 'operator', 'out', 'override', 'private',
      'protected', 'public', 'reified', 'sealed', 'suspend', 'tailrec', 'vararg',
    ]),
    types: new Set([
      'Any', 'Boolean', 'Byte', 'Char', 'Double', 'Float', 'Int', 'Long',
      'Nothing', 'Short', 'String', 'Unit', 'Array', 'List', 'Map', 'Set',
      'MutableList', 'MutableMap', 'MutableSet', 'Sequence', 'Pair', 'Triple',
    ]),
    operators: /^(->|::|\.\.|\?\.|!!|[+\-*/%=<>!&|^~?:]+)/,
    lineComment: '//',
    blockCommentStart: '/*',
    blockCommentEnd: '*/',
    stringDelimiters: ['"', "'"],
  },
  swift: {
    keywords: new Set([
      'associatedtype', 'class', 'deinit', 'enum', 'extension', 'fileprivate',
      'func', 'import', 'init', 'inout', 'internal', 'let', 'open', 'operator',
      'private', 'protocol', 'public', 'rethrows', 'static', 'struct',
      'subscript', 'typealias', 'var', 'break', 'case', 'continue', 'default',
      'defer', 'do', 'else', 'fallthrough', 'for', 'guard', 'if', 'in',
      'repeat', 'return', 'switch', 'where', 'while', 'as', 'catch', 'false',
      'is', 'nil', 'super', 'self', 'Self', 'throw', 'throws', 'true', 'try',
      'async', 'await', 'actor',
    ]),
    types: new Set([
      'Int', 'Int8', 'Int16', 'Int32', 'Int64', 'UInt', 'UInt8', 'UInt16',
      'UInt32', 'UInt64', 'Float', 'Double', 'Bool', 'String', 'Character',
      'Array', 'Dictionary', 'Set', 'Optional', 'Result', 'Any', 'AnyObject',
    ]),
    operators: /^(->|\.\.\.|\.\.<|\?\?|[+\-*/%=<>!&|^~?:]+)/,
    lineComment: '//',
    blockCommentStart: '/*',
    blockCommentEnd: '*/',
    stringDelimiters: ['"'],
  },
  ruby: {
    keywords: new Set([
      'BEGIN', 'END', 'alias', 'and', 'begin', 'break', 'case', 'class', 'def',
      'defined?', 'do', 'else', 'elsif', 'end', 'ensure', 'false', 'for', 'if',
      'in', 'module', 'next', 'nil', 'not', 'or', 'redo', 'rescue', 'retry',
      'return', 'self', 'super', 'then', 'true', 'undef', 'unless', 'until',
      'when', 'while', 'yield', 'raise', 'require', 'require_relative', 'include',
      'extend', 'attr_reader', 'attr_writer', 'attr_accessor', 'private',
      'protected', 'public', 'lambda', 'proc',
    ]),
    types: new Set([
      'Array', 'Hash', 'String', 'Integer', 'Float', 'Symbol', 'Range',
      'Regexp', 'Time', 'File', 'Dir', 'IO', 'Exception', 'Class', 'Module',
      'Object', 'Proc', 'Lambda', 'Thread', 'Fiber', 'Struct', 'OpenStruct',
    ]),
    operators: /^(=>|\.\.\.?|[+\-*/%=<>!&|^~?:]+)/,
    lineComment: '#',
    blockCommentStart: '=begin',
    blockCommentEnd: '=end',
    stringDelimiters: ['"', "'", '`'],
  },
  php: {
    keywords: new Set([
      'abstract', 'and', 'array', 'as', 'break', 'callable', 'case', 'catch',
      'class', 'clone', 'const', 'continue', 'declare', 'default', 'do', 'echo',
      'else', 'elseif', 'empty', 'enddeclare', 'endfor', 'endforeach', 'endif',
      'endswitch', 'endwhile', 'eval', 'exit', 'extends', 'final', 'finally',
      'fn', 'for', 'foreach', 'function', 'global', 'goto', 'if', 'implements',
      'include', 'include_once', 'instanceof', 'insteadof', 'interface', 'isset',
      'list', 'match', 'namespace', 'new', 'or', 'print', 'private', 'protected',
      'public', 'readonly', 'require', 'require_once', 'return', 'static',
      'switch', 'throw', 'trait', 'try', 'unset', 'use', 'var', 'while', 'xor',
      'yield', 'true', 'false', 'null', 'self', 'parent',
    ]),
    types: new Set([
      'int', 'float', 'bool', 'string', 'array', 'object', 'callable', 'iterable',
      'void', 'mixed', 'never', 'null', 'false', 'true',
    ]),
    operators: /^(=>|->|::|\.\.\.|\?\?|[+\-*/%=<>!&|^~?:@]+)/,
    lineComment: '//',
    blockCommentStart: '/*',
    blockCommentEnd: '*/',
    stringDelimiters: ['"', "'", '`'],
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
  '.html': 'xml',
  '.htm': 'xml',
  '.xml': 'xml',
  '.svg': 'xml',
  '.wxs': 'xml',
  '.wxi': 'xml',
  '.wxl': 'xml',
  '.xsl': 'xml',
  '.xslt': 'xml',
  '.xsd': 'xml',
  '.xaml': 'xml',
  '.csproj': 'xml',
  '.vbproj': 'xml',
  '.fsproj': 'xml',
  '.vcxproj': 'xml',
  '.props': 'xml',
  '.targets': 'xml',
  '.nuspec': 'xml',
  '.config': 'xml',
  '.resx': 'xml',
  '.plist': 'xml',
  '.json': 'json',
  '.jsonc': 'json',
  // Additional common languages
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.fish': 'shell',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hh': 'cpp',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.swift': 'swift',
  '.rb': 'ruby',
  '.php': 'php',
  '.sql': 'sql',
};

/**
 * Detect language from file path
 */
export function detectLanguage(filePath: string): string | null {
  const ext = filePath.substring(filePath.lastIndexOf('.'));
  return EXT_TO_LANG[ext.toLowerCase()] ?? null;
}

/**
 * Tokenize XML/HTML line with proper tag/attribute highlighting
 */
function tokenizeXmlLine(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < line.length) {
    // XML Comment
    if (line.substring(i).startsWith('<!--')) {
      const endIdx = line.indexOf('-->', i + 4);
      if (endIdx !== -1) {
        tokens.push({ type: 'comment', value: line.substring(i, endIdx + 3) });
        i = endIdx + 3;
      } else {
        tokens.push({ type: 'comment', value: line.substring(i) });
        break;
      }
      continue;
    }

    // CDATA section
    if (line.substring(i).startsWith('<![CDATA[')) {
      const endIdx = line.indexOf(']]>', i + 9);
      if (endIdx !== -1) {
        tokens.push({ type: 'comment', value: line.substring(i, endIdx + 3) });
        i = endIdx + 3;
      } else {
        tokens.push({ type: 'comment', value: line.substring(i) });
        break;
      }
      continue;
    }

    // Processing instruction <?xml ... ?>
    if (line.substring(i).startsWith('<?')) {
      const endIdx = line.indexOf('?>', i + 2);
      if (endIdx !== -1) {
        tokens.push({ type: 'keyword', value: line.substring(i, endIdx + 2) });
        i = endIdx + 2;
      } else {
        tokens.push({ type: 'keyword', value: line.substring(i) });
        break;
      }
      continue;
    }

    // Opening or closing tag
    if (line[i] === '<') {
      tokens.push({ type: 'punctuation', value: '<' });
      i++;

      // Check for closing tag
      if (i < line.length && line[i] === '/') {
        tokens.push({ type: 'punctuation', value: '/' });
        i++;
      }

      // Tag name
      const tagMatch = line.substring(i).match(/^[a-zA-Z_:][\w:.-]*/);
      if (tagMatch) {
        tokens.push({ type: 'keyword', value: tagMatch[0] });
        i += tagMatch[0].length;
      }

      // Parse attributes until > or />
      while (i < line.length && line[i] !== '>') {
        // Whitespace
        if (/\s/.test(line[i])) {
          let ws = '';
          while (i < line.length && /\s/.test(line[i])) {
            ws += line[i++];
          }
          tokens.push({ type: 'text', value: ws });
          continue;
        }

        // Self-closing />
        if (line.substring(i, i + 2) === '/>') {
          tokens.push({ type: 'punctuation', value: '/>' });
          i += 2;
          break;
        }

        // Attribute name
        const attrMatch = line.substring(i).match(/^[a-zA-Z_:][\w:.-]*/);
        if (attrMatch) {
          tokens.push({ type: 'type', value: attrMatch[0] });
          i += attrMatch[0].length;
          continue;
        }

        // = sign
        if (line[i] === '=') {
          tokens.push({ type: 'operator', value: '=' });
          i++;
          continue;
        }

        // Attribute value (quoted string)
        if (line[i] === '"' || line[i] === "'") {
          const quote = line[i];
          let value = quote;
          let j = i + 1;
          while (j < line.length && line[j] !== quote) {
            value += line[j++];
          }
          if (j < line.length) {
            value += quote;
            j++;
          }
          tokens.push({ type: 'string', value });
          i = j;
          continue;
        }

        // Unknown character in tag
        tokens.push({ type: 'text', value: line[i] });
        i++;
      }

      // Closing >
      if (i < line.length && line[i] === '>') {
        tokens.push({ type: 'punctuation', value: '>' });
        i++;
      }
      continue;
    }

    // Text content between tags
    let text = '';
    while (i < line.length && line[i] !== '<') {
      text += line[i++];
    }
    if (text) {
      // Check if it looks like an entity reference
      const parts = text.split(/(&[a-zA-Z]+;|&#\d+;|&#x[a-fA-F0-9]+;)/);
      for (const part of parts) {
        if (part.match(/^&[a-zA-Z]+;$|^&#\d+;$|^&#x[a-fA-F0-9]+;$/)) {
          tokens.push({ type: 'number', value: part }); // Entity references
        } else if (part) {
          tokens.push({ type: 'text', value: part });
        }
      }
    }
  }

  return tokens;
}

/**
 * Tokenize a line of code
 */
export function tokenizeLine(line: string, language: string | null): Token[] {
  if (!language || !LANGUAGES[language]) {
    return [{ type: 'text', value: line }];
  }

  // Use specialized XML tokenizer
  if (language === 'xml') {
    return tokenizeXmlLine(line);
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

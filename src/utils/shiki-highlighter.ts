/**
 * Shiki-based Syntax Highlighter
 *
 * Uses VS Code's TextMate grammars for accurate highlighting of 200+ languages.
 * Provides line-by-line tokenization for integration with Lit templates.
 */

import {
  createHighlighter,
  type Highlighter,
  type BundledLanguage,
  bundledLanguages,
} from 'shiki';

// Singleton highlighter instance
let highlighterInstance: Highlighter | null = null;
let initPromise: Promise<Highlighter> | null = null;

// Themes for light and dark modes
const THEME_DARK = 'github-dark';
const THEME_LIGHT = 'github-light';

/**
 * Detect if the current theme is light mode.
 * Checks data-theme attribute first (user preference), then falls back to system preference.
 */
function isLightMode(): boolean {
  if (typeof document === 'undefined') return false;

  // Check manual theme override first
  const dataTheme = document.documentElement.getAttribute('data-theme');
  if (dataTheme === 'light') return true;
  if (dataTheme === 'dark') return false;

  // Fall back to system preference
  return window.matchMedia('(prefers-color-scheme: light)').matches;
}

/**
 * Get the appropriate Shiki theme based on current color scheme.
 * Respects both manual theme selection and system preference.
 */
export function getCurrentTheme(): 'github-dark' | 'github-light' {
  return isLightMode() ? THEME_LIGHT : THEME_DARK;
}

// Common languages to load initially (others loaded on demand)
const PRELOAD_LANGUAGES: BundledLanguage[] = [
  'javascript',
  'typescript',
  'json',
  'html',
  'css',
  'python',
  'rust',
  'go',
  'xml',
  'yaml',
  'markdown',
  'sql',
  'bash',
];

/**
 * File extension to Shiki language mapping
 * Shiki handles most extensions automatically, but we add custom mappings
 */
const EXT_TO_LANG: Record<string, BundledLanguage> = {
  // JavaScript/TypeScript
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'jsx',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.mts': 'typescript',
  '.cts': 'typescript',

  // Web
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'sass',
  '.less': 'less',
  '.vue': 'vue',
  '.svelte': 'svelte',

  // Data formats
  '.json': 'json',
  '.jsonc': 'jsonc',
  '.json5': 'json5',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.xml': 'xml',
  '.svg': 'xml',

  // WiX and .NET project files
  '.wxs': 'xml',
  '.wxi': 'xml',
  '.wxl': 'xml',
  '.csproj': 'xml',
  '.vbproj': 'xml',
  '.fsproj': 'xml',
  '.vcxproj': 'xml',
  '.props': 'xml',
  '.targets': 'xml',
  '.nuspec': 'xml',
  '.config': 'xml',
  '.resx': 'xml',
  '.xaml': 'xml',
  '.plist': 'xml',
  '.xsl': 'xml',
  '.xslt': 'xml',
  '.xsd': 'xml',

  // Systems programming
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hh': 'cpp',
  '.hxx': 'cpp',
  '.rs': 'rust',
  '.go': 'go',
  '.zig': 'zig',

  // JVM languages
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.scala': 'scala',
  '.groovy': 'groovy',
  '.gradle': 'groovy',

  // Apple/mobile
  '.swift': 'swift',
  '.m': 'objective-c',
  '.mm': 'objective-cpp',
  '.dart': 'dart',

  // Scripting
  '.py': 'python',
  '.pyw': 'python',
  '.pyi': 'python',
  '.rb': 'ruby',
  '.erb': 'erb',
  '.php': 'php',
  '.lua': 'lua',
  '.pl': 'perl',
  '.pm': 'perl',
  '.r': 'r',
  '.R': 'r',

  // Shell
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'zsh',
  '.fish': 'fish',
  '.ps1': 'powershell',
  '.psm1': 'powershell',
  '.bat': 'batch',
  '.cmd': 'batch',

  // Database
  '.sql': 'sql',
  '.psql': 'sql',
  '.mysql': 'sql',

  // Config files
  '.ini': 'ini',
  '.env': 'dotenv',
  '.dockerfile': 'dockerfile',
  '.containerfile': 'dockerfile',
  '.nginx': 'nginx',
  '.htaccess': 'apache',

  // Documentation
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.mdx': 'mdx',
  '.rst': 'rst',
  '.tex': 'latex',
  '.latex': 'latex',

  // Functional
  '.hs': 'haskell',
  '.lhs': 'haskell',
  '.ml': 'ocaml',
  '.mli': 'ocaml',
  '.fs': 'fsharp',
  '.fsi': 'fsharp',
  '.fsx': 'fsharp',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',
  '.hrl': 'erlang',
  '.clj': 'clojure',
  '.cljs': 'clojure',
  '.cljc': 'clojure',
  '.lisp': 'lisp',
  '.el': 'lisp',
  '.scm': 'scheme',
  '.rkt': 'racket',

  // Other
  '.proto': 'proto',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.tf': 'hcl',
  '.hcl': 'hcl',
  '.prisma': 'prisma',
  '.sol': 'solidity',
  '.v': 'v',
  '.nim': 'nim',
  '.cr': 'crystal',
  '.jl': 'julia',
  '.asm': 'asm',
  '.s': 'asm',
  '.wasm': 'wasm',
  '.wat': 'wasm',
  '.diff': 'diff',
  '.patch': 'diff',
  '.log': 'log',
  '.csv': 'csv',
  '.tsv': 'csv',

  // Lock files
  '.lock': 'toml', // Cargo.lock, etc.
  'package-lock.json': 'json',
  'yarn.lock': 'yaml',
};

// Special filename mappings (for files without extensions)
const FILENAME_TO_LANG: Record<string, BundledLanguage> = {
  'dockerfile': 'dockerfile',
  'Dockerfile': 'dockerfile',
  'makefile': 'makefile',
  'Makefile': 'makefile',
  'GNUmakefile': 'makefile',
  'CMakeLists.txt': 'cmake',
  'Jenkinsfile': 'groovy',
  'Vagrantfile': 'ruby',
  'Gemfile': 'ruby',
  'Rakefile': 'ruby',
  'Podfile': 'ruby',
  'Fastfile': 'ruby',
  '.gitignore': 'ini',
  '.gitattributes': 'ini',
  '.editorconfig': 'ini',
  '.prettierrc': 'json',
  '.eslintrc': 'json',
  '.babelrc': 'json',
  'tsconfig.json': 'jsonc',
  'jsconfig.json': 'jsonc',
  '.env': 'dotenv',
  '.env.local': 'dotenv',
  '.env.development': 'dotenv',
  '.env.production': 'dotenv',
};

/**
 * Initialize the highlighter (lazy, singleton)
 */
export async function initHighlighter(): Promise<Highlighter> {
  if (highlighterInstance) {
    return highlighterInstance;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = createHighlighter({
    themes: [THEME_DARK, THEME_LIGHT],
    langs: PRELOAD_LANGUAGES,
  });

  highlighterInstance = await initPromise;
  return highlighterInstance;
}

/**
 * Get the highlighter instance (returns null if not initialized)
 */
export function getHighlighter(): Highlighter | null {
  return highlighterInstance;
}

/**
 * Detect language from file path
 */
export function detectLanguage(filePath: string): BundledLanguage | null {
  if (!filePath) return null;

  // Check filename first (for special files like Dockerfile, Makefile)
  const filename = filePath.split('/').pop() || '';
  if (FILENAME_TO_LANG[filename]) {
    return FILENAME_TO_LANG[filename];
  }

  // Check extension
  const ext = filePath.substring(filePath.lastIndexOf('.'));
  if (ext && EXT_TO_LANG[ext.toLowerCase()]) {
    return EXT_TO_LANG[ext.toLowerCase()];
  }

  // Check if Shiki has this language bundled
  const langFromExt = ext.slice(1).toLowerCase();
  if (langFromExt in bundledLanguages) {
    return langFromExt as BundledLanguage;
  }

  return null;
}

/**
 * Check if a language is loaded, load it if not
 */
async function ensureLanguageLoaded(lang: BundledLanguage): Promise<boolean> {
  const highlighter = await initHighlighter();

  const loadedLangs = highlighter.getLoadedLanguages();
  if (loadedLangs.includes(lang)) {
    return true;
  }

  // Check if it's a valid bundled language
  if (!(lang in bundledLanguages)) {
    return false;
  }

  try {
    await highlighter.loadLanguage(lang);
    return true;
  } catch (e) {
    console.warn(`Failed to load language: ${lang}`, e);
    return false;
  }
}

/**
 * Token from Shiki with color information
 */
export interface HighlightToken {
  content: string;
  color: string;
}

/**
 * Highlight a single line of code and return tokens
 */
export async function highlightLine(
  line: string,
  language: BundledLanguage | null
): Promise<HighlightToken[]> {
  if (!language) {
    return [{ content: line, color: 'inherit' }];
  }

  try {
    const loaded = await ensureLanguageLoaded(language);
    if (!loaded) {
      return [{ content: line, color: 'inherit' }];
    }

    const highlighter = await initHighlighter();
    const result = highlighter.codeToTokens(line, {
      lang: language,
      theme: getCurrentTheme(),
    });

    // Flatten tokens from all lines (should be just one line)
    const tokens: HighlightToken[] = [];
    for (const tokenLine of result.tokens) {
      for (const token of tokenLine) {
        tokens.push({
          content: token.content,
          color: token.color || 'inherit',
        });
      }
    }

    return tokens;
  } catch (e) {
    console.warn(`Failed to highlight line:`, e);
    return [{ content: line, color: 'inherit' }];
  }
}

/**
 * Highlight multiple lines of code (more efficient for full files)
 */
export async function highlightCode(
  code: string,
  language: BundledLanguage | null
): Promise<HighlightToken[][]> {
  if (!language) {
    return code.split('\n').map(line => [{ content: line, color: 'inherit' }]);
  }

  try {
    const loaded = await ensureLanguageLoaded(language);
    if (!loaded) {
      return code.split('\n').map(line => [{ content: line, color: 'inherit' }]);
    }

    const highlighter = await initHighlighter();
    const result = highlighter.codeToTokens(code, {
      lang: language,
      theme: getCurrentTheme(),
    });

    return result.tokens.map(tokenLine =>
      tokenLine.map(token => ({
        content: token.content,
        color: token.color || 'inherit',
      }))
    );
  } catch (e) {
    console.warn(`Failed to highlight code:`, e);
    return code.split('\n').map(line => [{ content: line, color: 'inherit' }]);
  }
}

/**
 * Synchronous highlight using cached highlighter (for use in render methods)
 * Falls back to plain text if highlighter not ready
 */
export function highlightLineSync(
  line: string,
  language: BundledLanguage | null
): HighlightToken[] {
  if (!language || !highlighterInstance) {
    return [{ content: line, color: 'inherit' }];
  }

  try {
    // Check if language is loaded
    const loadedLangs = highlighterInstance.getLoadedLanguages();
    if (!loadedLangs.includes(language)) {
      // Trigger async load for next time
      ensureLanguageLoaded(language);
      return [{ content: line, color: 'inherit' }];
    }

    const result = highlighterInstance.codeToTokens(line, {
      lang: language,
      theme: getCurrentTheme(),
    });

    const tokens: HighlightToken[] = [];
    for (const tokenLine of result.tokens) {
      for (const token of tokenLine) {
        tokens.push({
          content: token.content,
          color: token.color || 'inherit',
        });
      }
    }

    return tokens;
  } catch {
    return [{ content: line, color: 'inherit' }];
  }
}

/**
 * Preload a language for future use
 */
export async function preloadLanguage(language: BundledLanguage): Promise<void> {
  await ensureLanguageLoaded(language);
}

/**
 * Get list of all supported languages
 */
export function getSupportedLanguages(): string[] {
  return Object.keys(bundledLanguages);
}

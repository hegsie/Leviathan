import { expect } from '@open-wc/testing';
import { detectLanguage, tokenizeLine, getTokenColor } from '../syntax-highlighter.ts';
import type { TokenType } from '../syntax-highlighter.ts';

describe('syntax-highlighter', () => {
  describe('detectLanguage', () => {
    it('should detect JavaScript from .js extension', () => {
      expect(detectLanguage('app.js')).to.equal('javascript');
    });

    it('should detect TypeScript from .ts extension', () => {
      expect(detectLanguage('app.ts')).to.equal('typescript');
    });

    it('should detect Python from .py extension', () => {
      expect(detectLanguage('script.py')).to.equal('python');
    });

    it('should detect Rust from .rs extension', () => {
      expect(detectLanguage('main.rs')).to.equal('rust');
    });

    it('should detect Go from .go extension', () => {
      expect(detectLanguage('main.go')).to.equal('go');
    });

    it('should detect CSS from .css extension', () => {
      expect(detectLanguage('styles.css')).to.equal('css');
    });

    it('should detect JSON from .json extension', () => {
      expect(detectLanguage('package.json')).to.equal('json');
    });

    it('should detect XML from .xml extension', () => {
      expect(detectLanguage('config.xml')).to.equal('xml');
    });

    it('should detect HTML as xml', () => {
      expect(detectLanguage('index.html')).to.equal('xml');
    });

    it('should detect shell from .sh extension', () => {
      expect(detectLanguage('build.sh')).to.equal('shell');
    });

    it('should detect markdown from .md extension', () => {
      expect(detectLanguage('README.md')).to.equal('markdown');
    });

    it('should detect YAML from .yml extension', () => {
      expect(detectLanguage('config.yml')).to.equal('yaml');
    });

    it('should detect TOML from .toml extension', () => {
      expect(detectLanguage('Cargo.toml')).to.equal('toml');
    });

    it('should detect SQL from .sql extension', () => {
      expect(detectLanguage('query.sql')).to.equal('sql');
    });

    it('should detect C from .c extension', () => {
      expect(detectLanguage('main.c')).to.equal('c');
    });

    it('should detect C++ from .cpp extension', () => {
      expect(detectLanguage('main.cpp')).to.equal('cpp');
    });

    it('should detect Java from .java extension', () => {
      expect(detectLanguage('App.java')).to.equal('java');
    });

    it('should detect Kotlin from .kt extension', () => {
      expect(detectLanguage('Main.kt')).to.equal('kotlin');
    });

    it('should detect Swift from .swift extension', () => {
      expect(detectLanguage('App.swift')).to.equal('swift');
    });

    it('should detect Ruby from .rb extension', () => {
      expect(detectLanguage('app.rb')).to.equal('ruby');
    });

    it('should detect PHP from .php extension', () => {
      expect(detectLanguage('index.php')).to.equal('php');
    });

    it('should return null for unknown extensions', () => {
      expect(detectLanguage('file.xyz')).to.be.null;
    });

    it('should handle paths with directories', () => {
      expect(detectLanguage('src/components/App.tsx')).to.equal('typescript');
    });

    it('should be case-insensitive for extensions', () => {
      expect(detectLanguage('script.PY')).to.equal('python');
    });

    it('should detect .csproj as XML', () => {
      expect(detectLanguage('project.csproj')).to.equal('xml');
    });

    it('should detect .wxs as XML', () => {
      expect(detectLanguage('installer.wxs')).to.equal('xml');
    });
  });

  describe('tokenizeLine', () => {
    it('should return plain text for null language', () => {
      const tokens = tokenizeLine('hello world', null);
      expect(tokens).to.have.lengthOf(1);
      expect(tokens[0].type).to.equal('text');
      expect(tokens[0].value).to.equal('hello world');
    });

    it('should return plain text for unknown language', () => {
      const tokens = tokenizeLine('hello world', 'unknown');
      expect(tokens).to.have.lengthOf(1);
      expect(tokens[0].type).to.equal('text');
    });

    describe('JavaScript tokenization', () => {
      it('should recognize keywords', () => {
        const tokens = tokenizeLine('const x = 5;', 'javascript');
        const keywordToken = tokens.find(t => t.value === 'const');
        expect(keywordToken?.type).to.equal('keyword');
      });

      it('should recognize string literals', () => {
        const tokens = tokenizeLine('const s = "hello";', 'javascript');
        const stringToken = tokens.find(t => t.value === '"hello"');
        expect(stringToken?.type).to.equal('string');
      });

      it('should recognize single-quoted strings', () => {
        const tokens = tokenizeLine("const s = 'world';", 'javascript');
        const stringToken = tokens.find(t => t.value === "'world'");
        expect(stringToken?.type).to.equal('string');
      });

      it('should recognize numbers', () => {
        const tokens = tokenizeLine('const x = 42;', 'javascript');
        const numToken = tokens.find(t => t.value === '42');
        expect(numToken?.type).to.equal('number');
      });

      it('should recognize hex numbers', () => {
        const tokens = tokenizeLine('const x = 0xFF;', 'javascript');
        const numToken = tokens.find(t => t.value === '0xFF');
        expect(numToken?.type).to.equal('number');
      });

      it('should recognize line comments', () => {
        const tokens = tokenizeLine('// this is a comment', 'javascript');
        expect(tokens[0].type).to.equal('comment');
        expect(tokens[0].value).to.equal('// this is a comment');
      });

      it('should recognize block comments', () => {
        const tokens = tokenizeLine('x /* comment */ y', 'javascript');
        const commentToken = tokens.find(t => t.type === 'comment');
        expect(commentToken?.value).to.equal('/* comment */');
      });

      it('should recognize function calls', () => {
        const tokens = tokenizeLine('console.log(x)', 'javascript');
        const funcToken = tokens.find(t => t.value === 'log');
        expect(funcToken?.type).to.equal('function');
      });

      it('should recognize operators', () => {
        const tokens = tokenizeLine('x => y', 'javascript');
        const opToken = tokens.find(t => t.value === '=>');
        expect(opToken?.type).to.equal('operator');
      });

      it('should recognize types', () => {
        const tokens = tokenizeLine('new Map()', 'javascript');
        const typeToken = tokens.find(t => t.value === 'Map');
        expect(typeToken?.type).to.equal('type');
      });

      it('should recognize punctuation', () => {
        const tokens = tokenizeLine('{ }', 'javascript');
        const punctTokens = tokens.filter(t => t.type === 'punctuation');
        expect(punctTokens).to.have.length.greaterThan(0);
      });

      it('should handle escape sequences in strings', () => {
        const tokens = tokenizeLine('const s = "hello\\nworld";', 'javascript');
        const stringToken = tokens.find(t => t.type === 'string');
        expect(stringToken?.value).to.include('\\n');
      });
    });

    describe('Python tokenization', () => {
      it('should recognize Python keywords', () => {
        const tokens = tokenizeLine('def hello():', 'python');
        const kwToken = tokens.find(t => t.value === 'def');
        expect(kwToken?.type).to.equal('keyword');
      });

      it('should recognize Python comments', () => {
        const tokens = tokenizeLine('# comment', 'python');
        expect(tokens[0].type).to.equal('comment');
      });

      it('should recognize Python types', () => {
        const tokens = tokenizeLine('x: int = 5', 'python');
        const typeToken = tokens.find(t => t.value === 'int');
        expect(typeToken?.type).to.equal('type');
      });
    });

    describe('Rust tokenization', () => {
      it('should recognize Rust keywords', () => {
        const tokens = tokenizeLine('fn main() {', 'rust');
        const kwToken = tokens.find(t => t.value === 'fn');
        expect(kwToken?.type).to.equal('keyword');
      });

      it('should recognize Rust types', () => {
        const tokens = tokenizeLine('let x: Vec<String> = vec![];', 'rust');
        const typeToken = tokens.find(t => t.value === 'Vec');
        expect(typeToken?.type).to.equal('type');
      });
    });

    describe('XML tokenization', () => {
      it('should tokenize XML tags', () => {
        const tokens = tokenizeLine('<div class="test">hello</div>', 'xml');
        const punctTokens = tokens.filter(t => t.type === 'punctuation');
        expect(punctTokens.length).to.be.greaterThan(0);
      });

      it('should recognize XML tag names as keywords', () => {
        const tokens = tokenizeLine('<div>text</div>', 'xml');
        const kwTokens = tokens.filter(t => t.type === 'keyword');
        expect(kwTokens.some(t => t.value === 'div')).to.be.true;
      });

      it('should recognize XML attributes as types', () => {
        const tokens = tokenizeLine('<input type="text" />', 'xml');
        const typeToken = tokens.find(t => t.type === 'type');
        expect(typeToken?.value).to.equal('type');
      });

      it('should recognize XML attribute values as strings', () => {
        const tokens = tokenizeLine('<a href="url">link</a>', 'xml');
        const stringToken = tokens.find(t => t.type === 'string');
        expect(stringToken?.value).to.equal('"url"');
      });

      it('should recognize XML comments', () => {
        const tokens = tokenizeLine('<!-- comment -->', 'xml');
        const commentToken = tokens.find(t => t.type === 'comment');
        expect(commentToken?.value).to.equal('<!-- comment -->');
      });

      it('should recognize self-closing tags', () => {
        const tokens = tokenizeLine('<br />', 'xml');
        const selfClose = tokens.find(t => t.value === '/>');
        expect(selfClose?.type).to.equal('punctuation');
      });

      it('should recognize processing instructions', () => {
        const tokens = tokenizeLine('<?xml version="1.0"?>', 'xml');
        const piToken = tokens.find(t => t.type === 'keyword');
        expect(piToken).to.not.be.undefined;
      });

      it('should handle entity references', () => {
        const tokens = tokenizeLine('<p>&amp;</p>', 'xml');
        const entityToken = tokens.find(t => t.value === '&amp;');
        expect(entityToken?.type).to.equal('number');
      });
    });

    describe('SQL tokenization', () => {
      it('should recognize SQL keywords', () => {
        const tokens = tokenizeLine('SELECT * FROM users', 'sql');
        const selectToken = tokens.find(t => t.value === 'SELECT');
        expect(selectToken?.type).to.equal('keyword');
      });

      it('should recognize SQL types', () => {
        const tokens = tokenizeLine('CREATE TABLE t (id INT)', 'sql');
        const typeToken = tokens.find(t => t.value === 'INT');
        expect(typeToken?.type).to.equal('type');
      });

      it('should recognize SQL comments', () => {
        const tokens = tokenizeLine('-- comment', 'sql');
        expect(tokens[0].type).to.equal('comment');
      });
    });

    describe('JSON tokenization', () => {
      it('should recognize JSON keywords', () => {
        const tokens = tokenizeLine('{ "key": true }', 'json');
        const kwToken = tokens.find(t => t.value === 'true');
        expect(kwToken?.type).to.equal('keyword');
      });

      it('should recognize JSON strings', () => {
        const tokens = tokenizeLine('{ "key": "value" }', 'json');
        const stringTokens = tokens.filter(t => t.type === 'string');
        expect(stringTokens.length).to.be.greaterThan(0);
      });
    });

    describe('Shell tokenization', () => {
      it('should recognize shell keywords', () => {
        const tokens = tokenizeLine('if [ -f file ]; then', 'shell');
        const kwToken = tokens.find(t => t.value === 'if');
        expect(kwToken?.type).to.equal('keyword');
      });

      it('should recognize shell comments', () => {
        const tokens = tokenizeLine('# comment', 'shell');
        expect(tokens[0].type).to.equal('comment');
      });
    });

    it('should handle empty lines', () => {
      const tokens = tokenizeLine('', 'javascript');
      expect(tokens).to.have.lengthOf(0);
    });

    it('should handle whitespace-only lines', () => {
      const tokens = tokenizeLine('   ', 'javascript');
      expect(tokens).to.have.lengthOf(1);
      expect(tokens[0].type).to.equal('text');
    });
  });

  describe('getTokenColor', () => {
    it('should return color for keyword', () => {
      expect(getTokenColor('keyword')).to.include('--syntax-keyword');
    });

    it('should return color for string', () => {
      expect(getTokenColor('string')).to.include('--syntax-string');
    });

    it('should return color for number', () => {
      expect(getTokenColor('number')).to.include('--syntax-number');
    });

    it('should return color for comment', () => {
      expect(getTokenColor('comment')).to.include('--syntax-comment');
    });

    it('should return color for operator', () => {
      expect(getTokenColor('operator')).to.include('--syntax-operator');
    });

    it('should return color for function', () => {
      expect(getTokenColor('function')).to.include('--syntax-function');
    });

    it('should return color for type', () => {
      expect(getTokenColor('type')).to.include('--syntax-type');
    });

    it('should return color for variable', () => {
      expect(getTokenColor('variable')).to.include('--syntax-variable');
    });

    it('should return color for punctuation', () => {
      expect(getTokenColor('punctuation')).to.include('--syntax-punctuation');
    });

    it('should return inherit for text', () => {
      expect(getTokenColor('text')).to.equal('inherit');
    });

    it('should return inherit for unknown type', () => {
      expect(getTokenColor('nonexistent' as TokenType)).to.equal('inherit');
    });
  });
});

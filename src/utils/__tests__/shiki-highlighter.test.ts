import { expect } from '@open-wc/testing';
import { detectLanguage, getCurrentTheme, getSupportedLanguages } from '../shiki-highlighter.ts';

describe('shiki-highlighter', () => {
  describe('detectLanguage', () => {
    it('should return null for empty path', () => {
      expect(detectLanguage('')).to.be.null;
    });

    it('should detect JavaScript from .js extension', () => {
      expect(detectLanguage('app.js')).to.equal('javascript');
    });

    it('should detect TypeScript from .ts extension', () => {
      expect(detectLanguage('main.ts')).to.equal('typescript');
    });

    it('should detect TSX from .tsx extension', () => {
      expect(detectLanguage('component.tsx')).to.equal('tsx');
    });

    it('should detect JSX from .jsx extension', () => {
      expect(detectLanguage('component.jsx')).to.equal('jsx');
    });

    it('should detect Python from .py extension', () => {
      expect(detectLanguage('script.py')).to.equal('python');
    });

    it('should detect Rust from .rs extension', () => {
      expect(detectLanguage('lib.rs')).to.equal('rust');
    });

    it('should detect Go from .go extension', () => {
      expect(detectLanguage('main.go')).to.equal('go');
    });

    it('should detect JSON from .json extension', () => {
      expect(detectLanguage('package.json')).to.equal('json');
    });

    it('should detect YAML from .yaml extension', () => {
      expect(detectLanguage('config.yaml')).to.equal('yaml');
    });

    it('should detect YAML from .yml extension', () => {
      expect(detectLanguage('config.yml')).to.equal('yaml');
    });

    it('should detect TOML from .toml extension', () => {
      expect(detectLanguage('Cargo.toml')).to.equal('toml');
    });

    it('should detect Markdown from .md extension', () => {
      expect(detectLanguage('README.md')).to.equal('markdown');
    });

    it('should detect HTML from .html extension', () => {
      expect(detectLanguage('index.html')).to.equal('html');
    });

    it('should detect CSS from .css extension', () => {
      expect(detectLanguage('styles.css')).to.equal('css');
    });

    it('should detect SCSS from .scss extension', () => {
      expect(detectLanguage('styles.scss')).to.equal('scss');
    });

    it('should detect SQL from .sql extension', () => {
      expect(detectLanguage('query.sql')).to.equal('sql');
    });

    it('should detect Bash from .sh extension', () => {
      expect(detectLanguage('build.sh')).to.equal('bash');
    });

    it('should detect C from .c extension', () => {
      expect(detectLanguage('main.c')).to.equal('c');
    });

    it('should detect C headers as C', () => {
      expect(detectLanguage('header.h')).to.equal('c');
    });

    it('should detect C++ from .cpp extension', () => {
      expect(detectLanguage('main.cpp')).to.equal('cpp');
    });

    it('should detect C# from .cs extension', () => {
      expect(detectLanguage('Program.cs')).to.equal('csharp');
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

    it('should detect .csproj as xml', () => {
      expect(detectLanguage('project.csproj')).to.equal('xml');
    });

    it('should detect .wxs as xml', () => {
      expect(detectLanguage('installer.wxs')).to.equal('xml');
    });

    it('should detect Vue from .vue extension', () => {
      expect(detectLanguage('App.vue')).to.equal('vue');
    });

    it('should detect Svelte from .svelte extension', () => {
      expect(detectLanguage('App.svelte')).to.equal('svelte');
    });

    it('should detect Docker from .dockerfile extension', () => {
      expect(detectLanguage('app.dockerfile')).to.equal('dockerfile');
    });

    it('should detect diff from .diff extension', () => {
      expect(detectLanguage('changes.diff')).to.equal('diff');
    });

    it('should detect Dockerfile by filename', () => {
      expect(detectLanguage('Dockerfile')).to.equal('dockerfile');
    });

    it('should detect Makefile by filename', () => {
      expect(detectLanguage('Makefile')).to.equal('makefile');
    });

    it('should detect Gemfile as ruby', () => {
      expect(detectLanguage('Gemfile')).to.equal('ruby');
    });

    it('should detect .gitignore as ini', () => {
      expect(detectLanguage('.gitignore')).to.equal('ini');
    });

    it('should detect tsconfig.json as jsonc', () => {
      expect(detectLanguage('tsconfig.json')).to.equal('jsonc');
    });

    it('should detect .env as dotenv', () => {
      expect(detectLanguage('.env')).to.equal('dotenv');
    });

    it('should handle paths with directories', () => {
      expect(detectLanguage('src/components/App.tsx')).to.equal('tsx');
    });

    it('should return null for files with no known extension', () => {
      expect(detectLanguage('unknown.xyz123')).to.be.null;
    });

    it('should detect lock files as toml', () => {
      expect(detectLanguage('Cargo.lock')).to.equal('toml');
    });

    it('should detect GraphQL from .graphql extension', () => {
      expect(detectLanguage('schema.graphql')).to.equal('graphql');
    });

    it('should detect Elixir from .ex extension', () => {
      expect(detectLanguage('app.ex')).to.equal('elixir');
    });

    it('should detect Haskell from .hs extension', () => {
      expect(detectLanguage('main.hs')).to.equal('haskell');
    });

    it('should detect PowerShell from .ps1 extension', () => {
      expect(detectLanguage('script.ps1')).to.equal('powershell');
    });
  });

  describe('getCurrentTheme', () => {
    it('should return a valid theme string', () => {
      const theme = getCurrentTheme();
      expect(['github-dark', 'github-light']).to.include(theme);
    });

    it('should fall back to system preference when no data-theme is set', () => {
      document.documentElement.removeAttribute('data-theme');
      const theme = getCurrentTheme();
      // Result depends on browser's prefers-color-scheme setting
      const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
      expect(theme).to.equal(prefersLight ? 'github-light' : 'github-dark');
    });

    it('should respect data-theme=light attribute', () => {
      document.documentElement.setAttribute('data-theme', 'light');
      expect(getCurrentTheme()).to.equal('github-light');
      document.documentElement.removeAttribute('data-theme');
    });

    it('should respect data-theme=dark attribute', () => {
      document.documentElement.setAttribute('data-theme', 'dark');
      expect(getCurrentTheme()).to.equal('github-dark');
      document.documentElement.removeAttribute('data-theme');
    });
  });

  describe('getSupportedLanguages', () => {
    it('should return an array of language strings', () => {
      const langs = getSupportedLanguages();
      expect(langs).to.be.an('array');
      expect(langs.length).to.be.greaterThan(0);
    });

    it('should include common languages', () => {
      const langs = getSupportedLanguages();
      expect(langs).to.include('javascript');
      expect(langs).to.include('typescript');
      expect(langs).to.include('python');
      expect(langs).to.include('rust');
      expect(langs).to.include('go');
    });
  });
});

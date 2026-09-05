/**
 * Localization runtime.
 *
 * The language setting hands arbitrary strings to this module — a locale that
 * was persisted before it was dropped, a system language we do not ship — so
 * everything here has to resolve to something renderable rather than throw.
 */

import { expect, waitUntil } from '@open-wc/testing';
import { msg } from '@lit/localize';
import {
  detectSystemLocale,
  getAppLocale,
  isSupportedLocale,
  resolveLocale,
  setAppLocale,
  supportedLocales,
} from '../index.ts';

describe('i18n runtime', () => {
  afterEach(async () => {
    await setAppLocale('en');
  });

  it('ships English as the source locale and French alongside it', () => {
    expect(supportedLocales.map((l) => l.code)).to.deep.equal(['en', 'fr']);
    // Endonyms: the picker stays readable whatever the active locale is.
    expect(supportedLocales.map((l) => l.name)).to.deep.equal(['English', 'Français']);
  });

  it('recognises only the locales it ships', () => {
    expect(isSupportedLocale('fr')).to.be.true;
    expect(isSupportedLocale('de')).to.be.false;
  });

  it('resolves a regional tag to the base locale it ships', () => {
    expect(resolveLocale('fr-CA')).to.equal('fr');
    expect(resolveLocale('en-GB')).to.equal('en');
  });

  it('resolves an unknown or empty locale to English', () => {
    expect(resolveLocale('xx-YY')).to.equal('en');
    expect(resolveLocale('')).to.equal('en');
    expect(resolveLocale(null)).to.equal('en');
  });

  it('detects a system locale we actually ship', () => {
    expect(supportedLocales.some((l) => l.code === detectSystemLocale())).to.be.true;
  });

  it('renders source strings under the source locale', () => {
    expect(getAppLocale()).to.equal('en');
    expect(msg('Open')).to.equal('Open');
  });

  it('translates msg() after switching to a shipped locale', async () => {
    const applied = await setAppLocale('fr');
    expect(applied).to.equal('fr');
    expect(getAppLocale()).to.equal('fr');
    await waitUntil(() => msg('Open') === 'Ouvrir', 'French templates became active');
    expect(msg('A powerful, open-source Git client')).to.equal(
      'Un client Git puissant et open source'
    );
  });

  it('falls back to English for an unsupported locale instead of throwing', async () => {
    const applied = await setAppLocale('xx');
    expect(applied).to.equal('en');
    expect(getAppLocale()).to.equal('en');
    expect(msg('Open')).to.equal('Open');
  });

  it('takes a regional tag straight to the locale it ships', async () => {
    const applied = await setAppLocale('fr-CA');
    expect(applied).to.equal('fr');
    expect(msg('Clone')).to.equal('Cloner');
  });
});

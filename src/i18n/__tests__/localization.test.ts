/**
 * Localization runtime.
 *
 * The language setting hands arbitrary strings to this module — a locale that
 * was persisted before it was dropped, a system language we do not ship — so
 * everything here has to resolve to something renderable rather than throw.
 */

import { expect, waitUntil } from '@open-wc/testing';
import { msg, str } from '@lit/localize';
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

  /**
   * Every string on the two localised surfaces has to have a translation, or
   * the French UI silently mixes English into it. A message whose source text
   * is not in the bundle falls back to the source, so "still English under fr"
   * is exactly the failure this catches — including a typo between the code
   * and the XLIFF, since the message id is derived from the source text.
   */
  describe('the localised surfaces have no untranslated strings left', () => {
    const plainMessages = [
      // Welcome
      'Failed to choose a folder to scan',
      'Drop a folder to open it',
      'Git repositories open straight away; any other folder can be scanned or initialized.',
      // Settings — AI/security, MCP
      'Blocked by security settings',
      'MCP access token',
      'MCP client configuration',
      'MCP access token regenerated — update your MCP clients',
      'Failed to regenerate the MCP access token',
      // Settings — graph
      'Show Avatars',
      'Unavailable while Offline Mode is on — avatars are fetched from gravatar.com.',
      // Settings — diff
      'Whitespace',
      'How whitespace-only changes are treated when rendering a diff',
      'Context Lines',
      'Show all whitespace',
      'Ignore trailing whitespace',
      'Ignore whitespace changes',
      'Ignore all whitespace',
      // Settings — behaviour
      'Always Sign Off Commits',
      'Start each new commit message with Sign off enabled, adding a Signed-off-by trailer',
    ];

    beforeEach(async () => {
      await setAppLocale('fr');
      await waitUntil(() => msg('Open') === 'Ouvrir', 'French templates became active');
    });

    for (const source of plainMessages) {
      it(`translates "${source.slice(0, 48)}"`, () => {
        expect(msg(source)).to.not.equal(source);
      });
    }

    it('translates the messages that carry a value', () => {
      const label = 'X';
      expect(msg(str`${label} copied to clipboard`)).to.not.equal('X copied to clipboard');
      expect(msg(str`Failed to copy ${label} to clipboard`)).to.not.equal(
        'Failed to copy X to clipboard'
      );
      expect(msg(str`Unavailable: your remote allowlist does not include ${label}.`)).to.not.equal(
        'Unavailable: your remote allowlist does not include X.'
      );
      const min = 0;
      const max = 20;
      expect(
        msg(str`Unchanged lines shown around each change (${min}-${max}, git's default is 3)`)
      ).to.not.equal("Unchanged lines shown around each change (0-20, git's default is 3)");
      const host = 'www.gravatar.com';
      const avatarsDescription = msg(
        str`Display author avatars in commit nodes. Avatars are fetched from Gravatar (${host}), a third-party service: each request sends an MD5 hash of the commit author's email address and your IP address. Off by default; Offline Mode disables it.`
      );
      expect(avatarsDescription).to.not.contain('Display author avatars');
      expect(avatarsDescription, 'the host is still substituted').to.contain(host);
    });
  });
});

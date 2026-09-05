/**
 * Settings Dialog — Language row.
 *
 * The language picker is the user-facing half of runtime localisation: it lists
 * the locales we ship, persists the choice, and the dialog around it has to
 * re-render in the new language on the spot — no restart, no reopening.
 */

import { expect, fixture, html, waitUntil } from '@open-wc/testing';

type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

const mockInvoke: MockInvoke = async (command: string) => {
  if (command === 'plugin:notification|is_permission_granted') return false;

  switch (command) {
    case 'get_ai_providers':
      return [];
    case 'get_app_version':
      return '0.1.0';
    case 'get_settings':
      return {};
    case 'get_system_capabilities':
      return { hasGpu: false, gpuName: null, totalRam: 8 };
    case 'get_downloaded_models':
    case 'get_available_models':
    case 'get_available_diff_tools':
    case 'get_available_merge_tools':
    case 'list_diff_tools':
      return [];
    case 'get_local_model_status':
      return { loaded: false, modelId: null };
    case 'get_mcp_status':
      return { servers: [], totalTools: 0 };
    case 'get_merge_tool_config':
      return { toolName: null, toolCmd: null };
    case 'get_diff_tool':
      return { tool: null, cmd: null, prompt: false };
    default:
      return null;
  }
};

let nextCallbackId = 1;

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
  transformCallback: () => nextCallbackId++,
};

(globalThis as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
  unregisterListener: () => {},
};

// Import AFTER setting up the mock
import '../lv-settings-dialog.ts';
import type { LvSettingsDialog } from '../lv-settings-dialog.ts';
import { settingsStore } from '../../../stores/settings.store.ts';
import { getAppLocale, setAppLocale } from '../../../i18n/index.ts';

function select(el: LvSettingsDialog): HTMLSelectElement {
  const node = el.shadowRoot?.querySelector<HTMLSelectElement>('#language-select');
  expect(node, 'language select exists').to.exist;
  return node as HTMLSelectElement;
}

function settingNames(el: LvSettingsDialog): string[] {
  return Array.from(el.shadowRoot?.querySelectorAll('.setting-name') ?? []).map(
    (node) => node.textContent?.trim() ?? ''
  );
}

function sectionTitles(el: LvSettingsDialog): string[] {
  return Array.from(el.shadowRoot?.querySelectorAll('.section-title') ?? []).map(
    (node) => node.textContent?.trim() ?? ''
  );
}

async function choose(el: LvSettingsDialog, locale: string): Promise<void> {
  const languageSelect = select(el);
  languageSelect.value = locale;
  languageSelect.dispatchEvent(new Event('change'));
}

describe('lv-settings-dialog language setting', () => {
  let el: LvSettingsDialog;

  beforeEach(async () => {
    await setAppLocale('en');
    settingsStore.setState({ language: 'en' });
    el = await fixture<LvSettingsDialog>(html`<lv-settings-dialog></lv-settings-dialog>`);
    await el.updateComplete;
  });

  afterEach(async () => {
    settingsStore.setState({ language: 'en' });
    await setAppLocale('en');
  });

  it('lists every locale the app ships, in English by default', () => {
    const options = Array.from(select(el).options).map((o) => ({
      value: o.value,
      label: o.textContent?.trim(),
    }));
    expect(options).to.deep.equal([
      { value: 'en', label: 'English' },
      { value: 'fr', label: 'Français' },
    ]);
    expect(select(el).value).to.equal('en');
    expect(sectionTitles(el)[0]).to.equal('Appearance');
  });

  it('persists the choice and re-renders the dialog without a reload', async () => {
    let changed = 0;
    const onChange = (): number => (changed += 1);
    window.addEventListener('settings-changed', onChange);

    await choose(el, 'fr');

    await waitUntil(
      () => sectionTitles(el)[0] === 'Apparence',
      'the settings dialog re-rendered in French'
    );
    window.removeEventListener('settings-changed', onChange);

    expect(settingsStore.getState().language).to.equal('fr');
    expect(getAppLocale()).to.equal('fr');
    expect(sectionTitles(el)).to.include('Sécurité');
    // The toggle rows take their label from the same strings.
    const toggleLabels = Array.from(el.shadowRoot?.querySelectorAll('.setting-name') ?? []).map(
      (node) => node.textContent?.trim()
    );
    expect(toggleLabels).to.include('Mode hors ligne');
    expect(changed, 'settings-changed was dispatched once').to.equal(1);
  });

  it('keeps the select in step with the persisted locale when reopened', async () => {
    await choose(el, 'fr');
    await waitUntil(() => settingsStore.getState().language === 'fr');

    const reopened = await fixture<LvSettingsDialog>(
      html`<lv-settings-dialog></lv-settings-dialog>`
    );
    await reopened.updateComplete;
    await waitUntil(() => select(reopened).value === 'fr', 'the reopened dialog shows French');
    expect(select(reopened).options[0].textContent?.trim()).to.equal('English');
  });

  it('switches back to English', async () => {
    await choose(el, 'fr');
    await waitUntil(() => sectionTitles(el)[0] === 'Apparence');

    await choose(el, 'en');
    await waitUntil(
      () => sectionTitles(el)[0] === 'Appearance',
      'the settings dialog went back to English'
    );
    expect(settingsStore.getState().language).to.equal('en');
  });

  it('translates the rows this dialog gained along with the older ones', async () => {
    // A half-translated screen is worse than an untranslated one: the rows
    // added most recently must follow the locale like every other row.
    await choose(el, 'fr');
    await waitUntil(() => sectionTitles(el)[0] === 'Apparence');

    const names = settingNames(el);
    expect(names, 'Show Avatars').to.include('Afficher les avatars');
    expect(names, 'Whitespace').to.include('Espaces');
    expect(names, 'Context Lines').to.include('Lignes de contexte');
    expect(names, 'Always Sign Off Commits').to.include(
      'Toujours ajouter un Signed-off-by aux commits'
    );

    // The whitespace menu's labels live in the settings store, so they have to
    // be localised there rather than baked into a module-level constant.
    const options = Array.from(
      el.shadowRoot?.querySelectorAll('#diff-whitespace-select option') ?? []
    ).map((option) => option.textContent?.trim());
    expect(options).to.deep.equal([
      'Afficher tous les espaces',
      'Ignorer les espaces en fin de ligne',
      "Ignorer les modifications d'espaces",
      'Ignorer tous les espaces',
    ]);
  });

  it('falls back to English when asked for a locale the app does not ship', async () => {
    const applied = await settingsStore.getState().setLanguage('xx-YY');
    expect(applied).to.equal('en');
    expect(settingsStore.getState().language).to.equal('en');
    await el.updateComplete;
    expect(sectionTitles(el)[0]).to.equal('Appearance');
  });

  it('maps a regional tag onto the locale it ships', async () => {
    const applied = await settingsStore.getState().setLanguage('fr-CA');
    expect(applied).to.equal('fr');
    expect(settingsStore.getState().language).to.equal('fr');
  });

  it('resets the language along with every other preference', async () => {
    await settingsStore.getState().setLanguage('fr');
    expect(settingsStore.getState().language).to.equal('fr');

    settingsStore.getState().resetToDefaults();

    expect(settingsStore.getState().language).to.equal('en');
    await waitUntil(() => getAppLocale() === 'en', 'the reset put the locale back to English');
  });
});

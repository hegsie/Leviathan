/**
 * Integration test for the output panel wiring in app-shell:
 * the command palette exposes "Toggle Output Panel", and its action flips
 * the panel state that renders <lv-output-panel closable> in the center panel.
 */

// ── Tauri mock (must be set before any imports) ────────────────────────────
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

let cbId = 0;
const mockInvoke: MockInvoke = () => Promise.resolve(null);

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => mockInvoke(command, args),
  transformCallback: () => cbId++,
};

// ── Imports (after Tauri mock) ─────────────────────────────────────────────
import { expect } from '@open-wc/testing';
import type { AppShell } from '../app-shell.ts';
import '../app-shell.ts';

interface PaletteCommandLike {
  id: string;
  label: string;
  action: () => void;
}

function createAppShell(): AppShell {
  return document.createElement('lv-app-shell') as AppShell;
}

function getPaletteCommands(el: AppShell): PaletteCommandLike[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (el as any).getPaletteCommands();
}

describe('app-shell output panel wiring', () => {
  it('exposes a Toggle Output Panel palette command', () => {
    const el = createAppShell();
    const cmd = getPaletteCommands(el).find((c) => c.id === 'toggle-output-panel');
    expect(cmd).to.exist;
    expect(cmd!.label).to.equal('Toggle Output Panel');
  });

  it('the palette action toggles the panel state on and off', () => {
    const el = createAppShell();
    const cmd = getPaletteCommands(el).find((c) => c.id === 'toggle-output-panel')!;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any).showOutputPanel).to.be.false;
    cmd.action();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any).showOutputPanel).to.be.true;
    cmd.action();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any).showOutputPanel).to.be.false;
  });
});

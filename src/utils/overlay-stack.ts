/**
 * Which overlay owns the Escape key.
 *
 * Fourteen dialogs register their own `document`-level keydown listener, and
 * every one of them asked only "am I open?" — never "am I the one on top?".
 * Because those listeners all sit on `document`, a single Escape ran ALL of
 * them: dismissing the command palette opened over the clean dialog also
 * dismissed the clean dialog underneath, discarding the file selection the
 * user had built. `stopPropagation()` cannot fix this — listeners on the same
 * node still fire — and `e.defaultPrevented` cannot either, because listener
 * order is mount order, not stacking order.
 *
 * So overlays announce themselves as they open. The last one to open owns the
 * key; everyone else ignores it. Registration is by identity, so a component
 * that opens twice without closing does not appear twice.
 */

const stack: object[] = [];

/** Mark `owner` as the topmost overlay. */
export function pushOverlay(owner: object): void {
  removeOverlay(owner);
  stack.push(owner);
}

/** Remove `owner` from the stack; the previous overlay regains the key. */
export function removeOverlay(owner: object): void {
  const i = stack.indexOf(owner);
  if (i !== -1) stack.splice(i, 1);
}

/**
 * True when `owner` is the topmost overlay — or when nothing has registered,
 * so a dialog that never announces itself keeps its old behaviour instead of
 * going silently dead.
 */
export function isTopOverlay(owner: object): boolean {
  return stack.length === 0 || stack[stack.length - 1] === owner;
}

/** Test seam: drop all registrations. */
export function resetOverlayStack(): void {
  stack.length = 0;
}

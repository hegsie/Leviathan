/**
 * Path comparison for paths that reach the app from two different sources and
 * can spell the same directory differently.
 */

/** A drive-letter path (C:\… / C:/…) or a UNC share (\\server\share). */
const WINDOWS_STYLE = /^(?:[a-zA-Z]:[\\/]|[\\/]{2}[^\\/])/;

/** Unify separators and drop trailing ones, keeping the root as "/". */
function normalize(path: string): string {
  const unified = path.replace(/\\/g, '/');
  const trimmed = unified.replace(/\/+$/, '');
  return trimmed || (unified ? '/' : '');
}

/**
 * True when `a` and `b` spell the same absolute path.
 *
 * git prints Windows paths with forward slashes (C:/work/repo) while paths
 * from the OS file dialog use backslashes (C:\work\repo), and Windows paths
 * that differ only in case name the same directory. POSIX paths stay
 * case-SENSITIVE: /srv/Repo and /srv/repo are two directories.
 *
 * Case sensitivity follows the SHAPE of the two paths, never the host the app
 * happens to run on. Keying it off the host made a POSIX-shaped pair fold on
 * Windows, which would fire the guard on the wrong worktree, and made the
 * function answer differently on each platform for the same input.
 *
 * This is a spelling comparison only — it cannot resolve symlinks. Prefer a
 * backend-resolved answer where one exists.
 */
export function samePath(a: string, b: string): boolean {
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return false;
  const caseInsensitive = WINDOWS_STYLE.test(a) && WINDOWS_STYLE.test(b);
  return caseInsensitive ? left.toLowerCase() === right.toLowerCase() : left === right;
}

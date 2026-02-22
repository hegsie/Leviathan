import { test, expect } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';
import { AppPage } from '../pages/app.page';
import { GraphPanelPage, RightPanelPage } from '../pages/panels.page';
import { startCommandCapture, findCommand, waitForRepositoryChanged, injectCommandError, injectCommandMock, waitForCommand } from '../fixtures/test-helpers';

/**
 * Helper to get a Playwright ElementHandle for the lv-graph-canvas element.
 * Uses Playwright's auto-piercing locator instead of manual shadowRoot traversal.
 */
async function getGraphCanvasHandle(page: import('@playwright/test').Page) {
  const graphCanvas = page.locator('lv-graph-canvas');
  await expect(graphCanvas).toBeAttached();
  return await graphCanvas.elementHandle();
}

/**
 * Helper to read the graph canvas internal selectedNode OID via page.evaluate().
 * The graph renders on a <canvas>, so we read component state directly.
 */
async function getSelectedNodeOid(page: import('@playwright/test').Page): Promise<string | null> {
  const handle = await getGraphCanvasHandle(page);
  return page.evaluate(
    (el) => {
      const canvas = el as HTMLElement & { selectedNode?: { oid: string } | null };
      return canvas?.selectedNode?.oid ?? null;
    },
    handle
  );
}

/**
 * Helper to read all selected OIDs from the graph canvas.
 */
async function getSelectedNodeOids(page: import('@playwright/test').Page): Promise<string[]> {
  const handle = await getGraphCanvasHandle(page);
  return page.evaluate(
    (el) => {
      const canvas = el as HTMLElement & { selectedNodes?: Set<string> };
      if (!canvas?.selectedNodes) return [];
      return Array.from(canvas.selectedNodes);
    },
    handle
  );
}

/**
 * Helper to read the total number of sorted nodes (commit rows) in the graph.
 */
async function getSortedNodeCount(page: import('@playwright/test').Page): Promise<number> {
  const handle = await getGraphCanvasHandle(page);
  return page.evaluate(
    (el) => {
      const canvas = el as HTMLElement & { sortedNodesByRow?: unknown[] };
      return canvas?.sortedNodesByRow?.length ?? 0;
    },
    handle
  );
}

/**
 * Helper to wait for the graph canvas to have a specific number of sorted nodes.
 */
async function waitForNodeCount(page: import('@playwright/test').Page, count: number): Promise<void> {
  const handle = await getGraphCanvasHandle(page);
  await page.waitForFunction(
    ([el, expected]) => {
      const canvas = el as HTMLElement & { sortedNodesByRow?: unknown[] };
      return (canvas?.sortedNodesByRow?.length ?? 0) === expected;
    },
    [handle, count] as const
  );
}

/**
 * Helper to wait for a specific commit to be selected in the graph canvas.
 */
async function waitForSelectedNode(page: import('@playwright/test').Page, oid: string): Promise<void> {
  const handle = await getGraphCanvasHandle(page);
  await page.waitForFunction(
    ([el, expectedOid]) => {
      const canvas = el as HTMLElement & { selectedNode?: { oid: string } | null };
      return canvas?.selectedNode?.oid === expectedOid;
    },
    [handle, oid] as const
  );
}

/**
 * Helper to wait for any commit to be selected in the graph canvas.
 */
async function waitForAnySelectedNode(page: import('@playwright/test').Page): Promise<void> {
  const handle = await getGraphCanvasHandle(page);
  await page.waitForFunction(
    (el) => {
      const canvas = el as HTMLElement & { selectedNode?: { oid: string } | null };
      return canvas?.selectedNode?.oid != null;
    },
    handle
  );
}

/**
 * Helper to wait for no commit to be selected in the graph canvas.
 */
async function waitForNoSelectedNode(page: import('@playwright/test').Page): Promise<void> {
  const handle = await getGraphCanvasHandle(page);
  await page.waitForFunction(
    (el) => {
      const canvas = el as HTMLElement & { selectedNode?: { oid: string } | null };
      return canvas?.selectedNode == null;
    },
    handle
  );
}

/**
 * Helper to focus the internal <canvas> element inside lv-graph-canvas
 * so keyboard events reach the component's own handler.
 * Uses Playwright's auto-piercing locator instead of manual shadowRoot traversal.
 */
async function focusGraphInternalCanvas(page: import('@playwright/test').Page): Promise<void> {
  const internalCanvas = page.locator('lv-graph-canvas canvas');
  await expect(internalCanvas).toBeAttached();
  await internalCanvas.focus();
}

/**
 * Helper to create commit mock data with sequential timestamps.
 */
function makeCommit(index: number, parentIds: string[] = []) {
  const now = Date.now() / 1000;
  return {
    oid: `commit${index}`,
    shortId: `commit${index}`.slice(0, 7),
    message: `Commit ${index}`,
    summary: `Commit ${index}`,
    body: null,
    author: { name: 'Test User', email: 'test@example.com', timestamp: now - index * 3600 },
    committer: { name: 'Test User', email: 'test@example.com', timestamp: now - index * 3600 },
    parentIds,
    timestamp: now - index * 3600,
  };
}

test.describe('Commit Graph', () => {
  let app: AppPage;
  let graph: GraphPanelPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    graph = new GraphPanelPage(page);
    await setupOpenRepository(page);
  });

  test('should display graph canvas', async () => {
    await expect(graph.canvas).toBeVisible();
  });

  test('graph canvas should be the main content area', async () => {
    await app.waitForReady();
    await expect(graph.canvas).toBeVisible();
    const canvasElement = graph.canvas.locator('canvas');
    await expect(canvasElement).toBeAttached();
  });
});

test.describe('Graph with Multiple Commits', () => {
  let app: AppPage;
  let graph: GraphPanelPage;
  let rightPanel: RightPanelPage;

  const commits = [
    makeCommit(0, []),
    makeCommit(1, ['commit0']),
    makeCommit(2, ['commit1']),
  ];

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    graph = new GraphPanelPage(page);
    rightPanel = new RightPanelPage(page);
    await setupOpenRepository(page, { commits });
    await expect(graph.canvas).toBeVisible();
    await waitForNodeCount(page, 3);
  });

  test('should render all commits in the graph', async ({ page }) => {
    const nodeCount = await getSortedNodeCount(page);
    expect(nodeCount).toBe(3);
  });

  test('should have loaded commit history from backend', async ({ page }) => {
    await startCommandCapture(page);

    const handle = await getGraphCanvasHandle(page);
    await page.evaluate(
      (el) => {
        const canvas = el as HTMLElement & { repositoryPath: string };
        if (canvas) {
          const path = canvas.repositoryPath;
          canvas.repositoryPath = '';
          canvas.repositoryPath = path;
        }
      },
      handle
    );
    await waitForCommand(page, 'get_commit_history');

    const commitHistoryCalls = await findCommand(page, 'get_commit_history');
    expect(commitHistoryCalls.length).toBeGreaterThan(0);
  });

  test('keyboard navigation down should select the first commit', async ({ page }) => {
    const initialOid = await getSelectedNodeOid(page);
    expect(initialOid).toBeNull();

    await graph.navigateDown();
    await waitForSelectedNode(page, 'commit0');

    const selectedOid = await getSelectedNodeOid(page);
    expect(selectedOid).not.toBeNull();
    expect(selectedOid).toBe('commit0');
  });

  test('keyboard navigation down then down should move selection forward', async ({ page }) => {
    await graph.navigateDown();
    await waitForSelectedNode(page, 'commit0');
    const firstOid = await getSelectedNodeOid(page);

    await graph.navigateDown();
    const handle = await getGraphCanvasHandle(page);
    await page.waitForFunction(
      ([el, prevOid]) => {
        const canvas = el as HTMLElement & { selectedNode?: { oid: string } | null };
        const current = canvas?.selectedNode?.oid ?? null;
        return current != null && current !== prevOid;
      },
      [handle, firstOid] as const
    );
    const secondOid = await getSelectedNodeOid(page);

    expect(secondOid).not.toBeNull();
    expect(secondOid).not.toBe(firstOid);
  });

  test('keyboard navigation up should move selection backward', async ({ page }) => {
    await graph.navigateDown();
    await waitForAnySelectedNode(page);
    await graph.navigateDown();
    await waitForSelectedNode(page, 'commit1');
    const secondOid = await getSelectedNodeOid(page);

    await graph.navigateUp();
    const handle = await getGraphCanvasHandle(page);
    await page.waitForFunction(
      ([el, prevOid]) => {
        const canvas = el as HTMLElement & { selectedNode?: { oid: string } | null };
        const current = canvas?.selectedNode?.oid ?? null;
        return current != null && current !== prevOid;
      },
      [handle, secondOid] as const
    );
    const afterUpOid = await getSelectedNodeOid(page);

    expect(afterUpOid).not.toBeNull();
    expect(afterUpOid).not.toBe(secondOid);
  });

  test('Home should navigate to the first commit', async ({ page }) => {
    await graph.navigateDown();
    await graph.navigateDown();
    await waitForAnySelectedNode(page);

    await graph.navigateToFirst();
    await waitForSelectedNode(page, 'commit0');

    const selectedOid = await getSelectedNodeOid(page);
    expect(selectedOid).toBe('commit0');
  });

  test('End should navigate to the last commit', async ({ page }) => {
    await graph.navigateToLast();
    await waitForSelectedNode(page, 'commit2');

    const selectedOid = await getSelectedNodeOid(page);
    expect(selectedOid).toBe('commit2');
  });

  test('selecting a commit should dispatch commit-selected event and update right panel', async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as { __COMMIT_SELECTED_EVENTS__: unknown[] }).__COMMIT_SELECTED_EVENTS__ = [];
      document.addEventListener('commit-selected', (e: Event) => {
        const detail = (e as CustomEvent).detail;
        (window as unknown as { __COMMIT_SELECTED_EVENTS__: unknown[] }).__COMMIT_SELECTED_EVENTS__.push(detail);
      });
    });

    await graph.navigateDown();
    await page.waitForFunction(() => {
      const events = (window as unknown as { __COMMIT_SELECTED_EVENTS__?: unknown[] }).__COMMIT_SELECTED_EVENTS__ || [];
      return events.length > 0;
    });

    const events = await page.evaluate(() => {
      return (window as unknown as { __COMMIT_SELECTED_EVENTS__: Array<{ commit: { oid: string; summary: string } | null }> }).__COMMIT_SELECTED_EVENTS__;
    });

    expect(events.length).toBeGreaterThan(0);
    const lastEvent = events[events.length - 1];
    expect(lastEvent.commit).not.toBeNull();
    expect(lastEvent.commit!.oid).toBe('commit0');

    const detailsTab = rightPanel.detailsTab;
    await expect(detailsTab).toBeVisible();

    const commitDetails = page.locator('lv-commit-details');
    await expect(commitDetails).toBeVisible();
    const commitMessage = commitDetails.locator('.commit-message');
    await expect(commitMessage).toContainText('Commit 0');
  });

  test('selecting different commits should update the commit details panel', async ({ page }) => {
    await graph.navigateDown();
    await waitForSelectedNode(page, 'commit0');

    const commitDetails = page.locator('lv-commit-details');
    await expect(commitDetails).toBeVisible();
    const commitMessage = commitDetails.locator('.commit-message');
    await expect(commitMessage).toContainText('Commit 0');

    await graph.navigateDown();
    await waitForSelectedNode(page, 'commit1');

    await expect(commitMessage).toContainText('Commit 1');
  });
});

test.describe('Graph Commit Selection', () => {
  let app: AppPage;
  let graph: GraphPanelPage;
  let rightPanel: RightPanelPage;

  const commits = [
    makeCommit(0, []),
    makeCommit(1, ['commit0']),
    makeCommit(2, ['commit1']),
  ];

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    graph = new GraphPanelPage(page);
    rightPanel = new RightPanelPage(page);
    await setupOpenRepository(page, { commits });
    await expect(graph.canvas).toBeVisible();
    await waitForNodeCount(page, 3);
  });

  test('selecting a commit via selectCommit API should update selection state', async ({ page }) => {
    const handle = await getGraphCanvasHandle(page);
    const result = await page.evaluate(
      (el) => {
        const canvas = el as HTMLElement & { selectCommit: (oid: string) => boolean };
        return canvas?.selectCommit('commit1') ?? false;
      },
      handle
    );

    expect(result).toBe(true);
    await waitForSelectedNode(page, 'commit1');

    const selectedOid = await getSelectedNodeOid(page);
    expect(selectedOid).toBe('commit1');
  });

  test('selected commit details should appear in the right panel', async ({ page }) => {
    const handle = await getGraphCanvasHandle(page);
    await page.evaluate(
      (el) => {
        const canvas = el as HTMLElement & { selectCommit: (oid: string) => boolean };
        canvas?.selectCommit('commit1');
      },
      handle
    );
    await waitForSelectedNode(page, 'commit1');

    const commitDetails = page.locator('lv-commit-details');
    await expect(commitDetails).toBeVisible();

    const commitOid = commitDetails.locator('.commit-oid');
    await expect(commitOid).toContainText('commit1'.slice(0, 7));

    const commitMessage = commitDetails.locator('.commit-message');
    await expect(commitMessage).toContainText('Commit 1');
  });

  test('Escape should deselect the current commit', async ({ page }) => {
    await graph.navigateDown();
    await waitForAnySelectedNode(page);
    const selectedBefore = await getSelectedNodeOid(page);
    expect(selectedBefore).not.toBeNull();

    // Focus the internal <canvas> element inside lv-graph-canvas
    // so the Escape keydown event reaches the component's own handler
    await focusGraphInternalCanvas(page);
    await page.keyboard.press('Escape');
    await waitForNoSelectedNode(page);

    const selectedAfter = await getSelectedNodeOid(page);
    expect(selectedAfter).toBeNull();

    const selectedOids = await getSelectedNodeOids(page);
    expect(selectedOids).toHaveLength(0);
  });
});

test.describe('Diff Overlay', () => {
  let graph: GraphPanelPage;

  test.beforeEach(async ({ page }) => {
    graph = new GraphPanelPage(page);
    await setupOpenRepository(page);
    await expect(graph.canvas).toBeVisible();
  });

  test('diff overlay should not be visible by default', async () => {
    await expect(graph.diffOverlay).not.toBeVisible();
  });

  test('isDiffVisible should return false when no diff is shown', async () => {
    const isVisible = await graph.isDiffVisible();
    expect(isVisible).toBe(false);
  });
});

test.describe('Blame Overlay', () => {
  let graph: GraphPanelPage;

  test.beforeEach(async ({ page }) => {
    graph = new GraphPanelPage(page);
    await setupOpenRepository(page);
    await expect(graph.canvas).toBeVisible();
  });

  test('blame overlay should not be visible by default', async () => {
    await expect(graph.blameOverlay).not.toBeVisible();
  });

  test('isBlameVisible should return false when no blame is shown', async () => {
    const isVisible = await graph.isBlameVisible();
    expect(isVisible).toBe(false);
  });
});

test.describe('Graph Scrolling', () => {
  let graph: GraphPanelPage;

  // Create 50 commits in a linear chain
  const commits = Array.from({ length: 50 }, (_, i) =>
    makeCommit(i, i > 0 ? [`commit${i - 1}`] : [])
  );

  test.beforeEach(async ({ page }) => {
    graph = new GraphPanelPage(page);
    await setupOpenRepository(page, { commits });
    await expect(graph.canvas).toBeVisible();
    await waitForNodeCount(page, 50);
  });

  test('should render all 50 commits in the graph layout', async ({ page }) => {
    const nodeCount = await getSortedNodeCount(page);
    expect(nodeCount).toBe(50);
  });

  test('should handle large commit history without errors', async () => {
    await expect(graph.canvas).toBeVisible();
    const errorPanel = graph.canvas.locator('.info-panel');
    await expect(errorPanel).not.toBeVisible();
  });

  test('should navigate through many commits with arrow keys', async ({ page }) => {
    for (let i = 0; i < 10; i++) {
      await graph.navigateDown();
    }
    await waitForSelectedNode(page, 'commit9');

    const selectedOid = await getSelectedNodeOid(page);
    expect(selectedOid).not.toBeNull();
    expect(selectedOid).toBe('commit9');
  });

  test('End should navigate to the last of 50 commits', async ({ page }) => {
    await graph.navigateToLast();
    await waitForSelectedNode(page, 'commit49');

    const selectedOid = await getSelectedNodeOid(page);
    expect(selectedOid).toBe('commit49');
  });

  test('Home after End should return to the first commit', async ({ page }) => {
    await graph.navigateToLast();
    await waitForSelectedNode(page, 'commit49');

    await graph.navigateToFirst();
    await waitForSelectedNode(page, 'commit0');

    const selectedOid = await getSelectedNodeOid(page);
    expect(selectedOid).toBe('commit0');
  });
});

test.describe('Empty Repository Graph', () => {
  let graph: GraphPanelPage;

  test.beforeEach(async ({ page }) => {
    graph = new GraphPanelPage(page);
    await setupOpenRepository(page, {
      commits: [],
      branches: [],
    });
  });

  test('should render the canvas area even with no commits', async () => {
    await expect(graph.canvas).toBeVisible();
  });

  test('should have zero sorted nodes when there are no commits', async ({ page }) => {
    await waitForNodeCount(page, 0);
    const nodeCount = await getSortedNodeCount(page);
    expect(nodeCount).toBe(0);
  });

  test('keyboard navigation should not crash on empty graph', async ({ page }) => {
    await graph.canvas.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Home');
    await page.keyboard.press('End');

    await expect(graph.canvas).toBeVisible();

    const selectedOid = await getSelectedNodeOid(page);
    expect(selectedOid).toBeNull();
  });

  test('Escape should clear the commit details panel', async ({ page }) => {
    // Select a commit first
    await graph.navigateDown();
    await waitForSelectedNode(page, 'commit0');

    // Verify details panel shows commit info
    const commitDetails = page.locator('lv-commit-details');
    await expect(commitDetails).toBeVisible();
    await expect(commitDetails.locator('.commit-message')).toContainText('Commit 0');

    // Focus the internal <canvas> and press Escape to deselect
    await focusGraphInternalCanvas(page);
    await page.keyboard.press('Escape');
    await waitForNoSelectedNode(page);

    // Verify details panel clears: either the commit details component is hidden,
    // or the details tab is no longer active, or the commit message area is empty
    const detailsVisible = await commitDetails.count() > 0 && await commitDetails.isVisible();
    if (detailsVisible) {
      // If the component is still visible, it should show an empty/placeholder state
      const messageEl = commitDetails.locator('.commit-message');
      const messageText = await messageEl.count() > 0 ? await messageEl.textContent() : '';
      const oidEl = commitDetails.locator('.commit-oid');
      const oidText = await oidEl.count() > 0 ? await oidEl.textContent() : '';
      // When deselected the panel may show empty or the changes tab may take over
      expect(messageText === '' || oidText === '' || !messageText).toBeTruthy();
    }
    // Either way, no commit should be selected
    const selectedOid = await getSelectedNodeOid(page);
    expect(selectedOid).toBeNull();
  });
});

test.describe('Graph - UI Outcome Verification', () => {
  let graph: GraphPanelPage;
  let rightPanel: RightPanelPage;

  const commits = [
    makeCommit(0, []),
    makeCommit(1, ['commit0']),
    makeCommit(2, ['commit1']),
  ];

  test.beforeEach(async ({ page }) => {
    graph = new GraphPanelPage(page);
    rightPanel = new RightPanelPage(page);
    await setupOpenRepository(page, { commits });
    await expect(graph.canvas).toBeVisible();
    await waitForNodeCount(page, 3);
  });

  test('clicking a commit via selectCommit API updates the details panel with that commit info', async ({ page }) => {
    // Use the component's public selectCommit API to simulate a mouse click selection
    const handle = await getGraphCanvasHandle(page);
    await page.evaluate(
      (el) => {
        const canvas = el as HTMLElement & { selectCommit: (oid: string) => boolean };
        canvas?.selectCommit('commit2');
      },
      handle
    );
    await waitForSelectedNode(page, 'commit2');

    // Verify the details panel shows the selected commit's information
    const commitDetails = page.locator('lv-commit-details');
    await expect(commitDetails).toBeVisible();
    await expect(commitDetails.locator('.commit-message')).toContainText('Commit 2');
    await expect(commitDetails.locator('.commit-oid')).toContainText('commit2'.slice(0, 7));
  });

  test('deselecting a commit clears the details panel or shows empty state', async ({ page }) => {
    // Select a commit first
    const handle = await getGraphCanvasHandle(page);
    await page.evaluate(
      (el) => {
        const canvas = el as HTMLElement & { selectCommit: (oid: string) => boolean };
        canvas?.selectCommit('commit1');
      },
      handle
    );
    await waitForSelectedNode(page, 'commit1');

    // Verify the commit details panel is showing
    const commitDetails = page.locator('lv-commit-details');
    await expect(commitDetails).toBeVisible();
    await expect(commitDetails.locator('.commit-message')).toContainText('Commit 1');

    // Deselect by pressing Escape on the internal canvas
    await focusGraphInternalCanvas(page);
    await page.keyboard.press('Escape');
    await waitForNoSelectedNode(page);

    // After deselection the details panel should either be hidden
    // or no longer display the previous commit's info
    const detailsStillVisible = await commitDetails.count() > 0 && await commitDetails.isVisible();
    if (detailsStillVisible) {
      // The commit-specific content should be cleared
      const oidEl = commitDetails.locator('.commit-oid');
      const oidText = await oidEl.count() > 0 ? await oidEl.textContent() : '';
      const hasCommit1Oid = oidText?.includes('commit1'.slice(0, 7)) ?? false;
      expect(hasCommit1Oid).toBe(false);
    }

    // Confirm no commit is selected
    const selectedOid = await getSelectedNodeOid(page);
    expect(selectedOid).toBeNull();
  });

  test('mouse-based selection via selectCommit marks the commit as selected in graph state', async ({ page }) => {
    // Initially no commit should be selected
    const initialOid = await getSelectedNodeOid(page);
    expect(initialOid).toBeNull();

    // Simulate mouse click by calling selectCommit (canvas-based graph cannot be directly clicked by Playwright)
    const handle = await getGraphCanvasHandle(page);
    const result = await page.evaluate(
      (el) => {
        const canvas = el as HTMLElement & { selectCommit: (oid: string) => boolean; selectedNode?: { oid: string } | null };
        const success = canvas?.selectCommit('commit0') ?? false;
        return { success, selectedOid: canvas?.selectedNode?.oid ?? null };
      },
      handle
    );

    expect(result.success).toBe(true);
    expect(result.selectedOid).toBe('commit0');

    // Wait for the selection state to propagate
    await waitForSelectedNode(page, 'commit0');

    // Verify via the helper that the selection is tracked in the component state
    const selectedOid = await getSelectedNodeOid(page);
    expect(selectedOid).toBe('commit0');

    // Also verify the selectedNodes set includes this commit
    const selectedOids = await getSelectedNodeOids(page);
    expect(selectedOids).toContain('commit0');
  });
});

test.describe('Graph Error Handling', () => {
  let graph: GraphPanelPage;

  test.beforeEach(async ({ page }) => {
    graph = new GraphPanelPage(page);
    await setupOpenRepository(page);
    await expect(graph.canvas).toBeVisible();
  });

  test('should handle get_commit_history failure gracefully', async ({ page }) => {
    // Inject an error so the next call to get_commit_history will fail
    await injectCommandError(page, 'get_commit_history', 'Failed to read commit history: corrupt object');

    // Force the graph to re-fetch commit history by resetting repositoryPath
    const handle = await getGraphCanvasHandle(page);
    await page.evaluate(
      (el) => {
        const canvas = el as HTMLElement & { repositoryPath: string };
        if (canvas) {
          const path = canvas.repositoryPath;
          canvas.repositoryPath = '';
          canvas.repositoryPath = path;
        }
      },
      handle
    );

    await expect(graph.canvas).toBeVisible();

    // The graph should show an empty/error state - either zero nodes or an info panel
    const nodeCount = await getSortedNodeCount(page);

    // Either the graph shows zero nodes (graceful empty state),
    // an info panel with error information, or a toast notification
    const hasEmptyState = nodeCount === 0;

    if (!hasEmptyState) {
      await expect(
        page.locator('.info-panel, .toast.error, .toast, .error, .error-banner').first()
      ).toBeVisible({ timeout: 5000 });
    }
  });
});

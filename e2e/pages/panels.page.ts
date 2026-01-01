import type { Page, Locator } from '@playwright/test';

/**
 * Left Panel Page Object
 * Provides access to branches, stashes, and tags
 */
export class LeftPanelPage {
  readonly page: Page;
  readonly panel: Locator;

  // Section headers (for expanding/collapsing)
  readonly stashesHeader: Locator;
  readonly tagsHeader: Locator;

  // Branch list
  readonly branchList: Locator;
  readonly localBranches: Locator;
  readonly remoteBranches: Locator;
  readonly currentBranch: Locator;

  // Stash list
  readonly stashList: Locator;
  readonly stashItems: Locator;

  // Tag list
  readonly tagList: Locator;
  readonly tagItems: Locator;

  constructor(page: Page) {
    this.page = page;
    this.panel = page.locator('lv-left-panel');

    // Section headers - used to expand/collapse sections
    this.stashesHeader = page.getByText('Stashes').first();
    this.tagsHeader = page.getByText('Tags').first();

    // Branch list - use role-based selectors that work with shadow DOM
    this.branchList = page.locator('lv-branch-list');
    // Local branches are listitem elements with names starting with refs/heads/
    this.localBranches = page.getByRole('listitem', { name: /refs\/heads\// });
    // Remote branches are listitem elements with names containing origin
    this.remoteBranches = page.getByRole('listitem', { name: /refs\/remotes\// });
    this.currentBranch = page.getByRole('listitem', { name: /refs\/heads\/main/ }).first();

    // Stash list - the component itself
    this.stashList = page.locator('lv-stash-list');
    // Stash items are rendered with stash-item class
    this.stashItems = this.stashList.locator('.stash-item');

    // Tag list - the component itself
    this.tagList = page.locator('lv-tag-list');
    // Tag items are rendered with tag-item class
    this.tagItems = this.tagList.locator('.tag-item');
  }

  /**
   * Expand the stashes section
   */
  async expandStashes(): Promise<void> {
    await this.stashesHeader.click();
  }

  /**
   * Expand the tags section
   */
  async expandTags(): Promise<void> {
    await this.tagsHeader.click();
  }

  /**
   * Get a branch item by name
   */
  getBranch(name: string): Locator {
    // Search within the branch list component to avoid matching files
    return this.branchList.getByRole('listitem', { name: new RegExp(`refs/heads/${name}`) });
  }

  /**
   * Click on a branch to checkout
   */
  async checkoutBranch(name: string): Promise<void> {
    await this.getBranch(name).click();
  }

  /**
   * Right-click a branch to open context menu
   */
  async openBranchContextMenu(name: string): Promise<void> {
    await this.getBranch(name).click({ button: 'right' });
  }

  /**
   * Get a stash item by index
   */
  getStash(index: number): Locator {
    return this.stashItems.nth(index);
  }

  /**
   * Get a tag by name
   */
  getTag(name: string): Locator {
    return this.tagItems.filter({ hasText: name });
  }

  /**
   * Check if panel is visible
   */
  async isVisible(): Promise<boolean> {
    return this.panel.isVisible();
  }

  /**
   * Count local branches
   */
  async getLocalBranchCount(): Promise<number> {
    return this.localBranches.count();
  }

  /**
   * Count stashes
   */
  async getStashCount(): Promise<number> {
    return this.stashItems.count();
  }

  /**
   * Count tags
   */
  async getTagCount(): Promise<number> {
    return this.tagItems.count();
  }
}

/**
 * Right Panel Page Object
 * Provides access to file status, staging, and commit
 */
export class RightPanelPage {
  readonly page: Page;
  readonly panel: Locator;

  // Tabs
  readonly changesTab: Locator;
  readonly detailsTab: Locator;

  // File status (Changes tab)
  readonly fileStatus: Locator;
  readonly stagedSection: Locator;
  readonly unstagedSection: Locator;
  readonly stagedFiles: Locator;
  readonly unstagedFiles: Locator;

  // Stage/unstage buttons
  readonly stageAllButton: Locator;
  readonly unstageAllButton: Locator;

  // Commit panel
  readonly commitPanel: Locator;
  readonly commitMessage: Locator;
  readonly commitButton: Locator;
  readonly aiGenerateButton: Locator;

  // Commit details (Details tab)
  readonly commitDetails: Locator;
  readonly commitSha: Locator;
  readonly commitAuthor: Locator;
  readonly commitDate: Locator;
  readonly commitFilesChanged: Locator;

  constructor(page: Page) {
    this.page = page;
    this.panel = page.locator('lv-right-panel');

    // Tabs - use getByRole for buttons with tab-like behavior
    this.changesTab = page.getByRole('button', { name: /^Changes/ });
    this.detailsTab = page.getByRole('button', { name: 'Details' });

    // File status - use accessible selectors
    this.fileStatus = page.locator('lv-file-status');
    // Staged section - look for the section containing "Staged" text
    this.stagedSection = page.locator('lv-file-status').filter({ hasText: 'Staged' });
    // Unstaged section contains "Changes" header (not to be confused with tab)
    this.unstagedSection = page.locator('lv-file-status');
    // Files are listitem elements within lv-file-status (to avoid matching left panel branches)
    this.stagedFiles = page.locator('lv-file-status').getByRole('listitem');
    this.unstagedFiles = page.locator('lv-file-status').getByRole('listitem');

    // Stage/unstage buttons - use accessible roles
    this.stageAllButton = page.getByRole('button', { name: 'Stage all' });
    this.unstageAllButton = page.getByRole('button', { name: 'Unstage all' });

    // Commit panel - use getByRole for accessible elements
    this.commitPanel = page.locator('lv-commit-panel');
    this.commitMessage = page.getByRole('textbox', { name: /Summary/i });
    this.commitButton = page.getByRole('button', { name: 'Commit', exact: true });
    // AI generate button might not always be visible
    this.aiGenerateButton = page.getByRole('button', { name: /Generate|AI/i });

    // Commit details - lv-commit-details component
    this.commitDetails = page.locator('lv-commit-details');
    this.commitSha = this.commitDetails.locator('.commit-sha');
    this.commitAuthor = this.commitDetails.locator('.commit-author');
    this.commitDate = this.commitDetails.locator('.commit-date');
    this.commitFilesChanged = this.commitDetails.locator('.file-item');
  }

  /**
   * Switch to Changes tab
   */
  async switchToChanges(): Promise<void> {
    await this.changesTab.click();
  }

  /**
   * Switch to Details tab
   */
  async switchToDetails(): Promise<void> {
    await this.detailsTab.click();
  }

  /**
   * Get an unstaged file by path
   */
  getUnstagedFile(path: string): Locator {
    // File items are listitem elements containing file names within lv-file-status
    return this.page.locator('lv-file-status').getByRole('listitem', { name: new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
  }

  /**
   * Get a staged file by path
   */
  getStagedFile(path: string): Locator {
    // File items are listitem elements containing file names within lv-file-status
    return this.page.locator('lv-file-status').getByRole('listitem', { name: new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
  }

  /**
   * Stage a specific file
   */
  async stageFile(path: string): Promise<void> {
    const file = this.getUnstagedFile(path);
    await file.locator('.stage-btn, button[title*="Stage"]').click();
  }

  /**
   * Unstage a specific file
   */
  async unstageFile(path: string): Promise<void> {
    const file = this.getStagedFile(path);
    await file.locator('.unstage-btn, button[title*="Unstage"]').click();
  }

  /**
   * Stage all files
   */
  async stageAll(): Promise<void> {
    await this.stageAllButton.click();
  }

  /**
   * Unstage all files
   */
  async unstageAll(): Promise<void> {
    await this.unstageAllButton.click();
  }

  /**
   * Enter commit message and commit
   */
  async commit(message: string): Promise<void> {
    await this.commitMessage.fill(message);
    await this.commitButton.click();
  }

  /**
   * Click the AI generate button
   */
  async generateCommitMessage(): Promise<void> {
    await this.aiGenerateButton.click();
  }

  /**
   * Get count of staged files
   */
  async getStagedCount(): Promise<number> {
    // The staged section has a .section-count showing the number of staged files
    // The section structure is: .section-header > .section-title "Staged" + .section-count "N"
    try {
      const stagedSection = this.page.locator('lv-file-status .section-header:has-text("Staged")');
      const isVisible = await stagedSection.isVisible({ timeout: 1000 });
      if (!isVisible) return 0;

      // Get the count from the .section-count element
      const countText = await stagedSection.locator('.section-count').textContent();
      return parseInt(countText || '0', 10);
    } catch {
      return 0;
    }
  }

  /**
   * Get count of unstaged files
   */
  async getUnstagedCount(): Promise<number> {
    // The unstaged section shows "Changes" with a .section-count
    // When there are no files, the section might not exist
    try {
      const changesSection = this.page.locator('lv-file-status .section-header:has-text("Changes")');
      const isVisible = await changesSection.isVisible({ timeout: 1000 });
      if (!isVisible) return 0;

      const countText = await changesSection.locator('.section-count').textContent();
      return parseInt(countText || '0', 10);
    } catch {
      return 0;
    }
  }

  /**
   * Check if commit button is enabled
   */
  async isCommitEnabled(): Promise<boolean> {
    return this.commitButton.isEnabled();
  }

  /**
   * Click on a file to open diff view
   */
  async openFileDiff(path: string): Promise<void> {
    const file = this.getUnstagedFile(path).or(this.getStagedFile(path));
    await file.click();
  }

  /**
   * Check if panel is visible
   */
  async isVisible(): Promise<boolean> {
    return this.panel.isVisible();
  }
}

/**
 * Graph Panel Page Object
 * Provides access to the commit graph canvas
 */
export class GraphPanelPage {
  readonly page: Page;
  readonly canvas: Locator;
  readonly diffOverlay: Locator;
  readonly blameOverlay: Locator;

  constructor(page: Page) {
    this.page = page;
    this.canvas = page.locator('lv-graph-canvas');
    this.diffOverlay = page.locator('lv-diff-view');
    this.blameOverlay = page.locator('lv-blame-view');
  }

  /**
   * Check if graph canvas is visible
   */
  async isVisible(): Promise<boolean> {
    return this.canvas.isVisible();
  }

  /**
   * Check if diff overlay is visible
   */
  async isDiffVisible(): Promise<boolean> {
    return this.diffOverlay.isVisible();
  }

  /**
   * Close diff overlay
   */
  async closeDiff(): Promise<void> {
    await this.page.keyboard.press('Escape');
    await this.diffOverlay.waitFor({ state: 'hidden' });
  }

  /**
   * Check if blame overlay is visible
   */
  async isBlameVisible(): Promise<boolean> {
    return this.blameOverlay.isVisible();
  }

  /**
   * Close blame overlay
   */
  async closeBlame(): Promise<void> {
    await this.page.keyboard.press('Escape');
    await this.blameOverlay.waitFor({ state: 'hidden' });
  }

  /**
   * Navigate commits with keyboard
   */
  async navigateDown(): Promise<void> {
    await this.canvas.focus();
    await this.page.keyboard.press('ArrowDown');
  }

  /**
   * Navigate commits with keyboard
   */
  async navigateUp(): Promise<void> {
    await this.canvas.focus();
    await this.page.keyboard.press('ArrowUp');
  }

  /**
   * Navigate to first commit
   */
  async navigateToFirst(): Promise<void> {
    await this.canvas.focus();
    await this.page.keyboard.press('Home');
  }

  /**
   * Navigate to last commit
   */
  async navigateToLast(): Promise<void> {
    await this.canvas.focus();
    await this.page.keyboard.press('End');
  }
}

import { LitElement, html, css } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';

export interface SearchFilter {
  query: string;
  author: string;
  dateFrom: string;
  dateTo: string;
  filePath: string;
  branch: string;
}

@customElement('lv-search-bar')
export class LvSearchBar extends LitElement {
  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
      }

      .search-container {
        display: flex;
        align-items: center;
        gap: 8px;
        background: var(--input-background);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        padding: 4px 8px;
        transition: border-color 0.2s;
      }

      .search-container:focus-within {
        border-color: var(--accent-color);
      }

      .search-icon {
        color: var(--text-secondary);
        flex-shrink: 0;
      }

      input {
        flex: 1;
        border: none;
        background: transparent;
        color: var(--text-primary);
        font-size: 13px;
        padding: 6px 0;
        outline: none;
        min-width: 150px;
      }

      input::placeholder {
        color: var(--text-tertiary);
      }

      .clear-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border: none;
        background: transparent;
        color: var(--text-secondary);
        cursor: pointer;
        border-radius: 3px;
        padding: 0;
      }

      .clear-btn:hover {
        background: var(--hover-background);
        color: var(--text-primary);
      }

      .filter-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border: none;
        background: transparent;
        color: var(--text-secondary);
        cursor: pointer;
        border-radius: 4px;
      }

      .filter-btn:hover {
        background: var(--hover-background);
      }

      .filter-btn.active {
        color: var(--accent-color);
        background: var(--accent-background);
      }

      .filters-panel {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        margin-top: 4px;
        background: var(--panel-background);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        padding: 12px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        z-index: 100;
      }

      .filter-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      }

      .filter-row:last-child {
        margin-bottom: 0;
      }

      .filter-label {
        font-size: 12px;
        color: var(--text-secondary);
        min-width: 60px;
      }

      .filter-input {
        flex: 1;
        padding: 6px 8px;
        border: 1px solid var(--border-color);
        border-radius: 4px;
        background: var(--input-background);
        color: var(--text-primary);
        font-size: 12px;
      }

      .filter-input:focus {
        outline: none;
        border-color: var(--accent-color);
      }

      .filter-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid var(--border-color);
      }

      .filter-actions button {
        padding: 6px 12px;
        border-radius: 4px;
        font-size: 12px;
        cursor: pointer;
        border: 1px solid var(--border-color);
        background: var(--button-background);
        color: var(--text-primary);
      }

      .filter-actions button:hover {
        background: var(--button-hover-background);
      }

      .filter-actions button.primary {
        background: var(--accent-color);
        border-color: var(--accent-color);
        color: white;
      }

      .result-count {
        font-size: 11px;
        color: var(--text-secondary);
        padding: 0 4px;
      }

      .wrapper {
        position: relative;
      }
    `,
  ];

  @property({ type: Boolean }) expanded = false;
  @property({ type: Number }) resultCount = 0;
  @property({ type: Boolean }) showResultCount = false;

  @state() private query = '';
  @state() private author = '';
  @state() private dateFrom = '';
  @state() private dateTo = '';
  @state() private filePath = '';
  @state() private branch = '';
  @state() private showFilters = false;

  @query('input[type="text"]') private inputEl!: HTMLInputElement;

  focus(): void {
    this.inputEl?.focus();
  }

  private handleInput(e: Event): void {
    const input = e.target as HTMLInputElement;
    this.query = input.value;
    this.emitSearch();
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.query = '';
      this.emitSearch();
      this.inputEl?.blur();
    } else if (e.key === 'Enter') {
      this.emitSearch();
    }
  }

  private handleClear(): void {
    this.query = '';
    this.author = '';
    this.dateFrom = '';
    this.dateTo = '';
    this.filePath = '';
    this.branch = '';
    this.emitSearch();
    this.inputEl?.focus();
  }

  private toggleFilters(): void {
    this.showFilters = !this.showFilters;
  }

  private handleAuthorChange(e: Event): void {
    this.author = (e.target as HTMLInputElement).value;
  }

  private handleDateFromChange(e: Event): void {
    this.dateFrom = (e.target as HTMLInputElement).value;
  }

  private handleDateToChange(e: Event): void {
    this.dateTo = (e.target as HTMLInputElement).value;
  }

  private handleFilePathChange(e: Event): void {
    this.filePath = (e.target as HTMLInputElement).value;
  }

  private handleBranchChange(e: Event): void {
    this.branch = (e.target as HTMLInputElement).value;
  }

  private applyFilters(): void {
    this.showFilters = false;
    this.emitSearch();
  }

  private clearFilters(): void {
    this.author = '';
    this.dateFrom = '';
    this.dateTo = '';
    this.filePath = '';
    this.branch = '';
    this.emitSearch();
  }

  private emitSearch(): void {
    const filter: SearchFilter = {
      query: this.query,
      author: this.author,
      dateFrom: this.dateFrom,
      dateTo: this.dateTo,
      filePath: this.filePath,
      branch: this.branch,
    };

    this.dispatchEvent(
      new CustomEvent('search-change', {
        detail: filter,
        bubbles: true,
        composed: true,
      })
    );
  }

  private hasActiveFilters(): boolean {
    return !!(this.author || this.dateFrom || this.dateTo || this.filePath || this.branch);
  }

  render() {
    const hasQuery = this.query.length > 0;
    const hasFilters = this.hasActiveFilters();

    return html`
      <div class="wrapper">
        <div class="search-container">
          <svg class="search-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/>
          </svg>

          <input
            type="text"
            placeholder="Search commits..."
            .value=${this.query}
            @input=${this.handleInput}
            @keydown=${this.handleKeyDown}
          />

          ${this.showResultCount && hasQuery
            ? html`<span class="result-count">${this.resultCount} results</span>`
            : null}

          ${hasQuery || hasFilters
            ? html`
                <button class="clear-btn" @click=${this.handleClear} title="Clear search">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                    <path d="M6 4.586L1.707.293A1 1 0 00.293 1.707L4.586 6 .293 10.293a1 1 0 101.414 1.414L6 7.414l4.293 4.293a1 1 0 001.414-1.414L7.414 6l4.293-4.293A1 1 0 0010.293.293L6 4.586z"/>
                  </svg>
                </button>
              `
            : null}

          <button
            class="filter-btn ${hasFilters ? 'active' : ''}"
            @click=${this.toggleFilters}
            title="Advanced filters"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1.5 1.5A.5.5 0 0 1 2 1h12a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.128.334L10 8.692V13.5a.5.5 0 0 1-.342.474l-3 1A.5.5 0 0 1 6 14.5V8.692L1.628 3.834A.5.5 0 0 1 1.5 3.5v-2z"/>
            </svg>
          </button>
        </div>

        ${this.showFilters
          ? html`
              <div class="filters-panel">
                <div class="filter-row">
                  <span class="filter-label">Author</span>
                  <input
                    type="text"
                    class="filter-input"
                    placeholder="Author name or email"
                    .value=${this.author}
                    @input=${this.handleAuthorChange}
                  />
                </div>

                <div class="filter-row">
                  <span class="filter-label">From</span>
                  <input
                    type="date"
                    class="filter-input"
                    .value=${this.dateFrom}
                    @change=${this.handleDateFromChange}
                  />
                </div>

                <div class="filter-row">
                  <span class="filter-label">To</span>
                  <input
                    type="date"
                    class="filter-input"
                    .value=${this.dateTo}
                    @change=${this.handleDateToChange}
                  />
                </div>

                <div class="filter-row">
                  <span class="filter-label">Path</span>
                  <input
                    type="text"
                    class="filter-input"
                    placeholder="*.ts, src/**, or file path"
                    .value=${this.filePath}
                    @input=${this.handleFilePathChange}
                  />
                </div>

                <div class="filter-row">
                  <span class="filter-label">Branch</span>
                  <input
                    type="text"
                    class="filter-input"
                    placeholder="Branch or ref name"
                    .value=${this.branch}
                    @input=${this.handleBranchChange}
                  />
                </div>

                <div class="filter-actions">
                  <button @click=${this.clearFilters}>Clear Filters</button>
                  <button class="primary" @click=${this.applyFilters}>Apply</button>
                </div>
              </div>
            `
          : null}
      </div>
    `;
  }
}

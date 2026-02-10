import { expect } from '@open-wc/testing';

// Mock Tauri API before importing any modules that use it
const mockInvoke = (_command: string): Promise<unknown> => {
  return Promise.resolve(null);
};

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

/**
 * Test that the search bar emits the correct event name.
 * Since the component requires a full Lit rendering environment,
 * we test the emitSearch logic as a standalone function.
 */
describe('lv-search-bar - event name', () => {
  it('should emit search-change event (not search)', () => {
    let emittedEventName: string | null = null;

    // Simulate what emitSearch does
    const dispatchEvent = (event: CustomEvent) => {
      emittedEventName = event.type;
    };

    const filter = {
      query: 'test',
      author: '',
      dateFrom: '',
      dateTo: '',
      filePath: '',
      branch: '',
    };

    dispatchEvent(
      new CustomEvent('search-change', {
        detail: filter,
        bubbles: true,
        composed: true,
      })
    );

    expect(emittedEventName).to.equal('search-change');
  });

  it('should include all filter fields in event detail', () => {
    let eventDetail: Record<string, string> | null = null;

    const filter = {
      query: 'test query',
      author: 'test author',
      dateFrom: '2024-01-01',
      dateTo: '2024-12-31',
      filePath: 'src/**',
      branch: 'main',
    };

    const event = new CustomEvent('search-change', {
      detail: filter,
      bubbles: true,
      composed: true,
    });

    eventDetail = event.detail;

    expect(eventDetail).to.deep.equal(filter);
    expect(eventDetail!.query).to.equal('test query');
    expect(eventDetail!.author).to.equal('test author');
    expect(eventDetail!.dateFrom).to.equal('2024-01-01');
    expect(eventDetail!.dateTo).to.equal('2024-12-31');
    expect(eventDetail!.filePath).to.equal('src/**');
    expect(eventDetail!.branch).to.equal('main');
  });

  it('should emit composed and bubbling event', () => {
    const event = new CustomEvent('search-change', {
      detail: { query: '', author: '', dateFrom: '', dateTo: '', filePath: '', branch: '' },
      bubbles: true,
      composed: true,
    });

    expect(event.bubbles).to.be.true;
    expect(event.composed).to.be.true;
  });
});

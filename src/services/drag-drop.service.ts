/**
 * Drag and Drop Service
 * Manages drag-and-drop operations across the application
 */

export type DragItemType = 'branch' | 'commit' | 'file';

export interface DragItem {
  type: DragItemType;
  data: unknown;
}

export type DropAction = 'merge' | 'rebase' | 'cherry-pick' | 'stage' | 'unstage';

export interface DropZone {
  element: HTMLElement;
  accepts: DragItemType[];
  action: DropAction;
  onDrop: (item: DragItem) => void;
}

class DragDropService {
  private currentDrag: DragItem | null = null;
  private dropZones: Set<DropZone> = new Set();
  private activeDropZone: DropZone | null = null;

  /**
   * Start a drag operation
   */
  startDrag(item: DragItem): void {
    this.currentDrag = item;
    document.body.classList.add('dragging');
    document.body.dataset.dragType = item.type;
  }

  /**
   * End the current drag operation
   */
  endDrag(): void {
    this.currentDrag = null;
    this.activeDropZone = null;
    document.body.classList.remove('dragging');
    delete document.body.dataset.dragType;
  }

  /**
   * Get the current drag item
   */
  getCurrentDrag(): DragItem | null {
    return this.currentDrag;
  }

  /**
   * Register a drop zone
   */
  registerDropZone(zone: DropZone): () => void {
    this.dropZones.add(zone);
    return () => this.dropZones.delete(zone);
  }

  /**
   * Check if a drop zone accepts the current drag
   */
  canDrop(zone: DropZone): boolean {
    if (!this.currentDrag) return false;
    return zone.accepts.includes(this.currentDrag.type);
  }

  /**
   * Set the active drop zone
   */
  setActiveDropZone(zone: DropZone | null): void {
    this.activeDropZone = zone;
  }

  /**
   * Get the active drop zone
   */
  getActiveDropZone(): DropZone | null {
    return this.activeDropZone;
  }

  /**
   * Execute a drop on the active zone
   */
  executeDrop(): boolean {
    if (!this.currentDrag || !this.activeDropZone) return false;
    if (!this.canDrop(this.activeDropZone)) return false;

    this.activeDropZone.onDrop(this.currentDrag);
    this.endDrag();
    return true;
  }

  /**
   * Create drag data for dataTransfer
   */
  createDragData(item: DragItem): string {
    return JSON.stringify(item);
  }

  /**
   * Parse drag data from dataTransfer
   */
  parseDragData(data: string): DragItem | null {
    try {
      return JSON.parse(data) as DragItem;
    } catch {
      return null;
    }
  }
}

// Singleton instance
export const dragDropService = new DragDropService();

/**
 * Helper to make an element draggable
 */
export function makeDraggable(
  element: HTMLElement,
  type: DragItemType,
  getData: () => unknown,
  options?: {
    onDragStart?: () => void;
    onDragEnd?: () => void;
  }
): () => void {
  const handleDragStart = (e: DragEvent) => {
    const item: DragItem = { type, data: getData() };
    e.dataTransfer?.setData('application/json', dragDropService.createDragData(item));
    e.dataTransfer!.effectAllowed = 'move';
    dragDropService.startDrag(item);
    options?.onDragStart?.();
    element.classList.add('dragging');
  };

  const handleDragEnd = () => {
    dragDropService.endDrag();
    options?.onDragEnd?.();
    element.classList.remove('dragging');
  };

  element.draggable = true;
  element.addEventListener('dragstart', handleDragStart);
  element.addEventListener('dragend', handleDragEnd);

  return () => {
    element.draggable = false;
    element.removeEventListener('dragstart', handleDragStart);
    element.removeEventListener('dragend', handleDragEnd);
  };
}

/**
 * Helper to make an element a drop zone
 */
export function makeDropZone(
  element: HTMLElement,
  accepts: DragItemType[],
  action: DropAction,
  onDrop: (item: DragItem) => void,
  options?: {
    onDragEnter?: () => void;
    onDragLeave?: () => void;
  }
): () => void {
  const zone: DropZone = { element, accepts, action, onDrop };

  const handleDragOver = (e: DragEvent) => {
    const currentDrag = dragDropService.getCurrentDrag();
    if (!currentDrag || !accepts.includes(currentDrag.type)) return;

    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
  };

  const handleDragEnter = (e: DragEvent) => {
    const currentDrag = dragDropService.getCurrentDrag();
    if (!currentDrag || !accepts.includes(currentDrag.type)) return;

    e.preventDefault();
    element.classList.add('drop-target');
    dragDropService.setActiveDropZone(zone);
    options?.onDragEnter?.();
  };

  const handleDragLeave = (e: DragEvent) => {
    // Only trigger if we're actually leaving the element
    if (element.contains(e.relatedTarget as Node)) return;

    element.classList.remove('drop-target');
    if (dragDropService.getActiveDropZone() === zone) {
      dragDropService.setActiveDropZone(null);
    }
    options?.onDragLeave?.();
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    element.classList.remove('drop-target');

    const data = e.dataTransfer?.getData('application/json');
    if (!data) return;

    const item = dragDropService.parseDragData(data);
    if (!item || !accepts.includes(item.type)) return;

    onDrop(item);
    dragDropService.endDrag();
  };

  const unregister = dragDropService.registerDropZone(zone);

  element.addEventListener('dragover', handleDragOver);
  element.addEventListener('dragenter', handleDragEnter);
  element.addEventListener('dragleave', handleDragLeave);
  element.addEventListener('drop', handleDrop);

  return () => {
    unregister();
    element.removeEventListener('dragover', handleDragOver);
    element.removeEventListener('dragenter', handleDragEnter);
    element.removeEventListener('dragleave', handleDragLeave);
    element.removeEventListener('drop', handleDrop);
  };
}

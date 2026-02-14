import { expect } from '@open-wc/testing';
import { dragDropService } from '../drag-drop.service.ts';
import type { DragItem, DropZone } from '../drag-drop.service.ts';

describe('drag-drop.service', () => {
  afterEach(() => {
    dragDropService.endDrag();
  });

  describe('dragDropService', () => {
    describe('startDrag / getCurrentDrag', () => {
      it('should return null when no drag is active', () => {
        expect(dragDropService.getCurrentDrag()).to.be.null;
      });

      it('should store the current drag item', () => {
        const item: DragItem = { type: 'branch', data: { name: 'main' } };
        dragDropService.startDrag(item);
        expect(dragDropService.getCurrentDrag()).to.deep.equal(item);
      });

      it('should add dragging class to body', () => {
        const item: DragItem = { type: 'commit', data: { oid: 'abc123' } };
        dragDropService.startDrag(item);
        expect(document.body.classList.contains('dragging')).to.be.true;
      });

      it('should set drag type on body dataset', () => {
        const item: DragItem = { type: 'file', data: { path: 'test.ts' } };
        dragDropService.startDrag(item);
        expect(document.body.dataset.dragType).to.equal('file');
      });
    });

    describe('endDrag', () => {
      it('should clear the current drag item', () => {
        dragDropService.startDrag({ type: 'branch', data: {} });
        dragDropService.endDrag();
        expect(dragDropService.getCurrentDrag()).to.be.null;
      });

      it('should remove dragging class from body', () => {
        dragDropService.startDrag({ type: 'branch', data: {} });
        dragDropService.endDrag();
        expect(document.body.classList.contains('dragging')).to.be.false;
      });

      it('should clear drag type from body dataset', () => {
        dragDropService.startDrag({ type: 'branch', data: {} });
        dragDropService.endDrag();
        expect(document.body.dataset.dragType).to.be.undefined;
      });

      it('should clear the active drop zone', () => {
        dragDropService.startDrag({ type: 'branch', data: {} });
        const zone: DropZone = {
          element: document.createElement('div'),
          accepts: ['branch'],
          action: 'merge',
          onDrop: () => {},
        };
        dragDropService.setActiveDropZone(zone);
        dragDropService.endDrag();
        expect(dragDropService.getActiveDropZone()).to.be.null;
      });
    });

    describe('registerDropZone', () => {
      it('should return an unregister function', () => {
        const zone: DropZone = {
          element: document.createElement('div'),
          accepts: ['branch'],
          action: 'merge',
          onDrop: () => {},
        };
        const unregister = dragDropService.registerDropZone(zone);
        expect(unregister).to.be.a('function');
        unregister();
      });
    });

    describe('canDrop', () => {
      it('should return false when no drag is active', () => {
        const zone: DropZone = {
          element: document.createElement('div'),
          accepts: ['branch'],
          action: 'merge',
          onDrop: () => {},
        };
        expect(dragDropService.canDrop(zone)).to.be.false;
      });

      it('should return true when drag type matches accepts', () => {
        dragDropService.startDrag({ type: 'branch', data: {} });
        const zone: DropZone = {
          element: document.createElement('div'),
          accepts: ['branch'],
          action: 'merge',
          onDrop: () => {},
        };
        expect(dragDropService.canDrop(zone)).to.be.true;
      });

      it('should return false when drag type does not match accepts', () => {
        dragDropService.startDrag({ type: 'commit', data: {} });
        const zone: DropZone = {
          element: document.createElement('div'),
          accepts: ['branch'],
          action: 'merge',
          onDrop: () => {},
        };
        expect(dragDropService.canDrop(zone)).to.be.false;
      });

      it('should work with multiple accepted types', () => {
        dragDropService.startDrag({ type: 'file', data: {} });
        const zone: DropZone = {
          element: document.createElement('div'),
          accepts: ['branch', 'file'],
          action: 'stage',
          onDrop: () => {},
        };
        expect(dragDropService.canDrop(zone)).to.be.true;
      });
    });

    describe('setActiveDropZone / getActiveDropZone', () => {
      it('should set and get the active drop zone', () => {
        const zone: DropZone = {
          element: document.createElement('div'),
          accepts: ['branch'],
          action: 'merge',
          onDrop: () => {},
        };
        dragDropService.setActiveDropZone(zone);
        expect(dragDropService.getActiveDropZone()).to.equal(zone);
      });

      it('should allow setting to null', () => {
        const zone: DropZone = {
          element: document.createElement('div'),
          accepts: ['branch'],
          action: 'merge',
          onDrop: () => {},
        };
        dragDropService.setActiveDropZone(zone);
        dragDropService.setActiveDropZone(null);
        expect(dragDropService.getActiveDropZone()).to.be.null;
      });
    });

    describe('executeDrop', () => {
      it('should return false when no drag is active', () => {
        expect(dragDropService.executeDrop()).to.be.false;
      });

      it('should return false when no active drop zone', () => {
        dragDropService.startDrag({ type: 'branch', data: {} });
        expect(dragDropService.executeDrop()).to.be.false;
      });

      it('should return false when type does not match', () => {
        dragDropService.startDrag({ type: 'commit', data: {} });
        const zone: DropZone = {
          element: document.createElement('div'),
          accepts: ['branch'],
          action: 'merge',
          onDrop: () => {},
        };
        dragDropService.setActiveDropZone(zone);
        expect(dragDropService.executeDrop()).to.be.false;
      });

      it('should call onDrop and return true on successful drop', () => {
        const item: DragItem = { type: 'branch', data: { name: 'feature' } };
        let droppedItem: DragItem | null = null;
        const zone: DropZone = {
          element: document.createElement('div'),
          accepts: ['branch'],
          action: 'merge',
          onDrop: (i) => { droppedItem = i; },
        };

        dragDropService.startDrag(item);
        dragDropService.setActiveDropZone(zone);
        const result = dragDropService.executeDrop();

        expect(result).to.be.true;
        expect(droppedItem).to.deep.equal(item);
      });

      it('should end drag after successful drop', () => {
        const item: DragItem = { type: 'branch', data: {} };
        const zone: DropZone = {
          element: document.createElement('div'),
          accepts: ['branch'],
          action: 'merge',
          onDrop: () => {},
        };

        dragDropService.startDrag(item);
        dragDropService.setActiveDropZone(zone);
        dragDropService.executeDrop();

        expect(dragDropService.getCurrentDrag()).to.be.null;
      });
    });

    describe('createDragData / parseDragData', () => {
      it('should serialize a drag item to JSON', () => {
        const item: DragItem = { type: 'branch', data: { name: 'main' } };
        const data = dragDropService.createDragData(item);
        expect(data).to.be.a('string');
        expect(JSON.parse(data)).to.deep.equal(item);
      });

      it('should parse valid JSON back to a drag item', () => {
        const item: DragItem = { type: 'commit', data: { oid: 'abc' } };
        const data = dragDropService.createDragData(item);
        const parsed = dragDropService.parseDragData(data);
        expect(parsed).to.deep.equal(item);
      });

      it('should return null for invalid JSON', () => {
        expect(dragDropService.parseDragData('not json')).to.be.null;
      });

      it('should return null for empty string', () => {
        expect(dragDropService.parseDragData('')).to.be.null;
      });
    });
  });
});

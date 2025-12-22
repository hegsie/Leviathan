import { create } from 'zustand';

export type PanelId = 'left' | 'right' | 'bottom';
export type ModalId = 'clone' | 'branch' | 'merge' | 'rebase' | 'settings' | 'conflict' | null;
export type ViewMode = 'graph' | 'list' | 'tree';

export interface PanelState {
  isVisible: boolean;
  width: number;
  isCollapsed: boolean;
}

export interface UIState {
  // Panels
  panels: Record<PanelId, PanelState>;

  // Modal
  activeModal: ModalId;
  modalData: unknown;

  // View settings
  viewMode: ViewMode;
  splitDiffMode: boolean;
  showLineNumbers: boolean;

  // Loading states
  globalLoading: boolean;
  loadingMessage: string | null;

  // Toasts
  toasts: Toast[];

  // Actions
  togglePanel: (panel: PanelId) => void;
  setPanelWidth: (panel: PanelId, width: number) => void;
  setPanelCollapsed: (panel: PanelId, collapsed: boolean) => void;
  openModal: (modal: ModalId, data?: unknown) => void;
  closeModal: () => void;
  setViewMode: (mode: ViewMode) => void;
  setSplitDiffMode: (split: boolean) => void;
  setShowLineNumbers: (show: boolean) => void;
  setGlobalLoading: (loading: boolean, message?: string) => void;
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

export interface Toast {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  duration?: number;
}

const defaultPanelState: Record<PanelId, PanelState> = {
  left: { isVisible: true, width: 250, isCollapsed: false },
  right: { isVisible: true, width: 350, isCollapsed: false },
  bottom: { isVisible: false, width: 200, isCollapsed: false },
};

export const useUIStore = create<UIState>((set) => ({
  panels: defaultPanelState,
  activeModal: null,
  modalData: null,
  viewMode: 'graph',
  splitDiffMode: true,
  showLineNumbers: true,
  globalLoading: false,
  loadingMessage: null,
  toasts: [],

  togglePanel: (panel) =>
    set((state) => ({
      panels: {
        ...state.panels,
        [panel]: {
          ...state.panels[panel],
          isVisible: !state.panels[panel].isVisible,
        },
      },
    })),

  setPanelWidth: (panel, width) =>
    set((state) => ({
      panels: {
        ...state.panels,
        [panel]: { ...state.panels[panel], width },
      },
    })),

  setPanelCollapsed: (panel, isCollapsed) =>
    set((state) => ({
      panels: {
        ...state.panels,
        [panel]: { ...state.panels[panel], isCollapsed },
      },
    })),

  openModal: (modal, data) => set({ activeModal: modal, modalData: data }),

  closeModal: () => set({ activeModal: null, modalData: null }),

  setViewMode: (viewMode) => set({ viewMode }),

  setSplitDiffMode: (splitDiffMode) => set({ splitDiffMode }),

  setShowLineNumbers: (showLineNumbers) => set({ showLineNumbers }),

  setGlobalLoading: (globalLoading, message) =>
    set({ globalLoading, loadingMessage: message ?? null }),

  addToast: (toast) =>
    set((state) => ({
      toasts: [
        ...state.toasts,
        { ...toast, id: `toast-${Date.now()}-${Math.random()}` },
      ],
    })),

  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
}));

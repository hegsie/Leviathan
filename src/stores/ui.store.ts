import { createStore } from 'zustand/vanilla';

export type PanelId = 'left' | 'right' | 'bottom';

export interface PanelState {
  isVisible: boolean;
  width: number;
  isCollapsed: boolean;
}

export interface UIState {
  // Panels
  panels: Record<PanelId, PanelState>;

  // Global loading
  globalLoading: boolean;

  // Toasts
  toasts: Toast[];

  // Actions
  togglePanel: (panel: PanelId) => void;
  setPanelWidth: (panel: PanelId, width: number) => void;
  setPanelCollapsed: (panel: PanelId, collapsed: boolean) => void;
  setGlobalLoading: (loading: boolean) => void;
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

export interface ToastAction {
  label: string;
  callback: () => void;
}

export interface Toast {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  duration?: number;
  action?: ToastAction;
}

const defaultPanelState: Record<PanelId, PanelState> = {
  left: { isVisible: true, width: 250, isCollapsed: false },
  right: { isVisible: true, width: 350, isCollapsed: false },
  bottom: { isVisible: false, width: 200, isCollapsed: false },
};

export const uiStore = createStore<UIState>((set) => ({
  panels: defaultPanelState,
  globalLoading: false,
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

  setGlobalLoading: (globalLoading) => set({ globalLoading }),

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

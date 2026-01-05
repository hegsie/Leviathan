/**
 * Notification Service
 * Handles native system notifications and in-app toast fallback
 */

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { uiStore, type ToastAction } from '../stores/ui.store.ts';

export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export interface NotificationOptions {
  title: string;
  body: string;
  type?: NotificationType;
  /** If true, only show as toast (no native notification) */
  toastOnly?: boolean;
  /** Toast duration in ms (default 5000) */
  duration?: number;
}

/**
 * Check if we have permission to send notifications
 */
export async function checkPermission(): Promise<boolean> {
  try {
    return await isPermissionGranted();
  } catch {
    return false;
  }
}

/**
 * Request permission to send notifications
 */
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    const permission = await requestPermission();
    return permission === 'granted';
  } catch {
    return false;
  }
}

/**
 * Show a notification (native if possible, toast fallback)
 */
export async function notify(options: NotificationOptions): Promise<void> {
  const { title, body, type = 'info', toastOnly = false, duration = 5000 } = options;

  // Always show as toast in-app
  uiStore.getState().addToast({
    type,
    message: `${title}: ${body}`,
    duration,
  });

  // Skip native notification if requested
  if (toastOnly) {
    return;
  }

  // Try to send native notification
  try {
    const hasPermission = await checkPermission();
    if (!hasPermission) {
      // Don't request permission automatically - user must opt-in
      return;
    }

    await sendNotification({
      title,
      body,
    });
  } catch (error) {
    // Native notification failed, toast already shown as fallback
    console.warn('Native notification failed:', error);
  }
}

/**
 * Convenience methods for different notification types
 */
export const notifySuccess = (title: string, body: string, toastOnly = false) =>
  notify({ title, body, type: 'success', toastOnly });

export const notifyError = (title: string, body: string, toastOnly = false) =>
  notify({ title, body, type: 'error', toastOnly });

export const notifyWarning = (title: string, body: string, toastOnly = false) =>
  notify({ title, body, type: 'warning', toastOnly });

export const notifyInfo = (title: string, body: string, toastOnly = false) =>
  notify({ title, body, type: 'info', toastOnly });

/**
 * Show a simple toast message (in-app only, no native notification)
 */
export function showToast(
  message: string,
  type: NotificationType = 'info',
  duration = 5000,
  action?: ToastAction
): void {
  uiStore.getState().addToast({ type, message, duration, action });
}

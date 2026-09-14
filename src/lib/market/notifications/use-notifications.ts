/**
 * Fires a browser Notification when a poll's results contain a transition
 * worth surfacing — see select.ts for the decision logic.
 *
 * Honest limitation, stated here because it is easy to oversell: this only
 * fires while the tab is open (foreground or backgrounded by the OS, per
 * browser policy). It is not a push notification and will not arrive if the
 * browser is closed. A real "arrives even when closed" notification needs a
 * service worker, VAPID keys, and a server-side trigger that runs on its own
 * schedule — which needs a scheduler this deployment does not have. Building
 * the client half without the ability to actually trigger it server-side
 * would be worse than not building it: it would look like background
 * notifications work when they cannot.
 */
import { useEffect, useRef } from "react";
import { selectNotifications, type NotifiableRow, type NotificationSettings } from "./select";
import type { SignalLabel } from "../domain/states";

export type NotificationPermissionState = "unsupported" | "default" | "granted" | "denied";

export function getNotificationPermission(): NotificationPermissionState {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

/** Must be called from a user gesture (a click), never automatically on load. */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  const result = await Notification.requestPermission();
  return result;
}

export function useSignalNotifications(
  rows: readonly NotifiableRow[],
  settings: NotificationSettings,
  enabled: boolean,
) {
  const previousLabels = useRef<Map<string, SignalLabel>>(new Map());

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    const localHour = new Date().getHours();
    const events = selectNotifications(previousLabels.current, rows, settings, localHour);

    for (const event of events) {
      try {
        new Notification(event.title, { body: event.body, tag: `${event.kind}:${event.symbol}` });
      } catch {
        // Some browsers restrict constructing Notification directly outside
        // a service worker in certain contexts; failing silently here is
        // preferable to breaking the page over a notification that could not
        // be shown.
      }
    }

    const next = new Map(previousLabels.current);
    for (const row of rows) next.set(row.symbol, row.label);
    previousLabels.current = next;
  }, [rows, settings, enabled]);
}

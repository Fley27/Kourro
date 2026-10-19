// expo-notifications → Web Notifications API.
//
// The shared app schedules: immediate banners (notifyLocal), a daily repeat
// (draft reminder, hour/minute) and a weekly repeat (Monday deficit review).
// The browser has no OS-level scheduler, so immediate notifications show
// right away and repeated triggers fire from a minute ticker while any tab
// of the app is open. Tapping a notification focuses the app and replays the
// stored `data.route` through the response listener.
type NotifContent = {
  title?: string;
  body?: string;
  sound?: string;
  data?: unknown;
};

type NotifTrigger =
  | null
  | {
      seconds?: number;
      hour?: number;
      minute?: number;
      weekday?: number;
      day?: number;
      repeats?: boolean;
    };

type NotifJob = {
  identifier: string;
  content: NotifContent;
  trigger: Exclude<NotifTrigger, null>;
  lastFiredMinute: string | null;
};

type ResponseListener = (response: {
  notification: {
    request: { identifier: string; content: { title?: string; data?: unknown } };
  };
}) => void;

let notificationHandler: { handleNotification: (n: unknown) => Promise<unknown> } | null = null;
const scheduledJobs = new Map<string, NotifJob>();
const jobsWithTimers = new Map<string, ReturnType<typeof setTimeout>>();
const responseListeners = new Set<ResponseListener>();
let tickerStarted = false;

function permissionsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

function permissionStatus(): "granted" | "denied" | "undetermined" {
  if (!permissionsSupported()) return "denied";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  return "undetermined";
}

export async function getPermissionsAsync(): Promise<{
  status: "granted" | "denied" | "undetermined";
  granted: boolean;
  canAskAgain: boolean;
  expires: "never";
}> {
  const status = permissionStatus();
  return {
    status,
    granted: status === "granted",
    canAskAgain: status === "undetermined",
    expires: "never",
  };
}

export async function requestPermissionsAsync(): Promise<{
  status: "granted" | "denied" | "undetermined";
  granted: boolean;
  canAskAgain: boolean;
  expires: "never";
}> {
  if (!permissionsSupported()) {
    return { status: "denied", granted: false, canAskAgain: false, expires: "never" };
  }
  try {
    const result = await Notification.requestPermission();
    return {
      status: result === "granted" ? "granted" : result === "denied" ? "denied" : "undetermined",
      granted: result === "granted",
      canAskAgain: result === "default",
      expires: "never",
    };
  } catch {
    return { status: "denied", granted: false, canAskAgain: false, expires: "never" };
  }
}

function showNotification(identifier: string, content: NotifContent): void {
  if (permissionStatus() !== "granted") return;
  try {
    const notification = new Notification(content.title ?? "", {
      body: content.body,
      tag: identifier,
      silent: false,
    });
    notification.onclick = () => {
      try {
        window.focus();
      } catch {
        /* focus is best-effort */
      }
      const routeData = content.data as { route?: unknown } | undefined;
      if (routeData?.route !== undefined) {
        const response = {
          notification: {
            request: { identifier, content: { title: content.title, data: content.data } },
          },
        };
        responseListeners.forEach((listener) => {
          try {
            listener(response);
          } catch {
            /* a bad listener must never break a tap */
          }
        });
      }
    };
  } catch {
    /* notification construction is best-effort */
  }
}

function minuteKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}-${date.getMinutes()}`;
}

function matchesTrigger(trigger: NotifJob["trigger"], date: Date): boolean {
  if (trigger.hour !== undefined && date.getHours() !== trigger.hour) return false;
  if (trigger.minute !== undefined && date.getMinutes() !== trigger.minute) return false;
  if (trigger.weekday !== undefined) {
    // expo-notifications: 1 = Sunday … 7 = Saturday (iOS convention).
    if (date.getDay() + 1 !== trigger.weekday) return false;
  }
  if (trigger.day !== undefined && date.getDate() !== trigger.day) return false;
  return true;
}

function startTicker(): void {
  if (tickerStarted) return;
  tickerStarted = true;
  setInterval(() => {
    const now = new Date();
    const key = minuteKey(now);
    scheduledJobs.forEach((job) => {
      if (job.lastFiredMinute === key) return;
      if (matchesTrigger(job.trigger, now)) {
        job.lastFiredMinute = key;
        showNotification(job.identifier, job.content);
      }
    });
  }, 30_000);
}

export async function scheduleNotificationAsync(request: {
  identifier?: string;
  content: NotifContent;
  trigger: NotifTrigger;
}): Promise<string> {
  const identifier = request.identifier ?? `web-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const trigger = request.trigger;
  if (trigger === null || trigger === undefined) {
    showNotification(identifier, request.content);
    return identifier;
  }
  if (trigger.seconds !== undefined && !trigger.repeats) {
    const timer = setTimeout(() => {
      jobsWithTimers.delete(identifier);
      scheduledJobs.delete(identifier);
      showNotification(identifier, request.content);
    }, Math.max(0, trigger.seconds) * 1000);
    jobsWithTimers.set(identifier, timer);
    return identifier;
  }
  scheduledJobs.set(identifier, {
    identifier,
    content: request.content,
    trigger,
    lastFiredMinute: null,
  });
  startTicker();
  return identifier;
}

export async function cancelScheduledNotificationAsync(identifier: string): Promise<void> {
  const timer = jobsWithTimers.get(identifier);
  if (timer !== undefined) {
    clearTimeout(timer);
    jobsWithTimers.delete(identifier);
  }
  scheduledJobs.delete(identifier);
}

export async function cancelAllScheduledNotificationsAsync(): Promise<void> {
  jobsWithTimers.forEach((timer) => clearTimeout(timer));
  jobsWithTimers.clear();
  scheduledJobs.clear();
}

export function setNotificationHandler(handler: {
  handleNotification: (n: unknown) => Promise<unknown>;
}): void {
  notificationHandler = handler;
}

export function addNotificationResponseReceivedListener(listener: ResponseListener): {
  remove: () => void;
} {
  responseListeners.add(listener);
  return {
    remove(): void {
      responseListeners.delete(listener);
    },
  };
}

export async function getLastNotificationResponseAsync(): Promise<null> {
  // Taps are delivered through the live notification.onclick handler; there
  // is no persisted cold-start response on web.
  return null;
}

export async function dismissAllNotificationsAsync(): Promise<void> {
  /* no-op */
}

export async function getPresentedNotificationsAsync(): Promise<never[]> {
  return [];
}

export const AndroidImportance = { MIN: 1, LOW: 2, DEFAULT: 3, HIGH: 4, MAX: 5 } as const;
export const SchedulableTriggerInputTypes = {} as Record<string, string>;

export default {
  getPermissionsAsync,
  requestPermissionsAsync,
  scheduleNotificationAsync,
  cancelScheduledNotificationAsync,
  cancelAllScheduledNotificationsAsync,
  setNotificationHandler,
  addNotificationResponseReceivedListener,
  getLastNotificationResponseAsync,
  dismissAllNotificationsAsync,
  getPresentedNotificationsAsync,
};

void notificationHandler;

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: { "content-type": "application/json", "x-move30": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: unknown = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const d = (data || {}) as { error?: string; code?: string };
    throw new ApiError(res.status, d.error || `Request failed (${res.status})`, d.code);
  }
  return data as T;
}

export const get = <T,>(p: string) => api<T>("GET", p);
export const post = <T,>(p: string, b?: unknown) => api<T>("POST", p, b ?? {});
export const put = <T,>(p: string, b?: unknown) => api<T>("PUT", p, b ?? {});
export const patch = <T,>(p: string, b?: unknown) => api<T>("PATCH", p, b ?? {});
export const del = <T,>(p: string, b?: unknown) => api<T>("DELETE", p, b ?? {});

export type Accent = "neutral" | "violet" | "blue" | "green" | "amber" | "orange" | "coral" | "rose";

export interface Settings {
  interval: 20 | 30 | 45 | 60;
  workStart: string;
  workEnd: string;
  enforceWorkHours: boolean;
  dailyGoal: number;
  workdays: number[];
  timezone: string;
  chime: boolean;
  notifications: boolean;
  locked: boolean;
}

export interface Me {
  user: { id: string; name: string; email: string; role: "member" | "admin"; hasPassword: boolean; team: { id: string; name: string } | null };
  org: { name: string; slug: string; accent: Accent; logoUrl: string | null; ssoEnabled: boolean };
  settings: Settings;
}

export interface DayStat { day: string; breaks: number; minutes: number }
export interface Summary { today: DayStat; series: DayStat[] }

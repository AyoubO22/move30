import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import Toast from "@/components/arc/toast/toast";
import { ApiError, get, type Me } from "./api";

interface SessionValue {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setMe: (me: Me | null) => void;
  toast: (title: string, description?: string) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ id: number; title: string; description?: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setMe(await get<Me>("/me"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setMe(null);
      else throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh().catch(() => setLoading(false)); }, [refresh]);

  // Organization branding: accent color for the whole UI.
  useEffect(() => {
    document.documentElement.setAttribute("data-accent", me?.org.accent || "green");
  }, [me?.org.accent]);

  const toast = useCallback((title: string, description?: string) => {
    setNotice({ id: Date.now(), title, description });
  }, []);

  return (
    <SessionContext.Provider value={{ me, loading, refresh, setMe, toast }}>
      {children}
      {notice && (
        <div className="toast-host" key={notice.id}>
          <Toast title={notice.title} description={notice.description} open onOpenChange={(o) => { if (!o) setNotice(null); }} />
        </div>
      )}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const v = useContext(SessionContext);
  if (!v) throw new Error("useSession outside provider");
  return v;
}

/** Runs an async action and reports failures as a toast. */
export function useAction() {
  const { toast } = useSession();
  return useCallback(async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    try {
      const r = await fn();
      if (success) toast(success);
      return r;
    } catch (err) {
      toast("Couldn't do that", err instanceof Error ? err.message : String(err));
      return undefined;
    }
  }, [toast]);
}

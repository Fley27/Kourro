import { create } from "zustand";
import { supabase } from "./supabase";
import type { Admin } from "./types";

type AuthState = {
  status: "loading" | "signedout" | "signedin";
  admin: Admin | null;
  accessToken: string | null;
  error: string | null;
  init: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
  setAccessToken: (token: string | null) => void;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  status: "loading",
  admin: null,
  accessToken: null,
  error: null,

  setAccessToken: (token) => set({ accessToken: token }),

  init: async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? null;
    if (!token) {
      set({ status: "signedout", admin: null, accessToken: null });
      return;
    }
    set({ accessToken: token });
    try {
      const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("unauthorized");
      const body = await res.json();
      set({ status: "signedin", admin: body.admin, accessToken: token });
    } catch {
      await supabase.auth.signOut();
      set({ status: "signedout", admin: null, accessToken: null });
    }
  },

  signIn: async (email, password) => {
    set({ error: null });
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) {
      set({ error: error.message });
      return { ok: false, error: error.message };
    }
    const token = data.session?.access_token ?? null;
    set({ accessToken: token });
    try {
      const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const message = body?.error ?? "This account cannot access the admin portal.";
        set({ status: "signedout", admin: null, accessToken: null, error: message });
        await supabase.auth.signOut();
        return { ok: false, error: message };
      }
      const body = await res.json();
      set({ status: "signedin", admin: body.admin, accessToken: token });
      return { ok: true };
    } catch {
      set({ status: "signedout", admin: null, accessToken: null });
      return { ok: false, error: "Could not reach the admin API." };
    }
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ status: "signedout", admin: null, accessToken: null, error: null });
    void get();
  },
}));

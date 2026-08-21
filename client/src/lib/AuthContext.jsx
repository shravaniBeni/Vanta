/**
 * client/src/lib/AuthContext.jsx
 *
 * Phase 6: Real Supabase authentication context.
 * Replaces the Phase 1–5 stub that always returned isAuthenticated: true.
 *
 * Exposes:
 *   user            — Supabase User object or null
 *   session         — Supabase Session object or null
 *   loading         — true while initial session is being checked
 *   isAuthenticated — true when session is valid
 *   signIn(email, password)  → { error }
 *   signUp(email, password)  → { error }
 *   signOut()
 */

import React, { createContext, useContext, useEffect, useState } from 'react';
import supabase from './supabaseClient.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get initial session (handles page reload / token refresh)
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Subscribe to all auth state changes (sign-in, sign-out, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        // Only clear loading after the first event fires if we were still loading
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signUp = async (email, password) => {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{
      user,
      session,
      loading,
      isAuthenticated: !!session,
      signIn,
      signUp,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

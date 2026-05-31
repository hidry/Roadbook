/**
 * Supabase client (README §3). Auth + Postgres/RLS live here; binary photo data
 * goes to R2 instead (README §2.3, §9). The client is configured for React
 * Native: URL polyfill + AsyncStorage-backed session persistence.
 */
import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Fail loud in dev: a misconfigured backend silently breaks auth + sync.
  console.warn(
    '[supabase] EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY missing. ' +
      'Copy .env.example to .env and fill in your local `supabase start` values.',
  );
}

export const supabase = createClient(supabaseUrl ?? 'http://127.0.0.1:54321', supabaseAnonKey ?? 'public-anon-key', {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // RN has no URL to parse the session from; tokens come via the SDK.
    detectSessionInUrl: false,
  },
});

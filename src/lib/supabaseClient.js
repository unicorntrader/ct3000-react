import { createClient } from '@supabase/supabase-js'

// Vite reads envs via import.meta.env. The vite.config.js envPrefix list
// also exposes REACT_APP_ during the CRA-to-Vite transition so a project
// whose env vars are still named the old way keeps working until the
// names are flipped on Vercel.
const env = import.meta.env
const supabaseUrl = env.VITE_SUPABASE_URL || env.REACT_APP_SUPABASE_URL
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || env.REACT_APP_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase env vars not set. Auth will not function.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

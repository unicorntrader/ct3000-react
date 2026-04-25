import { createClient } from '@supabase/supabase-js'

// Vite reads envs via import.meta.env. Variables must be VITE_-prefixed
// at build time to be embedded in the client bundle.
const env = import.meta.env
const supabaseUrl = env.VITE_SUPABASE_URL
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase env vars not set. Auth will not function.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

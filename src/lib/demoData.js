import { supabase } from './supabaseClient'

export async function seedDemoData() {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch('/api/seed-demo', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${session.access_token}` },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to seed demo data')
  return data
}

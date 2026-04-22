// Public endpoint — intentionally no auth. Returns the maintenance_mode
// flag that ct3000-admin writes via its Settings screen. The browser
// checks this on every app load (and on window focus) so the admin can
// toggle the app offline without needing a deploy.
//
// Fail-open: if the DB read errors, return { active: false } so a Supabase
// hiccup doesn't lock every user out of their own app.
const supabaseAdmin = require('./_lib/supabaseAdmin')

module.exports = async function handler(req, res) {
  // Short edge cache — users see toggle-flips within ~30s without
  // hammering Supabase on cold reloads. No client-side cache so a
  // reload after admin toggles off unblocks immediately.
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60')
  res.setHeader('Access-Control-Allow-Origin', '*')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { data, error } = await supabaseAdmin
      .from('app_settings')
      .select('value')
      .eq('key', 'maintenance_mode')
      .maybeSingle()

    if (error) throw error
    return res.status(200).json({ active: data?.value === 'true' })
  } catch (err) {
    console.error('[maintenance-status] read failed:', err?.message || err)
    return res.status(200).json({ active: false })
  }
}

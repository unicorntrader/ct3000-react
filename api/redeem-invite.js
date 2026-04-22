const supabaseAdmin = require('./lib/supabaseAdmin')

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { token, email, password } = req.body || {}
  if (!token || !email || !password) {
    return res.status(400).json({ error: 'Missing token, email, or password' })
  }

  // Look up invite
  const { data: invite, error: lookupErr } = await supabaseAdmin
    .from('invited_users')
    .select('*')
    .eq('token', token)
    .maybeSingle()

  if (lookupErr || !invite || invite.redeemed_at) {
    return res.status(400).json({ error: 'This invite link is invalid or has already been used' })
  }

  // Validate email matches invite
  if (invite.email.toLowerCase() !== email.toLowerCase()) {
    return res.status(400).json({ error: `This invite is for ${invite.email} — please use that email address` })
  }

  // Create auth user
  const { data: { user }, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (createErr) {
    if (createErr.message.toLowerCase().includes('already')) {
      return res.status(400).json({ error: 'An account with this email already exists. Please log in instead.' })
    }
    console.error('[redeem-invite] createUser error:', createErr.message)
    return res.status(500).json({ error: createErr.message })
  }

  // Create subscription — match the shape ct3000-admin's compAction writes
  // for "Forever" comps so every comped user looks identical in the DB
  // (status=active, is_comped=true, both date fields pinned to 2099). Keeps
  // the admin dashboard's is_comped aggregation + period display consistent
  // regardless of whether the comp came from Grant-comp-Forever or an invite.
  const FOREVER = '2099-01-01T00:00:00.000Z'
  const { error: subErr } = await supabaseAdmin.from('user_subscriptions').insert({
    user_id: user.id,
    subscription_status: 'active',
    is_comped: true,
    current_period_ends_at: FOREVER,
    trial_ends_at: FOREVER,
  })
  if (subErr) {
    console.error('[redeem-invite] subscription insert error:', subErr.message)
    // SUPPORT EMAIL: update when support@cotraderapp.com mailbox is live.
    return res.status(500).json({ error: 'Account created but subscription setup failed. Please email thinker@philoinvestor.com.' })
  }

  // Mark invite as redeemed
  const { error: redeemErr } = await supabaseAdmin.from('invited_users').update({
    redeemed_at: new Date().toISOString(),
    redeemed_by: user.id,
  }).eq('token', token)
  if (redeemErr) {
    console.error('[redeem-invite] failed to mark invite redeemed:', redeemErr.message)
    // Don't fail the user — account + subscription are created. Log and continue.
  }

  console.log('[redeem-invite] success — email:', email, '| userId:', user.id)
  return res.status(200).json({ success: true })
}

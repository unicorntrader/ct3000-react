import React from 'react';
import { Link } from 'react-router-dom';
import { SUPPORT_EMAIL } from '../lib/constants';

/**
 * Privacy Policy — public route at /privacy.
 *
 * ---------------------------------------------------------------------
 *   NEEDS LEGAL REVIEW BEFORE PUBLIC LAUNCH
 *
 *   Placeholder copy based on GDPR-compliant SaaS patterns. Data
 *   controller is Philo Holdings Ltd (Cyprus). Subprocessors listed:
 *   Supabase, Vercel, Stripe, Sentry, IBKR. If any subprocessor
 *   changes, update this file.
 *
 *   TODO (pre-public-launch): build the 90-day cleanup job for
 *   account_deletions so the retention promise below actually holds.
 * ---------------------------------------------------------------------
 */
export default function PrivacyScreen() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <Link to="/" className="text-sm text-blue-600 hover:text-blue-800 inline-flex items-center gap-1 mb-6">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </Link>

        <h1 className="text-3xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-500 mb-8">Last updated: 22 April 2026</p>

        <div className="prose prose-sm max-w-none text-gray-700 space-y-6">

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">1. Who is responsible for your data</h2>
            <p>
              The data controller for the CT3000 service is <strong>Philo Holdings Ltd</strong>,
              a company registered in Cyprus with its registered office at
              Agiou Neofytou 21Α, Archangelos, 2334 Nicosia, Cyprus.
            </p>
            <p>
              For privacy questions, contact us at{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-blue-600 hover:underline">
                {SUPPORT_EMAIL}
              </a>.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">2. What data we collect</h2>
            <p>We collect and process the following categories of data:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <strong>Account data:</strong> email address, hashed password.
              </li>
              <li>
                <strong>Trading data from IBKR:</strong> trade executions, positions,
                account ID, base currency — imported via Interactive Brokers' Flex
                Query service using credentials you provide.
              </li>
              <li>
                <strong>Content you create:</strong> trade plans, journal notes,
                playbooks, weekly reviews.
              </li>
              <li>
                <strong>Billing data:</strong> handled entirely by Stripe. We receive
                a Stripe customer ID and subscription status; we do not see or store
                your card details.
              </li>
              <li>
                <strong>Technical data:</strong> IP address, browser type, session
                cookie, error logs. Collected automatically for security and
                service operation.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">3. Why we use your data</h2>
            <p>We use your data to:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Provide the Service (import trades, display analytics, save your notes)</li>
              <li>Authenticate you and keep your account secure</li>
              <li>Process payments and manage your subscription</li>
              <li>Diagnose and fix errors (via our error tracker, Sentry)</li>
              <li>Communicate with you about the Service (support, service updates)</li>
              <li>Comply with legal obligations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">4. Legal basis (GDPR)</h2>
            <p>We process your data on the following legal bases:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <strong>Contract:</strong> processing is necessary to provide the
                Service you signed up for.
              </li>
              <li>
                <strong>Legitimate interest:</strong> security, fraud prevention,
                and error diagnostics.
              </li>
              <li>
                <strong>Legal obligation:</strong> compliance with tax, accounting,
                and regulatory requirements.
              </li>
              <li>
                <strong>Consent:</strong> where specifically requested (e.g. optional
                marketing communications — currently none).
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">5. Who we share data with</h2>
            <p>
              We share your data only with the service providers (subprocessors)
              required to operate CT3000. Each has been vetted for GDPR compliance.
            </p>
            <table className="w-full text-sm border border-gray-200 rounded-lg overflow-hidden my-4">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-gray-700">Provider</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-700">Purpose</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-700">Location</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                <tr>
                  <td className="px-3 py-2">Supabase</td>
                  <td className="px-3 py-2">Database + authentication</td>
                  <td className="px-3 py-2">EU / US</td>
                </tr>
                <tr>
                  <td className="px-3 py-2">Vercel</td>
                  <td className="px-3 py-2">Application hosting</td>
                  <td className="px-3 py-2">US (with EU edge)</td>
                </tr>
                <tr>
                  <td className="px-3 py-2">Stripe</td>
                  <td className="px-3 py-2">Payment processing</td>
                  <td className="px-3 py-2">US / EU</td>
                </tr>
                <tr>
                  <td className="px-3 py-2">Sentry</td>
                  <td className="px-3 py-2">Error tracking</td>
                  <td className="px-3 py-2">US / EU</td>
                </tr>
                <tr>
                  <td className="px-3 py-2">Interactive Brokers</td>
                  <td className="px-3 py-2">Trade data source (you initiate)</td>
                  <td className="px-3 py-2">Global</td>
                </tr>
              </tbody>
            </table>
            <p>
              We do not sell your data to anyone. We do not share it with advertisers
              or marketing networks.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">6. International data transfers</h2>
            <p>
              Some of our subprocessors (e.g. Vercel, Stripe) store data in the
              United States. Where applicable, we rely on Standard Contractual Clauses
              approved by the European Commission to ensure adequate protection.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">7. How long we keep your data</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <strong>Active account:</strong> we keep your data for as long as
                your account is active.
              </li>
              <li>
                <strong>After deletion:</strong> when you delete your account, we
                remove all user-owned records (trades, plans, notes, credentials,
                subscription) immediately. Identifying metadata retained for churn
                analysis (email, Stripe customer ID) is stripped after 90 days.
                Anonymous feedback from the deletion form may be retained
                indefinitely in aggregate form.
              </li>
              <li>
                <strong>Billing records:</strong> retained for up to 7 years as
                required by tax and accounting law.
              </li>
              <li>
                <strong>Error logs (Sentry):</strong> retained for up to 90 days.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">8. Your rights under GDPR</h2>
            <p>As an EU/EEA resident (or one covered by similar laws), you have the right to:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Access the personal data we hold about you</li>
              <li>Correct inaccurate data</li>
              <li>Delete your data ("right to erasure") — available in-app via Settings</li>
              <li>Restrict or object to our processing</li>
              <li>Receive your data in a portable format</li>
              <li>Withdraw consent at any time (where processing is based on consent)</li>
              <li>Lodge a complaint with the Office of the Commissioner for Personal Data Protection in Cyprus</li>
            </ul>
            <p>
              To exercise any of these rights, email us at{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-blue-600 hover:underline">
                {SUPPORT_EMAIL}
              </a>. We respond within 30 days.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">9. Cookies</h2>
            <p>CT3000 uses a small number of cookies and browser storage items:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <strong>Authentication (Supabase):</strong> strictly necessary —
                keeps you logged in. Cannot be disabled.
              </li>
              <li>
                <strong>Error tracking (Sentry):</strong> session identifiers used
                to correlate crashes. No cross-site tracking.
              </li>
              <li>
                <strong>UI preferences (localStorage):</strong> tiny settings like
                "TradeSquares collapsed/expanded." Local to your browser.
              </li>
            </ul>
            <p>
              We do not use analytics, advertising, marketing, or cross-site
              tracking cookies. Because we only use strictly necessary and
              operational cookies, we do not currently display a consent banner.
              Your browser settings allow you to delete cookies at any time.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">10. Security</h2>
            <p>
              We use encryption in transit (HTTPS), at rest (provider-managed
              encryption), and industry-standard authentication. Access to production
              data is restricted to authorised personnel. We cannot guarantee absolute
              security — no online service can — but we take reasonable steps to
              protect your information.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">11. Children</h2>
            <p>
              CT3000 is not intended for users under 18. We do not knowingly collect
              data from minors. If you believe we have, contact us and we will
              delete it.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">12. Changes to this policy</h2>
            <p>
              We may update this Privacy Policy from time to time. Material changes
              will be announced via email or in-app notification. The "last updated"
              date at the top of this page reflects the most recent revision.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">13. Contact</h2>
            <p>
              Privacy questions:{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-blue-600 hover:underline">
                {SUPPORT_EMAIL}
              </a>.
            </p>
            <p className="text-xs text-gray-500 mt-4">
              Philo Holdings Ltd · Agiou Neofytou 21Α, Archangelos · 2334 Nicosia · Cyprus
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

import React from 'react';
import { Link } from 'react-router-dom';
import { SUPPORT_EMAIL } from '../lib/constants';

/**
 * Terms of Service — public route at /terms.
 *
 * ---------------------------------------------------------------------
 *   NEEDS LEGAL REVIEW BEFORE PUBLIC LAUNCH
 *
 *   Drafted as reasonable, readable placeholder copy for the private
 *   BETA. Based on standard SaaS patterns, not reviewed by a solicitor.
 *   Before public launch: run this past a lawyer familiar with
 *   EU/Cyprus consumer contract law and financial-tools liability.
 * ---------------------------------------------------------------------
 *
 * Contracting party: Philo Holdings Ltd (Cyprus).
 * Governing law: Cyprus / EU.
 * Kept at 18+ minimum age.
 */
export default function TermsScreen() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <Link to="/" className="text-sm text-blue-600 hover:text-blue-800 inline-flex items-center gap-1 mb-6">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </Link>

        <h1 className="text-3xl font-bold text-gray-900 mb-2">Terms of Service</h1>
        <p className="text-sm text-gray-500 mb-8">Last updated: 22 April 2026</p>

        <div className="prose prose-sm max-w-none text-gray-700 space-y-6">

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">1. Who we are</h2>
            <p>
              CT3000 (the "Service") is operated by <strong>Philo Holdings Ltd</strong>,
              a company registered in Cyprus. Our registered address is
              Agiou Neofytou 21Α, Archangelos, 2334 Nicosia, Cyprus.
              Throughout these Terms, "we", "us", and "our" refer to Philo Holdings Ltd.
            </p>
            <p>
              By creating an account or using the Service, you agree to these Terms.
              If you do not agree, do not use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">2. Eligibility</h2>
            <p>
              You must be at least <strong>18 years old</strong> to use the Service.
              By signing up, you confirm that you meet this requirement and that you
              have the legal capacity to enter into these Terms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">3. What the Service does</h2>
            <p>
              CT3000 is a trading journal and analytics tool. It connects to your
              Interactive Brokers account via IBKR's Flex Query service, imports your
              executed trades, and provides features for journaling, planning,
              reviewing, and analysing your trading activity.
            </p>
            <p>
              <strong>The Service does not execute trades on your behalf.</strong>
              We read your trade data from IBKR; we never submit orders.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">4. Disclaimers — please read carefully</h2>
            <p>
              <strong>Not financial advice.</strong> Nothing in the Service constitutes
              investment advice, financial advice, trading advice, or any other form
              of advice. The insights, callouts, scores, and analytics are
              informational only. You are solely responsible for your trading
              decisions and their outcomes.
            </p>
            <p>
              <strong>Data accuracy.</strong> We rely on Interactive Brokers' Flex Query
              feed. IBKR's data may lag, contain errors, or omit transactions. Do not
              rely on CT3000 as the authoritative record of your trading activity —
              always verify with your broker statements.
            </p>
            <p>
              <strong>Past performance.</strong> Past trading performance does not
              guarantee future results. Historical statistics displayed in the
              Service are for reflection only.
            </p>
            <p>
              <strong>Software provided "as is".</strong> The Service is provided on
              an "as-is" and "as-available" basis. We make no warranties of any kind,
              express or implied, including fitness for a particular purpose,
              accuracy, or uninterrupted availability. During private beta,
              expect bugs and downtime.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">5. Your account</h2>
            <p>
              You are responsible for safeguarding your account credentials and for
              all activity under your account. Notify us immediately at{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-blue-600 hover:underline">
                {SUPPORT_EMAIL}
              </a>{' '}
              if you suspect unauthorised access.
            </p>
            <p>
              You may delete your account at any time from Settings. Deletion is
              permanent and removes all your data. If you have an active subscription,
              you must cancel it through the billing portal before deletion.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">6. Billing</h2>
            <p>
              The Service is offered as a paid subscription. New users receive a
              7-day free trial. After the trial, your card is charged at the stated
              monthly rate unless you cancel. Billing is handled by Stripe; we
              never store your card details.
            </p>
            <p>
              You can cancel your subscription at any time through the billing
              portal (Settings → Manage subscription). Cancellation takes effect
              at the end of your current billing period; no refunds for partial months.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">7. Your data</h2>
            <p>
              Your trades, plans, notes, and related data belong to you. We process
              them only to provide the Service. See our{' '}
              <Link to="/privacy" className="text-blue-600 hover:underline">
                Privacy Policy
              </Link>{' '}
              for details on what we collect and how we handle it.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">8. Acceptable use</h2>
            <p>You agree not to:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Use the Service to violate any law or regulation</li>
              <li>Reverse engineer, scrape, or attempt to access unauthorised parts of the Service</li>
              <li>Share your account with third parties</li>
              <li>Use the Service in a way that disrupts it for other users</li>
              <li>Upload or submit content that infringes intellectual property rights</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">9. Limitation of liability</h2>
            <p>
              To the fullest extent permitted by law, Philo Holdings Ltd will not be
              liable for any indirect, incidental, special, consequential, or
              punitive damages, including loss of profits, data, trading losses,
              or goodwill, arising from your use of the Service.
            </p>
            <p>
              Our total aggregate liability under these Terms, for any claim, will
              not exceed the amount you paid us in the twelve (12) months preceding
              the claim.
            </p>
            <p>
              Nothing in these Terms excludes liability that cannot be excluded
              under applicable law (including your statutory rights as a consumer
              under EU law).
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">10. Changes to these Terms</h2>
            <p>
              We may update these Terms from time to time. If we make material
              changes, we will notify you by email or through the Service. Continued
              use after changes take effect means you accept the updated Terms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">11. Governing law</h2>
            <p>
              These Terms are governed by the laws of the Republic of Cyprus.
              Any disputes arising from these Terms or your use of the Service
              will be subject to the exclusive jurisdiction of the courts of Cyprus,
              unless otherwise required by mandatory consumer protection law in your
              jurisdiction.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">12. Contact</h2>
            <p>
              Questions about these Terms? Email us at{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-blue-600 hover:underline">
                {SUPPORT_EMAIL}
              </a>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

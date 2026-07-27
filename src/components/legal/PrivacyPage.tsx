const LAST_UPDATED = '2026-07-27'

export function PrivacyPage() {
  return (
    <main className="min-h-full overflow-y-auto bg-theme-bg px-5 py-10 text-theme-text sm:px-8">
      <article className="mx-auto max-w-3xl">
        <a
          href="/"
          className="mb-8 inline-flex text-sm font-medium text-theme-accent hover:underline"
        >
          ← Back to Dicesuki
        </a>

        <header className="mb-10">
          <h1 className="text-3xl font-bold sm:text-4xl">Privacy Policy</h1>
          <p className="mt-3 text-sm text-theme-text-muted">
            Last updated: {LAST_UPDATED}
          </p>
        </header>

        <div className="space-y-8 leading-7 text-theme-text-secondary">
          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              About this policy
            </h2>
            <p>
              This policy explains how Dicesuki, a 3D dice simulator available
              at{' '}
              <a
                href="https://dicesuki.vercel.app"
                className="text-theme-accent hover:underline"
              >
                dicesuki.vercel.app
              </a>
              , handles information. Dicesuki is operated by an individual
              developer. In this policy, “we” and “us” refer to that operator.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Information we collect
            </h2>
            <p>
              Accounts are optional. In guest mode, Dicesuki stores your data
              only in your browser using localStorage. That guest data is not
              stored on our servers.
            </p>
            <p className="mt-3">
              If you sign in, Discord OAuth via Supabase provides us with your
              Discord user ID, username, avatar, and email. For signed-in users,
              we store your profile (display name, avatar, and dice color),
              settings, dice inventory and collection, saved rolls, economy
              records (currency balances, ledger history, pull history, and
              entitlements), and payment order records in Supabase Postgres.
              Row-level security limits signed-in users to their own rows.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Multiplayer and technical data
            </h2>
            <p>
              During multiplayer sessions, our room servers relay transient
              gameplay data such as dice positions, room membership, and display
              names. Server logs also include technical identifiers used to run
              and troubleshoot the service.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Payments
            </h2>
            <p>
              Xsolla processes payments as Merchant of Record and handles
              payment details, taxes, refunds, and chargebacks under its own
              terms and privacy policy. We never receive or store card numbers.
              We store order and transaction references needed to fulfill and
              keep a record of purchases. You can review{' '}
              <a
                href="https://xsolla.com/legal-documents"
                className="text-theme-accent hover:underline"
              >
                Xsolla&apos;s legal documents
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              How we use information
            </h2>
            <p>
              We use this information to provide accounts, sync settings and
              collections, run multiplayer rooms, save rolls, operate the
              virtual economy, fulfill purchases, maintain the service, prevent
              abuse, and troubleshoot problems.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Services we rely on
            </h2>
            <p>
              Discord and Supabase provide sign-in and account infrastructure,
              Supabase stores signed-in account data, and Xsolla processes
              payments. Those services handle information under their own terms
              and privacy policies. Dicesuki has no ads, does not sell personal
              data, and does not use third-party analytics.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Retention and deletion
            </h2>
            <p>
              Economy ledger and payment history are append-only by design and
              are kept as immutable audit history. You may request account
              deletion by emailing us. Deleting an authentication account
              removes or leaves unassociated the account&apos;s own-row personal
              data, subject to audit records that must be kept for payment
              history.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Children
            </h2>
            <p>
              Dicesuki is not directed at children under 13. Users must also
              meet the minimum age required to use Discord in their region.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Changes to this policy
            </h2>
            <p>
              We may update this policy as Dicesuki changes. When we do, we will
              update the date at the top of this page.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Contact and deletion requests
            </h2>
            <p>
              For privacy questions or account deletion requests, email{' '}
              <a
                href="mailto:donovanyohan@gmail.com"
                className="text-theme-accent hover:underline"
              >
                donovanyohan@gmail.com
              </a>
              .
            </p>
          </section>
        </div>

        <p className="mt-12 border-t border-white/10 pt-6 text-sm text-theme-text-muted">
          These documents are provided for transparency and may be updated as the
          service evolves.
        </p>
      </article>
    </main>
  )
}

export default PrivacyPage

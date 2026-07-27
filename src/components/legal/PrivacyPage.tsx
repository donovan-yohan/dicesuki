const LAST_UPDATED = '2026-07-27'
const POLICY_VERSION = '1.0'

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
          <p className="text-sm text-theme-text-muted">Policy version: {POLICY_VERSION}</p>
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
              When you sign in through Discord OAuth via Supabase, we receive
              your Discord ID, username, avatar, and email. We also keep the
              profile and settings you choose, your inventory and saved rolls,
              and economy records such as balances, ledger entries, pull history,
              entitlements, and subscription status.
            </p>
            <p className="mt-3">
              From Xsolla we receive transaction metadata: an order ID, product,
              amount, and timestamp. We do not receive card numbers, CVV, or
              billing address. Xsolla collects that payment information as
              Merchant of Record under{' '}
              <a
                href="https://xsolla.com/legal-documents"
                className="text-theme-accent hover:underline"
              >
                its own privacy policy
              </a>
              . Our transient server logs can include your IP address, request
              headers, and instance IDs.
            </p>
            <p className="mt-3">
              We have no advertising, ad identifiers, analytics SDKs, tracking,
              profiling, or AI-training use of personal information. We do not
              sell or share personal information, including as those terms are
              used in the CCPA.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Guest mode and multiplayer visibility
            </h2>
            <p>
              In guest mode, all guest data stays in your browser&apos;s localStorage;
              it does not reach our servers. In a multiplayer room, your display
              name and dice activity are visible to other people in that room.
              The public room registry exposes a room&apos;s name and player count.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Where information comes from
            </h2>
            <p>
              Information comes from you, Discord when you sign in, and Xsolla
              when it reports a transaction outcome. We do not collect it from
              other sources.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              How we use information
            </h2>
            <p>
              We use information to provide and sync the game; operate the gacha
              economy; preserve the immutable ledger as a fairness and audit
              record; grant purchases; run multiplayer; prevent fraud and abuse;
              respond to support and legal requests; and comply with law.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Legal bases for processing
            </h2>
            <p>
              Where the GDPR applies, we process information to perform our
              contract with you, for our legitimate interests in security,
              anti-abuse work, and ledger integrity, and to meet legal
              obligations.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Who receives information
            </h2>
            <p>
              Supabase processes database and authentication information for us
              and enforces own-row access with row-level security. Vercel
              processes hosting and CDN traffic. Xsolla is an independent
              controller and Merchant of Record for payments. We may also disclose
              information to authorities when lawfully required or to a successor
              in a business transfer. Processor transfers are covered by their
              data processing agreements, which incorporate standard contractual
              clauses where applicable.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Retention and deletion
            </h2>
            <p>
              We keep account data while your account exists. To request deletion,
              email us using the manual process below. On deletion, we erase your
              profile, inventory, and saved rolls. We retain append-only purchase
              and economy ledger rows for two years in pseudonymized form,
              unlinked from your Discord identity, to prevent fraud, support
              refunds and chargebacks, and maintain financial records. Deleting an
              account forfeits its virtual items.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Your privacy rights
            </h2>
            <p>
              Email us to request access or an export, correction, deletion,
              objection, or restriction of processing. You may also complain
              directly to a supervisory authority. We aim to respond within 30
              days where the GDPR applies and within 45 days for applicable CCPA
              requests. A deletion request ends your virtual item licenses as
              described above.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Children
            </h2>
            <p>
              Dicesuki is not directed to children under 13 and we do not
              knowingly collect their personal information. If we discover that
              we have done so, we will delete it. Purchases require the age of
              majority in the user&apos;s jurisdiction or parental consent.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Security
            </h2>
            <p>
              We use TLS for connections, row-level security so users can access
              only their own rows, and Discord OAuth rather than stored passwords.
              Card and other payment-instrument data never reaches our systems.
              The append-only ledger helps prevent tampering with purchase records.
              No system is perfectly secure, but we will notify affected people of
              a breach without undue delay when required.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Cookies and local storage
            </h2>
            <p>
              We use only strictly necessary storage for your authentication
              session and local preferences. We do not use advertising or
              analytics cookies, so no cookie consent banner is needed or shown.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Changes to this policy
            </h2>
            <p>
              We may update this policy as Dicesuki changes. We will publish an
              effective date and version with each update, and give affirmative
              notice for a material change.
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

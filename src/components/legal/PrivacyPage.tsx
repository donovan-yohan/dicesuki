import { Link } from 'react-router-dom'
import { LEGAL_DOCUMENT_VERSION, LEGAL_LAST_UPDATED } from './legalMeta'

export function PrivacyPage() {
  return (
    <main className="w-full h-full overflow-y-auto bg-theme-bg px-5 py-10 text-theme-text sm:px-8">
      <article className="mx-auto max-w-3xl">
        <Link
          to="/"
          className="mb-8 inline-flex text-sm font-medium text-theme-accent hover:underline"
        >
          ← Back to Dicesuki
        </Link>

        <header className="mb-10">
          <h1 className="text-3xl font-bold sm:text-4xl">Privacy Policy</h1>
          <p className="mt-3 text-sm text-theme-text-muted">
            Last updated: {LEGAL_LAST_UPDATED}
          </p>
          <p className="text-sm text-theme-text-muted">
            Policy version: {LEGAL_DOCUMENT_VERSION}
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
                target="_blank"
                rel="noopener noreferrer"
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
              In guest mode, nothing is stored in our database and solo play stays
              entirely in your browser. Joining a multiplayer room transmits your
              display name and dice activity to the room server transiently; they
              are not stored in our database. Your display name and dice activity
              are visible to other people in that room. The public server registry
              exposes server instance metadata, including its public URL, name,
              player counts, and heartbeat. The room browser lists only rooms made
              public (rooms are unlisted by default); neither surface exposes
              personal data beyond room and display names.
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
              processes hosting and CDN traffic. Self-operated multiplayer room
              servers receive display names, dice activity, IP addresses, and
              request headers for multiplayer sessions; their logs are transient
              and they are not part of Supabase or Vercel. Xsolla is an
              independent controller and Merchant of Record for payments. We may
              also disclose information to authorities when lawfully required or
              to a successor in a business transfer. We rely on our processors&apos;
              standard data processing terms, which incorporate standard
              contractual clauses where applicable.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Retention and deletion
            </h2>
            <p>
              Deletion requests are handled manually via the contact email below.
              We delete your profile, settings, inventory, and saved rolls.
              Append-only economy and payment records are retained as immutable
              audit history required for fraud prevention and payment-dispute
              support and cannot be altered. We remove the link between those
              records and your Discord identity where technically possible.
              Deleting an account forfeits its virtual items.
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
              We may update this policy as Dicesuki changes. Updates will be
              posted on this page with a new effective date; for material changes
              affecting purchases, we will make reasonable efforts to notify
              signed-in users (for example, in-app or via the email on your
              account).
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

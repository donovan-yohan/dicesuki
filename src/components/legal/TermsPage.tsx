import { Link } from 'react-router-dom'
import { LEGAL_DOCUMENT_VERSION, LEGAL_LAST_UPDATED } from './legalMeta'

export function TermsPage() {
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
          <h1 className="text-3xl font-bold sm:text-4xl">Terms of Service</h1>
          <p className="mt-3 text-sm text-theme-text-muted">
            Last updated: {LEGAL_LAST_UPDATED}
          </p>
          <p className="text-sm text-theme-text-muted">Terms version: {LEGAL_DOCUMENT_VERSION}</p>
        </header>

        <div className="space-y-8 leading-7 text-theme-text-secondary">
          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              About Dicesuki
            </h2>
            <p>
              Dicesuki is a 3D dice simulator web app available at{' '}
              <a
                href="https://dicesuki.vercel.app"
                className="text-theme-accent hover:underline"
              >
                dicesuki.vercel.app
              </a>
              . It is operated by an individual developer. In these terms, “we”
              and “us” refer to that operator. These terms describe the rules for
              using Dicesuki.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Eligibility and accounts
            </h2>
            <p>
              You must be at least 13 to use Dicesuki and meet any minimum age
              required to use Discord where you live. Guest mode is available
              without an account, but guests cannot make purchases. Real-money
              purchases are available only to people who are the age of majority
              in their jurisdiction or who have parental consent.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Virtual items and purchases
            </h2>
            <p>
              Stars, roll tickets, Dust, collectible dice, and other virtual
              items are a limited, personal, revocable, non-transferable license
              to use Dicesuki features. They are not property, have no cash
              value, and can never be redeemed for money. We keep an immutable,
              append-only record of what you acquire so the economy can be
              audited honestly.
            </p>
            <p className="mt-3">
              Real-money purchases are not yet available; the store currently
              operates in a test (sandbox) mode.
            </p>
            <p className="mt-3">
              You may not sell, resell, gift, trade, or otherwise transfer
              virtual items or accounts, except where Dicesuki explicitly
              permits it. We may rebalance, modify, or discontinue virtual items
              and their rates as the service develops. If an economy change is
              material, we will provide advance notice and an effective date.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Randomized content and published odds
            </h2>
            <p>
              Before you buy randomized content, Dicesuki will show the current
              odds and guarantee thresholds (sometimes called “pity”) in the
              product. Those published base rates are authoritative; server-owned
              pity rules can only increase effective chances. No particular
              outcome is promised unless it is part of a stated guarantee. After
              reveal, we disclose the commitment root, seed, and per-result
              nonces so outcomes can be independently checked.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Payments and Merchant of Record
            </h2>
            <p>
              Xsolla is the seller and Merchant of Record for every real-money
              transaction. Xsolla&apos;s terms govern payment processing, tax,
              refunds, and chargebacks; Dicesuki&apos;s terms govern only the
              in-game license layer. We never receive your card details. See{' '}
              <a
                href="https://xsolla.com/legal-documents"
                target="_blank"
                rel="noopener noreferrer"
                className="text-theme-accent hover:underline"
              >
                Xsolla&apos;s legal documents
              </a>{' '}
              for its terms and policies.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Refunds and payment disputes
            </h2>
            <p>
              If Xsolla refunds a purchase or a chargeback reverses it, we remove
              the credited value with a compensating ledger entry. Your balance
              can become negative if that value has already been spent, and paid
              features may be limited until the balance is restored. Raising a
              good-faith payment dispute does not by itself lock your account or
              forfeit unrelated purchases. We may handle fraud or abuse
              separately.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Lunar Pass subscriptions
            </h2>
            <p>
              When the Lunar Pass becomes available for purchase, its renewal
              term and price will be shown at purchase. Cancellation will take
              effect at the end of the current period. Daily Stars are
              claim-or-lose: if you do not claim a day, that day&apos;s Stars are
              forfeited and are not refunded.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Acceptable use
            </h2>
            <p>
              Do not exploit the client, room servers, economy endpoints, or
              bugs; automate pulls; attempt unauthorized access; or abuse,
              harass, or harm other players. Please report an exploit instead of
              using or sharing it. Enforcement may include warnings, suspension,
              or termination, applied proportionately. Immediate termination is
              reserved for a material breach, as explained below.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Availability, termination, and service sunset
            </h2>
            <p>
              Features may be unavailable in some jurisdictions, including paid
              randomized content, and may change or be interrupted. We may end
              an account immediately only for a material breach, such as
              cheating, exploits, or fraud. Ending an account ends its virtual
              item licenses and forfeits those items. If Dicesuki ever shuts
              down, we will give reasonable advance notice and a wind-down period
              for purchased balances.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Disclaimers, liability, and resolving concerns
            </h2>
            <p>
              Dicesuki is provided “as is” and “as available,” to the extent the
              law allows. To that same extent, we are not liable for indirect,
              incidental, special, consequential, punitive, or lost-profit
              damages. Our total liability for a claim is limited to the amounts
              you paid for Dicesuki through Xsolla in the 12 months before the
              claim. Please contact us first; we ask for 60 days to try to resolve
              a concern informally before formal action. Nothing in these terms
              limits a consumer right or liability that cannot legally be limited
              by contract.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Changes to these terms
            </h2>
            <p>
              We may update these terms as Dicesuki changes. Updates will be
              posted on this page with a new effective date; for material changes
              affecting purchases, we will make reasonable efforts to notify
              signed-in users (for example, in-app or via the email on your
              account). Continued use alone is not our acceptance mechanism for a
              material change.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Other legal terms
            </h2>
            <p>
              If one part of these terms is unenforceable, the rest remains in
              effect. These terms, and provisions that by their nature should
              continue, survive termination. Notices may be sent by email or
              shown in the app. You may not assign these terms or your account;
              we may assign them as part of operating, restructuring, or
              transferring Dicesuki.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Contact
            </h2>
            <p>
              Questions about these terms can be sent to{' '}
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

export default TermsPage

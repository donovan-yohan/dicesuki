const LAST_UPDATED = '2026-07-27'

export function TermsPage() {
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
          <h1 className="text-3xl font-bold sm:text-4xl">Terms of Service</h1>
          <p className="mt-3 text-sm text-theme-text-muted">
            Last updated: {LAST_UPDATED}
          </p>
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
              and “us” refer to that operator. By using Dicesuki, you agree to
              these terms.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Eligibility and accounts
            </h2>
            <p>
              Accounts are optional. You can use guest mode without an account,
              in which case your data stays locally in your browser. If you sign
              in, authentication is provided through Discord OAuth via Supabase.
              Dicesuki is not directed at children under 13, and you must also
              meet the minimum age required to use Discord in your region.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Virtual items and purchases
            </h2>
            <p>
              Stars, Dust, roll tickets, collectible dice, and other virtual
              items are limited licenses to use features in Dicesuki. They are
              not property, have no cash value, are non-transferable, and cannot
              be redeemed for money. We may adjust the virtual economy as the
              service evolves. Purchases of randomized content will show odds
              where required.
            </p>
            <p className="mt-3">
              Payments are processed by Xsolla as Merchant of Record. Xsolla
              handles payment details, taxes, refunds, and chargebacks under its
              own terms and privacy policy. We do not receive or store card
              numbers. Refunds are handled according to the point-of-sale terms
              and applicable law. See{' '}
              <a
                href="https://xsolla.com/legal-documents"
                className="text-theme-accent hover:underline"
              >
                Xsolla&apos;s legal documents
              </a>{' '}
              for more information.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Acceptable use
            </h2>
            <p>
              Do not cheat, exploit bugs, interfere with gameplay, abuse other
              users or the service, attempt unauthorized access, or use Dicesuki
              in a way that harms the service or anyone using it. If you find an
              exploit, please report it instead of using or sharing it.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Availability and changes
            </h2>
            <p>
              Dicesuki may change, experience interruptions, or stop offering
              particular features. The service is provided “as is” and “as
              available,” without warranties to the extent permitted by law.
              We may suspend or terminate access when someone abuses the service
              or violates these terms.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Limitation of liability
            </h2>
            <p>
              To the extent permitted by law, we are not liable for indirect,
              incidental, special, consequential, or punitive damages, or for
              lost data, access, or profits arising from your use of Dicesuki.
              Nothing in these terms limits rights or liability that cannot
              legally be limited.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Changes to these terms
            </h2>
            <p>
              We may update these terms as Dicesuki changes. When we do, we will
              update the date at the top of this page. Continuing to use the
              service after an update means you accept the revised terms.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-theme-text">
              Severability
            </h2>
            <p>
              If any part of these terms is found unenforceable, the remaining
              parts will continue to apply.
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

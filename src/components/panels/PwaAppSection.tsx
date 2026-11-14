import { useRef, useSyncExternalStore } from 'react'
import { dismissPwaInstall, getPwaInstall, promptPwaInstall, subscribePwaInstall } from '../../lib/pwaInstall'
import { deferServiceWorkerUpdate, getServiceWorkerUpdate, readUpdateBlock, requestServiceWorkerUpdate, subscribeServiceWorkerUpdate } from '../../lib/swUpdate'

const buttonClass = 'min-h-11 rounded-md border px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50'
export function PwaAppSection() {
  const install = useSyncExternalStore(subscribePwaInstall, getPwaInstall)
  const update = useSyncExternalStore(subscribeServiceWorkerUpdate, getServiceWorkerUpdate)
  const heading = useRef<HTMLHeadingElement>(null)
  const installButton = useRef<HTMLButtonElement>(null)
  const safe = !readUpdateBlock()
  const invitation = window.top === window.self && !install.installed && safe
  const education = invitation && install.eligible && !install.dismissed
  const dismiss = () => { dismissPwaInstall(); heading.current?.focus() }
  return (
    <section className="mb-8 space-y-3 text-sm" aria-labelledby="pwa-app-heading" style={{ color: 'var(--color-text-primary)' }}>
      <h3 id="pwa-app-heading" ref={heading} tabIndex={-1} className="text-sm font-semibold">App</h3>
      <p className="text-xs">Solo play works offline after loading. Optional dice assets need an online visit first.</p>
      {education && (install.native || install.ios) && <p className="font-semibold">{install.ios && !install.native ? 'Add Dicesuki to your Home Screen' : 'Keep Dicesuki handy'}</p>}
      {education && install.native && <p>Install for quick access to your dice table.</p>}
      {education && install.ios && !install.native && <p>Tap Share, then Add to Home Screen.</p>}
      {invitation && install.native && <button type="button" ref={installButton} className={buttonClass} onClick={() => {
        void promptPwaInstall().finally(() => (installButton.current ?? heading.current)?.focus())
      }}>Install Dicesuki</button>}
      {education && (install.native || install.ios) && <button type="button" className={`${buttonClass} ml-2`} onClick={dismiss}>Not now</button>}
      {update.available && <div className="space-y-2" aria-live="polite">
        <p className="font-semibold">Update ready</p>
        <p>{update.message ?? 'Reload to use the latest version.'}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} disabled={!safe || update.busy} onClick={requestServiceWorkerUpdate}>{update.busy ? 'Updating…' : 'Update now'}</button>
          <button type="button" className={buttonClass} disabled={update.busy} onClick={() => { deferServiceWorkerUpdate(); heading.current?.focus() }}>Later</button>
        </div>
      </div>}
      {!update.available && update.message?.startsWith('Update couldn’t') && <p role="status">{update.message}</p>}
    </section>
  )
}

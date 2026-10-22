import type { Creature } from '../../lib/monsterManual/types'

export function CreatureSourceFooter({ source }: { source: Creature['source'] }) {
  return <footer role="contentinfo" aria-label="Creature sources" className="flex flex-wrap gap-x-3 gap-y-1 border-t border-theme-border pt-3 text-xs text-theme-text-secondary">
    {([['Source', source.url], [source.license, source.licenseUrl], ['Attribution', source.noticeUrl]] as const).map(([label, href]) =>
      <a key={label} className="field-focus-ring rounded underline underline-offset-2" href={href} target="_blank" rel="noopener noreferrer">{label}</a>)}
  </footer>
}

import symbol from '../../assets/brand/paramrig-coform-symbol.svg?raw'
import wordmark from '../../assets/brand/paramrig-wordmark.svg?raw'

type MarkProps = {
  className?: string
  title?: string
}

export function CoformSymbol({ className }: MarkProps) {
  return <span className={className} aria-hidden="true" dangerouslySetInnerHTML={{ __html: symbol }} />
}

export function Wordmark({ className }: MarkProps) {
  return <span className={className} dangerouslySetInnerHTML={{ __html: wordmark }} />
}

export function Lockup({ className }: MarkProps) {
  return (
    <span className={`brand-lockup ${className ?? ''}`.trim()}>
      <CoformSymbol className="brand-lockup__symbol" />
      <Wordmark className="brand-lockup__word" />
    </span>
  )
}

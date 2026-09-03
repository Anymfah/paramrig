/**
 * The one polite live region an editor page keeps: whatever text it is given is read out, and
 * nothing else on the page has to be a live region. What to say is each editor's business.
 */
export function LiveRegion({ message, name = 'editor' }: { message: string; name?: string }) {
  return (
    <p className="visually-hidden" role="status" aria-live="polite" data-announce={name}>
      {message}
    </p>
  )
}

/**
 * The library card for a connected web project.
 *
 * A web project is somebody else's page, running on their own development server and framed
 * cross-origin: there is nothing to draw here, and nothing that could be drawn without opening it.
 * So the mark says what the card is rather than pretending to a picture — a page, framed, with one
 * element picked out the way the workspace picks one out.
 */
export function WebProjectMark() {
  return (
    <svg viewBox="0 0 320 200" aria-hidden="true">
      <rect width="320" height="200" fill="#E8EBE2" />
      <rect x="36" y="36" width="248" height="128" rx="8" fill="#F4F3EB" stroke="#C8CCC0" />
      <path d="M36 60h248" stroke="#C8CCC0" />
      {[52, 64, 76].map((x) => <circle key={x} cx={x} cy="48" r="3" fill="#C8CCC0" />)}
      <rect x="60" y="80" width="96" height="8" rx="4" fill="#C8CCC0" />
      <rect x="60" y="98" width="140" height="6" rx="3" fill="#DCDFD6" />
      <rect x="60" y="112" width="116" height="6" rx="3" fill="#DCDFD6" />
      <rect x="188" y="76" width="72" height="64" rx="6" fill="none" stroke="#8CBDA8" strokeWidth="2" />
      <rect x="188" y="76" width="72" height="64" rx="6" fill="#8CBDA8" opacity="0.16" />
    </svg>
  )
}

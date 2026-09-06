import { useEffect, useState } from 'react'
import { connectWeb } from '../sdk'
import { type WebProjectManifest } from '../contracts'

function Arrow() { return <svg data-paramrig-id="story-arrow" aria-label="Read story arrow" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M8 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" /></svg> }
export function Demo({ manifest }: { manifest: WebProjectManifest }) {
  const [menu, setMenu] = useState(false)
  const [font, setFont] = useState('Georgia')
  const [title, setTitle] = useState('Make room for the outside.')
  const journal = location.pathname.includes('journal')
  useEffect(() => {
    const connection = connectWeb({ manifest, adapters: {
      headingFont: { read: () => 'Georgia', apply: v => setFont(String(v)), restore: () => setFont('Georgia') },
      heroCopy: { read: () => 'Make room for the outside.', apply: v => setTitle(String(v)), restore: () => setTitle('Make room for the outside.') },
    } })
    return () => connection.dispose()
  }, [manifest])
  return <div className="fn-page" data-paramrig-id="page" data-paramrig-source="src/web/example/Demo.tsx">
    <nav className="fn-nav" aria-label="Fieldnotes navigation"><a className="fn-brand" href="/examples/web/index.html">fieldnotes.</a><a href="/examples/web/journal.html">The journal</a><div className="fn-menu"><button type="button" data-paramrig-id="menu-button" aria-expanded={menu} onClick={() => setMenu(v => !v)}>Explore</button>{menu ? <div className="fn-menu-panel"><a href="/examples/web/index.html">Home</a><a href="/examples/web/journal.html">Journal</a><button type="button" onClick={() => setMenu(false)}>Close menu</button></div> : null}</div></nav>
    <section className="fn-hero" data-paramrig-id="hero"><div className="fn-hero-copy"><span className="fn-kicker">{journal ? 'Notes from the trail' : 'A journal for a slower pace'}</span><h1 data-paramrig-id="hero-title" style={{ fontFamily: font }}>{journal ? 'A little further from ordinary.' : title}</h1><p>Stories from quiet trails, open skies, and the places that remind us to pay attention.</p><a data-paramrig-id="hero-button" className="fn-link" href={journal ? '/examples/web/index.html' : '/examples/web/journal.html'}>{journal ? 'Back to fieldnotes' : 'Find your next story'}<Arrow /></a></div>
      <figure className="fn-figure"><div className="fn-art"><svg viewBox="0 0 400 500" role="img" aria-label="Sun over layered hills, with a path winding to the summit"><rect width="400" height="500" fill="#d8d9be" /><circle cx="265" cy="115" r="43" fill="#d79b6b" /><path d="M0 330 90 180 150 260 245 155 400 300V500H0Z" fill="#8c9b83" /><path d="m0 345 100-80 130 100 80-60 90 45v150H0Z" fill="#586f5e" /><path d="M0 440q90-180 215-35T400 340v160H0Z" fill="#344f42" /><path d="M210 500q-90-80 5-125t-8-73" stroke="#cbd1b7" strokeWidth="10" fill="none" /></svg></div><figcaption className="fn-caption">{journal ? 'Above the treeline, late September' : 'The long way round, drawn from memory'}</figcaption></figure>
    </section>
    <div className="fn-section-head"><h2 style={{ fontFamily: font }}>From the journal</h2><span className="fn-eyebrow">Two stories</span></div>
    <section className="fn-stories" aria-label="Stories">{[{ id: 'coast', title: 'Following the coastline', text: 'A walk with no destination, only the sound of water and a path that keeps unfolding.' }, { id: 'forest', title: 'The shape of a quiet morning', text: 'On familiar trails, the smallest details are often the ones worth coming back for.' }].map((story, i) => <article className="fn-card" key={story.id} data-paramrig-id="story-card" data-paramrig-instance={story.id}><span className="fn-kicker">0{i + 1} / Field notes</span><h2 data-paramrig-id="story-title" style={{ fontFamily: font }}>{story.title}</h2><p>{story.text}</p><a data-paramrig-id="story-link" href="/examples/web/journal.html">Read the story<Arrow /></a></article>)}</section>
    <section className="fn-reading"><h2 style={{ fontFamily: font }}>The pocket notebook</h2><p>Six lines kept on the back page, copied out whenever the book is replaced.</p><div className="fn-scroll" data-paramrig-id="notebook" tabIndex={0} aria-label="Scrollable notebook">{['Pack light. Leave space for what you find.', 'Take the route that gives you time to notice.', 'Stop for a while. A landscape is more than a view.', 'Remember the weather, the colors, the way back.', 'Some days the best plan is a longer walk.', 'Bring these notes home, then go outside again.'].map((line, i) => <p key={line} data-paramrig-id="notebook-line" data-paramrig-instance={String(i)}>{line}</p>)}</div></section>
    <footer className="fn-colophon"><span>Fieldnotes — an outdoor journal</span><span>A ParamRig example page</span></footer>
  </div>
}

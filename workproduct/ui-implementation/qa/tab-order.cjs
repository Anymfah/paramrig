async (page) => {
  await page.evaluate(() => {
    const skip = document.querySelector('.skip-link')
    if (skip instanceof HTMLElement) skip.blur()
    document.body.tabIndex = -1
    document.body.focus()
  })
  const names = []
  for (let i = 0; i < 90; i += 1) {
    await page.keyboard.press('Tab')
    const info = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body) return { tag: 'BODY', name: '', outline: '' }
      const labelled = el.getAttribute('aria-labelledby')
      const fromId = labelled ? document.getElementById(labelled)?.textContent : ''
      const label =
        el.getAttribute('aria-label') ||
        fromId ||
        (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : '') ||
        el.textContent ||
        ''
      return {
        tag: el.tagName,
        role: el.getAttribute('role'),
        name: label.replace(/\s+/g, ' ').trim().slice(0, 72),
        outline: getComputedStyle(el).outline,
      }
    })
    names.push(info)
    if (i > 2 && info.name && names[0].name && info.name === names[0].name && info.tag === names[0].tag) {
      names.pop()
      break
    }
  }
  return { count: names.length, first: names[0], last: names[names.length - 1], names }
}

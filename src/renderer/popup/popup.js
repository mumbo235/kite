// Renders whatever the main UI sends; reports clicks and its height back.
const list = document.getElementById('list')
const pop = document.querySelector('.pop')
let lastShown = 0

window.popup.onRender(({ html, vars, fresh }) => {
  for (const [k, v] of Object.entries(vars || {})) document.documentElement.style.setProperty(k, v)
  list.innerHTML = html
  for (const img of list.querySelectorAll('img')) {
    img.addEventListener('error', () => {
      const fb = img.dataset.fallback
      if (fb) img.outerHTML = fb
      else img.remove()
    })
  }
  if (fresh) {
    pop.classList.remove('enter')
    void pop.offsetWidth
    pop.classList.add('enter')
  }
  window.popup.size(Math.ceil(document.body.getBoundingClientRect().height))
  const auto = list.querySelector('[autofocus]')
  if (auto && fresh) {
    auto.focus()
    auto.select?.()
  }
})

// Form mode (the bookmark box): fields take the keyboard, choice rows pick
// a value, submitting sends the values back to the browser UI.
const sizeNow = () => window.popup.size(Math.ceil(document.body.getBoundingClientRect().height))
function choose(row) {
  const group = row.closest('[data-choices]')
  if (!group) return
  group.querySelectorAll('[data-choose].on').forEach((r) => r.classList.remove('on'))
  row.classList.add('on')
  const input = document.querySelector(`input[name="${group.dataset.choices}"]`)
  if (input) input.value = row.dataset.choose
  // a row can reveal extra fields (e.g. "New folder…" shows a name box)
  for (const el of document.querySelectorAll('[data-reveal-for]')) {
    const [name, value] = el.dataset.revealFor.split('=')
    if (name === group.dataset.choices) el.hidden = row.dataset.choose !== value
  }
  const reveal = document.querySelector(`[data-reveal-for="${group.dataset.choices}=${row.dataset.choose}"] input`)
  reveal?.focus()
  sizeNow()
}
list.addEventListener('submit', (e) => {
  e.preventDefault()
  window.popup.pick('form:' + JSON.stringify(Object.fromEntries(new FormData(e.target))), false)
})
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.popup.pick('esc', false)
})

list.addEventListener('mousedown', (e) => {
  // typing fields keep normal behavior (focus, caret, selection)
  if (e.target.closest('input, textarea')) return
  const c = e.target.closest('[data-choose]')
  if (c) {
    e.preventDefault()
    return choose(c)
  }
  if (e.target.closest('button[type="submit"]')) {
    e.preventDefault()
    return e.target.closest('form')?.requestSubmit()
  }
  e.preventDefault()
  // buttons with an action (downloads dropdown) win over the row they're in
  const act = e.target.closest('[data-act]')
  if (act) return window.popup.pick(act.dataset.act, false)
  const row = e.target.closest('[data-i]')
  if (row) window.popup.pick(+row.dataset.i, e.ctrlKey || e.button === 1)
})

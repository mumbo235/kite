// Find-in-page bar.
import { api, $, h } from './main.js'
import { icon } from './icons.js'

let input, count

export function renderFindbar() {
  const bar = $('#findbar')
  bar.innerHTML = `<input class="input" placeholder="Find in page" spellcheck="false"><span class="count"></span>
    <button class="icon-btn sm" data-d="prev" title="Previous (Shift+Enter)">${icon('chevronLeft')}</button>
    <button class="icon-btn sm" data-d="next" title="Next (Enter)">${icon('chevronRight')}</button>
    <label class="muted" style="display:flex;gap:6px;align-items:center;font-size:12px;margin-left:6px"><input type="checkbox" data-case> Match case</label>
    <div class="spacer"></div><button class="icon-btn sm" data-d="close" title="Close (Esc)">${icon('x')}</button>`
  input = bar.querySelector('input')
  count = bar.querySelector('.count')
  const matchCase = bar.querySelector('[data-case]')
  const run = (findNext, forward = true) => api.call('find.run', input.value, { findNext, forward, matchCase: matchCase.checked })
  input.addEventListener('input', () => {
    if (!input.value) count.textContent = ''
    run(false)
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') run(true, !e.shiftKey)
    if (e.key === 'Escape') close()
  })
  matchCase.onchange = () => run(false)
  bar.addEventListener('click', (e) => {
    const d = e.target.closest('[data-d]')?.dataset.d
    if (d === 'close') close()
    else if (d) run(true, d === 'next')
  })
}

function close() {
  $('#findbar').classList.add('hidden')
  api.call('find.stop')
  api.call('nav.focusPage')
}

// Called with no args to open, or with a result object from main.
export function showFind(result) {
  const bar = $('#findbar')
  if (result && typeof result.matches === 'number') {
    count.textContent = input.value ? `${result.active}/${result.matches}` : ''
    return
  }
  bar.classList.remove('hidden')
  input.focus()
  input.select()
  if (input.value) api.call('find.run', input.value, { findNext: false })
}

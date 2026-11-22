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
})

list.addEventListener('mousedown', (e) => {
  e.preventDefault()
  const row = e.target.closest('[data-i]')
  if (row) window.popup.pick(+row.dataset.i, e.ctrlKey || e.button === 1)
})

import { useEffect } from 'react'

/** Bind a keyboard shortcut, ignoring keystrokes aimed at inputs. */
export function useHotkey(combo, handler, { allowInInput = false } = {}) {
  useEffect(() => {
    const parts = combo.toLowerCase().split('+')
    const needMod = parts.includes('mod')
    const needShift = parts.includes('shift')
    const key = parts[parts.length - 1]

    const onKey = (event) => {
      const target = event.target
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (typing && !allowInInput) return
      const mod = event.metaKey || event.ctrlKey
      if (needMod && !mod) return
      if (!needMod && mod) return
      if (needShift && !event.shiftKey) return
      if (event.key.toLowerCase() !== key) return
      event.preventDefault()
      handler(event)
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [combo, handler, allowInInput])
}

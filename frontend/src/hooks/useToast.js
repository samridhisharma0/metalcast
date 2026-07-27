import { createContext, createElement, useCallback, useContext, useMemo, useRef, useState } from 'react'

const ToastContext = createContext({ toasts: [], push: () => {}, dismiss: () => {} })

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const counter = useRef(0)

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const push = useCallback(
    (toast) => {
      counter.current += 1
      const id = counter.current
      const entry = { id, tone: 'info', ttl: 5000, ...toast }
      setToasts((list) => [...list.slice(-3), entry])
      if (entry.ttl > 0) setTimeout(() => dismiss(id), entry.ttl)
      return id
    },
    [dismiss],
  )

  const value = useMemo(() => ({ toasts, push, dismiss }), [toasts, push, dismiss])
  return createElement(ToastContext.Provider, { value }, children)
}

export function useToast() {
  return useContext(ToastContext)
}

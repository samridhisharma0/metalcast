import { createContext, createElement, useCallback, useContext, useMemo, useState } from 'react'

const AUTH_KEY = 'metalcast.user'
const AuthContext = createContext({ user: null, login: () => {}, signup: () => {}, logout: () => {} })

function loadUser() {
  try {
    const raw = localStorage.getItem(AUTH_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(loadUser)

  const login = useCallback((email, password) => {
    const users = loadUsers()
    const found = users.find((u) => u.email === email && u.password === password)
    if (!found) return { error: 'Invalid email or password' }
    const u = { name: found.name, email: found.email }
    setUser(u)
    try { localStorage.setItem(AUTH_KEY, JSON.stringify(u)) } catch { /* */ }
    return { ok: true }
  }, [])

  const signup = useCallback((name, email, password) => {
    const users = loadUsers()
    if (users.find((u) => u.email === email)) return { error: 'An account with this email already exists' }
    const entry = { name, email, password }
    users.push(entry)
    try { localStorage.setItem('metalcast.users', JSON.stringify(users)) } catch { /* */ }
    const u = { name, email }
    setUser(u)
    try { localStorage.setItem(AUTH_KEY, JSON.stringify(u)) } catch { /* */ }
    return { ok: true }
  }, [])

  const logout = useCallback(() => {
    setUser(null)
    try { localStorage.removeItem(AUTH_KEY) } catch { /* */ }
  }, [])

  const value = useMemo(() => ({ user, login, signup, logout }), [user, login, signup, logout])
  return createElement(AuthContext.Provider, { value }, children)
}

function loadUsers() {
  try {
    return JSON.parse(localStorage.getItem('metalcast.users') || '[]')
  } catch {
    return []
  }
}

export function useAuth() {
  return useContext(AuthContext)
}

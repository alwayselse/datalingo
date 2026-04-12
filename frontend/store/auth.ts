import { create } from 'zustand'
import { jwtDecode } from 'jwt-decode'
import { User } from '@/types'

interface AuthJWTPayload {
  sub: string
  role: User['role']
  name?: string
  course?: string
  exp: number
}

interface AuthStore {
  token: string | null
  user: User | null
  setAuth: (token: string, user: User) => void
  clearAuth: () => void
  isAuthenticated: () => boolean
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  token: typeof window !== 'undefined' ? localStorage.getItem('token') : null,
  user: typeof window !== 'undefined'
    ? JSON.parse(localStorage.getItem('user') || 'null')
    : null,

  setAuth: (token, user) => {
    let decoded: AuthJWTPayload | null = null
    try {
      decoded = jwtDecode<AuthJWTPayload>(token)
    } catch {
      decoded = null
    }

    const resolvedUser: User = {
      ...user,
      user_id: decoded?.sub || user.user_id,
      role: decoded?.role || user.role,
      name: decoded?.name || user.name,
      course: decoded?.course || user.course,
    }

    localStorage.setItem('token', token)
    localStorage.setItem('user', JSON.stringify(resolvedUser))

    const maxAge = 30 * 24 * 60 * 60
    const course = resolvedUser.course
    if (course) {
      document.cookie = `user_course=${course}; path=/; max-age=${maxAge}`
    } else {
      document.cookie = 'user_course=; path=/; max-age=0'
    }

    set({ token, user: resolvedUser })
  },

  clearAuth: () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    document.cookie = 'user_course=; path=/; max-age=0'
    set({ token: null, user: null })
  },

  isAuthenticated: () => !!get().token
}))
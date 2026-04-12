import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' }
})

// Attach token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Redirect to login on 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// ── Auth ──────────────────────────────────────────────────
export const authApi = {
  login: (username: string, password: string) =>
    api.post('/auth/login', { username, password })
}

// ── Chat ──────────────────────────────────────────────────
export const chatApi = {
  getSessions: () =>
    api.get('/chat/sessions'),

  getMessages: (sessionId: string) =>
    api.get(`/chat/sessions/${sessionId}/messages`),

  checkPrereqs: (message: string, session_id?: string | null) =>
    api.post('/chat/check-prereqs', { message, session_id }),

  submitPrereqAnswer: (data: {
    session_id: string | null
    topic_id: string
    prereq_id: string
    question: string
    student_answer: string
    correct_answer: string
  }) => api.post('/chat/submit-prereq-answer', data),

  skipPrereq: (session_id: string | null, prereq_id: string) =>
    api.post('/chat/skip-prereq', { session_id, prereq_id }),

  endSession: (session_id: string) =>
    api.post('/chat/end-session', { session_id }),

  deleteSession: (sessionId: string) =>
    api.delete(`/chat/sessions/${sessionId}`),

  mcqBatchGenerate: (data: { topic: string; count: number; level: string; session_id?: string | null }) =>
    api.post('/chat/mcq-batch-generate', data),

  mcqBatchSubmit: (data: { topic_id: string; answers: unknown[]; session_id?: string | null }) =>
    api.post('/chat/mcq-batch-submit', data),

  submitTieredAnswers: (data: { topic_id: string; answers: unknown[]; session_id?: string | null; is_tiered: boolean }) =>
    api.post('/chat/submit-tiered-answers', data),
}

// ── Analytics (teacher) ───────────────────────────────────
export const analyticsApi = {
  getOverview: () =>
    api.get('/analytics/overview'),

  getStudents: (params?: { batch?: string; search?: string; sort_by?: string }) =>
    api.get('/analytics/students', { params }),

  getStudentDetail: (userId: string) =>
    api.get(`/analytics/student/${userId}`),

  getTopics: () =>
    api.get('/analytics/topics'),

  getAtRisk: () =>
    api.get('/analytics/at-risk'),

  generateSummary: (userId: string) =>
    api.post(`/analytics/student/${userId}/generate-summary`)
}

// ── Admin ─────────────────────────────────────────────────
export const adminApi = {
  getOverview: () =>
    api.get('/admin/overview'),

  getSystem: () =>
    api.get('/admin/system'),

  getMessages: (page: number, userId?: string) =>
    api.get('/admin/messages', { params: { page, user_id: userId } }),

  getMessageFrequency: (days: number) =>
    api.get('/admin/messages/frequency', { params: { days } }),

  getErrorLogs: (page: number) =>
    api.get('/admin/logs/errors', { params: { page } }),

  getApiUsage: (page: number) =>
    api.get('/admin/logs/api-usage', { params: { page } }),

  getApiUsageSummary: (days: number) =>
    api.get('/admin/logs/api-usage/summary', { params: { days } }),

  getServicesHealth: () =>
    api.get('/admin/services/health'),

  getUsers: (params?: { page?: number; search?: string; role?: string }) =>
    api.get('/admin/users', { params }),

  addUser: (data: { name?: string | null; email: string; username: string; password: string; role: 'student' | 'teacher' | 'admin' }) =>
    api.post('/admin/users', data),

  deleteUser: (userId: string) =>
    api.delete(`/admin/users/${userId}`),

  updateRole: (userId: string, role: string) =>
    api.patch(`/admin/users/${userId}/role`, { role }),

  resetPassword: (userId: string, new_password: string) =>
    api.patch(`/admin/users/${userId}/password`, { new_password }),

  updateStatus: (userId: string, is_active: boolean) =>
    api.patch(`/admin/users/${userId}/status`, { is_active }),

  exportUsers: () =>
    api.get('/admin/users/export', { responseType: 'blob' })
}

// ── Documents ─────────────────────────────────────────────
export const documentsApi = {
  getDocuments: () => api.get('/documents/')
}
// types/index.ts — add name field to User

export interface User {
  user_id: string
  username: string
  email: string
  role: 'student' | 'teacher' | 'admin'
  name?: string   // ← add this
  course?: string
}

export interface AuthResponse {
  access_token: string
  token_type: string
}

export interface Message {
  id?: string
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
  created_at?: string
}

export interface Source {
  chunk_id: string
  page: number
  title: string
}

export interface Session {
  id: string
  title: string
  created_at: string
  updated_at?: string
  session_memory?: {
    uploaded_collection?: string
    uploaded_files?: Array<{
      filename: string
      chunk_count: number
      uploaded_at: string
    }>
  }
}

export interface MCQCard {
  status: 'mcq_required'
  proceed: boolean
  topic_id: string
  prereq_id: string
  question: string
  options: { A: string; B: string; C: string; D: string }
  correct: string
  can_skip: boolean
}

export interface Topic {
  id: string
  name: string
  description: string
  subtopics: string[]
  prerequisites: string[]
}

export interface MasteryScore {
  topic_id: string
  topic_name: string
  p_known: number
  assessment_count: number
  last_assessed: string | null
  level: 'beginner' | 'intermediate' | 'advanced'
}

export interface StudentDetail {
  student: {
    user_id: string
    username: string
    email: string
    batch: string
    joined: string
  }
  total_questions: number
  avg_mastery: number
  mastery_by_topic: MasteryScore[]
  recent_questions: {
    question: string
    session_title: string
    asked_at: string
  }[]
}

export interface AnalyticsOverview {
  total_students: number
  active_last_7_days: number
  total_questions: number
  avg_mastery: number
  most_asked_topic: string | null
  most_struggled_topic: string | null
}

export interface AdminOverview {
  total_students: number
  active_users: number
  total_messages: number
  messages_today: number
  sessions_today: number
  active_7d: number
  errors_today: number
  tokens_today: number
  tokens_total: number
}
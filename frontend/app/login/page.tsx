'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { jwtDecode } from 'jwt-decode'
import { authApi } from '@/lib/api'
import { useAuthStore } from '@/store/auth'
import { User } from '@/types'

interface JWTPayload {
  sub: string
  role: string
  name: string
  course?: string
  exp: number

}

export default function LoginPage() {
  const router = useRouter()
  const { setAuth } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await authApi.login(email, password)
      const { access_token } = res.data
      const decoded = jwtDecode<JWTPayload>(access_token)

      const user: User = {
  user_id: decoded.sub,
  username: email,
  email: email,
  role: decoded.role as User['role'],
  name: decoded.name,   // ← add
  course: decoded.course,
}

      // 1. Save to Zustand + localStorage
      setAuth(access_token, user)

      // 2. Set cookies so proxy.ts route guard can read role
      const maxAge = 30 * 24 * 60 * 60 // 30 days
      document.cookie = `auth_token=${access_token}; path=/; max-age=${maxAge}`
      document.cookie = `user_role=${decoded.role}; path=/; max-age=${maxAge}`
      if (decoded.course) {
        document.cookie = `user_course=${decoded.course}; path=/; max-age=${maxAge}`
      }

      // 3. Redirect based on role
      if (decoded.role === 'admin') router.push('/admin')
      else if (decoded.role === 'teacher') router.push('/teacher')
      else if (decoded.role === 'student' && decoded.course === 'business_analytics') router.push('/business-analytics')
      else router.push('/student')

    } catch {
      setError('Invalid credentials. Please check your email and security key.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&family=Newsreader:ital,opsz,wght@0,6..72,200..800;1,6..72,200..800&display=swap" rel="stylesheet" />
      <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />

      <style>{`
        .material-symbols-outlined {
          font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
          font-family: 'Material Symbols Outlined';
          font-style: normal;
          display: inline-block;
          line-height: 1;
          text-transform: none;
          letter-spacing: normal;
          word-wrap: normal;
          white-space: nowrap;
          direction: ltr;
        }
        .glass-panel {
          background: rgba(42, 42, 42, 0.6);
          backdrop-filter: blur(24px);
          border: 1px solid rgba(73, 68, 86, 0.15);
        }
        .ambient-glow {
          box-shadow: 0 0 55px -24px rgba(110, 40, 245, 0.16);
        }
        .login-input {
          display: block;
          width: 100%;
          padding: 14px 44px 14px 44px;
          background: #0e0e0e;
          border: none;
          border-radius: 10px;
          color: #e2e2e2;
          font-family: 'Manrope', sans-serif;
          font-size: 14px;
          outline: none;
          transition: box-shadow 0.2s;
        }
        .login-input::placeholder { color: #958da2; }
        .login-input:focus { box-shadow: 0 0 0 2px #6e28f5; }
        .submit-btn {
          width: 100%;
          background: linear-gradient(135deg, #6E28F5 0%, #513794 100%);
          color: white;
          font-weight: 700;
          padding: 14px 20px;
          border-radius: 10px;
          border: none;
          cursor: pointer;
          font-family: 'Manrope', sans-serif;
          font-size: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: all 0.2s;
        }
        .submit-btn:hover:not(:disabled) {
          box-shadow: 0 0 20px rgba(110,40,245,0.4);
          transform: scale(1.01);
        }
        .submit-btn:active:not(:disabled) { transform: scale(0.98); }
        .submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .icon-btn {
          position: absolute;
          right: 12px;
          top: 50%;
          transform: translateY(-50%);
          display: flex;
          align-items: center;
          justify-content: center;
          border: none;
          background: transparent;
          color: #958da2;
          cursor: pointer;
          padding: 2px;
        }
        .icon-btn:hover { color: #cfbdff; }
        .spinner {
          width: 18px; height: 18px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .error-box {
          background: rgba(220,38,38,0.1);
          border: 1px solid rgba(220,38,38,0.25);
          border-radius: 10px;
          padding: 12px 16px;
          color: #fca5a5;
          font-size: 13px;
          text-align: center;
          margin-bottom: 16px;
          font-family: 'Manrope', sans-serif;
        }
        .stars-canvas {
          position: fixed;
          inset: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          z-index: 0;
        }
      `}</style>

      <div style={{
        backgroundColor: '#000000',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '24px',
        fontFamily: "'Manrope', sans-serif",
        color: '#e2e2e2',
      }}>

        {/* Stars canvas */}
        <canvas
          className="stars-canvas"
          ref={(canvas) => {
            if (!canvas) return
            const ctx = canvas.getContext('2d')
            if (!ctx) return
            const canvasEl = canvas
            const context = ctx
            canvasEl.width = window.innerWidth
            canvasEl.height = window.innerHeight

            const stars = Array.from({ length: 180 }, () => ({
              x: Math.random() * canvasEl.width,
              y: Math.random() * canvasEl.height,
              r: Math.random() * 1.2,
              o: Math.random() * 0.7 + 0.1,
              twinkleSpeed: Math.random() * 0.02 + 0.005,
              twinkleDir: Math.random() > 0.5 ? 1 : -1,
            }))

            const shooters: {x:number,y:number,len:number,speed:number,angle:number,opacity:number,active:boolean,timer:number}[] = Array.from({ length: 6 }, () => ({
              x: 0, y: 0, len: 0, speed: 0, angle: 0, opacity: 0, active: false, timer: Math.random() * 200
            }))

            function resetShooter(s: typeof shooters[0]) {
              s.x = Math.random() * canvasEl.width * 0.7
              s.y = Math.random() * canvasEl.height * 0.4
              s.len = Math.random() * 120 + 60
              s.speed = Math.random() * 12 + 8
              s.angle = Math.PI / 6 + (Math.random() * Math.PI / 8)
              s.opacity = 1
              s.active = true
            }

            function draw() {
              context.clearRect(0, 0, canvasEl.width, canvasEl.height)
              stars.forEach(s => {
                s.o += s.twinkleSpeed * s.twinkleDir
                if (s.o >= 0.8 || s.o <= 0.08) s.twinkleDir *= -1
                context.beginPath()
                context.arc(s.x, s.y, s.r, 0, Math.PI * 2)
                context.fillStyle = `rgba(255,255,255,${s.o})`
                context.fill()
              })
              shooters.forEach(s => {
                if (!s.active) {
                  s.timer--
                  if (s.timer <= 0) { resetShooter(s); s.timer = Math.random() * 300 + 150 }
                  return
                }
                const dx = Math.cos(s.angle) * s.speed
                const dy = Math.sin(s.angle) * s.speed
                s.x += dx; s.y += dy; s.opacity -= 0.018
                if (s.opacity <= 0 || s.x > canvasEl.width || s.y > canvasEl.height) { s.active = false; return }
                const tail = { x: s.x - Math.cos(s.angle) * s.len, y: s.y - Math.sin(s.angle) * s.len }
                const grad = context.createLinearGradient(tail.x, tail.y, s.x, s.y)
                grad.addColorStop(0, `rgba(255,255,255,0)`)
                grad.addColorStop(0.7, `rgba(200,180,255,${s.opacity * 0.4})`)
                grad.addColorStop(1, `rgba(255,255,255,${s.opacity})`)
                context.beginPath()
                context.moveTo(tail.x, tail.y)
                context.lineTo(s.x, s.y)
                context.strokeStyle = grad
                context.lineWidth = 1.5
                context.stroke()
                context.beginPath()
                context.arc(s.x, s.y, 1.5, 0, Math.PI * 2)
                context.fillStyle = `rgba(255,255,255,${s.opacity})`
                context.fill()
              })
              requestAnimationFrame(draw)
            }
            draw()
          }}
        />

        <div style={{ width: '100%', maxWidth: '384px', position: 'relative', zIndex: 1 }}>

          {/* Logo */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '32px' }}>
            <div style={{
              width: '64px', height: '64px', borderRadius: '50%',
              background: 'linear-gradient(135deg, #6E28F5 0%, #513794 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: '20px',
              boxShadow: '0 0 80px -20px rgba(110, 40, 245, 0.4)'
            }}>
              <span className="material-symbols-outlined" style={{ color: 'white', fontSize: '28px', fontVariationSettings: "'FILL' 1" }}>
                auto_stories
              </span>
            </div>
            <h1 style={{ fontSize: '18px', fontWeight: 800, letterSpacing: '0.16em', color: '#cfbdff', textTransform: 'uppercase', marginBottom: '8px' }}>
              Datalingo
            </h1>
            <p style={{ fontFamily: "'Newsreader', serif", fontStyle: 'italic', fontSize: '15px', color: '#cbc3d9' }}>
              Ramaiah University of Applied Sciences
            </p>
          </div>

          {/* Card */}
          <div className="glass-panel ambient-glow" style={{ padding: '28px', borderRadius: '14px' }}>
            <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '24px', color: '#e2e2e2', letterSpacing: '-0.02em' }}>
              Sign in
            </h2>

            <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '13px', fontWeight: 500, color: '#cbc3d9', marginLeft: '4px' }}>Academic Email</label>
                <div style={{ position: 'relative' }}>
                  <div style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                    <span className="material-symbols-outlined" style={{ color: '#958da2', fontSize: '20px' }}>alternate_email</span>
                  </div>
                  <input
                    className="login-input"
                    type="text"
                    placeholder="rollnumber@msruas.ac.in"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    autoComplete="off"
                  />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '13px', fontWeight: 500, color: '#cbc3d9', marginLeft: '4px' }}>Security Key</label>
                <div style={{ position: 'relative' }}>
                  <div style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                    <span className="material-symbols-outlined" style={{ color: '#958da2', fontSize: '20px' }}>lock</span>
                  </div>
                  <input
                    className="login-input"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => setShowPassword(prev => !prev)}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                      {showPassword ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>

              {error && <div className="error-box">{error}</div>}

              <button type="submit" className="submit-btn" disabled={loading}>
                {loading ? (
                  <><div className="spinner" /> Authenticating...</>
                ) : (
                  <>Sign in <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>arrow_forward</span></>
                )}
              </button>
            </form>
          </div>

          {/* Footer */}
          <div style={{ marginTop: '48px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', width: '100%', opacity: 0.3 }}>
              <div style={{ height: '1px', background: '#494456', flex: 1 }} />
              <span style={{ fontSize: '10px', color: '#958da2', textTransform: 'uppercase', letterSpacing: '0.3em', fontWeight: 700 }}>Contact Core</span>
              <div style={{ height: '1px', background: '#494456', flex: 1 }} />
            </div>
            <a
              href="mailto:project.ruas25@gmail.com"
              className="glass-panel"
              style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 24px', borderRadius: '999px', textDecoration: 'none', transition: 'all 0.3s', border: '1px solid rgba(110,40,245,0.1)' }}
            >
              <span className="material-symbols-outlined" style={{ color: '#cfbdff', fontSize: '20px' }}>mail</span>
              <span style={{ fontSize: '13px', color: '#cbc3d9', fontWeight: 500, letterSpacing: '0.05em' }}>project.ruas25@gmail.com</span>
            </a>
          </div>
        </div>

        {/* BG orbs */}
        <div style={{ position: 'fixed', top: '-10%', right: '-10%', width: '500px', height: '500px', borderRadius: '50%', background: 'rgba(110,40,245,0.1)', filter: 'blur(120px)', zIndex: 0, pointerEvents: 'none' }} />
        <div style={{ position: 'fixed', bottom: '-10%', left: '-10%', width: '400px', height: '400px', borderRadius: '50%', background: 'rgba(81,55,148,0.1)', filter: 'blur(100px)', zIndex: 0, pointerEvents: 'none' }} />
      </div>
    </>
  )
}
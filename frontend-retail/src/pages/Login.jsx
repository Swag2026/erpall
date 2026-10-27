import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';

export default function Login() {
  const { login, error, loading } = useAuth();
  const { t } = useLanguage();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [focusedInput, setFocusedInput] = useState(null);
  const navigate = useNavigate();

  // 3D tilt — the card rotates slightly toward the cursor, like the
  // reference design's motion-value tilt, done here with plain state
  // instead of framer-motion since this app doesn't carry that dependency.
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const cardRef = useRef(null);

  function handleMouseMove(e) {
    const rect = cardRef.current.getBoundingClientRect();
    const relX = e.clientX - rect.left - rect.width / 2;
    const relY = e.clientY - rect.top - rect.height / 2;
    setTilt({
      x: Math.max(-8, Math.min(8, (relY / rect.height) * -16)),
      y: Math.max(-8, Math.min(8, (relX / rect.width) * 16)),
    });
  }
  function handleMouseLeave() {
    setTilt({ x: 0, y: 0 });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      await login(username, password);
      sessionStorage.setItem('sg_just_logged_in', '1');
      navigate('/', { replace: true });
    } catch (_) {
      /* error already surfaced via context */
    }
  }

  return (
    <div className="login-scene">
      <div className="login-scene-noise" />
      <div className="login-scene-glow-top" />
      <div className="login-scene-glow-bottom" />
      <div className="login-scene-spot login-scene-spot-a" />
      <div className="login-scene-spot login-scene-spot-b" />

      <div className="login-tilt-wrap" style={{ perspective: 1500 }}>
        <div
          ref={cardRef}
          className="login-tilt-inner"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          style={{ transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` }}
        >
          <div className="login-glow-border">
            {/* Traveling light beams — 4 CSS-animated streaks that chase
                each other around the card edge. */}
            <span className="login-beam login-beam-top" />
            <span className="login-beam login-beam-right" />
            <span className="login-beam login-beam-bottom" />
            <span className="login-beam login-beam-left" />
            <span className="login-corner-dot login-corner-dot-tl" />
            <span className="login-corner-dot login-corner-dot-tr" />
            <span className="login-corner-dot login-corner-dot-br" />
            <span className="login-corner-dot login-corner-dot-bl" />
          </div>

          <form className="login-card login-card-glass" onSubmit={handleSubmit}>
            <div className="login-gem login-gem-pop">
              <img src="/logo.png" alt="Swag Gold" style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 8 }} onError={(e) => { e.target.style.display = 'none'; e.target.parentNode.textContent = '◆'; }} />
            </div>
            <div className="login-title">{t('login.title')}</div>
            <div className="login-sub">{t('login.sub')}</div>

            <div className="lfield lfield-glass">
              <label>{t('login.username')}</label>
              <div className="lfield-icon-wrap">
                <svg className="lfield-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                </svg>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  onFocus={() => setFocusedInput('username')}
                  onBlur={() => setFocusedInput(null)}
                  placeholder={t('login.usernamePlaceholder')}
                  autoComplete="username"
                  className={focusedInput === 'username' ? 'is-focused' : ''}
                />
              </div>
            </div>
            <div className="lfield lfield-glass">
              <label>{t('login.password')}</label>
              <div className="lfield-icon-wrap lfield-pass-wrap">
                <svg className="lfield-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onFocus={() => setFocusedInput('password')}
                  onBlur={() => setFocusedInput(null)}
                  placeholder={t('login.passwordPlaceholder')}
                  autoComplete="current-password"
                  className={focusedInput === 'password' ? 'is-focused' : ''}
                />
                <button
                  type="button"
                  className="lfield-eye"
                  tabIndex={-1}
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPass(s => !s)}
                >
                  {showPass ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.6 18.6 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><path d="M1 1l22 22" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <button className="btn-primary login-btn-shine" type="submit" disabled={loading}>
              <span className="login-btn-sweep" />
              {loading ? <span className="login-spinner" /> : t('login.btn')}
            </button>

            {error && (
              <div className="login-err" style={{ display: 'block' }}>
                ⚠ {error}
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

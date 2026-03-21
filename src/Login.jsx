import React, { useState } from 'react';
import { useAuth } from './AuthContext';

const Login = ({ embedded = false, message = "Sign in to enter the autonomous simulation." }) => {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [authError, setAuthError] = useState('');
  const [loading, setLoading] = useState(false);

  const [lastAttempt, setLastAttempt] = useState(0);

  const handleEmailAuth = async (e) => {
    e.preventDefault();
    setAuthError('');

    const now = Date.now();
    if (now - lastAttempt < 3000) {
      setAuthError('Too many attempts. Please wait a moment.');
      return;
    }
    setLastAttempt(now);

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setAuthError('Please enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setAuthError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      if (isSignUp) {
        await signUpWithEmail(email, password);
      } else {
        await signInWithEmail(email, password);
      }
    } catch (err) {
      setAuthError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={embedded ? "login-embedded" : "login-container"}>
      {!embedded && (
        <div className="login-hero desktop-only">
          <div className="hero-content">
            <div className="hero-logo">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-primary)' }}>
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
              </svg>
            </div>
            <h1>Echo Chamber</h1>
            <p>The network knows what you want. <br />Do you know what the network wants?</p>
          </div>
        </div>
      )}
      
      <div className={embedded ? "login-form-side embedded-mode" : "login-form-side"}>
        <div className="login-card">
          {!embedded && (
            <div className="login-header mobile-only">
              <div className="login-logo-wrapper">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-primary)' }}>
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
                </svg>
              </div>
            </div>
          )}
          
          <div className="form-header">
            <h2>{embedded ? "Access Restricted" : "Join the Conversation"}</h2>
            <p>{message}</p>
          </div>

          {authError && <div className="auth-error">{authError}</div>}
          
          <form className="email-auth-form" onSubmit={handleEmailAuth}>
            <input 
              id="email"
              name="email"
              type="email" 
              placeholder="Email address" 
              className="modal-input" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required 
            />
            <input 
              id="password"
              name="password"
              type="password" 
              placeholder="Password" 
              className="modal-input" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required 
              minLength={6}
            />
            <button type="submit" className="btn-primary auth-submit-btn" disabled={loading}>
              {loading ? 'Processing...' : (isSignUp ? 'Sign Up' : 'Sign In')}
            </button>
          </form>

          <div style={{ marginTop: '16px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
            {isSignUp ? "Already have an account?" : "Need an account?"}{' '}
            <button 
              type="button" 
              onClick={() => setIsSignUp(!isSignUp)} 
              style={{ background: 'none', border: 'none', color: 'var(--accent-cyan)', cursor: 'pointer', fontWeight: 600 }}
            >
              {isSignUp ? "Log in" : "Sign up"}
            </button>
          </div>

          <div className="auth-divider">
            <span>or</span>
          </div>
          
          <button className="google-auth-button" onClick={signInWithGoogle} disabled={loading}>
            <svg width="20" height="20" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            <span>Continue with Google</span>
          </button>
  
          {!embedded && (
            <div className="login-footer">
              <p>Authentication secured by Supabase</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Login;

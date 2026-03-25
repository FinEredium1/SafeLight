import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { login } from '../api';
import '../styles/safelight.css';

export default function Login() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function handleChange(e) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await login(form.email, form.password);
      localStorage.setItem('token', data.token);
      navigate('/');
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="sf-page sf-auth-page">
      <div className="sf-auth-card">
        <div className="sf-auth-top">
          <div className="sf-brand-row">
            <div className="sf-brand">
              <div className="sf-logo">S</div>
              <div className="sf-brand-text">
                <h1>Safelight</h1>
                <div className="sf-subtle">Private messaging built for secure communication</div>
              </div>
            </div>

            <div className="sf-status-chip">
              <span className="sf-status-dot" />
              <span>secure</span>
            </div>
          </div>
        </div>

        <div className="sf-auth-body">
          {error && <div className="sf-error">{error}</div>}

          <form onSubmit={handleSubmit} className="sf-form" style={{ marginTop: error ? 14 : 0 }}>
            <label className="sf-label">
              <span>Email</span>
              <input
                className="sf-input"
                name="email"
                type="email"
                placeholder="you@example.com"
                value={form.email}
                onChange={handleChange}
                required
              />
            </label>

            <label className="sf-label">
              <span>Password</span>
              <input
                className="sf-input"
                name="password"
                type="password"
                placeholder="Enter your password"
                value={form.password}
                onChange={handleChange}
                required
              />
            </label>

            <button className="sf-primary-btn" type="submit" disabled={loading}>
              {loading ? 'Authenticating...' : 'Log in'}
            </button>
          </form>

          <div className="sf-auth-footer">
            No account yet? <Link to="/register">Create one</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
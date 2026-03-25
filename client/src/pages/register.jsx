import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { register } from '../api';
import '../styles/safelight.css';

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', email: '', password: '' });
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
      const data = await register(
        form.username,
        form.email,
        form.password,
        'placeholder_public_key'
      );
      localStorage.setItem('token', data.token);
      navigate('/');
    } catch (err) {
      setError(err.message || 'Registration failed');
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
                <h2>Safelight</h2>
                <div className="sf-subtle">Create your secure account and start private messaging</div>
              </div>
            </div>

            <div className="sf-status-chip">
              <span className="sf-status-dot" />
              <span>e2ee ready</span>
            </div>
          </div>
        </div>

        <div className="sf-auth-body">
          {error && <div className="sf-error">{error}</div>}

          <form onSubmit={handleSubmit} className="sf-form" style={{ marginTop: error ? 14 : 0 }}>
            <label className="sf-label">
              <span>Username</span>
              <input
                className="sf-input"
                name="username"
                placeholder="Choose a username"
                value={form.username}
                onChange={handleChange}
                required
              />
            </label>

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
                placeholder="Create a password"
                value={form.password}
                onChange={handleChange}
                required
              />
            </label>

            <button className="sf-primary-btn" type="submit" disabled={loading}>
              {loading ? 'Creating account...' : 'Register'}
            </button>
          </form>

          <div className="sf-auth-footer">
            Already have an account? <Link to="/login">Log in</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
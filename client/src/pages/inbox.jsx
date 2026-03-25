import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getConversations, startConversation } from '../api';
import '../styles/safelight.css';

function initialsFromName(name = '') {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || '?';
}

function formatTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function Inbox() {
  const navigate = useNavigate();
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [starting, setStarting] = useState(false);
  const [newError, setNewError] = useState('');

  useEffect(() => {
    fetchConversations();
  }, []);

  async function fetchConversations() {
    try {
      const data = await getConversations();
      setConversations(data.conversations || []);
    } catch (err) {
      setError(err.message || 'Could not load conversations');
    } finally {
      setLoading(false);
    }
  }

  async function handleStart(e) {
    e.preventDefault();
    if (!newUsername.trim()) return;

    setStarting(true);
    setNewError('');

    try {
      const data = await startConversation(newUsername.trim());
      navigate(`/chat/${data.conversation_id}`);
    } catch (err) {
      setNewError(err.message || 'Could not start conversation');
    } finally {
      setStarting(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem('token');
    navigate('/login');
  }

  return (
    <div className="sf-page">
      <div className="sf-shell">
        <aside className="sf-sidebar">
          <div className="sf-sidebar-header">
            <div className="sf-sidebar-top">
              <div>
                <h1 className="sf-title">Safelight</h1>
                <div className="sf-micro">SECURE INBOX • VERIFIED SESSION</div>
              </div>

              <button className="sf-secondary-btn" onClick={handleLogout}>
                Log out
              </button>
            </div>
          </div>

          <form className="sf-start-form" onSubmit={handleStart}>
            <input
              className="sf-input"
              placeholder="Start chat with username..."
              value={newUsername}
              onChange={e => setNewUsername(e.target.value)}
            />
            <button className="sf-primary-btn" type="submit" disabled={starting}>
              {starting ? 'Starting...' : 'Go'}
            </button>
          </form>

          {newError && <div style={{ padding: '0 20px 12px' }}><div className="sf-error">{newError}</div></div>}
          {error && !loading && <div style={{ padding: '0 20px 12px' }}><div className="sf-error">{error}</div></div>}

          <div className="sf-conversation-list">
            {loading && <div className="sf-hint">Loading conversations...</div>}

            {!loading && !error && conversations.length === 0 && (
              <div className="sf-hint">No conversations yet</div>
            )}

            {!loading &&
              !error &&
              conversations.map(conv => (
                <button
                  key={conv.conversation_id}
                  className="sf-conversation-row"
                  onClick={() => navigate(`/chat/${conv.conversation_id}`)}
                  type="button"
                >
                  <div className="sf-conversation-row-main">
                    <div className="sf-avatar">
                      {initialsFromName(conv.other_username)}
                    </div>

                    <div className="sf-conversation-text">
                      <div className="sf-conversation-name">{conv.other_username}</div>
                      <div className="sf-conversation-sub">Secure channel active</div>
                    </div>
                  </div>

                  <div className="sf-conversation-meta">
                    {conv.unread_count > 0 ? (
                      <span className="sf-badge">{conv.unread_count}</span>
                    ) : (
                      <span className="sf-time">read</span>
                    )}

                    {conv.last_message_time && (
                      <span className="sf-time">{formatTime(conv.last_message_time)}</span>
                    )}
                  </div>
                </button>
              ))}
          </div>
        </aside>

        <main className="sf-main-empty">
          <div className="sf-empty-card">
            <div className="sf-empty-icon">🔒</div>
            <h2 className="sf-empty-title">Private conversations, protected by design</h2>
            <p className="sf-empty-text">
              Select a conversation from the left or start a new one by username.
              Once E2EE is wired in, this area will become your encrypted chat surface.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getMessages, sendMessage, markConversationRead, getMe } from '../api';
import '../styles/safelight.css';

function initialsFromConversation(messages) {
  const possibleName =
    messages.find(msg => msg.other_username)?.other_username ||
    messages.find(msg => msg.sender_username)?.sender_username ||
    'Contact';

  return possibleName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'C';
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function Chat() {
  const { conversationId } = useParams();
  const navigate = useNavigate();

  const [messages, setMessages] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [otherLastRead, setOtherLastRead] = useState(null);
  const [myId, setMyId] = useState(null);

  useEffect(() => {
    async function loadInitialMessages() {
      setLoading(true);
      setError('');

      try {
        const data = await getMessages(conversationId);
        const ordered = [...(data.messages || [])].reverse();

        setMessages(ordered);
        setNextCursor(data.next_cursor);
        setOtherLastRead(data.other_last_read_message_id);

        const me = await getMe();
        setMyId(me.id);

        if (ordered.length > 0) {
          await markConversationRead(conversationId, ordered[ordered.length - 1].id);
        }
      } catch (err) {
        setError(err.message || 'Could not load messages');
      } finally {
        setLoading(false);
      }
    }

    loadInitialMessages();
  }, [conversationId]);

  async function handleSend(e) {
    e.preventDefault();
    if (!text.trim()) return;

    const draft = text.trim();
    setSending(true);
    setError('');

    try {
      await sendMessage(conversationId, draft);
      setText('');

      const data = await getMessages(conversationId);
      const ordered = [...(data.messages || [])].reverse();

      setMessages(ordered);
      setNextCursor(data.next_cursor);
      setOtherLastRead(data.other_last_read_message_id);

      if (ordered.length > 0) {
        await markConversationRead(conversationId, ordered[ordered.length - 1].id);
      }
    } catch (err) {
      setError(err.message || 'Could not send message');
    } finally {
      setSending(false);
    }
  }

  async function handleLoadMore() {
    if (!nextCursor) return;

    setLoadingMore(true);
    setError('');

    try {
      const data = await getMessages(conversationId, nextCursor);
      const older = [...(data.messages || [])].reverse();
      setMessages(prev => [...older, ...prev]);
      setNextCursor(data.next_cursor);
    } catch (err) {
      setError(err.message || 'Could not load older messages');
    } finally {
      setLoadingMore(false);
    }
  }

  const contactLabel = useMemo(() => {
    const otherMessage = messages.find(msg => msg.sender_id !== myId);
    return (
      otherMessage?.sender_username ||
      otherMessage?.other_username ||
      `Conversation ${conversationId?.slice?.(0, 6) || ''}`
    );
  }, [messages, myId, conversationId]);

  const avatarText = useMemo(() => initialsFromConversation(messages), [messages]);

  return (
    <div className="sf-page sf-chat-page">
      <div className="sf-chat-shell">
        <header className="sf-chat-header">
          <div className="sf-chat-header-left">
            <button
              className="sf-back-btn"
              onClick={() => navigate('/')}
              type="button"
              aria-label="Back to inbox"
            >
              ←
            </button>

            <div className="sf-avatar">{avatarText}</div>

            <div className="sf-chat-identity">
              <h2 className="sf-chat-name">{contactLabel}</h2>
              <div className="sf-chat-status">
                <span className="sf-status-dot" />
                <span>AES-256 | ECDH</span>
              </div>
            </div>
          </div>

          <div className="sf-chat-secure">
            <span className="sf-status-dot" />
            <span>Secure</span>
          </div>
        </header>

        <div className="sf-banner-wrap">
          <div className="sf-encryption-banner">
            <span>🛡</span>
            <span>Verified identity • E2EE active • fingerprint: A7F3...D92C</span>
          </div>
        </div>

        {error && <div style={{ padding: '14px 18px 0' }}><div className="sf-error">{error}</div></div>}

        <div className="sf-messages">
          {nextCursor && (
            <div className="sf-center-row">
              <button
                className="sf-secondary-btn sf-load-more"
                onClick={handleLoadMore}
                disabled={loadingMore}
                type="button"
              >
                {loadingMore ? 'Loading...' : 'Load older messages'}
              </button>
            </div>
          )}

          {loading && <div className="sf-hint">Loading messages...</div>}

          {!loading && messages.length === 0 && (
            <div className="sf-hint">No messages yet</div>
          )}

          {!loading &&
            messages.map(msg => {
              const isMine = msg.sender_id === myId;

              return (
                <div
                  key={msg.id}
                  className={`sf-message-row ${isMine ? 'mine' : 'theirs'}`}
                >
                  <div className="sf-message">
                    <div className={`sf-bubble ${isMine ? 'mine' : 'theirs'}`}>
                      {msg.encrypted_content}
                    </div>

                    <div className="sf-message-meta">
                      <span>{formatTime(msg.sent_at)}</span>
                      {otherLastRead === msg.id && isMine && (
                        <span className="sf-seen">Seen</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
        </div>

        <form className="sf-composer" onSubmit={handleSend}>
          <div className="sf-composer-inner">
            <input
              className="sf-composer-input"
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Type a message..."
            />

            <button className="sf-icon-btn" type="submit" disabled={sending} aria-label="Send message">
              {sending ? '...' : '➤'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
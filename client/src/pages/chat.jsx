import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getMessages, sendMessage, markConversationRead, getRecipientKey } from '../api';
import { encryptMessage, decryptMessage, buildAad, SUITE, safetyNumber } from '../crypto';
import { getSession, isUnlocked } from '../keyvault';
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
  const [recipient, setRecipient] = useState(null); // { user_id, username, key_id, public_key }
  const [safety, setSafety] = useState(null);       // { digits, groups }
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifying, setVerifying] = useState(false);

  // Compute the safety number on demand (it is intentionally slow).
  async function handleVerify() {
    const opening = !verifyOpen;
    setVerifyOpen(opening);
    if (!opening || safety || !recipient) return;
    const session = getSession();
    setVerifying(true);
    try {
      const sn = await safetyNumber(session.publicKey, recipient.public_key);
      setSafety(sn);
    } catch {
      setError('Could not compute safety number');
    } finally {
      setVerifying(false);
    }
  }

  // Decrypt a batch of raw rows into messages carrying a plaintext `.text`.
  // ctx = { session, myId, otherId }
  async function decryptAll(rawMessages, ctx) {
    const { session, myId, otherId } = ctx;
    return Promise.all(
      rawMessages.map(async (msg) => {
        // AAD must match what the sender bound at encrypt time.
        const from = msg.sender_id;
        const to = msg.sender_id === myId ? otherId : myId;
        const aad = buildAad(conversationId, from, to);
        try {
          const { plaintext, encrypted } = await decryptMessage(
            msg.encrypted_content,
            session.privateKey,
            session.publicKey,
            aad
          );
          return { ...msg, text: plaintext, decryptError: false, legacy: !encrypted };
        } catch {
          return { ...msg, text: '[unable to decrypt]', decryptError: true };
        }
      })
    );
  }

  useEffect(() => {
    async function loadInitialMessages() {
      setLoading(true);
      setError('');

      // Keys must be unlocked (login/register populates the in-memory session).
      if (!isUnlocked()) {
        navigate('/login');
        return;
      }
      const session = getSession();
      setMyId(session.userId);

      try {
        const rcpt = await getRecipientKey(conversationId);
        setRecipient(rcpt);

        const data = await getMessages(conversationId);
        const ordered = [...(data.messages || [])].reverse();
        const decrypted = await decryptAll(ordered, {
          session,
          myId: session.userId,
          otherId: rcpt.user_id,
        });

        setMessages(decrypted);
        setNextCursor(data.next_cursor);
        setOtherLastRead(data.other_last_read_message_id);

        if (decrypted.length > 0) {
          await markConversationRead(conversationId, decrypted[decrypted.length - 1].id);
        }
      } catch (err) {
        setError(err.message || 'Could not load messages');
      } finally {
        setLoading(false);
      }
    }

    loadInitialMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  async function handleSend(e) {
    e.preventDefault();
    if (!text.trim()) return;

    const draft = text.trim();
    setSending(true);
    setError('');

    try {
      const session = getSession();
      if (!session || !recipient) throw new Error('Keys not ready');

      // Encrypt to BOTH the recipient and myself so both sides can read it.
      const aad = buildAad(conversationId, session.userId, recipient.user_id);
      const envelope = await encryptMessage(
        draft,
        [recipient.public_key, session.publicKey],
        aad
      );

      await sendMessage(conversationId, {
        encrypted_content: envelope,
        recipient_key_id: recipient.key_id,
        crypto_suite: SUITE,
      });
      setText('');

      const data = await getMessages(conversationId);
      const ordered = [...(data.messages || [])].reverse();
      const decrypted = await decryptAll(ordered, {
        session,
        myId: session.userId,
        otherId: recipient.user_id,
      });

      setMessages(decrypted);
      setNextCursor(data.next_cursor);
      setOtherLastRead(data.other_last_read_message_id);

      if (decrypted.length > 0) {
        await markConversationRead(conversationId, decrypted[decrypted.length - 1].id);
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
      const session = getSession();
      const data = await getMessages(conversationId, nextCursor);
      const older = [...(data.messages || [])].reverse();
      const decrypted = await decryptAll(older, {
        session,
        myId: session.userId,
        otherId: recipient?.user_id,
      });
      setMessages(prev => [...decrypted, ...prev]);
      setNextCursor(data.next_cursor);
    } catch (err) {
      setError(err.message || 'Could not load older messages');
    } finally {
      setLoadingMore(false);
    }
  }

  const contactLabel = useMemo(() => {
    return (
      recipient?.username ||
      `Conversation ${conversationId?.slice?.(0, 6) || ''}`
    );
  }, [recipient, conversationId]);

  const avatarText = useMemo(
    () => initialsFromConversation(recipient?.username ? [{ other_username: recipient.username }] : []),
    [recipient]
  );

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
          <button
            type="button"
            className="sf-encryption-banner"
            onClick={handleVerify}
            style={{ cursor: 'pointer', width: '100%', textAlign: 'left', border: 'none' }}
            aria-expanded={verifyOpen}
          >
            <span>🛡</span>
            <span>E2EE active • {verifyOpen ? 'hide safety number' : 'tap to verify contact'}</span>
          </button>

          {verifyOpen && (
            <div className="sf-verify-panel" style={{ padding: '10px 14px', fontSize: 13 }}>
              {verifying && <div className="sf-hint">Computing safety number…</div>}
              {!verifying && safety && (
                <>
                  <div style={{ marginBottom: 6 }}>
                    Compare these 12 groups with {recipient?.username || 'your contact'} over a
                    trusted channel. If they match, no one is intercepting your keys.
                  </div>
                  <code style={{ display: 'block', lineHeight: 1.7, letterSpacing: 1, fontFamily: 'monospace' }}>
                    {safety.groups.slice(0, 6).join(' ')}<br />
                    {safety.groups.slice(6).join(' ')}
                  </code>
                </>
              )}
              {!verifying && !safety && (
                <div className="sf-hint">Safety number unavailable.</div>
              )}
            </div>
          )}
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
                      {msg.text ?? msg.encrypted_content}
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
const API_BASE = 'https://safelight.onrender.com';
const getToken = () => localStorage.getItem('token');

export async function register(username, email, password, public_key) {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password, public_key })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Registration failed');
  return data;
}

export async function login(email, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Login failed');
  return data;
}

export async function getMe() {
  const res = await fetch(`${API_BASE}/me`, {
    headers: { Authorization: `Bearer ${getToken()}` }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch user');
  return data;
}

export async function getConversations() {
  const res = await fetch(`${API_BASE}/conversations`, {
    headers: { Authorization: `Bearer ${getToken()}` }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch conversations');
  return data;
}

export async function startConversation(username) {
  const res = await fetch(`${API_BASE}/conversations/with/${username}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to start conversation');
  return data;
}


export async function getMessages(conversationId, cursor = null) {
  const url = cursor
    ? `${API_BASE}/conversations/${conversationId}/messages?cursor=${encodeURIComponent(cursor)}`
    : `${API_BASE}/conversations/${conversationId}/messages`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${getToken()}` }
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch messages');
  return data;
}

export async function sendMessage(conversationId, encrypted_content) {
  const res = await fetch(`${API_BASE}/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`
    },
    body: JSON.stringify({ encrypted_content })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to send message');
  return data;
}

export async function markConversationRead(conversationId, last_read_message_id) {
  const res = await fetch(`${API_BASE}/conversations/${conversationId}/read`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`
    },
    body: JSON.stringify({ last_read_message_id })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to mark conversation as read');
  return data;
}
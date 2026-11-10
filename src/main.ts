/* ======================= Стили ======================= */

const APP_CSS = `
:root {
  --bg: #f3f4f6; --card: #fff; --text: #111827; --muted: #6b7280;
  --accent: #2563eb; --mine: #dbeafe; --border: #e5e7eb; --err: #dc2626;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #111827; --card: #1f2937; --text: #f9fafb; --muted: #9ca3af; --mine: #1e3a8a; --border: #374151; }
}
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); }
#app { height: 100%; }
.center { height: 100%; display: flex; align-items: center; justify-content: center; padding: 16px; }
.card { background: var(--card); padding: 24px; border-radius: 12px; width: 100%; max-width: 360px; display: flex; flex-direction: column; gap: 12px; box-shadow: 0 4px 20px rgba(0,0,0,.08); }
.card h1 { margin: 0 0 4px; font-size: 22px; }
input { padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 16px; background: var(--bg); color: var(--text); }
button { padding: 10px 14px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; font-size: 15px; cursor: pointer; }
button:disabled { opacity: .5; cursor: not-allowed; }
button.secondary { background: transparent; color: var(--text); border: 1px solid var(--border); }
button.link { background: none; color: var(--accent); padding: 4px; }
.error { color: var(--err); font-size: 14px; min-height: 1em; }
.chat { height: 100%; max-width: 800px; margin: 0 auto; display: flex; flex-direction: column; background: var(--card); }
header { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.spacer { flex: 1; }
.me { color: var(--muted); font-size: 14px; }
.status { font-size: 13px; color: var(--muted); }
.status[data-state='connected'] { color: #16a34a; }
.status[data-state='disconnected'] { color: var(--err); }
.messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 8px; }
.msg { max-width: 75%; padding: 8px 12px; border-radius: 12px; background: var(--bg); align-self: flex-start; }
.msg.mine { background: var(--mine); align-self: flex-end; }
.msg .meta { font-size: 12px; color: var(--muted); margin-bottom: 2px; }
.msg .text { white-space: pre-wrap; overflow-wrap: anywhere; }
.composer { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border); }
.composer input { flex: 1; }
`;
document.head.append(Object.assign(document.createElement('style'), { textContent: APP_CSS }));

/* ======================= Конфиг ======================= */

const API_BASE = 'https://inai-col3.fishrungames.com/api';
const WS_URL = 'wss://inai-col3.fishrungames.com/chat/';

const ENDPOINTS = {
  register: '/register/',
  login: '/login/',
  refresh: '/refresh/', // проверьте путь в swagger
  logout: '/logout/',
};

/* ======================= API ======================= */

class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

function extractMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    for (const key of ['detail', 'message', 'error']) {
      if (typeof d[key] === 'string') return d[key] as string;
    }
    const parts = Object.entries(d).map(
      ([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`,
    );
    if (parts.length) return parts.join('; ');
  }
  return fallback;
}

async function post<T>(path: string, body: unknown, accessToken?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method: 'POST',
      credentials: 'include', // refresh-токен в HttpOnly cookie
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Нет соединения с сервером', 0);
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* не JSON */
  }
  if (!res.ok) throw new ApiError(extractMessage(data, `Ошибка ${res.status}`), res.status);
  return data as T;
}

/* ======================= Авторизация ======================= */

const STORAGE_KEY = 'chat_access';

interface AuthResponse {
  access: string;
}

const getAccess = (): string | null => localStorage.getItem(STORAGE_KEY);
const clearAccess = (): void => localStorage.removeItem(STORAGE_KEY);
const isLoggedIn = (): boolean => getAccess() !== null;

function decodePayload(token: string): Record<string, any> | null {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(part)
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function getUsername(): string | null {
  const t = getAccess();
  return t ? (decodePayload(t)?.username ?? null) : null;
}

function isExpired(token: string, skewSec = 15): boolean {
  const exp = decodePayload(token)?.exp;
  return typeof exp !== 'number' || exp * 1000 - skewSec * 1000 < Date.now();
}

function takeAccess(data: AuthResponse): void {
  if (!data?.access) throw new Error('Сервер не вернул access токен');
  localStorage.setItem(STORAGE_KEY, data.access);
}

async function register(username: string, password: string): Promise<void> {
  takeAccess(await post<AuthResponse>(ENDPOINTS.register, { username, password }));
}

async function login(username: string, password: string): Promise<void> {
  takeAccess(await post<AuthResponse>(ENDPOINTS.login, { username, password }));
}

async function getValidAccessToken(force = false): Promise<string> {
  const access = getAccess();
  if (!access) throw new Error('Не авторизован');
  if (!force && !isExpired(access)) return access;
  try {
    const data = await post<AuthResponse>(ENDPOINTS.refresh, {});
    takeAccess(data);
    return data.access;
  } catch (e) {
    clearAccess();
    throw e;
  }
}

async function logout(): Promise<void> {
  const access = getAccess();
  clearAccess();
  try {
    await post(ENDPOINTS.logout, {}, access ?? undefined);
  } catch {
    /* локальный выход уже выполнен */
  }
}

/* ======================= WebSocket-клиент ======================= */

interface ChatMessage {
  sender: string;
  text: string;
  timestamp: number;
}

type Status = 'connecting' | 'connected' | 'disconnected';

interface Handlers {
  onStatus: (s: Status) => void;
  onMessage: (m: ChatMessage) => void;
  onAuthFailed: () => void;
}

class ChatClient {
  private ws: WebSocket | null = null;
  private authed = false;
  private manualClose = false;
  private forceRefresh = false;
  private authFailures = 0;
  private timer: number | undefined;

  constructor(private h: Handlers) {}

  async connect(): Promise<void> {
    this.manualClose = false;
    this.authed = false;
    this.h.onStatus('connecting');

    let token: string;
    try {
      token = await getValidAccessToken(this.forceRefresh);
      this.forceRefresh = false;
    } catch {
      this.h.onAuthFailed();
      return;
    }
    if (this.manualClose) return;

    const ws = new WebSocket(WS_URL);
    this.ws = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'AUTH', payload: { token } }));
    };

    ws.onmessage = (ev) => {
      let msg: any;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === 'AUTH_SUCCESS') {
        this.authed = true;
        this.authFailures = 0;
        this.h.onStatus('connected');
      } else if (msg.type === 'NEW_MESSAGE' && msg.payload) {
        this.h.onMessage(msg.payload as ChatMessage);
      }
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      const wasAuthed = this.authed;
      this.authed = false;
      this.h.onStatus('disconnected');
      if (this.manualClose) return;

      if (!wasAuthed) {
        this.authFailures++;
        if (this.authFailures >= 2) {
          this.h.onAuthFailed();
          return;
        }
        this.forceRefresh = true;
      }
      this.timer = window.setTimeout(() => void this.connect(), 1500);
    };
  }

  send(text: string): boolean {
    if (!this.authed || !this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ type: 'CHAT_MESSAGE', payload: { text } }));
    return true;
  }

  disconnect(): void {
    this.manualClose = true;
    window.clearTimeout(this.timer);
    const ws = this.ws;
    this.ws = null;
    this.authed = false;
    ws?.close();
  }
}

/* ======================= Интерфейс ======================= */

const app = document.getElementById('app') as HTMLElement;
let chat: ChatClient | null = null;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function renderAuth(): void {
  let mode: 'login' | 'register' = 'login';

  const title = el('h1');
  const username = el('input', { type: 'text', placeholder: 'Имя пользователя', autocomplete: 'username', required: true });
  const password = el('input', { type: 'password', placeholder: 'Пароль', required: true });
  const error = el('div', { className: 'error' });
  const submit = el('button', { type: 'submit' });
  const toggle = el('button', { type: 'button', className: 'link' });

  const form = el('form', { className: 'card' }, title, username, password, error, submit, toggle);

  function refresh(): void {
    const isLogin = mode === 'login';
    title.textContent = isLogin ? 'Вход' : 'Регистрация';
    submit.textContent = isLogin ? 'Войти' : 'Зарегистрироваться';
    toggle.textContent = isLogin ? 'Нет аккаунта? Регистрация' : 'Уже есть аккаунт? Войти';
    password.autocomplete = isLogin ? 'current-password' : 'new-password';
    error.textContent = '';
  }

  toggle.onclick = () => {
    mode = mode === 'login' ? 'register' : 'login';
    refresh();
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    error.textContent = '';
    submit.disabled = true;
    try {
      const u = username.value.trim();
      if (mode === 'login') await login(u, password.value);
      else await register(u, password.value);
      renderChat();
    } catch (err) {
      error.textContent = err instanceof Error ? err.message : 'Ошибка';
    } finally {
      submit.disabled = false;
    }
  };

  refresh();
  app.replaceChildren(el('div', { className: 'center' }, form));
}

const STATUS_TEXT: Record<Status, string> = {
  connecting: 'Подключение…',
  connected: 'Онлайн',
  disconnected: 'Нет соединения',
};

function renderChat(): void {
  const me = getUsername();

  const status = el('span', { className: 'status' });
  const logoutBtn = el('button', { className: 'secondary', textContent: 'Выйти' });
  const header = el(
    'header',
    {},
    el('strong', {}, 'Групповой чат'),
    el('span', { className: 'spacer' }),
    el('span', { className: 'me' }, me ? `Вы: ${me}` : ''),
    status,
    logoutBtn,
  );

  const list = el('div', { className: 'messages' });
  const input = el('input', { type: 'text', placeholder: 'Введите сообщение…', disabled: true, maxLength: 1000 });
  const sendBtn = el('button', { type: 'submit', textContent: 'Отправить', disabled: true });
  const form = el('form', { className: 'composer' }, input, sendBtn);

  app.replaceChildren(el('div', { className: 'chat' }, header, list, form));

  function addMessage(m: ChatMessage): void {
    const mine = m.sender === me;
    const time = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const bubble = el(
      'div',
      { className: 'msg' + (mine ? ' mine' : '') },
      el('div', { className: 'meta' }, `${m.sender} · ${time}`),
      el('div', { className: 'text' }, m.text),
    );
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    list.append(bubble);
    if (nearBottom || mine) list.scrollTop = list.scrollHeight;
  }

  chat?.disconnect();
  chat = new ChatClient({
    onStatus: (s) => {
      status.textContent = STATUS_TEXT[s];
      status.dataset.state = s;
      const ok = s === 'connected';
      input.disabled = !ok;
      sendBtn.disabled = !ok;
      if (ok) input.focus();
    },
    onMessage: addMessage,
    onAuthFailed: () => {
      chat?.disconnect();
      chat = null;
      void logout().then(renderAuth);
    },
  });

  form.onsubmit = (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    if (chat?.send(text)) input.value = '';
  };

  logoutBtn.onclick = async () => {
    chat?.disconnect();
    chat = null;
    await logout();
    renderAuth();
  };

  void chat.connect();
}

/* ======================= Старт ======================= */

if (isLoggedIn()) renderChat();
else renderAuth();

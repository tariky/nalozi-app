import { getDB } from '../db';
import type { User, UserForm, AuthUser, Session, Mechanic } from '../types';

// Generate a random session ID
function generateSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Get session from cookie header
function getSessionFromRequest(req: Request): string | null {
  const cookie = req.headers.get('cookie');
  if (!cookie) return null;

  const match = cookie.match(/session=([^;]+)/);
  return match ? match[1] : null;
}

// Get current user from session
export function getCurrentUser(req: Request): AuthUser | null {
  const sessionId = getSessionFromRequest(req);
  if (!sessionId) return null;

  const db = getDB();

  // Get session and check if valid
  const session = db.query<Session, [string]>(
    'SELECT * FROM sessions WHERE id = ? AND expires_at > datetime("now")'
  ).get(sessionId);

  if (!session) return null;

  // Get user
  const user = db.query<User, [number]>(
    'SELECT * FROM users WHERE id = ?'
  ).get(session.user_id);

  if (!user) return null;

  // Get mechanic if linked
  let mechanic: Mechanic | undefined;
  if (user.mechanic_id) {
    mechanic = db.query<Mechanic, [number]>(
      'SELECT * FROM mechanics WHERE id = ?'
    ).get(user.mechanic_id) || undefined;
  }

  return {
    id: user.id,
    username: user.username,
    role: user.role,
    mechanic_id: user.mechanic_id,
    mechanic,
  };
}

// POST /api/auth/login
export async function login(req: Request): Promise<Response> {
  const { username, password } = await req.json();

  if (!username || !password) {
    return Response.json({ message: 'Korisničko ime i lozinka su obavezni' }, { status: 400 });
  }

  const db = getDB();

  // Find user
  const user = db.query<User, [string]>(
    'SELECT * FROM users WHERE username = ?'
  ).get(username);

  if (!user) {
    return Response.json({ message: 'Pogrešno korisničko ime ili lozinka' }, { status: 401 });
  }

  // Verify password
  const valid = await Bun.password.verify(password, user.password_hash);
  if (!valid) {
    return Response.json({ message: 'Pogrešno korisničko ime ili lozinka' }, { status: 401 });
  }

  // Create session (expires in 7 days)
  const sessionId = generateSessionId();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  db.query<null, [string, number, string]>(
    'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)'
  ).run(sessionId, user.id, expiresAt);

  // Get mechanic if linked
  let mechanic: Mechanic | undefined;
  if (user.mechanic_id) {
    mechanic = db.query<Mechanic, [number]>(
      'SELECT * FROM mechanics WHERE id = ?'
    ).get(user.mechanic_id) || undefined;
  }

  const authUser: AuthUser = {
    id: user.id,
    username: user.username,
    role: user.role,
    mechanic_id: user.mechanic_id,
    mechanic,
  };

  return new Response(JSON.stringify(authUser), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `session=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${7 * 24 * 60 * 60}`,
    },
  });
}

// POST /api/auth/logout
export function logout(req: Request): Response {
  const sessionId = getSessionFromRequest(req);

  if (sessionId) {
    const db = getDB();
    db.query<null, [string]>('DELETE FROM sessions WHERE id = ?').run(sessionId);
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': 'session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
    },
  });
}

// GET /api/auth/me - Get current user
export function me(req: Request): Response {
  const user = getCurrentUser(req);

  if (!user) {
    return Response.json({ message: 'Niste prijavljeni' }, { status: 401 });
  }

  return Response.json(user);
}

// GET /api/users - List all users (admin only)
export function getUsers(req: Request): Response {
  const currentUser = getCurrentUser(req);

  if (!currentUser || currentUser.role !== 'admin') {
    return Response.json({ message: 'Nemate pristup' }, { status: 403 });
  }

  const db = getDB();

  const users = db.query<User & { mechanic_ime?: string; mechanic_prezime?: string }, []>(
    `SELECT u.*, m.ime as mechanic_ime, m.prezime as mechanic_prezime
     FROM users u
     LEFT JOIN mechanics m ON u.mechanic_id = m.id
     ORDER BY u.created_at DESC`
  ).all();

  // Transform to include nested mechanic
  const result = users.map(u => ({
    id: u.id,
    username: u.username,
    role: u.role,
    mechanic_id: u.mechanic_id,
    created_at: u.created_at,
    mechanic: u.mechanic_id ? {
      id: u.mechanic_id,
      ime: u.mechanic_ime,
      prezime: u.mechanic_prezime,
    } : undefined,
  }));

  return Response.json(result);
}

// POST /api/users - Create user (admin only)
export async function createUser(req: Request): Promise<Response> {
  const currentUser = getCurrentUser(req);

  if (!currentUser || currentUser.role !== 'admin') {
    return Response.json({ message: 'Nemate pristup' }, { status: 403 });
  }

  const data: UserForm = await req.json();

  if (!data.username || !data.password || !data.role) {
    return Response.json({ message: 'Korisničko ime, lozinka i uloga su obavezni' }, { status: 400 });
  }

  if (data.role === 'mechanic' && !data.mechanic_id) {
    return Response.json({ message: 'Morate odabrati mehaničara za ovaj račun' }, { status: 400 });
  }

  const db = getDB();

  // Check if username exists
  const existing = db.query<{ id: number }, [string]>(
    'SELECT id FROM users WHERE username = ?'
  ).get(data.username);

  if (existing) {
    return Response.json({ message: 'Korisničko ime već postoji' }, { status: 400 });
  }

  // Check if mechanic already has an account
  if (data.mechanic_id) {
    const existingMechanicUser = db.query<{ id: number }, [number]>(
      'SELECT id FROM users WHERE mechanic_id = ?'
    ).get(data.mechanic_id);

    if (existingMechanicUser) {
      return Response.json({ message: 'Ovaj mehaničar već ima korisnički račun' }, { status: 400 });
    }
  }

  // Hash password
  const passwordHash = await Bun.password.hash(data.password, {
    algorithm: "bcrypt",
    cost: 10,
  });

  const result = db.query<{ id: number }, [string, string, string, number | null]>(
    'INSERT INTO users (username, password_hash, role, mechanic_id) VALUES (?, ?, ?, ?) RETURNING id'
  ).get(data.username, passwordHash, data.role, data.mechanic_id || null);

  // Get created user with mechanic
  const user = db.query<User & { mechanic_ime?: string; mechanic_prezime?: string }, [number]>(
    `SELECT u.*, m.ime as mechanic_ime, m.prezime as mechanic_prezime
     FROM users u
     LEFT JOIN mechanics m ON u.mechanic_id = m.id
     WHERE u.id = ?`
  ).get(result!.id);

  return Response.json({
    id: user!.id,
    username: user!.username,
    role: user!.role,
    mechanic_id: user!.mechanic_id,
    created_at: user!.created_at,
    mechanic: user!.mechanic_id ? {
      id: user!.mechanic_id,
      ime: user!.mechanic_ime,
      prezime: user!.mechanic_prezime,
    } : undefined,
  }, { status: 201 });
}

// DELETE /api/users/:id - Delete user (admin only)
export function deleteUser(req: Request): Response {
  const currentUser = getCurrentUser(req);

  if (!currentUser || currentUser.role !== 'admin') {
    return Response.json({ message: 'Nemate pristup' }, { status: 403 });
  }

  const url = new URL(req.url);
  const id = parseInt(url.pathname.split('/').pop() || '0');

  // Don't allow deleting self
  if (id === currentUser.id) {
    return Response.json({ message: 'Ne možete obrisati vlastiti račun' }, { status: 400 });
  }

  const db = getDB();

  // Check if user exists
  const existing = db.query<{ id: number }, [number]>(
    'SELECT id FROM users WHERE id = ?'
  ).get(id);

  if (!existing) {
    return Response.json({ message: 'Korisnik nije pronađen' }, { status: 404 });
  }

  // Delete user (sessions will cascade)
  db.query<null, [number]>('DELETE FROM users WHERE id = ?').run(id);

  return Response.json({ success: true });
}

// PUT /api/users/:id/password - Change password (admin or self)
export async function changePassword(req: Request): Promise<Response> {
  const currentUser = getCurrentUser(req);

  if (!currentUser) {
    return Response.json({ message: 'Niste prijavljeni' }, { status: 401 });
  }

  const url = new URL(req.url);
  const id = parseInt(url.pathname.split('/')[3] || '0');

  // Only admin can change other users' passwords
  if (id !== currentUser.id && currentUser.role !== 'admin') {
    return Response.json({ message: 'Nemate pristup' }, { status: 403 });
  }

  const { password } = await req.json();

  if (!password || password.length < 4) {
    return Response.json({ message: 'Lozinka mora imati najmanje 4 karaktera' }, { status: 400 });
  }

  const db = getDB();

  // Hash new password
  const passwordHash = await Bun.password.hash(password, {
    algorithm: "bcrypt",
    cost: 10,
  });

  db.query<null, [string, number]>(
    'UPDATE users SET password_hash = ? WHERE id = ?'
  ).run(passwordHash, id);

  return Response.json({ success: true });
}

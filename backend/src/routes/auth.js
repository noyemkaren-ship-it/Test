import { Router } from 'express';
import { randomUUID } from 'crypto';
import { authRequired, signToken, checkPassword, hashPassword } from '../middleware/auth.js';
import { validateRegisterBody } from '../middleware/security.js';
import { getDb } from '../utils/helper.js';
import { DEFAULT_PROFILE } from '../engines/ontology.js';

const router = Router();

router.get('/auth/me', authRequired, (req, res) => {
  const db = getDb();
  const id = req.user?.sub || req.user?.id;
  if (!id || id === 'api') return res.json({ user: { id: 'api', role: 'service', email: null } });
  const user = db.prepare('SELECT id, email, name, role, workspace_id FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'user not found' });
  const memberships = db.prepare('SELECT workspace_id, role FROM memberships WHERE user_id = ?').all(id);
  res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      workspaceId: user.workspace_id,
      memberships
    }
  });
});

router.post('/auth/login', (req, res) => {
  const db = getDb();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!email || !password) return res.status(400).json({ error: 'email/password required' });
  const user = db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(email);
  if (!user || !checkPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = signToken({ id: user.id, email: user.email, workspaceId: user.workspace_id, role: user.role });
  res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, workspaceId: user.workspace_id }
  });
});

router.post('/auth/register', validateRegisterBody, (req, res) => {
  const db = getDb();
  const email = String(req.body.email).trim().toLowerCase();
  const password = String(req.body.password);
  const name = String(req.body.name || email.split('@')[0]).trim().slice(0, 120) || email.split('@')[0];
  if (db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(email)) return res.status(409).json({ error: 'Account already exists' });

  const requestedWs = req.body.workspaceId ? String(req.body.workspaceId) : null;
  const publicJoinWs = process.env.PUBLIC_REGISTRATION_WORKSPACE_ID || null;
  if (requestedWs && requestedWs !== publicJoinWs) {
    return res.status(403).json({ error: 'Joining an existing workspace requires an invitation' });
  }

  const id = randomUUID();
  const ws = requestedWs || `ws-${randomUUID()}`;
  const tx = db.transaction(() => {
    if (!requestedWs) {
      db.prepare('INSERT INTO workspaces (id, name, type) VALUES (?, ?, ?)')
        .run(ws, `${name} Workspace`.slice(0, 160), 'studio');
      db.prepare('INSERT OR REPLACE INTO ontology (workspace_id, graph_id, profile_json) VALUES (?, NULL, ?)')
        .run(ws, JSON.stringify(DEFAULT_PROFILE));
    } else if (!db.prepare('SELECT id FROM workspaces WHERE id = ?').get(ws)) {
      throw new Error('Registration workspace not found');
    }

    db.prepare('INSERT INTO users (id, email, password_hash, name, role, workspace_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, email, hashPassword(password), name, 'member', ws);
    db.prepare('INSERT INTO memberships (user_id, workspace_id, role) VALUES (?, ?, ?)')
      .run(id, ws, requestedWs ? 'member' : 'admin');
  });

  try {
    tx();
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Registration failed' });
  }

  const token = signToken({ id, email, workspaceId: ws, role: 'member' });
  res.status(201).json({ token, user: { id, email, name, role: 'member', workspaceId: ws } });
});

export default router;

const express = require('express');
const multer = require('multer');
const Database = require('better-sqlite3');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

const db = new Database('database.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar_color TEXT DEFAULT '#667eea',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    file_path TEXT,
    file_name TEXT,
    file_type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(post_id) REFERENCES posts(id)
  );
  CREATE TABLE IF NOT EXISTS hearts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(post_id) REFERENCES posts(id)
  );
`);

try {
  const postCols = db.prepare("PRAGMA table_info(posts)").all().map(c => c.name);
  if (!postCols.includes('user_id')) db.exec('ALTER TABLE posts ADD COLUMN user_id INTEGER');
  const cmtCols = db.prepare("PRAGMA table_info(comments)").all().map(c => c.name);
  if (!cmtCols.includes('user_id')) db.exec('ALTER TABLE comments ADD COLUMN user_id INTEGER');
} catch (e) {}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'bio-app-secret-key-change-me-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 30 }
}));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Chưa đăng nhập' });
  next();
}

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, displayName } = req.body;
    if (!username || !password || !displayName)
      return res.status(400).json({ error: 'Vui lòng nhập đầy đủ thông tin' });
    if (username.length < 3 || username.length > 30)
      return res.status(400).json({ error: 'Tên đăng nhập phải từ 3-30 ký tự' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Mật khẩu phải từ 6 ký tự' });
    if (!/^[a-zA-Z0-9_]+$/.test(username))
      return res.status(400).json({ error: 'Tên đăng nhập chỉ gồm chữ, số, gạch dưới' });

    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username.toLowerCase());
    if (exists) return res.status(400).json({ error: 'Tên đăng nhập đã tồn tại' });

    const hash = await bcrypt.hash(password, 10);
    const colors = ['#667eea','#764ba2','#f093fb','#4facfe','#43e97b','#fa709a','#ff6b6b','#feca57','#48dbfb','#ff9ff3'];
    const color = colors[Math.floor(Math.random() * colors.length)];

    const info = db.prepare(
      'INSERT INTO users (username, password, display_name, avatar_color) VALUES (?, ?, ?, ?)'
    ).run(username.toLowerCase(), hash, displayName, color);

    req.session.userId = info.lastInsertRowid;
    const user = db.prepare('SELECT id, username, display_name, avatar_color FROM users WHERE id = ?').get(info.lastInsertRowid);
    res.json({ user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Không thể tạo tài khoản' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Thiếu thông tin' });

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase());
    if (!user) return res.status(400).json({ error: 'Sai tên đăng nhập hoặc mật khẩu' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ error: 'Sai tên đăng nhập hoặc mật khẩu' });

    req.session.userId = user.id;
    res.json({
      user: { id: user.id, username: user.username, display_name: user.display_name, avatar_color: user.avatar_color }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Không thể đăng nhập' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = db.prepare('SELECT id, username, display_name, avatar_color FROM users WHERE id = ?').get(req.session.userId);
  res.json({ user: user || null });
});

app.get('/api/posts', (req, res) => {
  const posts = db.prepare(`
    SELECT p.*, u.avatar_color, u.username
    FROM posts p
    LEFT JOIN users u ON p.user_id = u.id
    ORDER BY p.created_at DESC
  `).all();

  const result = posts.map(p => {
    const comments = db.prepare(`
      SELECT c.*, u.avatar_color AS user_color, u.username
      FROM comments c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.post_id = ?
      ORDER BY c.created_at ASC
    `).all(p.id);

    const hearts = db.prepare('SELECT COUNT(*) as count FROM hearts WHERE post_id = ?').get(p.id).count;
    const userLiked = req.session.userId
      ? db.prepare('SELECT 1 FROM hearts WHERE post_id = ? AND user_id = ?').get(p.id, 'u_' + req.session.userId)
      : null;

    return {
      ...p,
      avatar_color: p.avatar_color || '#667eea',
      comments,
      hearts,
      userLiked: !!userLiked,
      canDelete: req.session.userId === p.user_id
    };
  });
  res.json(result);
});

app.post('/api/posts', requireAuth, upload.single('file'), (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Nội dung trống' });

  const user = db.prepare('SELECT display_name FROM users WHERE id = ?').get(req.session.userId);
  const filePath = req.file ? '/uploads/' + req.file.filename : null;
  const fileName = req.file ? req.file.originalname : null;
  const fileType = req.file ? req.file.mimetype : null;

  const info = db.prepare(
    'INSERT INTO posts (user_id, name, content, file_path, file_name, file_type) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.session.userId, user.display_name, content.trim(), filePath, fileName, fileType);

  res.json({ id: info.lastInsertRowid });
});

app.delete('/api/posts/:id', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Không tìm thấy bài' });
  if (post.user_id !== req.session.userId) return res.status(403).json({ error: 'Không có quyền xóa' });

  if (post.file_path) {
    const fp = path.join(__dirname, post.file_path);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  db.prepare('DELETE FROM comments WHERE post_id = ?').run(req.params.id);
  db.prepare('DELETE FROM hearts WHERE post_id = ?').run(req.params.id);
  db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.post('/api/posts/:id/comments', requireAuth, (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Nội dung trống' });

  const user = db.prepare('SELECT display_name FROM users WHERE id = ?').get(req.session.userId);
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Không tìm thấy bài viết' });

  db.prepare('INSERT INTO comments (post_id, user_id, name, content) VALUES (?, ?, ?, ?)')
    .run(req.params.id, req.session.userId, user.display_name, content.trim());
  res.json({ success: true });
});

app.delete('/api/comments/:id', requireAuth, (req, res) => {
  const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Không tìm thấy' });
  if (c.user_id !== req.session.userId) return res.status(403).json({ error: 'Không có quyền xóa' });
  db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.post('/api/posts/:id/hearts', requireAuth, (req, res) => {
  const postId = req.params.id;
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(postId);
  if (!post) return res.status(404).json({ error: 'Không tìm thấy bài viết' });
  const userId = 'u_' + req.session.userId;
  const exists = db.prepare('SELECT id FROM hearts WHERE post_id = ? AND user_id = ?').get(postId, userId);
  if (!exists) db.prepare('INSERT INTO hearts (post_id, user_id) VALUES (?, ?)').run(postId, userId);
  const count = db.prepare('SELECT COUNT(*) as count FROM hearts WHERE post_id = ?').get(postId).count;
  res.json({ hearts: count });
});

app.listen(PORT, () => {
  console.log(`✅ Server chạy tại http://localhost:${PORT}`);
});

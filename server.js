import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Разрешённые URL фронтенда для CORS
const CLIENT_URLS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'https://a-schat.vercel.app', // твой продакшен фронтенд
];

// Создаем Express приложение и HTTP сервер
const app = express();
const server = createServer(app);

// CORS Middleware с whitelist и обработкой запросов без origin
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || CLIENT_URLS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS policy: origin ${origin} not allowed`));
    }
  },
  credentials: true,
}));

// JSON body parser
app.use(express.json());


// Создаем папку uploads, если её нет
try {
  await fs.mkdir(path.join(__dirname, 'uploads'), { recursive: true });
} catch {
  // Папка уже есть — ничего делать не нужно
}

// Статика для загруженных файлов
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Настройка multer для загрузки файлов
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

// Временное хранилище данных (замени на БД в продакшене)
let users = [];
let chats = [];
let messages = [];
let sessions = [];
let connectedUsers = new Map();

// Функция для загрузки данных из файлов
const loadData = async () => {
  try {
    await fs.mkdir(path.join(__dirname, 'data'), { recursive: true });
    const usersData = await fs.readFile(path.join(__dirname, 'data', 'users.json'), 'utf-8');
    users = JSON.parse(usersData);
  } catch {
    console.log('No users data found, starting fresh');
  }
  try {
    const chatsData = await fs.readFile(path.join(__dirname, 'data', 'chats.json'), 'utf-8');
    chats = JSON.parse(chatsData);
  } catch {
    console.log('No chats data found, starting fresh');
  }
  try {
    const messagesData = await fs.readFile(path.join(__dirname, 'data', 'messages.json'), 'utf-8');
    messages = JSON.parse(messagesData);
  } catch {
    console.log('No messages data found, starting fresh');
  }
};

// Функция для сохранения данных в файлы
const saveData = async () => {
  try {
    await fs.mkdir(path.join(__dirname, 'data'), { recursive: true });
    await fs.writeFile(path.join(__dirname, 'data', 'users.json'), JSON.stringify(users, null, 2));
    await fs.writeFile(path.join(__dirname, 'data', 'chats.json'), JSON.stringify(chats, null, 2));
    await fs.writeFile(path.join(__dirname, 'data', 'messages.json'), JSON.stringify(messages, null, 2));
  } catch (error) {
    console.error('Error saving data:', error);
  }
};

// Загружаем данные при запуске сервера
await loadData();

// Роут для проверки работоспособности сервера
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: NODE_ENV 
  });
});

// Аутентификация - регистрация
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    if (users.find(u => u.email === email)) {
      return res.status(400).json({ message: 'User already exists' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = {
      id: uuidv4(),
      email,
      fullName,
      password: hashedPassword,
      avatar: '',
      status: 'Available',
      createdAt: new Date().toISOString()
    };
    users.push(user);
    await saveData();
    const token = uuidv4();
    sessions.push({ token, userId: user.id });
    const { password: _, ...userWithoutPassword } = user;
    res.json({ user: userWithoutPassword, token });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Аутентификация - логин
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = users.find(u => u.email === email);
    if (!user) return res.status(400).json({ message: 'Invalid credentials' });
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) return res.status(400).json({ message: 'Invalid credentials' });
    const token = uuidv4();
    sessions.push({ token, userId: user.id });
    const { password: _, ...userWithoutPassword } = user;
    res.json({ user: userWithoutPassword, token });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Получение списка пользователей (без паролей)
app.get('/api/users', (req, res) => {
  const usersWithoutPasswords = users.map(({ password, ...user }) => user);
  res.json(usersWithoutPasswords);
});

// Обновление данных пользователя
app.put('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { fullName, status, bio, avatar } = req.body;
    const userIndex = users.findIndex(u => u.id === id);
    if (userIndex === -1) return res.status(404).json({ message: 'User not found' });
    users[userIndex] = { 
      ...users[userIndex], 
      fullName, 
      status, 
      bio: bio || users[userIndex].bio || '',
      avatar: avatar || users[userIndex].avatar || ''
    };
    await saveData();
    const { password: _, ...userWithoutPassword } = users[userIndex];
    res.json(userWithoutPassword);
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Получение чатов пользователя
app.get('/api/chats', (req, res) => {
  const { userId } = req.query;
  const userChats = chats.filter(chat => 
    chat.participants.some(p => p.id === userId)
  ).map(chat => {
    const lastMessage = messages
      .filter(m => m.chatId === chat.id)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
    
    return {
      ...chat,
      lastMessage,
      lastMessageTime: lastMessage?.timestamp
    };
  }).sort((a, b) => new Date(b.lastMessageTime || 0) - new Date(a.lastMessageTime || 0));
  res.json(userChats);
});

// Создание нового чата
app.post('/api/chats', async (req, res) => {
  try {
    const { participants, type, name, createdBy, ...chatData } = req.body;
    if (type === 'private' && participants.length === 2) {
      const existingChat = chats.find(chat => 
        chat.type === 'private' && 
        chat.participants.length === 2 &&
        chat.participants.every(p => participants.some(pp => pp.id === p.id))
      );
      if (existingChat) return res.json(existingChat);
    }
    const chat = {
      id: uuidv4(),
      name,
      type,
      participants,
      createdBy,
      createdAt: new Date().toISOString(),
      ...chatData,
      settings: {
        canAddMembers: type === 'group',
        canPostMessages: type === 'channel' ? 'admin' : 'all',
        ...(chatData.settings || {})
      }
    };
    chats.push(chat);
    await saveData();
    res.json(chat);
  } catch (error) {
    console.error('Create chat error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Получение сообщений чата
app.get('/api/messages/:chatId', (req, res) => {
  const { chatId } = req.params;
  const chatMessages = messages.filter(m => m.chatId === chatId)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  res.json(chatMessages);
});

// Загрузка файлов
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  res.json({
    filename: req.file.filename,
    path: `/uploads/${req.file.filename}`,
    size: req.file.size,
    mimetype: req.file.mimetype
  });
});

// Socket.IO обработчики
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id} at ${new Date().toISOString()}`);

  socket.on('authenticate', ({ userId }) => {
    socket.userId = userId;
    connectedUsers.set(userId, socket.id);
    io.emit('online_users', Array.from(connectedUsers.keys()));
  });

  socket.on('join_chat', (chatId) => {
    socket.join(chatId);
  });

  socket.on('send_message', async (messageData) => {
    try {
      const message = {
        ...messageData,
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        readBy: [messageData.senderId]
      };
      messages.push(message);
      await saveData();
      io.to(messageData.chatId).emit('message', message);
    } catch (error) {
      console.error('Send message error:', error);
    }
  });

  socket.on('typing', ({ chatId, isTyping }) => {
    socket.to(chatId).emit('user_typing', {
      userId: socket.userId,
      chatId,
      isTyping
    });
  });

  socket.on('mark_read', async ({ chatId, userId }) => {
    try {
      const chatMessages = messages.filter(m => m.chatId === chatId);
      chatMessages.forEach(message => {
        if (!message.readBy.includes(userId)) {
          message.readBy.push(userId);
        }
      });
      await saveData();
      io.to(chatId).emit('messages_read', { chatId, userId });
    } catch (error) {
      console.error('Mark read error:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id} at ${new Date().toISOString()}`);
    if (socket.userId) {
      connectedUsers.delete(socket.userId);
      io.emit('online_users', Array.from(connectedUsers.keys()));
    }
  });
});

// Обработка сигнала завершения (graceful shutdown)
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});

// Запуск сервера
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT} in ${NODE_ENV} mode`);
  console.log(`Allowed origins: ${CLIENT_URLS.join(', ')}`);
});

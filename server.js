import express from 'express';
import chatHandler from './api/chat.js';
import reportHandler from './api/report.js';
import { saveConversation, listConversations, getConversation } from './api/conversations.js';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.post('/api/chat', chatHandler);
app.post('/api/report', reportHandler);
app.post('/api/conversations', saveConversation);
app.get('/api/conversations', listConversations);
app.get('/api/conversations/:id', getConversation);

const PORT = 3001;
app.listen(PORT, () => console.log(`[api] listening on port ${PORT}`));

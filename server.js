import express from 'express';
import handler from './api/chat.js';

const app = express();
app.use(express.json());
app.post('/api/chat', handler);

const PORT = 3001;
app.listen(PORT, () => console.log(`[api] listening on port ${PORT}`));

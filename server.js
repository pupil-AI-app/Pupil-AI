import express from 'express';
import chatHandler from './api/chat.js';
import reportHandler from './api/report.js';

const app = express();
app.use(express.json());
app.post('/api/chat', chatHandler);
app.post('/api/report', reportHandler);

const PORT = 3001;
app.listen(PORT, () => console.log(`[api] listening on port ${PORT}`));

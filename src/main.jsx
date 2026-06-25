import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Send, ClipboardList, MessageCircle, Sparkles } from 'lucide-react';
import './styles.css';

const starterMessages = [
  {
    role: 'pupil',
    text: "Oh! I’m ready. What Earth idea are you teaching me today?"
  }
];

function PupilMark() {
  return (
    <div className="pupil-mark" aria-label="Pupil icon">
      <div className="antennae"><span></span><span></span><span></span></div>
      <div className="eye"><div className="spiral">◉</div></div>
      <div className="smile"></div>
    </div>
  );
}

function Landing({ onStart, onTeacher }) {
  return (
    <main className="screen landing">
      <section className="hero-card">
        <div className="badge"><Sparkles size={16} /> Pilot Prototype</div>
        <img src="/logo.png" alt="Pupil logo" className="hero-logo" />
        <div className="logo-name">Pupil-AI</div>
        <h1>Every student a teacher.</h1>
        <p className="lede">Pupil learns by asking students to explain what they know.</p>
        <div className="button-row">
          <button className="primary" onClick={onStart}>Start a student chat</button>
          <button className="secondary" onClick={onTeacher}>View teacher report</button>
        </div>
      </section>
    </main>
  );
}

function Chat({ onFinish }) {
  const [messages, setMessages] = useState(starterMessages);
  const [input, setInput] = useState('');

  function sendMessage() {
    const text = input.trim();
    if (!text) return;

    const studentMessage = { role: 'student', text };
    const pupilMessage = mockPupilReply(text);
    setMessages([...messages, studentMessage, pupilMessage]);
    setInput('');
  }

  function mockPupilReply(text) {
    const lower = text.toLowerCase();
    if (lower.includes('theme')) return { role: 'pupil', text: 'Wait... what happens that shows that theme?' };
    if (lower.includes('because') || lower.includes('caused')) return { role: 'pupil', text: 'Oh. What changes because of that?' };
    if (lower.includes('symbol') || lower.includes('represents')) return { role: 'pupil', text: 'Why show it that way instead of saying it directly?' };
    if (messages.length > 6) return { role: 'pupil', text: 'I think my picture is almost complete. Can I try saying it back?' };
    return { role: 'pupil', text: 'Can you tell me more about that part?' };
  }

  return (
    <main className="screen app-shell">
      <header className="topbar">
        <div className="brand"><PupilMark /><span>Pupil</span></div>
        <button className="ghost" onClick={onFinish}>Finish chat</button>
      </header>

      <section className="chat-panel">
        <div className="assignment-card">
          <span>Student task</span>
          <strong>Teach Pupil a concept from class.</strong>
        </div>

        <div className="messages">
          {messages.map((m, index) => (
            <div key={index} className={`message ${m.role}`}>
              <div className="message-label">{m.role === 'pupil' ? 'Pupil' : 'Student'}</div>
              <p>{m.text}</p>
            </div>
          ))}
        </div>

        <div className="composer">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="Teach Pupil something..."
          />
          <button className="send" onClick={sendMessage} aria-label="Send"><Send size={18} /></button>
        </div>
      </section>
    </main>
  );
}

function EndScreen({ onTeacher, onRestart }) {
  return (
    <main className="screen end-screen">
      <section className="hero-card small">
        <PupilMark />
        <h1>I think I understand now.</h1>
        <p className="lede">The conversation is saved for teacher review.</p>
        <div className="button-row">
          <button className="primary" onClick={onTeacher}>Open teacher report</button>
          <button className="secondary" onClick={onRestart}>Start over</button>
        </div>
      </section>
    </main>
  );
}

function TeacherReport({ onBack }) {
  return (
    <main className="screen report-shell">
      <header className="topbar">
        <div className="brand"><ClipboardList size={22} /><span>Teacher Report</span></div>
        <button className="ghost" onClick={onBack}>Back</button>
      </header>

      <section className="report-grid">
        <article className="report-card wide">
          <h2>Conversation Summary</h2>
          <p>The student explained a theme by connecting character choices, consequences, and symbolic moments. This is placeholder text until the backend summary engine is connected.</p>
        </article>

        <article className="report-card">
          <h2>Evidence of Understanding</h2>
          <ul>
            <li>Identified a major theme.</li>
            <li>Connected plot events to the theme.</li>
            <li>Explained cause and consequence.</li>
          </ul>
        </article>

        <article className="report-card">
          <h2>Unresolved Gaps</h2>
          <ul>
            <li>Needs more textual evidence.</li>
            <li>Could explain symbolic meaning with more precision.</li>
          </ul>
        </article>

        <article className="report-card wide transcript-card">
          <h2>Transcript</h2>
          <div className="transcript-line"><strong>Pupil:</strong> What Earth idea are you teaching me today?</div>
          <div className="transcript-line"><strong>Student:</strong> I want to teach you about a theme in Macbeth.</div>
          <div className="transcript-line"><strong>Pupil:</strong> What happens that shows that theme?</div>
        </article>
      </section>
    </main>
  );
}

function App() {
  const [screen, setScreen] = useState('landing');
  if (screen === 'chat') return <Chat onFinish={() => setScreen('end')} />;
  if (screen === 'end') return <EndScreen onTeacher={() => setScreen('report')} onRestart={() => setScreen('landing')} />;
  if (screen === 'report') return <TeacherReport onBack={() => setScreen('landing')} />;
  return <Landing onStart={() => setScreen('chat')} onTeacher={() => setScreen('report')} />;
}

createRoot(document.getElementById('root')).render(<App />);

import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Send, ClipboardList, MessageCircle, Sparkles } from 'lucide-react';
import './styles.css';

const starterMessages = [
  {
    role: 'pupil',
    text: "Hey there — I’m ready to learn! What on Earth are you going to teach me about?"
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

function GradeSelect({ onConfirm }) {
  const [grade, setGrade] = useState('');
  return (
    <main className="screen landing">
      <section className="hero-card small">
        <img src="/logo.png" alt="Pupil logo" className="hero-logo" />
        <div className="logo-name">Pupil-AI</div>
        <h1 style={{ fontSize: 'clamp(28px, 4vw, 48px)', marginBottom: 8 }}>What grade are you in?</h1>
        <p className="lede" style={{ marginBottom: 24 }}>Pupil will tailor the conversation to your level.</p>
        <div className="grade-row">
          <select
            className="grade-select"
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
          >
            <option value="" disabled>Select your grade</option>
            {[3,4,5,6,7,8,9,10,11,12].map(g => (
              <option key={g} value={g}>Grade {g}</option>
            ))}
          </select>
          <button className="primary" disabled={!grade} onClick={() => onConfirm(grade)}>
            Let's go →
          </button>
        </div>
      </section>
    </main>
  );
}

function SubjectSelect({ grade, onConfirm }) {
  const [subject, setSubject] = useState('');
  const [topic, setTopic] = useState('');
  const subjects = ['Math', 'English', 'Science', 'Social Studies', 'History', 'Geography', 'Art', 'Music', 'Physical Education', 'Other'];
  return (
    <main className="screen landing">
      <section className="hero-card">
        <img src="/logo.png" alt="Pupil logo" className="hero-logo" />
        <div className="logo-name">Pupil-AI</div>
        <h1 style={{ fontSize: 'clamp(28px, 4vw, 48px)', marginBottom: 8 }}>What are you studying?</h1>
        <p className="lede" style={{ marginBottom: 28 }}>Grade {grade} · Tell Pupil what you want to teach.</p>
        <div className="subject-row">
          <select
            className="grade-select"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          >
            <option value="" disabled>Subject</option>
            {subjects.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <input
            className="topic-input"
            type="text"
            placeholder="Topic (e.g. photosynthesis)"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && subject && topic.trim() && onConfirm(subject, topic.trim())}
          />
        </div>
        <div style={{ marginTop: 18 }}>
          <button
            className="primary"
            disabled={!subject || !topic.trim()}
            onClick={() => onConfirm(subject, topic.trim())}
          >
            Start chatting →
          </button>
        </div>
      </section>
    </main>
  );
}

function Chat({ grade, subject, topic, onFinish }) {
  const [messages, setMessages] = useState(starterMessages);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationState, setConversationState] = useState(null);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    const studentMessage = { role: 'student', text };
    const next = [...messages, studentMessage];
    setMessages(next);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: messages, conversationState, grade, subject }),
      });
      const data = await res.json();
      const reply = data.reply && data.reply.trim()
        ? data.reply.trim()
        : "I'm having trouble hearing that. Can you try again?";
      if (data.conversationState) setConversationState(data.conversationState);
      setMessages([...next, { role: 'pupil', text: reply }]);
    } catch {
      setMessages([...next, { role: 'pupil', text: "I'm having trouble hearing that. Can you try again?" }]);
    } finally {
      setLoading(false);
    }
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
            placeholder={loading ? 'Pupil is thinking…' : 'Teach Pupil something...'}
            disabled={loading}
          />
          <button className="send" onClick={sendMessage} aria-label="Send" disabled={loading}>
            <Send size={18} />
          </button>
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
  const [grade, setGrade] = useState(null);
  const [subject, setSubject] = useState(null);
  const [topic, setTopic] = useState(null);
  if (screen === 'grade') return <GradeSelect onConfirm={(g) => { setGrade(g); setScreen('subject'); }} />;
  if (screen === 'subject') return <SubjectSelect grade={grade} onConfirm={(s, t) => { setSubject(s); setTopic(t); setScreen('chat'); }} />;
  if (screen === 'chat') return <Chat grade={grade} subject={subject} topic={topic} onFinish={() => setScreen('end')} />;
  if (screen === 'end') return <EndScreen onTeacher={() => setScreen('report')} onRestart={() => setScreen('landing')} />;
  if (screen === 'report') return <TeacherReport onBack={() => setScreen('landing')} />;
  return <Landing onStart={() => setScreen('grade')} onTeacher={() => setScreen('report')} />;
}

createRoot(document.getElementById('root')).render(<App />);

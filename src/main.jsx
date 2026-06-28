import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Send, ClipboardList } from 'lucide-react';
import './styles.css';

const starterMessages = [
  {
    role: 'pupil',
    text: "Hey there — I'm ready to learn! What on Earth are you going to teach me about?"
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

function UFOIllustration() {
  return (
    <svg width="120" height="110" viewBox="0 0 120 110" fill="none" xmlns="http://www.w3.org/2000/svg" className="ufo-svg">
      <line x1="46" y1="95" x2="38" y2="108" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
      <line x1="60" y1="97" x2="60" y2="110" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
      <line x1="74" y1="95" x2="82" y2="108" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
      <line x1="35" y1="91" x2="24" y2="104" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.3"/>
      <line x1="85" y1="91" x2="96" y2="104" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.3"/>
      <ellipse cx="60" cy="82" rx="42" ry="14" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
      <ellipse cx="60" cy="76" rx="28" ry="9" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
      <ellipse cx="60" cy="71" rx="16" ry="14" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="60" cy="57" r="1.5" fill="white" opacity="0.7"/>
      <line x1="60" y1="55" x2="60" y2="48" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="42" cy="79" r="3" stroke="white" strokeWidth="1.3"/>
      <circle cx="60" cy="80" r="3" stroke="white" strokeWidth="1.3"/>
      <circle cx="78" cy="79" r="3" stroke="white" strokeWidth="1.3"/>
    </svg>
  );
}

function SpaceArt() {
  return (
    <svg width="220" height="200" viewBox="0 0 220 200" fill="none" xmlns="http://www.w3.org/2000/svg" className="space-art-svg">
      <circle cx="90" cy="80" r="28" stroke="white" strokeWidth="1.5"/>
      <ellipse cx="90" cy="80" rx="46" ry="12" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
      <ellipse cx="155" cy="42" r="18" cx2="155" cy2="42" stroke="white" strokeWidth="1.5"/>
      <circle cx="155" cy="42" r="18" stroke="white" strokeWidth="1.5"/>
      <circle cx="148" cy="36" r="3" stroke="white" strokeWidth="1" opacity="0.6"/>
      <circle cx="160" cy="48" r="4" stroke="white" strokeWidth="1" opacity="0.6"/>
      <circle cx="154" cy="52" r="2" stroke="white" strokeWidth="1" opacity="0.5"/>
      <path d="M26 30 L28 26 L30 30 L26 30Z" stroke="white" strokeWidth="1.2" strokeLinejoin="round" opacity="0.8"/>
      <line x1="28" y1="20" x2="28" y2="26" stroke="white" strokeWidth="1.2" strokeLinecap="round" opacity="0.8"/>
      <line x1="22" y1="28" x2="28" y2="28" stroke="white" strokeWidth="1.2" strokeLinecap="round" opacity="0.8"/>
      <line x1="34" y1="28" x2="28" y2="28" stroke="white" strokeWidth="1.2" strokeLinecap="round" opacity="0.8"/>
      <path d="M75 140 L77 135 L79 140 L75 140Z" stroke="white" strokeWidth="1.2" strokeLinejoin="round" opacity="0.6"/>
      <line x1="77" y1="128" x2="77" y2="135" stroke="white" strokeWidth="1.2" strokeLinecap="round" opacity="0.6"/>
      <line x1="71" y1="133" x2="77" y2="133" stroke="white" strokeWidth="1.2" strokeLinecap="round" opacity="0.6"/>
      <line x1="83" y1="133" x2="77" y2="133" stroke="white" strokeWidth="1.2" strokeLinecap="round" opacity="0.6"/>
      <path d="M185 100 L187 96 L189 100 L185 100Z" stroke="white" strokeWidth="1.2" strokeLinejoin="round" opacity="0.5"/>
      <line x1="187" y1="90" x2="187" y2="96" stroke="white" strokeWidth="1.2" strokeLinecap="round" opacity="0.5"/>
      <line x1="181" y1="94" x2="187" y2="94" stroke="white" strokeWidth="1.2" strokeLinecap="round" opacity="0.5"/>
      <line x1="193" y1="94" x2="187" y2="94" stroke="white" strokeWidth="1.2" strokeLinecap="round" opacity="0.5"/>
      <circle cx="15" cy="110" r="2" fill="white" opacity="0.5"/>
      <circle cx="50" cy="15" r="1.5" fill="white" opacity="0.4"/>
      <circle cx="120" cy="20" r="1.5" fill="white" opacity="0.5"/>
      <circle cx="200" cy="65" r="2" fill="white" opacity="0.4"/>
      <circle cx="10" cy="60" r="1.5" fill="white" opacity="0.3"/>
      <circle cx="170" cy="140" r="1.5" fill="white" opacity="0.3"/>
      <circle cx="38" cy="165" r="2" fill="white" opacity="0.4"/>
      <circle cx="130" cy="155" r="1.5" fill="white" opacity="0.3"/>
    </svg>
  );
}

function TriskelionIcon() {
  const blade = "M 0 0 C 1 -1.5, 3.5 -2, 5 -4.5 C 6.5 -7, 5 -10, 2.5 -10 C 0 -10, -1.5 -8, -1 -5.5 C -0.5 -3, 0 -1, 0 0 Z";
  return (
    <svg width="26" height="26" viewBox="-13 -13 26 26" xmlns="http://www.w3.org/2000/svg">
      <path d={blade} fill="#111" />
      <path d={blade} fill="#111" transform="rotate(120)" />
      <path d={blade} fill="#111" transform="rotate(240)" />
    </svg>
  );
}

function Landing({ onStart }) {
  const [input, setInput] = useState('');

  function handleSubmit() {
    onStart();
  }

  return (
    <main className="landing-screen">
      <nav className="landing-nav">
        <span className="landing-brand">Pupil-AI</span>
      </nav>

      <div className="space-art-wrap">
        <img src="/planets.png" alt="" className="planets-img" />
      </div>

      <div className="landing-center">
        <img src="/ufo-raw.png" alt="Pupil's ship" className="ufo-img" />
        <p className="landing-tagline">What can you teach me today?</p>
        <button className="landing-start-btn" onClick={handleSubmit}>
          Start a chat
        </button>
      </div>
    </main>
  );
}

function GradeSelect({ onConfirm }) {
  const [grade, setGrade] = useState('');
  return (
    <main className="landing-screen">
      <nav className="landing-nav">
        <span className="landing-brand">Pupil-AI</span>
      </nav>
      <div className="space-art-wrap">
        <img src="/planets.png" alt="" className="planets-img" />
      </div>
      <div className="landing-center">
        <img src="/ufo-raw.png" alt="Pupil's ship" className="ufo-img" />
        <p className="landing-tagline">What grade are you in?</p>
        <div className="grade-row">
          <select
            className="landing-grade-select"
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
          >
            <option value="" disabled>Select your grade</option>
            {[3,4,5,6,7,8,9,10,11,12].map(g => (
              <option key={g} value={g}>Grade {g}</option>
            ))}
          </select>
          <button
            className="landing-start-btn"
            disabled={!grade}
            onClick={() => onConfirm(grade)}
          >
            Let's go →
          </button>
        </div>
      </div>
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
  return <Landing onStart={() => setScreen('grade')} />;
}

createRoot(document.getElementById('root')).render(<App />);

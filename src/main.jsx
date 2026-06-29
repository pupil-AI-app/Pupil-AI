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
        <img src="/ufo-raw.png" alt="Pupil's ship" className="ufo-img" style={{ width: 180 }} />
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
        <img src="/ufo-raw.png" alt="Pupil's ship" className="ufo-img" style={{ width: 230, transform: 'rotate(-12deg)' }} />
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
  const subjects = ['English', 'Math', 'Science', 'Social Studies', 'Other'];
  return (
    <main className="landing-screen">
      <nav className="landing-nav">
        <span className="landing-brand">Pupil-AI</span>
      </nav>
      <div className="space-art-wrap">
        <img src="/planets.png" alt="" className="planets-img" />
      </div>
      <div className="landing-center">
        <img src="/ufo-raw.png" alt="Pupil's ship" className="ufo-img" style={{ width: 340, transform: 'rotate(12deg)' }} />
        <p className="landing-tagline">What are we exploring?</p>
        <div className="subject-stack">
          <select
            className="landing-grade-select"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          >
            <option value="" disabled>Subject</option>
            {subjects.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <input
            className="landing-topic-input"
            type="text"
            placeholder="Topic (e.g. photosynthesis)"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && subject && topic.trim() && onConfirm(subject, topic.trim())}
          />
          <button
            className="landing-start-btn"
            disabled={!subject || !topic.trim()}
            onClick={() => onConfirm(subject, topic.trim())}
          >
            Start chatting →
          </button>
        </div>
      </div>
    </main>
  );
}

function Chat({ grade, subject, topic, onFinish, onTeacher }) {
  const [messages, setMessages] = useState(starterMessages);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationState, setConversationState] = useState(null);
  const [avatarState, setAvatarState] = useState('CURIOUS');
  const [understandingPct, setUnderstandingPct] = useState(1);
  const [conversationComplete, setConversationComplete] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [sessionStartTime] = useState(() => Date.now());
  const [lastModel, setLastModel] = useState(null);

  async function sendToTeacher() {
    setReportLoading(true);
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          conversationState,
          grade,
          subject,
          sessionDurationMs: Date.now() - sessionStartTime,
        }),
      });
      const data = await res.json();
      onTeacher(data);
    } catch (e) {
      console.error('Report generation failed', e);
    } finally {
      setReportLoading(false);
    }
  }

  const AVATAR_IMAGES = {
    CURIOUS:     '/PUPIL_CURIOUS.png',
    DETERMINED:  '/PUPIL_DETERMINED.png',
    EXCITED:     '/PUPIL_EXCITED.png',
    SURPRISED:   '/PUPIL_SURPRISED.png',
    THINKING:    '/PUPIL_THINKING.png',
    CELEBRATING: '/PUPIL_CELEBRATING.png',
  };

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
      if (data._model) setLastModel(data._model);
      if (data.conversationState) setConversationState(data.conversationState);
      if (data.avatarState) setAvatarState(data.avatarState);
      if (data.understandingPct !== undefined) setUnderstandingPct(data.understandingPct);
      setMessages([...next, { role: 'pupil', text: reply }]);
      if (data.conversationState?.lastThreeMoves?.includes('CLOSE_GRACEFULLY')) {
        setTimeout(() => setConversationComplete(true), 4000);
      }
    } catch {
      setMessages([...next, { role: 'pupil', text: "I'm having trouble hearing that. Can you try again?" }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="landing-screen chat-screen">
      <nav className="landing-nav" style={{ justifyContent: 'space-between' }}>
        <button className="ghost" onClick={onFinish}>Finish chat</button>
        <span className="landing-brand">Pupil-AI</span>
      </nav>

      {conversationComplete && (
        <div className="completion-overlay">
          <div className="completion-card">
            <button className="completion-close" onClick={onFinish} aria-label="Close">✕</button>
            <img src="/PUPIL_CELEBRATING.png" alt="Pupil celebrating" className="completion-avatar" />
            <div className="completion-text">
              <h2 className="completion-title">Great job!</h2>
              <p className="completion-subtitle">I really learned something today!</p>
            </div>
            <button className="landing-start-btn completion-btn" onClick={onFinish}>Finish</button>
            <button className="completion-teacher-btn" onClick={sendToTeacher} disabled={reportLoading}>
              {reportLoading ? 'Generating report…' : 'Send results to teacher'}
            </button>
          </div>
        </div>
      )}

      <div className="chat-layout">
        {/* Left column: meter + avatar */}
        <div className="left-col">
          <div className="understanding-panel">
            <div className="understanding-label">Pupil's Understanding</div>
            <div className="understanding-pct">{understandingPct} <span className="understanding-pct-max">/ 5</span></div>
            <div className="understanding-track">
              <div className="understanding-fill" style={{ width: `${(understandingPct / 5) * 100}%` }} />
            </div>
          </div>
          <aside className="pupil-panel">
            <div className="pupil-panel-label">Pupil ✨</div>
            <div className="pupil-avatar-area">
              <img key={avatarState} src={AVATAR_IMAGES[avatarState]} alt={avatarState} className="pupil-avatar-img" />
            </div>
          </aside>
        </div>

        {/* Right: chat panel */}
        <section className="chat-panel-right">
          <div className="messages">
            {messages.map((m, index) => (
              <div key={index} className={`message ${m.role}`}>
                <div className="message-label">{m.role === 'pupil' ? 'Pupil' : 'Student'}</div>
                <p>{m.text}</p>
              </div>
            ))}
          </div>

          {lastModel && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textAlign: 'right', padding: '0 4px 4px' }}>model: {lastModel}</div>}
          <div className="composer">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              placeholder={loading ? 'Pupil is thinking…' : 'Type your message...'}
              disabled={loading}
            />
            <button className="send" onClick={sendMessage} aria-label="Send" disabled={loading}>
              <img src="/triskelion.png" alt="" style={{ width: 36, height: 36, borderRadius: '50%', display: 'block' }} />
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

function TeacherReport({ data, onBack }) {
  const SCORE_LABELS = { 'check-plus': 'Check +', 'check': 'Check', 'check-minus': 'Check −' };
  const SCORE_CLASSES = { 'check-plus': 'rpt-score-plus', 'check': 'rpt-score-check', 'check-minus': 'rpt-score-minus' };
  const PERF_LABELS = { correct: 'Correct', partial: 'Partial', incorrect: 'Incorrect' };
  const PERF_CLASSES = { correct: 'rpt-perf-correct', partial: 'rpt-perf-partial', incorrect: 'rpt-perf-incorrect' };

  return (
    <main className="rpt-screen">
      <div className="rpt-inner">
        <header className="rpt-header">
          <div className="rpt-header-left">
            <div className="rpt-brand-label">Pupil-AI</div>
            <h1 className="rpt-title">Teacher Report</h1>
            <div className="rpt-meta">
              {[data?.topic, data?.subject, data?.grade, data?.generatedAt].filter(Boolean).join(' · ')}
            </div>
          </div>
          <div className="rpt-header-right">
            {data && (
              <div className={`rpt-score-badge ${SCORE_CLASSES[data.score] || 'rpt-score-check'}`}>
                {SCORE_LABELS[data.score] || 'Check'}
              </div>
            )}
            {data && <div className="rpt-time">⏱ {data.timeSpent}</div>}
          </div>
        </header>

        {!data && (
          <p className="rpt-empty">No report data available.</p>
        )}

        {data && <>
          <p className="rpt-rationale">{data.scoreRationale}</p>

          <section className="rpt-section">
            <h2 className="rpt-section-label">Conversation Highlights</h2>
            <ul className="rpt-list">
              {data.highlights?.map((h, i) => <li key={i}>{h}</li>)}
            </ul>
          </section>

          <section className="rpt-section">
            <h2 className="rpt-section-label">Next Steps for Teacher</h2>
            <ul className="rpt-list">
              {data.nextSteps?.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </section>

          <section className="rpt-section">
            <h2 className="rpt-section-label">Annotated Transcript</h2>
            <div className="rpt-transcript">
              {data.annotatedTranscript?.map((m, i) => (
                <div key={i} className={`rpt-msg rpt-msg-${m.role}`}>
                  <div className="rpt-msg-speaker">{m.role === 'student' ? 'Student' : 'Pupil'}</div>
                  <div className="rpt-msg-text">{m.text}</div>
                  {m.annotation && (
                    <div className={`rpt-annotation ${PERF_CLASSES[m.performance] || ''}`}>
                      {m.performance && m.performance !== 'na' && (
                        <span className="rpt-perf-tag">{PERF_LABELS[m.performance]}</span>
                      )}
                      {m.annotation}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <footer className="rpt-footer">
            <button className="rpt-materials-btn" disabled>
              ✦ Create custom learning materials <span className="rpt-coming-soon">coming soon</span>
            </button>
            <button className="rpt-back-btn" onClick={onBack}>Close report</button>
          </footer>
        </>}
      </div>
    </main>
  );
}

function App() {
  const [screen, setScreen] = useState('landing');
  const [grade, setGrade] = useState(null);
  const [subject, setSubject] = useState(null);
  const [topic, setTopic] = useState(null);
  const [reportData, setReportData] = useState(null);

  if (screen === 'grade') return <GradeSelect onConfirm={(g) => { setGrade(g); setScreen('subject'); }} />;
  if (screen === 'subject') return <SubjectSelect grade={grade} onConfirm={(s, t) => { setSubject(s); setTopic(t); setScreen('chat'); }} />;
  if (screen === 'chat') return (
    <Chat
      grade={grade}
      subject={subject}
      topic={topic}
      onFinish={() => setScreen('landing')}
      onTeacher={(data) => { setReportData(data); setScreen('report'); }}
    />
  );
  if (screen === 'report') return <TeacherReport data={reportData} onBack={() => setScreen('landing')} />;
  return <Landing onStart={() => setScreen('grade')} />;
}

createRoot(document.getElementById('root')).render(<App />);

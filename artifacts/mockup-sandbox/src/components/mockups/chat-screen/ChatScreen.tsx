import { useState, useRef, useEffect } from "react";
import { Send } from "lucide-react";

interface Message {
  role: "pupil" | "student";
  text: string;
}

const initialMessages: Message[] = [
  {
    role: "pupil",
    text: "Hey there — I'm ready to learn! What on Earth are you going to teach me about?",
  },
];

export function ChatScreen() {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim()) return;
    setMessages((prev) => [
      ...prev,
      { role: "student", text: input.trim() },
      {
        role: "pupil",
        text: "That's interesting! Can you tell me more about that? I want to make sure I understand it fully.",
      },
    ]);
    setInput("");
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#091420",
        display: "flex",
        flexDirection: "column",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Planets illustration top-left */}
      <img
        src="/__mockup/images/planets.png"
        alt=""
        style={{
          position: "absolute",
          top: -40,
          left: -140,
          width: 420,
          pointerEvents: "none",
          mixBlendMode: "screen",
          zIndex: 0,
        }}
      />

      {/* Top bar */}
      <header
        style={{
          position: "relative",
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "20px 32px",
        }}
      >
        {/* UFO + Pupil brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img
            src="/__mockup/images/ufo-raw.png"
            alt="Pupil"
            style={{ width: 36, height: 36, mixBlendMode: "screen" }}
          />
          <span
            style={{
              color: "white",
              fontWeight: 700,
              fontSize: 18,
              letterSpacing: "0.01em",
            }}
          >
            Pupil
          </span>
        </div>

        {/* Pupil-AI brand top right */}
        <span
          style={{
            color: "white",
            fontWeight: 700,
            fontSize: 16,
            letterSpacing: "0.01em",
          }}
        >
          Pupil-AI
        </span>
      </header>

      {/* Chat panel */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          maxWidth: 780,
          width: "100%",
          margin: "0 auto",
          padding: "0 24px 24px",
          position: "relative",
          zIndex: 10,
        }}
      >
        {/* Assignment card */}
        <div
          style={{
            background: "rgba(255,255,255,0.07)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 14,
            padding: "12px 18px",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "rgba(255,255,255,0.4)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 4,
            }}
          >
            Student task
          </div>
          <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 14 }}>
            Teach Pupil a concept from class.
          </div>
        </div>

        {/* Messages area */}
        <div
          style={{
            flex: 1,
            background: "rgba(255,253,247,0.06)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 20,
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            minHeight: 400,
            maxHeight: 460,
            overflowY: "auto",
            marginBottom: 12,
          }}
        >
          {messages.map((msg, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: msg.role === "student" ? "flex-end" : "flex-start",
                gap: 4,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "rgba(255,255,255,0.35)",
                  textTransform: "capitalize",
                  letterSpacing: "0.06em",
                  padding: "0 4px",
                }}
              >
                {msg.role === "student" ? "Student" : "Pupil"}
              </span>
              <div
                style={{
                  maxWidth: "72%",
                  padding: "12px 16px",
                  borderRadius: 20,
                  fontSize: 15,
                  lineHeight: 1.5,
                  ...(msg.role === "student"
                    ? {
                        background: "#101f36",
                        color: "#fffdf7",
                        borderBottomRightRadius: 6,
                      }
                    : {
                        background: "rgba(255,255,255,0.92)",
                        color: "#101f36",
                        border: "1px solid rgba(16,31,54,0.13)",
                        borderBottomLeftRadius: 6,
                      }),
                }}
              >
                {msg.text}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Composer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            background: "rgba(255,255,255,0.07)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 999,
            padding: "8px 8px 8px 20px",
            gap: 8,
          }}
        >
          <input
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "white",
              fontSize: 15,
              fontFamily: "inherit",
            }}
            placeholder="Teach Pupil something..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
          />
          <button
            onClick={handleSend}
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.15)",
              border: "none",
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
              transition: "background 0.15s",
            }}
          >
            <Send size={18} color="white" />
          </button>
        </div>

        {/* Finish chat */}
        <button
          style={{
            marginTop: 10,
            background: "transparent",
            border: "none",
            color: "rgba(255,255,255,0.35)",
            fontSize: 13,
            cursor: "pointer",
            alignSelf: "center",
            textDecoration: "underline",
          }}
        >
          Finish chat
        </button>
      </div>
    </div>
  );
}

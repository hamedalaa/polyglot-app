import { useState, useRef, useEffect } from "react";
import { AssemblyAI } from "assemblyai";

const LANGUAGES = [
  { code: "ar", label: "🇸🇦 العربية" },
  { code: "fr", label: "🇫🇷 Français" },
  { code: "es", label: "🇪🇸 Español" },
  { code: "de", label: "🇩🇪 Deutsch" },
  { code: "ja", label: "🇯🇵 日本語" },
  { code: "tr", label: "🇹🇷 Türkçe" },
  { code: "it", label: "🇮🇹 Italiano" },
];

async function translateWord(word, targetLang) {
  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|${targetLang}`
    );
    const data = await res.json();
    if (data.responseStatus === 200) return data.responseData.translatedText;
    return "⚠️ غير متاح";
  } catch {
    return "⚠️ خطأ في الشبكة";
  }
}

export default function App() {
  const [targetLang, setTargetLang] = useState("ar");
  const [transcript, setTranscript] = useState([]);
  const [status, setStatus] = useState("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [popup, setPopup] = useState(null);
  const [videoURL, setVideoURL] = useState(null);
  const [fileName, setFileName] = useState("");
  const [duration, setDuration] = useState(0);

  const videoRef = useRef(null);
  const transcriptRef = useRef(null);
  const activeLineRef = useRef(null);
  const cache = useRef({});
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!transcript.length) return;
    const idx = transcript.reduce((best, line, i) =>
      line.start / 1000 <= currentTime ? i : best, 0);
    setActiveIndex(idx);
  }, [currentTime, transcript]);

  useEffect(() => {
    activeLineRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeIndex]);

  const handleTimeUpdate = () => {
    if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setFileName(file.name);
    setVideoURL(URL.createObjectURL(file));
    setTranscript([]);
    setStatus("loading");
    setStatusMsg("جاري رفع الملف...");
    cache.current = {};

    try {
      const apiKey = import.meta.env.VITE_ASSEMBLYAI_KEY;
      const client = new AssemblyAI({ apiKey });

      setStatusMsg("جاري تحليل الصوت... قد يأخذ دقيقة");

      const result = await client.transcripts.transcribe({
        audio: file,
        speech_models: ["universal-2"],
        language_detection: true,
      });

      if (result.status === "error") {
        throw new Error(result.error);
      }

      // Build transcript from sentences
      const sentences = await client.transcripts.sentences(result.id);
      const lines = sentences.sentences.map(s => ({
        start: s.start,
        end: s.end,
        text: s.text,
      }));

      setTranscript(lines.length > 0 ? lines : [{ start: 0, end: 0, text: result.text }]);
      setStatus("ready");
    } catch (err) {
      setStatus("error");
      setStatusMsg("حدث خطأ: " + err.message);
    }
  };

  const handleWordClick = async (word, e) => {
    e.stopPropagation();
    const clean = word.replace(/[^a-zA-Z]/g, "");
    if (!clean || clean.length < 2) return;
    const rect = e.target.getBoundingClientRect();
    const cacheKey = `${clean}_${targetLang}`;
    setPopup({ word: clean, translation: null, x: rect.left, y: rect.bottom + 8 });
    if (cache.current[cacheKey]) {
      setPopup({ word: clean, translation: cache.current[cacheKey], x: rect.left, y: rect.bottom + 8 });
      return;
    }
    const translation = await translateWord(clean, targetLang);
    cache.current[cacheKey] = translation;
    setPopup({ word: clean, translation, x: rect.left, y: rect.bottom + 8 });
  };

  useEffect(() => {
    const close = () => setPopup(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const selectedLang = LANGUAGES.find(l => l.code === targetLang);
  const progress = duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;

  return (
    <div style={{
      minHeight: "100vh", background: "#0a0a0f", color: "#e8e6f0",
      fontFamily: "'DM Mono', 'Fira Code', monospace", display: "flex", flexDirection: "column",
    }}>

      {/* Header */}
      <header style={{
        padding: "18px 32px", borderBottom: "1px solid #1e1e2e",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "rgba(255,255,255,0.02)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: "linear-gradient(135deg, #e94560, #f5a623)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
          }}>🎓</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "0.08em", color: "#fff" }}>POLYGLOT</div>
            <div style={{ fontSize: 10, color: "#555", letterSpacing: "0.15em" }}>VIDEO LANGUAGE TOOL</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, color: "#555", letterSpacing: "0.1em" }}>TRANSLATE TO</span>
          <select
            value={targetLang}
            onChange={e => { setTargetLang(e.target.value); setPopup(null); cache.current = {}; }}
            style={{
              background: "#13131f", border: "1px solid #2a2a3e", borderRadius: 8,
              color: "#e8e6f0", padding: "7px 12px", fontFamily: "inherit",
              fontSize: 13, cursor: "pointer", outline: "none",
            }}
          >
            {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </div>
      </header>

      {/* Upload Bar */}
      <div style={{ padding: "18px 32px", display: "flex", gap: 12, borderBottom: "1px solid #1e1e2e", alignItems: "center" }}>
        <input ref={fileInputRef} type="file" accept="video/*,audio/*" onChange={handleFileChange} style={{ display: "none" }} />
        <button
          onClick={() => fileInputRef.current?.click()}
          style={{
            background: "linear-gradient(135deg, #e94560, #c0392b)", border: "none",
            borderRadius: 10, padding: "11px 24px", color: "#fff", fontFamily: "inherit",
            fontSize: 13, fontWeight: 700, cursor: "pointer", letterSpacing: "0.1em", whiteSpace: "nowrap",
          }}
        >📁 ارفع فيديو أو صوت</button>
        <div style={{
          flex: 1, background: "#13131f", border: "1px solid #2a2a3e",
          borderRadius: 10, padding: "11px 18px", fontSize: 13,
          color: fileName ? "#e8e6f0" : "#444",
        }}>
          {fileName || "MP4 · MOV · MP3 · WAV · M4A"}
        </div>
      </div>

      {/* Main Grid */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", padding: "24px 32px", gap: 24 }}>

        {/* Left */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{
            background: "#13131f", borderRadius: 16, border: "1px solid #1e1e2e",
            overflow: "hidden", aspectRatio: "16/9",
          }}>
            {videoURL ? (
              <video
                ref={videoRef} src={videoURL} controls
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)}
                style={{ width: "100%", height: "100%", display: "block", background: "#000" }}
              />
            ) : (
              <div style={{
                width: "100%", height: "100%", display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: 16,
              }}>
                <div style={{
                  width: 72, height: 72, borderRadius: "50%", border: "2px dashed #2a2a3e",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, color: "#2a2a3e",
                }}>📁</div>
                <div style={{ fontSize: 12, letterSpacing: "0.1em", color: "#333" }}>ارفع ملف فيديو أو صوت</div>
              </div>
            )}
          </div>

          <div style={{ background: "#13131f", borderRadius: 12, border: "1px solid #1e1e2e", padding: "14px 18px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#555", marginBottom: 8, letterSpacing: "0.1em" }}>
              <span>PROGRESS</span><span>{Math.floor(currentTime)}s / {Math.floor(duration)}s</span>
            </div>
            <div style={{ height: 4, background: "#1e1e2e", borderRadius: 4, overflow: "hidden" }}>
              <div style={{
                height: "100%", width: `${progress}%`,
                background: "linear-gradient(90deg, #e94560, #f5a623)",
                borderRadius: 4, transition: "width 0.3s linear",
              }} />
            </div>
          </div>

          <div style={{
            background: status === "error" ? "rgba(233,69,96,0.08)" : status === "ready" ? "rgba(39,174,96,0.08)" : "rgba(245,166,35,0.06)",
            borderRadius: 12,
            border: `1px solid ${status === "error" ? "rgba(233,69,96,0.3)" : status === "ready" ? "rgba(39,174,96,0.3)" : "rgba(245,166,35,0.2)"}`,
            padding: "14px 18px",
          }}>
            {status === "idle" && (
              <>
                <div style={{ fontSize: 11, color: "#f5a623", letterSpacing: "0.1em", marginBottom: 6 }}>💡 كيف تستخدمه</div>
                <div style={{ fontSize: 12, color: "#888", lineHeight: 1.9 }}>
                  ١. ارفع أي فيديو أو ملف صوت<br />
                  ٢. AssemblyAI يحوّل الكلام لنص تلقائياً<br />
                  ٣. اضغط أي كلمة ← ترجمة فورية ✦
                </div>
              </>
            )}
            {status === "loading" && (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{
                  width: 18, height: 18, borderRadius: "50%",
                  border: "2px solid #f5a623", borderTopColor: "transparent",
                  animation: "spin 0.8s linear infinite", flexShrink: 0,
                }} />
                <span style={{ fontSize: 13, color: "#f5a623" }}>{statusMsg}</span>
              </div>
            )}
            {status === "ready" && (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 18 }}>✅</span>
                <div>
                  <div style={{ fontSize: 13, color: "#27ae60", fontWeight: 700 }}>تم تحليل الصوت بنجاح!</div>
                  <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{transcript.length} جملة · اضغط أي كلمة لترجمتها</div>
                </div>
              </div>
            )}
            {status === "error" && (
              <div>
                <div style={{ fontSize: 13, color: "#e94560", fontWeight: 700, marginBottom: 4 }}>⚠️ حدث خطأ</div>
                <div style={{ fontSize: 11, color: "#888" }}>{statusMsg}</div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Transcript */}
        <div style={{
          background: "#13131f", borderRadius: 16, border: "1px solid #1e1e2e",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          <div style={{
            padding: "14px 20px", borderBottom: "1px solid #1e1e2e",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <div style={{ fontSize: 11, letterSpacing: "0.15em", color: "#666" }}>TRANSCRIPT</div>
            {transcript.length > 0 && (
              <div style={{
                fontSize: 10, color: "#e94560", letterSpacing: "0.1em",
                background: "rgba(233,69,96,0.1)", padding: "3px 10px", borderRadius: 20,
              }}>اضغط أي كلمة ✦</div>
            )}
          </div>

          <div ref={transcriptRef} style={{
            flex: 1, overflowY: "auto", padding: "16px 20px",
            display: "flex", flexDirection: "column", gap: 4,
            scrollbarWidth: "thin", scrollbarColor: "#2a2a3e #13131f",
          }}>
            {transcript.length === 0 ? (
              <div style={{
                flex: 1, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: 12, color: "#333",
              }}>
                <div style={{ fontSize: 32 }}>📝</div>
                <div style={{ fontSize: 12, letterSpacing: "0.1em", textAlign: "center", lineHeight: 1.8 }}>
                  النص سيظهر هنا<br />بعد رفع الفيديو
                </div>
              </div>
            ) : (
              transcript.map((line, i) => (
                <div
                  key={i}
                  ref={i === activeIndex ? activeLineRef : null}
                  onClick={() => videoRef.current && (videoRef.current.currentTime = line.start / 1000)}
                  style={{
                    padding: "10px 14px", borderRadius: 10, cursor: "pointer",
                    background: i === activeIndex ? "rgba(233,69,96,0.08)" : "transparent",
                    borderLeft: i === activeIndex ? "3px solid #e94560" : "3px solid transparent",
                    transition: "all 0.3s ease", display: "flex", gap: 12, alignItems: "flex-start",
                  }}
                >
                  <span style={{
                    fontSize: 10, minWidth: 32, paddingTop: 3, fontWeight: 700,
                    letterSpacing: "0.05em", transition: "color 0.3s", flexShrink: 0,
                    color: i === activeIndex ? "#e94560" : "#333",
                  }}>
                    {String(Math.floor(line.start / 60000)).padStart(2, "0")}:
                    {String(Math.floor((line.start % 60000) / 1000)).padStart(2, "0")}
                  </span>
                  <p style={{
                    margin: 0, fontSize: 14, lineHeight: 1.8,
                    color: i === activeIndex ? "#e8e6f0" : "#777", transition: "color 0.3s",
                  }}>
                    {line.text.split(" ").map((word, wi) => (
                      <span
                        key={wi}
                        onClick={e => handleWordClick(word, e)}
                        style={{
                          cursor: "pointer", borderRadius: 4, padding: "1px 3px",
                          transition: "background 0.15s, color 0.15s",
                          display: "inline-block", marginRight: 3,
                        }}
                        onMouseOver={e => { e.target.style.background = "rgba(245,166,35,0.2)"; e.target.style.color = "#f5a623"; }}
                        onMouseOut={e => { e.target.style.background = "transparent"; e.target.style.color = ""; }}
                      >{word}</span>
                    ))}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Popup */}
      {popup && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: "fixed",
            left: Math.min(popup.x, window.innerWidth - 280),
            top: Math.min(popup.y, window.innerHeight - 150),
            zIndex: 1000, background: "#1a1a2e",
            border: "1px solid #2a2a3e", borderRadius: 14,
            padding: "16px 20px", width: 260,
            boxShadow: "0 24px 64px rgba(0,0,0,0.7), 0 0 0 1px rgba(233,69,96,0.15)",
            animation: "fadeUp 0.15s ease",
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 10 }}>{popup.word}</div>
          <div style={{ height: 1, background: "linear-gradient(90deg, #e94560, transparent)", marginBottom: 12 }} />
          {popup.translation === null ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 16, height: 16, borderRadius: "50%",
                border: "2px solid #e94560", borderTopColor: "transparent",
                animation: "spin 0.7s linear infinite",
              }} />
              <span style={{ fontSize: 12, color: "#666" }}>جاري الترجمة...</span>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 16, color: "#f5a623", fontWeight: 600, marginBottom: 8 }}>{popup.translation}</div>
              <div style={{ fontSize: 10, color: "#555", letterSpacing: "0.1em" }}>{selectedLang?.label} · MyMemory ✓</div>
            </>
          )}
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');
        @keyframes fadeUp { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #13131f; }
        ::-webkit-scrollbar-thumb { background: #2a2a3e; border-radius: 4px; }
        select option { background: #1a1a2e; }
      `}</style>
    </div>
  );
}
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

const STOP_WORDS = new Set(["the","a","an","is","it","in","on","at","to","of","and","or","but","was","are","be","this","that","with","for","as","by","from","have","has","had","not","we","they","he","she","you","i","my","our","his","her","its","do","did","will","would","can","could","should","been","were","so","if","up","out","about","what","which","who","when","how","all","some","one","more","also","into"]);

async function translateWord(word, targetLang) {
  try {
    const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|${targetLang}`);
    const data = await res.json();
    if (data.responseStatus === 200) return data.responseData.translatedText;
    return null;
  } catch { return null; }
}

function getTopKeywords(transcript, count = 5) {
  const freq = {};
  transcript.forEach(line => {
    line.text.split(/\s+/).forEach(w => {
      const clean = w.toLowerCase().replace(/[^a-z]/g, "");
      if (clean.length > 3 && !STOP_WORDS.has(clean)) freq[clean] = (freq[clean] || 0) + 1;
    });
  });
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, count).map(([word]) => word);
}

function speakWord(word) {
  if (!window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(word);
  u.lang = "en-US";
  window.speechSynthesis.speak(u);
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
  const [wordBank, setWordBank] = useState(() => {
    try { return JSON.parse(localStorage.getItem("polyglot_wordbank") || "[]"); } catch { return []; }
  });
  const [keywords, setKeywords] = useState([]);
  const [activeTab, setActiveTab] = useState("transcript");

  const videoRef = useRef(null);
  const transcriptRef = useRef(null);
  const activeLineRef = useRef(null);
  const cache = useRef({});
  const fileInputRef = useRef(null);

  useEffect(() => {
    localStorage.setItem("polyglot_wordbank", JSON.stringify(wordBank));
  }, [wordBank]);

  useEffect(() => {
    if (!transcript.length) return;
    const idx = transcript.reduce((best, line, i) => line.start / 1000 <= currentTime ? i : best, 0);
    setActiveIndex(idx);
  }, [currentTime, transcript]);

  useEffect(() => {
    activeLineRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeIndex]);

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    setVideoURL(URL.createObjectURL(file));
    setTranscript([]); setKeywords([]);
    setStatus("loading"); setStatusMsg("جاري رفع الملف...");
    cache.current = {};
    try {
      const client = new AssemblyAI({ apiKey: import.meta.env.VITE_ASSEMBLYAI_KEY });
      setStatusMsg("جاري تحليل الصوت...");
      const result = await client.transcripts.transcribe({ audio: file, speech_models: ["universal-2"], language_detection: true });
      if (result.status === "error") throw new Error(result.error);
      const sentences = await client.transcripts.sentences(result.id);
      const lines = sentences.sentences.length > 0
        ? sentences.sentences.map(s => ({ start: s.start, end: s.end, text: s.text }))
        : [{ start: 0, end: 0, text: result.text }];
      setTranscript(lines);
      setKeywords(getTopKeywords(lines));
      setStatus("ready");
    } catch (err) {
      setStatus("error"); setStatusMsg("حدث خطأ: " + err.message);
    }
  };

  const handleWordClick = async (word, e) => {
    e.stopPropagation();
    const clean = word.replace(/[^a-zA-Z]/g, "");
    if (!clean || clean.length < 2) return;
    const rect = e.target.getBoundingClientRect();
    const cacheKey = `${clean}_${targetLang}`;
    setPopup({ word: clean, translation: null, x: rect.left, y: rect.bottom + 8 });
    if (cache.current[cacheKey]) { setPopup({ word: clean, translation: cache.current[cacheKey], x: rect.left, y: rect.bottom + 8 }); return; }
    const translation = await translateWord(clean, targetLang);
    cache.current[cacheKey] = translation;
    setPopup({ word: clean, translation, x: rect.left, y: rect.bottom + 8 });
  };

  const saveWord = async (word) => {
    const clean = word.replace(/[^a-zA-Z]/g, "").toLowerCase();
    if (!clean || wordBank.find(w => w.word === clean)) return;
    const translation = cache.current[`${clean}_${targetLang}`] || await translateWord(clean, targetLang);
    cache.current[`${clean}_${targetLang}`] = translation;
    setWordBank(prev => [...prev, { word: clean, translation: translation || clean, lang: targetLang, date: Date.now() }]);
  };

  const removeWord = (word) => setWordBank(prev => prev.filter(w => w.word !== word));

  useEffect(() => {
    const close = () => setPopup(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const progress = duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0f", color: "#e8e6f0", fontFamily: "'DM Mono','Fira Code',monospace" }}>

      {/* HEADER */}
      <header style={{ padding: "14px 20px", borderBottom: "1px solid #1e1e2e", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, background: "rgba(255,255,255,0.02)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: "linear-gradient(135deg,#e94560,#f5a623)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>🎓</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", letterSpacing: "0.06em" }}>POLYGLOT</div>
            <div style={{ fontSize: 9, color: "#555", letterSpacing: "0.12em" }}>VIDEO LANGUAGE TOOL</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, color: "#555" }}>ترجم إلى</span>
          <select value={targetLang} onChange={e => { setTargetLang(e.target.value); setPopup(null); cache.current = {}; }}
            style={{ background: "#13131f", border: "1px solid #2a2a3e", borderRadius: 8, color: "#e8e6f0", padding: "6px 10px", fontFamily: "inherit", fontSize: 12, cursor: "pointer", outline: "none" }}>
            {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </div>
      </header>

      {/* UPLOAD */}
      <div style={{ padding: "14px 20px", borderBottom: "1px solid #1e1e2e", display: "flex", gap: 10 }}>
        <input ref={fileInputRef} type="file" accept="video/*,audio/*" onChange={handleFileChange} style={{ display: "none" }} />
        <button onClick={() => fileInputRef.current?.click()}
          style={{ background: "linear-gradient(135deg,#e94560,#c0392b)", border: "none", borderRadius: 10, padding: "10px 18px", color: "#fff", fontFamily: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
          📁 ارفع فيديو
        </button>
        <div style={{ flex: 1, background: "#13131f", border: "1px solid #2a2a3e", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: fileName ? "#e8e6f0" : "#444", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {fileName || "MP4 · MOV · MP3 · WAV"}
        </div>
      </div>

      <div style={{ padding: "16px 20px 0" }}>

        {/* VIDEO */}
        {videoURL && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ borderRadius: 14, overflow: "hidden", border: "1px solid #1e1e2e", background: "#000" }}>
              <video ref={videoRef} src={videoURL} controls
                onTimeUpdate={() => videoRef.current && setCurrentTime(videoRef.current.currentTime)}
                onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)}
                style={{ width: "100%", display: "block", maxHeight: 280 }} />
            </div>
            <div style={{ margin: "8px 0", height: 3, background: "#1e1e2e", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg,#e94560,#f5a623)", transition: "width 0.3s linear" }} />
            </div>
          </div>
        )}

        {/* STATUS */}
        {status !== "idle" && (
          <div style={{ marginBottom: 12, borderRadius: 12, padding: "10px 14px",
            background: status === "error" ? "rgba(233,69,96,0.08)" : status === "ready" ? "rgba(39,174,96,0.08)" : "rgba(245,166,35,0.06)",
            border: `1px solid ${status === "error" ? "rgba(233,69,96,0.3)" : status === "ready" ? "rgba(39,174,96,0.3)" : "rgba(245,166,35,0.2)"}`,
            display: "flex", alignItems: "center", gap: 10 }}>
            {status === "loading" && <><div style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid #f5a623", borderTopColor: "transparent", animation: "spin 0.8s linear infinite", flexShrink: 0 }} /><span style={{ fontSize: 12, color: "#f5a623" }}>{statusMsg}</span></>}
            {status === "ready" && <><span>✅</span><span style={{ fontSize: 12, color: "#27ae60" }}>تم! {transcript.length} جملة — اضغط أي كلمة لترجمتها</span></>}
            {status === "error" && <><span>⚠️</span><span style={{ fontSize: 12, color: "#e94560" }}>{statusMsg}</span></>}
          </div>
        )}

        {/* KEYWORDS */}
        {keywords.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 8 }}>🔑 أهم الكلمات — اضغط لحفظها</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {keywords.map(kw => {
                const saved = wordBank.find(w => w.word === kw);
                return (
                  <button key={kw} onClick={() => saveWord(kw)}
                    style={{ background: saved ? "rgba(39,174,96,0.15)" : "rgba(245,166,35,0.1)", border: `1px solid ${saved ? "rgba(39,174,96,0.4)" : "rgba(245,166,35,0.3)"}`, borderRadius: 20, padding: "5px 14px", color: saved ? "#27ae60" : "#f5a623", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
                    {saved ? "✓ " : "+ "}{kw}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* TABS */}
        <div style={{ display: "flex", gap: 4, marginBottom: 0 }}>
          {[{ id: "transcript", label: "📝 النص" }, { id: "wordbank", label: `📚 بنك الكلمات${wordBank.length > 0 ? ` (${wordBank.length})` : ""}` }].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              style={{ background: activeTab === tab.id ? "rgba(233,69,96,0.15)" : "transparent", border: `1px solid ${activeTab === tab.id ? "rgba(233,69,96,0.4)" : "#1e1e2e"}`, borderRadius: "10px 10px 0 0", padding: "8px 16px", color: activeTab === tab.id ? "#e94560" : "#555", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* TRANSCRIPT */}
        {activeTab === "transcript" && (
          <div style={{ background: "#13131f", borderRadius: "0 12px 12px 12px", border: "1px solid #1e1e2e", marginBottom: 20 }}>
            {transcript.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: "#333" }}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>📝</div>
                <div style={{ fontSize: 12 }}>{status === "idle" ? "ارفع فيديو لتبدأ" : "جاري التحليل..."}</div>
              </div>
            ) : (
              <div ref={transcriptRef} style={{ maxHeight: 380, overflowY: "auto", padding: "12px 14px", scrollbarWidth: "thin", scrollbarColor: "#2a2a3e #13131f" }}>
                {transcript.map((line, i) => (
                  <div key={i} ref={i === activeIndex ? activeLineRef : null}
                    onClick={() => videoRef.current && (videoRef.current.currentTime = line.start / 1000)}
                    style={{ padding: "8px 10px", borderRadius: 8, cursor: "pointer", marginBottom: 4, background: i === activeIndex ? "rgba(233,69,96,0.08)" : "transparent", borderLeft: i === activeIndex ? "3px solid #e94560" : "3px solid transparent", transition: "all 0.2s", display: "flex", gap: 10 }}>
                    <span style={{ fontSize: 10, color: i === activeIndex ? "#e94560" : "#333", minWidth: 28, paddingTop: 3, flexShrink: 0 }}>
                      {String(Math.floor(line.start / 60000)).padStart(2, "0")}:{String(Math.floor((line.start % 60000) / 1000)).padStart(2, "0")}
                    </span>
                    <p style={{ margin: 0, fontSize: 13, lineHeight: 1.8, color: i === activeIndex ? "#e8e6f0" : "#777" }}>
                      {line.text.split(" ").map((word, wi) => (
                        <span key={wi} onClick={e => handleWordClick(word, e)}
                          style={{ cursor: "pointer", borderRadius: 4, padding: "1px 2px", display: "inline-block", marginRight: 2 }}
                          onMouseOver={e => { e.target.style.background = "rgba(245,166,35,0.2)"; e.target.style.color = "#f5a623"; }}
                          onMouseOut={e => { e.target.style.background = "transparent"; e.target.style.color = ""; }}>
                          {word}
                        </span>
                      ))}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* WORD BANK */}
        {activeTab === "wordbank" && (
          <div style={{ background: "#13131f", borderRadius: "0 12px 12px 12px", border: "1px solid #1e1e2e", marginBottom: 20 }}>
            {wordBank.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: "#333" }}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>📚</div>
                <div style={{ fontSize: 12 }}>اضغط على أي كلمة في النص لحفظها هنا</div>
              </div>
            ) : (
              <div style={{ padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <span style={{ fontSize: 10, color: "#555" }}>{wordBank.length} كلمة محفوظة</span>
                  <button onClick={() => { if (confirm("حذف كل الكلمات؟")) setWordBank([]); }}
                    style={{ background: "transparent", border: "1px solid rgba(233,69,96,0.3)", borderRadius: 6, padding: "4px 10px", color: "#e94560", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
                    حذف الكل
                  </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {wordBank.map(item => (
                    <div key={item.word} style={{ background: "#0f0f1a", borderRadius: 10, padding: "10px 12px", border: "1px solid #1e1e2e", display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, color: "#fff", fontWeight: 700 }}>{item.word}</div>
                        <div style={{ fontSize: 12, color: "#f5a623", marginTop: 2 }}>{item.translation}</div>
                      </div>
                      <button onClick={() => speakWord(item.word)}
                        style={{ background: "rgba(233,69,96,0.1)", border: "1px solid rgba(233,69,96,0.2)", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontSize: 14 }}>
                        🔊
                      </button>
                      <button onClick={() => removeWord(item.word)}
                        style={{ background: "transparent", border: "none", color: "#444", cursor: "pointer", fontSize: 16 }}>
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* IDLE */}
        {status === "idle" && !videoURL && (
          <div style={{ padding: "40px 20px", textAlign: "center", color: "#333" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎓</div>
            <div style={{ fontSize: 13, color: "#555", lineHeight: 2 }}>
              ارفع أي فيديو أو ملف صوت<br />
              وسيتحول الكلام لنص تلقائياً<br />
              <span style={{ color: "#e94560" }}>اضغط أي كلمة لترجمتها وحفظها</span>
            </div>
          </div>
        )}
      </div>

      {/* POPUP */}
      {popup && (
        <div onClick={e => e.stopPropagation()} style={{ position: "fixed", left: Math.min(Math.max(popup.x, 10), window.innerWidth - 240), top: Math.min(popup.y, window.innerHeight - 170), zIndex: 1000, background: "#1a1a2e", border: "1px solid #2a2a3e", borderRadius: 14, padding: "14px 16px", width: 230, boxShadow: "0 20px 50px rgba(0,0,0,0.7)", animation: "fadeUp 0.15s ease" }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#fff", marginBottom: 8 }}>{popup.word}</div>
          <div style={{ height: 1, background: "linear-gradient(90deg,#e94560,transparent)", marginBottom: 10 }} />
          {popup.translation === null ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid #e94560", borderTopColor: "transparent", animation: "spin 0.7s linear infinite" }} />
              <span style={{ fontSize: 12, color: "#666" }}>جاري الترجمة...</span>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 15, color: "#f5a623", fontWeight: 600, marginBottom: 10 }}>{popup.translation}</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => speakWord(popup.word)}
                  style={{ flex: 1, background: "rgba(233,69,96,0.1)", border: "1px solid rgba(233,69,96,0.2)", borderRadius: 8, padding: "7px", cursor: "pointer", fontSize: 14 }}>
                  🔊 نطق
                </button>
                <button onClick={() => { saveWord(popup.word); setPopup(null); }}
                  style={{ flex: 1, background: wordBank.find(w => w.word === popup.word.toLowerCase()) ? "rgba(39,174,96,0.15)" : "rgba(245,166,35,0.1)", border: `1px solid ${wordBank.find(w => w.word === popup.word.toLowerCase()) ? "rgba(39,174,96,0.4)" : "rgba(245,166,35,0.3)"}`, borderRadius: 8, padding: "7px", cursor: "pointer", fontSize: 12, color: wordBank.find(w => w.word === popup.word.toLowerCase()) ? "#27ae60" : "#f5a623", fontFamily: "inherit" }}>
                  {wordBank.find(w => w.word === popup.word.toLowerCase()) ? "✓ محفوظة" : "+ احفظ"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');
        @keyframes fadeUp { from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)} }
        @keyframes spin { to{transform:rotate(360deg)} }
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-track{background:#13131f}
        ::-webkit-scrollbar-thumb{background:#2a2a3e;border-radius:4px}
        select option{background:#1a1a2e}
      `}</style>
    </div>
  );
}

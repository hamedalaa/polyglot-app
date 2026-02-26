import { useState, useRef, useEffect } from "react";
import { AssemblyAI } from "assemblyai";

// ─── Config ──────────────────────────────────────────────────────────────────

const LANGUAGES = [
  { code: "ar", label: "🇸🇦 العربية" },
  { code: "fr", label: "🇫🇷 Français" },
  { code: "es", label: "🇪🇸 Español" },
  { code: "de", label: "🇩🇪 Deutsch" },
  { code: "ja", label: "🇯🇵 日本語" },
  { code: "tr", label: "🇹🇷 Türkçe" },
  { code: "it", label: "🇮🇹 Italiano" },
  { code: "zh", label: "🇨🇳 中文" },
];

const SPEAKER_COLORS = ["#a78bfa", "#38bdf8", "#fb7185", "#34d399", "#fbbf24", "#c084fc"];

const STOP_WORDS = new Set(["the","a","an","is","it","in","on","at","to","of","and","or","but","was","are","be","this","that","with","for","as","by","from","have","has","had","not","we","they","he","she","you","i","my","our","his","her","its","do","did","will","would","can","could","should","been","were","so","if","up","out","about","what","which","who","when","how","all","some","one","more","also","into","just","like","get","got","than","then","now","here","there","their","your","its","been","very","just","even","only","also","back","after","use","two","how","our","work","first","well","way","even","new","want","because","any","these","give","day","most","us"]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function translateWord(word, targetLang) {
  try {
    const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|${targetLang}`);
    const data = await res.json();
    return data.responseStatus === 200 ? data.responseData.translatedText : null;
  } catch { return null; }
}

function getTopKeywords(transcript, count = 6) {
  const freq = {};
  transcript.forEach(line => {
    line.text.split(/\s+/).forEach(w => {
      const clean = w.toLowerCase().replace(/[^a-z]/g, "");
      if (clean.length > 4 && !STOP_WORDS.has(clean)) freq[clean] = (freq[clean] || 0) + 1;
    });
  });
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, count).map(([w]) => w);
}

function speakWord(word) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(word);
  u.lang = "en-US"; u.rate = 0.85;
  window.speechSynthesis.speak(u);
}

function downloadVocabCSV(wordBank) {
  const rows = [["Word", "Translation", "Language"], ...wordBank.map(w => [w.word, w.translation, w.lang])];
  const csv = rows.map(r => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = "polyglot_vocabulary.csv"; a.click();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function GlowCard({ children, style = {}, accent = "#a78bfa" }) {
  return (
    <div style={{
      background: "rgba(15,10,30,0.85)",
      border: `1px solid ${accent}22`,
      borderRadius: 16,
      boxShadow: `0 0 0 1px ${accent}11, 0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 ${accent}15`,
      backdropFilter: "blur(12px)",
      ...style,
    }}>{children}</div>
  );
}

function Pill({ children, color = "#a78bfa", onClick, active }) {
  return (
    <button onClick={onClick} style={{
      background: active ? `${color}22` : "transparent",
      border: `1px solid ${active ? color : color + "44"}`,
      borderRadius: 20, padding: "4px 14px",
      color: active ? color : color + "99",
      fontSize: 11, cursor: "pointer", fontFamily: "inherit",
      letterSpacing: "0.05em", transition: "all 0.2s",
    }}>{children}</button>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [targetLang, setTargetLang] = useState("ar");
  const [transcript, setTranscript] = useState([]);
  const [status, setStatus] = useState("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [popup, setPopup] = useState(null);
  const [videoURL, setVideoURL] = useState(null);
  const [fileName, setFileName] = useState("");
  const [duration, setDuration] = useState(0);
  const [summary, setSummary] = useState([]);
  const [keywords, setKeywords] = useState([]);
  const [activeTab, setActiveTab] = useState("transcript");
  const [quizMode, setQuizMode] = useState("flashcard"); // flashcard | quiz
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizFlipped, setQuizFlipped] = useState(false);
  const [quizAnswer, setQuizAnswer] = useState(null);
  const [wordBank, setWordBank] = useState(() => {
    try { return JSON.parse(localStorage.getItem("polyglot_v2_wordbank") || "[]"); } catch { return []; }
  });
  const [hasSpeakers, setHasSpeakers] = useState(false);

  const videoRef = useRef(null);
  const transcriptRef = useRef(null);
  const activeLineRef = useRef(null);
  const cache = useRef({});
  const fileInputRef = useRef(null);
  const progressInterval = useRef(null);

  useEffect(() => { localStorage.setItem("polyglot_v2_wordbank", JSON.stringify(wordBank)); }, [wordBank]);

  useEffect(() => {
    if (!transcript.length) return;
    const idx = transcript.reduce((best, line, i) => (line.start / 1000 <= currentTime ? i : best), 0);
    setActiveIndex(idx);
  }, [currentTime, transcript]);

  useEffect(() => { activeLineRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [activeIndex]);

  // Animated fake progress during processing
  const startFakeProgress = () => {
    setUploadProgress(0);
    let p = 0;
    progressInterval.current = setInterval(() => {
      p += Math.random() * 3;
      if (p >= 90) { clearInterval(progressInterval.current); p = 90; }
      setUploadProgress(Math.min(p, 90));
    }, 400);
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name); setVideoURL(URL.createObjectURL(file));
    setTranscript([]); setKeywords([]); setSummary([]);
    setStatus("loading"); setStatusMsg("جاري رفع الملف...");
    cache.current = {}; startFakeProgress();

    try {
      const client = new AssemblyAI({ apiKey: import.meta.env.VITE_ASSEMBLYAI_KEY });
      setStatusMsg("جاري تحليل الصوت بالذكاء الاصطناعي...");

      const result = await client.transcripts.transcribe({
        audio: file,
        speech_models: ["universal-2"],
        language_detection: true,
        speaker_labels: true,
        summarization: true,
        summary_model: "informative",
        summary_type: "bullets",
      });

      if (result.status === "error") throw new Error(result.error);

      clearInterval(progressInterval.current); setUploadProgress(100);

      // Build transcript with speaker labels
      const sentences = await client.transcripts.sentences(result.id);
      const speakerMap = {};
      if (result.utterances) {
        result.utterances.forEach(u => { speakerMap[u.start] = u.speaker; });
        setHasSpeakers(true);
      }

      const lines = sentences.sentences.length > 0
        ? sentences.sentences.map(s => ({
            start: s.start, end: s.end, text: s.text,
            speaker: findSpeaker(s.start, result.utterances),
          }))
        : [{ start: 0, end: 0, text: result.text, speaker: null }];

      // Parse summary bullets
      if (result.summary) {
        const bullets = result.summary.split("\n").filter(l => l.trim().length > 0).map(l => l.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
        setSummary(bullets.slice(0, 5));
      }

      setTranscript(lines);
      setKeywords(getTopKeywords(lines));
      setStatus("ready");
    } catch (err) {
      clearInterval(progressInterval.current);
      setStatus("error"); setStatusMsg("حدث خطأ: " + err.message);
    }
  };

  function findSpeaker(startTime, utterances) {
    if (!utterances) return null;
    const u = utterances.find(u => Math.abs(u.start - startTime) < 500);
    return u ? u.speaker : null;
  }

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
    if (!clean || clean.length < 2 || wordBank.find(w => w.word === clean)) return;
    const cacheKey = `${clean}_${targetLang}`;
    const translation = cache.current[cacheKey] || await translateWord(clean, targetLang);
    cache.current[cacheKey] = translation;
    setWordBank(prev => [{ word: clean, translation: translation || clean, lang: targetLang, date: Date.now() }, ...prev]);
  };

  const removeWord = (word) => setWordBank(prev => prev.filter(w => w.word !== word));

  useEffect(() => { const c = () => setPopup(null); window.addEventListener("click", c); return () => window.removeEventListener("click", c); }, []);

  const videoProgress = duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;
  const speakerColor = (speaker) => speaker ? SPEAKER_COLORS[speaker.charCodeAt(0) % SPEAKER_COLORS.length] : "#a78bfa";

  // Quiz helpers
  const quizWord = wordBank[quizIndex % Math.max(wordBank.length, 1)];
  const generateQuizOptions = (correct) => {
    if (!correct) return [];
    const others = wordBank.filter(w => w.word !== correct.word).sort(() => Math.random() - 0.5).slice(0, 3);
    return [...others, correct].sort(() => Math.random() - 0.5);
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: "100vh", background: "#050510", color: "#e2e0ff", fontFamily: "'Readex Pro', 'DM Sans', sans-serif", position: "relative", overflow: "hidden" }}>

      {/* Background glow orbs */}
      <div style={{ position: "fixed", top: "-20%", left: "-10%", width: "50vw", height: "50vw", borderRadius: "50%", background: "radial-gradient(circle, rgba(124,58,237,0.08) 0%, transparent 70%)", pointerEvents: "none", zIndex: 0 }} />
      <div style={{ position: "fixed", bottom: "-20%", right: "-10%", width: "40vw", height: "40vw", borderRadius: "50%", background: "radial-gradient(circle, rgba(56,189,248,0.06) 0%, transparent 70%)", pointerEvents: "none", zIndex: 0 }} />

      <div style={{ position: "relative", zIndex: 1 }}>

        {/* ── HEADER ── */}
        <header style={{ padding: "0 24px", borderBottom: "1px solid rgba(167,139,250,0.12)", background: "rgba(5,5,16,0.9)", backdropFilter: "blur(20px)", position: "sticky", top: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "space-between", height: 60 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: "linear-gradient(135deg,#7c3aed,#38bdf8)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, boxShadow: "0 0 20px rgba(124,58,237,0.5)" }}>🎓</div>
            <div>
              <span style={{ fontSize: 16, fontWeight: 800, color: "#fff", letterSpacing: "0.1em" }}>POLY</span>
              <span style={{ fontSize: 16, fontWeight: 800, background: "linear-gradient(90deg,#a78bfa,#38bdf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", letterSpacing: "0.1em" }}>GLOT</span>
            </div>
            <div style={{ height: 16, width: 1, background: "rgba(167,139,250,0.2)" }} />
            <span style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.15em" }}>AI LANGUAGE PLATFORM</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.1em" }}>TRANSLATE TO</span>
            <select value={targetLang} onChange={e => { setTargetLang(e.target.value); setPopup(null); cache.current = {}; }}
              style={{ background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.3)", borderRadius: 8, color: "#c4b5fd", padding: "5px 10px", fontFamily: "inherit", fontSize: 12, cursor: "pointer", outline: "none" }}>
              {LANGUAGES.map(l => <option key={l.code} value={l.code} style={{ background: "#0f0a1e" }}>{l.label}</option>)}
            </select>
          </div>
        </header>

        <div style={{ padding: "20px 24px", maxWidth: 1400, margin: "0 auto" }}>

          {/* ── UPLOAD ZONE ── */}
          {!videoURL && (
            <GlowCard accent="#7c3aed" style={{ marginBottom: 24, padding: 40, textAlign: "center", cursor: "pointer", transition: "all 0.3s" }}
              onClick={() => fileInputRef.current?.click()}>
              <input ref={fileInputRef} type="file" accept="video/*,audio/*" onChange={handleFileChange} style={{ display: "none" }} />
              <div style={{ fontSize: 48, marginBottom: 16 }}>🎬</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#c4b5fd", marginBottom: 8 }}>ارفع فيديو أو ملف صوت</div>
              <div style={{ fontSize: 13, color: "#6b7280" }}>MP4 · MOV · MP3 · WAV · M4A</div>
              <div style={{ marginTop: 20, display: "inline-block", background: "linear-gradient(135deg,#7c3aed,#38bdf8)", borderRadius: 10, padding: "10px 28px", fontSize: 13, fontWeight: 700, color: "#fff", boxShadow: "0 0 30px rgba(124,58,237,0.4)" }}>
                اختر ملف
              </div>
            </GlowCard>
          )}

          {/* ── UPLOAD BAR (after file selected) ── */}
          {videoURL && (
            <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
              <button onClick={() => fileInputRef.current?.click()}
                style={{ background: "linear-gradient(135deg,#7c3aed,#38bdf8)", border: "none", borderRadius: 10, padding: "8px 18px", color: "#fff", fontFamily: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", boxShadow: "0 0 20px rgba(124,58,237,0.3)" }}>
                📁 فيديو جديد
              </button>
              <input ref={fileInputRef} type="file" accept="video/*,audio/*" onChange={handleFileChange} style={{ display: "none" }} />
              <GlowCard accent="#7c3aed" style={{ flex: 1, padding: "8px 14px", fontSize: 12, color: "#a78bfa", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {fileName}
              </GlowCard>
            </div>
          )}

          {/* ── PROCESSING STATUS ── */}
          {status === "loading" && (
            <GlowCard accent="#38bdf8" style={{ marginBottom: 20, padding: "16px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <div style={{ width: 16, height: 16, borderRadius: "50%", border: "2px solid #38bdf8", borderTopColor: "transparent", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: "#38bdf8", fontWeight: 600 }}>{statusMsg}</span>
              </div>
              <div style={{ height: 4, background: "rgba(56,189,248,0.1)", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${uploadProgress}%`, background: "linear-gradient(90deg,#7c3aed,#38bdf8)", borderRadius: 4, transition: "width 0.4s ease", boxShadow: "0 0 10px rgba(56,189,248,0.5)" }} />
              </div>
              <div style={{ fontSize: 10, color: "#6b7280", marginTop: 6, textAlign: "right" }}>{Math.round(uploadProgress)}%</div>
            </GlowCard>
          )}

          {status === "error" && (
            <GlowCard accent="#fb7185" style={{ marginBottom: 20, padding: "14px 18px", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 18 }}>⚠️</span>
              <span style={{ fontSize: 13, color: "#fb7185" }}>{statusMsg}</span>
            </GlowCard>
          )}

          {/* ── MAIN GRID ── */}
          {videoURL && (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 20, marginBottom: 20 }}>

              {/* LEFT: Video */}
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <GlowCard accent="#7c3aed" style={{ overflow: "hidden" }}>
                  <video ref={videoRef} src={videoURL} controls
                    onTimeUpdate={() => videoRef.current && setCurrentTime(videoRef.current.currentTime)}
                    onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)}
                    style={{ width: "100%", display: "block", background: "#000", borderRadius: 16, maxHeight: 320 }} />
                  <div style={{ padding: "10px 16px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#6b7280", marginBottom: 6 }}>
                      <span>{Math.floor(currentTime / 60)}:{String(Math.floor(currentTime % 60)).padStart(2, "0")}</span>
                      <span>{Math.floor(duration / 60)}:{String(Math.floor(duration % 60)).padStart(2, "0")}</span>
                    </div>
                    <div style={{ height: 3, background: "rgba(167,139,250,0.1)", borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${videoProgress}%`, background: "linear-gradient(90deg,#7c3aed,#38bdf8)", transition: "width 0.2s", boxShadow: "0 0 8px rgba(124,58,237,0.6)" }} />
                    </div>
                  </div>
                </GlowCard>

                {/* Keywords */}
                {keywords.length > 0 && (
                  <GlowCard accent="#a78bfa" style={{ padding: "14px 16px" }}>
                    <div style={{ fontSize: 10, color: "#7c3aed", letterSpacing: "0.15em", marginBottom: 10, fontWeight: 700 }}>🔑 أهم الكلمات</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {keywords.map(kw => {
                        const saved = wordBank.find(w => w.word === kw);
                        return (
                          <button key={kw} onClick={() => saveWord(kw)} style={{
                            background: saved ? "rgba(52,211,153,0.1)" : "rgba(167,139,250,0.1)",
                            border: `1px solid ${saved ? "rgba(52,211,153,0.4)" : "rgba(167,139,250,0.3)"}`,
                            borderRadius: 20, padding: "4px 12px", color: saved ? "#34d399" : "#a78bfa",
                            fontSize: 11, cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s",
                          }}>{saved ? "✓ " : "+ "}{kw}</button>
                        );
                      })}
                    </div>
                  </GlowCard>
                )}

                {/* Summary */}
                {summary.length > 0 && (
                  <GlowCard accent="#38bdf8" style={{ padding: "14px 16px" }}>
                    <div style={{ fontSize: 10, color: "#38bdf8", letterSpacing: "0.15em", marginBottom: 10, fontWeight: 700 }}>🤖 ملخص الذكاء الاصطناعي</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {summary.map((point, i) => (
                        <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                          <div style={{ width: 18, height: 18, borderRadius: "50%", background: "rgba(56,189,248,0.15)", border: "1px solid rgba(56,189,248,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#38bdf8", flexShrink: 0, marginTop: 1 }}>{i + 1}</div>
                          <p style={{ margin: 0, fontSize: 12, color: "#94a3b8", lineHeight: 1.7 }}>{point}</p>
                        </div>
                      ))}
                    </div>
                  </GlowCard>
                )}
              </div>

              {/* RIGHT: Tabs */}
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", gap: 4, marginBottom: 0 }}>
                  {[
                    { id: "transcript", label: "📝 النص" },
                    { id: "wordbank", label: `📚 الكلمات${wordBank.length > 0 ? ` (${wordBank.length})` : ""}` },
                    { id: "quiz", label: "🧠 اختبار" },
                  ].map(tab => (
                    <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                      background: activeTab === tab.id ? "rgba(124,58,237,0.2)" : "transparent",
                      border: `1px solid ${activeTab === tab.id ? "rgba(124,58,237,0.5)" : "rgba(167,139,250,0.1)"}`,
                      borderBottom: "none", borderRadius: "10px 10px 0 0",
                      padding: "8px 14px", color: activeTab === tab.id ? "#c4b5fd" : "#6b7280",
                      fontSize: 11, cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s",
                    }}>{tab.label}</button>
                  ))}
                </div>

                <GlowCard accent="#7c3aed" style={{ flex: 1, borderRadius: "0 12px 12px 12px", overflow: "hidden" }}>

                  {/* TRANSCRIPT TAB */}
                  {activeTab === "transcript" && (
                    transcript.length === 0 ? (
                      <div style={{ padding: 40, textAlign: "center", color: "#374151" }}>
                        <div style={{ fontSize: 32, marginBottom: 10 }}>📝</div>
                        <div style={{ fontSize: 12 }}>{status === "loading" ? "جاري التحليل..." : "النص سيظهر هنا"}</div>
                      </div>
                    ) : (
                      <div ref={transcriptRef} style={{ height: 480, overflowY: "auto", padding: "12px 14px", scrollbarWidth: "thin", scrollbarColor: "rgba(124,58,237,0.3) transparent" }}>
                        {transcript.map((line, i) => (
                          <div key={i} ref={i === activeIndex ? activeLineRef : null}
                            onClick={() => videoRef.current && (videoRef.current.currentTime = line.start / 1000)}
                            style={{ padding: "8px 10px", borderRadius: 8, cursor: "pointer", marginBottom: 4, background: i === activeIndex ? "rgba(124,58,237,0.1)" : "transparent", borderLeft: `3px solid ${i === activeIndex ? "#7c3aed" : "transparent"}`, transition: "all 0.2s", display: "flex", gap: 10 }}>
                            <div style={{ flexShrink: 0, paddingTop: 2 }}>
                              <div style={{ fontSize: 9, color: i === activeIndex ? "#a78bfa" : "#374151", fontWeight: 700 }}>
                                {String(Math.floor(line.start / 60000)).padStart(2, "0")}:{String(Math.floor((line.start % 60000) / 1000)).padStart(2, "0")}
                              </div>
                              {line.speaker && (
                                <div style={{ fontSize: 8, color: speakerColor(line.speaker), marginTop: 2, letterSpacing: "0.05em" }}>S{line.speaker}</div>
                              )}
                            </div>
                            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.8, color: i === activeIndex ? "#e2e0ff" : "#6b7280" }}>
                              {line.text.split(" ").map((word, wi) => (
                                <span key={wi} onClick={e => handleWordClick(word, e)}
                                  style={{ cursor: "pointer", borderRadius: 3, padding: "1px 2px", display: "inline-block", marginRight: 2, transition: "all 0.15s" }}
                                  onMouseOver={e => { e.target.style.background = "rgba(167,139,250,0.2)"; e.target.style.color = "#c4b5fd"; }}
                                  onMouseOut={e => { e.target.style.background = "transparent"; e.target.style.color = ""; }}>
                                  {word}
                                </span>
                              ))}
                            </p>
                          </div>
                        ))}
                      </div>
                    )
                  )}

                  {/* WORD BANK TAB */}
                  {activeTab === "wordbank" && (
                    <div style={{ height: 480, overflowY: "auto", padding: "12px 14px", scrollbarWidth: "thin", scrollbarColor: "rgba(124,58,237,0.3) transparent" }}>
                      {wordBank.length === 0 ? (
                        <div style={{ padding: 40, textAlign: "center", color: "#374151" }}>
                          <div style={{ fontSize: 32, marginBottom: 10 }}>📚</div>
                          <div style={{ fontSize: 12 }}>اضغط على أي كلمة في النص لحفظها</div>
                        </div>
                      ) : (
                        <>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                            <span style={{ fontSize: 10, color: "#6b7280" }}>{wordBank.length} كلمة</span>
                            <div style={{ display: "flex", gap: 8 }}>
                              <button onClick={() => downloadVocabCSV(wordBank)} style={{ background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.3)", borderRadius: 6, padding: "4px 10px", color: "#38bdf8", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>⬇ CSV</button>
                              <button onClick={() => { if (confirm("حذف كل الكلمات؟")) setWordBank([]); }} style={{ background: "transparent", border: "1px solid rgba(251,113,133,0.3)", borderRadius: 6, padding: "4px 10px", color: "#fb7185", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>حذف الكل</button>
                            </div>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {wordBank.map(item => (
                              <div key={item.word} style={{ background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.15)", borderRadius: 10, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontSize: 14, color: "#e2e0ff", fontWeight: 700 }}>{item.word}</div>
                                  <div style={{ fontSize: 12, color: "#a78bfa", marginTop: 2 }}>{item.translation}</div>
                                </div>
                                <button onClick={() => speakWord(item.word)} style={{ background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.2)", borderRadius: 8, padding: "5px 8px", cursor: "pointer", fontSize: 14 }}>🔊</button>
                                <button onClick={() => removeWord(item.word)} style={{ background: "transparent", border: "none", color: "#374151", cursor: "pointer", fontSize: 15, padding: "0 2px" }}>✕</button>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* QUIZ TAB */}
                  {activeTab === "quiz" && (
                    <div style={{ height: 480, overflowY: "auto", padding: "16px 14px" }}>
                      {wordBank.length < 2 ? (
                        <div style={{ padding: 40, textAlign: "center", color: "#374151" }}>
                          <div style={{ fontSize: 32, marginBottom: 10 }}>🧠</div>
                          <div style={{ fontSize: 12 }}>احفظ كلمتين على الأقل لتبدأ الاختبار</div>
                        </div>
                      ) : (
                        <>
                          <div style={{ display: "flex", gap: 8, marginBottom: 20, justifyContent: "center" }}>
                            <Pill active={quizMode === "flashcard"} color="#a78bfa" onClick={() => { setQuizMode("flashcard"); setQuizFlipped(false); }}>بطاقات</Pill>
                            <Pill active={quizMode === "quiz"} color="#38bdf8" onClick={() => { setQuizMode("quiz"); setQuizAnswer(null); }}>اختيار متعدد</Pill>
                          </div>

                          {/* FLASHCARD MODE */}
                          {quizMode === "flashcard" && quizWord && (
                            <div style={{ textAlign: "center" }}>
                              <div onClick={() => setQuizFlipped(!quizFlipped)}
                                style={{ background: quizFlipped ? "rgba(52,211,153,0.1)" : "rgba(124,58,237,0.1)", border: `1px solid ${quizFlipped ? "rgba(52,211,153,0.3)" : "rgba(124,58,237,0.3)"}`, borderRadius: 16, padding: "40px 24px", cursor: "pointer", transition: "all 0.3s", marginBottom: 20, minHeight: 160, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
                                <div style={{ fontSize: 11, color: "#6b7280", letterSpacing: "0.1em" }}>{quizFlipped ? "الترجمة" : "الكلمة"}</div>
                                <div style={{ fontSize: 28, fontWeight: 800, color: quizFlipped ? "#34d399" : "#c4b5fd" }}>
                                  {quizFlipped ? quizWord.translation : quizWord.word}
                                </div>
                                {!quizFlipped && <button onClick={e => { e.stopPropagation(); speakWord(quizWord.word); }} style={{ background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.2)", borderRadius: 8, padding: "4px 12px", cursor: "pointer", fontSize: 13, color: "#38bdf8" }}>🔊</button>}
                                <div style={{ fontSize: 10, color: "#374151", marginTop: 8 }}>اضغط للكشف</div>
                              </div>
                              <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                                <button onClick={() => { setQuizIndex(i => Math.max(i - 1, 0)); setQuizFlipped(false); }} style={{ background: "rgba(124,58,237,0.1)", border: "1px solid rgba(124,58,237,0.3)", borderRadius: 8, padding: "8px 20px", color: "#a78bfa", cursor: "pointer", fontFamily: "inherit", fontSize: 12 }}>← السابق</button>
                                <span style={{ fontSize: 11, color: "#6b7280", alignSelf: "center" }}>{(quizIndex % wordBank.length) + 1} / {wordBank.length}</span>
                                <button onClick={() => { setQuizIndex(i => i + 1); setQuizFlipped(false); }} style={{ background: "rgba(124,58,237,0.1)", border: "1px solid rgba(124,58,237,0.3)", borderRadius: 8, padding: "8px 20px", color: "#a78bfa", cursor: "pointer", fontFamily: "inherit", fontSize: 12 }}>التالي →</button>
                              </div>
                            </div>
                          )}

                          {/* QUIZ MODE */}
                          {quizMode === "quiz" && quizWord && (() => {
                            const options = generateQuizOptions(quizWord);
                            return (
                              <div>
                                <div style={{ textAlign: "center", marginBottom: 20 }}>
                                  <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 8 }}>ما معنى هذه الكلمة؟</div>
                                  <div style={{ fontSize: 28, fontWeight: 800, color: "#c4b5fd" }}>{quizWord.word}</div>
                                  <button onClick={() => speakWord(quizWord.word)} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 18, marginTop: 8 }}>🔊</button>
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                  {options.map((opt, i) => {
                                    const isCorrect = opt.word === quizWord.word;
                                    const isSelected = quizAnswer === i;
                                    let bg = "rgba(124,58,237,0.08)", border = "rgba(124,58,237,0.2)", color = "#94a3b8";
                                    if (quizAnswer !== null) {
                                      if (isCorrect) { bg = "rgba(52,211,153,0.1)"; border = "rgba(52,211,153,0.4)"; color = "#34d399"; }
                                      else if (isSelected) { bg = "rgba(251,113,133,0.1)"; border = "rgba(251,113,133,0.4)"; color = "#fb7185"; }
                                    }
                                    return (
                                      <button key={i} onClick={() => { if (quizAnswer === null) setQuizAnswer(i); }}
                                        style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: "12px 16px", color, cursor: quizAnswer === null ? "pointer" : "default", fontFamily: "inherit", fontSize: 13, textAlign: "left", transition: "all 0.2s" }}>
                                        {opt.translation}
                                      </button>
                                    );
                                  })}
                                </div>
                                {quizAnswer !== null && (
                                  <button onClick={() => { setQuizIndex(i => i + 1); setQuizAnswer(null); }}
                                    style={{ marginTop: 16, width: "100%", background: "linear-gradient(135deg,#7c3aed,#38bdf8)", border: "none", borderRadius: 10, padding: "10px", color: "#fff", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700 }}>
                                    السؤال التالي →
                                  </button>
                                )}
                              </div>
                            );
                          })()}
                        </>
                      )}
                    </div>
                  )}
                </GlowCard>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── POPUP ── */}
      {popup && (
        <div onClick={e => e.stopPropagation()} style={{ position: "fixed", left: Math.min(Math.max(popup.x, 10), window.innerWidth - 250), top: Math.min(popup.y, window.innerHeight - 180), zIndex: 9999, background: "rgba(10,5,25,0.95)", border: "1px solid rgba(124,58,237,0.4)", borderRadius: 14, padding: "16px 18px", width: 240, boxShadow: "0 0 40px rgba(124,58,237,0.3), 0 20px 50px rgba(0,0,0,0.8)", backdropFilter: "blur(20px)", animation: "fadeUp 0.15s ease" }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#e2e0ff", marginBottom: 8 }}>{popup.word}</div>
          <div style={{ height: 1, background: "linear-gradient(90deg,#7c3aed,transparent)", marginBottom: 12 }} />
          {popup.translation === null ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid #7c3aed", borderTopColor: "transparent", animation: "spin 0.7s linear infinite" }} />
              <span style={{ fontSize: 12, color: "#6b7280" }}>جاري الترجمة...</span>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 15, color: "#a78bfa", fontWeight: 700, marginBottom: 12 }}>{popup.translation}</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => speakWord(popup.word)} style={{ flex: 1, background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.3)", borderRadius: 8, padding: "7px", cursor: "pointer", fontSize: 14, color: "#38bdf8" }}>🔊 نطق</button>
                <button onClick={() => { saveWord(popup.word); setPopup(null); }}
                  style={{ flex: 1, background: wordBank.find(w => w.word === popup.word.toLowerCase()) ? "rgba(52,211,153,0.1)" : "rgba(167,139,250,0.1)", border: `1px solid ${wordBank.find(w => w.word === popup.word.toLowerCase()) ? "rgba(52,211,153,0.4)" : "rgba(167,139,250,0.3)"}`, borderRadius: 8, padding: "7px", cursor: "pointer", fontSize: 11, color: wordBank.find(w => w.word === popup.word.toLowerCase()) ? "#34d399" : "#a78bfa", fontFamily: "inherit" }}>
                  {wordBank.find(w => w.word === popup.word.toLowerCase()) ? "✓ محفوظة" : "+ احفظ"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Readex+Pro:wght@400;600;700;800&display=swap');
        @keyframes fadeUp { from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)} }
        @keyframes spin { to{transform:rotate(360deg)} }
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:rgba(124,58,237,0.3);border-radius:4px}
        @media(max-width:768px){
          .main-grid{grid-template-columns:1fr !important}
          header{padding:0 16px !important}
        }
      `}</style>
    </div>
  );
}

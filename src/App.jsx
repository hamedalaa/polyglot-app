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
  { code: "zh", label: "🇨🇳 中文" },
];

const SPEAKER_COLORS = ["#a78bfa","#38bdf8","#fb7185","#34d399","#fbbf24","#c084fc"];

const STOP_WORDS = new Set(["the","a","an","is","it","in","on","at","to","of","and","or","but","was","are","be","this","that","with","for","as","by","from","have","has","had","not","we","they","he","she","you","i","my","our","his","her","its","do","did","will","would","can","could","should","been","were","so","if","up","out","about","what","which","who","when","how","all","some","one","more","also","into","just","like","get","got","than","then","now","here","there","their","your","been","very","even","only","back","after","use","two","well","way","new","want","because","any","these","give","day","most","us"]);

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
  const rows = [["Word","Translation","Language"], ...wordBank.map(w => [w.word, w.translation, w.lang])];
  const csv = rows.map(r => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "polyglot_vocabulary.csv";
  a.click();
}

function GlowCard({ children, style = {}, accent = "#7c3aed" }) {
  return (
    <div style={{
      background: "rgba(15,10,30,0.9)",
      border: `1px solid ${accent}25`,
      borderRadius: 16,
      boxShadow: `0 0 0 1px ${accent}10, 0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 ${accent}12`,
      ...style,
    }}>{children}</div>
  );
}

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
  const [quizMode, setQuizMode] = useState("flashcard");
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizFlipped, setQuizFlipped] = useState(false);
  const [quizAnswer, setQuizAnswer] = useState(null);
  const [quizOptions, setQuizOptions] = useState([]);
  const [wordBank, setWordBank] = useState(() => {
    try { return JSON.parse(localStorage.getItem("polyglot_v2_wordbank") || "[]"); } catch { return []; }
  });

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

  // Generate quiz options when quiz word changes
  useEffect(() => {
    if (wordBank.length >= 2 && quizMode === "quiz") {
      const correct = wordBank[quizIndex % wordBank.length];
      if (!correct) return;
      const others = wordBank.filter(w => w.word !== correct.word).sort(() => Math.random() - 0.5).slice(0, 3);
      setQuizOptions([...others, correct].sort(() => Math.random() - 0.5));
      setQuizAnswer(null);
    }
  }, [quizIndex, quizMode, wordBank.length]);

  const startFakeProgress = () => {
    setUploadProgress(0);
    let p = 0;
    progressInterval.current = setInterval(() => {
      p += Math.random() * 2.5;
      if (p >= 88) { clearInterval(progressInterval.current); p = 88; }
      setUploadProgress(p);
    }, 500);
  };

  const triggerFileInput = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    setVideoURL(URL.createObjectURL(file));
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
      clearInterval(progressInterval.current);
      setUploadProgress(100);

      const sentences = await client.transcripts.sentences(result.id);
      const lines = sentences.sentences.length > 0
        ? sentences.sentences.map(s => ({
            start: s.start, end: s.end, text: s.text,
            speaker: findSpeaker(s.start, result.utterances),
          }))
        : [{ start: 0, end: 0, text: result.text, speaker: null }];

      if (result.summary) {
        const bullets = result.summary.split("\n").filter(l => l.trim()).map(l => l.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
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
    const u = utterances.find(u => Math.abs(u.start - startTime) < 600);
    return u ? u.speaker : null;
  }

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

  const saveWord = async (word) => {
    const clean = word.replace(/[^a-zA-Z]/g, "").toLowerCase();
    if (!clean || clean.length < 2 || wordBank.find(w => w.word === clean)) return;
    const cacheKey = `${clean}_${targetLang}`;
    const translation = cache.current[cacheKey] || await translateWord(clean, targetLang);
    cache.current[cacheKey] = translation;
    setWordBank(prev => [{ word: clean, translation: translation || clean, lang: targetLang, date: Date.now() }, ...prev]);
  };

  const removeWord = (word) => setWordBank(prev => prev.filter(w => w.word !== word));

  useEffect(() => {
    const close = () => setPopup(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const videoProgress = duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;
  const speakerColor = (s) => s ? SPEAKER_COLORS[s.charCodeAt(0) % SPEAKER_COLORS.length] : "#a78bfa";
  const quizWord = wordBank.length > 0 ? wordBank[quizIndex % wordBank.length] : null;

  return (
    <div style={{ minHeight: "100vh", background: "#050510", color: "#e2e0ff", fontFamily: "'Readex Pro','DM Sans',sans-serif" }}>

      {/* BG Orbs */}
      <div style={{ position: "fixed", top: "-15%", left: "-5%", width: "45vw", height: "45vw", borderRadius: "50%", background: "radial-gradient(circle,rgba(124,58,237,0.07) 0%,transparent 70%)", pointerEvents: "none", zIndex: 0 }} />
      <div style={{ position: "fixed", bottom: "-15%", right: "-5%", width: "35vw", height: "35vw", borderRadius: "50%", background: "radial-gradient(circle,rgba(56,189,248,0.05) 0%,transparent 70%)", pointerEvents: "none", zIndex: 0 }} />

      <div style={{ position: "relative", zIndex: 1, minHeight: "100vh", display: "flex", flexDirection: "column" }}>

        {/* ── HEADER ── */}
        <header style={{ height: 58, padding: "0 28px", borderBottom: "1px solid rgba(124,58,237,0.15)", background: "rgba(5,5,16,0.95)", backdropFilter: "blur(20px)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: "linear-gradient(135deg,#7c3aed,#38bdf8)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, boxShadow: "0 0 18px rgba(124,58,237,0.5)", flexShrink: 0 }}>🎓</div>
            <div style={{ display: "flex", gap: 0 }}>
              <span style={{ fontSize: 17, fontWeight: 800, color: "#fff", letterSpacing: "0.1em" }}>POLY</span>
              <span style={{ fontSize: 17, fontWeight: 800, background: "linear-gradient(90deg,#a78bfa,#38bdf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", letterSpacing: "0.1em" }}>GLOT</span>
            </div>
            <div style={{ height: 14, width: 1, background: "rgba(124,58,237,0.3)" }} />
            <span style={{ fontSize: 9, color: "#4b5563", letterSpacing: "0.18em" }}>AI LANGUAGE PLATFORM</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 10, color: "#4b5563", letterSpacing: "0.1em" }}>TRANSLATE TO</span>
            <select value={targetLang} onChange={e => { setTargetLang(e.target.value); setPopup(null); cache.current = {}; }}
              style={{ background: "rgba(124,58,237,0.12)", border: "1px solid rgba(124,58,237,0.3)", borderRadius: 8, color: "#c4b5fd", padding: "5px 10px", fontFamily: "inherit", fontSize: 12, cursor: "pointer", outline: "none" }}>
              {LANGUAGES.map(l => <option key={l.code} value={l.code} style={{ background: "#0f0a1e" }}>{l.label}</option>)}
            </select>
          </div>
        </header>

        {/* ── BODY ── */}
        <div style={{ flex: 1, padding: "24px 28px", maxWidth: "100%", width: "100%" }}>

          {/* ── IDLE STATE ── */}
          {status === "idle" && !videoURL && (
            <div style={{ maxWidth: 600, margin: "60px auto 0" }}>
              <GlowCard accent="#7c3aed" style={{ padding: "50px 40px", textAlign: "center" }}>
                <div style={{ fontSize: 56, marginBottom: 20 }}>🎬</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#e2e0ff", marginBottom: 8 }}>ارفع فيديو أو ملف صوت</div>
                <div style={{ fontSize: 13, color: "#4b5563", marginBottom: 28 }}>MP4 · MOV · MP3 · WAV · M4A</div>
                <input ref={fileInputRef} type="file" accept="video/*,audio/*" onChange={handleFileChange} style={{ display: "none" }} />
                <button
                  onClick={triggerFileInput}
                  style={{ background: "linear-gradient(135deg,#7c3aed,#38bdf8)", border: "none", borderRadius: 12, padding: "14px 36px", color: "#fff", fontFamily: "inherit", fontSize: 15, fontWeight: 800, cursor: "pointer", boxShadow: "0 0 30px rgba(124,58,237,0.5)", letterSpacing: "0.05em" }}>
                  اختر ملف
                </button>
              </GlowCard>
            </div>
          )}

          {/* ── PROCESSING STATUS ── */}
          {status === "loading" && (
            <div style={{ maxWidth: 600, margin: "40px auto" }}>
              <GlowCard accent="#38bdf8" style={{ padding: "24px 28px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
                  <div style={{ width: 20, height: 20, borderRadius: "50%", border: "2px solid #38bdf8", borderTopColor: "transparent", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
                  <span style={{ fontSize: 14, color: "#38bdf8", fontWeight: 600 }}>{statusMsg}</span>
                </div>
                <div style={{ height: 6, background: "rgba(56,189,248,0.1)", borderRadius: 6, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${uploadProgress}%`, background: "linear-gradient(90deg,#7c3aed,#38bdf8)", borderRadius: 6, transition: "width 0.4s ease", boxShadow: "0 0 12px rgba(56,189,248,0.5)" }} />
                </div>
                <div style={{ fontSize: 11, color: "#4b5563", marginTop: 8, textAlign: "right" }}>{Math.round(uploadProgress)}%</div>
              </GlowCard>
            </div>
          )}

          {status === "error" && (
            <div style={{ maxWidth: 600, margin: "40px auto" }}>
              <GlowCard accent="#fb7185" style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 20 }}>⚠️</span>
                <span style={{ fontSize: 13, color: "#fb7185" }}>{statusMsg}</span>
              </GlowCard>
              <div style={{ textAlign: "center", marginTop: 20 }}>
                <input ref={fileInputRef} type="file" accept="video/*,audio/*" onChange={handleFileChange} style={{ display: "none" }} />
                <button onClick={triggerFileInput} style={{ background: "linear-gradient(135deg,#7c3aed,#38bdf8)", border: "none", borderRadius: 10, padding: "10px 28px", color: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>حاول مرة ثانية</button>
              </div>
            </div>
          )}

          {/* ── MAIN DASHBOARD ── */}
          {(status === "ready" || videoURL) && status !== "loading" && status !== "error" && (
            <>
              {/* Top bar */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                <input ref={fileInputRef} type="file" accept="video/*,audio/*" onChange={handleFileChange} style={{ display: "none" }} />
                <button onClick={triggerFileInput}
                  style={{ background: "linear-gradient(135deg,#7c3aed,#38bdf8)", border: "none", borderRadius: 10, padding: "9px 20px", color: "#fff", fontFamily: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", boxShadow: "0 0 16px rgba(124,58,237,0.3)", flexShrink: 0 }}>
                  📁 فيديو جديد
                </button>
                <GlowCard accent="#7c3aed" style={{ flex: 1, padding: "9px 14px", fontSize: 12, color: "#a78bfa", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {fileName}
                </GlowCard>
                {status === "ready" && (
                  <div style={{ background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.3)", borderRadius: 8, padding: "6px 14px", fontSize: 11, color: "#34d399", whiteSpace: "nowrap", flexShrink: 0 }}>
                    ✅ {transcript.length} جملة
                  </div>
                )}
              </div>

              {/* Main Grid */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>

                {/* LEFT COLUMN */}
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

                  {/* Video Player */}
                  <GlowCard accent="#7c3aed" style={{ overflow: "hidden" }}>
                    <video ref={videoRef} src={videoURL} controls
                      onTimeUpdate={() => videoRef.current && setCurrentTime(videoRef.current.currentTime)}
                      onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)}
                      style={{ width: "100%", display: "block", background: "#000", maxHeight: 300 }} />
                    <div style={{ padding: "10px 16px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#4b5563", marginBottom: 6 }}>
                        <span>{Math.floor(currentTime / 60)}:{String(Math.floor(currentTime % 60)).padStart(2, "0")}</span>
                        <span>{Math.floor(duration / 60)}:{String(Math.floor(duration % 60)).padStart(2, "0")}</span>
                      </div>
                      <div style={{ height: 3, background: "rgba(124,58,237,0.1)", borderRadius: 4, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${videoProgress}%`, background: "linear-gradient(90deg,#7c3aed,#38bdf8)", transition: "width 0.2s", boxShadow: "0 0 8px rgba(124,58,237,0.5)" }} />
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
                            <button key={kw} onClick={() => saveWord(kw)} style={{ background: saved ? "rgba(52,211,153,0.1)" : "rgba(167,139,250,0.1)", border: `1px solid ${saved ? "rgba(52,211,153,0.4)" : "rgba(167,139,250,0.3)"}`, borderRadius: 20, padding: "4px 12px", color: saved ? "#34d399" : "#a78bfa", fontSize: 11, cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s" }}>
                              {saved ? "✓ " : "+ "}{kw}
                            </button>
                          );
                        })}
                      </div>
                    </GlowCard>
                  )}

                  {/* Summary */}
                  {summary.length > 0 && (
                    <GlowCard accent="#38bdf8" style={{ padding: "14px 16px" }}>
                      <div style={{ fontSize: 10, color: "#38bdf8", letterSpacing: "0.15em", marginBottom: 10, fontWeight: 700 }}>🤖 ملخص الذكاء الاصطناعي</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {summary.map((point, i) => (
                          <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                            <div style={{ width: 20, height: 20, borderRadius: "50%", background: "rgba(56,189,248,0.12)", border: "1px solid rgba(56,189,248,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#38bdf8", flexShrink: 0, marginTop: 2 }}>{i + 1}</div>
                            <p style={{ margin: 0, fontSize: 12, color: "#94a3b8", lineHeight: 1.7 }}>{point}</p>
                          </div>
                        ))}
                      </div>
                    </GlowCard>
                  )}
                </div>

                {/* RIGHT COLUMN */}
                <div style={{ display: "flex", flexDirection: "column" }}>

                  {/* Tabs */}
                  <div style={{ display: "flex", gap: 4 }}>
                    {[
                      { id: "transcript", label: "📝 النص" },
                      { id: "wordbank", label: `📚 الكلمات${wordBank.length > 0 ? ` (${wordBank.length})` : ""}` },
                      { id: "quiz", label: "🧠 اختبار" },
                    ].map(tab => (
                      <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ background: activeTab === tab.id ? "rgba(124,58,237,0.2)" : "transparent", border: `1px solid ${activeTab === tab.id ? "rgba(124,58,237,0.5)" : "rgba(124,58,237,0.1)"}`, borderBottom: "none", borderRadius: "10px 10px 0 0", padding: "8px 14px", color: activeTab === tab.id ? "#c4b5fd" : "#4b5563", fontSize: 11, cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s" }}>
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <GlowCard accent="#7c3aed" style={{ borderRadius: "0 12px 12px 12px" }}>

                    {/* TRANSCRIPT */}
                    {activeTab === "transcript" && (
                      transcript.length === 0 ? (
                        <div style={{ padding: 40, textAlign: "center", color: "#374151" }}>
                          <div style={{ fontSize: 32, marginBottom: 10 }}>📝</div>
                          <div style={{ fontSize: 12 }}>النص سيظهر هنا بعد التحليل</div>
                        </div>
                      ) : (
                        <div ref={transcriptRef} style={{ height: 500, overflowY: "auto", padding: "12px 14px", scrollbarWidth: "thin", scrollbarColor: "rgba(124,58,237,0.3) transparent" }}>
                          {transcript.map((line, i) => (
                            <div key={i} ref={i === activeIndex ? activeLineRef : null}
                              onClick={() => videoRef.current && (videoRef.current.currentTime = line.start / 1000)}
                              style={{ padding: "8px 10px", borderRadius: 8, cursor: "pointer", marginBottom: 4, background: i === activeIndex ? "rgba(124,58,237,0.1)" : "transparent", borderLeft: `3px solid ${i === activeIndex ? "#7c3aed" : "transparent"}`, transition: "all 0.2s", display: "flex", gap: 10 }}>
                              <div style={{ flexShrink: 0, paddingTop: 3, minWidth: 36 }}>
                                <div style={{ fontSize: 9, color: i === activeIndex ? "#a78bfa" : "#374151", fontWeight: 700 }}>
                                  {String(Math.floor(line.start / 60000)).padStart(2, "0")}:{String(Math.floor((line.start % 60000) / 1000)).padStart(2, "0")}
                                </div>
                                {line.speaker && <div style={{ fontSize: 8, color: speakerColor(line.speaker), marginTop: 2 }}>S{line.speaker}</div>}
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

                    {/* WORD BANK */}
                    {activeTab === "wordbank" && (
                      <div style={{ height: 500, overflowY: "auto", padding: "14px", scrollbarWidth: "thin", scrollbarColor: "rgba(124,58,237,0.3) transparent" }}>
                        {wordBank.length === 0 ? (
                          <div style={{ padding: 40, textAlign: "center", color: "#374151" }}>
                            <div style={{ fontSize: 32, marginBottom: 10 }}>📚</div>
                            <div style={{ fontSize: 12 }}>اضغط على أي كلمة في النص لحفظها هنا</div>
                          </div>
                        ) : (
                          <>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                              <span style={{ fontSize: 11, color: "#4b5563" }}>{wordBank.length} كلمة محفوظة</span>
                              <div style={{ display: "flex", gap: 8 }}>
                                <button onClick={() => downloadVocabCSV(wordBank)} style={{ background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.3)", borderRadius: 6, padding: "4px 10px", color: "#38bdf8", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>⬇ CSV</button>
                                <button onClick={() => { if (confirm("حذف كل الكلمات؟")) setWordBank([]); }} style={{ background: "transparent", border: "1px solid rgba(251,113,133,0.3)", borderRadius: 6, padding: "4px 10px", color: "#fb7185", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>حذف الكل</button>
                              </div>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                              {wordBank.map(item => (
                                <div key={item.word} style={{ background: "rgba(124,58,237,0.07)", border: "1px solid rgba(124,58,237,0.15)", borderRadius: 10, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}>
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: 14, color: "#e2e0ff", fontWeight: 700 }}>{item.word}</div>
                                    <div style={{ fontSize: 12, color: "#a78bfa", marginTop: 2 }}>{item.translation}</div>
                                  </div>
                                  <button onClick={() => speakWord(item.word)} style={{ background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.2)", borderRadius: 8, padding: "5px 8px", cursor: "pointer", fontSize: 14 }}>🔊</button>
                                  <button onClick={() => removeWord(item.word)} style={{ background: "transparent", border: "none", color: "#374151", cursor: "pointer", fontSize: 16, padding: "0 2px" }}>✕</button>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* QUIZ */}
                    {activeTab === "quiz" && (
                      <div style={{ height: 500, overflowY: "auto", padding: "20px 16px" }}>
                        {wordBank.length < 2 ? (
                          <div style={{ padding: 40, textAlign: "center", color: "#374151" }}>
                            <div style={{ fontSize: 32, marginBottom: 10 }}>🧠</div>
                            <div style={{ fontSize: 12 }}>احفظ كلمتين على الأقل لتبدأ</div>
                          </div>
                        ) : (
                          <>
                            {/* Mode toggle */}
                            <div style={{ display: "flex", gap: 8, marginBottom: 24, justifyContent: "center" }}>
                              {[{ id: "flashcard", label: "🃏 بطاقات" }, { id: "quiz", label: "✏️ اختيار متعدد" }].map(m => (
                                <button key={m.id} onClick={() => { setQuizMode(m.id); setQuizFlipped(false); setQuizAnswer(null); }}
                                  style={{ background: quizMode === m.id ? "rgba(124,58,237,0.2)" : "transparent", border: `1px solid ${quizMode === m.id ? "rgba(124,58,237,0.5)" : "rgba(124,58,237,0.15)"}`, borderRadius: 20, padding: "6px 18px", color: quizMode === m.id ? "#c4b5fd" : "#4b5563", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
                                  {m.label}
                                </button>
                              ))}
                            </div>

                            {/* FLASHCARD */}
                            {quizMode === "flashcard" && quizWord && (
                              <div style={{ textAlign: "center" }}>
                                <div onClick={() => setQuizFlipped(!quizFlipped)}
                                  style={{ background: quizFlipped ? "rgba(52,211,153,0.08)" : "rgba(124,58,237,0.08)", border: `1px solid ${quizFlipped ? "rgba(52,211,153,0.3)" : "rgba(124,58,237,0.25)"}`, borderRadius: 16, padding: "40px 24px", cursor: "pointer", transition: "all 0.3s", marginBottom: 20, minHeight: 160, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
                                  <div style={{ fontSize: 10, color: "#4b5563", letterSpacing: "0.12em" }}>{quizFlipped ? "الترجمة" : "الكلمة — اضغط للكشف"}</div>
                                  <div style={{ fontSize: 30, fontWeight: 800, color: quizFlipped ? "#34d399" : "#c4b5fd" }}>
                                    {quizFlipped ? quizWord.translation : quizWord.word}
                                  </div>
                                  {!quizFlipped && (
                                    <button onClick={e => { e.stopPropagation(); speakWord(quizWord.word); }}
                                      style={{ background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.2)", borderRadius: 8, padding: "4px 14px", cursor: "pointer", fontSize: 14, color: "#38bdf8" }}>🔊</button>
                                  )}
                                </div>
                                <div style={{ display: "flex", gap: 10, justifyContent: "center", alignItems: "center" }}>
                                  <button onClick={() => { setQuizIndex(i => Math.max(i - 1, 0)); setQuizFlipped(false); }}
                                    style={{ background: "rgba(124,58,237,0.1)", border: "1px solid rgba(124,58,237,0.25)", borderRadius: 8, padding: "8px 20px", color: "#a78bfa", cursor: "pointer", fontFamily: "inherit", fontSize: 12 }}>← السابق</button>
                                  <span style={{ fontSize: 11, color: "#4b5563" }}>{(quizIndex % wordBank.length) + 1} / {wordBank.length}</span>
                                  <button onClick={() => { setQuizIndex(i => i + 1); setQuizFlipped(false); }}
                                    style={{ background: "rgba(124,58,237,0.1)", border: "1px solid rgba(124,58,237,0.25)", borderRadius: 8, padding: "8px 20px", color: "#a78bfa", cursor: "pointer", fontFamily: "inherit", fontSize: 12 }}>التالي →</button>
                                </div>
                              </div>
                            )}

                            {/* MULTIPLE CHOICE */}
                            {quizMode === "quiz" && quizWord && (
                              <div>
                                <div style={{ textAlign: "center", marginBottom: 24 }}>
                                  <div style={{ fontSize: 11, color: "#4b5563", marginBottom: 10 }}>ما معنى هذه الكلمة؟</div>
                                  <div style={{ fontSize: 30, fontWeight: 800, color: "#c4b5fd", marginBottom: 8 }}>{quizWord.word}</div>
                                  <button onClick={() => speakWord(quizWord.word)} style={{ background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.2)", borderRadius: 8, padding: "4px 14px", cursor: "pointer", fontSize: 13, color: "#38bdf8" }}>🔊 نطق</button>
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                  {quizOptions.map((opt, i) => {
                                    const isCorrect = opt.word === quizWord.word;
                                    const isSelected = quizAnswer === i;
                                    let bg = "rgba(124,58,237,0.07)", border = "rgba(124,58,237,0.18)", color = "#94a3b8";
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
                                    style={{ marginTop: 16, width: "100%", background: "linear-gradient(135deg,#7c3aed,#38bdf8)", border: "none", borderRadius: 10, padding: "11px", color: "#fff", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700, boxShadow: "0 0 20px rgba(124,58,237,0.3)" }}>
                                    السؤال التالي →
                                  </button>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </GlowCard>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── POPUP ── */}
      {popup && (
        <div onClick={e => e.stopPropagation()} style={{ position: "fixed", left: Math.min(Math.max(popup.x, 10), window.innerWidth - 250), top: Math.min(popup.y, window.innerHeight - 180), zIndex: 9999, background: "rgba(8,4,20,0.97)", border: "1px solid rgba(124,58,237,0.45)", borderRadius: 14, padding: "16px 18px", width: 240, boxShadow: "0 0 40px rgba(124,58,237,0.25), 0 20px 50px rgba(0,0,0,0.9)", backdropFilter: "blur(20px)", animation: "fadeUp 0.15s ease" }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#e2e0ff", marginBottom: 8 }}>{popup.word}</div>
          <div style={{ height: 1, background: "linear-gradient(90deg,#7c3aed,transparent)", marginBottom: 12 }} />
          {popup.translation === null ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid #7c3aed", borderTopColor: "transparent", animation: "spin 0.7s linear infinite" }} />
              <span style={{ fontSize: 12, color: "#4b5563" }}>جاري الترجمة...</span>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 15, color: "#a78bfa", fontWeight: 700, marginBottom: 12 }}>{popup.translation}</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => speakWord(popup.word)} style={{ flex: 1, background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.25)", borderRadius: 8, padding: "7px", cursor: "pointer", fontSize: 14, color: "#38bdf8" }}>🔊 نطق</button>
                <button onClick={() => { saveWord(popup.word); setPopup(null); }}
                  style={{ flex: 1, background: wordBank.find(w => w.word === popup.word.toLowerCase()) ? "rgba(52,211,153,0.1)" : "rgba(167,139,250,0.1)", border: `1px solid ${wordBank.find(w => w.word === popup.word.toLowerCase()) ? "rgba(52,211,153,0.35)" : "rgba(167,139,250,0.3)"}`, borderRadius: 8, padding: "7px", cursor: "pointer", fontSize: 11, color: wordBank.find(w => w.word === popup.word.toLowerCase()) ? "#34d399" : "#a78bfa", fontFamily: "inherit" }}>
                  {wordBank.find(w => w.word === popup.word.toLowerCase()) ? "✓ محفوظة" : "+ احفظ"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Readex+Pro:wght@400;600;700;800&display=swap');
        @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:rgba(124,58,237,0.3);border-radius:4px}
        @media(max-width:900px){
          div[style*="grid-template-columns: 1fr 1fr"]{grid-template-columns:1fr !important}
        }
      `}</style>
    </div>
  );
}

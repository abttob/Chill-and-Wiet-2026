/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Users, 
  Calendar, 
  Backpack, 
  Sword, 
  Map as MapIcon, 
  Music, 
  Hammer, 
  Mountain, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  Clock, 
  Car, 
  Train,
  ChevronRight,
  Sparkles,
  RefreshCw,
  Play,
  RotateCcw,
  Beer,
  Zap,
  MapPin,
  Wind
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './map.css';

// Fix Leaflet icons
// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc, getDocFromServer, serverTimestamp, setDoc } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// --- Firebase Initialization ---
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth();
const googleProvider = new GoogleAuthProvider();

// --- Types ---
interface CrewMember {
  id: string;
  name: string;
  arrival: string;
  departure: string;
  transport: 'zug' | 'auto' | 'unbekannt';
}

interface PackingItem {
  id: string;
  text: string;
  category: string;
  checked: boolean;
}

// --- Constants ---
const INITIAL_CREW: string[] = [
  "Toby der Polier", "Marion", "Tai", "Jojo", "Flo", "Vali", "Stephie", "Marco", "Tim (vielleicht)"
];

const STANDARD_PACKLIST: string[] = [
  "Draussenkleider & Schuhe (für Wiet)",
  "Zeckenspray (wer hat)",
  "Chill-Klamotten",
  "Badesachen",
  "Tschäpper",
  "Sonnencreme",
  "Duschtuch",
  "Duvetbezug (160x200cm)",
  "Kissenbezug",
  "Pyjama",
  "Necessaire",
  "Oropax",
  "Wenig Stuff / Jacken"
];

// --- Firebase Helpers ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- AI Setup ---
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [user, setUser] = useState<User | null>(null);

  // Test Firestore connection
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    }
    testConnection();
  }, []);

  // Auth listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [packList, setPackList] = useState<PackingItem[]>([]);
  const [song, setSong] = useState<string>('');
  const [isGeneratingSong, setIsGeneratingSong] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [score, setScore] = useState(0);
  const [unlockedIgnazio, setUnlockedIgnazio] = useState(0); // 0: hidden, 1: summoning, 2: here
  const [toolSharpness, setToolSharpness] = useState<Record<string, number>>({ Axt: 50, Säge: 50, Sense: 50, Öffner: 50 });
  const [mapPoints, setMapPoints] = useState<[number, number][]>([]);
  const [mapMarkers, setMapMarkers] = useState<{ pos: [number, number], label: string }[]>([]);
  
  // Initialize state from local storage or defaults
  useEffect(() => {
    const savedCrew = localStorage.getItem('fratelli_crew');
    if (savedCrew) {
      setCrew(JSON.parse(savedCrew));
    } else {
      const initial = INITIAL_CREW.map(name => ({
        id: crypto.randomUUID(),
        name,
        arrival: "Do Abend",
        departure: "Mo Abend",
        transport: 'unbekannt' as const
      }));
      setCrew(initial);
    }

    const savedPack = localStorage.getItem('fratelli_packlist');
    if (savedPack) {
      setPackList(JSON.parse(savedPack));
    } else {
      setPackList([]); // Users start with an empty personal list, standard is always visible
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('fratelli_crew', JSON.stringify(crew));
  }, [crew]);

  // Stop speech synthesis on tab change or unmount
  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
    };
  }, [activeTab]);

  // --- Actions ---
  const generateSong = async () => {
    setIsGeneratingSong(true);
    try {
      const result = await ai.models.generateContent({
        model: "gemini-flash-latest",
        contents: "Erstelle einen legendären, rhythmischen Songtext (ca. 3 Strophen und ein fetter Refrain) für die 'Lega dei Fratelli'. Kontext: Fratellihof-Wochenende in Rivera, Tessin. Motto: 'Gute Schneid, halbe Arbeit, zwei Rinder'. Inside-Jokes zum Einbauen: 'Druffa gegen Rechts', 'Hueresöhn' (liebevoll gemeint), 'Anti-Stau Strategie (Zug)', 'Death-Sense schärfen', 'Wiet machen', 'Grappa im Loch'. Stil: Schweizer Mundart (Zürich/Tessiner Mix), asozial aber herzlich, hochemotional, wie eine Hymne. Struktur: Klar getrennte Strophen und Refrain. Crew: Toby (Polier), Marion, Tai, Jojo, Flo, Vali, Stephie, Marco, Tim. WICHTIG: Es muss ein richtiger Banger sein!",
      });
      if (!result.text) {
        throw new Error("Kein Text generiert");
      }
      setSong(result.text);
    } catch (error: any) {
      console.error(error);
      setSong(`Fehler: ${error.message || "Unbekannter Fehler beim Song-Generieren."}`);
    } finally {
      setIsGeneratingSong(false);
    }
  };

  const updateMember = (id: string, updates: Partial<CrewMember>) => {
    setCrew(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m));
  };

  const addMember = (name: string) => {
    if (!name.trim()) return;
    setCrew(prev => [...prev, {
      id: crypto.randomUUID(),
      name,
      arrival: "Noch offen",
      departure: "Noch offen",
      transport: 'unbekannt'
    }]);
  };

  const playSong = () => {
    if (!song) return;
    setIsPlaying(true);
    
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    // Better 4/4 Techno Beat
    const playKick = (time: number) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc.frequency.setValueAtTime(150, time);
      osc.frequency.exponentialRampToValueAtTime(40, time + 0.1);
      
      gain.gain.setValueAtTime(0.8, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + 0.5);
      
      osc.start(time);
      osc.stop(time + 0.5);
    };

    const playHiHat = (time: number) => {
      const bufferSize = audioCtx.sampleRate * 0.05;
      const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      const gain = audioCtx.createGain();
      
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 7000;
      
      source.connect(filter);
      filter.connect(gain);
      gain.connect(audioCtx.destination);
      
      gain.gain.setValueAtTime(0.2, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + 0.05);
      
      source.start(time);
      source.stop(time + 0.05);
    };

    let beatCount = 0;
    const interval = 0.5; // 120 BPM
    const timerId = setInterval(() => {
      const now = audioCtx.currentTime;
      playKick(now);
      if (beatCount % 2 === 1) playHiHat(now);
      beatCount++;
    }, interval * 1000);

    const utterance = new SpeechSynthesisUtterance(song);
    utterance.lang = 'de-CH';
    utterance.rate = 0.85;
    utterance.pitch = 0.9;
    utterance.onend = () => {
      setIsPlaying(false);
      clearInterval(timerId);
      audioCtx.close();
    };
    
    // Stop any current speech
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  const resetPackList = () => {
    if (confirm("Möchtest du wirklich deine komplette persönliche Packliste löschen?")) {
      setPackList([]);
    }
  };

  const sharpenTool = (name: string) => {
    setToolSharpness(prev => ({
      ...prev,
      [name]: Math.min(100, (prev[name] || 0) + 10)
    }));
  };

  const togglePackItem = (id: string) => {
    setPackList(prev => prev.map(item => item.id === id ? { ...item, checked: !item.checked } : item));
  };

  const addPackItem = (text: string) => {
    if (!text.trim()) return;
    setPackList(prev => [...prev, { id: crypto.randomUUID(), text, category: 'Personal', checked: false }]);
  };

  const removePackItem = (id: string) => {
    setPackList(prev => prev.filter(item => item.id !== id));
  };

  // --- Components ---

  const Dashboard = () => (
    <div className="space-y-4">
      <header className="flex justify-between items-center border-4 border-slate-900 bg-red-600 p-6 rounded-xl text-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
        <div>
          <h1 className="text-4xl font-black italic uppercase tracking-tighter">Lega dei Fratelli: Rivera '26</h1>
          <p className="text-sm font-bold uppercase tracking-widest mt-1">1. Mai - 3. Mai | Mission: Chill & Wiet</p>
        </div>
        <div className="hidden md:block">
          <div className="bg-yellow-400 text-black px-4 py-2 font-black text-sm rounded border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
            STATUS: SCHNEIDIG
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="LA CREW" icon={<Users className="w-5 h-5" />} color="bg-slate-900 text-white">
          <div className="space-y-1 text-sm font-bold">
            {crew.slice(0, 8).map(member => (
              <div key={member.id} className="flex justify-between border-b border-slate-100 py-1">
                <span className="truncate mr-2">{member.name}</span>
                <span className="text-green-600 shrink-0">{member.transport !== 'unbekannt' ? '✓' : '...'}</span>
              </div>
            ))}
            {crew.length > 8 && <p className="text-[10px] text-center opacity-50 mt-1">Und {crew.length - 8} weitere...</p>}
            <div className="mt-4 bg-blue-100 p-2 border border-blue-900 rounded text-slate-900">
              <p className="text-[10px] font-black uppercase">Haupt-Strategie:</p>
              <p className="text-xs">Do Nachmittag per Zug (Anti-Stau!)</p>
            </div>
          </div>
        </Card>
        
        <Card title="ANREISE-BOARD" icon={<Clock className="w-5 h-5" />} color="bg-yellow-400 text-black">
          <div className="space-y-2">
            <div className="p-2 bg-slate-50 border border-slate-200 rounded">
              <p className="font-black text-xs uppercase">Zug-Tipp:</p>
              <p className="text-[10px] leading-tight">Anfahrt Do Abend/Fr per Zug besser. Über S. Bernardino!</p>
            </div>
            <div className="p-2 bg-red-100 text-red-800 border border-red-300 rounded text-[10px] italic font-black text-center uppercase">
              Achtung: Shuttles zur Pizzeria nötig!
            </div>
          </div>
        </Card>

        <Card title="DAS PROGRAMM" icon={<Calendar className="w-5 h-5" />} color="bg-blue-400 text-black">
          <ul className="text-xs space-y-2 font-bold uppercase tracking-tight">
            <li className="flex items-center gap-2"><span>☐</span> Chill & Wiet (Non-Stop)</li>
            <li className="flex items-center gap-2"><span>☐</span> Hurensöhne verhauen (Daily)</li>
            <li className="flex items-center gap-2"><span>☐</span> Wanderung (Nur bei Bock)</li>
            <li className="flex items-center gap-2"><span>☐</span> Pizza-Invasion</li>
          </ul>
        </Card>
      </div>

      <div className="bg-orange-100 border-4 border-slate-900 p-4 rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-xs font-black uppercase leading-tight">Gute Schneid, halbe Arbeit, zwei Rinder.</h2>
            <p className="text-[10px] font-bold opacity-50 uppercase">Klicke zum Schärfen!</p>
          </div>
          <Hammer className="w-6 h-6" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(toolSharpness).map(([name, val]) => (
            <button 
              key={name} 
              onClick={() => sharpenTool(name)}
              className="p-2 bg-white border-2 border-slate-900 text-center rounded shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-1 transition-all group"
            >
              <div className="text-[10px] font-black uppercase mb-1">{name === 'Sense' ? 'Death-Sense' : name}</div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden border border-black">
                <motion.div 
                  className={`h-full ${Number(val) > 80 ? 'bg-green-500' : Number(val) > 40 ? 'bg-yellow-400' : 'bg-red-500'}`}
                  animate={{ width: `${val}%` }}
                />
              </div>
              <div className="mt-1 text-[8px] font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                {val}% SCHNEIDIG
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const CrewTool = () => {
    const [newName, setNewName] = useState('');
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-black uppercase text-center mb-4 italic tracking-widest">ANREISE-LOGISTIK</h2>
        
        <div className="flex gap-2 max-w-md mx-auto mb-8">
          <input 
            type="text"
            placeholder="Neuer Fratello/Fratella..."
            className="flex-1 p-2 border-2 border-slate-900 rounded font-bold text-xs outline-none focus:ring-2 ring-orange-400"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button 
            onClick={() => { addMember(newName); setNewName(''); }}
            className="px-4 py-2 bg-orange-400 border-2 border-slate-900 rounded font-black text-[10px] uppercase shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-orange-300"
          >
            Eintragen
          </button>
        </div>

        <div className="overflow-x-auto border-4 border-slate-900 rounded bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
        <table className="w-full text-left border-collapse">
          <thead className="bg-slate-900 text-white uppercase text-[10px] tracking-widest">
            <tr>
              <th className="p-3 border-r border-slate-700">Name</th>
              <th className="p-3 border-r border-slate-700">Anreise</th>
              <th className="p-3 border-r border-slate-700">Abreise</th>
              <th className="p-3">Transport</th>
            </tr>
          </thead>
          <tbody>
            {crew.map((member) => (
              <tr key={member.id} className="border-b-2 border-slate-900 hover:bg-amber-50">
                <td className="p-3 font-black text-sm">{member.name}</td>
                <td className="p-3">
                  <input 
                    className="w-full bg-transparent border-b border-transparent focus:border-red-600 outline-none font-bold text-xs"
                    value={member.arrival}
                    onChange={(e) => updateMember(member.id, { arrival: e.target.value })}
                  />
                </td>
                <td className="p-3">
                  <input 
                    className="w-full bg-transparent border-b border-transparent focus:border-red-600 outline-none font-bold text-xs"
                    value={member.departure}
                    onChange={(e) => updateMember(member.id, { departure: e.target.value })}
                  />
                </td>
                <td className="p-3 flex gap-2">
                  <button 
                    onClick={() => updateMember(member.id, { transport: 'auto' })}
                    className={`p-1.5 border-2 border-slate-900 rounded transition-all ${member.transport === 'auto' ? 'bg-orange-400 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]' : 'bg-white'}`}
                  >
                    <Car className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => updateMember(member.id, { transport: 'zug' })}
                    className={`p-1.5 border-2 border-slate-900 rounded transition-all ${member.transport === 'zug' ? 'bg-blue-400 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]' : 'bg-white'}`}
                  >
                    <Train className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-center font-black text-[10px] text-slate-500 uppercase italic">
        * ZWEI FAHRZEUGE INSGESAMT WÄREN GUT (AUTO-CAPACITY: LOW)
      </p>
    </div>
  );
};

  const PackingTool = () => {
    const [newItem, setNewItem] = useState('');
    return (
      <div className="max-w-2xl mx-auto space-y-8">
        <div className="flex justify-between items-center bg-slate-900 text-white p-4 rounded-xl">
          <h2 className="text-2xl font-black uppercase flex items-center gap-4">
            <Backpack className="w-10 h-10" /> Pack-Zentrale
          </h2>
          <button 
            onClick={resetPackList}
            className="flex items-center gap-2 px-3 py-2 bg-red-600 border-2 border-white rounded font-black text-[10px] uppercase shadow-[2px_2px_0px_0px_rgba(255,255,255,1)]"
          >
            <RotateCcw className="w-3 h-3" /> Eigene Liste reset
          </button>
        </div>

        {/* Standard Items Section */}
        <div className="bg-white border-4 border-slate-900 p-6 rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <h3 className="text-sm font-black uppercase mb-4 text-red-600 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> Die Lega-Basics (Pflicht!)
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {STANDARD_PACKLIST.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2 text-xs font-bold p-2 bg-slate-50 border border-slate-200 rounded">
                <span className="text-green-600">✓</span>
                {item}
              </div>
            ))}
          </div>
        </div>
        
        {/* Input for Personal Items */}
        <div className="space-y-4">
          <h3 className="text-sm font-black uppercase text-slate-900 italic">Dein persönlicher Shizzle:</h3>
          <div className="flex gap-4">
            <input 
              type="text" 
              placeholder="Was nimmst du noch mit?" 
              className="flex-1 p-4 border-4 border-black rounded-xl text-lg font-bold outline-none focus:ring-4 ring-yellow-400 transition-all bg-white"
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (addPackItem(newItem), setNewItem(''))}
            />
            <button 
              onClick={() => { addPackItem(newItem); setNewItem(''); }}
              className="p-4 bg-yellow-400 border-4 border-black rounded-xl font-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all"
            >
              <Plus className="w-8 h-8" />
            </button>
          </div>
        </div>

        {/* Personal Items List */}
        <div className="space-y-4">
          <AnimatePresence>
            {packList.map((item) => (
              <motion.div 
                layout
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                key={item.id}
                className={`flex items-center gap-4 p-4 border-4 border-black rounded-xl transition-colors ${item.checked ? 'bg-gray-100 opacity-60 shadow-none' : 'bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]'}`}
              >
                <button onClick={() => togglePackItem(item.id)}>
                  <div className={`w-8 h-8 border-4 border-black rounded-full flex items-center justify-center transition-colors ${item.checked ? 'bg-green-400' : 'bg-white'}`}>
                    {item.checked && <CheckCircle2 className="w-5 h-5 text-black" />}
                  </div>
                </button>
                <span className={`flex-1 text-lg font-bold ${item.checked ? 'line-through' : ''}`}>
                  {item.text}
                </span>
                <button 
                  onClick={() => removePackItem(item.id)}
                  className="p-2 text-red-500 hover:bg-red-50 rounded"
                >
                  <Trash2 className="w-6 h-6" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
          {packList.length === 0 && (
            <p className="text-center italic text-slate-400 font-bold py-8 border-2 border-dashed border-slate-200 rounded-xl">
              Noch keine persönlichen Items hinzugefügt.
            </p>
          )}
        </div>
      </div>
    );
  };

  const MiniGame = () => {
    const [targets, setTargets] = useState<{ id: number; x: number; y: number; hp: number; type: 'jans' | 'cassis' | 'roesti' }[]>([]);
    const [floatingTexts, setFloatingTexts] = useState<{ id: number; x: number; y: number; text: string }[]>([]);
    const [level, setLevel] = useState(1);
    
    useEffect(() => {
      const interval = setInterval(() => {
        if (targets.length < 5) {
          const rand = Math.random();
          const type = rand > 0.8 ? 'jans' : rand > 0.4 ? 'cassis' : 'roesti';
          setTargets(prev => [...prev, { 
            id: Date.now(), 
            x: Math.random() * 80 + 10, 
            y: Math.random() * 80 + 10,
            hp: type === 'jans' ? 5 : type === 'cassis' ? 2 : 1,
            type
          }]);
        }
      }, 1000 - Math.min(level * 50, 500));
      return () => clearInterval(interval);
    }, [targets, level]);

    useEffect(() => {
      setLevel(Math.floor(score / 100) + 1);
    }, [score]);

    const playHitSound = (type: 'jans' | 'cassis' | 'roesti') => {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      if (type === 'jans') {
        // Regal Fanfare (Arpeggio)
        const playNote = (freq: number, startTime: number) => {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(freq, startTime);
          gain.gain.setValueAtTime(0.3, startTime);
          gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.3);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start(startTime);
          osc.stop(startTime + 0.3);
        };
        const now = audioCtx.currentTime;
        playNote(523.25, now); // C5
        playNote(659.25, now + 0.1); // E5
        playNote(783.99, now + 0.2); // G5
      } else if (type === 'cassis') {
        // Synth Pew Pew
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1000, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.2);
      } else {
        // Comical Bonk
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(150, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.6, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.1);
      }

      setTimeout(() => audioCtx.close(), 1000);
    };

    const hit = (id: number, x: number, y: number) => {
      const target = targets.find(t => t.id === id);
      if (!target) return;

      playHitSound(target.type);

      if (target.hp <= 1) {
        setScore(prev => prev + (target.type === 'jans' ? 100 : target.type === 'cassis' ? 50 : 25));
        setTargets(prev => prev.filter(t => t.id !== id));
      } else {
        setTargets(prev => prev.map(t => t.id === id ? { ...t, hp: t.hp - 1 } : t));
      }
      
      const phrases = ["SCHEISSE!", "CASSIIS!", "RÖÖÖÖSTI!", "JAAANS!", "ZACK!", "HUUUGO!", "CRACK!", "TESSIN!", "RIVERO!"];
      const newText = { id: Date.now(), x, y, text: phrases[Math.floor(Math.random() * phrases.length)] };
      setFloatingTexts(prev => [...prev, newText]);
      setTimeout(() => setFloatingTexts(prev => prev.filter(t => t.id !== newText.id)), 1000);
    };

    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center bg-black text-white p-6 rounded-xl border-b-8 border-red-600">
          <div>
            <h3 className="text-2xl font-black uppercase tracking-tighter italic">Hurensöhne RPG</h3>
            <p className="text-[10px] font-mono text-slate-500 uppercase">LEVEL {level} | SCORE: {score} | STATUS: {score > 500 ? 'LEGENDÄRE SCHNEID' : 'ANFÄNGER'}</p>
          </div>
          <motion.div 
            key={score}
            initial={{ scale: 1.5, color: '#facc15' }}
            animate={{ scale: 1, color: '#facc15' }}
            className="text-6xl font-black"
          >
            {score}
          </motion.div>
        </div>
        
        <div className="relative h-[500px] bg-slate-900 border-8 border-slate-900 rounded-3xl overflow-hidden cursor-crosshair shadow-[12px_12px_0px_0px_rgba(239,68,68,1)]">
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20 select-none">
            <h2 className="text-8xl font-black uppercase text-red-600 text-center italic animate-pulse tracking-tighter">DRUFFA GEGEN RECHTS!</h2>
          </div>
          
          <AnimatePresence>
            {targets.map(target => (
              <motion.button
                key={target.id}
                initial={{ scale: 0, rotate: -45 }}
                animate={{ 
                  scale: target.type === 'jans' ? 2 : target.type === 'cassis' ? 1.6 : 1.3, 
                  rotate: [0, 10, -10, 0],
                  transition: { rotate: { repeat: Infinity, duration: 0.5 } }
                }}
                exit={{ scale: 0.2, opacity: 0, y: 150, rotate: 360 }}
                className={`absolute bg-white border-4 border-slate-900 rounded-full flex flex-col items-center justify-center shadow-2xl hover:bg-yellow-400 transition-colors z-20 group 
                  ${target.type === 'jans' ? 'w-32 h-32 ring-4 ring-yellow-400' : target.type === 'cassis' ? 'w-24 h-24' : 'w-20 h-20'}`}
                style={{ left: `${target.x}%`, top: `${target.y}%` }}
                onClick={() => hit(target.id, target.x, target.y)}
              >
                <div className="h-1 w-12 bg-gray-200 absolute -top-4 rounded-full overflow-hidden border border-black shadow-sm">
                   <div className="bg-red-500 h-full" style={{ width: `${(target.hp / (target.type === 'jans' ? 5 : target.type === 'cassis' ? 2 : 1)) * 100}%` }} />
                </div>
                <span className="select-none group-active:scale-110 transition-transform overflow-hidden rounded-full w-full h-full flex items-center justify-center bg-slate-200 border-2 border-white shadow-inner relative">
                  {target.type === 'jans' ? (
                    <div className="flex flex-col items-center justify-center w-full h-full bg-indigo-500 text-white rounded-full p-2">
                       <span className="text-4xl">🤴</span>
                       <span className="text-[10px] font-black uppercase mt-1">JANS</span>
                    </div>
                  ) : target.type === 'cassis' ? (
                    <div className="flex flex-col items-center justify-center w-full h-full bg-red-500 text-white rounded-full p-2">
                       <span className="text-3xl">🕶️</span>
                       <span className="text-[10px] font-black uppercase mt-1">IGNAZIO</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center w-full h-full bg-green-500 text-white rounded-full p-2">
                       <span className="text-2xl">🚜</span>
                       <span className="text-[10px] font-black uppercase mt-1">ALBERT</span>
                    </div>
                  )}
                </span>
              </motion.button>
            ))}
          </AnimatePresence>
          
          {floatingTexts.map(ft => (
            <motion.div
              key={ft.id}
              initial={{ opacity: 1, y: 0, scale: 1 }}
              animate={{ opacity: 0, y: -100, scale: 1.5 }}
              className="absolute pointer-events-none z-30 font-black text-2xl text-yellow-400 stroke-black stroke-2 bg-black px-2 rounded italic"
              style={{ left: `${ft.x}%`, top: `${ft.y}%` }}
            >
              {ft.text}
            </motion.div>
          ))}
        </div>
      </div>
    );
  };

  const BanntagMap = () => {
    const defaultPos: [number, number] = [46.1085, 8.9220]; // Rivera
    const stopsLabels = [
      "Inspektion", "Trinkpause", "Rauchpause", "Steinen werfen am 1. mai", 
      "Bauinspektion", "Hurensöhne beschimpfen"
    ];

    const MapEventHandler = () => {
      useMapEvents({
        click(e) {
          setMapPoints(prev => [...prev, [e.latlng.lat, e.latlng.lng]]);
        }
      });
      return null;
    };

    const addMarker = (label: string) => {
      if (mapPoints.length === 0) return;
      setMapMarkers(prev => [...prev, { pos: mapPoints[mapPoints.length - 1], label }]);
    };

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap justify-between items-center gap-4 bg-white p-4 border-4 border-slate-900 rounded-xl">
          <div>
            <h2 className="text-2xl font-black uppercase italic">Banntag Tracker Rivera</h2>
            <p className="text-[10px] font-bold opacity-50">Klicke in die Karte zum Zeichnen. Marker setzen via Buttons.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {stopsLabels.map(label => (
              <button 
                key={label}
                onClick={() => addMarker(label)}
                className="px-2 py-1 bg-slate-100 border border-slate-900 text-[8px] font-black uppercase hover:bg-yellow-400 transition-colors rounded shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
              >
                + {label}
              </button>
            ))}
            <button 
              onClick={() => { setMapPoints([]); setMapMarkers([]); }}
              className="px-4 py-1 bg-red-500 text-white border-2 border-slate-900 text-[8px] font-black uppercase hover:bg-red-400 transition-colors rounded shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
            >
              Reset All
            </button>
          </div>
        </div>
        
        <div className="h-[600px] border-4 border-slate-900 rounded-3xl overflow-hidden shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] relative">
          <MapContainer center={defaultPos} zoom={15} scrollWheelZoom={false}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapEventHandler />
            {mapPoints.length > 1 && (
              <Polyline positions={mapPoints} color="#ef4444" weight={8} opacity={0.6} />
            )}
            {mapMarkers.map((m, i) => (
              <Marker key={i} position={m.pos}>
                <Popup>
                  <div className="font-black uppercase text-xs">{m.label}</div>
                  <div className="text-[10px] italic">Fratelli Stop #{i+1}</div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
          <div className="absolute top-4 right-4 z-[1000] bg-white p-2 border-2 border-slate-900 rounded text-[10px] font-black uppercase">
            Distance drawn: {(mapPoints.length * 0.1).toFixed(2)} km (ca.)
          </div>
        </div>
      </div>
    );
  };

  const MusicVideo = ({ active }: { active: boolean }) => {
    if (!active) return null;

    const slogans = ["DRUFFA GEGEN RECHTS!", "HURENSÖHNE!", "GUTE SCHNEID!", "ZWEI RINDER!", "HALBE ARBEIT!", "DIE LEGA RUFT!"];
    const icons = [Hammer, Beer, Zap, Sword, Mountain];

    return (
      <div className="absolute inset-0 z-50 pointer-events-none overflow-hidden bg-red-600/90 mix-blend-multiply">
        <motion.div 
          animate={{ background: ["rgba(255,0,0,0.4)", "rgba(0,0,255,0.4)", "rgba(255,255,0,0.4)", "rgba(255,0,0,0.4)"] }}
          transition={{ duration: 0.5, repeat: Infinity }}
          className="w-full h-full"
        />
        
        {/* Floating Icons */}
        {[...Array(12)].map((_, i) => {
          const Icon = icons[i % icons.length];
          return (
            <motion.div
              key={i}
              initial={{ x: Math.random() * 100 + "%", y: "110%", rotate: 0 }}
              animate={{ 
                y: "-110%", 
                rotate: 360,
                x: [Math.random() * 100 + "%", Math.random() * 100 + "%"]
              }}
              transition={{ 
                duration: 2 + Math.random() * 2, 
                repeat: Infinity, 
                ease: "linear",
                delay: i * 0.2
              }}
              className="absolute text-white/40"
            >
              <Icon size={Math.random() * 60 + 40} />
            </motion.div>
          );
        })}

        {/* Slogans */}
        <div className="absolute inset-0 flex flex-col justify-around">
          {slogans.map((slogan, i) => (
            <motion.div
              key={i}
              initial={{ x: i % 2 === 0 ? "100%" : "-100%" }}
              animate={{ x: i % 2 === 0 ? "-100%" : "100%" }}
              transition={{ duration: 3, repeat: Infinity, ease: "linear", delay: i * 0.5 }}
              className="whitespace-nowrap text-8xl font-black text-white stroke-black stroke-4 opacity-30 italic"
            >
              {slogan} {slogan} {slogan}
            </motion.div>
          ))}
        </div>

        {/* Center Lyric Highlight */}
        <motion.div 
          animate={{ scale: [1, 1.2, 1], rotate: [0, 5, -5, 0] }}
          transition={{ duration: 0.25, repeat: Infinity }}
          className="absolute inset-0 flex items-center justify-center"
        >
          <div className="bg-yellow-400 text-black px-8 py-4 border-8 border-black -rotate-6 shadow-[15px_15px_0px_0px_rgba(0,0,0,1)]">
            <h3 className="text-6xl font-black uppercase italic tracking-tighter">LEGA DEL FRATELLI</h3>
          </div>
        </motion.div>
      </div>
    );
  };

  const AISection = () => (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="bg-slate-900 text-white rounded-xl border-4 border-slate-900 overflow-hidden shadow-[8px_8px_0px_0px_rgba(239,68,68,1)] relative">
        <MusicVideo active={isPlaying} />
        <header className="bg-red-600 p-4 border-b-4 border-slate-900 flex justify-between items-center relative z-10">
           <h2 className="text-xl font-black uppercase italic">Lega di Ticinese (Fratelli Edit)</h2>
           <Music className="w-6 h-6 text-yellow-400" />
        </header>
        
        <div className="p-8 text-center bg-slate-900">
          {isGeneratingSong ? (
            <div className="flex flex-col items-center gap-4 py-8">
              <RefreshCw className="w-12 h-12 animate-spin text-yellow-400" />
              <p className="text-lg font-black uppercase italic tracking-widest text-slate-400">Komponiere Tessiner Smash-Hit...</p>
            </div>
          ) : song ? (
            <div className="space-y-6">
              {isPlaying && (
                <div className="flex justify-center items-end gap-1 h-12 mb-4">
                  {[...Array(12)].map((_, i) => (
                    <motion.div
                      key={i}
                      animate={{ height: [10, Math.random() * 40 + 10, 10] }}
                      transition={{ repeat: Infinity, duration: 0.3 + Math.random() * 0.2 }}
                      className="w-2 bg-red-500 rounded-t"
                    />
                  ))}
                </div>
              )}
              <pre className="whitespace-pre-wrap font-sans text-lg font-bold leading-relaxed text-slate-100 italic">"{song}"</pre>
              <div className="flex justify-center gap-4 border-t-2 border-slate-800 pt-6">
                <button 
                  onClick={playSong}
                  className={`flex items-center gap-2 px-6 py-3 border-2 border-white rounded font-black shadow-[2px_2px_0px_0px_rgba(255,255,255,1)] hover:scale-105 active:scale-95 transition-all text-sm ${isPlaying ? 'bg-red-500 animate-pulse' : 'bg-blue-500'}`}
                >
                  <Play className={`fill-current w-4 h-4 ${isPlaying ? 'animate-spin' : ''}`} /> 
                  {isPlaying ? 'SPIELT...' : 'SPIELEN'}
                </button>
                <button onClick={generateSong} className="px-6 py-3 bg-slate-800 border-2 border-slate-700 rounded font-bold hover:bg-slate-700 flex items-center gap-2 text-sm">
                  <RefreshCw className="w-4 h-4" /> REMIX
                </button>
              </div>
            </div>
          ) : (
            <div className="py-12 border-2 border-dashed border-slate-700 rounded-xl">
              <p className="text-slate-500 font-mono text-xs uppercase mb-6">Kein Song geladen. Studio bereit.</p>
              <button 
                onClick={generateSong}
                className="px-8 py-4 bg-yellow-400 border-2 border-slate-900 rounded text-black font-black text-xl shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)] hover:bg-yellow-300 transition-all uppercase"
              >
                HIT GENERIEREN
              </button>
            </div>
          )}
        </div>
      </div>
      <p className="text-center text-[10px] font-mono text-slate-500 uppercase tracking-widest">Powered by Gemini | Licensed by Lega</p>
    </div>
  );

  const WinterSection = () => {
    const [ritualProgress, setRitualProgress] = useState(0);
    const [wisdom, setWisdom] = useState("");
    const [floatingTexts, setFloatingTexts] = useState<{ id: number; x: number; y: number; text: string }[]>([]);
    
    const quotes = [
      "Wer im Winter schläft, hat im Mai mehr Schneid.",
      "Ein Grappa am Morgen vertreibt Kummer und Sorgen - auch im Loch.",
      "Die Axt im Haus ersetzt den Psychiater.",
      "Lega ist nicht nur eine Partei, es ist ein Lebensgefühl.",
      "Gute Schneid ist die halbe Miete, die andere Hälfte ist Bier.",
      "Ignazio sagt: 'Mehr Sonne, weniger Stress!'"
    ];

    const addRitual = (amount: number, type?: string) => {
      setRitualProgress(prev => Math.min(100, prev + amount));
      
      // Add floating text for feedback
      const id = Date.now();
      const text = type === 'jump' ? 'HOPP!' : type === 'insult' ? 'HUERESOOOOHN!' : `+${amount}`;
      setFloatingTexts(prev => [...prev, { id, x: 50, y: 50, text }]);
      setTimeout(() => setFloatingTexts(prev => prev.filter(t => t.id !== id)), 1000);

      if (ritualProgress + amount >= 100 && unlockedIgnazio < 2) {
        setUnlockedIgnazio(2);
      }
    };

    const getWisdom = () => {
      setWisdom(quotes[Math.floor(Math.random() * quotes.length)]);
    };

    return (
      <div className="max-w-2xl mx-auto space-y-8 text-center min-h-[600px] flex flex-col items-center justify-center bg-purple-600 border-4 border-slate-900 rounded-3xl shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] text-white p-8 relative overflow-hidden">
        {/* Floating feedback texts */}
        <AnimatePresence>
          {floatingTexts.map(ft => (
            <motion.div
              key={ft.id}
              initial={{ opacity: 1, y: 0, scale: 0.5 }}
              animate={{ opacity: 0, y: -200, scale: 2 }}
              exit={{ opacity: 0 }}
              className="absolute z-50 font-black text-4xl text-yellow-400 stroke-black stroke-2 drop-shadow-[4px_4px_0px_rgba(0,0,0,1)] pointer-events-none"
            >
              {ft.text}
            </motion.div>
          ))}
        </AnimatePresence>

        <h2 className="text-3xl font-black uppercase tracking-widest italic flex items-center gap-4 relative z-10">
          <Mountain className="w-10 h-10" /> Das Winterloch-Ritual
        </h2>
        
        {unlockedIgnazio < 2 ? (
          <div className="w-full space-y-8 relative z-10">
            <div className="flex justify-around items-center gap-8">
              <div className="text-center">
                <motion.div 
                  animate={ritualProgress > 50 ? { 
                    y: [0, -20, 0],
                    rotate: [0, 5, -5, 0]
                  } : {}}
                  transition={{ repeat: Infinity, duration: 0.5 }}
                  style={{ 
                    filter: `grayscale(${100 - ritualProgress}%)`,
                    scale: 1 + ritualProgress/200 
                  }}
                  className="w-24 h-24 bg-slate-400 rounded-full border-4 border-white mb-2 flex items-center justify-center text-4xl shadow-lg"
                >
                  👨🏻
                </motion.div>
                <p className="text-[10px] font-black uppercase tracking-tighter">IGNAZIO</p>
              </div>
              <div className="text-center">
                <motion.div 
                  animate={ritualProgress > 50 ? { 
                    y: [0, -15, 0],
                    rotate: [0, -5, 5, 0]
                  } : {}}
                  transition={{ repeat: Infinity, duration: 0.6 }}
                  style={{ 
                    filter: `grayscale(${100 - ritualProgress}%)`,
                    scale: 1 + ritualProgress/200 
                  }}
                  className="w-24 h-24 bg-slate-400 rounded-full border-4 border-white mb-2 flex items-center justify-center text-4xl shadow-lg"
                >
                  👨🏼
                </motion.div>
                <p className="text-[10px] font-black uppercase tracking-tighter">BEAT</p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-[10px] font-black uppercase px-2 mb-1">
                <span>Awakening Level</span>
                <span>{ritualProgress}%</span>
              </div>
              <div className="h-6 bg-purple-900 border-2 border-white rounded-full overflow-hidden p-1">
                <motion.div 
                  className="h-full bg-yellow-400 rounded-full"
                  animate={{ width: `${ritualProgress}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {[
                { l: 'Birra', v: 10, i: <Beer className="w-4 h-4" /> },
                { l: 'Grappa', v: 15, i: <Zap className="w-4 h-4" /> },
                { l: 'Springen', v: 20, i: <Zap className="w-4 h-4 text-blue-400" />, t: 'jump' },
                { l: 'Beschimpfen', v: 30, i: <Wind className="w-4 h-4 text-red-400" />, t: 'insult' },
                { l: 'Sonne', v: 5, i: <Sparkles className="w-4 h-4" /> },
                { l: 'Crack', v: 25, i: <Plus className="w-4 h-4" /> },
                { l: 'Crackpfeiffe', v: 20, i: <div className="relative"><Wind className="w-4 h-4" /><div className="absolute -top-1 -right-1 w-1.5 h-1.5 bg-gray-400 rounded-full animate-ping" /></div> }
              ].map(rit => (
                <button 
                  key={rit.l}
                  onClick={() => addRitual(rit.v, rit.t)}
                  className={`p-3 bg-white text-purple-600 border-2 border-slate-900 rounded-xl font-black text-[10px] uppercase shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-yellow-400 hover:text-black active:translate-y-1 transition-all flex flex-col items-center gap-1 ${rit.t === 'insult' ? 'col-span-1 sm:col-span-1' : ''}`}
                >
                  {rit.i}
                  {rit.l === 'Beschimpfen' ? 'HUERESOOOOHN' : rit.l}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <motion.div 
            initial={{ scale: 0, rotate: 720 }}
            animate={{ scale: 1, rotate: 0 }}
            className="space-y-8 relative z-10"
          >
            <div className="flex gap-4 justify-center">
               <motion.div animate={{ rotate: [5,-5,5] }} transition={{repeat:Infinity, duration: 1}} className="w-40 h-40 bg-yellow-400 border-4 border-slate-900 rounded-3xl flex items-center justify-center text-7xl shadow-xl">👨🏻</motion.div>
               <motion.div animate={{ rotate: [-5,5,-5] }} transition={{repeat:Infinity, duration: 1.1}} className="w-40 h-40 bg-blue-400 border-4 border-slate-900 rounded-3xl flex items-center justify-center text-7xl shadow-xl">👨🏼</motion.div>
            </div>
            <div className="space-y-4">
              <p className="text-4xl font-black text-yellow-400 uppercase italic animate-bounce tracking-tighter">LEGENDÄR!</p>
              {wisdom && (
                <motion.div initial={{opacity:0}} animate={{opacity:1}} className="bg-black/30 p-4 border-2 border-dashed border-white rounded-xl italic font-bold">
                  "{wisdom}"
                </motion.div>
              )}
              <div className="flex justify-center gap-4">
                <button onClick={getWisdom} className="px-6 py-3 bg-white text-black border-2 border-black rounded-xl font-black text-xs uppercase shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">Weisheit</button>
                <button onClick={() => { setUnlockedIgnazio(0); setRitualProgress(0); setWisdom(""); }} className="px-6 py-3 bg-red-500 text-white border-2 border-black rounded-xl font-black text-xs uppercase shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">Ins Loch</button>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-amber-50 font-sans text-slate-900 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        
        {/* User bar */}
        <div className="flex justify-end mb-4">
          {user ? (
            <div className="flex items-center gap-3 bg-white border-2 border-slate-900 px-3 py-1.5 rounded-full shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
              {user.photoURL && <img src={user.photoURL} alt={user.displayName || ''} className="w-6 h-6 rounded-full border border-slate-900" />}
              <span className="text-[10px] font-black uppercase">{user.displayName || user.email}</span>
              <button 
                onClick={() => auth.signOut()}
                className="text-[10px] font-black uppercase text-red-600 hover:underline"
              >
                Logout
              </button>
            </div>
          ) : (
            <button 
              onClick={() => signInWithPopup(auth, googleProvider)}
              className="px-4 py-1.5 bg-white border-2 border-slate-900 rounded-full font-black text-[10px] uppercase shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-slate-50 transition-all"
            >
              Anmelden
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex flex-wrap justify-center gap-2 md:gap-4 mb-8">
          <NavButton active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<Sparkles className="w-4 h-4" />} label="Dash" color="bg-red-600 !text-white" />
          <NavButton active={activeTab === 'crew'} onClick={() => setActiveTab('crew')} icon={<Users className="w-4 h-4" />} label="Crew" color="bg-slate-900 !text-white" />
          <NavButton active={activeTab === 'pack'} onClick={() => setActiveTab('pack')} icon={<Backpack className="w-4 h-4" />} label="Packen" color="bg-green-400" />
          <NavButton active={activeTab === 'game'} onClick={() => setActiveTab('game')} icon={<Sword className="w-4 h-4" />} label="Action" color="bg-red-500 !text-white" />
          <NavButton active={activeTab === 'map'} onClick={() => setActiveTab('map')} icon={<MapIcon className="w-4 h-4" />} label="Route" color="bg-blue-400" />
          <NavButton active={activeTab === 'song'} onClick={() => setActiveTab('song')} icon={<Music className="w-4 h-4" />} label="Lega" color="bg-yellow-400" />
          <NavButton active={activeTab === 'winter'} onClick={() => setActiveTab('winter')} icon={<Mountain className="w-4 h-4" />} label="Loch" color="bg-purple-600 !text-white" />
        </nav>

        {/* Content */}
        <main className="min-h-[600px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.2 }}
            >
              {activeTab === 'dashboard' && <Dashboard />}
              {activeTab === 'crew' && <CrewTool />}
              {activeTab === 'pack' && <PackingTool />}
              {activeTab === 'game' && <MiniGame />}
              {activeTab === 'map' && <BanntagMap />}
              {activeTab === 'song' && <AISection />}
              {activeTab === 'winter' && <WinterSection />}
            </motion.div>
          </AnimatePresence>
        </main>

        <footer className="mt-20 py-6 border-t-4 border-red-600 bg-slate-900 text-white px-8 flex flex-col md:flex-row justify-between items-center gap-4 rounded-b-xl">
          <div className="flex gap-4 items-center">
            <div className="w-10 h-10 bg-blue-500 rounded flex items-center justify-center text-xl shadow-[2px_2px_0px_0px_rgba(255,255,255,1)]">🎵</div>
            <div>
              <p className="text-xs font-bold text-yellow-400 uppercase">SYSTEM: Fratelli V-26</p>
              <p className="text-[10px] italic font-serif text-slate-300">"Gute Schneid, halbe Arbeit, zwei Rinder."</p>
            </div>
          </div>
          <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">
            100% SCHNEIDIG | 0% STRESS | RIVEROBOUND
          </p>
        </footer>
      </div>
    </div>
  );
}

// --- Helper UI Components ---

function NavButton({ active, onClick, icon, label, color }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string, color: string }) {
  return (
    <button 
      onClick={onClick}
      className={`
        group flex items-center gap-2 px-3 py-2 border-2 border-slate-900 rounded font-black uppercase text-[10px] tracking-widest transition-all
        ${active ? `${color} shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] -translate-x-1 -translate-y-1` : 'bg-white hover:bg-slate-50 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'}
      `}
    >
      <span className={`transition-transform group-hover:scale-110 ${active ? 'scale-105' : ''}`}>{icon}</span>
      <span className={active ? 'block' : 'hidden sm:block'}>{label}</span>
    </button>
  );
}

function Card({ title, icon, color, children }: { title: string, icon: React.ReactNode, color: string, children: React.ReactNode }) {
  return (
    <div className="bg-white border-2 border-slate-900 rounded-sm overflow-hidden shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex flex-col">
      <div className={`${color} p-2 border-b-2 border-slate-900 flex items-center gap-2`}>
        {icon}
        <h3 className="text-xs font-black uppercase tracking-widest italic">{title}</h3>
      </div>
      <div className="p-3 flex-grow">
        {children}
      </div>
    </div>
  );
}

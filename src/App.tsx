import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, 
  Upload, 
  Video, 
  Scissors, 
  Download, 
  Play, 
  Pause, 
  Wand2, 
  TrendingUp, 
  Type, 
  Layout, 
  Trash2,
  ChevronRight,
  Settings,
  User,
  History,
  CheckCircle2,
  Undo2,
  Redo2,
  Clock,
  Maximize,
  Shield,
  CreditCard,
  Zap,
  Star,
  Check,
  QrCode,
  Copy,
  CheckCheck
} from 'lucide-react';
import { VideoProject, VideoClip, ProcessingProgress, TemplateType, UserProfile, UserTier } from './types';
import { io } from 'socket.io-client';
import { GoogleGenAI, Type as GenAIType } from "@google/genai";
import { auth, googleProvider, db } from './firebase';
import { signInWithPopup, onAuthStateChanged, User as FirebaseUser, signOut } from 'firebase/auth';
import { 
  doc, 
  setDoc, 
  getDoc, 
  collection, 
  query, 
  where, 
  onSnapshot, 
  updateDoc, 
  deleteDoc,
  getDocFromServer
} from 'firebase/firestore';

// Initialize Socket.IO
const socket = io();

// Constants
const GOOGLE_COLORS = ['#4285F4', '#EA4335', '#FBBC05', '#34A853'];

export default function App() {
  const [view, setView] = useState<'landing' | 'dashboard' | 'editor' | 'pricing'>('landing');
  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [activeProject, setActiveProject] = useState<VideoProject | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<Record<string, ProcessingProgress>>({});
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<{ tier: UserTier, price: number, isAnnual: boolean } | null>(null);

  // Auth & Connection Testing
  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {}
    };
    testConnection();

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setAuthLoading(false);
      
      if (firebaseUser) {
        // Sync user to firestore
        const userRef = doc(db, 'users', firebaseUser.uid);
        const userDoc = await getDoc(userRef);
        
        let currentProfile: UserProfile;

        if (!userDoc.exists()) {
          currentProfile = {
            uid: firebaseUser.uid,
            email: firebaseUser.email || '',
            displayName: firebaseUser.displayName || 'Creator',
            createdAt: Date.now(),
            subscription: {
              tier: 'free',
              credits: 60,
              maxCredits: 60
            }
          };
          await setDoc(userRef, currentProfile);
        } else {
          currentProfile = userDoc.data() as UserProfile;
        }
        
        setProfile(currentProfile);

        // Subscribe to user document for real-time pricing updates
        const unsubProfile = onSnapshot(userRef, (doc) => {
          if (doc.exists()) setProfile(doc.data() as UserProfile);
        });

        // Subscribe to user projects
        const q = query(collection(db, 'projects'), where('userId', '==', firebaseUser.uid));
        const unsubProjects = onSnapshot(q, (snapshot) => {
          const fetchedProjects = snapshot.docs.map(doc => doc.data() as VideoProject);
          setProjects(fetchedProjects.sort((a,b) => b.createdAt - a.createdAt));
        });
        return () => {
          unsubProfile();
          unsubProjects();
        };
      } else {
        setProjects([]);
        setProfile(null);
        setView('landing');
      }
    });

    return () => unsubscribe();
  }, []);

  const upgradePlan = async (tier: UserTier) => {
    if (!user || !profile) return;
    
    const newMax = tier === 'pro' ? 150 : tier === 'unlimited' ? 3000 : 60;
    const updatedProfile = {
      ...profile,
      subscription: {
        ...profile.subscription,
        tier,
        credits: newMax,
        maxCredits: newMax
      }
    };

    try {
      await updateDoc(doc(db, 'users', user.uid), {
        subscription: updatedProfile.subscription
      });
      setSelectedPlan(null);
      alert(`Success! Multi-pass activated. You are now on the ${tier.toUpperCase()} plan.`);
      setView('dashboard');
    } catch (error) {
      console.error(error);
    }
  };

  // Update Firestore when active project changes
  useEffect(() => {
    if (activeProject && user) {
      const updateProjectInDB = async () => {
        try {
          await setDoc(doc(db, 'projects', activeProject.id), activeProject, { merge: true });
        } catch (error) {
          console.error("Error updating project in Firestore:", error);
        }
      };
      // Debounce slightly or ideally only update on specific actions
      const timeout = setTimeout(updateProjectInDB, 1000);
      return () => clearTimeout(timeout);
    }
  }, [activeProject, user]);

  const login = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      setView('dashboard');
    } catch (err) {
      console.error(err);
    }
  };

  const logout = async () => {
    await signOut(auth);
    setUser(null);
    setView('landing');
  };

  useEffect(() => {
    socket.on('progress', (data: ProcessingProgress & { outputPath?: string }) => {
      setProcessingStatus(prev => ({ ...prev, [data.clipId || 'global']: data }));
      
      if (data.outputPath && activeProject) {
        setActiveProject(prev => {
          if (!prev) return null;
          return {
            ...prev,
            clips: prev.clips.map(c => 
              c.id === data.clipId 
                ? { ...c, status: 'completed', outputPath: data.outputPath } 
                : c
            )
          };
        });
      }

      if (data.message?.includes('failed') && activeProject) {
        setActiveProject(prev => {
          if (!prev) return null;
          return {
            ...prev,
            clips: prev.clips.map(c => 
              c.id === data.clipId 
                ? { ...c, status: 'failed' } 
                : c
            )
          };
        });
      }
    });

    return () => { socket.off('progress'); };
  }, [activeProject]);

  const handleUpload = async (file: File) => {
    if (!user) {
        login();
        return;
    }
    setIsProcessing(true);
    const formData = new FormData();
    formData.append('video', file);

    try {
      const resp = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await resp.json();
      const newProject = { 
        ...data, 
        userId: user.uid,
        activeTemplate: 'none' as TemplateType
      };
      
      // Save to Firestore first
      await setDoc(doc(db, 'projects', newProject.id), newProject);
      
      setActiveProject(newProject);
      setView('editor');
    } catch (err) {
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  if (authLoading) return (
    <div className="h-screen bg-bg-dark flex items-center justify-center">
      <div className="w-10 h-10 border-4 border-accent-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="flex h-screen bg-bg-dark overflow-hidden text-slate-200">
      <Sidebar 
        setView={setView} 
        activeView={view} 
        user={user} 
        profile={profile}
        onLogout={logout} 
        onLogin={login} 
      />
      
      <main className="flex-1 relative overflow-y-auto">
        <AnimatePresence mode="wait">
          {view === 'landing' && (
            <LandingPage 
              onUpload={handleUpload} 
              isProcessing={isProcessing} 
              user={user}
              profile={profile}
              setView={setView}
              key="landing" 
            />
          )}
          {view === 'dashboard' && (
            <Dashboard 
              projects={projects} 
              profile={profile}
              setView={setView}
              onSelectProject={(p) => { setActiveProject(p); setView('editor'); }} 
              key="dashboard"
            />
          )}
          {view === 'pricing' && (
            <Pricing currentTier={profile?.subscription?.tier || 'free'} onSelectPlan={setSelectedPlan} key="pricing" />
          )}
          {view === 'editor' && activeProject && (
            <Editor 
              project={activeProject} 
              setProject={setActiveProject}
              processingStatus={processingStatus}
              setView={setView}
              key="editor" 
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {selectedPlan && (
            <CheckoutModal 
              plan={selectedPlan} 
              onClose={() => setSelectedPlan(null)} 
              onConfirm={() => upgradePlan(selectedPlan.tier)} 
            />
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function Sidebar({ setView, activeView, user, profile, onLogout, onLogin }: any) {
  const scrollRef = useRef<HTMLDivElement>(null);
  
  return (
    <div className="w-20 lg:w-64 border-r border-white/5 bg-bg-dark-soft flex flex-col p-4 z-40">
      <div className="flex items-center gap-3 mb-10 px-2 cursor-pointer" onClick={() => setView('landing')}>
        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-accent-primary to-accent-secondary flex items-center justify-center shadow-lg shadow-accent-primary/20">
          <Scissors className="text-white w-6 h-6" />
        </div>
        <span className="text-xl font-bold hidden lg:block tracking-tight text-white uppercase italic">Clipex<span className="text-accent-primary">AI</span></span>
      </div>

      <nav className="flex-1 space-y-2">
        <SidebarItem icon={Layout} label="Home" active={activeView === 'landing'} onClick={() => setView('landing')} />
        <SidebarItem icon={History} label="My Projects" active={activeView === 'dashboard'} onClick={() => {
            if (user) setView('dashboard');
            else onLogin();
        }} />
        <SidebarItem icon={Zap} label="Pricing" active={activeView === 'pricing'} onClick={() => setView('pricing')} />
        <SidebarItem icon={Star} label="Viral Samples" active={false} disabled />
      </nav>

      <div className="mt-auto pt-6 border-t border-white/5 flex flex-col gap-4">
        {user && profile && (
          <div className="mb-4 px-2 space-y-3">
             <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                <span>Monthly Usage</span>
                <span className="text-white">{Math.round(profile.subscription.credits)} / {profile.subscription.maxCredits}m</span>
             </div>
             <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-accent-primary rounded-full shadow-[0_0_8px_rgba(139,92,246,0.5)] transition-all duration-1000"
                  style={{ width: `${(profile.subscription.credits / profile.subscription.maxCredits) * 100}%` }}
                />
             </div>
             {profile.subscription.tier === 'free' && (
               <button 
                onClick={() => setView('pricing')}
                className="w-full py-2 bg-accent-primary/10 border border-accent-primary/30 text-accent-primary text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-accent-primary/20 transition-all"
               >
                 Upgrade Plan
               </button>
             )}
          </div>
        )}

        {user ? (
          <div className="flex items-center gap-3 px-2 py-2 rounded-2xl bg-white/5 border border-white/10">
            {user.photoURL ? (
              <img src={user.photoURL} alt="" className="w-8 h-8 rounded-full border border-white/10" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
                <User className="w-5 h-5 text-slate-400" />
              </div>
            )}
            <div className="hidden lg:block truncate flex-1">
              <p className="text-[11px] font-bold text-white truncate uppercase tracking-tight">{user.displayName}</p>
              <button onClick={onLogout} className="text-[9px] text-accent-primary font-black hover:underline uppercase">Logout Account</button>
            </div>
            {profile?.subscription?.tier !== 'free' && (
              <Shield className="w-4 h-4 text-accent-primary hidden lg:block" />
            )}
          </div>
        ) : (
          <button 
            onClick={onLogin}
            className="w-full py-4 rounded-2xl bg-accent-primary text-white text-sm font-black uppercase tracking-widest hover:bg-accent-primary/90 transition-all shadow-xl shadow-accent-primary/20"
          >
            Login
          </button>
        )}
      </div>
    </div>
  );
}

function SidebarItem({ icon: Icon, label, active, onClick, disabled }: any) {
  return (
    <button 
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-4 px-3 py-3 rounded-2xl transition-all duration-300 group relative ${
        active 
          ? 'bg-accent-primary/10 text-accent-primary shadow-lg shadow-accent-primary/5' 
          : 'text-slate-500 hover:bg-white/5 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed'
      }`}
    >
      <div className={`p-2 rounded-xl transition-all ${active ? 'bg-accent-primary/10' : 'group-hover:bg-white/5'}`}>
        <Icon className={`w-5 h-5 transition-transform ${active ? 'scale-110' : 'group-hover:scale-110'}`} />
      </div>
      <span className="font-bold text-sm hidden lg:block uppercase tracking-tight">{label}</span>
      {active && <div className="absolute right-2 w-1.5 h-1.5 rounded-full bg-accent-primary shadow-[0_0_8px_rgba(139,92,246,0.8)]" />}
    </button>
  );
}

function Pricing({ currentTier, onSelectPlan }: { currentTier: UserTier, onSelectPlan: (plan: any) => void }) {
  const [isAnnual, setIsAnnual] = useState(true);

  return (
    <div className="min-h-full py-20 px-6 max-w-6xl mx-auto flex flex-col items-center">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-16"
      >
        <h2 className="text-5xl lg:text-7xl font-black text-white mb-6 uppercase italic tracking-tighter">
          Unleash the <span className="text-gradient-purple">Viral Multi-pass.</span>
        </h2>
        <p className="text-xl text-slate-400 max-w-2xl mx-auto font-medium">
          Choose the plan that fits your content strategy. Scale from a hobbyist to a content factory.
        </p>

        <div className="mt-10 flex items-center justify-center gap-4">
          <span className={`text-sm font-bold uppercase tracking-widest ${!isAnnual ? 'text-white' : 'text-slate-500'}`}>Monthly</span>
          <button 
            onClick={() => setIsAnnual(!isAnnual)}
            className="w-14 h-7 rounded-full bg-white/10 p-1 relative flex items-center"
          >
            <motion.div 
              animate={{ x: isAnnual ? 28 : 0 }}
              className="w-5 h-5 rounded-full bg-accent-primary shadow-[0_0_8px_rgba(139,92,246,0.8)]"
            />
          </button>
          <span className={`text-sm font-bold uppercase tracking-widest ${isAnnual ? 'text-white' : 'text-slate-500'}`}>Yearly <span className="ml-2 px-2 py-0.5 rounded bg-green-500/20 text-green-500 text-[10px]">-50% OFF</span></span>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full">
        <PricingCard 
          tier="free"
          title="Free"
          price={0}
          credits="60 min/mo"
          features={[
            "AI Clip Analysis",
            "Auto-Reframe (9:16)",
            "Captions (Watermarked)",
            "Standard Support"
          ]}
          active={currentTier === 'free'}
          onSelect={() => onSelectPlan({ tier: 'free', price: 0, isAnnual })}
        />
        <PricingCard 
          tier="pro"
          title="Starter"
          price={isAnnual ? 7.50 : 14.50}
          credits="150 min/mo"
          features={[
            "Everything in Free",
            "No Watermarks",
            "Premium Subtitle Styles",
            "Export in 4K",
            "Priority Processing"
          ]}
          highlight
          active={currentTier === 'pro'}
          onSelect={() => onSelectPlan({ tier: 'pro', price: isAnnual ? 7.50 : 14.50, isAnnual })}
        />
        <PricingCard 
          tier="unlimited"
          title="Pro"
          price={isAnnual ? 24.50 : 49.50}
          credits="3000 min/mo"
          features={[
            "Everything in Starter",
            "Account Manager",
            "Team Collaboration",
            "Custom Branded Templates",
            "API Access"
          ]}
          active={currentTier === 'unlimited'}
          onSelect={() => onSelectPlan({ tier: 'unlimited', price: isAnnual ? 24.50 : 49.50, isAnnual })}
        />
      </div>

      <div className="mt-20 glass-panel p-10 rounded-[40px] w-full flex flex-col md:flex-row items-center justify-between gap-10">
        <div>
          <h3 className="text-3xl font-black text-white mb-4 uppercase italic">Trusted by the next-gen creators.</h3>
          <p className="text-slate-400 font-medium">Join 50,000+ users saving hundreds of hours on manual editing.</p>
        </div>
        <div className="flex gap-10 opacity-30">
           <div className="text-2xl font-black italic tracking-tighter">TIKTOK</div>
           <div className="text-2xl font-black italic tracking-tighter">REELS</div>
           <div className="text-2xl font-black italic tracking-tighter">SHORTS</div>
        </div>
      </div>
    </div>
  );
}

function PricingCard({ tier, title, price, credits, features, highlight, active, onSelect }: any) {
  return (
    <motion.div 
      whileHover={{ y: -10 }}
      className={`relative p-8 rounded-[40px] border flex flex-col ${
        highlight 
          ? 'bg-accent-primary/10 border-accent-primary shadow-[0_20px_50px_rgba(139,92,246,0.15)] bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,0.1),transparent)]' 
          : 'bg-white/5 border-white/5'
      }`}
    >
      {highlight && (
        <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-accent-primary text-[10px] font-black uppercase tracking-widest text-white shadow-xl">
          MOST POPULAR
        </div>
      )}

      <div className="mb-8">
        <h4 className="text-xl font-bold text-white mb-2 uppercase tracking-tight">{title}</h4>
        <div className="flex items-baseline gap-1">
          <span className="text-5xl font-black text-white italic">${price}</span>
          <span className="text-slate-500 font-bold uppercase text-[10px]">/ month</span>
        </div>
        <div className="mt-4 inline-block px-3 py-1 rounded-lg bg-white/5 text-accent-primary text-[11px] font-black uppercase tracking-widest">
           {credits}
        </div>
      </div>

      <div className="flex-1 space-y-4 mb-10">
        {features.map((f: string, i: number) => (
          <div key={i} className="flex items-center gap-3">
            <div className={`w-5 h-5 rounded-full flex items-center justify-center ${highlight ? 'bg-accent-primary/20 text-accent-primary' : 'bg-white/5 text-slate-500'}`}>
              <Check className="w-3 h-3" />
            </div>
            <span className="text-sm font-medium text-slate-300">{f}</span>
          </div>
        ))}
      </div>

      <button 
        onClick={onSelect}
        disabled={active}
        className={`w-full py-4 rounded-2xl font-black uppercase tracking-widest transition-all ${
          active 
            ? 'bg-white/5 text-slate-500 cursor-default' 
            : highlight 
              ? 'bg-accent-primary text-white hover:scale-[1.02] shadow-xl shadow-accent-primary/20' 
              : 'bg-white/10 text-white hover:bg-white/20'
        }`}
      >
        {active ? 'Current Plan' : 'Get Started'}
      </button>
    </motion.div>
  );
}

function CheckoutModal({ plan, onClose, onConfirm }: { plan: any, onClose: () => void, onConfirm: () => void }) {
  const [method, setMethod] = useState<'card' | 'pix'>('card');
  const [isProcessing, setIsProcessing] = useState(false);
  const [cardName, setCardName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [pixCopied, setPixCopied] = useState(false);

  const handlePay = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsProcessing(true);
    // Simulate real payment delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    onConfirm();
  };

  const copyPix = () => {
    navigator.clipboard.writeText('00020126360014BR.GOV.BCB.PIX0114clipexpay@bank5204000053039865802BR5915Clipex AI App6009SAO PAULO62070503***6304E2D1');
    setPixCopied(true);
    setTimeout(() => setPixCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="relative w-full max-w-2xl bg-bg-dark-card border border-white/10 rounded-[40px] overflow-hidden shadow-2xl"
      >
        <div className="flex flex-col md:flex-row h-full min-h-[500px]">
          {/* Order Summary */}
          <div className="w-full md:w-2/5 p-8 bg-white/5 border-r border-white/5 flex flex-col">
            <h3 className="text-lg font-bold text-white mb-6 uppercase tracking-tight italic">Order Summary</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400 capitalize">{plan.tier} Plan</span>
                <span className="text-white font-bold">${plan.price}</span>
              </div>
              <div className="flex justify-between items-center text-sm font-bold text-accent-primary">
                <span>Billing Cycle</span>
                <span>{plan.isAnnual ? 'Yearly' : 'Monthly'}</span>
              </div>
              <div className="pt-4 border-t border-white/10">
                <div className="flex justify-between items-center">
                  <span className="text-white font-bold uppercase tracking-tight">Total Due</span>
                  <span className="text-2xl font-black text-white italic">${plan.price}</span>
                </div>
              </div>
            </div>
            
            <div className="mt-auto p-4 rounded-2xl bg-accent-primary/10 border border-accent-primary/20">
              <div className="flex items-center gap-3 mb-2">
                <Shield className="w-4 h-4 text-accent-primary" />
                <span className="text-[10px] font-black text-white uppercase tracking-widest">Safe & Secure</span>
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed font-medium">Your data is protected by industry-standard encryption. We never store your payment details.</p>
            </div>
          </div>

          {/* Payment Method Selection & Form */}
          <div className="w-full md:w-3/5 p-8 relative flex flex-col">
            <button onClick={onClose} className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors">
              <Plus className="w-6 h-6 rotate-45" />
            </button>
            
            <div className="flex gap-2 p-1 bg-white/5 rounded-2xl mb-8 w-fit mx-auto md:mx-0">
               <button 
                onClick={() => setMethod('card')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${method === 'card' ? 'bg-white/10 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
               >
                 <CreditCard className="w-4 h-4" />
                 Card
               </button>
               <button 
                onClick={() => setMethod('pix')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${method === 'pix' ? 'bg-[#32BCAD] text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
               >
                 <QrCode className="w-4 h-4" />
                 PIX
               </button>
            </div>

            <AnimatePresence mode="wait">
              {method === 'card' ? (
                <motion.form 
                  key="card"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  onSubmit={handlePay} 
                  className="space-y-4"
                >
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Cardholder Name</label>
                    <input 
                      required
                      type="text" 
                      value={cardName}
                      onChange={(e) => setCardName(e.target.value)}
                      placeholder="John Doe"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-primary transition-colors"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Card Number</label>
                    <div className="relative">
                      <input 
                        required
                        type="text" 
                        value={cardNumber}
                        onChange={(e) => setCardNumber(e.target.value.replace(/\D/g, '').slice(0, 16))}
                        placeholder="0000 0000 0000 0000"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-primary transition-colors"
                      />
                      <CreditCard className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Expiry</label>
                      <input 
                        required
                        type="text" 
                        value={expiry}
                        onChange={(e) => setExpiry(e.target.value.replace(/\D/g, '').slice(0, 4))}
                        placeholder="MM/YY"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-primary transition-colors"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">CVC</label>
                      <input 
                        required
                        type="password" 
                        value={cvc}
                        onChange={(e) => setCvc(e.target.value.replace(/\D/g, '').slice(0, 3))}
                        placeholder="***"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-primary transition-colors"
                      />
                    </div>
                  </div>

                  <button 
                    type="submit"
                    disabled={isProcessing}
                    className="w-full py-4 rounded-2xl bg-accent-primary text-white font-black uppercase tracking-widest hover:bg-accent-primary/90 transition-all shadow-xl shadow-accent-primary/20 flex items-center justify-center gap-3 mt-6 disabled:opacity-50"
                  >
                    {isProcessing ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>Processing...</span>
                      </>
                    ) : (
                      <>
                        <Zap className="w-4 h-4" />
                        <span>Complete Purchase</span>
                      </>
                    )}
                  </button>
                </motion.form>
              ) : (
                <motion.div 
                  key="pix"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="flex flex-col items-center text-center space-y-6"
                >
                  <div className="relative group">
                    <div className="absolute inset-0 bg-accent-primary/20 blur-2xl group-hover:bg-accent-primary/40 transition-all" />
                    <div className="relative p-6 bg-white rounded-[32px] border border-white/10">
                       {/* Placeholder for QR Code */}
                       <div className="w-40 h-40 bg-zinc-900 rounded-2xl flex items-center justify-center overflow-hidden">
                          <QrCode className="w-32 h-32 text-white opacity-10" />
                          <div className="absolute inset-0 flex items-center justify-center p-2">
                             <div className="grid grid-cols-8 grid-rows-8 gap-1 w-full h-full opacity-80">
                                {[...Array(64)].map((_, i) => (
                                  <div key={i} className={`rounded-sm ${Math.random() > 0.6 ? 'bg-zinc-800' : 'bg-transparent'}`} />
                                ))}
                                {/* Fake corners */}
                                <div className="absolute top-0 left-0 w-8 h-8 border-4 border-zinc-800" />
                                <div className="absolute top-0 right-0 w-8 h-8 border-4 border-zinc-800" />
                                <div className="absolute bottom-0 left-0 w-8 h-8 border-4 border-zinc-800" />
                             </div>
                          </div>
                       </div>
                    </div>
                  </div>

                  <div>
                     <p className="text-white font-bold text-sm mb-2 uppercase tracking-tight italic">Scan QR Code or Copy Key</p>
                     <p className="text-slate-500 text-xs max-w-[240px] mx-auto leading-relaxed">Scan with your banking app. Your subscription will be active instantly after payment.</p>
                  </div>

                  <div className="w-full space-y-3">
                    <button 
                      onClick={copyPix}
                      className="w-full py-3 rounded-xl bg-white/5 border border-white/10 text-white font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-white/10 transition-all group"
                    >
                      {pixCopied ? <CheckCheck className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-slate-400 group-hover:text-white transition-colors" />}
                      <span>{pixCopied ? 'Key Copied!' : 'Copy PIX Key'}</span>
                    </button>

                    <button 
                       onClick={() => handlePay()}
                       disabled={isProcessing}
                       className="w-full py-4 rounded-2xl bg-[#32BCAD] text-white font-black uppercase tracking-widest hover:bg-[#32BCAD]/90 transition-all shadow-xl shadow-[#32BCAD]/20 flex items-center justify-center gap-3 disabled:opacity-50"
                    >
                      {isProcessing ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          <span>Waiting payment...</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4" />
                          <span>I've Paid</span>
                        </>
                      )}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function LandingPage({ onUpload, isProcessing, user, profile, setView }: { onUpload: (file: File) => void, isProcessing: boolean, user: any, profile: UserProfile | null, setView: any }) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="min-h-full pb-20 flex flex-col items-center px-6 relative overflow-x-hidden pt-20">
      {/* Background blobs */}
      <div className="absolute top-1/4 -left-20 w-[600px] h-[600px] bg-accent-primary/10 blur-[140px] rounded-full pointer-events-none" />
      <div className="absolute bottom-1/4 -right-20 w-[600px] h-[600px] bg-accent-secondary/10 blur-[140px] rounded-full pointer-events-none" />

      <motion.div 
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-4xl text-center mb-16 relative z-10"
      >
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-accent-primary/10 border border-accent-primary/20 mb-8 font-bold text-xs text-accent-primary uppercase tracking-widest"
        >
          <Wand2 className="w-3.5 h-3.5" />
          <span>The Future of Content Creation</span>
        </motion.div>
        
        <h1 className="text-6xl lg:text-8xl font-extrabold text-white mb-8 tracking-tight leading-[0.95] text-gradient">
          One video,<br />
          <span className="text-gradient-purple font-black whitespace-nowrap">ten viral clips.</span>
        </h1>
        
        <p className="text-xl lg:text-2xl text-slate-400 max-w-2xl mx-auto leading-relaxed mb-12">
          Opus-grade AI that identifies the most engaging hooks, automatically reframes them, and adds viral captions in one click.
        </p>
        
        <div className="flex flex-wrap justify-center gap-4">
          <button onClick={() => fileInputRef.current?.click()} className="btn-primary px-8 py-4 text-lg">
            <Upload className="w-5 h-5" /> {user ? 'Create AI Clips' : 'Get Started for Free'}
          </button>
          {!profile || profile.subscription.tier === 'free' ? (
            <button onClick={() => setView('pricing')} className="btn-secondary px-8 py-4 text-lg">
              <Zap className="w-5 h-5 text-accent-primary" /> View Pro Plans
            </button>
          ) : (
            <button onClick={() => setView('dashboard')} className="btn-secondary px-8 py-4 text-lg">
              <History className="w-5 h-5" /> Go to Dashboard
            </button>
          )}
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="w-full max-w-4xl p-1 gap-1 rounded-[32px] glass-panel relative z-10 overflow-hidden shadow-2xl shadow-accent-primary/5"
      >
        <div 
          className="w-full h-full p-12 rounded-[31px] bg-bg-dark-card/40 flex flex-col items-center justify-center border-2 border-dashed border-white/10 hover:border-accent-primary/40 transition-all cursor-pointer group"
          onClick={() => fileInputRef.current?.click()}
        >
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept="video/*" 
            onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
          />
          <div className="w-20 h-20 rounded-2xl bg-white/5 flex items-center justify-center mb-8 group-hover:scale-110 transition-transform group-hover:bg-accent-primary/20 border border-white/5 group-hover:border-accent-primary/20 relative">
            {isProcessing ? (
              <div className="w-10 h-10 border-4 border-accent-primary border-t-transparent rounded-full animate-spin" />
            ) : (
              <Video className="w-10 h-10 text-accent-primary" />
            )}
          </div>
          <h3 className="text-3xl font-bold text-white mb-3">{isProcessing ? 'Analyzing Content...' : 'Upload your video'}</h3>
          <p className="text-slate-400 mb-10 max-w-sm mx-auto font-medium">Drag and drop your footage here or click to browse. Let our AI do the heavy lifting.</p>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full max-w-2xl">
            <FeatureBadge icon={TrendingUp} label="Viral Score Prediction" />
            <FeatureBadge icon={Layout} label="Active AI Reframe" />
            <FeatureBadge icon={Type} label="Dynamic Captions" />
          </div>
        </div>
      </motion.div>

      <div className="mt-32 max-w-6xl w-full grid grid-cols-1 md:grid-cols-3 gap-6 px-4">
        <BentoCard 
          title="AI Curation" 
          desc="Our AI analyzes your long-form video and picks the most viral moments for you."
          icon={Wand2}
          color="from-blue-500/20"
        />
        <BentoCard 
          title="Auto Reframe" 
          desc="AI identifies the speaker and keeps them centered in a 9:16 vertical frame always."
          icon={Layout}
          color="from-purple-500/20"
        />
        <BentoCard 
          title="AI Captions" 
          desc="Get 99% accurate subtitles with automatic keyword highlighting and emojis."
          icon={Type}
          color="from-pink-500/20"
        />
      </div>
    </div>
  );
}

function FeatureBadge({ icon: Icon, label }: any) {
  return (
    <div className="flex items-center gap-2 text-slate-500 font-bold text-[10px] uppercase tracking-widest bg-white/5 px-4 py-2 rounded-full border border-white/5">
      <Icon className="w-4 h-4 text-accent-primary" />
      {label}
    </div>
  );
}

function BentoCard({ title, desc, icon: Icon, color }: any) {
  return (
    <div className={`p-8 rounded-3xl bg-gradient-to-br ${color} to-transparent border border-white/5 hover:border-white/10 transition-all group`}>
      <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center mb-6 border border-white/10 group-hover:scale-110 transition-transform">
        <Icon className="w-6 h-6 text-white" />
      </div>
      <h4 className="text-xl font-bold text-white mb-3">{title}</h4>
      <p className="text-slate-400 text-sm leading-relaxed font-medium">{desc}</p>
    </div>
  );
}

function Dashboard({ projects, profile, setView, onSelectProject }: { projects: VideoProject[], profile: UserProfile | null, setView: any, onSelectProject: (p: VideoProject) => void }) {
  if (projects.length === 0) return (
    <div className="h-full flex flex-col items-center justify-center opacity-50 px-6 text-center">
      <Video className="w-20 h-20 text-slate-800 mb-6" />
      <h3 className="text-2xl font-bold text-white mb-2 tracking-tight">Your library is empty</h3>
      <p className="text-slate-500 font-medium tracking-tight">Upload a video on the home page to start seeing your AI clips here.</p>
    </div>
  );

  return (
    <div className="p-10 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-16 gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-4xl font-extrabold text-white tracking-tight italic">Video <span className="text-accent-primary">Vault</span></h2>
            {profile && (
              <span className="px-2 py-0.5 rounded bg-accent-primary/20 text-accent-primary text-[10px] font-black uppercase tracking-widest border border-accent-primary/20">
                {profile.subscription.tier} Plan
              </span>
            )}
          </div>
          <p className="text-slate-500 font-medium tracking-tight">You have <span className="text-white">{Math.round(profile?.subscription?.credits || 0)} minutes</span> of AI analysis left.</p>
        </div>
        <div className="flex items-center gap-4">
          {profile?.subscription?.tier === 'free' && (
            <button 
              onClick={() => setView('pricing')}
              className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-accent-primary/10 border border-accent-primary/30 text-accent-primary font-black text-xs uppercase tracking-widest hover:bg-accent-primary transition-all hover:text-white"
            >
              <Zap className="w-4 h-4" /> Upgrade to Pro
            </button>
          )}
          <button className="btn-primary" onClick={() => setView('landing')}>
            <Plus className="w-5 h-5" /> New Project
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {projects.map((p) => (
          <motion.div 
            key={p.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -8 }}
            onClick={() => onSelectProject(p)}
            className="group glass-panel rounded-3xl overflow-hidden cursor-pointer transition-all hover:shadow-2xl hover:shadow-accent-primary/10 border-white/5 hover:border-accent-primary/30"
          >
            <div className="aspect-video bg-bg-dark-soft relative flex items-center justify-center overflow-hidden">
               <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent z-10 opacity-0 group-hover:opacity-100 transition-opacity" />
               <div className="absolute top-4 right-4 z-20 px-3 py-1 rounded-full bg-accent-primary/20 text-accent-primary text-[10px] font-black backdrop-blur-md border border-accent-primary/20 uppercase tracking-tighter">
                AI Ready
              </div>
              <Video className="w-12 h-12 text-slate-800 group-hover:text-accent-primary group-hover:scale-110 transition-all duration-300" />
              <div className="absolute bottom-4 left-4 z-20">
                <span className="px-2 py-1 rounded-lg bg-black/60 text-[10px] font-mono font-bold text-white backdrop-blur-md">
                  {formatTime(p.duration)}
                </span>
              </div>
            </div>
            <div className="p-6 relative">
              <h4 className="text-xl font-bold text-white mb-2 truncate group-hover:text-accent-primary transition-colors">{p.name || 'Untitled Content'}</h4>
              <div className="flex items-center gap-3 text-slate-500 text-xs font-bold mb-6">
                <span className="flex items-center gap-1.5"><History className="w-3.5 h-3.5 text-accent-primary" /> {new Date(p.createdAt).toLocaleDateString()}</span>
                <span className="w-1 h-1 rounded-full bg-slate-700" />
                <span className="text-accent-primary uppercase">{p.clips.length} Viral Clips</span>
              </div>
              
              <div className="flex items-center justify-between pt-4 border-t border-white/5">
                <div className="flex -space-x-3">
                  {[0,1,2].map(i => (
                    <div key={i} className="w-8 h-8 rounded-full border-2 border-bg-dark-card bg-slate-800 flex items-center justify-center font-black text-[8px] text-slate-500 italic">
                      V{i+1}
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 text-[10px] font-black text-accent-primary uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
                  Open Project
                  <ChevronRight className="w-4 h-4 translate-x-0 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

const aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function Editor({ project, setProject, processingStatus, setView }: { 
  project: VideoProject, 
  setProject: React.Dispatch<React.SetStateAction<VideoProject | null>>,
  processingStatus: Record<string, ProcessingProgress>,
  setView: React.Dispatch<React.SetStateAction<'landing' | 'dashboard' | 'editor'>>
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isAnalysing, setIsAnalysing] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Undo/Redo Stacks
  const [undoStack, setUndoStack] = useState<VideoProject[]>([]);
  const [redoStack, setRedoStack] = useState<VideoProject[]>([]);

  const pushAction = (state: VideoProject) => {
    setUndoStack(prev => [...prev, state]);
    setRedoStack([]);
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    setRedoStack(prev => [project, ...prev]);
    setProject(previous);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[0];
    setRedoStack(prev => prev.slice(1));
    setUndoStack(prev => [...prev, project]);
    setProject(next);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        handleRedo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undoStack, redoStack, project]);

  const [activeView, setActiveView] = useState<'clips' | 'templates'>('clips');

  const selectedClip = project.clips.find(c => c.id === selectedClipId);

  const applyTemplate = (template: TemplateType) => {
    pushAction(project);
    setProject(prev => prev ? ({ ...prev, activeTemplate: template }) : null);
  };

  const updateClipRange = (clipId: string, start: number, end: number) => {
    setProject(prev => {
      if (!prev) return null;
      return {
        ...prev,
        clips: prev.clips.map(c => c.id === clipId ? { ...c, startTime: start, endTime: end } : c)
      };
    });
  };

  const handleTimelinePointerDown = (e: React.PointerEvent, type: 'start' | 'end') => {
    if (!selectedClip || !timelineRef.current) return;
    pushAction(project); // Capture state before edit
    e.stopPropagation();
    
    const timeline = timelineRef.current;
    const rect = timeline.getBoundingClientRect();

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const x = Math.max(0, Math.min(moveEvent.clientX - rect.left, rect.width));
      const time = (x / rect.width) * project.duration;
      
      let newStart = selectedClip.startTime;
      let newEnd = selectedClip.endTime;

      if (type === 'start') {
        newStart = Math.min(time, selectedClip.endTime - 0.5); // Min 0.5s duration
      } else {
        newEnd = Math.max(time, selectedClip.startTime + 0.5);
      }

      updateClipRange(selectedClip.id, newStart, newEnd);
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const requestAICut = async () => {
    pushAction(project); // Capture state before AI generation
    setIsAnalysing(true);
    try {
      // Simulate AI analysis with Gemini
      const dummyTranscript = "Bem-vindos ao nosso podcast hoje. Vamos falar sobre como ser produtivo e ganhar dinheiro na internet em 2026. A coisa mais importante é foco. Muita gente tenta fazer tudo ao mesmo tempo, mas o segredo está na consistência. Se você postar um vídeo por dia, seu canal vai crescer rápido.";
      
      const response = await aiClient.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Você é um Estrategista de Conteúdo Viral especializado em transformar vídeos longos em clipes magnéticos para TikTok, Reels e Shorts.
        
Analise o transcrito abaixo e extraia os 3 momentos mais impactantes. 

REGRAS PARA OS TÍTULOS:
- Devem ser "High-Hook" (gancho forte) e gerar curiosidade imediata.
- Use palavras-chave fortes extraídas diretamente do texto (ex: "Consistência", "Segredo", "Crescer Rápido").
- Devem ter no máximo 10 palavras.
- Evite títulos genéricos. Use o estilo: "[Benefício] em 2026" ou "O segredo para [Objetivo]".

Para cada clipe, forneça:
1. title: O título ultra-engajador.
2. start: Tempo inicial (segundos). O vídeo total tem ${project.duration}s.
3. end: Tempo final (segundos).
4. score: Viralidade (0-100).
5. reason: Por que este clipe vai viralizar?

Transcrito: "${dummyTranscript}"`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: GenAIType.ARRAY,
            items: {
              type: GenAIType.OBJECT,
              properties: {
                title: { type: GenAIType.STRING },
                start: { type: GenAIType.NUMBER },
                end: { type: GenAIType.NUMBER },
                score: { type: GenAIType.NUMBER },
                reason: { type: GenAIType.STRING },
              }
            }
          }
        }
      });

      const aiCuts = JSON.parse(response.text);
      
      const newClips: VideoClip[] = aiCuts.map((cut: any) => ({
        id: Math.random().toString(36).substr(2, 9),
        startTime: cut.start,
        endTime: cut.end,
        viralScore: cut.score,
        title: cut.title,
        isVertical: true,
        status: 'pending',
      }));

      setProject(prev => prev ? ({ ...prev, clips: [...prev.clips, ...newClips] }) : null);
    } catch (err) {
      console.error(err);
    } finally {
      setIsAnalysing(false);
    }
  };

  const deleteClip = (clipId: string) => {
    pushAction(project);
    setProject(p => p ? ({ ...p, clips: p.clips.filter(c => c.id !== clipId) }) : null);
  };

  const processClip = async (clipId: string) => {
    const clip = project.clips.find(c => c.id === clipId);
    if (!clip) return;

    setProject(prev => {
      if (!prev) return null;
      return {
        ...prev,
        clips: prev.clips.map(c => c.id === clipId ? { ...c, status: 'processing' } : c)
      };
    });

    try {
      await fetch('/api/process-clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoPath: project.originalPath,
          startTime: clip.startTime,
          duration: clip.endTime - clip.startTime,
          clipId: clip.id,
          isVertical: clip.isVertical
        }),
      });
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Editor Top Bar */}
      <div className="h-14 border-b border-white/5 flex items-center justify-between px-6 bg-bg-dark-soft">
        <div className="flex items-center gap-4">
          <button className="text-slate-400 hover:text-white transition-colors" onClick={() => setView('dashboard')}>
            <ChevronRight className="w-5 h-5 rotate-180" />
          </button>
          <h3 className="text-sm font-black text-white italic tracking-tight uppercase">{project.name || 'Untited Video'}</h3>
          
          <div className="h-4 w-px bg-white/10 mx-2" />
          
          <div className="flex items-center gap-1">
            <button 
              onClick={handleUndo} 
              disabled={undoStack.length === 0}
              className="p-1.5 rounded-md hover:bg-white/5 text-slate-400 disabled:opacity-20 transition-opacity"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button 
              onClick={handleRedo} 
              disabled={redoStack.length === 0}
              className="p-1.5 rounded-md hover:bg-white/5 text-slate-400 disabled:opacity-20 transition-opacity"
              title="Redo (Ctrl+Shift+Z)"
            >
              <Redo2 className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={requestAICut}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30 transition-colors font-medium border border-accent-primary/50"
          >
            <Wand2 className="w-4 h-4" /> AI Generate Clips
          </button>
          <button className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-white text-black font-semibold hover:bg-white/90 transition-colors">
            <Download className="w-4 h-4" /> Export
          </button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Left Toolbar */}
        <div className="w-16 border-r border-white/5 flex flex-col items-center py-6 gap-6 bg-bg-dark-soft">
          <ToolIcon icon={Scissors} active={activeView === 'clips'} onClick={() => setActiveView('clips')} label="AI Clips" />
          <ToolIcon icon={Layout} active={activeView === 'templates'} onClick={() => setActiveView('templates')} label="Templates" />
          <ToolIcon icon={Type} label="Subtitles" />
          <ToolIcon icon={TrendingUp} label="Viral Analytics" />
        </div>

        {/* Video Player & Main View */}
        <div className="flex-1 flex flex-col bg-bg-dark overflow-hidden relative">
          <div className="flex-1 flex items-center justify-center p-12 bg-black/20">
            <div className="relative aspect-video w-full max-w-4xl shadow-2xl bg-black rounded-lg overflow-hidden group">
              <video 
                ref={videoRef}
                src={project.originalPath} 
                className="w-full h-full"
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              />
              <div className="absolute inset-x-0 bottom-0 p-6 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="flex items-center gap-4">
                  <button onClick={() => {
                    if (videoRef.current) {
                      if (isPlaying) videoRef.current.pause();
                      else videoRef.current.play();
                      setIsPlaying(!isPlaying);
                    }
                  }} className="text-white hover:scale-110 transition-transform">
                    {isPlaying ? <Pause className="w-8 h-8 fill-white" /> : <Play className="w-8 h-8 fill-white" />}
                  </button>
                  <div className="text-sm font-mono text-white">
                    {formatTime(currentTime)} / {formatTime(project.duration)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Timeline Section */}
          <div className="h-48 border-t border-white/5 bg-bg-dark-soft flex flex-col p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono text-slate-500">TIMELINE</span>
              <div className="flex gap-2">
                <div className="h-1.5 w-24 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-accent-primary" style={{ width: `${(currentTime/project.duration)*100}%` }} />
                </div>
              </div>
            </div>
            
            <div 
              ref={timelineRef}
              className="flex-1 relative bg-white/5 rounded-xl border border-white/5 overflow-hidden cursor-crosshair"
              onPointerDown={(e) => {
                if (!timelineRef.current) return;
                const rect = timelineRef.current.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const time = (x / rect.width) * project.duration;
                if (videoRef.current) {
                  videoRef.current.currentTime = time;
                  setCurrentTime(time);
                }
              }}
            >
               {/* Timeline ticks */}
               {[...Array(20)].map((_, i) => (
                 <div key={i} className="absolute h-full w-[1px] bg-white/5" style={{ left: `${(i+1)*5}%` }} />
               ))}
               
               {/* Playhead */}
               <div 
                 className="timeline-marker" 
                 style={{ left: `${(currentTime/project.duration)*100}%` }} 
               />

               {/* Trim Region Visualizer */}
               {selectedClip && (
                 <div 
                  className="absolute top-1/2 -translate-y-1/2 h-16 bg-accent-primary/20 border-x-2 border-accent-primary rounded-md group"
                  style={{ 
                    left: `${(selectedClip.startTime/project.duration)*100}%`, 
                    width: `${((selectedClip.endTime-selectedClip.startTime)/project.duration)*100}%` 
                  }}
                 >
                   {/* Start Handle */}
                   <div 
                     onPointerDown={(e) => handleTimelinePointerDown(e, 'start')}
                     className="absolute inset-y-0 -left-1 w-4 flex flex-col justify-center gap-1 cursor-ew-resize group-hover:bg-accent-primary/40 transition-colors z-20"
                   >
                     <div className="h-6 w-1 bg-accent-primary mx-auto rounded-full" />
                   </div>
                   
                   {/* End Handle */}
                   <div 
                     onPointerDown={(e) => handleTimelinePointerDown(e, 'end')}
                     className="absolute inset-y-0 -right-1 w-4 flex flex-col justify-center gap-1 cursor-ew-resize group-hover:bg-accent-primary/40 transition-colors z-20"
                   >
                     <div className="h-6 w-1 bg-accent-primary mx-auto rounded-full" />
                   </div>

                   {/* Label */}
                   <div className="absolute -top-6 left-0 right-0 text-[10px] font-mono text-accent-primary font-bold text-center truncate">
                     {selectedClip.title}
                   </div>
                 </div>
               )}
            </div>
          </div>
        </div>

        {/* Right - Side Panel */}
        <div className="w-80 border-l border-white/5 bg-bg-dark-soft flex flex-col overflow-hidden">
          <AnimatePresence mode="wait">
            {activeView === 'clips' ? (
              <motion.div 
                key="clips-panel"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="flex-1 flex flex-col overflow-hidden"
              >
                <div className="p-4 border-b border-white/5 flex items-center justify-between">
                  <h4 className="font-bold text-sm text-slate-200">AI CLIP GENERATOR</h4>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-accent-primary/20 text-accent-primary uppercase tracking-wider">Beta</span>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {isAnalysing && (
                    <div className="p-6 text-center space-y-3">
                      <div className="flex justify-center gap-1">
                        {GOOGLE_COLORS.map((c, i) => (
                          <motion.div 
                            key={i}
                            animate={{ height: [4, 16, 4] }}
                            transition={{ duration: 1, repeat: Infinity, delay: i*0.2 }}
                            className="w-1 rounded-full" 
                            style={{ backgroundColor: c }}
                          />
                        ))}
                      </div>
                      <p className="text-xs font-medium text-slate-400">Gemini analyzing viral hooks...</p>
                    </div>
                  )}

                  {!isAnalysing && project.clips.length === 0 && (
                    <div className="text-center py-12 px-4">
                      <Wand2 className="w-8 h-8 text-slate-600 mx-auto mb-3" />
                      <p className="text-sm text-slate-500 italic">No clips generated yet. Hit "Generate Clips" to start AI analysis.</p>
                    </div>
                  )}

                  {project.clips.map((clip, index) => (
                    <div 
                      key={clip.id} 
                      onClick={() => setSelectedClipId(clip.id)}
                      className={`group p-5 rounded-3xl relative overflow-hidden transition-all cursor-pointer border ${
                        selectedClipId === clip.id 
                          ? 'border-accent-primary bg-accent-primary/10 shadow-lg shadow-accent-primary/10' 
                          : 'border-white/5 bg-white/5 hover:bg-white/10'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex-1 mr-4">
                          <div className="flex items-center gap-2 mb-1.5 font-bold text-[10px] text-slate-500 uppercase tracking-widest">
                            <span className="w-4 h-4 rounded-full bg-accent-primary/20 flex items-center justify-center text-accent-primary">#{index + 1}</span>
                            Social Clip
                          </div>
                          <h5 className="text-sm font-bold text-white mb-2 leading-tight group-hover:text-accent-primary transition-colors">{clip.title}</h5>
                        </div>
                        <ViralScore score={clip.viralScore} size="sm" />
                      </div>

                      <div className="flex items-center gap-2 mb-4 text-[10px] font-mono text-slate-500 font-bold bg-black/40 p-2 rounded-xl border border-white/5">
                        <Play className="w-3 h-3" /> {formatTime(clip.startTime)}
                        <ChevronRight className="w-3 h-3 opacity-30" />
                        <Clock className="w-3 h-3" /> {formatTime(clip.endTime)}
                        <div className="ml-auto text-accent-primary">{formatTime(clip.endTime - clip.startTime)}</div>
                      </div>

                      <div className="flex items-center gap-2">
                        {clip.status === 'completed' ? (
                          <a 
                            href={clip.outputPath} 
                            download 
                            onClick={e => e.stopPropagation()}
                            className="flex-1 flex items-center justify-center py-2 rounded-lg bg-accent-primary text-white text-[10px] font-black uppercase tracking-widest hover:bg-accent-primary/90 transition-colors"
                          >
                            <Download className="w-3 h-3 mr-2" /> Download
                          </a>
                        ) : (
                          <button 
                            onClick={(e) => { e.stopPropagation(); processClip(clip.id); }}
                            disabled={clip.status === 'processing'}
                            className={`flex-1 flex items-center justify-center py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                              clip.status === 'processing' 
                                ? 'bg-white/5 text-slate-600' 
                                : 'bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30 border border-accent-primary/30'
                            }`}
                          >
                            {clip.status === 'processing' ? 'Processing...' : `Format ${clip.isVertical ? 'Vertical' : 'Original'}`}
                          </button>
                        )}
                        <button 
                          onClick={(e) => { e.stopPropagation(); deleteClip(clip.id); }}
                          className="p-2 rounded-lg bg-white/5 text-slate-500 hover:bg-red-500/10 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      {clip.status === 'processing' && (
                        <div className="mt-4 pt-4 border-t border-white/5">
                          <div className="flex items-center justify-between mb-2">
                             <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Optimizing...</span>
                             <span className="text-[10px] font-mono text-accent-primary font-bold">
                               {Math.round(processingStatus[clip.id]?.percent || 0)}%
                             </span>
                          </div>
                          <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: `${processingStatus[clip.id]?.percent || 0}%` }}
                              className="h-full bg-accent-primary shadow-[0_0_12px_rgba(139,92,246,0.6)]" 
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </motion.div>
            ) : (
              <motion.div 
                key="templates-panel"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="flex-1 flex flex-col overflow-hidden"
              >
                <div className="p-4 border-b border-white/5">
                  <h4 className="font-bold text-sm text-slate-200">FORMAT TEMPLATES</h4>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  <TemplateCard 
                    id="tiktok" 
                    title="TikTok Viral" 
                    description="9:16 portrait, bold captions, dynamic zoom beats."
                    icon="📱"
                    active={project.activeTemplate === 'tiktok'}
                    onClick={() => applyTemplate('tiktok')}
                  />
                  <TemplateCard 
                    id="reels" 
                    title="Instagram Reels" 
                    description="9:16 portrait, minimal aesthetics, elegant typography."
                    icon="📸"
                    active={project.activeTemplate === 'reels'}
                    onClick={() => applyTemplate('reels')}
                  />
                  <TemplateCard 
                    id="shorts" 
                    title="YouTube Shorts" 
                    description="9:16 portrait, clear audio focus, high engagement styles."
                    icon="🎥"
                    active={project.activeTemplate === 'shorts'}
                    onClick={() => applyTemplate('shorts')}
                  />
                  <TemplateCard 
                    id="none" 
                    title="Original" 
                    description="No automatic reframing or styles applied."
                    icon="🎞️"
                    active={project.activeTemplate === 'none'}
                    onClick={() => applyTemplate('none')}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function ToolIcon({ icon: Icon, active, onClick, label }: { icon: any, active?: boolean, onClick?: () => void, label?: string }) {
  return (
    <div className="relative group/tool">
      <button 
        onClick={onClick}
        className={`p-2.5 rounded-xl transition-all duration-200 group ${
          active ? 'bg-accent-primary text-white shadow-lg shadow-accent-primary/20' : 'text-slate-500 hover:text-white hover:bg-white/5'
        }`}
      >
        <Icon className={`w-6 h-6 transition-transform ${active ? 'scale-100' : 'group-hover:scale-110'}`} />
      </button>
      {label && (
        <div className="absolute left-full ml-4 px-2 py-1 bg-bg-dark-card border border-white/10 rounded text-[10px] font-bold text-white opacity-0 group-hover/tool:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
          {label}
        </div>
      )}
    </div>
  );
}

function TemplateCard({ id, title, description, icon, active, onClick }: any) {
  return (
    <button 
      onClick={onClick}
      className={`w-full p-4 rounded-3xl text-left transition-all border ${
        active 
          ? 'bg-accent-primary/10 border-accent-primary shadow-xl shadow-accent-primary/10' 
          : 'bg-white/5 border-white/10 hover:bg-white/10'
      } group`}
    >
      <div className="flex items-start gap-4">
        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-2xl border transition-transform group-hover:scale-110 ${
          active ? 'bg-accent-primary border-white/20' : 'bg-white/5 border-white/5'
        }`}>
          {icon}
        </div>
        <div className="flex-1">
          <h5 className={`font-bold text-sm mb-1 ${active ? 'text-white' : 'text-slate-200'}`}>{title}</h5>
          <p className="text-[10px] text-slate-500 font-medium leading-relaxed">{description}</p>
        </div>
        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
          active ? 'border-accent-primary bg-accent-primary' : 'border-slate-700'
        }`}>
          {active && <CheckCircle2 className="w-3 h-3 text-white" />}
        </div>
      </div>
    </button>
  );
}

function ViralScore({ score, size = 'md' }: { score: number, size?: 'sm' | 'md' }) {
  const color = score >= 90 ? 'text-green-500' : score >= 80 ? 'text-accent-primary' : 'text-yellow-500';
  const bgColor = score >= 90 ? 'stroke-green-500' : score >= 80 ? 'stroke-accent-primary' : 'stroke-yellow-500';
  
  const radius = size === 'sm' ? 18 : 28;
  const stroke = size === 'sm' ? 3 : 4;
  const normalizedRadius = radius - stroke * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <div className="relative flex items-center justify-center">
         <svg height={radius * 2} width={radius * 2} className="-rotate-90">
            <circle
              stroke="currentColor" fill="transparent" strokeWidth={stroke}
              strokeDasharray={circumference + ' ' + circumference}
              style={{ strokeDashoffset }}
              r={normalizedRadius} cx={radius} cy={radius}
              className={`${bgColor} transition-all duration-1000 ease-out`}
            />
            <circle
              stroke="currentColor" fill="transparent" strokeWidth={stroke}
              r={normalizedRadius} cx={radius} cy={radius}
              className="text-white/5"
            />
         </svg>
         <div className={`absolute inset-0 flex items-center justify-center font-black ${size === 'sm' ? 'text-[9px]' : 'text-xs'} text-white italic`}>
            {score}
         </div>
      </div>
      <span className={`uppercase font-black tracking-tighter ${color} ${size === 'sm' ? 'text-[7px]' : 'text-[9px]'} mt-1`}>
        {score >= 90 ? 'Viral' : score >= 80 ? 'High' : 'Good'}
      </span>
    </div>
  );
}

function ClipPreview({ clip, originalPath }: { clip: VideoClip, originalPath: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);

  const onPlay = () => setIsPlaying(true);
  const onPause = () => !isScrubbing && setIsPlaying(false);

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!videoRef.current) return;
    
    const video = videoRef.current;
    if (isPlaying) {
      video.pause();
    } else {
      const isProcessed = clip.status === 'completed';
      const start = isProcessed ? 0 : clip.startTime;
      const end = isProcessed ? video.duration : clip.endTime;

      // Loop if at the end
      if (video.currentTime >= end - 0.1 || video.currentTime < start) {
        video.currentTime = start;
      }
      video.play().catch(() => {});
    }
  };

  const updateProgress = (time: number) => {
    if (!videoRef.current) return;
    const isProcessed = clip.status === 'completed';
    const start = isProcessed ? 0 : clip.startTime;
    const end = isProcessed ? videoRef.current.duration : clip.endTime;
    const duration = end - start;
    
    if (duration > 0) {
      const p = ((time - start) / duration) * 100;
      setProgress(Math.max(0, Math.min(100, p)));
    }
    setCurrentTime(time);
  };

  const handleTimeUpdate = () => {
    if (!videoRef.current || isScrubbing) return;
    const video = videoRef.current;
    const isProcessed = clip.status === 'completed';
    const start = isProcessed ? 0 : clip.startTime;
    const end = isProcessed ? video.duration : clip.endTime;

    updateProgress(video.currentTime);

    // Seamless Looping for virtual clips
    if (!isProcessed && video.currentTime >= end) {
      video.currentTime = start;
      video.play().catch(() => {});
    }
  };

  const handleEnded = () => {
    if (!videoRef.current) return;
    const isProcessed = clip.status === 'completed';
    const start = isProcessed ? 0 : clip.startTime;
    videoRef.current.currentTime = start;
    videoRef.current.play().catch(() => setIsPlaying(false));
  };

  const startScrubbing = () => setIsScrubbing(true);
  const stopScrubbing = () => setIsScrubbing(false);

  const onSeek = (e: React.ChangeEvent<HTMLInputElement> | React.FormEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (!videoRef.current) return;
    
    // @ts-ignore - target value exists on both ChangeEvent and FormEvent targets in this context
    const val = parseFloat(e.target.value || e.currentTarget.value);
    const isProcessed = clip.status === 'completed';
    const start = isProcessed ? 0 : clip.startTime;
    const end = isProcessed ? videoRef.current.duration : clip.endTime;
    const duration = end - start;
    
    const seekTime = start + (val / 100) * duration;
    videoRef.current.currentTime = seekTime;
    updateProgress(seekTime); // Immediate visual feedback
    setProgress(val);
  };

  useEffect(() => {
    if (videoRef.current && clip.status !== 'completed') {
      videoRef.current.currentTime = clip.startTime;
      setCurrentTime(clip.startTime);
    }
  }, [clip.startTime, clip.status]);

  const isProcessed = clip.status === 'completed';
  const start = isProcessed ? 0 : clip.startTime;
  const end = isProcessed ? (videoRef.current?.duration || clip.endTime) : clip.endTime;
  const displayTime = Math.max(0, currentTime - start);
  const totalDisplayTime = Math.max(0, end - start);

  return (
    <div className="w-full h-full bg-black flex flex-col relative overflow-hidden group/preview">
      {/* Clip Content Rendering */}
      <div className="flex-1 relative bg-black flex items-center justify-center cursor-pointer" onClick={togglePlay}>
        <video 
          ref={videoRef}
          src={clip.status === 'completed' && clip.outputPath ? clip.outputPath : originalPath}
          className={`max-w-full max-h-full h-full object-contain ${clip.isVertical ? 'aspect-[9/16]' : 'aspect-video'}`}
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleEnded}
          onPlay={onPlay}
          onPause={onPause}
          playsInline
        />

        {/* Mock Subtitle Preview (Opus style) */}
        {!isScrubbing && isPlaying && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute bottom-[20%] left-0 right-0 px-8 pointer-events-none z-10"
          >
            <div className="max-w-[80%] mx-auto text-center">
              <span className="inline-block bg-black/60 backdrop-blur-md px-4 py-2 rounded-lg text-white font-black text-xl lg:text-3xl uppercase tracking-tight shadow-2xl leading-none">
                {clip.title.split(' ')[0]} <span className="text-accent-primary">IS THE</span> MOMENT
              </span>
            </div>
          </motion.div>
        )}

        {/* Play Overlay */}
        <AnimatePresence>
          {!isPlaying && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.2 }}
              className="absolute inset-0 flex items-center justify-center bg-black/20"
            >
              <div className="w-20 h-20 rounded-full bg-accent-primary/80 backdrop-blur-md flex items-center justify-center shadow-2xl shadow-accent-primary/20">
                <Play className="w-10 h-10 text-white fill-white ml-1" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Vertical Mask Info */}
        {!clip.isVertical && clip.status !== 'completed' && (
          <div className="absolute inset-y-0 left-0 right-0 flex justify-center pointer-events-none">
            <div className="h-full aspect-[9/16] border-2 border-dashed border-accent-primary/50 bg-accent-primary/5 relative">
              <div className="absolute top-2 left-2 px-2 py-1 bg-accent-primary text-[8px] font-black uppercase text-white rounded">
                AI REFRAME TRACKING
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modern Player Controls */}
      <div className="h-16 px-6 bg-bg-dark-card border-t border-white/5 flex items-center gap-6 relative z-20">
        <button 
          onClick={togglePlay}
          className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-white hover:bg-white/10 transition-all hover:scale-110"
        >
          {isPlaying ? <Pause className="w-5 h-5 fill-white" /> : <Play className="w-5 h-5 fill-white ml-0.5" />}
        </button>

        <div className="flex-1 flex flex-col gap-1">
          <input 
            type="range"
            min="0"
            max="100"
            step="0.1"
            value={progress}
            onChange={onSeek}
            onMouseDown={startScrubbing}
            onMouseUp={stopScrubbing}
            onTouchStart={startScrubbing}
            onTouchEnd={stopScrubbing}
            className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-accent-primary overflow-hidden"
          />
          <div className="flex items-center justify-between text-[10px] font-mono font-bold text-slate-500">
             <span>{formatTime(currentTime - (clip.status === 'completed' ? 0 : clip.startTime))}</span>
             <span>{formatTime(clip.endTime - clip.startTime)}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button className="p-2 text-slate-500 hover:text-white transition-colors"><Settings className="w-5 h-5" /></button>
          <button className="p-2 text-slate-500 hover:text-white transition-colors"><Maximize className="w-5 h-5" /></button>
        </div>
      </div>
    </div>
  );
}

function formatTime(seconds: number) {
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

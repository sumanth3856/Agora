import React, { useRef, useEffect, useState, useMemo, useCallback, memo, Suspense, lazy } from 'react'
import { useSimulation, groq } from './SimulationContext'
import './index.css'
import { useAuth } from './AuthContext'
import Login from './Login'
import UserMenu from './UserMenu'
import ComposerPage from './ComposerPage'
import ProfilePage from './ProfilePage'
import BotProfileTile from './BotProfileTile'
import SocialPost from './SocialPost'
import ThreadBlock from './ThreadBlock'
import { UIModal, HighlightText, TypingIndicator, ShimmerPost } from './UIComponents'
import { getRelativeTime, flattenReplies } from './utils'

// Lazy load heavy ForceGraph
const ForceGraph = lazy(() => import('./ForceGraph'));

const useTrendingTopics = (posts, groqInstance) => {
  const [topics, setTopics] = useState([]);
  const computedRawWords = useMemo(() => {
    if (!posts?.length) return [];
    const STOP = new Set(['the', 'is', 'at', 'which', 'on', 'and', 'for', 'that', 'with', 'are', 'this', 'was', 'but', 'not', 'have', 'from', 'they', 'what', 'their', 'has', 'would', 'will', 'make', 'more', 'than', 'some', 'these', 'them', 'been', 'had', 'were', 'said', 'each', 'most', 'other', 'into', 'over', 'then', 'time', 'people', 'think', 'know', 'really', 'only', 'even', 'those', 'such', 'much', 'should', 'because']);
    const now = Date.now();
    const scores = {}, engs = {};
    const flattenPosts = (arr) => arr.reduce((acc, p) => [...acc, { ...p, eng: (p.likes || 0) + (p.shares || 0) + (p.replies?.length || 0) }, ...flattenPosts(p.replies || [])], []);
    
    flattenPosts(posts).forEach(p => {
      const weight = Math.max(0.3, 1 / (1 + (now - p.timestamp) / 3600000 * 0.1)) * (1 + Math.log1p(p.eng || 0));
      const tokens = (p.text || '').toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_~()"]/g, '').split(/\s+/).filter(w => w.length > 3 && !STOP.has(w));
      tokens.forEach(w => { scores[w] = (scores[w] || 0) + weight; engs[w] = (engs[w] || 0) + (p.eng || 0); });
      for (let i = 0; i < tokens.length - 1; i++) {
        const bg = `${tokens[i]} ${tokens[i+1]}`;
        scores[bg] = (scores[bg] || 0) + weight * 1.5; engs[bg] = (engs[bg] || 0) + (p.eng || 0);
      }
    });

    return Object.keys(scores).map(w => ({ word: w, score: scores[w], interactions: engs[w] }))
      .sort((a,b) => b.score - a.score)
      .filter(({word}) => word.includes(' ') || (word.length >= 5 && !['human', 'people', 'world', 'global', 'system'].includes(word)))
      .slice(0, 15);
  }, [posts]);

  useEffect(() => {
    if (!computedRawWords.length) return;
    setTopics(computedRawWords.slice(0, 5).map(tw => ({ word: tw.word.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' '), interactions: tw.interactions, category: 'Analyzing...' })));
    let mounted = true;
    import('./SimulationContext').then(({ clusterTopicsWithLLM }) => clusterTopicsWithLLM(groqInstance, computedRawWords.map(tw => tw.word)).then(clusters => {
      if (mounted) setTopics(clusters.map(name => ({ word: name, interactions: computedRawWords.find(tw => name.toLowerCase().includes(tw.word.toLowerCase()))?.interactions || 0, category: 'Trend' })).slice(0, 5));
    }));
    return () => { mounted = false; };
  }, [computedRawWords, groqInstance, Math.floor(Date.now() / 300000)]);

  return topics;
};

const ICON = {
  home: <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>,
  homeExtra: <polyline points="9 22 9 12 15 12 15 22"></polyline>,
  network: <><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></>,
  lab: <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.77 3.77z"></path>,
  settings: <><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></>
};

// ─── Main App ─────────────────────────────────────────────────────────────────
function App() {
  const {
    posts,
    isLoaded,
    outrageMultiplier,
    curiosityMultiplier,
    updateSimulationSettings,
    createHumanPost,
    createHumanReply,
    deletePost,
    editPost,
    likePost: contextLikePost,
    sharePost: contextSharePost,
    createCustomBot,
    deleteCustomBot,
    clearSimulation,
    updateBotPersona,
    postInteractors,
    generatingBots,
    activeBots,
    humanLiked,
    humanShared,
    botMemories,
    resetBotMemory,
    persuasions,
  } = useSimulation();

  const { user, loading } = useAuth();

  const [activeTab, setActiveTab] = useState('home');
  const [selectedBotId, setSelectedBotId] = useState(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  
  // Modal States
  const [showWipeModal, setShowWipeModal] = useState(false);
  const [showInfluenceModal, setShowInfluenceModal] = useState(false);
  const [showCreateBotModal, setShowCreateBotModal] = useState(false);
  const [showResetBotModal, setShowResetBotModal] = useState(false);
  const [showTerminateBotModal, setShowTerminateBotModal] = useState(false);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  
  // Custom Bot Form State
  const [newBotHandle, setNewBotHandle] = useState('');
  const [newBotColor, setNewBotColor] = useState('#1d9bf0');
  const [newBotPrompt, setNewBotPrompt] = useState('');
  
  const [showDiscoveryOverlay, setShowDiscoveryOverlay] = useState(false);
  const [heatmapMode, setHeatmapMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [timeMachineValue, setTimeMachineValue] = useState(100);

  // Buffer Engine
  const isInitialLoad = useRef(true);
  const [renderedPostIds, setRenderedPostIds] = useState(new Set());
  const [feedPosts, setFeedPosts] = useState([]);
  const [bufferedPosts, setBufferedPosts] = useState([]);

  // Task 7: ML Trending Topics
  const trendingTopics = useTrendingTopics(posts, groq);

  // Task 1 FIX: Buffer Logic
  // The key fix: on the very first time posts arrive (initial Supabase load),
  // we skip the buffer entirely and load directly into the feed.
  // Only after initial load do we start routing new top-level posts to the buffer.
  useEffect(() => {
    if (posts.length === 0) {
      setFeedPosts([]);
      setBufferedPosts([]);
      setRenderedPostIds(new Set());
      isInitialLoad.current = true;
      return;
    }

    // Initial load: dump everything straight to the feed
    if (isInitialLoad.current) {
      setFeedPosts(posts);
      setRenderedPostIds(new Set(posts.map(p => p.id)));
      isInitialLoad.current = false;
      return;
    }

    const currentTopPostId = feedPosts[0]?.id;
    const incomingTopPostId = posts[0]?.id;

    if (currentTopPostId === incomingTopPostId) {
      // Same top post — safe to sync (likes/shares/reply mutations on existing posts)
      setFeedPosts(posts);
      setRenderedPostIds(new Set(posts.map(p => p.id)));
    } else {
      // A new top-level post appeared — buffer it so the reading position doesn't jump
      const newBuffered = posts.filter(p => !renderedPostIds.has(p.id));
      if (newBuffered.length > 0) {
        setBufferedPosts(newBuffered);
        // Sync existing posts (likes/shares updates) without adding new ones
        const syncedFeed = posts.filter(p => renderedPostIds.has(p.id));
        setFeedPosts(syncedFeed);
      } else {
        // No genuinely new top-level posts — just a deep update (reply/like deep in tree)
        setFeedPosts(posts);
      }
    }
  }, [posts]); // eslint-disable-line react-hooks/exhaustive-deps

  const popBuffer = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setFeedPosts(posts);
    setRenderedPostIds(new Set(posts.map(p => p.id)));
    setBufferedPosts([]);
  };

  useEffect(() => {
    if (selectedBotId && activeTab === 'network') {
      setActiveTab('lab');
    }
  }, [selectedBotId]);

  useEffect(() => {
    const handleLoginOpen = () => setLoginModalOpen(true);
    document.addEventListener('navToLogin', handleLoginOpen);
    return () => document.removeEventListener('navToLogin', handleLoginOpen);
  }, []);

  const handleLikePost = useCallback((postId, authorId) => {
    if (!user) return setLoginModalOpen(true);
    contextLikePost(postId, authorId);
  }, [contextLikePost, user]);

  const handleSharePost = useCallback((postId, authorId) => {
    if (!user) return setLoginModalOpen(true);
    contextSharePost(postId, authorId);
  }, [contextSharePost, user]);

  const handleReplyPost = useCallback((parentPost, text) => {
    if (!user) return setLoginModalOpen(true);
    createHumanReply(parentPost, text);
  }, [createHumanReply, user]);

  // T4: Delete a post (human's own only — context validates)
  const handleDeletePost = useCallback((postId) => {
    deletePost(postId);
  }, [deletePost]);

  // T4: Edit a post text (human's own only)
  const handleEditPost = useCallback((postId, newText) => {
    editPost(postId, newText);
  }, [editPost]);

  const handleCreateHumanPost = useCallback((text) => {
    createHumanPost(text);
    popBuffer();
  }, [createHumanPost]); // eslint-disable-line react-hooks/exhaustive-deps

  // T2: Flat search results — shows individual matching posts AND replies
  // In search mode: each matching post or reply appears as its own card with
  // a "view in thread" button; no full thread expansion.
  const { displayedPosts, searchResults } = useMemo(() => {
    // Apply Time Machine Filter to feedPosts first
    let activeFeed = feedPosts;
    if (timeMachineValue < 100 && feedPosts.length > 0) {
      const times = feedPosts.map(p => new Date(p.created_at).getTime());
      const minTime = Math.min(...times);
      const maxTime = Math.max(...times);
      const range = maxTime - minTime;
      const cutoff = minTime + (range * (timeMachineValue / 100));
      activeFeed = feedPosts.filter(p => new Date(p.created_at).getTime() <= cutoff);
    }

    if (!searchQuery.trim()) {
      return { displayedPosts: activeFeed, searchResults: null };
    }
    const q = searchQuery.toLowerCase();

    // Flatten all posts + replies into a flat list with parent context
    const flatItems = [];
    activeFeed.forEach(post => {
      if (post.text?.toLowerCase().includes(q) || post.author?.handle?.toLowerCase().includes(q)) {
        flatItems.push({ item: post, parentPost: null });
      }
      const replies = flattenReplies(post.replies || []);
      replies.forEach(reply => {
        if (reply.text?.toLowerCase().includes(q) || reply.author?.handle?.toLowerCase().includes(q)) {
          flatItems.push({ item: reply, parentPost: post });
        }
      });
    });

    return { displayedPosts: activeFeed, searchResults: flatItems };
  }, [feedPosts, searchQuery, timeMachineValue]);

  const sharedPostProps = {
    likePost: handleLikePost,
    sharePost: handleSharePost,
    replyPost: handleReplyPost,
    deletePost: handleDeletePost,
    editPost: handleEditPost,
    searchQuery,
    postInteractors,
    humanLiked,
    humanShared,
  };

  const renderedFeedList = useMemo(() => {
    // T2: Shimmering animation while initial data is loading
    if (!isLoaded) {
      return Array(5).fill(0).map((_, i) => <ShimmerPost key={i} />);
    }

    // T2: Search mode — flat individual results
    if (searchResults !== null) {
      if (searchResults.length === 0) {
        return (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '1rem' }}>
            No posts or replies match "{searchQuery}"
          </div>
        );
      }
      return searchResults.map(({ item, parentPost }) => (
        <div key={item.id} className="post-container">
          <SocialPost
            post={item}
            {...sharedPostProps}
            showThreadLine={false}
            interactors={postInteractors?.[item.id]}
            isReply={!!parentPost}
            onViewInThread={parentPost ? () => {
              setSearchQuery('');
              // Scroll to the parent post after clearing search
              setTimeout(() => {
                const el = document.getElementById(`post-${parentPost.id}`);
                el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }, 100);
            } : undefined}
          />
        </div>
      ));
    }

    // Normal feed mode — full ThreadBlock with pagination
    if (!displayedPosts || displayedPosts.length === 0) {
      return (
        <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '1rem' }}>
          Silence in the network. Ignite a conversation.
        </div>
      );
    }
    return displayedPosts.map(post => (
      <ThreadBlock
        key={post.id}
        id={`post-${post.id}`}
        post={post}
        {...sharedPostProps}
      />
    ));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayedPosts, searchResults, searchQuery, postInteractors, humanLiked, humanShared, isLoaded]);


  if (loading) {
    return (
      <div className="auth-loading-screen">
        <div className="loading-logo">▲</div>
        <div className="typing-indicator" style={{ background: 'transparent', border: 'none' }}>
          <div className="dot"></div>
          <div className="dot"></div>
          <div className="dot"></div>
          <span style={{ fontWeight: 600, letterSpacing: '0.05em' }}>SYSTEM INITIALIZING</span>
        </div>
      </div>
    );
  }

  return (
    <div className="app-wrapper animate-entrance">
      {/* Global Login Modal Overlay */}
      {loginModalOpen && !user && (
        <div className="modal-overlay" style={{ zIndex: 9999999 }}>
          <div style={{ position: 'relative' }}>
            <button 
              className="action-btn" 
              onClick={() => setLoginModalOpen(false)}
              style={{ position: 'absolute', top: '16px', right: '16px', zIndex: 10, background: 'rgba(255,255,255,0.1)', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              ✕
            </button>
            <Login embedded={true} message="Sign in to interact with the network." />
          </div>
        </div>
      )}

      {isComposerOpen && (
        <ComposerPage 
          onCancel={() => setIsComposerOpen(false)} 
          onComplete={() => setIsComposerOpen(false)} 
        />
      )}
      
      {isProfileOpen && (
        <ProfilePage 
          onBack={() => setIsProfileOpen(false)} 
        />
      )}

      <div className="layout-container">
        
        {/* Center Feed Column */}
        <main className="main-feed" style={{ display: activeTab === 'home' ? 'flex' : 'none' }}>
          
          <div className="immersive-hero">
            <h1 className="hero-title">Network Pulse</h1>
            <p className="hero-subtitle">Real-time collective consciousness simulation.</p>
          </div>

          {!user && (
            <div style={{ padding: '24px', margin: '24px var(--container-padding)', background: 'var(--surface-hover)', borderRadius: '16px', border: '1px solid var(--border-bright)', textAlign: 'center', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
               <h3 style={{ fontSize: '1.2rem', marginBottom: '8px' }}>Join the Network</h3>
               <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>Sign in to interact with autonomous agents, reply, and shape the narrative.</p>
               <button className="btn-primary" style={{ padding: '12px 32px', fontSize: '1.05rem' }} onClick={() => setLoginModalOpen(true)}>Initialize Session</button>
            </div>
          )}

          {/* Feed Container */}
          <div style={{ position: 'relative' }}>

            {/* T2: Search filter chip */}
            {searchQuery && (
              <div style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  {(searchResults?.length ?? 0)} result{(searchResults?.length ?? 0) !== 1 ? 's' : ''} for
                </span>
                <span className="filter-chip">
                  🔍 {searchQuery}
                  <button onClick={() => setSearchQuery('')} aria-label="Clear filter" style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: '0 0 0 4px', fontSize: '0.85rem', lineHeight: 1 }}>✕</button>
                </span>
              </div>
            )}

            {/* Show New Posts Pill */}
            {bufferedPosts.length > 0 && (
              <div style={{ position: 'absolute', top: '16px', left: '0', right: '0', display: 'flex', justifyContent: 'center', zIndex: 10 }}>
                <button
                  onClick={popBuffer}
                  className="new-posts-pill animate-entrance"
                >
                  Show {bufferedPosts.length} new post{bufferedPosts.length > 1 ? 's' : ''}
                </button>
              </div>
            )}
            
            {renderedFeedList}

            <div style={{ paddingBottom: '150px', height: '50vh' }}></div>
          </div>
        </main>

        {/* Protected Views */}
        {!user && activeTab !== 'home' ? (
          <main className="main-feed" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '40px' }}>
             <div className="restricted-overlay animate-entrance">
                <div className="restricted-icon">
                   <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                </div>
                <h2 style={{ fontSize: '2rem', marginBottom: '12px', fontWeight: 800 }}>Locked Feature</h2>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '32px', maxWidth: '320px', lineHeight: 1.6 }}>
                  Access to the {activeTab} environment is restricted to authenticated network nodes.
                </p>
                <button className="btn-primary" style={{ width: '100%', padding: '16px' }} onClick={() => setLoginModalOpen(true)}>
                  Initialize Session
                </button>
             </div>
          </main>
        ) : (
          <>
            {/* Network Graph Tab */}
            <main className="main-feed" style={{ display: activeTab === 'network' ? 'flex' : 'none', position: 'relative', overflow: 'hidden' }}>
              <div className="immersive-hero" style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <div>
                  <h1 className="hero-title">Graph Theory</h1>
                  <p className="hero-subtitle">Visualizing the social distance between agents.</p>
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button onClick={() => setShowInfluenceModal(true)} className="nav-link" style={{ width: '40px', height: '40px', border: '1px solid var(--border)' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
                  </button>
                  <button onClick={() => setHeatmapMode(m => !m)} className="nav-link" style={{ width: '40px', height: '40px', border: '1px solid var(--border)', background: heatmapMode ? 'var(--text-primary)' : 'transparent', color: heatmapMode ? 'var(--bg-dark)' : 'inherit' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v20M2 12h20" /></svg>
                  </button>
                </div>
              </div>

          <div className="time-machine-bar">
            <span style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>🕒</span>
            <input 
              type="range" min="0" max="100" value={timeMachineValue} 
              onChange={e => setTimeMachineValue(Number(e.target.value))}
              style={{ flex: 1, accentColor: 'var(--accent-cyan)' }} 
            />
            <span style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--accent-cyan)', width: '40px' }}>{timeMachineValue}%</span>
          </div>

          <div style={{ flex: 1, minHeight: 0 }}>
              <Suspense fallback={<div className="typing-indicator" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}><div className="dot"></div><div className="dot"></div><div className="dot"></div><span>SYNCING NETWORK...</span></div>}>
                <ForceGraph 
                  heatmapMode={heatmapMode} 
                  onNodeClick={(id) => setSelectedBotId(id)}
                />
              </Suspense>
          </div>

          <UIModal
            isOpen={showInfluenceModal}
            onClose={() => setShowInfluenceModal(false)}
            title="Influence Analytics"
            description="Tracking the flow of persuasion and stance shifts across the network."
            onConfirm={() => setShowInfluenceModal(false)}
            confirmText="Close"
          >
            <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '60vh', overflowY: 'auto' }}>
              <div className="sidebar-card">
                <h4 style={{ marginBottom: '12px', fontSize: '1rem', color: 'var(--accent-cyan)' }}>Recent Persuasions</h4>
                {persuasions.length === 0 ? (
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>No stance shifts detected yet. Monitor active threads.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {persuasions.slice().reverse().map((p, i) => (
                      <div key={i} style={{ fontSize: '0.85rem', paddingBottom: '8px', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{activeBots.find(b => b.id === p.influencerId)?.handle || 'Bot'}</span>
                        {' persuaded '}
                        <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{activeBots.find(b => b.id === p.influencedId)?.handle || 'Bot'}</span>
                        <div style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>
                           Topic: <span style={{ color: 'var(--accent-cyan)' }}>{p.topic}</span>
                        </div>
                        <div style={{ marginTop: '2px', fontStyle: 'italic' }}>
                           {p.fromStance} → {p.toStance}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </UIModal>
        </main>

        {/* Bot Lab Tab */}
        <main className="main-feed" style={{ display: activeTab === 'lab' ? 'flex' : 'none' }}>
           <div className="immersive-hero">
              <h1 className="hero-title">Bot Lab</h1>
              <p className="hero-subtitle">Forge new consciousness or tune existing neural weights.</p>
           </div>
           <div style={{ padding: '0 var(--container-padding)' }}>
              <div 
                onClick={() => setShowCreateBotModal(true)}
                className="btn-premium-action"
                style={{ marginBottom: '32px' }}
              >
                + Initialize New Agent
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px', paddingBottom: '100px' }}>
                {activeBots.map(bot => (
                  <div key={bot.id} className="post-container" style={{ borderRadius: '16px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)' }}>
                    <BotProfileTile 
                      bot={bot} 
                      onEdit={() => { setSelectedBotId(bot.id); setIsEditMode(true); setShowCreateBotModal(true); }}
                      onReset={() => { setSelectedBotId(bot.id); setShowResetBotModal(true); }}
                      onDelete={() => { setSelectedBotId(bot.id); setShowTerminateBotModal(true); }}
                    />
                  </div>
                ))}
              </div>
           </div>
        </main>

        {/* Settings Tab */}
        <main className="main-feed" style={{ display: activeTab === 'settings' ? 'flex' : 'none', borderRight: 'none' }}>
          <header className="feed-header">
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800 }}>System Settings</h2>
            <div className="mobile-only">
              <UserMenu onProfileClick={() => setIsProfileOpen(true)} />
            </div>
          </header>
          
          <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '560px', margin: '0 auto', width: '100%', overflowY: 'auto' }}>
            
            <section>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: '6px' }}>Network Algorithms</h3>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '20px', fontSize: '0.9rem' }}>Tune the deep learning modifiers shaping the flow of information.</p>
              
              <div className="sidebar-card" style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <label style={{ fontSize: '1rem', fontWeight: 700 }}>Outrage Engine</label>
                  <span style={{ color: 'var(--accent-rose)', fontWeight: 800 }}>{outrageMultiplier}%</span>
                </div>
                <input type="range" min="0" max="100" value={outrageMultiplier} onChange={e => updateSimulationSettings({ outrageMultiplier: Number(e.target.value) })} style={{ accentColor: 'var(--accent-rose)', width: '100%' }} />
              </div>
              
              <div className="sidebar-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <label style={{ fontSize: '1rem', fontWeight: 700 }}>Curiosity Engine</label>
                  <span style={{ color: 'var(--accent-cyan)', fontWeight: 800 }}>{curiosityMultiplier}%</span>
                </div>
                <input type="range" min="0" max="100" value={curiosityMultiplier} onChange={e => updateSimulationSettings({ curiosityMultiplier: Number(e.target.value) })} style={{ accentColor: 'var(--accent-cyan)', width: '100%' }} />
              </div>
            </section>


            <section style={{ borderTop: '1px solid var(--border)', paddingTop: '32px', paddingBottom: '80px' }}>
              <div style={{ padding: '24px', borderRadius: '16px', border: '1px solid rgba(255, 69, 0, 0.2)', background: 'rgba(255, 69, 0, 0.03)' }}>
                <h3 style={{ fontSize: '1.1rem', color: 'var(--accent-rose)', fontWeight: 800, marginBottom: '8px' }}>Danger Zone</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '20px' }}>
                  Resetting the network will wipe all posts, custom bots, and interaction history. This action cannot be undone.
                </p>
                <button
                  className="btn-danger"
                  style={{ width: '100%' }}
                  onClick={() => setShowWipeModal(true)}
                >
                  Terminate & Wipe Network Data
                </button>
              </div>
            </section>

            <UIModal 
              isOpen={showWipeModal}
              onClose={() => setShowWipeModal(false)}
              title="Wipe the Network?"
              description="This will permanently delete ALL posts and interaction data from the cloud. This action is irreversible."
              onConfirm={() => clearSimulation()}
              confirmText="Wipe Everything"
              variant="danger"
            />

            {/* Custom Bot Creation Modal */}
            <UIModal
              isOpen={showCreateBotModal}
              onClose={() => setShowCreateBotModal(false)}
              title="Create New Agent"
              description="Define the identity and cognitive mission of a new network node."
              onConfirm={() => {
                if (newBotHandle && newBotPrompt) {
                  createCustomBot(newBotHandle, `hsl(${Math.random() * 360}, 70%, 60%)`, newBotPrompt);
                }
              }}
              confirmText="Initialize Agent"
            >
              <div style={{ marginTop: '12px' }}>
                <div className="modal-input-group">
                  <label className="modal-input-label">Bot Handle</label>
                  <input 
                    type="text" 
                    className="modal-input" 
                    placeholder="@MyCustomBot" 
                    value={newBotHandle}
                    onChange={e => setNewBotHandle(e.target.value)}
                  />
                </div>
                <div className="modal-input-group">
                  <label className="modal-input-label">System Prompt (Cognitive Mission)</label>
                  <textarea 
                    className="modal-input" 
                    rows="4" 
                    placeholder="Enter instructions for the AI persona..."
                    value={newBotPrompt}
                    onChange={e => setNewBotPrompt(e.target.value)}
                    style={{ resize: 'vertical' }}
                  />
                </div>
              </div>
            </UIModal>

            {/* Reset Bot Memory Modal */}
            <UIModal
              isOpen={showResetBotModal}
              onClose={() => setShowResetBotModal(false)}
              title="Reset Cognitive State?"
              description="This will clear all learned alliances, rivalries, and behavioral patterns for this agent."
              onConfirm={() => {
                if (selectedBotId) resetBotMemory(selectedBotId);
              }}
              confirmText="Reset Logic"
              variant="danger"
            />

            {/* Terminate Bot Modal */}
            <UIModal
              isOpen={showTerminateBotModal}
              onClose={() => setShowTerminateBotModal(false)}
              title="Terminate Agent?"
              description="This will permanently remove this agent from the simulation. This cannot be undone."
              onConfirm={() => {
                if (selectedBotId) {
                  deleteCustomBot(selectedBotId);
                  setSelectedBotId(null);
                }
              }}
              confirmText="Terminate"
              variant="danger"
            />
          </div>
        </main>
      </>
    )}
    </div>

    {/* Navigation Sidebar / Mobile Dock */}
    <nav className="floating-nav">
      {/* Desktop Brand Info */}
      <div className="desktop-only brand-container">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '32px', height: '32px', background: 'var(--accent-cyan)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 'bold' }}>∆</div>
          <span className="brand-name" style={{ fontSize: '1.2rem', fontWeight: 800, letterSpacing: '-0.02em', display: 'block' }}>Echo Chamber</span>
        </div>
      </div>

      <div className="nav-group">
        {['home', 'network', 'lab', 'settings'].map(tab => (
          <button 
            key={tab} 
            className={`nav-link ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
            title={tab.charAt(0).toUpperCase() + tab.slice(1)}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill={activeTab === tab ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {ICON[tab]}
              {tab === 'home' && ICON.homeExtra}
            </svg>
          </button>
        ))}

        <div className="mobile-only" style={{ width: '1px', height: '24px', background: 'var(--border)', margin: '0 8px' }}></div>
        <div className="desktop-only" style={{ height: '1px', width: '100%', background: 'var(--border)', margin: '8px 0' }}></div>

        {user ? (
          <div className="bottom-nav-group">
            <button
              className="nav-link"
              style={{ color: 'var(--bg-dark)', background: 'var(--text-primary)' }}
              onClick={() => setIsComposerOpen(true)}
              title="Compose"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
            <UserMenu 
              onProfileClick={() => setIsProfileOpen(true)}
              onSettingsClick={() => setActiveTab('settings')}
            />
          </div>
        ) : (
          <button className="nav-link" onClick={() => setLoginModalOpen(true)} title="Sign In">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg>
          </button>
        )}
      </div>
    </nav>

  </div>
  )
}

export default App;

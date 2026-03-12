import React, { useRef, useEffect, useState, useMemo, useCallback, memo } from 'react'
import { useSimulation } from './SimulationContext'
import './index.css'

// Helper for human-readable time
const getRelativeTime = (timestamp) => {
  const diffInSeconds = Math.floor((Date.now() - timestamp) / 1000);
  if (diffInSeconds < 60) return `${diffInSeconds}s`;
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes}m`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

// --- Custom Hook: Simulated ML Trending Topics ---
const useTrendingTopics = (posts) => {
  return useMemo(() => {
    if (!posts || posts.length === 0) return [];
    
    // Stop words to ignore during frequency analysis
    const stopWords = new Set(['the', 'is', 'at', 'which', 'on', 'and', 'a', 'to', 'in', 'of', 'it', 'for', 'that', 'with', 'as', 'are', 'this', 'was', 'but', 'not', 'have', 'from', 'they', 'we', 'you', 'i', 'an', 'be', 'by', 'or', 'what', 'so', 'can', 'if', 'about', 'just', 'like', 'my', 'your', 'all', 'do', 'out', 'up', 'how', 'when', 'there', 'who', 'why', 'their', 'has', 'would', 'will', 'no', 'make']);
    
    const wordCounts = {};
    
    // Recursive function to extract words from all nested posts
    const extractWords = (postList) => {
      postList.forEach(post => {
        if (post.text) {
           const words = post.text.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()"]/g, "").split(/\s+/);
           words.forEach(word => {
             if (word.length > 3 && !stopWords.has(word)) { // Only count meaningful words > 3 chars
               wordCounts[word] = (wordCounts[word] || 0) + 1;
             }
           });
        }
        if (post.replies && post.replies.length > 0) {
           extractWords(post.replies);
        }
      });
    };

    extractWords(posts);

    // Sort by frequency
    const sortedTopics = Object.keys(wordCounts)
      .map(word => ({ word, count: wordCounts[word] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5); // Top 5 trending

    // Capitalize first letter for display
    return sortedTopics.map(t => ({
      ...t,
      word: t.word.charAt(0).toUpperCase() + t.word.slice(1)
    }));
  }, [posts]);
};

// --- Optimized SocialPost Component ---
const SocialPost = memo(({ post, likePost, sharePost, isReply = false, isLastReply = true }) => {
  return (
    <div className={`post-card ${!isReply ? 'animate-entrance' : ''}`} style={{ borderBottom: isReply && !isLastReply ? 'none' : 'none' }}>
      {/* Left Column: Avatar & Thread Line */}
      <div className="post-avatar-col">
        <div style={{ 
          width: '48px', 
          height: '48px', 
          borderRadius: '50%', 
          backgroundColor: post.author.color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#000',
          fontWeight: 800,
          fontSize: '1.2rem',
          flexShrink: 0,
          boxShadow: `inset 0 0 0 2px rgba(0,0,0,0.3)`
        }}>
          {post.author.handle.substring(1, 2).toUpperCase()}
        </div>
        
        {/* Thread line connects replies visually. */}
        {((post.replies && post.replies.length > 0) || (isReply && !isLastReply)) && (
          <div className="thread-line"></div>
        )}
      </div>

      {/* Right Column: Content */}
      <div className="post-content-col" style={{ paddingBottom: '8px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <span style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '1.05rem' }}>
            {post.author.id === 'human_user' ? 'Me' : post.author.handle.substring(1)}
          </span>
          <span style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>
            {post.author.handle}
          </span>
          <span style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>·</span>
          <span style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>
            {getRelativeTime(post.timestamp)}
          </span>
        </div>

        {/* Text Area */}
        <p style={{ 
          color: 'var(--text-primary)', 
          fontSize: '1.1rem', 
          lineHeight: '1.5',
          marginBottom: '16px',
          whiteSpace: 'pre-wrap',
          wordWrap: 'break-word'
        }}>
          {post.text}
        </p>

        {/* Action Bar */}
        <div style={{ display: 'flex', gap: '48px', marginTop: '12px' }}>
          <button className="action-btn reply" onClick={(e) => { e.stopPropagation(); }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
            <span style={{ fontSize: '0.95rem', minWidth: '20px' }}>{post.replies ? post.replies.length : 0}</span>
          </button>

          <button className="action-btn share" onClick={(e) => { e.stopPropagation(); sharePost(post.id, post.author.id); }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 1l4 4-4 4"></path><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><path d="M7 23l-4-4 4-4"></path><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
            <span style={{ fontSize: '0.95rem', minWidth: '20px' }}>{post.shares > 0 ? post.shares : ''}</span>
          </button>

          <button className="action-btn like" onClick={(e) => { e.stopPropagation(); likePost(post.id, post.author.id); }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
            <span style={{ fontSize: '0.95rem', minWidth: '20px' }}>{post.likes > 0 ? post.likes : ''}</span>
          </button>
        </div>
      </div>
    </div>
  );
});

// Component to render a post and its immediate replies as a single threaded block
const ThreadBlock = memo(({ post, likePost, sharePost }) => {
  return (
    <div className="threaded-replies-container" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
      <SocialPost post={post} likePost={likePost} sharePost={sharePost} />
      {post.replies && post.replies.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column' }}> 
          {post.replies.map((reply, index) => (
            <SocialPost 
              key={reply.id} 
              post={reply} 
              likePost={likePost} 
              sharePost={sharePost} 
              isReply={true} 
              isLastReply={index === post.replies.length - 1} 
            />
          ))}
        </div>
      )}
    </div>
  )
});

// --- Isolated Composer Component ---
const Composer = ({ createHumanPost }) => {
  const [text, setText] = useState('');

  const handleSubmit = () => {
    if (text.trim()) {
      createHumanPost(text.trim());
      setText('');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div className="composer-box" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="post-avatar-col">
          <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: '#fff', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '1.2rem' }}>
            M
          </div>
        </div>
        <div className="post-content-col" style={{ display: 'flex', flexDirection: 'column', paddingTop: '8px' }}>
          <textarea 
            id="composer-input"
            placeholder="What is happening?!" 
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            rows="2"
            style={{ fontSize: '1.4rem', padding: '4px 0', minHeight: '60px', fontWeight: 500 }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: '16px', borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
            <button 
              className="btn-primary" 
              disabled={!text.trim()}
              onClick={handleSubmit}
              style={{ padding: '10px 24px', fontSize: '1rem', backgroundColor: 'var(--accent-cyan)', color: '#fff' }}
            >
              Post
            </button>
          </div>
        </div>
    </div>
  );
};


function App() {
  const {
    posts,
    outrageMultiplier,
    setOutrageMultiplier,
    curiosityMultiplier,
    setCuriosityMultiplier,
    createHumanPost,
    likePost: contextLikePost,
    sharePost: contextSharePost,
    createCustomBot,
    clearSimulation
  } = useSimulation();

  const [activeTab, setActiveTab] = useState('home');
  const [newBotHandle, setNewBotHandle] = useState('');
  const [newBotColor, setNewBotColor] = useState('#1d9bf0');
  const [newBotPrompt, setNewBotPrompt] = useState('');

  // Buffer Engine
  const [renderedPostIds, setRenderedPostIds] = useState(new Set());
  const [feedPosts, setFeedPosts] = useState([]);
  const [bufferedPosts, setBufferedPosts] = useState([]);

  // Extract Trending Topics
  const trendingTopics = useTrendingTopics(posts);

  // Buffer Logic: Determine if incoming posts from Context should go to feed or buffer
  useEffect(() => {
    if (posts.length === 0) {
       setFeedPosts([]);
       setBufferedPosts([]);
       setRenderedPostIds(new Set());
       return;
    }

    const currentTopPostId = feedPosts[0]?.id;
    const incomingTopPostId = posts[0]?.id;

    // First load or buffer is empty and top post perfectly matches (just an up-tree mutation like a like/share)
    if (feedPosts.length === 0 || currentTopPostId === incomingTopPostId) {
       setFeedPosts(posts); // Safe to overwrite, it's just state mutative updates
       setRenderedPostIds(new Set(posts.map(p => p.id)));
    } else {
       // A new post was generated at the top! Push to buffer instead of jumping the feed.
       // Only add to buffer if it's completely new.
       const newBuffered = posts.filter(p => !renderedPostIds.has(p.id));
       if (newBuffered.length > 0) {
          setBufferedPosts(newBuffered);
          // Keep the existing feed posts in sync with their latest mutations (likes/shares/nested replies)
          // without pulling in the new top-level posts that throw off reading position.
          const syncedFeed = posts.filter(p => renderedPostIds.has(p.id));
          setFeedPosts(syncedFeed);
       } else {
          // If no new top-level posts, just sync the feed (likely a late reply or like update deep in tree)
          setFeedPosts(posts);
       }
    }
  }, [posts, renderedPostIds, feedPosts]);

  const popBuffer = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setFeedPosts(posts);
    setRenderedPostIds(new Set(posts.map(p => p.id)));
    setBufferedPosts([]);
  };

  const handleLikePost = useCallback((postId, authorId) => {
    contextLikePost(postId, authorId);
  }, [contextLikePost]);

  const handleSharePost = useCallback((postId, authorId) => {
    contextSharePost(postId, authorId);
  }, [contextSharePost]);

  const handleCreateHumanPost = useCallback((text) => {
     createHumanPost(text);
     // Instantly pop the buffer if user posts, so they see their own post at the top immediately
     popBuffer();
  }, [createHumanPost]);

  const renderedFeedList = useMemo(() => {
    if (!feedPosts || feedPosts.length === 0) {
      return (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '1.2rem' }}>
          Silence in the network. Ignite a conversation.
        </div>
      );
    }
    return feedPosts.map(post => (
      <ThreadBlock key={post.id} post={post} likePost={handleLikePost} sharePost={handleSharePost} />
    ));
  }, [feedPosts, handleLikePost, handleSharePost]);


  return (
    <div className="app-wrapper">
      <div className="layout-container">
        
        {/* Left Navigation Sidebar */}
        <aside className="nav-sidebar">
          {/* Logo & Brand Name */}
          <div style={{ padding: '8px 16px', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-primary)' }}>
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
            </svg>
            <h1 style={{ fontSize: '1.8rem', fontWeight: 800, letterSpacing: '-0.03em' }}>StanceBot</h1>
          </div>

          <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '32px' }}>
            <button className={`nav-link ${activeTab === 'home' ? 'active' : ''}`} onClick={() => setActiveTab('home')} style={{ fontWeight: activeTab === 'home' ? 800 : 500, backgroundColor: activeTab === 'home' ? 'var(--surface-hover)' : 'transparent' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill={activeTab === 'home' ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
              Home
            </button>
            <button className={`nav-link ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')} style={{ fontWeight: activeTab === 'settings' ? 800 : 500, backgroundColor: activeTab === 'settings' ? 'var(--surface-hover)' : 'transparent' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill={activeTab === 'settings' ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              Settings
            </button>
          </nav>
          
          <button 
            className="btn-primary" 
            style={{ width: '90%', padding: '16px 0', fontSize: '1.2rem', backgroundColor: 'var(--accent-cyan)' }}
            onClick={() => { setActiveTab('home'); setTimeout(() => document.getElementById('composer-input')?.focus(), 100); }}
          >
            Post
          </button>
        </aside>

        {/* Center Feed Column */}
        <main className="main-feed" style={{ display: activeTab === 'home' ? 'flex' : 'none' }}>
          
          <header className="feed-header">
            <h2 style={{ fontSize: '1.35rem', fontWeight: 800 }}>Home</h2>
          </header>

          <Composer createHumanPost={handleCreateHumanPost} />

          {/* Feed Container */}
          <div style={{ position: 'relative' }}>
            
            {/* Show New Posts Pill */}
            {bufferedPosts.length > 0 && (
              <div style={{ position: 'absolute', top: '16px', left: '0', right: '0', display: 'flex', justifyContent: 'center', zIndex: 10 }}>
                <button 
                  onClick={popBuffer}
                  className="animate-entrance"
                  style={{ 
                    background: 'var(--accent-cyan)', 
                    color: 'white', 
                    border: 'none', 
                    borderRadius: '9999px',
                    padding: '10px 24px',
                    fontSize: '1rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(29, 155, 240, 0.4)',
                    transform: 'translateZ(0)',
                    transition: 'transform 0.1s'
                  }}
                  onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                  onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.95)'}
                >
                  Show {bufferedPosts.length} new post{bufferedPosts.length > 1 ? 's' : ''}
                </button>
              </div>
            )}
            
            {renderedFeedList}

            <div style={{ paddingBottom: '120px', height: '30vh' }}></div> {/* Guaranteed bottom clearance for mobile nav */}
          </div>
        </main>

        {/* Settings Tab */}
        <main className="main-feed" style={{ display: activeTab === 'settings' ? 'flex' : 'none', borderRight: 'none', maxWidth: window.innerWidth > 768 ? '1000px' : '100%' }}>
           <header className="feed-header">
             <h2 style={{ fontSize: '1.35rem', fontWeight: 800 }}>System Settings</h2>
           </header>
           
           <div style={{ padding: '32px', display: 'flex', flexDirection: 'column', gap: '32px', maxWidth: '600px', margin: '0 auto', width: '100%' }}>
              
              <section>
                <h3 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '8px' }}>Network Algorithms</h3>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', fontSize: '0.95rem' }}>Tune the deep learning modifiers shaping the flow of information across the network.</p>
                
                <div className="sidebar-card" style={{ marginBottom: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                      <label style={{ fontSize: '1.1rem', fontWeight: 700 }}>Outrage Engine</label>
                      <span style={{ color: 'var(--accent-rose)', fontWeight: 800 }}>{outrageMultiplier}%</span>
                    </div>
                    <input type="range" min="0" max="100" value={outrageMultiplier} onChange={e => setOutrageMultiplier(Number(e.target.value))} style={{ accentColor: 'var(--accent-rose)' }} />
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '12px' }}>Increases the likelihood of aggressive, polarizing commentary.</p>
                </div>
                
                <div className="sidebar-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                      <label style={{ fontSize: '1.1rem', fontWeight: 700 }}>Curiosity Engine</label>
                      <span style={{ color: 'var(--accent-cyan)', fontWeight: 800 }}>{curiosityMultiplier}%</span>
                    </div>
                    <input type="range" min="0" max="100" value={curiosityMultiplier} onChange={e => setCuriosityMultiplier(Number(e.target.value))} style={{ accentColor: 'var(--accent-cyan)' }} />
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '12px' }}>Encourages analytical threads and deep-dive inquiries.</p>
                </div>
              </section>

              <section>
                  <h3 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '8px' }}>Deploy Agent</h3>
                  <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', fontSize: '0.95rem' }}>Summon a new LLM-powered entity to the network.</p>
                  <div className="sidebar-card">
                    <div style={{ display: 'flex', gap: '16px', marginBottom: '20px' }}>
                      <input type="color" value={newBotColor} onChange={e => setNewBotColor(e.target.value)} style={{ width: '56px', height: '56px', padding: '0', border: 'none', borderRadius: '50%', cursor: 'pointer', background: 'transparent' }} />
                      <input type="text" placeholder="@handle" value={newBotHandle} onChange={e => setNewBotHandle(e.target.value)} style={{ flex: 1, padding: '16px 20px', border: '1px solid var(--border)', borderRadius: '12px', fontSize: '1.1rem' }} />
                    </div>
                    <textarea placeholder="Define the agent's core directives, political bias, and communication style..." value={newBotPrompt} onChange={e => setNewBotPrompt(e.target.value)} rows="4" style={{ width: '100%', padding: '20px', border: '1px solid var(--border)', borderRadius: '12px', marginBottom: '20px', fontSize: '1.1rem' }} />
                    <button 
                      className="btn-primary" 
                      style={{ width: '100%', padding: '16px', fontSize: '1.2rem', backgroundColor: 'var(--text-primary)', color: 'var(--bg-dark)' }}
                      onClick={() => { if (newBotHandle && newBotPrompt) { createCustomBot(newBotHandle, newBotColor, newBotPrompt); setNewBotHandle(''); setNewBotPrompt(''); setActiveTab('home'); } }}
                    >
                      Summon Node
                    </button>
                </div>
              </section>

              <section style={{ marginTop: '32px', borderTop: '1px solid var(--border)', paddingTop: '32px', paddingBottom: '80px' }}>
                <h3 style={{ fontSize: '1.4rem', color: 'var(--accent-rose)', fontWeight: 800, marginBottom: '16px' }}>Danger Zone</h3>
                <button 
                  onClick={() => confirm("Wipe the entire network and delete all cloud data?") && clearSimulation()} 
                  style={{ background: 'transparent', border: '1px solid var(--accent-rose)', color: 'var(--accent-rose)', padding: '16px 24px', borderRadius: '12px', cursor: 'pointer', fontSize: '1.1rem', fontWeight: 700, width: '100%' }}
                >
                  Reset Network Data
                </button>
              </section>
           </div>
        </main>

        {/* Right Sidebar: Trends (Replaced Controls) */}
        <aside className="right-sidebar" style={{ display: activeTab === 'settings' ? 'none' : '' }}>
           
           <div className="sidebar-card" style={{ padding: '16px 24px', borderRadius: '9999px', display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--surface)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input type="text" placeholder="Search" style={{ fontSize: '1.1rem', padding: '0', background: 'transparent' }} />
           </div>

           <div className="sidebar-card" style={{ padding: '24px' }}>
              <h3 style={{ fontSize: '1.35rem', marginBottom: '24px', fontWeight: 800 }}>Trends for you</h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {trendingTopics.length === 0 ? (
                   <span style={{ color: 'var(--text-secondary)' }}>Awaiting network signals...</span>
                ) : (
                  trendingTopics.map((topic, index) => (
                    <div key={topic.word} style={{ display: 'flex', flexDirection: 'column', gap: '4px', cursor: 'pointer' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{index + 1} · Trending</span>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>
                      </div>
                      <span style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--text-primary)' }}>{topic.word}</span>
                      <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{topic.count * 123}K interactions</span>
                    </div>
                  ))
                )}
              </div>
           </div>
           
           <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', padding: '0 16px', marginTop: '12px' }}>
              {['Terms of Service', 'Privacy Policy', 'Cookie Policy', 'Accessibility', 'Ads info', 'More ...', '© 2024 StanceBot'].map(link => (
                <span key={link} style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', cursor: 'pointer' }}>{link}</span>
              ))}
           </div>
        </aside>

        {/* Mobile Navigation (Bottom) */}
        <nav className="mobile-nav">
          <button className="action-btn" onClick={() => setActiveTab('home')} style={{ color: activeTab === 'home' ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill={activeTab === 'home' ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
          </button>
          
          <button className="action-btn" onClick={() => { setActiveTab('home'); setTimeout(() => document.getElementById('composer-input')?.focus(), 100); }} style={{ color: 'var(--text-primary)' }}>
             <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>
          </button>

          <button className="action-btn" onClick={() => setActiveTab('settings')} style={{ color: activeTab === 'settings' ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill={activeTab === 'settings' ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          </button>
        </nav>

      </div>
    </div>
  )
}

export default App

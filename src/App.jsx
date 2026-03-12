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

// --- Optimized SocialPost Component ---
// Wrapped in memo to prevent re-rendering when the main feed updates (unless props change)
const SocialPost = memo(({ post, likePost, sharePost, isReply = false, isLastReply = true }) => {
  return (
    <div className={`post-card ${!isReply ? 'animate-entrance' : ''}`} style={{ borderBottom: isReply && !isLastReply ? 'none' : '1px solid var(--border)' }}>
      {/* Left Column: Avatar & Thread Line */}
      <div className="post-avatar-col">
        <div style={{ 
          width: '48px', /* Larger avatar for spaciousness */
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
        
        {/* Thread line connects replies visually. Visible if post has replies OR is a middle reply */}
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
          fontSize: '1.1rem', /* Larger readability */
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
    <div className="threaded-replies-container">
      <SocialPost post={post} likePost={likePost} sharePost={sharePost} />
      {/* Flat map approach for replies to ensure they don't indent into oblivion, but stay visible on the main axis */}
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
// This prevents typing from forcing a re-render of the massive Feed list
const Composer = ({ createHumanPost }) => {
  const [text, setText] = useState('');

  const handleSubmit = () => {
    if (text.trim()) {
      createHumanPost(text.trim());
      setText('');
    }
  };

  return (
    <div className="composer-box">
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

  // Use Callbacks for actions passed to huge lists so children don't re-render pointlessly
  const handleLikePost = useCallback((postId, authorId) => {
    contextLikePost(postId, authorId);
  }, [contextLikePost]);

  const handleSharePost = useCallback((postId, authorId) => {
    contextSharePost(postId, authorId);
  }, [contextSharePost]);

  const handleCreateHumanPost = useCallback((text) => {
     createHumanPost(text);
  }, [createHumanPost]);

  // Memoize the Feed array to prevent massive re-renders when sidebars change state
  const renderedFeed = useMemo(() => {
    if (!posts || posts.length === 0) {
      return (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '1.2rem' }}>
          Silence in the network. Ignite a conversation.
        </div>
      );
    }
    return posts.map(post => (
      <ThreadBlock key={post.id} post={post} likePost={handleLikePost} sharePost={handleSharePost} />
    ));
  }, [posts, handleLikePost, handleSharePost]);


  return (
    <div className="app-wrapper">
      <div className="layout-container">
        
        {/* Left Navigation Sidebar */}
        <aside className="nav-sidebar">
          <div style={{ padding: '8px 16px', marginBottom: '24px' }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-primary)' }}>
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
            </svg>
          </div>

          <nav style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '32px' }}>
            <button className="nav-link" onClick={() => setActiveTab('home')} style={{ fontWeight: activeTab === 'home' ? 800 : 500 }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill={activeTab === 'home' ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
              Home
            </button>
            <button className="nav-link" onClick={() => setActiveTab('settings')} style={{ fontWeight: activeTab === 'settings' ? 800 : 500 }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill={activeTab === 'settings' ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              Settings
            </button>
          </nav>
          
          <button 
            className="btn-primary" 
            style={{ width: '90%', padding: '16px 0', fontSize: '1.2rem', backgroundColor: 'var(--accent-cyan)' }}
            onClick={() => document.getElementById('composer-input')?.focus()}
          >
            Post
          </button>
        </aside>

        {/* Center Feed Column */}
        <main className="main-feed" style={{ display: activeTab === 'home' || window.innerWidth > 768 ? 'flex' : 'none' }}>
          
          <header className="feed-header">
            <h2 style={{ fontSize: '1.35rem', fontWeight: 800 }}>Home</h2>
          </header>

          {/* Isolated Composer prevents typing lag */}
          <Composer createHumanPost={handleCreateHumanPost} />

          {/* Feed Container */}
          <div>
            <div style={{ padding: '16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'center' }}>
              <span style={{ fontSize: '1rem', color: 'var(--accent-cyan)', cursor: 'pointer', fontWeight: 500 }}>Show new posts</span>
            </div>
            
            {renderedFeed}

            <div style={{ height: '30vh' }}></div> {/* Generous bottom padding */}
          </div>
        </main>

        <main className="main-feed" style={{ display: activeTab === 'settings' && window.innerWidth <= 768 ? 'flex' : 'none' }}>
           <header className="feed-header">
             <h2 style={{ fontSize: '1.35rem', fontWeight: 800 }}>Settings</h2>
           </header>
           <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <h3 style={{ fontSize: '1.2rem' }}>Simulation Tuning</h3>
              <div className="sidebar-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                    <label style={{ fontSize: '1rem', fontWeight: 600 }}>Outrage Engine</label>
                    <span style={{ color: 'var(--accent-rose)' }}>{outrageMultiplier}%</span>
                  </div>
                  <input type="range" min="0" max="100" value={outrageMultiplier} onChange={e => setOutrageMultiplier(Number(e.target.value))} style={{ accentColor: 'var(--accent-rose)' }} />
              </div>
              <div className="sidebar-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                    <label style={{ fontSize: '1rem', fontWeight: 600 }}>Curiosity Engine</label>
                    <span style={{ color: 'var(--accent-cyan)' }}>{curiosityMultiplier}%</span>
                  </div>
                  <input type="range" min="0" max="100" value={curiosityMultiplier} onChange={e => setCuriosityMultiplier(Number(e.target.value))} style={{ accentColor: 'var(--accent-cyan)' }} />
              </div>
           </div>
        </main>

        {/* Right Sidebar: Trends / Network Settings */}
        <aside className="right-sidebar">
           
           <div className="sidebar-card" style={{ padding: '16px 24px', borderRadius: '9999px', display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--border)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input type="text" placeholder="Search" style={{ fontSize: '1rem', padding: '0', background: 'transparent' }} />
           </div>

           <div className="sidebar-card">
              <h3 style={{ fontSize: '1.25rem', marginBottom: '20px', fontWeight: 800 }}>Network Algorithms</h3>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', fontWeight: 600 }}>Outrage Level</span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 800 }}>{outrageMultiplier}%</span>
              </div>
              <input type="range" min="0" max="100" value={outrageMultiplier} onChange={e => setOutrageMultiplier(Number(e.target.value))} style={{ accentColor: 'var(--accent-rose)' }} />
              
              <div style={{ display: 'flex', justifyContent: 'space-between', margin: '32px 0 12px 0' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', fontWeight: 600 }}>Curiosity Level</span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 800 }}>{curiosityMultiplier}%</span>
              </div>
              <input type="range" min="0" max="100" value={curiosityMultiplier} onChange={e => setCuriosityMultiplier(Number(e.target.value))} style={{ accentColor: 'var(--accent-cyan)' }} />
           </div>

           <div className="sidebar-card">
              <h3 style={{ fontSize: '1.25rem', marginBottom: '20px', fontWeight: 800 }}>Deploy Agent</h3>
              <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                <input type="color" value={newBotColor} onChange={e => setNewBotColor(e.target.value)} style={{ width: '44px', height: '44px', padding: '0', border: 'none', borderRadius: '50%', cursor: 'pointer', background: 'transparent' }} />
                <input type="text" placeholder="@handle" value={newBotHandle} onChange={e => setNewBotHandle(e.target.value)} style={{ flex: 1, padding: '12px 16px', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '1rem' }} />
              </div>
              <textarea placeholder="System prompt & rules..." value={newBotPrompt} onChange={e => setNewBotPrompt(e.target.value)} rows="3" style={{ width: '100%', padding: '16px', border: '1px solid var(--border)', borderRadius: '8px', marginBottom: '16px', fontSize: '1rem' }} />
              <button 
                className="btn-primary" 
                style={{ width: '100%', padding: '12px', fontSize: '1rem', backgroundColor: 'var(--text-primary)', color: 'var(--bg-dark)' }}
                onClick={() => { if (newBotHandle && newBotPrompt) { createCustomBot(newBotHandle, newBotColor, newBotPrompt); setNewBotHandle(''); setNewBotPrompt(''); } }}
              >
                Summon Node
              </button>
           </div>
           
           <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', padding: '0 16px', marginTop: '12px' }}>
              {['Terms of Service', 'Privacy Policy', 'Cookie Policy', 'Accessibility', 'Ads info', 'More ...', '© 2024 StanceBot'].map(link => (
                <span key={link} style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', cursor: 'pointer' }}>{link}</span>
              ))}
           </div>
           
           <button 
              onClick={() => confirm("Wipe the entire network?") && clearSimulation()} 
              style={{ background: 'transparent', border: 'none', color: 'var(--accent-rose)', cursor: 'pointer', fontSize: '0.9rem', textAlign: 'left', padding: '0 16px', marginTop: 'auto', fontWeight: 700 }}
            >
              Reset Network Data
            </button>
        </aside>

        {/* Mobile Navigation (Bottom) */}
        <nav className="mobile-nav">
          <button className="action-btn" onClick={() => setActiveTab('home')} style={{ color: activeTab === 'home' ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill={activeTab === 'home' ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
          </button>
          
          <button className="action-btn" onClick={() => document.getElementById('composer-input')?.focus()} style={{ color: 'var(--text-primary)' }}>
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

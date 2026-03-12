import React, { useRef, useEffect, useState, useMemo } from 'react'
import { useSimulation } from './SimulationContext'
import './index.css'

const ThreadedPost = ({ post, likePost, sharePost, depth = 0 }) => {
  return (
    <div 
      className={`animate-entrance ${depth === 0 ? "glass" : ""}`} 
      style={{ 
        padding: depth === 0 ? '24px' : '16px 0 0 20px', 
        borderRadius: depth === 0 ? '24px' : '0', 
        borderLeft: depth === 0 ? `4px solid ${post.author.color}` : `2px solid var(--border)`,
        marginTop: depth === 0 ? '0' : '20px',
        position: 'relative',
        transition: 'transform 0.2s ease',
        boxShadow: depth === 0 ? 'var(--shadow-premium)' : 'none'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: post.author.color, boxShadow: `0 0 10px ${post.author.color}80` }}></div>
          <span style={{ fontWeight: 700, color: 'white', fontSize: depth > 0 ? '0.9rem' : '1.05rem', fontFamily: 'var(--font-heading)' }}>
            {post.author.handle}
          </span>
        </div>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.05em' }}>
          {new Date(post.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <p style={{ fontSize: depth > 0 ? '0.95rem' : '1.1rem', color: 'rgba(255,255,255,0.9)', marginBottom: '20px', lineHeight: '1.6', fontWeight: 400 }}>{post.text}</p>
      
      <div style={{ display: 'flex', gap: '24px' }}>
        <button 
          onClick={() => likePost(post.id, post.author.id)}
          style={{ 
            background: 'rgba(255,255,255,0.03)', 
            border: '1px solid var(--border)', 
            color: 'var(--text-secondary)', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '8px', 
            cursor: 'pointer', 
            fontSize: '0.85rem', 
            padding: '8px 16px',
            borderRadius: '12px',
            transition: 'all 0.2s',
            fontWeight: 600
          }}
        >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
            {post.likes > 0 && <span style={{ color: 'var(--accent-rose)' }}>{post.likes}</span>}
        </button>
        <button 
          onClick={() => sharePost(post.id, post.author.id)}
          style={{ 
            background: 'rgba(255,255,255,0.03)', 
            border: '1px solid var(--border)', 
            color: 'var(--text-secondary)', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '8px', 
            cursor: 'pointer', 
            fontSize: '0.85rem', 
            padding: '8px 16px',
            borderRadius: '12px',
            transition: 'all 0.2s',
            fontWeight: 600
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>
          {post.shares > 0 && <span style={{ color: 'var(--accent-cyan)' }}>{post.shares}</span>}
        </button>
      </div>

      {post.replies && post.replies.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {post.replies.map(reply => (
            <ThreadedPost key={reply.id} post={reply} likePost={likePost} sharePost={sharePost} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

function App() {
  const {
    posts,
    activeBots,
    activePrompts,
    outrageMultiplier,
    setOutrageMultiplier,
    curiosityMultiplier,
    setCuriosityMultiplier,
    createHumanPost,
    likePost,
    sharePost,
    createCustomBot,
    clearSimulation
  } = useSimulation();

  const [composerText, setComposerText] = useState('');
  const [activeTab, setActiveTab] = useState('feed'); // 'feed', 'controls'
  const [newBotHandle, setNewBotHandle] = useState('');
  const [newBotColor, setNewBotColor] = useState('#06b6d4');
  const [newBotPrompt, setNewBotPrompt] = useState('');
  const [timeScrub, setTimeScrub] = useState(100);

  const timeFilteredPosts = useMemo(() => {
    if (timeScrub === 100 || posts.length === 0) return posts;
    const earliest = posts[posts.length - 1]?.timestamp || Date.now();
    const targetTime = earliest + (Date.now() - earliest) * (timeScrub / 100);
    const filterTimeline = (arr) => {
      return arr.filter(p => p.timestamp <= targetTime).map(p => ({
        ...p,
        replies: p.replies ? filterTimeline(p.replies) : []
      }));
    };
    return filterTimeline(posts);
  }, [posts, timeScrub]);

  return (
    <div className="app-container">
      {/* Sidebar: Controls */}
      <aside className={`side-panel glass-panel ${activeTab === 'controls' ? 'active' : 'desktop-only'}`} style={{ padding: '40px', gap: '32px', display: activeTab === 'controls' || window.innerWidth > 768 ? 'flex' : 'none' }}>
        <div>
          <h1 className="text-gradient" style={{ fontSize: '2.5rem', fontWeight: 800, marginBottom: '8px' }}>StanceBot</h1>
          <p className="text-label">The Living Opinion Network</p>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <h3 style={{ fontSize: '1.2rem', color: 'white' }}>Network Influence</h3>
          <div className="control-item">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
              <label className="text-label" style={{ color: 'var(--text-secondary)' }}>Outrage Intensity</label>
              <span style={{ fontSize: '0.9rem', color: 'var(--accent-rose)', fontWeight: 800 }}>{outrageMultiplier}%</span>
            </div>
            <input type="range" min="0" max="100" value={outrageMultiplier} onChange={e => setOutrageMultiplier(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--accent-rose)' }} />
          </div>
          <div className="control-item">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
              <label className="text-label" style={{ color: 'var(--text-secondary)' }}>Intellectual Curiosity</label>
              <span style={{ fontSize: '0.9rem', color: 'var(--accent-cyan)', fontWeight: 800 }}>{curiosityMultiplier}%</span>
            </div>
            <input type="range" min="0" max="100" value={curiosityMultiplier} onChange={e => setCuriosityMultiplier(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--accent-cyan)' }} />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', background: 'rgba(255,255,255,0.02)', padding: '24px', borderRadius: '24px', border: '1px solid var(--border)' }}>
          <h4 style={{ fontSize: '1rem', color: 'white' }}>Summon Agent</h4>
          <div style={{ display: 'flex', gap: '10px' }}>
            <input type="color" value={newBotColor} onChange={e => setNewBotColor(e.target.value)} style={{ width: '36px', height: '36px', padding: '0', border: 'none', borderRadius: '10px', cursor: 'pointer', background: 'transparent' }} />
            <input type="text" placeholder="@handle" value={newBotHandle} onChange={e => setNewBotHandle(e.target.value)} style={{ flex: 1, background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: '12px', color: 'white', padding: '10px 16px', fontSize: '0.9rem', outline: 'none' }} />
          </div>
          <textarea placeholder="Personality traits & biases..." value={newBotPrompt} onChange={e => setNewBotPrompt(e.target.value)} rows={3} style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: '12px', color: 'white', padding: '12px 16px', fontSize: '0.9rem', resize: 'none', fontFamily: 'inherit', outline: 'none' }} />
          <button onClick={() => { if (newBotHandle && newBotPrompt) { createCustomBot(newBotHandle, newBotColor, newBotPrompt); setNewBotHandle(''); setNewBotPrompt(''); } }} style={{ background: 'white', color: 'black', border: 'none', borderRadius: '14px', padding: '12px', fontSize: '0.9rem', fontWeight: 800, cursor: 'pointer', transition: 'all 0.2s' }}>Deploy Bot</button>
        </div>

        <button onClick={() => confirm("Reset simulation?") && clearSimulation()} style={{ marginTop: 'auto', background: 'transparent', border: '1px solid rgba(244, 63, 94, 0.3)', color: 'var(--accent-rose)', padding: '14px', borderRadius: '16px', fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}>Clear Network</button>
      </aside>

      {/* Main Content: The Feed */}
      <main className="main-content" style={{ display: activeTab === 'feed' || window.innerWidth > 768 ? 'flex' : 'none' }}>
        <div className="glass-panel custom-scrollbar" style={{ flex: 1, padding: '40px', display: 'flex', flexDirection: 'column', overflowY: 'auto', borderRadius: window.innerWidth <= 768 ? '0' : '32px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px', position: 'sticky', top: 0, background: 'transparent', backdropFilter: 'blur(20px)', zIndex: 10, paddingBottom: '20px', borderBottom: '1px solid var(--border)' }}>
            <h2 style={{ fontSize: '1.8rem', fontWeight: 800 }}>Echo Flow</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <span className="text-label" style={{ fontSize: '0.65rem' }}>Temporal Scrub</span>
                <input type="range" min="0" max="100" value={timeScrub} onChange={e => setTimeScrub(Number(e.target.value))} style={{ width: '120px', cursor: 'pointer', accentColor: 'var(--accent-cyan)' }} />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '16px', marginBottom: '40px' }}>
            <input 
              type="text" 
              value={composerText} 
              onChange={e => setComposerText(e.target.value)} 
              onKeyDown={e => e.key === 'Enter' && composerText.trim() && (createHumanPost(composerText.trim()), setComposerText(''))}
              placeholder="Inject a thought into the collective..." 
              style={{ flex: 1, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', padding: '20px 24px', borderRadius: '20px', color: 'white', fontSize: '1.1rem', outline: 'none', transition: 'border-color 0.2s' }} 
            />
            <button onClick={() => composerText.trim() && (createHumanPost(composerText.trim()), setComposerText(''))} style={{ background: 'white', color: 'black', border: 'none', borderRadius: '20px', padding: '0 32px', fontWeight: 800, cursor: 'pointer', fontSize: '1rem' }}>Post</button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', maxWidth: '800px', margin: '0 auto', width: '100%' }}>
            {timeFilteredPosts.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '60px', fontSize: '1.1rem', fontStyle: 'italic' }}>Silence in the network...</div>
            ) : (
              timeFilteredPosts.map(post => <ThreadedPost key={post.id} post={post} likePost={likePost} sharePost={sharePost} />)
            )}
          </div>
        </div>
      </main>

      {/* Mobile Navigation */}
      <nav style={{ 
        position: 'fixed', 
        bottom: 0, 
        left: 0, 
        right: 0, 
        height: '80px', 
        background: 'rgba(5, 5, 8, 0.9)', 
        backdropFilter: 'blur(24px)', 
        borderTop: '1px solid var(--border)', 
        display: window.innerWidth <= 768 ? 'flex' : 'none', 
        justifyContent: 'space-around', 
        alignItems: 'center', 
        zIndex: 1000,
        padding: '0 20px'
      }}>
        {[
          { id: 'feed', label: 'Feed', icon: 'M19 20H5V4h2v14h12v2z' },
          { id: 'controls', label: 'Controls', icon: 'M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4V7H3v2h12z' }
        ].map(tab => (
          <button 
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{ 
              background: 'none', 
              border: 'none', 
              color: activeTab === tab.id ? 'white' : 'var(--text-muted)', 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'center', 
              gap: '6px',
              cursor: 'pointer',
              transition: 'all 0.3s'
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d={tab.icon} />
            </svg>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.05em' }}>{tab.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

export default App

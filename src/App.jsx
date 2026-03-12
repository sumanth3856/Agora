import React, { useRef, useEffect, useState, useMemo } from 'react'
import { useSimulation } from './SimulationContext'
import './index.css'

const ThreadedPost = ({ post, likePost, sharePost, depth = 0 }) => {
  return (
    <div 
      className={`animate-entrance ${depth === 0 ? "glass" : ""}`} 
      style={{ 
        padding: depth === 0 ? '20px 24px' : '16px 0 0 24px', 
        borderRadius: depth === 0 ? '16px' : '0', 
        borderLeft: depth > 0 ? `1px solid var(--border)` : 'none',
        marginTop: depth === 0 ? '0' : '12px',
        position: 'relative',
        boxShadow: depth === 0 ? 'var(--shadow-sm)' : 'none',
        background: depth === 0 ? 'var(--surface)' : 'transparent',
        border: depth === 0 ? '1px solid var(--border)' : 'none'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Elite Avatar Representation */}
          <div style={{ 
            width: depth === 0 ? '24px' : '20px', 
            height: depth === 0 ? '24px' : '20px', 
            borderRadius: '50%', 
            background: `radial-gradient(circle at 30% 30%, ${post.author.color}, ${post.author.color}dd)`, 
            boxShadow: `0 2px 8px ${post.author.color}40`,
            border: `2px solid var(--surface)`
          }}></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: depth > 0 ? '0.85rem' : '0.95rem', lineHeight: 1 }}>
                {post.author.handle}
              </span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 500, lineHeight: 1 }}>
                {new Date(post.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
          </div>
        </div>
      </div>
      <p style={{ 
        fontSize: depth > 0 ? '0.9rem' : '1rem', 
        color: 'var(--text-primary)', 
        opacity: 0.9, 
        marginBottom: '16px', 
        lineHeight: '1.5', 
        paddingLeft: depth === 0 ? '36px' : '16px', // Align with text instead of avatar
        fontWeight: 400 
      }}>
        {post.text}
      </p>
      
      <div style={{ display: 'flex', gap: '16px', paddingLeft: depth === 0 ? '36px' : '16px' }}>
        <button 
          onClick={() => likePost(post.id, post.author.id)}
          style={{ 
            background: 'transparent', 
            border: 'none', 
            color: 'var(--text-muted)', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '6px', 
            cursor: 'pointer', 
            fontSize: '0.8rem', 
            transition: 'color 0.2s',
            fontWeight: 500,
            padding: 0
          }}
          onMouseOver={(e) => e.currentTarget.style.color = 'var(--accent-rose)'}
          onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
        >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: '-1px' }}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
            <span style={{ color: post.likes > 0 ? 'var(--accent-rose)' : 'inherit' }}>{post.likes}</span>
        </button>
        <button 
          onClick={() => sharePost(post.id, post.author.id)}
          style={{ 
            background: 'transparent', 
            border: 'none', 
            color: 'var(--text-muted)', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '6px', 
            cursor: 'pointer', 
            fontSize: '0.8rem', 
            transition: 'color 0.2s',
            fontWeight: 500,
            padding: 0
          }}
          onMouseOver={(e) => e.currentTarget.style.color = 'var(--accent-cyan)'}
          onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: '-1px' }}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>
          <span style={{ color: post.shares > 0 ? 'var(--accent-cyan)' : 'inherit' }}>{post.shares}</span>
        </button>
      </div>

      {post.replies && post.replies.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', paddingLeft: depth === 0 ? '16px' : '8px' }}>
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
  const [newBotColor, setNewBotColor] = useState('#22d3ee');
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
      <aside className={`side-panel glass-panel ${activeTab === 'controls' ? 'active' : 'desktop-only'}`} style={{ padding: '32px', gap: '32px', display: activeTab === 'controls' || window.innerWidth > 768 ? 'flex' : 'none', border: 'none', background: 'transparent', boxShadow: 'none' }}>
        <div>
          <h1 className="text-gradient" style={{ fontSize: '1.75rem', fontWeight: 800, marginBottom: '4px' }}>StanceBot</h1>
          <p className="text-label" style={{ color: 'var(--text-muted)' }}>Opinion Infrastructure</p>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <h3 style={{ fontSize: '0.9rem', color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Algorithm Biases</h3>
          <div className="control-item" style={{ background: 'var(--surface)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
              <label className="text-label">Outrage Affinity</label>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontWeight: 600 }}>{outrageMultiplier}%</span>
            </div>
            <input type="range" min="0" max="100" value={outrageMultiplier} onChange={e => setOutrageMultiplier(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--accent-rose)' }} />
          </div>
          <div className="control-item" style={{ background: 'var(--surface)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
              <label className="text-label">Intellectual Drift</label>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontWeight: 600 }}>{curiosityMultiplier}%</span>
            </div>
            <input type="range" min="0" max="100" value={curiosityMultiplier} onChange={e => setCuriosityMultiplier(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--accent-cyan)' }} />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: 'var(--surface)', padding: '20px', borderRadius: '16px', border: '1px solid var(--border)' }}>
          <h4 className="text-label" style={{ marginBottom: '4px' }}>Deploy Agent Persona</h4>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input type="color" value={newBotColor} onChange={e => setNewBotColor(e.target.value)} style={{ width: '38px', height: '38px', padding: '0', border: 'none', borderRadius: '8px', cursor: 'pointer', background: 'var(--bg-dark)' }} />
            <input type="text" className="form-input" placeholder="@handle" value={newBotHandle} onChange={e => setNewBotHandle(e.target.value)} style={{ flex: 1, padding: '0 12px', fontSize: '0.85rem' }} />
          </div>
          <textarea className="form-input" placeholder="Core directives & biases..." value={newBotPrompt} onChange={e => setNewBotPrompt(e.target.value)} rows={3} style={{ padding: '10px 12px', fontSize: '0.85rem', resize: 'none' }} />
          <button className="btn-primary" onClick={() => { if (newBotHandle && newBotPrompt) { createCustomBot(newBotHandle, newBotColor, newBotPrompt); setNewBotHandle(''); setNewBotPrompt(''); } }} style={{ padding: '10px', fontSize: '0.85rem', marginTop: '4px' }}>Initialize Agent</button>
        </div>

        <button onClick={() => confirm("Destabilize and flush all network data?") && clearSimulation()} style={{ marginTop: 'auto', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)', padding: '12px', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s', alignSelf: 'flex-start' }} onMouseOver={e => { e.currentTarget.style.color = 'var(--accent-rose)'; e.currentTarget.style.borderColor = 'rgba(251, 113, 133, 0.3)'; }} onMouseOut={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border)'; }}>Flush Network</button>
      </aside>

      {/* Main Content: The Feed */}
      <main className="main-content" style={{ display: activeTab === 'feed' || window.innerWidth > 768 ? 'flex' : 'none' }}>
        {/* Centered container to simulate SaaS content pane */}
        <div style={{ width: '100%', maxWidth: '680px', margin: '0 auto', display: 'flex', flexDirection: 'column', height: '100%' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>Feed</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <span className="text-label">Temporal Axis</span>
                    <input type="range" min="0" max="100" value={timeScrub} onChange={e => setTimeScrub(Number(e.target.value))} style={{ width: '100px', cursor: 'pointer', accentColor: 'var(--text-secondary)' }} />
                </div>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginBottom: '32px', position: 'relative' }}>
                <input 
                type="text" 
                className="form-input"
                value={composerText} 
                onChange={e => setComposerText(e.target.value)} 
                onKeyDown={e => e.key === 'Enter' && composerText.trim() && (createHumanPost(composerText.trim()), setComposerText(''))}
                placeholder="Broadcast to the network..." 
                style={{ flex: 1, padding: '16px 20px', borderRadius: '24px', fontSize: '0.95rem', paddingRight: '100px', background: 'var(--surface)' }} 
                />
                <button 
                    className="btn-primary" 
                    onClick={() => composerText.trim() && (createHumanPost(composerText.trim()), setComposerText(''))} 
                    style={{ position: 'absolute', right: '6px', top: '6px', bottom: '6px', padding: '0 20px', borderRadius: '18px', fontSize: '0.85rem' }}
                >
                    Post
                </button>
            </div>

            {/* Scrollable Feed Area */}
            <div className="custom-scrollbar" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px', paddingRight: '8px' }}>
                {timeFilteredPosts.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '200px', gap: '12px' }}>
                    <div style={{ width: '40px', height: '40px', border: '2px dashed var(--border)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                         <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
                    </div>
                    <span className="text-label" style={{ color: 'var(--text-muted)' }}>Awaiting network activity...</span>
                </div>
                ) : (
                timeFilteredPosts.map(post => <ThreadedPost key={post.id} post={post} likePost={likePost} sharePost={sharePost} />)
                )}
                {/* Bottom Padding for scroll area */}
                <div style={{ height: '40px', flexShrink: 0 }}></div>
            </div>

        </div>
      </main>

      {/* Mobile Navigation */}
      <nav style={{ 
        position: 'fixed', 
        bottom: 0, 
        left: 0, 
        right: 0, 
        height: '72px', 
        background: 'var(--surface)', 
        borderTop: '1px solid var(--border)', 
        display: window.innerWidth <= 768 ? 'flex' : 'none', 
        justifyContent: 'space-around', 
        alignItems: 'center', 
        zIndex: 1000,
        paddingBottom: 'env(safe-area-inset-bottom)'
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
              color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-muted)', 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'center', 
              gap: '4px',
              cursor: 'pointer',
              transition: 'all 0.2s',
              flex: 1,
              height: '100%',
              justifyContent: 'center'
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d={tab.icon} />
            </svg>
            <span style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.02em' }}>{tab.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

export default App

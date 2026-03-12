import React, { useRef, useEffect, useState, useMemo } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { useSimulation } from './SimulationContext'
import './index.css'

const ThreadedPost = ({ post, likePost, sharePost, depth = 0 }) => {
  return (
    <div 
      className={`animate-entrance ${depth === 0 ? "glass" : ""}`} 
      style={{ 
        padding: depth === 0 ? '20px' : '12px 0 0 16px', 
        borderRadius: depth === 0 ? '20px' : '0', 
        borderLeft: depth === 0 ? `4px solid ${post.author.color}` : `2px solid var(--border)`,
        marginTop: depth === 0 ? '0' : '16px',
        position: 'relative',
        transition: 'transform 0.2s ease',
        boxShadow: depth === 0 ? '0 10px 30px rgba(0,0,0,0.2)' : 'none'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: post.author.color }}></div>
          <span style={{ fontWeight: 700, color: 'white', fontSize: depth > 0 ? '0.9rem' : '1rem', fontFamily: 'var(--font-heading)' }}>
            {post.author.handle}
          </span>
        </div>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>
          {new Date(post.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <p style={{ fontSize: depth > 0 ? '0.9rem' : '1rem', color: 'var(--text-primary)', marginBottom: '16px', lineHeight: '1.6' }}>{post.text}</p>
      
      <div style={{ display: 'flex', gap: '20px' }}>
        <button 
          onClick={() => likePost(post.id, post.author.id)}
          className="interaction-btn"
          style={{ 
            background: 'rgba(255,255,255,0.05)', 
            border: '1px solid var(--border)', 
            color: 'var(--text-secondary)', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '6px', 
            cursor: 'pointer', 
            fontSize: '0.8rem', 
            padding: '6px 12px',
            borderRadius: '20px',
            transition: 'all 0.2s'
          }}
        >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
            {post.likes > 0 && <span style={{ fontWeight: 700, color: 'var(--accent-rose)' }}>{post.likes}</span>}
        </button>
        <button 
          onClick={() => sharePost(post.id, post.author.id)}
          className="interaction-btn"
          style={{ 
            background: 'rgba(255,255,255,0.05)', 
            border: '1px solid var(--border)', 
            color: 'var(--text-secondary)', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '6px', 
            cursor: 'pointer', 
            fontSize: '0.8rem', 
            padding: '6px 12px',
            borderRadius: '20px',
            transition: 'all 0.2s'
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>
          {post.shares > 0 && <span style={{ fontWeight: 700, color: 'var(--accent-cyan)' }}>{post.shares}</span>}
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
    nodes,
    links,
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
  const [activeTab, setActiveTab] = useState('feed'); // 'feed', 'network', 'controls'
  const [newBotHandle, setNewBotHandle] = useState('');
  const [newBotColor, setNewBotColor] = useState('#10b981');
  const [newBotPrompt, setNewBotPrompt] = useState('');
  const [selectedNode, setSelectedNode] = useState(null);
  const [physicsRepulsion, setPhysicsRepulsion] = useState(400);
  const [physicsLinkDist, setPhysicsLinkDist] = useState(40);
  const [timeScrub, setTimeScrub] = useState(100);

  const fgRef = useRef();
  
  const timeFilteredPosts = useMemo(() => {
    if (timeScrub === 100 || posts.length === 0) return posts;
    const earliest = posts[posts.length - 1]?.timestamp || Date.now();
    const latest = Date.now();
    const targetTime = earliest + (latest - earliest) * (timeScrub / 100);
    const filterTimeline = (arr) => {
      return arr.filter(p => p.timestamp <= targetTime).map(p => ({
        ...p,
        replies: p.replies ? filterTimeline(p.replies) : []
      }));
    };
    return filterTimeline(posts);
  }, [posts, timeScrub]);

  const timeFilteredNodes = useMemo(() => {
    if (timeScrub === 100 || nodes.length === 0) return nodes;
    const earliest = posts[posts.length - 1]?.timestamp || Date.now();
    const targetTime = earliest + (Date.now() - earliest) * (timeScrub / 100);
    return nodes.filter(n => (n.spawnTime || earliest) <= targetTime);
  }, [nodes, posts, timeScrub]);

  const timeFilteredLinks = useMemo(() => {
    if (timeScrub === 100 || links.length === 0) return links;
    const earliest = posts[posts.length - 1]?.timestamp || Date.now();
    const targetTime = earliest + (Date.now() - earliest) * (timeScrub / 100);
    return links.filter(l => (l.spawnTime || earliest) <= targetTime);
  }, [links, posts, timeScrub]);

  const [dimensions, setDimensions] = useState({
    width: 270,
    height: 500
  });

  useEffect(() => {
    const handleResize = () => {
      const isMobile = window.innerWidth <= 768;
      setDimensions({
        width: isMobile ? window.innerWidth - 32 : window.innerWidth < 1200 ? window.innerWidth - 64 : 320,
        height: isMobile ? window.innerHeight - 200 : window.innerHeight - 200
      });
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (fgRef.current) {
      fgRef.current.d3Force('charge').strength(-physicsRepulsion);
      fgRef.current.d3Force('link').distance(link => {
        let baseDist = physicsLinkDist;
        if (link.sentiment === 'AGREE') baseDist *= 0.5;
        if (link.sentiment === 'DISAGREE') baseDist *= 2.0;
        return baseDist;
      });
      fgRef.current.d3ReheatSimulation();
    }
  }, [physicsRepulsion, physicsLinkDist, nodes.length, links.length]);

  return (
    <div className="app-container">
      {/* Sidebar: Controls (Hidden on mobile unless active) */}
      <aside className={`side-panel glass-panel desktop-only ${activeTab === 'controls' ? 'active' : ''}`} style={{ padding: '32px', gap: '24px', display: activeTab === 'controls' || window.innerWidth > 1200 ? 'flex' : 'none' }}>
        <div>
          <h1 className="text-gradient" style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '4px' }}>StanceBot</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600 }}>
            The Opinion Network
          </p>
        </div>
        
        <div className="control-section" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <h3 style={{ fontSize: '1rem', color: 'white' }}>Dial Dynamics</h3>
          <div className="control-item">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Outrage</label>
              <span style={{ fontSize: '0.85rem', color: 'var(--accent-rose)', fontWeight: 700 }}>{outrageMultiplier}%</span>
            </div>
            <input type="range" min="0" max="100" value={outrageMultiplier} onChange={e => setOutrageMultiplier(Number(e.target.value))} style={{ width: '100%' }} />
          </div>
          <div className="control-item">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Curiosity</label>
              <span style={{ fontSize: '0.85rem', color: 'var(--accent-cyan)', fontWeight: 700 }}>{curiosityMultiplier}%</span>
            </div>
            <input type="range" min="0" max="100" value={curiosityMultiplier} onChange={e => setCuriosityMultiplier(Number(e.target.value))} style={{ width: '100%' }} />
          </div>
        </div>

        <div className="control-section" style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: 'rgba(255,255,255,0.03)', padding: '20px', borderRadius: '20px', border: '1px solid var(--border)' }}>
          <h4 style={{ fontSize: '0.9rem', color: 'white' }}>Inject Persona</h4>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input type="color" value={newBotColor} onChange={e => setNewBotColor(e.target.value)} style={{ width: '32px', height: '32px', padding: '0', border: 'none', borderRadius: '8px', cursor: 'pointer', background: 'transparent' }} />
            <input type="text" placeholder="@handle" value={newBotHandle} onChange={e => setNewBotHandle(e.target.value)} style={{ flex: 1, background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: '8px', color: 'white', padding: '8px 12px', fontSize: '0.85rem' }} />
          </div>
          <textarea placeholder="Personality traits..." value={newBotPrompt} onChange={e => setNewBotPrompt(e.target.value)} rows={3} style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: '8px', color: 'white', padding: '10px 12px', fontSize: '0.85rem', resize: 'none', fontFamily: 'inherit' }} />
          <button onClick={() => { if (newBotHandle && newBotPrompt) { createCustomBot(newBotHandle, newBotColor, newBotPrompt); setNewBotHandle(''); setNewBotPrompt(''); } }} style={{ background: 'white', color: 'black', border: 'none', borderRadius: '12px', padding: '10px', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer', transition: 'transform 0.2s' }}>Deploy Agent</button>
        </div>

        <button onClick={() => confirm("Reset all simulation data?") && clearSimulation()} style={{ marginTop: 'auto', background: 'transparent', border: '1px solid var(--accent-rose)', color: 'var(--accent-rose)', padding: '12px', borderRadius: '12px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}>Wipe Simulation</button>
      </aside>

      {/* Main Content: Live Feed */}
      <main className="main-content" style={{ display: activeTab === 'feed' || window.innerWidth > 800 ? 'flex' : 'none' }}>
        <div className="glass-panel custom-scrollbar" style={{ flex: 1, padding: '24px', display: 'flex', flexDirection: 'column', overflowY: 'auto', borderRadius: window.innerWidth <= 768 ? '0' : '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px', position: 'sticky', top: 0, background: 'transparent', backdropFilter: 'blur(10px)', zIndex: 10, paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Pulse Feed</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Timeflow</span>
                <input type="range" min="0" max="100" value={timeScrub} onChange={e => setTimeScrub(Number(e.target.value))} style={{ width: '100px', cursor: 'pointer' }} />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px', marginBottom: '32px' }}>
            <input 
              type="text" 
              value={composerText} 
              onChange={e => setComposerText(e.target.value)} 
              onKeyDown={e => e.key === 'Enter' && composerText.trim() && (createHumanPost(composerText.trim()), setComposerText(''))}
              placeholder="Inject a thought..." 
              style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', padding: '16px 20px', borderRadius: '16px', color: 'white', fontSize: '1rem', outline: 'none', transition: 'border-color 0.2s' }} 
            />
            <button onClick={() => composerText.trim() && (createHumanPost(composerText.trim()), setComposerText(''))} style={{ background: 'white', color: 'black', border: 'none', borderRadius: '16px', padding: '0 24px', fontWeight: 700, cursor: 'pointer' }}>Post</button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {timeFilteredPosts.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px' }}>Waiting for the network to ripple...</div>
            ) : (
              timeFilteredPosts.map(post => <ThreadedPost key={post.id} post={post} likePost={likePost} sharePost={sharePost} />)
            )}
          </div>
        </div>
      </main>

      {/* Right Sidebar: Topology (Hidden on mobile unless active) */}
      <aside className={`side-panel glass-panel desktop-only ${activeTab === 'network' ? 'active' : ''}`} style={{ padding: '32px', display: activeTab === 'network' || window.innerWidth > 1400 ? 'flex' : 'none', position: 'relative' }}>
        <h3 style={{ fontSize: '1.25rem', marginBottom: '24px' }}>Topology</h3>
        <div style={{ flex: 1, background: 'rgba(0,0,0,0.2)', borderRadius: '24px', overflow: 'hidden', border: '1px solid var(--border)' }}>
           {typeof window !== 'undefined' && (
              <ForceGraph2D
                ref={fgRef}
                graphData={{ nodes: timeFilteredNodes, links: timeFilteredLinks }}
                width={dimensions.width}
                height={dimensions.height}
                nodeColor={n => n.color}
                nodeRelSize={7}
                linkColor={() => 'rgba(255,255,255,0.1)'}
                linkWidth={l => l.value * 0.5 + 1}
                backgroundColor="transparent"
                onNodeClick={n => setSelectedNode(n)}
              />
           )}
        </div>

        {selectedNode && (
          <div className="glass animate-entrance" style={{ position: 'absolute', bottom: '32px', left: '32px', right: '32px', padding: '24px', borderRadius: '24px', border: `2px solid ${selectedNode.color}40`, zIndex: 100 }}>
             <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                <div>
                  <h4 style={{ color: 'white', fontSize: '1.2rem' }}>{selectedNode.handle}</h4>
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Influence: {Math.round(selectedNode.val)}</p>
                </div>
                <button onClick={() => setSelectedNode(null)} style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
             </div>
             <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '12px', maxHeight: '120px', overflowY: 'auto' }}>
                {activePrompts[activeBots.find(b => b.id === selectedNode.id)?.role] || "User-controlled entity."}
             </div>
          </div>
        )}
      </aside>

      {/* Mobile Navigation Bar */}
      <nav style={{ 
        position: 'fixed', 
        bottom: 0, 
        left: 0, 
        right: 0, 
        height: '70px', 
        background: 'rgba(5, 5, 8, 0.8)', 
        backdropFilter: 'blur(20px)', 
        borderTop: '1px solid var(--border)', 
        display: window.innerWidth <= 1200 ? 'flex' : 'none', 
        justifyContent: 'space-around', 
        alignItems: 'center', 
        zIndex: 1000,
        padding: '0 10px'
      }}>
        {[
          { id: 'feed', label: 'Feed', icon: 'M19 20H5V4h2v14h12v2z' },
          { id: 'network', label: 'Network', icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-9l6 4.5-6 4.5z' },
          { id: 'controls', label: 'Controls', icon: 'M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4V7H3v2h12z' }
        ].map(tab => (
          <button 
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{ 
              background: 'none', 
              border: 'none', 
              color: activeTab === tab.id ? 'var(--accent-cyan)' : 'var(--text-muted)', 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'center', 
              gap: '4px',
              cursor: 'pointer',
              transition: 'color 0.2s'
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d={tab.icon} />
            </svg>
            <span style={{ fontSize: '0.7rem', fontWeight: 600 }}>{tab.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

export default App

import React, { useRef, useEffect, useState, useMemo } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { useSimulation } from './SimulationContext'
import './index.css'

const ThreadedPost = ({ post, likePost, sharePost, depth = 0 }) => {
  return (
    <div 
      className={depth === 0 ? "glass" : ""} 
      style={{ 
        padding: depth === 0 ? '16px' : '12px 0 0 12px', 
        borderRadius: depth === 0 ? '12px' : '0', 
        borderLeft: depth === 0 ? `3px solid ${post.author.color}` : `2px solid var(--border)`,
        marginTop: depth === 0 ? '0' : '12px',
        position: 'relative'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
        <span style={{ fontWeight: 600, color: post.author.color, fontSize: depth > 0 ? '0.9rem' : '1rem' }}>
          {post.author.handle}
        </span>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          {new Date(post.timestamp).toLocaleTimeString()}
        </span>
      </div>
      <p style={{ fontSize: depth > 0 ? '0.9rem' : '0.95rem', marginBottom: '12px' }}>{post.text}</p>
      
      {/* Interaction Buttons */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '8px' }}>
        <button 
          onClick={() => likePost(post.id, post.author.id)}
          style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '0.8rem', transition: 'color 0.2s' }}
          onMouseOver={(e) => e.currentTarget.style.color = 'var(--accent-rose)'}
          onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
        >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
            Like {post.likes > 0 && <span style={{ marginLeft: '4px', fontWeight: 600 }}>{post.likes}</span>}
        </button>
        <button 
          onClick={() => sharePost(post.id, post.author.id)}
          style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '0.8rem', transition: 'color 0.2s' }}
          onMouseOver={(e) => e.currentTarget.style.color = 'var(--accent-cyan)'}
          onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>
          Share {post.shares > 0 && <span style={{ marginLeft: '4px', fontWeight: 600 }}>{post.shares}</span>}
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
  
  // Custom Persona Form State
  const [newBotHandle, setNewBotHandle] = useState('');
  const [newBotColor, setNewBotColor] = useState('#10b981'); // Default green
  const [newBotPrompt, setNewBotPrompt] = useState('');

  // Node Inspector State
  const [selectedNode, setSelectedNode] = useState(null);

  // Physics Control State
  const [physicsRepulsion, setPhysicsRepulsion] = useState(400);
  const [physicsLinkDist, setPhysicsLinkDist] = useState(40);

  // Time Travel State
  const [timeScrub, setTimeScrub] = useState(100);

  const fgRef = useRef();
  
  // Derived Extrapolated State for Time Travel
  const timeFilteredPosts = useMemo(() => {
    if (timeScrub === 100 || posts.length === 0) return posts;
    
    const earliest = posts[posts.length - 1]?.timestamp || Date.now(); // posts are unshifted
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
    const latest = Date.now();
    const targetTime = earliest + (latest - earliest) * (timeScrub / 100);
    
    return nodes.filter(n => (n.spawnTime || earliest) <= targetTime);
  }, [nodes, posts, timeScrub]);

  const timeFilteredLinks = useMemo(() => {
    if (timeScrub === 100 || links.length === 0) return links;
    
    const earliest = posts[posts.length - 1]?.timestamp || Date.now();
    const latest = Date.now();
    const targetTime = earliest + (latest - earliest) * (timeScrub / 100);
    
    return links.filter(l => (l.spawnTime || earliest) <= targetTime);
  }, [links, posts, timeScrub]);

  // Track window size for responsive graph
  const [dimensions, setDimensions] = useState({
    width: 270,
    height: typeof window !== 'undefined' ? window.innerHeight - 150 : 500
  });

  useEffect(() => {
    const handleResize = () => {
      // Just a rough estimate for the side panel width
      setDimensions({
        width: window.innerWidth < 1200 ? window.innerWidth - 64 : 270,
        height: window.innerHeight - 150
      });
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    // Update D3 physics when sliders change or network grows
    if (fgRef.current) {
      fgRef.current.d3Force('charge').strength(-physicsRepulsion);
      
      // Affect link distance dynamically based on ideological clustering
      fgRef.current.d3Force('link').distance(link => {
        let baseDist = physicsLinkDist;
        if (link.sentiment === 'AGREE') baseDist *= 0.5; // Pull closer
        if (link.sentiment === 'DISAGREE') baseDist *= 2.0; // Push farther away
        return baseDist;
      });
      
      // Small reheat to smoothly transition new physics state
      fgRef.current.d3ReheatSimulation();
    }
  }, [physicsRepulsion, physicsLinkDist, nodes.length, links.length]);

  return (
    <div className="app-container">
      {/* Left Panel: Algorithm Controls */}
      <aside className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h1 className="text-gradient" style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>StanceBot</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', letterSpacing: '0.05em', textTransform: 'uppercase', fontWeight: 500 }}>
          Living Opinion Network
        </p>
        
        <div style={{ marginTop: '24px' }}>
          <h3 style={{ color: 'var(--text-primary)', fontSize: '1rem', marginBottom: '12px' }}>Network Controls</h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Outrage Multiplier</label>
              <span style={{ fontSize: '0.85rem', color: 'var(--accent-rose)' }}>{outrageMultiplier}%</span>
            </div>
            <input 
              type="range" 
              min="0" max="100" 
              value={outrageMultiplier} 
              onChange={e => setOutrageMultiplier(Number(e.target.value))}
              style={{ accentColor: 'var(--accent-rose)' }} 
            />
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Curiosity Multiplier</label>
              <span style={{ fontSize: '0.85rem', color: 'var(--accent-cyan)' }}>{curiosityMultiplier}%</span>
            </div>
            <input 
              type="range" 
              min="0" max="100" 
              value={curiosityMultiplier} 
              onChange={e => setCuriosityMultiplier(Number(e.target.value))}
              style={{ accentColor: 'var(--accent-cyan)' }} 
            />
          </div>
        </div>

        <div style={{ marginTop: '12px' }}>
          <h3 style={{ color: 'var(--text-primary)', fontSize: '1rem', marginBottom: '12px' }}>Physics Controls</h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Repulsion (Spaced out)</label>
              <span style={{ fontSize: '0.85rem', color: '#a78bfa' }}>{physicsRepulsion}</span>
            </div>
            <input 
              type="range" 
              min="50" max="1000" step="10"
              value={physicsRepulsion} 
              onChange={e => setPhysicsRepulsion(Number(e.target.value))}
              style={{ accentColor: '#a78bfa' }} 
            />
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Link Distance</label>
              <span style={{ fontSize: '0.85rem', color: '#60a5fa' }}>{physicsLinkDist}</span>
            </div>
            <input 
              type="range" 
              min="10" max="200" step="5"
              value={physicsLinkDist} 
              onChange={e => setPhysicsLinkDist(Number(e.target.value))}
              style={{ accentColor: '#60a5fa' }} 
            />
          </div>
        </div>
        
        <div style={{ marginTop: 'auto', paddingTop: '24px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
           
           <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
             <h4 style={{ fontSize: '0.9rem', marginBottom: '4px' }}>Inject Custom Persona</h4>
             <div style={{ display: 'flex', gap: '8px' }}>
                <input type="color" value={newBotColor} onChange={e => setNewBotColor(e.target.value)} style={{ width: '30px', height: '30px', padding: '0', border: 'none', borderRadius: '4px', cursor: 'pointer', background: 'transparent' }} />
                <input type="text" placeholder="@CryptoBro" value={newBotHandle} onChange={e => setNewBotHandle(e.target.value)} style={{ flex: 1, background: 'transparent', border: '1px solid var(--border)', borderRadius: '4px', color: 'white', padding: '4px 8px', fontSize: '0.8rem' }} />
             </div>
             <textarea 
               placeholder="System Prompt (e.g. You are obsessed with Web3...)" 
               value={newBotPrompt} 
               onChange={e => setNewBotPrompt(e.target.value)}
               rows={3}
               style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: '4px', color: 'white', padding: '6px 8px', fontSize: '0.8rem', resize: 'none', fontFamily: 'inherit' }}
             />
             <button 
               onClick={() => {
                 if (newBotHandle && newBotPrompt) {
                   createCustomBot(newBotHandle, newBotColor, newBotPrompt);
                   setNewBotHandle('');
                   setNewBotPrompt('');
                 }
               }}
               style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'white', borderRadius: '4px', padding: '6px', fontSize: '0.8rem', cursor: 'pointer', transition: 'background 0.2s', marginTop: '4px' }}
               onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
               onMouseOut={(e) => e.currentTarget.style.background = 'var(--surface-hover)'}
             >
               Deploy Bot
             </button>
           </div>
           
           <button 
             onClick={() => {
               if(confirm("Are you sure you want to wipe the simulation logic and start over?")) {
                 clearSimulation();
               }
             }}
             style={{
               background: 'transparent',
               border: '1px solid var(--accent-rose)',
               color: 'var(--accent-rose)',
               padding: '8px 16px',
               borderRadius: '6px',
               cursor: 'pointer',
               fontSize: '0.85rem',
               fontWeight: 600,
               transition: 'all 0.2s',
             }}
             onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(244, 63, 94, 0.1)' }}
             onMouseOut={(e) => { e.currentTarget.style.background = 'transparent' }}
           >
             Reset Network
           </button>
        </div>
      </aside>

      {/* Center Panel: The Feed */}
      <main className="glass-panel" style={{ padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', borderBottom: '1px solid var(--border)', paddingBottom: '12px', flexShrink: 0 }}>
          <h2 style={{ fontSize: '1.25rem', margin: 0 }}>Live Feed</h2>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Timeline</span>
            <input 
              type="range" 
              min="0" max="100" 
              value={timeScrub} 
              onChange={e => setTimeScrub(Number(e.target.value))}
              style={{ accentColor: 'var(--accent-cyan)', width: '120px' }} 
            />
            <span style={{ fontSize: '0.8rem', color: timeScrub < 100 ? 'var(--accent-rose)' : 'var(--text-secondary)', display: 'inline-block', width: '32px' }}>
               {timeScrub}%
            </span>
          </div>
        </div>
        
        {/* Human Composer */}
        <div style={{ marginBottom: '24px', display: 'flex', gap: '12px', opacity: timeScrub < 100 ? 0.3 : 1, pointerEvents: timeScrub < 100 ? 'none' : 'auto' }}>
          <input 
            type="text" 
            value={composerText}
            onChange={(e) => setComposerText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && composerText.trim()) {
                createHumanPost(composerText.trim());
                setComposerText('');
              }
            }}
            placeholder="Inject a thought into the network..." 
            style={{ 
              flex: 1, 
              background: 'rgba(0,0,0,0.2)', 
              border: '1px solid var(--border)', 
              padding: '12px 16px', 
              borderRadius: '8px', 
              color: 'var(--text-primary)',
              outline: 'none'
            }} 
          />
          <button 
            onClick={() => {
              if (composerText.trim()) {
                createHumanPost(composerText.trim());
                setComposerText('');
              }
            }}
            style={{ 
              background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-magenta))', 
              border: 'none', 
              borderRadius: '8px', 
              padding: '0 24px', 
              color: 'white', 
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Post
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', flexGrow: 1 }}>
          {timeFilteredPosts.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '24px' }}>
              {posts.length > 0 ? "No activity at this point in time..." : "Awaiting network activity..."}
            </div>
          ) : (
            timeFilteredPosts.map(post => (
              <ThreadedPost 
                key={post.id} 
                post={post} 
                likePost={likePost} 
                sharePost={sharePost} 
              />
            ))
          )}
        </div>
      </main>

      {/* Right Panel: The Graph / Topology */}
      <aside className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column' }}>
        <h3 style={{ fontSize: '1.1rem', marginBottom: '16px' }}>Network Topology</h3>
        <div className="glass" style={{ flex: 1, borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {typeof window !== 'undefined' && (
              <ForceGraph2D
                ref={fgRef}
                graphData={{ nodes: timeFilteredNodes, links: timeFilteredLinks }}
                width={dimensions.width}
                height={dimensions.height}
                nodeLabel="handle"
                nodeColor={node => node.color}
                nodeRelSize={6}
                linkColor={link => {
                  if (link.sentiment === 'AGREE') return 'rgba(16, 185, 129, 0.6)'; // Green
                  if (link.sentiment === 'DISAGREE') return 'rgba(244, 63, 94, 0.6)'; // Red
                  return 'rgba(255,255,255,0.2)';
                }}
                linkWidth={link => link.value * 0.5 + 1}
                backgroundColor="transparent"
                d3AlphaDecay={0.02}
                d3VelocityDecay={0.4}
                onNodeClick={node => setSelectedNode(node)}
              />
            )}
            
            {/* Node Inspector Overlay */}
            {selectedNode && (
              <div 
                style={{ 
                  position: 'absolute', 
                  top: '16px', 
                  left: '16px', 
                  right: '16px', 
                  width: 'auto', 
                  maxHeight: 'calc(100% - 32px)',
                  background: 'linear-gradient(145deg, rgba(20,20,30,0.95), rgba(10,10,15,0.95))', 
                  backdropFilter: 'blur(16px)', 
                  border: `1px solid ${selectedNode.color}40`, 
                  borderRadius: '16px', 
                  zIndex: 50, 
                  display: 'flex', 
                  flexDirection: 'column', 
                  boxShadow: `0 20px 40px rgba(0,0,0,0.6), 0 0 20px ${selectedNode.color}20`,
                  overflowY: 'auto',
                  animation: 'fadeIn 0.2s ease-out'
                }}
                className="custom-scrollbar"
              >
                {/* Header Strip */}
                <div style={{ height: '6px', background: selectedNode.color, width: '100%' }}></div>
                
                <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                       <h4 style={{ color: 'white', fontSize: '1.25rem', margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700 }}>
                        <div style={{ width: '14px', height: '14px', borderRadius: '50%', background: selectedNode.color, boxShadow: `0 0 10px ${selectedNode.color}` }}></div>
                        {selectedNode.handle}
                      </h4>
                      <span style={{ fontSize: '0.75rem', color: selectedNode.id === 'human_user' ? 'var(--accent-cyan)' : 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                        {selectedNode.id === 'human_user' ? 'Network Administrator' : 'AI Bot'}
                      </span>
                    </div>
                    
                    <button 
                      onClick={() => setSelectedNode(null)} 
                      style={{ 
                        background: 'rgba(255,255,255,0.1)', 
                        border: 'none', 
                        color: 'white', 
                        cursor: 'pointer', 
                        width: '28px', 
                        height: '28px', 
                        borderRadius: '50%', 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center',
                        transition: 'background 0.2s'
                      }}
                      onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
                      onMouseOut={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                    >
                      ✕
                    </button>
                  </div>
                  
                  <div style={{ display: 'flex', gap: '12px', background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                     <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Influence Score</span>
                      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'white' }}>{Math.round(selectedNode.val)}</div>
                     </div>
                     <div style={{ width: '1px', background: 'rgba(255,255,255,0.1)' }}></div>
                     <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Age</span>
                      <div style={{ fontSize: '1.1rem', fontWeight: 500, color: 'white', marginTop: 'auto', paddingBottom: '2px' }}>
                        {selectedNode.spawnTime ? Math.floor((Date.now() - selectedNode.spawnTime) / 60000) + 'm' : 'Ancient'}
                      </div>
                     </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                      System Prompt 
                      <span style={{ fontSize: '0.7rem', color: 'var(--accent-magenta)' }}>Mutating</span>
                    </span>
                    <div className="custom-scrollbar" style={{ 
                      fontSize: '0.85rem', 
                      color: 'var(--text-primary)', 
                      background: 'rgba(0,0,0,0.4)', 
                      padding: '12px', 
                      borderRadius: '8px', 
                      maxHeight: '200px', 
                      overflowY: 'auto',
                      borderLeft: `3px solid ${selectedNode.color}`,
                      lineHeight: '1.5'
                    }}>
                      {(() => {
                        if (selectedNode.id === 'human_user') return <i style={{ color: 'var(--text-secondary)' }}>No algorithmic constraints. Pure human chaos.</i>;
                        const bot = activeBots.find(b => b.id === selectedNode.id);
                        if (!bot) return <i>Bot properties not found.</i>;
                        return activePrompts[bot.role] || <i>No prompt assigned.</i>;
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  )
}

export default App

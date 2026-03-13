import React, { useRef, useEffect, useState, useMemo, useCallback, memo } from 'react'
import { useSimulation, groq } from './SimulationContext'
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

// ─── Task 7: ML-Enhanced Trending Topics (Dynamic LLM Clustering) ────────────
const useTrendingTopics = (posts, groqInstance) => {
  const [topics, setTopics] = useState([]);
  
  // Calculate raw topics from local heuristics
  const computedRawWords = useMemo(() => {
    if (!posts || posts.length === 0) return [];

    const STOP_WORDS = new Set([
      'the', 'is', 'at', 'which', 'on', 'and', 'a', 'to', 'in', 'of', 'it',
      'for', 'that', 'with', 'as', 'are', 'this', 'was', 'but', 'not', 'have',
      'from', 'they', 'we', 'you', 'i', 'an', 'be', 'by', 'or', 'what', 'so',
      'can', 'if', 'about', 'just', 'like', 'my', 'your', 'all', 'do', 'out',
      'up', 'how', 'when', 'there', 'who', 'why', 'their', 'has', 'would',
      'will', 'no', 'make', 'more', 'than', 'very', 'its', 'also',
      'need', 'some', 'these', 'them', 'been', 'had', 'were', 'said', 'each',
      'most', 'other', 'into', 'over', 'then', 'time', 'people', 'think',
      'know', 'really', 'only', 'even', 'those', 'such', 'much', 'should',
      'because', 'now', 'get', 'got', 'let', 'every', 'right', 'want',
      'going', 'actually', 'still', 'always', 'never', 'same', 'way', 'take',
      'youre', 'cant', 'dont', 'wont', 'isnt', 'arent', 'wasnt', 'werent',
      'hasnt', 'havent', 'hadnt', 'doesnt', 'didnt', 'wouldnt', 'shouldnt',
      'couldnt', 'mustnt', 'thats', 'theres', 'heres', 'whats', 'weve',
      'theyre', 'theyll', 'theyd', 'itll', 'itd', 'ive', 'youd', 'youll',
      'youve', 'hes', 'shes', 'shed', 'hed', 'hell', 'ill', 'lets', 'whos',
    ]);

    const now = Date.now();
    const ONE_HOUR = 3600 * 1000;

    const flattenAll = (arr) => arr.reduce((acc, p) => {
      const engagement = (p.likes || 0) + (p.shares || 0) + (p.replies?.length || 0);
      return [...acc, { ...p, engagement }, ...flattenAll(p.replies || [])];
    }, []);

    const allPosts = flattenAll(posts);

    const wordScores = {};
    const wordEngagement = {};

    allPosts.forEach(post => {
      if (!post.text) return;
      const ageHours = (now - post.timestamp) / ONE_HOUR;
      const recencyWeight = Math.max(0.3, 1 / (1 + ageHours * 0.1));
      const engagementBoost = 1 + Math.log1p(post.engagement || 0);

      const tokens = post.text
        .toLowerCase()
        .replace(/[''`]/g, '')
        .replace(/[.,/#!$%^&*;:{}=\-_~()"]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 3 && !STOP_WORDS.has(w) && /^[a-z]+$/.test(w));

      tokens.forEach(word => {
        const score = recencyWeight * engagementBoost;
        wordScores[word] = (wordScores[word] || 0) + score;
        wordEngagement[word] = (wordEngagement[word] || 0) + (post.engagement || 0);
      });

      for (let i = 0; i < tokens.length - 1; i++) {
        const bigram = `${tokens[i]} ${tokens[i + 1]}`;
        if (!STOP_WORDS.has(tokens[i]) && !STOP_WORDS.has(tokens[i + 1])) {
          const score = recencyWeight * engagementBoost * 1.5;
          wordScores[bigram] = (wordScores[bigram] || 0) + score;
          wordEngagement[bigram] = (wordEngagement[bigram] || 0) + (post.engagement || 0);
        }
      }
    });

    const topWords = Object.keys(wordScores)
      .map(word => ({ word, score: wordScores[word], interactions: wordEngagement[word] }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);

    return topWords;
  }, [posts]);

  useEffect(() => {
    if (computedRawWords.length === 0) return;

    // Fast-path visual render with fallback text
    setTopics(computedRawWords.slice(0, 5).map(tw => ({
      word: tw.word.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      interactions: tw.interactions,
      category: 'Analyzing...'
    })));

    // Asynchronously cluster with LLM API — re-run every 30 secs to save tokens
    let isMounted = true;
    import('./SimulationContext').then(({ clusterTopicsWithLLM }) => {
      clusterTopicsWithLLM(groqInstance, computedRawWords.map(tw => tw.word)).then(clusters => {
        if (!isMounted) return;
        const newTopics = clusters.map(topicName => {
          const matchedRawWord = computedRawWords.find(tw => topicName.toLowerCase().includes(tw.word.toLowerCase())) || computedRawWords[0];
          return {
            word: topicName,
            interactions: matchedRawWord?.interactions || 0,
            category: 'Dynamic Trend'
          };
        });
        setTopics(newTopics.slice(0, 5));
      });
    });

    return () => { isMounted = false; };
  }, [computedRawWords, groqInstance, Math.floor(Date.now() / 30000)]);

  return topics;
};

// ─── UI Utility: Keyword Highlighting ─────────────────────────────────────────
const HighlightText = memo(({ text, highlight }) => {
  if (!highlight || !highlight.trim()) {
    return <span>{text}</span>;
  }
  
  const regex = new RegExp(`(${highlight.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  
  return (
    <span>
      {parts.map((part, i) => 
        regex.test(part) ? (
          <mark key={i} style={{ backgroundColor: 'rgba(29, 155, 240, 0.4)', color: 'inherit', borderRadius: '3px', padding: '0 2px' }}>
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
});

// ─── SocialPost Component ─────────────────────────────────────────────────────
// showThreadLine: if true, draws the vertical thread line below the avatar
const SocialPost = memo(({ post, likePost, sharePost, searchQuery, showThreadLine = false, interactors }) => {
  const hasInteractors = interactors?.likes?.length > 0 || interactors?.shares?.length > 0;

  const formatActors = (actors) => {
    if (!actors || actors.length === 0) return '';
    if (actors.length === 1) return actors[0].handle;
    if (actors.length === 2) return `${actors[0].handle} and ${actors[1].handle}`;
    return `${actors[0].handle} and ${actors.length - 1} others`;
  };

  return (
    <div className="post-card animate-entrance">
      {/* Left Column: Avatar & Thread Line */}
      <div className="post-avatar-col">
        <div style={{ 
          width: '44px', 
          height: '44px', 
          borderRadius: '50%', 
          backgroundColor: post.author.color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#000',
          fontWeight: 800,
          fontSize: '1.1rem',
          flexShrink: 0,
          boxShadow: `inset 0 0 0 2px rgba(0,0,0,0.3)`
        }}>
          {post.author.handle.substring(1, 2).toUpperCase()}
        </div>
        {showThreadLine && <div className="thread-line"></div>}
      </div>

      {/* Right Column: Content */}
      <div className="post-content-col" style={{ paddingBottom: '8px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <span style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '1rem' }}>
            {post.author.id === 'human_user' ? 'Me' : post.author.handle.substring(1)}
          </span>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            {post.author.handle}
          </span>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>·</span>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            {getRelativeTime(post.timestamp)}
          </span>
        </div>

        {/* Text Area */}
        <p style={{ 
          color: 'var(--text-primary)', 
          fontSize: '1rem', 
          lineHeight: '1.5',
          marginBottom: '12px',
          whiteSpace: 'pre-wrap',
          wordWrap: 'break-word'
        }}>
          <HighlightText text={post.text} highlight={searchQuery} />
        </p>

        {/* Action Bar */}
        <div style={{ display: 'flex', gap: '36px', marginTop: '8px' }}>
          <button className="action-btn reply" onClick={(e) => { e.stopPropagation(); }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
            <span style={{ fontSize: '0.9rem', minWidth: '16px' }}>{post.replies ? post.replies.length : 0}</span>
          </button>

          <button className="action-btn share" onClick={(e) => { e.stopPropagation(); sharePost(post.id, post.author.id); }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 1l4 4-4 4"></path><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><path d="M7 23l-4-4 4-4"></path><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
            <span style={{ fontSize: '0.9rem', minWidth: '16px' }}>{post.shares > 0 ? post.shares : ''}</span>
          </button>

          <button className="action-btn like" onClick={(e) => { e.stopPropagation(); likePost(post.id, post.author.id); }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
            <span style={{ fontSize: '0.9rem', minWidth: '16px' }}>{post.likes > 0 ? post.likes : ''}</span>
          </button>
        </div>

        {/* ── Interaction Attribution: who liked / shared this post ── */}
        {hasInteractors && (
          <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {interactors?.likes?.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                {/* Mini avatar stack */}
                <div style={{ display: 'flex' }}>
                  {interactors.likes.slice(0, 3).map((actor, idx) => (
                    <div key={actor.id} title={actor.handle} style={{
                      width: '18px', height: '18px', borderRadius: '50%',
                      backgroundColor: actor.color,
                      border: '1.5px solid var(--bg-card)',
                      marginLeft: idx > 0 ? '-5px' : 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '0.55rem', fontWeight: 800, color: '#000',
                      position: 'relative', zIndex: 3 - idx,
                    }}>
                      {actor.handle.substring(1, 2).toUpperCase()}
                    </div>
                  ))}
                </div>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                  Liked by{' '}
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                    {formatActors(interactors.likes)}
                  </span>
                </span>
              </div>
            )}
            {interactors?.shares?.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 1l4 4-4 4"></path><path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
                  <path d="M7 23l-4-4 4-4"></path><path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
                </svg>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                  Reposted by{' '}
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                    {formatActors(interactors.shares)}
                  </span>
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

// ─── flattenReplies: converts nested reply tree → flat ordered array ──────────
// This enables Twitter/X-style threads: all replies at the same indentation,
// connected by a single continuous thread line (no deep cascading columns).
const flattenReplies = (replies) => {
  const result = [];
  for (const reply of replies) {
    result.push(reply);
    if (reply.replies?.length > 0) {
      result.push(...flattenReplies(reply.replies));
    }
  }
  return result;
};

// ─── ThreadBlock: parent post + flat threaded replies (Twitter/X style) ────────
const ThreadBlock = memo(({ post, likePost, sharePost, searchQuery, postInteractors }) => {
  const allReplies = useMemo(() => flattenReplies(post.replies || []), [post.replies]);

  return (
    <div className="post-container">
      <div className="threaded-replies-container">
        <SocialPost
          post={post}
          likePost={likePost}
          sharePost={sharePost}
          searchQuery={searchQuery}
          showThreadLine={allReplies.length > 0}
          interactors={postInteractors?.[post.id]}
        />
        {allReplies.map((reply, i) => (
          <SocialPost
            key={reply.id}
            post={reply}
            likePost={likePost}
            sharePost={sharePost}
            searchQuery={searchQuery}
            showThreadLine={i < allReplies.length - 1}
            interactors={postInteractors?.[reply.id]}
          />
        ))}
      </div>
    </div>
  );
});

// ─── Composer ─────────────────────────────────────────────────────────────────
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
        <div style={{ width: '44px', height: '44px', borderRadius: '50%', backgroundColor: '#fff', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '1.1rem' }}>
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
          style={{ fontSize: '1.2rem', padding: '4px 0', minHeight: '56px', fontWeight: 500 }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: '12px', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
          <button
            className="btn-primary"
            disabled={!text.trim()}
            onClick={handleSubmit}
            style={{ padding: '8px 22px', fontSize: '0.95rem', backgroundColor: 'var(--accent-cyan)', color: '#fff' }}
          >
            Post
          </button>
        </div>
      </div>
    </div>
  );
};


// ─── Main App ─────────────────────────────────────────────────────────────────
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
    clearSimulation,
    postInteractors,
  } = useSimulation();

  const [activeTab, setActiveTab] = useState('home');
  const [newBotHandle, setNewBotHandle] = useState('');
  const [newBotColor, setNewBotColor] = useState('#1d9bf0');
  const [newBotPrompt, setNewBotPrompt] = useState('');

  // Task 6: Search state
  const [searchQuery, setSearchQuery] = useState('');

  // Buffer Engine
  // Task 1: isInitialLoad ref prevents buffer swallowing the first Supabase data load
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

  const handleLikePost = useCallback((postId, authorId) => {
    contextLikePost(postId, authorId);
  }, [contextLikePost]);

  const handleSharePost = useCallback((postId, authorId) => {
    contextSharePost(postId, authorId);
  }, [contextSharePost]);

  const handleCreateHumanPost = useCallback((text) => {
    createHumanPost(text);
    popBuffer();
  }, [createHumanPost]); // eslint-disable-line react-hooks/exhaustive-deps

  // Task 6: Filter feed by search query
  const displayedPosts = useMemo(() => {
    if (!searchQuery.trim()) return feedPosts;
    const q = searchQuery.toLowerCase();
    return feedPosts.filter(post => {
      const inText = post.text?.toLowerCase().includes(q);
      const inHandle = post.author?.handle?.toLowerCase().includes(q);
      // Also search in replies
      const inReplies = post.replies?.some(r =>
        r.text?.toLowerCase().includes(q) || r.author?.handle?.toLowerCase().includes(q)
      );
      return inText || inHandle || inReplies;
    });
  }, [feedPosts, searchQuery]);

  const renderedFeedList = useMemo(() => {
    if (!displayedPosts || displayedPosts.length === 0) {
      return (
        <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '1rem' }}>
          {searchQuery ? `No posts match "${searchQuery}"` : 'Silence in the network. Ignite a conversation.'}
        </div>
      );
    }
    return displayedPosts.map(post => (
      <ThreadBlock 
        key={post.id} 
        post={post} 
        likePost={handleLikePost} 
        sharePost={handleSharePost} 
        searchQuery={searchQuery}
        postInteractors={postInteractors}
      />
    ));
  }, [displayedPosts, handleLikePost, handleSharePost, searchQuery, postInteractors]);


  return (
    <div className="app-wrapper">
      <div className="layout-container">
        
        {/* Left Navigation Sidebar */}
        <aside className="nav-sidebar">
          {/* Logo & Brand Name */}
          <div style={{ padding: '8px 8px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-primary)', flexShrink: 0 }}>
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
            </svg>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.03em' }}>StanceBot</h1>
          </div>

          {/* Task 5: nav buttons with uniform padding — active class applied via CSS */}
          <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '24px' }}>
            <button
              className={`nav-link ${activeTab === 'home' ? 'active' : ''}`}
              onClick={() => setActiveTab('home')}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill={activeTab === 'home' ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
              Home
            </button>
            <button
              className={`nav-link ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveTab('settings')}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill={activeTab === 'settings' ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              Settings
            </button>
          </nav>
          
          <button
            className="btn-primary"
            style={{ width: '90%', padding: '12px 0', fontSize: '1.05rem', backgroundColor: 'var(--accent-cyan)' }}
            onClick={() => { setActiveTab('home'); setTimeout(() => document.getElementById('composer-input')?.focus(), 100); }}
          >
            Post
          </button>
        </aside>

        {/* Center Feed Column */}
        <main className="main-feed" style={{ display: activeTab === 'home' ? 'flex' : 'none' }}>
          
          <header className="feed-header">
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800 }}>Home</h2>
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
                    padding: '8px 20px',
                    fontSize: '0.95rem',
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

            <div style={{ paddingBottom: '150px', height: '50vh' }}></div>
          </div>
        </main>

        {/* Settings Tab */}
        <main className="main-feed" style={{ display: activeTab === 'settings' ? 'flex' : 'none', borderRight: 'none' }}>
          <header className="feed-header">
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800 }}>System Settings</h2>
          </header>
          
          <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '560px', margin: '0 auto', width: '100%' }}>
            
            <section>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: '6px' }}>Network Algorithms</h3>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '20px', fontSize: '0.9rem' }}>Tune the deep learning modifiers shaping the flow of information across the network.</p>
              
              <div className="sidebar-card" style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <label style={{ fontSize: '1rem', fontWeight: 700 }}>Outrage Engine</label>
                  <span style={{ color: 'var(--accent-rose)', fontWeight: 800 }}>{outrageMultiplier}%</span>
                </div>
                <input type="range" min="0" max="100" value={outrageMultiplier} onChange={e => setOutrageMultiplier(Number(e.target.value))} style={{ accentColor: 'var(--accent-rose)' }} />
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginTop: '10px' }}>Increases the likelihood of aggressive, polarizing commentary.</p>
              </div>
              
              <div className="sidebar-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <label style={{ fontSize: '1rem', fontWeight: 700 }}>Curiosity Engine</label>
                  <span style={{ color: 'var(--accent-cyan)', fontWeight: 800 }}>{curiosityMultiplier}%</span>
                </div>
                <input type="range" min="0" max="100" value={curiosityMultiplier} onChange={e => setCuriosityMultiplier(Number(e.target.value))} style={{ accentColor: 'var(--accent-cyan)' }} />
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginTop: '10px' }}>Encourages analytical threads and deep-dive inquiries.</p>
              </div>
            </section>

            <section>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: '6px' }}>Deploy Agent</h3>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '20px', fontSize: '0.9rem' }}>Summon a new LLM-powered entity to the network.</p>
              <div className="sidebar-card">
                <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                  <input type="color" value={newBotColor} onChange={e => setNewBotColor(e.target.value)} style={{ width: '48px', height: '48px', padding: '0', border: 'none', borderRadius: '50%', cursor: 'pointer', background: 'transparent' }} />
                  <input type="text" placeholder="@handle" value={newBotHandle} onChange={e => setNewBotHandle(e.target.value)} style={{ flex: 1, padding: '12px 16px', border: '1px solid var(--border)', borderRadius: '12px', fontSize: '1rem' }} />
                </div>
                <textarea placeholder="Define the agent's core directives, political bias, and communication style..." value={newBotPrompt} onChange={e => setNewBotPrompt(e.target.value)} rows="4" style={{ width: '100%', padding: '16px', border: '1px solid var(--border)', borderRadius: '12px', marginBottom: '16px', fontSize: '1rem' }} />
                <button
                  className="btn-primary"
                  style={{ width: '100%', padding: '14px', fontSize: '1.05rem', backgroundColor: 'var(--text-primary)', color: 'var(--bg-dark)' }}
                  onClick={() => { if (newBotHandle && newBotPrompt) { createCustomBot(newBotHandle, newBotColor, newBotPrompt); setNewBotHandle(''); setNewBotPrompt(''); setActiveTab('home'); } }}
                >
                  Summon Node
                </button>
              </div>
            </section>

            <section style={{ borderTop: '1px solid var(--border)', paddingTop: '24px', paddingBottom: '80px' }}>
              <h3 style={{ fontSize: '1.2rem', color: 'var(--accent-rose)', fontWeight: 800, marginBottom: '12px' }}>Danger Zone</h3>
              <button
                onClick={() => confirm("Wipe the entire network and delete all cloud data?") && clearSimulation()}
                style={{ background: 'transparent', border: '1px solid var(--accent-rose)', color: 'var(--accent-rose)', padding: '14px 20px', borderRadius: '12px', cursor: 'pointer', fontSize: '1rem', fontWeight: 700, width: '100%' }}
              >
                Reset Network Data
              </button>
            </section>
          </div>
        </main>

        {/* Right Sidebar: Trends & Search */}
        <aside className="right-sidebar" style={{ display: activeTab === 'settings' ? 'none' : '' }}>
          
          {/* Task 6: Search Box — wired to searchQuery state */}
          <div className="search-box">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input
              type="text"
              placeholder="Search posts..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ fontSize: '0.95rem', padding: '0', background: 'transparent' }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '0', fontSize: '1rem', lineHeight: 1 }}
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          {/* Task 3 & 7: Trending Topics with real counts and ML categories */}
          <div className="sidebar-card" style={{ padding: '20px' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '20px', fontWeight: 800 }}>Trends for you</h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {trendingTopics.length === 0 ? (
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Awaiting network signals...</span>
              ) : (
                trendingTopics.map((topic, index) => (
                  <div
                    key={topic.word}
                    style={{ display: 'flex', flexDirection: 'column', gap: '3px', cursor: 'pointer' }}
                    onClick={() => setSearchQuery(topic.word.toLowerCase().split(' ')[0])}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>{index + 1} · {topic.category}</span>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>
                    </div>
                    <span style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)' }}>{topic.word}</span>
                    {/* Task 3: Real interaction count — no more fake multiplier */}
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
                      {topic.interactions > 0
                        ? `${topic.interactions} interaction${topic.interactions !== 1 ? 's' : ''}`
                        : 'Emerging topic'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
          
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '0 4px' }}>
            {['Terms of Service', 'Privacy Policy', 'Cookie Policy', 'Accessibility', 'Ads info', 'More ...', '© 2024 StanceBot'].map(link => (
              <span key={link} style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', cursor: 'pointer' }}>{link}</span>
            ))}
          </div>
        </aside>

        {/* Mobile Navigation (Bottom) */}
        <nav className="mobile-nav">
          <button className="action-btn" onClick={() => setActiveTab('home')} style={{ color: activeTab === 'home' ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill={activeTab === 'home' ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
          </button>
          
          <button className="action-btn" onClick={() => { setActiveTab('home'); setTimeout(() => document.getElementById('composer-input')?.focus(), 100); }} style={{ color: 'var(--text-primary)' }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>
          </button>

          <button className="action-btn" onClick={() => setActiveTab('settings')} style={{ color: activeTab === 'settings' ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill={activeTab === 'settings' ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          </button>
        </nav>

      </div>
    </div>
  )
}

export default App

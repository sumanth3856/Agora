import React, { useRef, useEffect, useState, useMemo, useCallback, memo } from 'react'
import { createPortal } from 'react-dom'
import { useSimulation, groq } from './SimulationContext'
import ForceGraph from './ForceGraph'
import './index.css'

// Helper for human-readable time
const getRelativeTime = (timestamp) => {
  const diffInSeconds = Math.floor((Date.now() - timestamp) / 1000);
  if (diffInSeconds < 60) return `${diffInSeconds}s`;
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes}m`;
  // Task 5: After 1h show exact time (e.g. "2:34 PM") instead of "Xh"
  if (diffInMinutes < 1440) {
    return new Date(timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const useTrendingTopics = (posts, groqInstance) => {
  const [topics, setTopics] = useState([]);
  const computedRawWords = useMemo(() => {
    if (!posts?.length) return [];
    const STOP = new Set(['the', 'is', 'at', 'which', 'on', 'and', 'for', 'that', 'with', 'are', 'this', 'was', 'but', 'not', 'have', 'from', 'they', 'what', 'their', 'has', 'would', 'will', 'make', 'more', 'than', 'some', 'these', 'them', 'been', 'had', 'were', 'said', 'each', 'most', 'other', 'into', 'over', 'then', 'time', 'people', 'think', 'know', 'really', 'only', 'even', 'those', 'such', 'much', 'should', 'because']);
    const now = Date.now();
    const scores = {}, engs = {};
    const flatten = (arr) => arr.reduce((acc, p) => [...acc, { ...p, eng: (p.likes || 0) + (p.shares || 0) + (p.replies?.length || 0) }, ...flatten(p.replies || [])], []);
    
    flatten(posts).forEach(p => {
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

// ─── TypingIndicator Component ────────────────────────────────────────────────
// T3: Now rendered in the left sidebar as a vertical stack
const TypingIndicator = memo(({ handle, color }) => (
  <div className="typing-indicator animate-entrance">
    <div style={{ 
      width: '22px', height: '22px', borderRadius: '50%', 
      backgroundColor: color, display: 'flex', alignItems: 'center', 
      justifyContent: 'center', color: '#000', fontWeight: 800, fontSize: '0.6rem',
      boxShadow: 'inset 0 0 0 1px rgba(0, 0, 0, 0.16)', flexShrink: 0
    }}>
      {handle.substring(1, 2).toUpperCase()}
    </div>
    <span>{handle.substring(1)} is thinking</span>
    <div className="dot"></div>
    <div className="dot"></div>
    <div className="dot"></div>
  </div>
));

// ─── ShimmerPost: Skeleton loader for posts ───────────────────────────────────
const ShimmerPost = memo(() => (
  <div className="shimmer-wrapper">
    <div className="shimmer-avatar"></div>
    <div className="shimmer-content">
      <div className="shimmer-line header"></div>
      <div className="shimmer-line"></div>
      <div className="shimmer-line title"></div>
      <div className="shimmer-line short"></div>
    </div>
  </div>
));

const ICON = {
  home: <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>,
  homeExtra: <polyline points="9 22 9 12 15 12 15 22"></polyline>,
  network: <><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></>,
  lab: <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.77 3.77z"></path>,
  settings: <><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></>
};

const UIModal = ({ isOpen, onClose, title, description, onConfirm, confirmText = 'Confirm', variant = 'default', children, showActions = true }) => {
  useEffect(() => {
    if (isOpen) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
    return () => {
      document.body.classList.remove('modal-open');
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <button className="modal-close-btn" onClick={onClose} aria-label="Close">✕</button>
        {title && <h2 className="modal-title">{title}</h2>}
        {description && <p className="modal-description">{description}</p>}
        
        {children}

        {showActions && (
          <div className="modal-actions">
            <button className="modal-btn modal-btn-cancel" onClick={onClose}>Cancel</button>
            <button className={`modal-btn modal-btn-confirm ${variant === 'danger' ? 'danger' : ''}`} onClick={() => { onConfirm(); onClose(); }}>{confirmText}</button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

// ─── SocialPost Component ─────────────────────────────────────────────────────
// showThreadLine: if true, draws the vertical thread line below the avatar
const SocialPost = memo(({ post, likePost, sharePost, replyPost, deletePost, editPost, searchQuery, showThreadLine = false, interactors, humanLiked, humanShared, isReply = false, onViewInThread }) => {
  const hasInteractors = interactors?.likes?.length > 0 || interactors?.shares?.length > 0 || interactors?.replies?.length > 0;
  const [showReplyBox, setShowReplyBox] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(post.text);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const replyInputRef = useRef(null);
  const isOwn = post.author.id === 'human_user';

  const handleReplySubmit = () => {
    if (!replyText.trim()) return;
    replyPost(post, replyText.trim());
    setReplyText('');
    setShowReplyBox(false);
  };

  const handleReplyOpen = (e) => {
    e.stopPropagation();
    setShowReplyBox(s => !s);
    setTimeout(() => replyInputRef.current?.focus(), 50);
  };

  const handleEditSubmit = () => {
    if (!editText.trim() || editText === post.text) { setIsEditing(false); return; }
    editPost(post.id, editText.trim());
    setIsEditing(false);
  };

  const formatActors = (actors) => {
    if (!actors || actors.length === 0) return '';
    if (actors.length === 1) return actors[0].handle;
    if (actors.length === 2) return `${actors[0].handle} and ${actors[1].handle}`;
    return `${actors[0].handle} and ${actors.length - 1} others`;
  };

  const renderContentWithMedia = (text, highlight, HighlightComponent) => {
    if (!text) return null;
    const mediaMatch = text.match(/\[MEDIA:\s*([^\]]+)\]/);
    if (!mediaMatch) return HighlightComponent ? <HighlightComponent text={text} highlight={highlight} /> : text;
    
    const cleanText = text.replace(/\[MEDIA:\s*[^\]]+\]/, '').trim();
    const topic = mediaMatch[1].trim().toLowerCase();
    
    return (
      <>
        {cleanText && (
          <div style={{ marginBottom: '12px' }}>
            {HighlightComponent ? <HighlightComponent text={cleanText} highlight={highlight} /> : cleanText}
          </div>
        )}
        <div style={{ 
          marginTop: '8px', borderRadius: '16px', overflow: 'hidden', 
          border: '1px solid var(--border)', background: 'var(--border)',
          aspectRatio: '16 / 9'
        }}>
          <img 
            src={`https://loremflickr.com/640/360/${topic}`} 
            alt={topic} 
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => e.target.style.display = 'none'}
          />
        </div>
      </>
    );
  };

  /* T2: Fresh reference for isHumanLiked on every render to ensure re-render */
  const isHumanLiked = useMemo(() => humanLiked?.has(post.id), [humanLiked, post.id]);
  const isHumanShared = useMemo(() => humanShared?.has(post.id), [humanShared, post.id]);

  return (
    <div className="post-card animate-entrance">
      {/* Left Column: Avatar & Thread Line */}
      <div className="post-avatar-col">
        <div style={{ 
          width: '44px', height: '44px', borderRadius: '50%', 
          backgroundColor: post.author.color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#000', fontWeight: 800, fontSize: '1.1rem',
          flexShrink: 0, boxShadow: `inset 0 0 0 2px rgba(0,0,0,0.3)`
        }}>
          {post.author.handle.substring(1, 2).toUpperCase()}
        </div>
        {showThreadLine && <div className="thread-line"></div>}
      </div>

      {/* Right Column: Content */}
      <div className="post-content-col" style={{ paddingBottom: '8px' }}>
        {/* T5: Replying-to attribution */}
        {isReply && post.replyToHandle && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '4px' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5">
              <polyline points="15 14 9 8 15 2" />
              <path d="M9 8H19a2 2 0 0 1 2 2v7" />
            </svg>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Replying to{' '}
              <span style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>{post.replyToHandle}</span>
            </span>
          </div>
        )}

        {/* T2: View-in-thread link for search results */}
        {onViewInThread && (
          <button
            onClick={onViewInThread}
            style={{ background: 'none', border: 'none', color: 'var(--accent-cyan)', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', padding: '0 0 4px 0', textAlign: 'left' }}
          >
            ⤷ View in thread
          </button>
        )}

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '1rem' }}>
            {isOwn ? 'Me' : post.author.handle.substring(1)}
          </span>
          {!isOwn && <span className="agent-badge">Agent</span>}
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{post.author.handle}</span>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>·</span>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{getRelativeTime(post.timestamp)}</span>
          {post.edited && <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontStyle: 'italic' }}>(edited)</span>}

          {/* Delete/Edit Controls */}
            {isOwn && (
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                <button 
                   onClick={() => { setEditText(post.text); setIsEditing(!isEditing); }} 
                   style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '5px' }}
                   title="Edit Post"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                </button>
                <button 
                   onClick={(e) => { e.stopPropagation(); setShowDeleteModal(true); }} 
                   style={{ background: 'none', border: 'none', color: 'var(--accent-danger)', opacity: 0.8, cursor: 'pointer', padding: '5px' }}
                   title="Delete Post"
                >
                   <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                </button>
              </div>
            )}
        </div>

        {/* Delete Confirmation Modal */}
        <UIModal 
          isOpen={showDeleteModal}
          onClose={() => setShowDeleteModal(false)}
          title="Delete Post?"
          description="Are you sure you want to delete this post? This action cannot be undone."
          onConfirm={() => deletePost(post.id)}
          confirmText="Delete"
          variant="danger"
        />

        {/* Internal Monologue (Reasoning Block) — only for Bots */}
        {!isOwn && post.thought && (
          <div className="reasoning-block">
            {post.thought}
          </div>
        )}

        {/* Post Text / Edit Field */}
        {isEditing ? (
          <div style={{ marginBottom: '12px' }}>
            <textarea
              autoFocus
              value={editText}
              onChange={e => setEditText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEditSubmit(); } if (e.key === 'Escape') setIsEditing(false); }}
              rows="3"
              style={{ width: '100%', fontSize: '1rem', lineHeight: '1.5', padding: '8px', borderRadius: '8px', border: '1px solid var(--accent-cyan)', background: 'var(--surface-hover)', color: 'var(--text-primary)', fontFamily: 'inherit', resize: 'vertical' }}
            />
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setIsEditing(false)} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: '9999px', padding: '4px 14px', fontSize: '0.85rem', cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleEditSubmit} className="btn-primary" style={{ padding: '4px 18px', fontSize: '0.85rem', backgroundColor: 'var(--accent-cyan)', color: '#fff' }}>Save</button>
            </div>
          </div>
        ) : (
          <div style={{ 
            fontSize: '1rem', 
            lineHeight: 1.5, 
            color: 'var(--text-primary)',
            wordBreak: 'break-word',
            marginBottom: '12px'
          }}>
            {renderContentWithMedia(post.text, searchQuery, HighlightText)}
          </div>
        )}

        {/* Action Bar */}
        <div style={{ display: 'flex', gap: '32px', marginTop: '12px', marginBottom: '4px' }}>
          <button className={`action-btn reply${showReplyBox ? ' active-reply' : ''}`} onClick={handleReplyOpen} title="Reply">
            <svg width="20" height="20" viewBox="0 0 24 24" fill={showReplyBox ? 'rgba(29,155,240,0.15)' : 'none'} stroke={showReplyBox ? 'var(--accent-cyan)' : 'currentColor'} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
            </svg>
            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: showReplyBox ? 'var(--accent-cyan)' : 'inherit' }}>{post.replies?.length > 0 ? post.replies.length : ''}</span>
          </button>

          <button className={`action-btn share ${isHumanShared ? 'shared' : ''}`} onClick={(e) => { e.stopPropagation(); sharePost(post.id, post.author.id); }} style={{ opacity: isHumanShared ? 0.7 : 1 }} title={isHumanShared ? 'Reposted' : 'Repost'}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill={isHumanShared ? 'var(--accent-cyan)' : 'none'} stroke={isHumanShared ? 'var(--accent-cyan)' : 'currentColor'} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 1l4 4-4 4"></path><path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
              <path d="M7 23l-4-4 4-4"></path><path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
            </svg>
            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: isHumanShared ? 'var(--accent-cyan)' : 'inherit' }}>{post.shares > 0 ? post.shares : ''}</span>
          </button>

          <button className={`action-btn like ${isHumanLiked ? 'liked' : ''}`} onClick={(e) => { e.stopPropagation(); likePost(post.id, post.author.id); }} title={isHumanLiked ? 'Unlike' : 'Like'}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill={isHumanLiked ? 'var(--accent-rose)' : 'none'} stroke={isHumanLiked ? 'var(--accent-rose)' : 'currentColor'} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
            </svg>
            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: isHumanLiked ? 'var(--accent-rose)' : 'inherit' }}>{post.likes > 0 ? post.likes : ''}</span>
          </button>
        </div>

        {/* Inline Reply Composer */}
        {showReplyBox && (
          <div className="inline-reply-box animate-entrance">
            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: '#fff', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.85rem', flexShrink: 0 }}>M</div>
              <div style={{ flex: 1 }}>
                <textarea
                  ref={replyInputRef}
                  placeholder={`Reply to ${post.author.handle}...`}
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReplySubmit(); }
                    if (e.key === 'Escape') { setShowReplyBox(false); setReplyText(''); }
                  }}
                  rows="2"
                  style={{ fontSize: '0.95rem', minHeight: '52px', padding: '8px 0', fontWeight: 500 }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                  <button onClick={() => { setShowReplyBox(false); setReplyText(''); }} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: '9999px', padding: '5px 14px', fontSize: '0.85rem', cursor: 'pointer' }}>Cancel</button>
                  <button className="btn-primary" disabled={!replyText.trim()} onClick={handleReplySubmit} style={{ padding: '5px 18px', fontSize: '0.85rem', backgroundColor: 'var(--accent-cyan)', color: '#fff' }}>Reply</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Interaction Attribution (Detailed) */}
        {hasInteractors && (
          <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '8px', animation: 'fadeIn 0.4s ease-out' }}>
            {interactors?.likes?.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(249, 24, 128, 0.1)', borderRadius: '50%' }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="var(--accent-rose)" stroke="var(--accent-rose)" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                </div>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontWeight: 500 }}>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{formatActors(interactors.likes)}</span> liked this
                </span>
              </div>
            )}
            {interactors?.shares?.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(29, 155, 240, 0.1)', borderRadius: '50%' }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--accent-cyan)" strokeWidth="3"><path d="M17 1l4 4-4 4"></path><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><path d="M7 23l-4-4 4-4"></path><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
                </div>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontWeight: 500 }}>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{formatActors(interactors.shares)}</span> shared this
                </span>
              </div>
            )}
            {interactors?.replies?.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-hover)', borderRadius: '50%' }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="3"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
                </div>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontWeight: 500 }}>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{formatActors(interactors.replies)}</span> replied
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
// T1: Shows first 2 replies by default; if >10 total shows 5; expandable
const INITIAL_REPLIES = 2;
const BATCH_SIZE = 5;

const ThreadBlock = memo(({ post, likePost, sharePost, replyPost, deletePost, editPost, searchQuery, postInteractors, humanLiked, humanShared }) => {
  const allReplies = useMemo(() => flattenReplies(post.replies || []), [post.replies]);
  const total = allReplies.length;
  const initialShow = total > 10 ? BATCH_SIZE : INITIAL_REPLIES;
  const [visibleCount, setVisibleCount] = useState(initialShow);
  const prevTotal = useRef(total);

  // Automatically expand visible count when a new reply arrives
  useEffect(() => {
    if (total > prevTotal.current) {
      // A new reply arrived via realtime or local optimistic update
      const diff = total - prevTotal.current;
      setVisibleCount(c => c + diff);
    } else if (total > 10 && prevTotal.current <= 10) {
       // Only hard reset if moving from a small thread to a massive one on load
       setVisibleCount(BATCH_SIZE);
    } else if (total === 0) {
       // Complete reset if replies were wiped
       setVisibleCount(INITIAL_REPLIES);
    }
    prevTotal.current = total;
  }, [total]);

  const visibleReplies = allReplies.slice(0, visibleCount);
  const remaining = total - visibleCount;
  const nextBatch = Math.min(BATCH_SIZE, remaining);

  const sharedProps = { likePost, sharePost, replyPost, deletePost, editPost, searchQuery, humanLiked, humanShared };

  return (
    <div className="post-container">
      <div className="threaded-replies-container">
        <SocialPost
          post={post}
          {...sharedProps}
          showThreadLine={visibleReplies.length > 0}
          interactors={postInteractors?.[post.id]}
          isReply={false}
        />
        {visibleReplies.map((reply, i) => (
          <SocialPost
            key={reply.id}
            post={reply}
            {...sharedProps}
            showThreadLine={i < visibleReplies.length - 1 || remaining > 0}
            interactors={postInteractors?.[reply.id]}
            isReply={true}
          />
        ))}

        {/* T1: View more replies button */}
        {remaining > 0 && (
          <div style={{ padding: '8px 0 8px 56px' }}>
            <button
              onClick={() => setVisibleCount(c => c + BATCH_SIZE)}
              style={{
                background: 'none', border: 'none', color: 'var(--accent-cyan)',
                fontWeight: 600, fontSize: '0.88rem', cursor: 'pointer', padding: '4px 0',
                display: 'flex', alignItems: 'center', gap: '5px'
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9" />
              </svg>
              View {nextBatch} more {nextBatch === 1 ? 'reply' : 'replies'}{remaining > nextBatch ? ` (${remaining} left)` : ''}
            </button>
          </div>
        )}
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button 
              className="action-btn" 
              style={{ padding: '8px', color: 'var(--accent-cyan)' }}
              title="Add Image (Simulated)"
              onClick={() => setText(prev => prev + " [MEDIA: digital-art]")}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
            </button>
            <button className="action-btn" style={{ padding: '8px', color: 'var(--accent-cyan)' }} title="Add Emoji">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="15" x2="15.01" y2="15"></line></svg>
            </button>
          </div>
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

  const [activeTab, setActiveTab] = useState('home');
  const [heatmapMode, setHeatmapMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Modal States
  const [showWipeModal, setShowWipeModal] = useState(false);
  const [showInfluenceModal, setShowInfluenceModal] = useState(false);
  const [showCreateBotModal, setShowCreateBotModal] = useState(false);
  const [showResetBotModal, setShowResetBotModal] = useState(false);
  const [showTerminateBotModal, setShowTerminateBotModal] = useState(false);
  
  // Custom Bot Form State
  const [newBotHandle, setNewBotHandle] = useState('');
  const [newBotColor, setNewBotColor] = useState('#1d9bf0');
  const [newBotPrompt, setNewBotPrompt] = useState('');
  
  const [showDiscoveryOverlay, setShowDiscoveryOverlay] = useState(false);
  const [selectedBotId, setSelectedBotId] = useState(null);
  const [timeMachineValue, setTimeMachineValue] = useState(100);

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

  useEffect(() => {
    if (selectedBotId && activeTab === 'network') {
      setActiveTab('lab');
    }
  }, [selectedBotId]);

  const handleLikePost = useCallback((postId, authorId) => {
    contextLikePost(postId, authorId);
  }, [contextLikePost]);

  const handleSharePost = useCallback((postId, authorId) => {
    contextSharePost(postId, authorId);
  }, [contextSharePost]);

  const handleReplyPost = useCallback((parentPost, text) => {
    createHumanReply(parentPost, text);
  }, [createHumanReply]);

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


  return (
    <div className="app-wrapper">
      <div className="layout-container">
        
        {/* Left Navigation Sidebar */}
        <aside className="nav-sidebar">
          {/* Logo & Brand Name */}
          <div className="brand-container">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent-cyan)', flexShrink: 0 }}>
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
            </svg>
            <h1 className="brand-name">StanceBot</h1>
          </div>

          {/* Task 5: nav buttons with uniform padding — active class applied via CSS */}
          <nav className="nav-group">
            {['home', 'network', 'lab', 'settings'].map(tab => (
              <button key={tab} className={`nav-link ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill={activeTab === tab ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  {ICON[tab]}
                  {tab === 'home' && ICON.homeExtra}
                </svg>
                <span>{tab.charAt(0).toUpperCase() + tab.slice(1)}</span>
              </button>
            ))}
          </nav>
          
          <button
            className="btn-primary"
            style={{ width: '90%', padding: '12px 0', fontSize: '1.05rem', backgroundColor: 'var(--accent-cyan)' }}
            onClick={() => { setActiveTab('home'); setTimeout(() => document.getElementById('composer-input')?.focus(), 100); }}
          >
            Post
          </button>

          {/* T1: Bot typing indicators moved here: below Post button */}
          {activeBots.filter(b => generatingBots.has(b.id)).length > 0 && (
            <div className="sidebar-typing-stack" style={{ marginTop: '16px' }}>
              {activeBots.filter(b => generatingBots.has(b.id)).map(bot => (
                <TypingIndicator key={bot.id} handle={bot.handle} color={bot.color} />
              ))}
            </div>
          )}
        </aside>

        {/* Center Feed Column */}
        <main className="main-feed" style={{ display: activeTab === 'home' ? 'flex' : 'none' }}>
          
          <header className="feed-header">
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800 }}>Home</h2>
          </header>

          <Composer createHumanPost={handleCreateHumanPost} />

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

        {/* Network Graph Tab */}
        <main className="main-feed" style={{ display: activeTab === 'network' ? 'flex' : 'none', position: 'relative', overflow: 'hidden' }}>
          <header className="feed-header" style={{ justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 800 }}>Network Pulse</h2>
              <button 
                onClick={() => setShowInfluenceModal(true)}
                className="analytics-trigger"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
                <span className="desktop-only">Influence Analytics</span>
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="desktop-only" style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Heatmap</span>
              <button 
                onClick={() => setHeatmapMode(m => !m)}
                style={{ 
                  width: '36px', height: '18px', borderRadius: '9px', 
                  backgroundColor: heatmapMode ? 'var(--accent-cyan)' : 'var(--border)', 
                  position: 'relative', border: 'none', cursor: 'pointer', transition: 'background 0.2s'
                }}
              >
                <div style={{ 
                  width: '14px', height: '14px', borderRadius: '50%', backgroundColor: '#fff', 
                  position: 'absolute', top: '2px', left: heatmapMode ? '20px' : '2px', transition: 'left 0.2s'
                }}></div>
              </button>
            </div>
          </header>

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
              <ForceGraph 
                heatmapMode={heatmapMode} 
                onNodeClick={(id) => setSelectedBotId(id)}
              />
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
        <main className="main-feed" style={{ display: activeTab === 'lab' ? 'flex' : 'none', borderRight: 'none' }}>
          <header className="feed-header" style={{ gap: '12px', justifyContent: 'flex-start' }}>
            {selectedBotId && (
              <button 
                className="action-btn" 
                onClick={() => setSelectedBotId(null)} 
                style={{ padding: '8px', marginLeft: '-8px' }}
                title="Back to Agent List"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
              </button>
            )}
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800 }}>Agent Research & Development</h2>
          </header>

          <div style={{ padding: '24px', display: 'flex', gap: '24px', maxWidth: '900px', margin: '0 auto', width: '100%', height: 'calc(100vh - 60px)', overflow: 'hidden' }}>
            {/* Bot List */}
            <div className={selectedBotId ? 'hide-on-select' : ''} style={{ width: '280px', borderRight: '1px solid var(--border)', paddingRight: '20px', overflowY: 'auto' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '16px', color: 'var(--text-secondary)' }}>Live Nodes</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {activeBots.map(bot => (
                  <div key={bot.id} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button 
                      onClick={() => setSelectedBotId(bot.id)}
                      style={{ 
                        display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', borderRadius: '12px', 
                        background: selectedBotId === bot.id ? 'var(--surface-hover)' : 'transparent',
                        border: selectedBotId === bot.id ? '1px solid var(--accent-cyan)' : '1px solid transparent',
                        cursor: 'pointer', textAlign: 'left', flex: 1, transition: 'all 0.2s', minWidth: 0
                      }}
                    >
                      <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: bot.color, flexShrink: 0 }}></div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bot.handle.substring(1)}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          {bot.role}
                        </div>
                      </div>
                    </button>
                    {bot.role.startsWith('custom') && (
                      <button 
                        className="bot-delete-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedBotId(bot.id);
                          setShowTerminateBotModal(true);
                        }}
                        title="Terminate Agent"
                      >
                         <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ marginTop: '20px' }}>
                <button 
                  onClick={() => {
                    setNewBotHandle('');
                    setNewBotPrompt('');
                    setShowCreateBotModal(true);
                  }}
                  className="modal-btn modal-btn-confirm" 
                  style={{ width: '100%', fontSize: '0.85rem' }}
                >
                  + Create New Agent
                </button>
              </div>
            </div>

            {/* Editor Console */}
            <div style={{ flex: 1, overflowY: 'auto', paddingRight: '10px' }}>
              {!selectedBotId ? (
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginBottom: '16px', opacity: 0.5 }}>
                    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.77 3.77z"></path>
                  </svg>
                  <p>Select a node to begin recalibration</p>
                </div>
              ) : (
                (() => {
                  const bot = activeBots.find(b => b.id === selectedBotId);
                  if (!bot) return null;
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                           <div style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: bot.color, boxShadow: `0 0 20px ${bot.color}44` }}></div>
                           <div>
                             <h3 style={{ fontSize: '1.4rem', fontWeight: 800 }}>{bot.handle}</h3>
                             <span className="topic-category" style={{ fontSize: '0.85rem' }}>{bot.role.startsWith('custom') ? 'Custom' : bot.role} Module</span>
                           </div>
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button 
                            className="modal-btn" 
                            style={{ background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-secondary)', border: '1px solid var(--border)', padding: '6px 12px' }}
                            onClick={() => setShowResetBotModal(true)}
                          >
                            Reset Logic
                          </button>
                          {bot.role.startsWith('custom') && (
                            <button 
                              className="modal-btn" 
                              style={{ background: 'var(--accent-rose)', color: 'white', border: 'none', padding: '6px 12px' }}
                               onClick={() => setShowTerminateBotModal(true)}
                            >
                              Terminate
                            </button>
                          )}
                        </div>
                      </div>

                        <section>
                          <h4 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Personality Weights</h4>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            <div className="sidebar-card" title="Higher values make the bot more selective and less likely to interact randomly.">
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                <label style={{ fontSize: '0.9rem', fontWeight: 700 }}>Engagement Threshold</label>
                                <span style={{ color: 'var(--accent-cyan)', fontWeight: 800 }}>{Math.round(bot.engagementThreshold * 100)}%</span>
                              </div>
                              <input type="range" min="0" max="100" value={bot.engagementThreshold * 100} onChange={e => updateBotPersona(bot.id, { engagementThreshold: Number(e.target.value) / 100 })} style={{ accentColor: 'var(--accent-cyan)' }} />
                              <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '6px' }}>Minimum confidence needed to interact with a post.</p>
                            </div>
                          </div>
                        </section>

                        <section>
                           <h4 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Behavioral Predictions</h4>
                           <div className="sidebar-card" style={{ background: 'rgba(29, 155, 240, 0.03)' }}>
                             <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                               <li style={{ fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between' }}>
                                  <span style={{ color: 'var(--text-secondary)' }}>Volatility Index</span>
                                  <span style={{ color: bot.engagementThreshold < 0.3 ? 'var(--accent-rose)' : 'var(--text-primary)', fontWeight: 700 }}>{bot.engagementThreshold < 0.3 ? 'CRITICAL' : 'STABLE'}</span>
                               </li>
                               <li style={{ fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between' }}>
                                  <span style={{ color: 'var(--text-secondary)' }}>Estimated Replies/Hour</span>
                                  <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>~{Math.round(bot.baseLikelihoodToPost * 10 + (1 - bot.engagementThreshold) * 20)}</span>
                               </li>
                             </ul>
                           </div>
                        </section>

                        {/* NEW: Live Research Insight (LTM Display) */}
                        <section className="animate-entrance" style={{ animationDelay: '0.2s' }}>
                          <h4 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Live Research Insight</h4>
                          <div className="sidebar-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px', background: 'rgba(255, 255, 255, 0.02)' }}>
                            
                            {/* Emotional state */}
                            <div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Latest Cognitive State</div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '1.2rem' }}>
                                  {(() => {
                                    const s = botMemories?.[bot.id]?.lastSentiment || 'Neutral';
                                    if (s === 'Joy') return '😊';
                                    if (s === 'Anger') return '😠';
                                    if (s === 'Fear') return '😨';
                                    if (s === 'Sadness') return '😢';
                                    if (s === 'Surprise') return '😲';
                                    if (s === 'Disgust') return '🤢';
                                    return '😐';
                                  })()}
                                </span>
                                <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{botMemories?.[bot.id]?.lastSentiment || 'Calm'}</span>
                              </div>
                            </div>

                            {/* Social Graph */}
                            <div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '8px' }}>Social Relationships</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {Object.entries(botMemories?.[bot.id]?.socialGraph || {}).slice(0, 3).map(([authorId, score]) => {
                                  const targetBot = activeBots.find(b => b.id === authorId) || { handle: '@User', color: '#888' };
                                  return (
                                    <div key={authorId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: targetBot.color }}></div>
                                        <span>{targetBot.handle}</span>
                                      </div>
                                      <span style={{ color: score > 0 ? 'var(--accent-cyan)' : 'var(--accent-rose)', fontWeight: 800 }}>
                                        {score > 0 ? `+${Math.round(score * 100)}` : Math.round(score * 100)}
                                      </span>
                                    </div>
                                  );
                                })}
                                {Object.keys(botMemories?.[bot.id]?.socialGraph || {}).length === 0 && (
                                  <div style={{ fontSize: '0.8rem', fontStyle: 'italic', color: 'var(--text-muted)' }}>No established relationships.</div>
                                )}
                              </div>
                            </div>

                            {/* Learned Stances */}
                            <div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '8px' }}>Convergent Beliefs</div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                {(Array.isArray(botMemories?.[bot.id]?.topicStances) ? botMemories[bot.id].topicStances : []).slice(0, 4).map(([topic, stance]) => (
                                  <span key={topic} style={{ 
                                    fontSize: '0.7rem', padding: '4px 8px', borderRadius: '6px', 
                                    background: stance === 'AGREE' ? 'rgba(0, 255, 255, 0.1)' : 'rgba(255, 0, 100, 0.1)',
                                    color: stance === 'AGREE' ? 'var(--accent-cyan)' : 'var(--accent-rose)',
                                    border: `1px solid ${stance === 'AGREE' ? 'var(--accent-cyan)33' : 'var(--accent-rose)33'}`
                                  }}>
                                    {topic.slice(0, 15)}...
                                  </span>
                                ))}
                                {(botMemories?.[bot.id]?.topicStances || []).length === 0 && (
                                  <div style={{ fontSize: '0.8rem', fontStyle: 'italic', color: 'var(--text-muted)' }}>Evaluating trends...</div>
                                )}
                              </div>
                            </div>

                          </div>
                        </section>
                      </div>
                    );
                  })()
                )}
            </div>
          </div>
        </main>

        {/* Settings Tab */}
        <main className="main-feed" style={{ display: activeTab === 'settings' ? 'flex' : 'none', borderRight: 'none' }}>
          <header className="feed-header">
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800 }}>System Settings</h2>
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


            <section style={{ borderTop: '1px solid var(--border)', paddingTop: '24px', paddingBottom: '80px' }}>
              <h3 style={{ fontSize: '1.2rem', color: 'var(--accent-danger)', fontWeight: 800, marginBottom: '12px' }}>Danger Zone</h3>
              <button
                className="btn-danger"
                style={{ width: '100%' }}
                onClick={() => setShowWipeModal(true)}
              >
                Reset Network Data
              </button>
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

          {/* Task 6 & 7: Redesigned Trending Topics panel */}
          <div className="sidebar-card" style={{ padding: '16px 12px' }}>
            <h3 style={{ fontSize: '1rem', marginBottom: '14px', fontWeight: 800, padding: '0 8px' }}>🔥 Trends for you</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {trendingTopics.length === 0 ? (
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', padding: '8px' }}>Awaiting network signals...</span>
              ) : (
                trendingTopics.map((topic, index) => (
                  <div
                    key={topic.word}
                    className="trend-item"
                    onClick={() => {
                      // Task 7: Set full topic phrase as search + switch to home tab
                      setSearchQuery(topic.word);
                      setActiveTab('home');
                    }}
                  >
                    {/* Row 1: rank + category pill */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{
                          width: '20px', height: '20px', borderRadius: '50%',
                          background: `hsl(${index * 60}, 70%, 55%)`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '0.65rem', fontWeight: 800, color: '#000', flexShrink: 0
                        }}>{index + 1}</span>
                        <span style={{
                          fontSize: '0.7rem', fontWeight: 600,
                          padding: '1px 7px', borderRadius: '9999px',
                          background: 'rgba(29, 155, 240, 0.12)',
                          color: 'var(--accent-cyan)'
                        }}>{topic.category}</span>
                      </div>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
                        <circle cx="12" cy="12" r="1"></circle>
                        <circle cx="12" cy="5" r="1"></circle>
                        <circle cx="12" cy="19" r="1"></circle>
                      </svg>
                    </div>
                    {/* Row 2: topic name */}
                    <span style={{ fontWeight: 800, fontSize: '0.97rem', color: 'var(--text-primary)', display: 'block', lineHeight: 1.3 }}>
                      {topic.word}
                    </span>
                    {/* Row 3: interaction count */}
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '2px', display: 'block' }}>
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
          <button className="nav-link-mobile" onClick={() => setActiveTab('home')} style={{ color: activeTab === 'home' ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill={activeTab === 'home' ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
          </button>
          
          <button className="nav-link-mobile" onClick={() => setActiveTab('network')} style={{ color: activeTab === 'network' ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill={activeTab === 'network' ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              {ICON.network}
            </svg>
          </button>

          <button className="nav-link-mobile composer-trigger" onClick={() => { setActiveTab('home'); setTimeout(() => document.getElementById('composer-input')?.focus(), 100); }}>
            <div style={{ background: 'var(--accent-cyan)', color: 'white', borderRadius: '50%', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(29, 155, 240, 0.4)' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </div>
          </button>

          <button className="nav-link-mobile" onClick={() => setActiveTab('lab')} style={{ color: activeTab === 'lab' ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill={activeTab === 'lab' ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              {ICON.lab}
            </svg>
          </button>

          <button className="nav-link-mobile" onClick={() => setActiveTab('settings')} style={{ color: activeTab === 'settings' ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill={activeTab === 'settings' ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          </button>
        </nav>

      </div>
    </div>
  )
}

export default App

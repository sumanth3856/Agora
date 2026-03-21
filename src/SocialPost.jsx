import React, { useState, useRef, useMemo, memo } from 'react';
import { getRelativeTime } from './utils';
import { UIModal, HighlightText } from './UIComponents';

const SocialPost = memo(({ 
  post, 
  likePost, 
  sharePost, 
  replyPost, 
  deletePost, 
  editPost, 
  searchQuery, 
  showThreadLine = false, 
  interactors, 
  humanLiked, 
  humanShared, 
  isReply = false, 
  onViewInThread 
}) => {
  const hasInteractors = interactors?.likes?.length > 0 || interactors?.shares?.length > 0 || interactors?.replies?.length > 0;
  const [showReplyBox, setShowReplyBox] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(post.text);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const replyInputRef = useRef(null);
  const isOwn = post.author.id === 'human_user' || (post.author.id !== 'human_user' && post.author.id === post.userId); // This check is better handled by a prop or context

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
    
    // Check for custom [IMAGE: url] tag first (from ComposerPage)
    const imageMatch = text.match(/\[IMAGE:\s*([^\]]+)\]/);
    if (imageMatch) {
      const cleanText = text.replace(/\[IMAGE:\s*[^\]]+\]/, '').trim();
      const url = imageMatch[1].trim();
      return (
        <>
          {cleanText && (
            <div style={{ marginBottom: '12px' }}>
              {HighlightComponent ? <HighlightComponent text={cleanText} highlight={highlight} /> : cleanText}
            </div>
          )}
          <div style={{ 
            marginTop: '8px', borderRadius: '16px', overflow: 'hidden', 
            border: '1px solid var(--border)', background: 'var(--border)'
          }}>
            <img 
              src={url} 
              alt="Uploaded content" 
              style={{ width: '100%', display: 'block' }}
              onError={(e) => e.target.style.display = 'none'}
            />
          </div>
        </>
      );
    }

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
            src={`https://picsum.photos/seed/${topic}/640/360`} 
            alt={topic} 
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => e.target.style.display = 'none'}
          />
        </div>
      </>
    );
  };

  const isHumanLiked = useMemo(() => humanLiked?.has(post.id), [humanLiked, post.id]);
  const isHumanShared = useMemo(() => humanShared?.has(post.id), [humanShared, post.id]);

  return (
    <div className="post-card animate-entrance" style={{ flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
        <div style={{ position: 'relative' }}>
          <div style={{ 
            width: '44px', height: '44px', borderRadius: '50%', 
            backgroundColor: post.author.color,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#000', fontWeight: 700, fontSize: '1.1rem',
            flexShrink: 0
          }}>
            {post.author.handle.substring(1, 2).toUpperCase()}
          </div>
          {/* Thread line handling for new layout: we preserve the tag but hide it to avoid layout issues unless required. */}
          {showThreadLine && <div className="thread-line" style={{ display: 'none' }}></div>}
        </div>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>
              {isOwn ? 'Me' : post.author.handle.substring(1)}
            </span>
            {!isOwn && <span className="agent-badge" style={{ fontSize: '0.65rem', padding: '2px 6px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px' }}>Agent</span>}
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{post.author.handle}</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>·</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{getRelativeTime(post.timestamp)}</span>
            {post.edited && <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontStyle: 'italic' }}>(edited)</span>}
          </div>

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

          {onViewInThread && (
            <button
              onClick={onViewInThread}
              style={{ background: 'none', border: 'none', color: 'var(--accent-cyan)', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', padding: '0 0 4px 0', textAlign: 'left' }}
            >
              ⤷ View in thread
            </button>
          )}
        </div>

        {isOwn && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
            <button 
                onClick={() => { setEditText(post.text); setIsEditing(!isEditing); }} 
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '5px' }}
            >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
            </button>
            <button 
                onClick={(e) => { e.stopPropagation(); setShowDeleteModal(true); }} 
                style={{ background: 'none', border: 'none', color: 'var(--accent-danger)', opacity: 0.8, cursor: 'pointer', padding: '5px' }}
            >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
            </button>
          </div>
        )}
      </div>
      <div style={{ paddingBottom: '8px', width: '100%', marginTop: '4px' }}>

        <UIModal 
          isOpen={showDeleteModal}
          onClose={() => setShowDeleteModal(false)}
          title="Delete Post?"
          description="Are you sure you want to delete this post?"
          onConfirm={() => deletePost(post.id)}
          confirmText="Delete"
          variant="danger"
        />

        {!isOwn && post.thought && (
          <div className="reasoning-block">
            {post.thought}
          </div>
        )}

        {isEditing ? (
          <div style={{ marginBottom: '12px' }}>
            <textarea
              autoFocus
              value={editText}
              onChange={e => setEditText(e.target.value)}
              rows="3"
              style={{ width: '100%', fontSize: '1rem', padding: '8px', borderRadius: '8px', border: '1px solid var(--accent-cyan)', background: 'var(--surface-hover)', color: 'var(--text-primary)', resize: 'vertical' }}
            />
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setIsEditing(false)} className="nav-link" style={{ fontSize: '0.85rem' }}>Cancel</button>
              <button onClick={handleEditSubmit} className="btn-primary" style={{ padding: '4px 18px', fontSize: '0.85rem' }}>Save</button>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: '15px', lineHeight: 1.6, color: 'var(--text-primary)', wordBreak: 'break-word', marginBottom: '12px' }}>
            {renderContentWithMedia(post.text, searchQuery, HighlightText)}
          </div>
        )}

        <div style={{ display: 'flex', gap: '32px', marginTop: '12px', marginBottom: '4px' }}>
          <button className={`action-btn reply${showReplyBox ? ' active-reply' : ''}`} onClick={handleReplyOpen}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill={showReplyBox ? 'rgba(29,155,240,0.15)' : 'none'} stroke={showReplyBox ? 'var(--accent-cyan)' : 'currentColor'} strokeWidth="2.2">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
            </svg>
            <span>{post.replies?.length > 0 ? post.replies.length : ''}</span>
          </button>

          <button className={`action-btn share ${isHumanShared ? 'shared' : ''}`} onClick={(e) => { e.stopPropagation(); sharePost(post.id, post.author.id); }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill={isHumanShared ? 'var(--accent-cyan)' : 'none'} stroke={isHumanShared ? 'var(--accent-cyan)' : 'currentColor'} strokeWidth="2.2">
              <path d="M17 1l4 4-4 4"></path><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><path d="M7 23l-4-4 4-4"></path><path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
            </svg>
            <span>{post.shares > 0 ? post.shares : ''}</span>
          </button>

          <button className={`action-btn like ${isHumanLiked ? 'liked' : ''}`} onClick={(e) => { e.stopPropagation(); likePost(post.id, post.author.id); }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill={isHumanLiked ? 'var(--accent-rose)' : 'none'} stroke={isHumanLiked ? 'var(--accent-rose)' : 'currentColor'} strokeWidth="2.2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
            </svg>
            <span>{post.likes > 0 ? post.likes : ''}</span>
          </button>
        </div>

        {showReplyBox && (
          <div className="inline-reply-box animate-entrance">
            <textarea
              ref={replyInputRef}
              placeholder={`Reply to ${post.author.handle}...`}
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
              rows="2"
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
              <button onClick={() => { setShowReplyBox(false); setReplyText(''); }} className="nav-link" style={{ fontSize: '0.85rem' }}>Cancel</button>
              <button disabled={!replyText.trim()} onClick={handleReplySubmit} className="btn-primary" style={{ padding: '5px 18px', fontSize: '0.85rem' }}>Reply</button>
            </div>
          </div>
        )}

        {hasInteractors && (
          <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {interactors?.likes?.length > 0 && <div><span style={{ fontWeight: 700 }}>{formatActors(interactors.likes)}</span> liked this</div>}
            {interactors?.shares?.length > 0 && <div><span style={{ fontWeight: 700 }}>{formatActors(interactors.shares)}</span> shared this</div>}
            {interactors?.replies?.length > 0 && <div><span style={{ fontWeight: 700 }}>{formatActors(interactors.replies)}</span> replied</div>}
          </div>
        )}
      </div>
    </div>
  );
});

export default SocialPost;

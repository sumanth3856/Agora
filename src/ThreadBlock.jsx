import React, { useState, useRef, useEffect, useMemo, memo } from 'react';
import { flattenReplies } from './utils';
import SocialPost from './SocialPost';

const INITIAL_REPLIES = 2;
const BATCH_SIZE = 5;

const ThreadBlock = memo(({ 
  post, 
  likePost, 
  sharePost, 
  replyPost, 
  deletePost, 
  editPost, 
  searchQuery, 
  postInteractors, 
  humanLiked, 
  humanShared 
}) => {
  const allReplies = useMemo(() => flattenReplies(post.replies || []), [post.replies]);
  const total = allReplies.length;
  const initialShow = total > 10 ? BATCH_SIZE : INITIAL_REPLIES;
  const [visibleCount, setVisibleCount] = useState(initialShow);
  const prevTotal = useRef(total);

  useEffect(() => {
    if (total > prevTotal.current) {
      const diff = total - prevTotal.current;
      setVisibleCount(c => c + diff);
    } else if (total > 10 && prevTotal.current <= 10) {
       setVisibleCount(BATCH_SIZE);
    } else if (total === 0) {
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

        {remaining > 0 && (
          <div style={{ padding: '8px 0 8px 0px' }}>
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

export default ThreadBlock;

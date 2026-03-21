import React, { useMemo } from 'react';
import { useSimulation } from './SimulationContext';
import { useAuth } from './AuthContext';
import SocialPost from './SocialPost';

const ProfilePage = ({ onBack }) => {
  const { 
    posts, 
    userPersona, 
    likePost, 
    sharePost, 
    createHumanReply, 
    deletePost, 
    editPost,
    postInteractors,
    humanLiked,
    humanShared
  } = useSimulation();
  const { user } = useAuth();

  const userPosts = useMemo(() => {
    const flatten = (arr) => arr.reduce((acc, p) => [...acc, p, ...flatten(p.replies || [])], []);
    return flatten(posts).filter(p => p.author.id === user?.id);
  }, [posts, user?.id]);

  if (!user) return null;

  return (
    <div className="profile-page animate-entrance" style={{ 
      position: 'fixed', inset: 0, zIndex: 10000, background: 'var(--bg-dark)', 
      display: 'flex', flexDirection: 'column', height: '100vh', overflowY: 'auto' 
    }}>
      <header style={{ 
        padding: '16px 24px', display: 'flex', alignItems: 'center', 
        gap: '24px', borderBottom: '1px solid var(--border)', 
        position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-dark)'
      }}>
        <button onClick={onBack} className="nav-link" style={{ width: '40px', height: '40px', padding: 0 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        </button>
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 800 }}>Profile</h2>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{userPosts.length} post{userPosts.length !== 1 ? 's' : ''}</span>
        </div>
      </header>

      <div className="profile-hero" style={{ 
        padding: '32px 24px', borderBottom: '1px solid var(--border)', 
        background: 'linear-gradient(to bottom, rgba(255,255,255,0.03), transparent)' 
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '24px', marginBottom: '16px' }}>
          <div style={{ 
            width: '96px', height: '96px', borderRadius: '50%', border: '4px solid var(--bg-dark)',
            backgroundColor: userPersona.color, display: 'flex', 
            alignItems: 'center', justifyContent: 'center', 
            color: '#000', fontWeight: 800, fontSize: '2.5rem', flexShrink: 0 
          }}>
            {userPersona.handle.substring(1, 2).toUpperCase()}
          </div>
        </div>
        <div>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 900 }}>{user.user_metadata?.full_name || user.email.split('@')[0]}</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>{userPersona.handle}</p>
        </div>
        <div style={{ marginTop: '16px', display: 'flex', gap: '20px' }}>
          <span style={{ fontSize: '0.9rem' }}><strong style={{ color: 'var(--text-primary)' }}>128</strong> <span style={{ color: 'var(--text-secondary)' }}>Following</span></span>
          <span style={{ fontSize: '0.9rem' }}><strong style={{ color: 'var(--text-primary)' }}>1.2k</strong> <span style={{ color: 'var(--text-secondary)' }}>Followers</span></span>
        </div>
      </div>

      <div className="profile-feed">
        {userPosts.length === 0 ? (
          <div style={{ padding: '64px 24px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <p>You haven't posted anything yet.</p>
          </div>
        ) : (
          userPosts.sort((a,b) => b.timestamp - a.timestamp).map(post => (
             <div key={post.id} className="post-container">
               <SocialPost
                 post={post}
                 likePost={likePost}
                 sharePost={sharePost}
                 replyPost={createHumanReply}
                 deletePost={deletePost}
                 editPost={editPost}
                 interactors={postInteractors?.[post.id]}
                 humanLiked={humanLiked}
                 humanShared={humanShared}
               />
             </div>
          ))
        )}
      </div>
      <div style={{ paddingBottom: '100px' }}></div>
    </div>
  );
};

export default ProfilePage;

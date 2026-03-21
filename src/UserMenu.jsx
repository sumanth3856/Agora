import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from './AuthContext';

const UserMenu = ({ onProfileClick }) => {
  const { user, signOut } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!user) {
    return null;
  }

  const displayName = user.user_metadata?.full_name || user.email.split('@')[0];
  const avatarUrl = user.user_metadata?.avatar_url || `https://ui-avatars.com/api/?name=${displayName}&background=random`;

  return (
    <div className="profile-tile-spatial" ref={menuRef}>
      {isOpen && (
        <div className="profile-dropdown-spatial">
          <div className="dropdown-header">
             <div style={{ fontWeight: 800 }}>{displayName}</div>
             <div style={{ fontSize: '0.75rem', opacity: 0.6 }}>Authenticated Explorer</div>
          </div>
          <button className="dropdown-item" onClick={() => { onProfileClick(); setIsOpen(false); }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            My Profile
          </button>
          <button className="dropdown-item" onClick={() => setIsOpen(false)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
            Cloud Settings
          </button>
          <div style={{ margin: '8px 0', borderTop: '1px solid var(--border)' }}></div>
          <button className="dropdown-item danger" onClick={signOut}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
            Log out
          </button>
        </div>
      )}

      <button 
        className="nav-link" 
        onClick={() => setIsOpen(!isOpen)}
        aria-label="User profile menu"
        style={{ padding: 0 }}
      >
        <div className="avatar-wrapper" style={{ margin: '0 auto', width: '36px', height: '36px' }}>
          <img 
            src={avatarUrl} 
            alt={displayName} 
            className="avatar-img-large"
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
          />
        </div>
      </button>
    </div>
  );
};


export default UserMenu;

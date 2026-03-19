import React, { useState, useRef } from 'react';
import { useSimulation } from './SimulationContext';
import { supabase } from './supabaseClient';
import { useAuth } from './AuthContext';

const ComposerPage = ({ onCancel, onComplete }) => {
  const { createHumanPost, userPersona } = useSimulation();
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [mediaUrl, setMediaUrl] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const fileInputRef = useRef(null);

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Show preview
    const reader = new FileReader();
    reader.onload = (prev) => setPreviewUrl(prev.target.result);
    reader.readAsDataURL(file);

    setIsUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random()}.${fileExt}`;
      const filePath = `${user.id}/${fileName}`;

      let { error: uploadError } = await supabase.storage
        .from('media')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('media').getPublicUrl(filePath);
      setMediaUrl(data.publicUrl);
    } catch (error) {
      console.error('Error uploading image:', error.message);
      alert('Error uploading image!');
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!text.trim() && !mediaUrl) return;
    
    // Combine text and media tag if media exists
    // The simulation expects [MEDIA: topic] but we can also just store the URL in a 'media_url' column if we add it.
    // For now, let's append the media tag or just pass it to context if we update the context.
    
    const finalPostText = mediaUrl ? `${text} [IMAGE:${mediaUrl}]` : text;
    
    await createHumanPost(finalPostText);
    onComplete();
  };

  return (
    <div className="composer-page animate-entrance" style={{ 
      position: 'fixed', inset: 0, zIndex: 10000, 
      background: 'var(--bg-dark)', display: 'flex', flexDirection: 'column' 
    }}>
      <header style={{ 
        padding: '16px 24px', display: 'flex', justifyContent: 'space-between', 
        alignItems: 'center', borderBottom: '1px solid var(--border)' 
      }}>
        <button onClick={onCancel} className="nav-link" style={{ fontSize: '0.9rem' }}>Cancel</button>
        <button 
          onClick={handleSubmit} 
          disabled={(!text.trim() && !mediaUrl) || isUploading}
          className="btn-primary" 
          style={{ padding: '8px 24px', opacity: (text.trim() || mediaUrl) ? 1 : 0.5 }}
        >
          {isUploading ? 'Uploading...' : 'Post'}
        </button>
      </header>

      <div style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
          <div style={{ 
            width: '48px', height: '48px', borderRadius: '50%', 
            backgroundColor: userPersona.color, display: 'flex', 
            alignItems: 'center', justifyContent: 'center', 
            color: '#000', fontWeight: 800, fontSize: '1.2rem', flexShrink: 0 
          }}>
            {userPersona.handle.substring(1, 2).toUpperCase()}
          </div>
          <div style={{ flex: 1 }}>
            <textarea
              autoFocus
              placeholder="What's on your mind?"
              value={text}
              onChange={e => setText(e.target.value)}
              style={{ 
                width: '100%', border: 'none', background: 'transparent', 
                color: 'var(--text-primary)', fontSize: '1.3rem', 
                lineHeight: '1.5', outline: 'none', resize: 'none',
                minHeight: '120px'
              }}
            />

            {previewUrl && (
              <div style={{ 
                position: 'relative', marginTop: '16px', borderRadius: '24px', 
                overflow: 'hidden', border: '1px solid var(--border)' 
              }}>
                <img src={previewUrl} alt="Preview" style={{ width: '100%', display: 'block' }} />
                <button 
                  onClick={() => { setPreviewUrl(null); setMediaUrl(null); }}
                  style={{ 
                    position: 'absolute', top: '12px', right: '12px', 
                    background: 'rgba(0,0,0,0.5)', color: 'white', 
                    border: 'none', borderRadius: '50%', width: '32px', 
                    height: '32px', cursor: 'pointer' 
                  }}
                >
                  ✕
                </button>
                {isUploading && (
                  <div style={{ 
                    position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', 
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'white', fontWeight: 700
                  }}>
                    UPLOADING...
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <footer style={{ 
        padding: '16px 24px', borderTop: '1px solid var(--border)', 
        display: 'flex', gap: '16px' 
      }}>
        <input 
          type="file" 
          accept="image/*" 
          hidden 
          ref={fileInputRef} 
          onChange={handleFileChange} 
        />
        <button 
          onClick={() => fileInputRef.current?.click()}
          className="nav-link" 
          style={{ color: 'var(--accent-cyan)', padding: '8px' }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
        </button>
        <button className="nav-link" style={{ color: 'var(--accent-cyan)', padding: '8px' }}>
           <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
        </button>
      </footer>
    </div>
  );
};

export default ComposerPage;

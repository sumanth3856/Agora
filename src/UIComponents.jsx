import React, { useEffect, memo } from 'react';
import { createPortal } from 'react-dom';

export const UIModal = ({ isOpen, onClose, title, description, onConfirm, confirmText = 'Confirm', variant = 'default', children, showActions = true }) => {
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
          <div className="modal-actions" style={{ display: 'flex', gap: '12px', marginTop: '24px', justifyContent: 'flex-end' }}>
            <button className="modal-btn modal-btn-cancel" onClick={onClose} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)', padding: '8px 16px', borderRadius: '6px' }}>Cancel</button>
            <button className={`modal-btn modal-btn-confirm ${variant === 'danger' ? 'danger' : ''}`} onClick={() => { onConfirm(); onClose(); }} style={{ background: variant === 'danger' ? 'var(--accent-rose)' : 'var(--text-primary)', color: variant === 'danger' ? '#fff' : 'var(--bg-dark)', border: 'none', padding: '8px 16px', borderRadius: '6px', fontWeight: 600 }}>{confirmText}</button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export const HighlightText = memo(({ text, highlight }) => {
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

export const ShimmerPost = memo(() => (
  <div className="shimmer-wrapper" style={{ padding: '24px var(--container-padding)', borderBottom: '1px solid var(--border)' }}>
    <div className="shimmer-avatar" style={{ width: '44px', height: '44px', borderRadius: '50%', background: 'var(--surface-hover)', marginBottom: '12px' }}></div>
    <div className="shimmer-content">
      <div className="shimmer-line header" style={{ height: '14px', width: '30%', background: 'var(--surface-hover)', marginBottom: '8px' }}></div>
      <div className="shimmer-line" style={{ height: '12px', width: '90%', background: 'var(--surface-hover)', marginBottom: '6px' }}></div>
      <div className="shimmer-line title" style={{ height: '12px', width: '80%', background: 'var(--surface-hover)', marginBottom: '6px' }}></div>
      <div className="shimmer-line short" style={{ height: '12px', width: '40%', background: 'var(--surface-hover)' }}></div>
    </div>
  </div>
));

export const TypingIndicator = memo(({ handle, color }) => (
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

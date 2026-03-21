import React, { memo } from 'react';

const BotProfileTile = memo(({ bot, onEdit, onReset, onDelete }) => (
  <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <div style={{ 
        width: '48px', height: '48px', borderRadius: '50%', 
        backgroundColor: bot.color, display: 'flex', 
        alignItems: 'center', justifyContent: 'center', 
        color: '#000', fontWeight: 800, fontSize: '1rem' 
      }}>
        {bot.handle.substring(1, 2).toUpperCase()}
      </div>
      <div style={{ flex: 1 }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{bot.handle}</h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{bot.role.charAt(0).toUpperCase() + bot.role.slice(1)} Agent</p>
      </div>
    </div>
    
    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.4, minHeight: '40px' }}>
      "{bot.narrativeGoal}"
    </div>

    <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
      <button onClick={onEdit} className="btn-primary" style={{ flex: 1, fontSize: '0.8rem', padding: '8px 4px' }}>Tune</button>
      <button onClick={onReset} className="btn-primary" style={{ flex: 1, fontSize: '0.8rem', padding: '8px 4px' }}>Reset</button>
      <button onClick={onDelete} className="btn-primary" style={{ flex: 1, fontSize: '0.8rem', padding: '8px 4px', color: 'white', backgroundColor: 'var(--accent-danger)' }}>Kill</button>
    </div>
  </div>
));

export default BotProfileTile;

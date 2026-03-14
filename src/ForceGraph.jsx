import React, { useMemo, useRef, useCallback } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { useSimulation } from './SimulationContext';

const ForceGraph = ({ heatmapMode = false, onNodeClick }) => {
  const { 
    posts, activeBots, postInteractors, 
    generatingBots, botMemories, persuasions,
    authorMap 
  } = useSimulation();
  const fgRef = useRef();
  
  // Refined Color palettes
  const sentimentColors = {
    Joy: '#FFD700', Anger: '#FF4500', Fear: '#9370DB', Sadness: '#1E90FF',
    Surprise: '#FF1493', Disgust: '#32CD32', Neutral: '#A9A9A9'
  };

  const interactionColors = {
    like: '#00FF00',
    share: '#00AAFF',
    reply: '#AA00FF'
  };

  const graphData = useMemo(() => {
    // 1. Calculate Node Sizes based on Influence (Persuasions)
    const persuasionsByBot = {};
    (persuasions || []).forEach(p => {
      if (p.influencerId) persuasionsByBot[p.influencerId] = (persuasionsByBot[p.influencerId] || 0) + 1;
    });

    const nodes = activeBots.map(bot => ({
      id: bot.id,
      name: bot.handle,
      color: bot.color,
      val: 4 + (persuasionsByBot[bot.id] || 0) * 2, // Base 4 + 2 per persuasion
      role: bot.role,
      lastSentiment: botMemories?.[bot.id]?.lastSentiment || 'Neutral',
      isGenerating: generatingBots.has(bot.id)
    }));

    nodes.push({
      id: 'human_user',
      name: '@Myself',
      color: '#ffffff',
      val: 5,
      role: 'human',
      lastSentiment: 'Neutral'
    });

    // 2. Aggregate Links for Weighting
    const linkMap = new Map();

    Object.entries(postInteractors || {}).forEach(([postId, interactors]) => {
      const targetAuthorId = (authorMap || {})[postId];
      if (!targetAuthorId) return;

      ['likes', 'shares', 'replies'].forEach(typeKey => {
        const type = typeKey.slice(0, -1); // like, share, reply
        interactors[typeKey]?.forEach(actor => {
          if (actor.id === targetAuthorId) return;
          
          const key = `${actor.id}->${targetAuthorId}-${type}`;
          if (!linkMap.has(key)) {
            linkMap.set(key, { 
              source: actor.id, 
              target: targetAuthorId, 
              type, 
              count: 0 
            });
          }
          linkMap.get(key).count += 1;
        });
      });
    });

    return { nodes, links: Array.from(linkMap.values()) };
  }, [activeBots, postInteractors, authorMap, persuasions, botMemories, generatingBots]);

  const getLabel = useCallback(node => node.name, []);

  const getNodeColor = useCallback(node => {
    if (heatmapMode) return sentimentColors[node.lastSentiment] || sentimentColors.Neutral;
    return node.color;
  }, [heatmapMode]);

  const getLinkColor = useCallback(link => interactionColors[link.type] + '44', []); // 44 for transparency

  // 3. Premium Node Visuals: Labels & Glow
  const renderNode = useCallback((node, ctx, globalScale) => {
    // Safety Fallback: Skip if coords are not numbers
    if (typeof node.x !== 'number' || typeof node.y !== 'number' || isNaN(node.x) || isNaN(node.y)) return;

    const label = node.name || 'Bot';
    const safeScale = Math.max(0.1, globalScale || 1);
    const fontSize = 12 / safeScale;
    const safeVal = Math.max(1, node.val || 5);
    const size = Math.sqrt(safeVal) * 2;
    
    // Ensure color is 6-char hex for appending
    const baseColor = (node.color || '#ffffff').substring(0, 7);

    // Draw Glow for Active Bots
    if (node.isGenerating) {
      const t = Date.now() / 500;
      const pulse = Math.abs(Math.sin(t)) * 0.5 + 0.5;
      ctx.beginPath();
      ctx.arc(node.x, node.y, size * (1.2 + pulse * 0.3), 0, 2 * Math.PI, false);
      ctx.fillStyle = baseColor + '33';
      ctx.fill();
    }

    // Draw Node Circle
    ctx.beginPath();
    ctx.arc(node.x, node.y, size, 0, 2 * Math.PI, false);
    ctx.fillStyle = heatmapMode ? (sentimentColors[node.lastSentiment] || sentimentColors.Neutral) : baseColor;
    ctx.fill();

    // Draw Label with Glassmorphism Background
    ctx.font = `bold ${fontSize}px Inter, system-ui`;
    const textWidth = ctx.measureText(label).width;
    const bckgDimensions = [textWidth, fontSize].map(n => n + fontSize * 0.5);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(node.x - bckgDimensions[0] / 2, node.y - size - bckgDimensions[1] - 2, ...bckgDimensions);
    
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(label, node.x, node.y - size - bckgDimensions[1] / 2 - 2);
  }, [heatmapMode]);

  return (
    <div style={{ width: '100%', height: '100%', background: '#000' }}>
      <ForceGraph2D
        ref={fgRef}
        graphData={graphData}
        nodeCanvasObject={renderNode}
        onNodeClick={node => node && onNodeClick?.(node.id)}
        nodePointerAreaPaint={(node, color, ctx) => {
           ctx.fillStyle = color;
           const size = Math.sqrt(Math.max(1, node.val || 4)) * 2;
           ctx.beginPath(); ctx.arc(node.x, node.y, size, 0, 2 * Math.PI, false); ctx.fill();
        }}
        nodeRelSize={6}
        linkDirectionalArrowLength={3.5}
        linkDirectionalArrowRelPos={1}
        linkCurvature={0.25}
        linkColor={getLinkColor}
        linkWidth={link => 0.5 + Math.min(link.count * 0.5, 4)}
        cooldownTicks={100}
        onEngineStop={() => fgRef.current?.zoomToFit(400)}
        d3AlphaTarget={0}
        d3VelocityDecay={0.4}
      />
    </div>
  );
};

export default ForceGraph;

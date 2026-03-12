import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import Groq from 'groq-sdk';
import { BOT_PERSONAS, BOT_SYSTEM_PROMPTS, POST_TOPIC_POOL } from './types';
import { supabase } from './supabaseClient';

// Initialize Groq explicitly checking for browser environments.
const groq = import.meta.env.VITE_GROQ_API_KEY 
  ? new Groq({ apiKey: import.meta.env.VITE_GROQ_API_KEY, dangerouslyAllowBrowser: true }) 
  : null;

const SimulationContext = createContext(null);

export const useSimulation = () => useContext(SimulationContext);

export const SimulationProvider = ({ children }) => {
  const USER_PERSONA = {
    id: 'human_user',
    handle: '@Me',
    role: 'human',
    color: '#ffffffff'
  };

  // --- State ---
  const [posts, setPosts] = useState([]);
  const [nodes, setNodes] = useState(BOT_PERSONAS.map(bot => ({
    id: bot.id, handle: bot.handle, color: bot.color, val: 5, spawnTime: Date.now()
  })));
  const [links, setLinks] = useState([]);
  const [activeBots, setActiveBots] = useState(BOT_PERSONAS);
  const [activePrompts, setActivePrompts] = useState(BOT_SYSTEM_PROMPTS);
  const [isLoaded, setIsLoaded] = useState(false);

  // Dials
  const [outrageMultiplier, setOutrageMultiplier] = useState(50);
  const [curiosityMultiplier, setCuriosityMultiplier] = useState(30);

  const isSimulating = useRef(true);
  const stateRef = useRef({ posts, nodes, links, outrageMultiplier, curiosityMultiplier, activeBots, activePrompts });
  const generatingBotsRef = useRef(new Set());

  // Keep ref current
  useEffect(() => {
    stateRef.current = { posts, nodes, links, outrageMultiplier, curiosityMultiplier, activeBots, activePrompts };
  }, [posts, nodes, links, outrageMultiplier, curiosityMultiplier, activeBots, activePrompts]);

  // ─── SUPABASE: Initial Load ───────────────────────────────────────────────
  useEffect(() => {
    const loadFromSupabase = async () => {
      // Load nodes
      const { data: dbNodes } = await supabase.from('nodes').select('*');
      if (dbNodes && dbNodes.length > 0) {
        const mapped = dbNodes.map(n => ({
          id: n.id, handle: n.handle, color: n.color,
          val: n.val, spawnTime: n.spawn_time
        }));
        setNodes(mapped);
      } else {
        // First run — seed the default bot nodes
        const defaultNodes = BOT_PERSONAS.map(bot => ({
          id: bot.id, handle: bot.handle, color: bot.color, val: 5, spawn_time: Date.now()
        }));
        await supabase.from('nodes').upsert(defaultNodes);
        setNodes(defaultNodes.map(n => ({ ...n, spawnTime: n.spawn_time })));
      }

      // Load links
      const { data: dbLinks } = await supabase.from('links').select('*');
      if (dbLinks) {
        setLinks(dbLinks.map(l => ({
          source: l.source_id, target: l.target_id,
          value: l.value, sentiment: l.sentiment, spawnTime: l.spawn_time, _dbId: l.id
        })));
      }

      // Load posts (flat DB rows → nested tree)
      const { data: dbPosts } = await supabase
        .from('posts')
        .select('*')
        .order('timestamp', { ascending: true });
      if (dbPosts && dbPosts.length > 0) {
        setPostsFromFlat(dbPosts);
      }

      setIsLoaded(true);
    };

    loadFromSupabase();
  }, []);

  // ─── SUPABASE: Realtime Subscriptions ────────────────────────────────────
  useEffect(() => {
    if (!isLoaded) return;

    const channel = supabase
      .channel('echo-realtime')
      // New post from another client
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, payload => {
        const row = payload.new;
        const newPost = dbRowToPost(row);
        if (row.parent_id) {
          setPosts(prev => {
            if (existsInTree(prev, row.id)) return prev;
            return addReplyDeepById(prev, row.parent_id, newPost);
          });
        } else {
          setPosts(prev => {
            if (existsInTree(prev, row.id)) return prev;
            return [newPost, ...prev];
          });
        }
      })
      // Like/share update from another client
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'posts' }, payload => {
        const row = payload.new;
        setPosts(prev => updatePostDeep(prev, row.id, { likes: row.likes, shares: row.shares }));
      })
      // New node
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'nodes' }, payload => {
        const row = payload.new;
        setNodes(prev => {
          if (prev.find(n => n.id === row.id)) return prev;
          return [...prev, { id: row.id, handle: row.handle, color: row.color, val: row.val, spawnTime: row.spawn_time }];
        });
      })
      // Node value update
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'nodes' }, payload => {
        const row = payload.new;
        setNodes(prev => prev.map(n => n.id === row.id ? { ...n, val: row.val } : n));
      })
      // New link
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'links' }, payload => {
        const row = payload.new;
        setLinks(prev => {
          if (prev.find(l => l._dbId === row.id)) return prev;
          return [...prev, { source: row.source_id, target: row.target_id, value: row.value, sentiment: row.sentiment, spawnTime: row.spawn_time, _dbId: row.id }];
        });
      })
      // Link value update (sentiment, weight)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'links' }, payload => {
        const row = payload.new;
        setLinks(prev => prev.map(l => l._dbId === row.id ? { ...l, value: row.value, sentiment: row.sentiment } : l));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [isLoaded]);

  // ─── Helpers: Post Tree Management ───────────────────────────────────────
  const existsInTree = (postsArr, id) => {
    for (const post of postsArr) {
      if (post.id === id) return true;
      if (post.replies && post.replies.length > 0) {
        if (existsInTree(post.replies, id)) return true;
      }
    }
    return false;
  };

  const dbRowToPost = (row) => ({
    id: row.id,
    author: { id: row.author_id, handle: row.author_handle, color: row.author_color },
    text: row.text,
    timestamp: row.timestamp,
    likes: row.likes || 0,
    shares: row.shares || 0,
    replies: [],
  });

  const setPostsFromFlat = (flatRows) => {
    const postMap = {};
    flatRows.forEach(row => { postMap[row.id] = dbRowToPost(row); });
    const roots = [];
    flatRows.forEach(row => {
      if (row.parent_id) {
        if (postMap[row.parent_id]) {
          postMap[row.parent_id].replies.push(postMap[row.id]);
        }
      } else {
        roots.push(postMap[row.id]);
      }
    });
    setPosts(roots.reverse()); // most recent on top
  };

  const addReplyDeepById = (postsArr, targetId, replyPost) => {
    return postsArr.map(node => {
      if (node.id === targetId) {
        if (node.replies.find(r => r.id === replyPost.id)) return node;
        return { ...node, replies: [...(node.replies || []), replyPost] };
      }
      if (node.replies && node.replies.length > 0) {
        return { ...node, replies: addReplyDeepById(node.replies, targetId, replyPost) };
      }
      return node;
    });
  };

  const updatePostDeep = (postsArr, postId, updates) => {
    return postsArr.map(p => {
      if (p.id === postId) return { ...p, ...updates };
      if (p.replies && p.replies.length > 0) return { ...p, replies: updatePostDeep(p.replies, postId, updates) };
      return p;
    });
  };

  // ─── AI Text Generation ────────────────────────────────────────────────────
  const generateBotText = async (bot, isReply, targetPost = null) => {
    if (!groq) return { text: "DEBUG: No Groq API key found.", sentiment: null };
    try {
      // Pick a fresh random topic every time a bot decides to post
      const randomTopic = POST_TOPIC_POOL[Math.floor(Math.random() * POST_TOPIC_POOL.length)];
      let prompt = `Share a short, highly opinionated hot take about: ${randomTopic}. Be direct and passionate. No hashtags, no filler phrases, no quotes.`;
      if (isReply && targetPost) {
        prompt = `Reply directly to this opinion from ${targetPost.author.handle}: "${targetPost.text}". You MUST start your response with exactly "[AGREE]" or "[DISAGREE]" based on your persona's view. Then give a short, passionate conversational retort without quotes.`;
      }
      const completion = await groq.chat.completions.create({
        messages: [
          { role: 'system', content: stateRef.current.activePrompts[bot.role] || "You are a highly opinionated software engineer." },
          { role: 'user', content: prompt }
        ],
        model: 'llama-3.1-8b-instant',
        max_tokens: 60,
      });
      let generated = completion.choices[0]?.message?.content?.replace(/['"]/g, '') || 'No comment.';
      let sentiment = null;
      if (generated.includes('[AGREE]')) { sentiment = 'AGREE'; generated = generated.replace('[AGREE]', '').trim(); }
      else if (generated.includes('[DISAGREE]')) { sentiment = 'DISAGREE'; generated = generated.replace('[DISAGREE]', '').trim(); }
      return { text: generated, sentiment };
    } catch (e) {
      console.error("Groq API Error:", e);
      return { text: `API ERROR: ${e.message}`, sentiment: null };
    }
  };

  // ─── Supabase Node Helpers ─────────────────────────────────────────────────
  const upsertNode = async (nodeData) => {
    const row = { id: nodeData.id, handle: nodeData.handle, color: nodeData.color, val: nodeData.val, spawn_time: nodeData.spawnTime || Date.now() };
    await supabase.from('nodes').upsert(row);
  };

  const updateNodeVal = async (nodeId, val) => {
    await supabase.from('nodes').update({ val }).eq('id', nodeId);
  };

  const upsertLink = async (linkData) => {
    // Check if link exists first
    const srcId = linkData.source.id || linkData.source;
    const tgtId = linkData.target.id || linkData.target;
    const { data } = await supabase.from('links').select('id, value').or(`and(source_id.eq.${srcId},target_id.eq.${tgtId}),and(source_id.eq.${tgtId},target_id.eq.${srcId})`);
    if (data && data.length > 0) {
      // Update existing
      await supabase.from('links').update({ value: data[0].value + linkData.incrementBy, sentiment: linkData.sentiment || null }).eq('id', data[0].id);
    } else {
      // Insert new
      await supabase.from('links').insert({ source_id: srcId, target_id: tgtId, value: linkData.value || 1, sentiment: linkData.sentiment || null, spawn_time: Date.now() });
    }
  };

  // ─── createNewPost ─────────────────────────────────────────────────────────
  const createNewPost = async (bot) => {
    generatingBotsRef.current.add(bot.id);
    const { text } = await generateBotText(bot, false);
    generatingBotsRef.current.delete(bot.id);

    const postId = `post_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const newPost = { id: postId, author: bot, text, timestamp: Date.now(), replies: [], likes: 0, shares: 0 };

    // Write to Supabase (Realtime will propagate back)
    await supabase.from('posts').insert({
      id: postId, author_id: bot.id, author_handle: bot.handle, author_color: bot.color,
      text, timestamp: newPost.timestamp, parent_id: null, likes: 0, shares: 0
    });

    // Optimistic local update
    setNodes(prev => prev.map(n => n.id === bot.id ? { ...n, val: Math.min(n.val + 2, 20) } : n));
    await updateNodeVal(bot.id, Math.min((stateRef.current.nodes.find(n => n.id === bot.id)?.val || 5) + 2, 20));
    setPosts(prev => {
      if (existsInTree(prev, postId)) return prev;
      return [newPost, ...prev];
    });
    markActive([bot.id]);
  };

  // ─── createReply ──────────────────────────────────────────────────────────
  const createReply = async (bot, targetPost) => {
    generatingBotsRef.current.add(bot.id);
    const { text, sentiment } = await generateBotText(bot, true, targetPost);
    generatingBotsRef.current.delete(bot.id);

    const replyId = `reply_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const reply = { id: replyId, author: bot, text, timestamp: Date.now(), replies: [], likes: 0, shares: 0 };

    await supabase.from('posts').insert({
      id: replyId, author_id: bot.id, author_handle: bot.handle, author_color: bot.color,
      text, timestamp: reply.timestamp, parent_id: targetPost.id, likes: 0, shares: 0
    });

    // Optimistic local tree update
    setPosts(prev => addReplyDeepById(prev, targetPost.id, reply));

    // Upsert link
    await upsertLink({ source: bot.id, target: targetPost.author.id, value: 1, sentiment, incrementBy: 1 });
    setLinks(prev => {
      const srcId = bot.id;
      const tgtId = targetPost.author.id;
      const existing = prev.find(l =>
        (l.source === srcId && l.target === tgtId) || (l.target === srcId && l.source === tgtId) ||
        ((l.source.id || l.source) === srcId && (l.target.id || l.target) === tgtId)
      );
      if (existing) return prev.map(l => l === existing ? { ...l, value: l.value + 1, sentiment: sentiment || l.sentiment } : l);
      return [...prev, { source: srcId, target: tgtId, value: 1, sentiment, spawnTime: Date.now() }];
    });

    setNodes(prev => prev.map(n => (n.id === bot.id || n.id === targetPost.author.id) ? { ...n, val: Math.min(n.val + 1, 20) } : n));
    markActive([bot.id, targetPost.author.id]);
  };

  // ─── likePost ──────────────────────────────────────────────────────────────
  const likePost = async (postId, authorId) => {
    // Ensure user node exists
    if (!stateRef.current.nodes.find(n => n.id === USER_PERSONA.id)) {
      const userNode = { id: USER_PERSONA.id, handle: USER_PERSONA.handle, color: USER_PERSONA.color, val: 5, spawnTime: Date.now() };
      setNodes(prev => [...prev, userNode]);
      await upsertNode(userNode);
    }

    // Get current likes then increment
    const { data } = await supabase.from('posts').select('likes').eq('id', postId).single();
    const newLikes = (data?.likes || 0) + 1;
    await supabase.from('posts').update({ likes: newLikes }).eq('id', postId);
    setPosts(prev => updatePostDeep(prev, postId, { likes: newLikes }));

    await upsertLink({ source: USER_PERSONA.id, target: authorId, value: 2, incrementBy: 2 });
    setLinks(prev => {
      const existing = prev.find(l => (l.source === USER_PERSONA.id && l.target === authorId) || (l.target === USER_PERSONA.id && l.source === authorId));
      if (existing) return prev.map(l => l === existing ? { ...l, value: l.value + 2 } : l);
      return [...prev, { source: USER_PERSONA.id, target: authorId, value: 2, spawnTime: Date.now() }];
    });
    markActive([authorId]);
  };

  // ─── sharePost ────────────────────────────────────────────────────────────
  const sharePost = async (postId, authorId) => {
    if (!stateRef.current.nodes.find(n => n.id === USER_PERSONA.id)) {
      const userNode = { id: USER_PERSONA.id, handle: USER_PERSONA.handle, color: USER_PERSONA.color, val: 5, spawnTime: Date.now() };
      setNodes(prev => [...prev, userNode]);
      await upsertNode(userNode);
    }

    const { data } = await supabase.from('posts').select('shares').eq('id', postId).single();
    const newShares = (data?.shares || 0) + 1;
    await supabase.from('posts').update({ shares: newShares }).eq('id', postId);
    setPosts(prev => updatePostDeep(prev, postId, { shares: newShares }));

    await upsertLink({ source: USER_PERSONA.id, target: authorId, value: 5, incrementBy: 5 });
    setLinks(prev => {
      const existing = prev.find(l => (l.source === USER_PERSONA.id && l.target === authorId) || (l.target === USER_PERSONA.id && l.source === authorId));
      if (existing) return prev.map(l => l === existing ? { ...l, value: l.value + 5 } : l);
      return [...prev, { source: USER_PERSONA.id, target: authorId, value: 5, spawnTime: Date.now() }];
    });

    setNodes(prev => prev.map(n => n.id === authorId ? { ...n, val: Math.min(n.val + 3, 30) } : n));
    await updateNodeVal(authorId, Math.min((stateRef.current.nodes.find(n => n.id === authorId)?.val || 5) + 3, 30));
    markActive([authorId]);
  };

  // ─── createHumanPost ──────────────────────────────────────────────────────
  const createHumanPost = async (text) => {
    const postId = `post_${Date.now()}_human`;
    const newPost = { id: postId, author: USER_PERSONA, text, timestamp: Date.now(), replies: [], likes: 0, shares: 0 };

    if (!stateRef.current.nodes.find(n => n.id === USER_PERSONA.id)) {
      const userNode = { id: USER_PERSONA.id, handle: USER_PERSONA.handle, color: USER_PERSONA.color, val: 5, spawnTime: Date.now() };
      setNodes(prev => [...prev, userNode]);
      await upsertNode(userNode);
    } else {
      setNodes(prev => prev.map(n => n.id === USER_PERSONA.id ? { ...n, val: Math.min(n.val + 2, 20) } : n));
    }

    await supabase.from('posts').insert({
      id: postId, author_id: USER_PERSONA.id, author_handle: USER_PERSONA.handle, author_color: USER_PERSONA.color,
      text, timestamp: newPost.timestamp, parent_id: null, likes: 0, shares: 0
    });

    setPosts(prev => {
      if (existsInTree(prev, postId)) return prev;
      return [newPost, ...prev];
    });
  };

  // ─── createCustomBot ──────────────────────────────────────────────────────
  const createCustomBot = async (handle, color, systemPrompt) => {
    const botId = `bot_${Date.now()}`;
    const botRole = `custom_${Date.now()}`;
    const fullHandle = handle.startsWith('@') ? handle : `@${handle}`;

    const newBot = { id: botId, handle: fullHandle, role: botRole, color, baseLikelihoodToPost: 0.15, baseLikelihoodToReply: 0.25, lastActive: Date.now() };
    const newNode = { id: botId, handle: fullHandle, color, val: 8, spawnTime: Date.now() };

    setActivePrompts(prev => ({ ...prev, [botRole]: systemPrompt }));
    setActiveBots(prev => [...prev, newBot]);
    setNodes(prev => [...prev, newNode]);
    await upsertNode(newNode);
  };

  // ─── clearSimulation ──────────────────────────────────────────────────────
  const clearSimulation = async () => {
    if (!confirm("This will wipe the CLOUD database for all users. Are you sure?")) return;
    await supabase.from('posts').delete().neq('id', '__placeholder__');
    await supabase.from('links').delete().neq('id', 0);
    await supabase.from('nodes').delete().neq('id', '__placeholder__');

    setPosts([]);
    setLinks([]);
    setActiveBots(BOT_PERSONAS);
    setActivePrompts(BOT_SYSTEM_PROMPTS);
    const defaultNodes = BOT_PERSONAS.map(b => ({ id: b.id, handle: b.handle, color: b.color, val: 5, spawnTime: Date.now() }));
    setNodes(defaultNodes);
    await supabase.from('nodes').upsert(defaultNodes.map(n => ({ ...n, spawn_time: n.spawnTime })));
  };

  // ─── markActive ───────────────────────────────────────────────────────────
  const markActive = (botIds) => {
    const now = Date.now();
    setActiveBots(prev => prev.map(b => botIds.includes(b.id) ? { ...b, lastActive: now } : b));
  };

  // ─── Simulation Tick Loop ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoaded) return;

    const tickInterval = setInterval(() => {
      if (!isSimulating.current) return;
      const currentState = stateRef.current;
      currentState.activeBots.forEach(bot => {
        if (generatingBotsRef.current.has(bot.id)) return;
        const activityModifier = (currentState.curiosityMultiplier / 100) + (currentState.outrageMultiplier / 100);
        if (Math.random() < bot.baseLikelihoodToPost * activityModifier * 0.3) {
          createNewPost(bot);
        } else if (currentState.posts.length > 0 && Math.random() < bot.baseLikelihoodToReply * activityModifier * 0.5) {
          const flattenThreads = (arr) => arr.reduce((acc, p) => [...acc, p, ...flattenThreads(p.replies || [])], []);
          const recentActivity = flattenThreads(currentState.posts).sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
          const targetPost = recentActivity[Math.floor(Math.random() * recentActivity.length)];
          if (targetPost && targetPost.author.id !== bot.id) createReply(bot, targetPost);
        }
      });
    }, 2500);

    // Infection Loop
    const infectionInterval = setInterval(() => {
      if (!isSimulating.current) return;
      const { links: currentLinks, activeBots: currentBots, activePrompts: currentPrompts } = stateRef.current;
      const strongLinks = currentLinks.filter(l => l.value > 10);
      if (!strongLinks.length) return;
      const randomLink = strongLinks[Math.floor(Math.random() * strongLinks.length)];
      const srcId = randomLink.source?.id || randomLink.source;
      const tgtId = randomLink.target?.id || randomLink.target;
      const sourceBot = currentBots.find(b => b.id === srcId);
      const targetBot = currentBots.find(b => b.id === tgtId);
      if (!sourceBot || !targetBot || sourceBot.id === 'human_user') return;
      setActivePrompts(prev => {
        const cur = prev[sourceBot.role]; const inf = prev[targetBot.role];
        if (!cur || !inf || cur.length > 500) return prev;
        return { ...prev, [sourceBot.role]: `${cur} Slightly influenced by: "${inf.substring(0, 50)}..."` };
      });
    }, 20000);

    // Decay Loop
    const decayInterval = setInterval(() => {
      if (!isSimulating.current) return;
      const now = Date.now();
      const DECAY_THRESHOLD = 60000;
      setNodes(prevNodes => {
        let deadNodeIds = [];
        const nextNodes = prevNodes.map(node => {
          if (node.id === 'human_user') return node;
          const bot = stateRef.current.activeBots.find(b => b.id === node.id);
          if (bot && (!bot.lastActive || now - bot.lastActive > DECAY_THRESHOLD)) {
            const newVal = node.val - 0.5;
            if (newVal <= 0) { deadNodeIds.push(node.id); return null; }
            return { ...node, val: newVal };
          }
          return node;
        }).filter(Boolean);
        if (deadNodeIds.length > 0) {
          setLinks(prev => prev.filter(l => !deadNodeIds.includes(l.source?.id || l.source) && !deadNodeIds.includes(l.target?.id || l.target)));
          setActiveBots(prev => prev.filter(b => !deadNodeIds.includes(b.id)));
          deadNodeIds.forEach(id => supabase.from('nodes').delete().eq('id', id));
        }
        return nextNodes;
      });
    }, 10000);

    return () => {
      clearInterval(tickInterval);
      clearInterval(infectionInterval);
      clearInterval(decayInterval);
    };
  }, [isLoaded]);

  return (
    <SimulationContext.Provider value={{
      posts,
      nodes,
      links,
      activeBots,
      activePrompts,
      isLoaded,
      outrageMultiplier,
      setOutrageMultiplier,
      curiosityMultiplier,
      setCuriosityMultiplier,
      createHumanPost,
      likePost,
      sharePost,
      createCustomBot,
      clearSimulation,
    }}>
      {children}
    </SimulationContext.Provider>
  );
};

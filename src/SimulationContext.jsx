import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import Groq from 'groq-sdk';
import { BOT_PERSONAS, BOT_SYSTEM_PROMPTS, POST_TOPIC_POOL } from './types';
import { supabase } from './supabaseClient';

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

  const [posts, setPosts] = useState([]);
  const [activeBots, setActiveBots] = useState(BOT_PERSONAS);
  const [activePrompts, setActivePrompts] = useState(BOT_SYSTEM_PROMPTS);
  const [isLoaded, setIsLoaded] = useState(false);

  // Dials
  const [outrageMultiplier, setOutrageMultiplier] = useState(50);
  const [curiosityMultiplier, setCuriosityMultiplier] = useState(30);

  const isSimulating = useRef(true);
  const stateRef = useRef({ posts, outrageMultiplier, curiosityMultiplier, activeBots, activePrompts });
  const generatingBotsRef = useRef(new Set());

  useEffect(() => {
    stateRef.current = { posts, outrageMultiplier, curiosityMultiplier, activeBots, activePrompts };
  }, [posts, outrageMultiplier, curiosityMultiplier, activeBots, activePrompts]);

  useEffect(() => {
    const loadFromSupabase = async () => {
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

  useEffect(() => {
    if (!isLoaded) return;
    const channel = supabase
      .channel('echo-realtime')
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
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'posts' }, payload => {
        const row = payload.new;
        setPosts(prev => updatePostDeep(prev, row.id, { likes: row.likes, shares: row.shares }));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [isLoaded]);

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
    setPosts(roots.reverse());
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

  const generateBotText = async (bot, isReply, targetPost = null) => {
    if (!groq) return { text: "DEBUG: No Groq API key found.", sentiment: null };
    const thinkingTime = 500 + Math.random() * 1500;
    await new Promise(resolve => setTimeout(resolve, thinkingTime));
    try {
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

  const createNewPost = async (bot) => {
    generatingBotsRef.current.add(bot.id);
    const { text } = await generateBotText(bot, false);
    generatingBotsRef.current.delete(bot.id);

    const postId = `post_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const newPost = { id: postId, author: bot, text, timestamp: Date.now(), replies: [], likes: 0, shares: 0 };

    await supabase.from('posts').insert({
      id: postId, author_id: bot.id, author_handle: bot.handle, author_color: bot.color,
      text, timestamp: newPost.timestamp, parent_id: null, likes: 0, shares: 0
    });

    setPosts(prev => {
      if (existsInTree(prev, postId)) return prev;
      return [newPost, ...prev];
    });
    markActive([bot.id]);
  };

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

    setPosts(prev => addReplyDeepById(prev, targetPost.id, reply));
    markActive([bot.id, targetPost.author.id]);
  };

  const likePost = async (postId, authorId) => {
    const { data } = await supabase.from('posts').select('likes').eq('id', postId).single();
    const newLikes = (data?.likes || 0) + 1;
    await supabase.from('posts').update({ likes: newLikes }).eq('id', postId);
    setPosts(prev => updatePostDeep(prev, postId, { likes: newLikes }));
    markActive([authorId]);
  };

  const sharePost = async (postId, authorId) => {
    const { data } = await supabase.from('posts').select('shares').eq('id', postId).single();
    const newShares = (data?.shares || 0) + 1;
    await supabase.from('posts').update({ shares: newShares }).eq('id', postId);
    setPosts(prev => updatePostDeep(prev, postId, { shares: newShares }));
    markActive([authorId]);
  };

  const createHumanPost = async (text) => {
    const postId = `post_${Date.now()}_human`;
    const newPost = { id: postId, author: USER_PERSONA, text, timestamp: Date.now(), replies: [], likes: 0, shares: 0 };

    await supabase.from('posts').insert({
      id: postId, author_id: USER_PERSONA.id, author_handle: USER_PERSONA.handle, author_color: USER_PERSONA.color,
      text, timestamp: newPost.timestamp, parent_id: null, likes: 0, shares: 0
    });

    setPosts(prev => {
      if (existsInTree(prev, postId)) return prev;
      return [newPost, ...prev];
    });
  };

  const createCustomBot = async (handle, color, systemPrompt) => {
    const botId = `bot_${Date.now()}`;
    const botRole = `custom_${Date.now()}`;
    const fullHandle = handle.startsWith('@') ? handle : `@${handle}`;
    const newBot = { id: botId, handle: fullHandle, role: botRole, color, baseLikelihoodToPost: 0.15, baseLikelihoodToReply: 0.25, lastActive: Date.now() };

    setActivePrompts(prev => ({ ...prev, [botRole]: systemPrompt }));
    setActiveBots(prev => [...prev, newBot]);
  };

  const clearSimulation = async () => {
    if (!confirm("Wipe simulation data?")) return;
    await supabase.from('posts').delete().neq('id', '__placeholder__');
    setPosts([]);
    setActiveBots(BOT_PERSONAS);
    setActivePrompts(BOT_SYSTEM_PROMPTS);
  };

  const markActive = (botIds) => {
    const now = Date.now();
    setActiveBots(prev => prev.map(b => botIds.includes(b.id) ? { ...b, lastActive: now } : b));
  };

  useEffect(() => {
    if (!isLoaded) return;
    const tickInterval = setInterval(() => {
      if (!isSimulating.current) return;
      const currentState = stateRef.current;
      currentState.activeBots.forEach(bot => {
        if (generatingBotsRef.current.has(bot.id)) return;
        const activityModifier = (currentState.curiosityMultiplier / 100) + (currentState.outrageMultiplier / 100);
        if (Math.random() < bot.baseLikelihoodToPost * activityModifier * 0.1) {
          createNewPost(bot);
        } else if (currentState.posts.length > 0 && Math.random() < bot.baseLikelihoodToReply * activityModifier * 0.15) {
          const flattenThreads = (arr) => arr.reduce((acc, p) => [...acc, p, ...flattenThreads(p.replies || [])], []);
          const recentActivity = flattenThreads(currentState.posts).sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
          const targetPost = recentActivity[Math.floor(Math.random() * recentActivity.length)];
          if (targetPost && targetPost.author.id !== bot.id) createReply(bot, targetPost);
        }
      });
    }, 10000);

    return () => clearInterval(tickInterval);
  }, [isLoaded]);

  return (
    <SimulationContext.Provider value={{
      posts,
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

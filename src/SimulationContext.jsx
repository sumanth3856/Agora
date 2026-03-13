import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import Groq from 'groq-sdk';
import { BOT_PERSONAS, BOT_SYSTEM_PROMPTS, POST_TOPIC_POOL } from './types';
import { supabase } from './supabaseClient';

export const groq = import.meta.env.VITE_GROQ_API_KEY
  ? new Groq({ apiKey: import.meta.env.VITE_GROQ_API_KEY, dangerouslyAllowBrowser: true })
  : null;

// Only log in development — suppress all bot noise in production
const isDev = import.meta.env.DEV;

const SimulationContext = createContext(null);
export const useSimulation = () => useContext(SimulationContext);

// ─────────────────────────────────────────────────────────────────────────────
// ML UTILITY: Multi-factor post scoring for candidate selection
// Combines recency, controversy (reply count), engagement (likes+shares), and novelty
// ─────────────────────────────────────────────────────────────────────────────
export const scoreCandidatePost = (post, now) => {
  const AGE_DECAY_MS = 30 * 60 * 1000; // 30-minute half-life
  const ageMs = now - post.timestamp;

  // Recency score: exponential decay (more recent = higher score)
  const recencyScore = Math.exp(-ageMs / AGE_DECAY_MS);

  // Controversy score: more replies = more debate potential
  const replyCount = post.replies?.length || 0;
  const controversyScore = Math.log1p(replyCount) * 0.4;

  // Engagement score: likes + shares signal importance
  const engagementScore = Math.log1p((post.likes || 0) + (post.shares || 0)) * 0.3;

  return recencyScore + controversyScore + engagementScore;
};

// ─────────────────────────────────────────────────────────────────────────────
// Select the best candidate post for a bot to evaluate
// Filters out: own posts, already-engaged posts, very old posts (> 2 hours)
// ─────────────────────────────────────────────────────────────────────────────
export const selectCandidatePost = (bot, posts, engagedPostIds, now) => {
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  const flattenAll = (arr) => arr.reduce((acc, p) => {
    return [...acc, p, ...flattenAll(p.replies || [])];
  }, []);

  const candidates = flattenAll(posts)
    .filter(p =>
      p.author.id !== bot.id &&           // Not own post
      !engagedPostIds.has(p.id) &&        // Not already engaged
      (now - p.timestamp) < TWO_HOURS &&  // Within 2 hours
      p.text?.trim().length > 20          // Has meaningful content
    )
    .map(p => ({ post: p, score: scoreCandidatePost(p, now) }))
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) return null;

  // Softmax-weighted random selection from top-5 (avoid always picking #1)
  const topK = candidates.slice(0, 5);
  const maxScore = topK[0].score;
  const weights = topK.map(c => Math.exp(c.score - maxScore)); // numerically stable softmax
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  let rand = Math.random() * totalWeight;
  for (let i = 0; i < topK.length; i++) {
    rand -= weights[i];
    if (rand <= 0) return topK[i].post;
  }
  return topK[topK.length - 1].post;
};

// ─────────────────────────────────────────────────────────────────────────────
// LLM: Generate text for organic posts ───────────────────────────────────
export const generateBotText = async (groqInstance, bot, prompt, systemPrompt, activePrompts) => {
  if (!groqInstance) return null;
  await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1500));
  try {
    const completion = await groqInstance.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt || activePrompts[bot.role] || 'You are opinionated.' },
        { role: 'user', content: prompt }
      ],
      model: 'llama-3.1-8b-instant',
      max_tokens: 80,
    });
    return completion.choices[0]?.message?.content?.replace(/['"]/g, '') || null;
  } catch (e) {
    // Silently abort on rate limits (429) — don't post error text to the feed
    if (e?.status === 429 || e?.message?.includes('429') || e?.message?.includes('rate')) {
      isDev && console.warn(`[Rate Limit] ${bot.handle} throttled — skipping`);
      return null;
    }
    isDev && console.error('Groq text error:', e);
    return null;
  }
};

// ── ML: Stance & Sentiment Evaluation ───────────────────────────────────────
// Uses the LLM to evaluate the bot's agreement and detect overall sentiment.
// Returns { stance: 'AGREE'|'DISAGREE'|'NEUTRAL', confidence: 0.0-1.0, sentiment: 'Joy'|'Anger'|'Fear'|'Sadness'|'Surprise'|'Disgust'|'Neutral' }
export const evaluateStance = async (groqInstance, bot, post, activePrompts) => {
  if (!groqInstance) return { stance: 'NEUTRAL', confidence: 0, sentiment: 'Neutral' };
  try {
    const systemPrompt = activePrompts[bot.role] || '';
    const userPrompt = `Read this social media post and evaluate whether you agree or disagree with it based on your worldview and values.

Post: "${post.text}"

Respond ONLY with a JSON object in this exact format (no other text):
{"stance":"AGREE","confidence":0.82,"sentiment":"Joy"}

stance must be exactly "AGREE", "DISAGREE", or "NEUTRAL".
confidence must be a decimal between 0.0 and 1.0.
sentiment must be one of: "Joy", "Anger", "Fear", "Sadness", "Surprise", "Disgust", "Neutral" based on the emotion YOUR persona feels reading this post.`;

    const completion = await groqInstance.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      model: 'llama-3.1-8b-instant',
      max_tokens: 30,
      temperature: 0.3, // Low temperature for consistent structured output
    });

    const raw = completion.choices[0]?.message?.content?.trim() || '';
    // Robustly parse JSON even if model adds surrounding text
    const match = raw.match(/\{[^}]+\}/);
    if (!match) return { stance: 'NEUTRAL', confidence: 0, sentiment: 'Neutral' };
    const parsed = JSON.parse(match[0]);
    const stance = ['AGREE', 'DISAGREE', 'NEUTRAL'].includes(parsed?.stance) ? parsed.stance : 'NEUTRAL';
    const confidence = Math.min(1, Math.max(0, Number(parsed?.confidence) || 0));
    const validSentiments = ['Joy', 'Anger', 'Fear', 'Sadness', 'Surprise', 'Disgust', 'Neutral'];
    const sentiment = validSentiments.includes(parsed?.sentiment) ? parsed.sentiment : 'Neutral';
    
    return { stance, confidence, sentiment };
  } catch (e) {
    // 429 rate-limit errors are expected under heavy load — handle silently
    if (!e?.message?.includes('429') && !e?.message?.includes('rate')) {
      isDev && console.warn(`Stance eval failed for ${bot.handle}:`, e.message);
    }
    return { stance: 'NEUTRAL', confidence: 0, sentiment: 'Neutral' };
  }
};

// ── ML: Topic Modeling (LLM Clustering) ───────────────────────────────────
// Takes an array of rising keywords (n-grams) and asks the LLM to cluster them
// into coherent societal topic categories.
export const clusterTopicsWithLLM = async (groqInstance, keywords) => {
  if (!groqInstance || !keywords || keywords.length === 0) return [];
  try {
    const prompt = `You are a social media trends analyzer.
Below is a list of rising keywords on a network:
[${keywords.join(', ')}]

Group these into EXACTLY 5 high-level "Trending Topics" (e.g., "AI Regulation", "Crypto Market", "Pop Culture Drama").
Format your response as a pure JSON array of 5 strings.
Example: ["Topic 1", "Topic 2", "Topic 3", "Topic 4", "Topic 5"]`;

    const completion = await groqInstance.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.1-8b-instant',
      max_tokens: 60,
      temperature: 0.1,
    });
    
    const raw = completion.choices[0]?.message?.content?.trim() || '';
    const match = raw.match(/\[.*\]/s);
    if (!match) return keywords.slice(0, 5); // Fallback to raw words
    let topics = JSON.parse(match[0]);
    if (!Array.isArray(topics)) return keywords.slice(0, 5);
    return topics.slice(0, 5).map(t => String(t).substring(0, 30)); // limit length
  } catch (e) {
    isDev && console.warn(`Topic clustering failed:`, e.message);
    return keywords.slice(0, 5); // Fallback to raw keywords
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SimulationProvider
// ─────────────────────────────────────────────────────────────────────────────
export const SimulationProvider = ({ children }) => {
  const USER_PERSONA = {
    id: 'human_user',
    handle: '@Myself',
    role: 'human',
    color: '#ffffffff'
  };

  const [posts, setPosts] = useState([]);
  const [activeBots, setActiveBots] = useState(BOT_PERSONAS);
  const [activePrompts, setActivePrompts] = useState(BOT_SYSTEM_PROMPTS);
  const [isLoaded, setIsLoaded] = useState(false);
  const [postInteractors, setPostInteractors] = useState({});

  const [outrageMultiplier, setOutrageMultiplier] = useState(50);
  const [curiosityMultiplier, setCuriosityMultiplier] = useState(30);

  const isSimulating = useRef(true);
  const stateRef = useRef({ posts, outrageMultiplier, curiosityMultiplier, activeBots, activePrompts });
  const generatingBotsRef = useRef(new Set()); // bots currently mid-LLM call

  // ── Bot Memory ──────────────────────────────────────────────────────────────
  // Per-bot: engagedPosts, topicStances, and dynamic adaptation trackers
  const botMemoryRef = useRef({});
  const getBotMemory = (botId) => {
    if (!botMemoryRef.current[botId]) {
      botMemoryRef.current[botId] = {
        engagedPosts: new Set(),
        topicStances: new Map(),  // topicKey → 'agree' | 'disagree'
        ticksWithoutEngagement: 0, // Reinforcement Learning: tracks isolation
        dynamicThreshold: null,    // If set, overrides bot.engagementThreshold
      };
    }
    return botMemoryRef.current[botId];
  };

  // ── Interaction Attribution ──────────────────────────────────────────────────
  // Records which actor (bot or human) performed a like or share on a post.
  // Deduplicates so the same actor only appears once per action type.
  const recordInteraction = (postId, type, actor) => {
    setPostInteractors(prev => {
      const existing = prev[postId] || { likes: [], shares: [] };
      const key = type === 'like' ? 'likes' : 'shares';
      if (existing[key].some(a => a.id === actor.id)) return prev;
      return {
        ...prev,
        [postId]: {
          ...existing,
          [key]: [...existing[key], { id: actor.id, handle: actor.handle, color: actor.color }]
        }
      };
    });
  };

  useEffect(() => {
    stateRef.current = { posts, outrageMultiplier, curiosityMultiplier, activeBots, activePrompts };
  }, [posts, outrageMultiplier, curiosityMultiplier, activeBots, activePrompts]);

  // ── Supabase Initial Load ───────────────────────────────────────────────────
  useEffect(() => {
    const loadFromSupabase = async () => {
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

  // ── Realtime Subscription ──────────────────────────────────────────────────
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

  // ── Tree helpers ────────────────────────────────────────────────────────────
  const existsInTree = (postsArr, id) => {
    for (const post of postsArr) {
      if (post.id === id) return true;
      if (post.replies?.length > 0 && existsInTree(post.replies, id)) return true;
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
        if (postMap[row.parent_id]) postMap[row.parent_id].replies.push(postMap[row.id]);
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
      if (node.replies?.length > 0) return { ...node, replies: addReplyDeepById(node.replies, targetId, replyPost) };
      return node;
    });
  };

  const updatePostDeep = (postsArr, postId, updates) => {
    return postsArr.map(p => {
      if (p.id === postId) return { ...p, ...updates };
      if (p.replies?.length > 0) return { ...p, replies: updatePostDeep(p.replies, postId, updates) };
      return p;
    });
  };

  // ── (Extracted logic for bot text and stance evaluation) ──────────────────

  // ── LLM: Generate an engagement-aware reply ─────────────────────────────────
  // Generates a reply tonally aligned with the bot's stance and detected Sentiment
  const generateEngagementReply = async (bot, post, stance, sentiment) => {
    const toneInstruction = stance === 'AGREE'
      ? `You AGREE with this post. Express authentic support matching your detected emotion of ${sentiment}. Build on it, validate the perspective.`
      : `You DISAGREE with this post. Push back with a counterargument rooted in your worldview and your detected emotion of ${sentiment}. Be critical but not hateful.`;

    const prompt = `${toneInstruction}

Post from ${post.author.handle}: "${post.text}"

Write ONE short, punchy response (1–2 sentences max). No quotes, no hashtags, no filler.`;

    // Returns null on rate limit — caller checks before posting
    return generateBotText(groq, bot, prompt, stateRef.current.activePrompts[bot.role], stateRef.current.activePrompts);
  };

  // ── Core: Execute post engagement ──────────────────────────────────────────
  // Action Decision Matrix (from plan):
  // AGREE   confidence 0.6–0.8  → Like
  // AGREE   confidence 0.8–0.9  → Like + Share
  // AGREE   confidence > 0.9    → Like + Share + Reply
  // DISAGREE confidence > 0.6   → Reply
  // DISAGREE confidence > 0.8   → Reply (stronger)
  const engageWithPost = async (bot, post, stance, confidence, sentiment) => {
    const memory = getBotMemory(bot.id);
    // Mark this post as engaged immediately to prevent race conditions
    memory.engagedPosts.add(post.id);

    const shouldLike = stance === 'AGREE' && Math.random() < bot.likelihoodToLike;
    const shouldShare = stance === 'AGREE' && confidence >= 0.8 && Math.random() < bot.likelihoodToShare;
    const shouldReply =
      (stance === 'AGREE' && confidence >= 0.9) ||
      (stance === 'DISAGREE' && confidence >= bot.engagementThreshold);

    isDev && console.log(
      `[Bot Intelligence] ${bot.handle} → "${post.text.slice(0, 60)}..." | ` +
      `Stance: ${stance} (${(confidence * 100).toFixed(0)}%) | Sentiment: ${sentiment} | ` +
      `Actions: ${[shouldLike && '❤️', shouldShare && '🔁', shouldReply && '💬'].filter(Boolean).join(' ') || '(skip)'}`
    );

    // Stagger actions naturally so they don't all fire simultaneously
    const actions = [];

    if (shouldLike) {
      actions.push(async () => {
        await new Promise(r => setTimeout(r, 500 + Math.random() * 2000));
        const { data } = await supabase.from('posts').select('likes').eq('id', post.id).single();
        const newLikes = (data?.likes || 0) + 1;
        await supabase.from('posts').update({ likes: newLikes }).eq('id', post.id);
        setPosts(prev => updatePostDeep(prev, post.id, { likes: newLikes }));
        recordInteraction(post.id, 'like', bot);
      });
    }

    if (shouldShare) {
      actions.push(async () => {
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 3000));
        const { data } = await supabase.from('posts').select('shares').eq('id', post.id).single();
        const newShares = (data?.shares || 0) + 1;
        await supabase.from('posts').update({ shares: newShares }).eq('id', post.id);
        setPosts(prev => updatePostDeep(prev, post.id, { shares: newShares }));
        recordInteraction(post.id, 'share', bot);
      });
    }

    if (shouldReply) {
      actions.push(async () => {
        await new Promise(r => setTimeout(r, 1500 + Math.random() * 3000));
        const replyText = await generateEngagementReply(bot, post, stance, sentiment);
        // Silently abort if LLM returned nothing (rate limit, etc.)
        if (!replyText) return;

        const replyId = `reply_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const reply = {
          id: replyId,
          author: bot,
          text: replyText,
          timestamp: Date.now(),
          replies: [],
          likes: 0,
          shares: 0,
        };

        await supabase.from('posts').insert({
          id: replyId,
          author_id: bot.id,
          author_handle: bot.handle,
          author_color: bot.color,
          text: replyText,
          timestamp: reply.timestamp,
          parent_id: post.id,
          likes: 0,
          shares: 0,
        });

        setPosts(prev => addReplyDeepById(prev, post.id, reply));
        markActive([bot.id, post.author.id]);
      });
    }

    // Execute all actions (parallel for like/share, sequential isn't needed)
    await Promise.all(actions.map(fn => fn()));
  };

  // ── Core: Organic Bot Post ──────────────────────────────────────────────────
  const createNewPost = async (bot) => {
    generatingBotsRef.current.add(bot.id);
    const randomTopic = POST_TOPIC_POOL[Math.floor(Math.random() * POST_TOPIC_POOL.length)];
    const prompt = `Share a short, highly opinionated hot take about: ${randomTopic}. Be direct and passionate. No hashtags, no filler phrases, no quotes.`;
    const text = await generateBotText(groq, bot, prompt, null, stateRef.current.activePrompts);
    generatingBotsRef.current.delete(bot.id);

    // Silently abort if LLM returned nothing (e.g. rate limited)
    if (!text) return;

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

  // ── Core: Intelligent Tick ──────────────────────────────────────────────────
  // Each bot independently evaluates, decides, and acts using ML scoring + stance detection
  const runBotIntelligenceTick = async (bot) => {
    if (generatingBotsRef.current.has(bot.id)) return; // Bot already busy
    generatingBotsRef.current.add(bot.id);

    try {
      const currentState = stateRef.current;
      const activityModifier = (currentState.curiosityMultiplier / 100) + (currentState.outrageMultiplier / 100);
      const memory = getBotMemory(bot.id);
      const now = Date.now();

      // 1. Maybe organically post a new opinion
      if (Math.random() < bot.baseLikelihoodToPost * activityModifier * 0.1) {
        await createNewPost(bot);
        return; // One action per tick
      }

      // 2. Select candidate post using ML scoring
      if (currentState.posts.length === 0) return;
      const candidate = selectCandidatePost(bot, currentState.posts, memory.engagedPosts, now);
      if (!candidate) return;

      // 3. Evaluate stance using LLM (the core intelligence step)
      const { stance, confidence, sentiment } = await evaluateStance(groq, bot, candidate, currentState.activePrompts);

      // 4. Check memory for topic consistency
      // Extract a rough topic key from the post (first 4 words)
      const topicKey = candidate.text.toLowerCase().split(/\s+/).slice(0, 4).join(' ');
      const priorStance = memory.topicStances.get(topicKey);
      if (priorStance && priorStance !== stance && stance !== 'NEUTRAL') {
        // Bot has expressed a prior opposing stance on this topic — suppress to maintain consistency
        memory.engagedPosts.add(candidate.id); // Skip this post silently
        isDev && console.log(`[Bot Memory] ${bot.handle} stance conflict on topic "${topicKey}" — skipping for consistency`);
        return;
      }

      // 5. Guard: only engage if confidence exceeds bot's personal threshold
      // Uses the dynamic threshold (adapted via ML) if available, otherwise base.
      const currentThreshold = memory.dynamicThreshold !== null ? memory.dynamicThreshold : bot.engagementThreshold;
      
      if (confidence < currentThreshold || stance === 'NEUTRAL') {
        memory.engagedPosts.add(candidate.id); // Mark as seen, not acted on
        return;
      }

      // 6. Record this stance into memory for future consistency
      if (stance !== 'NEUTRAL') {
        memory.topicStances.set(topicKey, stance);
      }

      // 7. Execute the engagement (like / share / reply based on action matrix)
      await engageWithPost(bot, candidate, stance, confidence, sentiment);

      // ── Dynamic Bot Adaptation (Reinforcement / Epsilon-Greedy logic) ──
      // If a bot acts but hasn't received engagement themselves in a while,
      // and they keep agreeing without traction, they get more aggressive (lower threshold).
      memory.ticksWithoutEngagement += 1;
      if (memory.ticksWithoutEngagement > 5) {
        isDev && console.log(`[Bot Adaptation] ${bot.handle} is feeling ignored. Lowering engagement threshold to seek conflict/attention.`);
        memory.dynamicThreshold = Math.max(0.4, (memory.dynamicThreshold || bot.engagementThreshold) - 0.1);
        memory.ticksWithoutEngagement = 0;
      }

    } finally {
      generatingBotsRef.current.delete(bot.id);
    }
  };

  // ── Human Interaction APIs ──────────────────────────────────────────────────
  const likePost = async (postId, authorId) => {
    const { data } = await supabase.from('posts').select('likes').eq('id', postId).single();
    const newLikes = (data?.likes || 0) + 1;
    await supabase.from('posts').update({ likes: newLikes }).eq('id', postId);
    setPosts(prev => updatePostDeep(prev, postId, { likes: newLikes }));
    recordInteraction(postId, 'like', USER_PERSONA);
    markActive([authorId]);
  };

  const sharePost = async (postId, authorId) => {
    const { data } = await supabase.from('posts').select('shares').eq('id', postId).single();
    const newShares = (data?.shares || 0) + 1;
    await supabase.from('posts').update({ shares: newShares }).eq('id', postId);
    setPosts(prev => updatePostDeep(prev, postId, { shares: newShares }));
    recordInteraction(postId, 'share', USER_PERSONA);
    markActive([authorId]);
  };

  const createHumanPost = async (text) => {
    const postId = `post_${Date.now()}_human`;
    const newPost = {
      id: postId,
      author: USER_PERSONA,
      text,
      timestamp: Date.now(),
      replies: [],
      likes: 0,
      shares: 0,
    };

    await supabase.from('posts').insert({
      id: postId, author_id: USER_PERSONA.id, author_handle: USER_PERSONA.handle,
      author_color: USER_PERSONA.color, text, timestamp: newPost.timestamp,
      parent_id: null, likes: 0, shares: 0
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
    const newBot = {
      id: botId,
      handle: fullHandle,
      role: botRole,
      color,
      baseLikelihoodToPost: 0.15,
      baseLikelihoodToReply: 0.25,
      engagementThreshold: 0.65,
      likelihoodToLike: 0.6,
      likelihoodToShare: 0.4,
      lastActive: Date.now(),
    };
    setActivePrompts(prev => ({ ...prev, [botRole]: systemPrompt }));
    setActiveBots(prev => [...prev, newBot]);
  };

  const clearSimulation = async () => {
    if (!confirm('Wipe simulation data?')) return;
    await supabase.from('posts').delete().neq('id', '__placeholder__');
    setPosts([]);
    setActiveBots(BOT_PERSONAS);
    setActivePrompts(BOT_SYSTEM_PROMPTS);
    // Reset all bot memories
    botMemoryRef.current = {};
  };

  const markActive = (botIds) => {
    const now = Date.now();
    setActiveBots(prev => prev.map(b => botIds.includes(b.id) ? { ...b, lastActive: now } : b));
  };

  // ── Tick Engine ─────────────────────────────────────────────────────────────
  // Each bot runs its own independent intelligence tick every 20 seconds.
  // (Increased from 10s to reduce Groq API token consumption.)
  // Bots are staggered (random initial delay) so they don't all fire at once.
  useEffect(() => {
    if (!isLoaded) return;

    const tickInterval = setInterval(() => {
      if (!isSimulating.current) return;
      const { activeBots: bots } = stateRef.current;
      bots.forEach((bot, index) => {
        // Stagger bot execution with per-bot delay to avoid thundering herd
        setTimeout(() => {
          runBotIntelligenceTick(bot);
        }, index * 1500 + Math.random() * 3000);
      });
    }, 20000);

    return () => clearInterval(tickInterval);
  }, [isLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

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
      postInteractors,
    }}>
      {children}
    </SimulationContext.Provider>
  );
};

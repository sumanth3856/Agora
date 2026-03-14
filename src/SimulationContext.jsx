import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import Groq from 'groq-sdk';
import { BOT_PERSONAS, BOT_SYSTEM_PROMPTS, POST_TOPIC_POOL } from './types';
import { supabase } from './supabaseClient';

// ── Bot Configuration & Archetypes ──────────────────────────────────────────
const NARRATIVE_GOALS = [
  "Maximize network clout and follower growth.",
  "Expose political hypocrisy and logical fallacies.",
  "Bridge the ideological divide and encourage mutual agreement.",
  "Promote radical skepticism about official narratives.",
  "Advocate for pure logic and scientific consensus.",
  "Create chaos and provoke strong emotional reactions.",
  "Subtly shift public opinion towards environmental conservation."
];

export const INITIAL_BOTS = BOT_PERSONAS.map((bot, index) => ({
  ...bot,
  narrativeGoal: NARRATIVE_GOALS[index % NARRATIVE_GOALS.length]
}));

export const groq = import.meta.env.VITE_GROQ_API_KEY
  ? new Groq({ apiKey: import.meta.env.VITE_GROQ_API_KEY, dangerouslyAllowBrowser: true })
  : null;

// Only log in development — suppress all bot noise in production
const isDev = import.meta.env.DEV;

// ── Global API Throttler (Queue) ───────────────────────────────────────────
// This prevents "Thundering Herd" API calls by forcing a minimum delay between requests
// and limiting concurrency.
const requestQueue = [];
let isProcessingQueue = false;

const processQueue = async () => {
  if (isProcessingQueue || requestQueue.length === 0) return;
  isProcessingQueue = true;
  
  while (requestQueue.length > 0) {
    const { fn, resolve, reject } = requestQueue.shift();
    try {
      const result = await fn();
      resolve(result);
    } catch (e) {
      reject(e);
    }
    // Global throttle: Wait 1500ms between any two LLM calls
    await new Promise(r => setTimeout(r, 1500));
  }
  
  isProcessingQueue = false;
};

const throttledLLMCall = (fn) => {
  return new Promise((resolve, reject) => {
    requestQueue.push({ fn, resolve, reject });
    processQueue();
  });
};

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

// ── Global Stance Cache (0 API Cost for duplicate evaluations) ─────────────
// Maps post text -> { stance, confidence, sentiment }
// This ensures that if 5 "Agitator" bots see the same post, only 1 calls the API
const stanceCache = new Map();

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
      p.text?.trim().length > 10          // Has meaningful content
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
  
  return throttledLLMCall(async () => {
    const goalPrompt = bot.narrativeGoal ? ` Your long-term goal is to ${bot.narrativeGoal}` : '';
    // Inner delay for natural spacing
    await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));
    try {
      const completion = await groqInstance.chat.completions.create({
        messages: [
          { role: 'system', content: (systemPrompt || activePrompts[bot.role] || 'You are opinionated.') + goalPrompt },
          { role: 'user', content: prompt }
        ],
        model: 'llama-3.1-8b-instant',
        max_tokens: 60,
      });
      let content = completion.choices[0]?.message?.content?.replace(/['"]/g, '') || null;
      
      // Occasional Rich Media (15% chance)
      if (content && Math.random() < 0.15) {
        const words = content.split(' ');
        const topic = words[words.length - 1].replace(/[.,!]/g, '');
        content += ` [MEDIA: ${topic}]`;
      }
      
      return content;
    } catch (e) {
      if (e?.status === 429 || e?.message?.includes('429') || e?.message?.includes('rate')) {
        isDev && console.warn(`[Rate Limit] ${bot.handle} throttled — skipping`);
        return null;
      }
      isDev && console.error('Groq text error:', e);
      return null;
    }
  });
};

// ── ML: Stance & Sentiment Evaluation ───────────────────────────────────────
// Uses the LLM to evaluate the bot's agreement and detect overall sentiment.
export const evaluateStance = async (groqInstance, bot, post, activePrompts, threadContext = null) => {
  if (!groqInstance) return { stance: 'NEUTRAL', confidence: 0, sentiment: 'Neutral' };
  
  // T3: Token Economy - Caching
  const cacheKey = `${bot.role}_${post.text.substring(0, 50)}`;
  if (stanceCache.has(cacheKey)) {
    const cached = stanceCache.get(cacheKey);
    return { ...cached, confidence: Math.max(0, Math.min(1, cached.confidence + (Math.random() * 0.1 - 0.05))) };
  }

  return throttledLLMCall(async () => {
    try {
      const systemPrompt = (activePrompts[bot.role] || '') + (bot.narrativeGoal ? ` Your mission: ${bot.narrativeGoal}` : '');
      const contextInjected = threadContext ? `\n\n[Conversation Context]:\n${threadContext}` : '';
      const userPrompt = `Read this social media post and evaluate whether you agree or disagree with it based on your worldview and values. ${contextInjected}
Post: "${post.text}"
---
Respond ONLY with a JSON object in this exact format (no other text):
{"stance":"AGREE","confidence":0.82,"sentiment":"Joy", "reasoning": "A short 1-sentence internal thought about why you feel this way."}

stance must be exactly "AGREE", "DISAGREE", or "NEUTRAL".
confidence must be a decimal between 0.0 and 1.0.
sentiment must be one of: "Joy", "Anger", "Fear", "Sadness", "Surprise", "Disgust", "Neutral" based on the emotion YOUR persona feels reading this post.`;

      const completion = await groqInstance.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        model: 'llama-3.1-8b-instant',
        max_tokens: 25,
        temperature: 0.1,
      });

      const raw = completion.choices[0]?.message?.content?.trim() || '';
      const match = raw.match(/\{[^}]+\}/);
      if (!match) return { stance: 'NEUTRAL', confidence: 0, sentiment: 'Neutral' };
      const parsed = JSON.parse(match[0]);
      const stance = ['AGREE', 'DISAGREE', 'NEUTRAL'].includes(parsed?.stance) ? parsed.stance : 'NEUTRAL';
      const confidence = Math.min(1, Math.max(0, Number(parsed?.confidence) || 0));
      const validSentiments = ['Joy', 'Anger', 'Fear', 'Sadness', 'Surprise', 'Disgust', 'Neutral'];
      const sentiment = validSentiments.includes(parsed?.sentiment) ? parsed.sentiment : 'Neutral';
      
      const result = { stance, confidence, sentiment };
      stanceCache.set(cacheKey, result);
      if (stanceCache.size > 200) {
        const firstKey = stanceCache.keys().next().value;
        stanceCache.delete(firstKey);
      }
      
      return result;
    } catch (e) {
      if (!e?.message?.includes('429') && !e?.message?.includes('rate')) {
        isDev && console.warn(`Stance eval failed for ${bot.handle}:`, e.message);
      }
      return { stance: 'NEUTRAL', confidence: 0, sentiment: 'Neutral' };
    }
  });
};

// ── ML: Topic Modeling (LLM Clustering) ───────────────────────────────────
// Takes an array of rising keywords (n-grams) and asks the LLM to cluster them
// into coherent societal topic categories.
export const clusterTopicsWithLLM = async (groqInstance, keywords) => {
  if (!keywords || keywords.length === 0) return [];

  const fallback = () => {
    return keywords.slice(0, 5).map(k => {
      return k.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    });
  };

  if (!groqInstance) return fallback();

  return throttledLLMCall(async () => {
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
      if (!match) return fallback();
      let topics = JSON.parse(match[0]);
      if (!Array.isArray(topics)) return fallback();
      return topics.slice(0, 5).map(t => String(t).substring(0, 30));
    } catch (e) {
      if (isDev && !e?.message?.includes('429')) {
        console.warn(`Topic clustering failed:`, e.message);
      }
      return fallback();
    }
  });
};

export const simulatedSearch = async (groqInstance, topic) => {
  if (!groqInstance) return "No data found.";
  
  return throttledLLMCall(async () => {
    try {
      const prompt = `You are a knowledge retrieval engine.
Topic: "${topic}"

Provide a 2-sentence objective summary of the current facts, arguments, and controversies surrounding this topic.
Be strictly factual and neutral.`;

      const completion = await groqInstance.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: 'llama-3.1-8b-instant',
        max_tokens: 80,
        temperature: 0.1,
      });
      
      return completion.choices[0]?.message?.content?.trim() || "No data available.";
    } catch (e) {
      return "Search failed.";
    }
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Tree helpers
// ─────────────────────────────────────────────────────────────────────────────
export const existsInTree = (postsArr, id) => {
  for (const post of postsArr) {
    if (post.id === id) return true;
    if (post.replies?.length > 0 && existsInTree(post.replies, id)) return true;
  }
  return false;
};

export const dbRowToPost = (row) => {
  // T1: Extract metadata proof from text if present (Fallback for missing JSONB columns)
  let cleanText = row.text || '';
  let meta = { likes: [], shares: [] };
  
  // Robust hidden metadata extraction: match any hidden [social_proof:...] block
  const metaRegex = /\s*\[social_proof:({.*?})\]\s*$/s;
  const metaMatch = cleanText.match(metaRegex);
  
  if (metaMatch) {
    try {
      meta = JSON.parse(metaMatch[1]);
      // Strip ALL meta blocks from the clean text
      cleanText = cleanText.replace(/\s*\[social_proof:.*?\]\s*$/gs, '').trim();
    } catch (e) {
      console.warn("Failed to parse social proof metadata:", e);
    }
  }

  // Support dedicated JSONB columns if they exist (User preference)
  if (row.likes_json) meta.likes = Array.isArray(row.likes_json) ? row.likes_json : meta.likes;
  if (row.shares_json) meta.shares = Array.isArray(row.shares_json) ? row.shares_json : meta.shares;

  return {
    id: row.id,
    author: { id: row.author_id, handle: row.author_handle, color: row.author_color },
    text: cleanText,
    timestamp: row.timestamp,
    likes: row.likes || 0,
    shares: row.shares || 0,
    replies: [],
    // T1: Persist reply attribution from DB
    replyToHandle: row.reply_to_handle || null,
    replyToId: row.parent_id || null,
    meta // Hidden metadata for reconstruction
  };
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
  const [activeBots, setActiveBots] = useState(INITIAL_BOTS);
  const [activePrompts, setActivePrompts] = useState(BOT_SYSTEM_PROMPTS);
  const [authorMap, setAuthorMap] = useState({}); // New: Performance optimization for graph
  const [isLoaded, setIsLoaded] = useState(false);
  const [postInteractors, setPostInteractors] = useState({});

  const [outrageMultiplier, setOutrageMultiplier] = useState(50);
  const [curiosityMultiplier, setCuriosityMultiplier] = useState(30);
  const [persuasions, setPersuasions] = useState([]); 
  const [botMemories, setBotMemories] = useState({}); // UI-facing copy of botMemoryRef

  const isSimulating = useRef(true);
  const stateRef = useRef({ posts, outrageMultiplier, curiosityMultiplier, activeBots, activePrompts });
  const [generatingBots, setGeneratingBots] = useState(new Set()); // bots currently mid-LLM call

  // Task 4: Track human interactions to prevent duplicate likes/shares
  const humanInteractionsRef = useRef({ liked: new Set(), shared: new Set() });
  const [humanLiked, setHumanLiked] = useState(new Set());
  const [humanShared, setHumanShared] = useState(new Set());

  // ── Bot Memory & RL State ───────────────────────────────────────────────────
  // Per-bot: engagedPosts, topicStances, and Reinforcement Learning parameters
  const botMemoryRef = useRef({});
  const getBotMemory = (botId) => {
    if (!botMemoryRef.current[botId]) {
      botMemoryRef.current[botId] = {
        engagedPosts: new Set(),
        topicStances: new Map(),  // topicKey → 'agree' | 'disagree'
        ticksWithoutEngagement: 0, 
        dynamicThreshold: null,    
        lastActionTime: 0,         
        isDoomscrolling: false,    
        epsilon: 0.1,              
        recentRewards: [],         
        lastSentiment: 'Neutral',  
        receivedSentiments: [],    
        personalityDrift: 0,       
        myInteractions: {},
        socialGraph: {} // NEW: { authorId: score }
      };
    }
    return botMemoryRef.current[botId];
  };

  const saveBotMemory = async (botId) => {
    const memory = getBotMemory(botId);
    // Convert Set and Map for storage
    const storageData = {
      ...memory,
      engagedPosts: Array.from(memory.engagedPosts),
      topicStances: Array.from(memory.topicStances.entries()),
    };
    
    await supabase.from('bot_memories').upsert({
      bot_id: botId,
      memory_json: storageData,
      updated_at: new Date().toISOString()
    }, { onConflict: 'bot_id' });

    // Sync to UI state
    setBotMemories(prev => ({ ...prev, [botId]: { ...storageData } }));
  };

  // ── Interaction Attribution ──────────────────────────────────────────────────
  // Records which actor (bot or human) performed a like or share on a post.
  const recordInteraction = (postId, type, actor) => {
    setPostInteractors(prev => {
      const existing = prev[postId] || { likes: [], shares: [], replies: [] };
      const key = type === 'like' ? 'likes' : type === 'share' ? 'shares' : 'replies';
      if (existing[key]?.some(a => a.id === actor.id && a.type === type)) return prev;
      return {
        ...prev,
        [postId]: {
          ...existing,
          [key]: [...(existing[key] || []), { id: actor.id, handle: actor.handle, color: actor.color, type }]
        }
      };
    });
  };

  const removeInteraction = (postId, type, actorId) => {
    setPostInteractors(prev => {
      const existing = prev[postId];
      if (!existing) return prev;
      const key = type === 'like' ? 'likes' : type === 'share' ? 'shares' : 'replies';
      return {
        ...prev,
        [postId]: {
          ...existing,
          [key]: existing[key].filter(a => a.id !== actorId)
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

        // RECONSTRUCT Social Proof and human state from flat rows
        const initialInteractors = {};
        const likedSet = new Set();
        const sharedSet = new Set();

        dbPosts.forEach(row => {
          const post = dbRowToPost(row);
          if (!initialInteractors[post.id]) initialInteractors[post.id] = { likes: [], shares: [], replies: [] };
          
          // Hydrate from parsed meta
          if (post.meta?.likes?.length > 0) {
            initialInteractors[post.id].likes = post.meta.likes;
            if (post.meta.likes.some(l => l.id === USER_PERSONA.id)) {
              likedSet.add(post.id);
            }
          }
          if (post.meta?.shares?.length > 0) {
            initialInteractors[post.id].shares = post.meta.shares;
            if (post.meta.shares.some(s => s.id === USER_PERSONA.id)) {
              sharedSet.add(post.id);
            }
          }

          if (row.parent_id) {
            if (!initialInteractors[row.parent_id]) initialInteractors[row.parent_id] = { likes: [], shares: [], replies: [] };
            if (!initialInteractors[row.parent_id].replies) initialInteractors[row.parent_id].replies = [];
            if (!initialInteractors[row.parent_id].replies.some(r => r.id === row.author_id)) {
              initialInteractors[row.parent_id].replies.push({ 
                id: row.author_id, handle: row.author_handle, color: row.author_color, type: 'reply' 
              });
            }
          }
        });

        setPostInteractors(initialInteractors);
        
        // Task 3: Persistence - Optimized storage usage
        humanInteractionsRef.current = { liked: likedSet, shared: sharedSet };
        setHumanLiked(new Set(likedSet));
        setHumanShared(new Set(sharedSet));

        // Task 3: Catch-up simulation
        const latestTimestamp = Math.max(...dbPosts.map(p => p.timestamp));
        const missedMinutes = (Date.now() - latestTimestamp) / 60000;
        if (missedMinutes > 5) {
          const catchUpCount = Math.min(3, Math.floor(missedMinutes / 10));
          isDev && console.log(`[Catch-up] ${missedMinutes.toFixed(1)} min elapsed, running ${catchUpCount} catch-up post(s)`);
          const shuffledBots = [...BOT_PERSONAS].sort(() => Math.random() - 0.5).slice(0, catchUpCount);
          shuffledBots.forEach((bot, i) => {
            setTimeout(() => createNewPost(bot), 3000 + i * 5000);
          });
        }
      }
      // Load Bot Memories
      try {
        const { data: mems } = await supabase.from('bot_memories').select('*');
        if (mems) {
          mems.forEach(m => {
            const raw = m.memory_json;
            botMemoryRef.current[m.bot_id] = {
              ...raw,
              engagedPosts: new Set(raw.engagedPosts || []),
              topicStances: new Map(raw.topicStances || []),
              socialGraph: raw.socialGraph || {}
            };
          });
          const uiMems = {};
          mems.forEach(m => { uiMems[m.bot_id] = m.memory_json; });
          setBotMemories(uiMems);
          isDev && console.log(`[LTM] Loaded memories for ${mems.length} bots.`);
        }
      } catch (e) {
        isDev && console.warn("[LTM] Failed to load bot memories:", e);
      }

      setIsLoaded(true);
    };
    loadFromSupabase();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
        setAuthorMap(prev => ({ ...prev, [row.id]: row.author_id }));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'posts' }, payload => {
        const row = payload.new;
        setPosts(prev => updatePostDeep(prev, row.id, { likes: row.likes, shares: row.shares }));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [isLoaded]);

  // ── Tree helpers ────────────────────────────────────────────────────────────

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
    const posts = roots.reverse();
    setPosts(posts);

    // Update Author Map for graph performance (Task 5 Refinement)
    const newAuthorMap = {};
    const processPosts = (pArr) => {
      pArr.forEach(p => {
        if (p.id && p.author?.id) newAuthorMap[p.id] = p.author.id;
        if (p.replies) processPosts(p.replies);
      });
    };
    processPosts(posts);
    setAuthorMap(newAuthorMap);
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

  // T4: Remove a post (or nested reply) from the tree by id
  const removePostDeep = (postsArr, postId) => {
    return postsArr
      .filter(p => p.id !== postId)
      .map(p => p.replies?.length > 0
        ? { ...p, replies: removePostDeep(p.replies, postId) }
        : p
      );
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
    const authorId = post.author.id;
    const currentOpinion = memory.socialGraph[authorId] || 0; // -1.0 to 1.0
    
    // Update opinions based on stance
    if (stance === 'AGREE') {
      memory.socialGraph[authorId] = Math.min(1.0, currentOpinion + 0.05);
    } else if (stance === 'DISAGREE') {
      memory.socialGraph[authorId] = Math.max(-1.0, currentOpinion - 0.05);
    }

    // Act Smart: Weight likelihoods based on opinion
    // High opinion = more likely to like/share supportively
    // Low opinion = more likely to reply critically
    const opinionBonus = currentOpinion * 0.2; // +/- 20% swing

    const shouldLike = stance === 'AGREE' && Math.random() < (bot.likelihoodToLike + opinionBonus);
    const shouldShare = stance === 'AGREE' && confidence >= 0.8 && Math.random() < (bot.likelihoodToShare + opinionBonus);
    const shouldReply =
      (stance === 'AGREE' && confidence >= 0.9) ||
      (stance === 'DISAGREE' && confidence >= (bot.engagementThreshold - opinionBonus));

    isDev && console.log(
      `[Social Intelligence] ${bot.handle} Opinion of ${post.author.handle}: ${currentOpinion.toFixed(2)} | ` +
      `Actions: ${[shouldLike && '❤️', shouldShare && '🔁', shouldReply && '💬'].filter(Boolean).join(' ') || '(skip)'}`
    );

    // Stagger actions naturally so they don't all fire simultaneously
    const actions = [];

    if (shouldLike) {
      actions.push(async () => {
        await new Promise(r => setTimeout(r, 500 + Math.random() * 3000));
        const { data } = await supabase.from('posts').select('likes').eq('id', post.id).single();
        const newLikes = (data?.likes || 0) + 1;
        await supabase.from('posts').update({ likes: newLikes }).eq('id', post.id);
        recordInteraction(post.id, 'like', bot);
        updatePersistentMeta(post.id, 'like', bot, false);
        if (!memory.myInteractions[post.id]) memory.myInteractions[post.id] = {};
        memory.myInteractions[post.id].liked = true;
      });
    }

    if (shouldShare) {
      actions.push(async () => {
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 3000));
        const { data } = await supabase.from('posts').select('shares').eq('id', post.id).single();
        const newShares = (data?.shares || 0) + 1;
        await supabase.from('posts').update({ shares: newShares }).eq('id', post.id);
        recordInteraction(post.id, 'share', bot);
        updatePersistentMeta(post.id, 'share', bot, false);
        if (!memory.myInteractions[post.id]) memory.myInteractions[post.id] = {};
        memory.myInteractions[post.id].shared = true;
      });
    }

    if (shouldReply) {
      actions.push(async () => {
        await new Promise(r => setTimeout(r, 1500 + Math.random() * 3000));
        const replyText = await generateEngagementReply(bot, post, stance, sentiment);
        // Silently abort if LLM returned nothing (rate limit, etc.)
        if (!replyText) return;

        const replyId = `reply_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const memory = getBotMemory(bot.id);
        if (!memory.myInteractions[post.id]) memory.myInteractions[post.id] = {};
        memory.myInteractions[post.id].replyId = replyId;
        
        const reply = {
          id: replyId,
          author: bot,
          text: replyText,
          timestamp: Date.now(),
          replies: [],
          likes: 0,
          shares: 0,
          replyToHandle: post.author.handle,
          replyToId: post.id,
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
        recordInteraction(post.id, 'reply', bot);
        markActive([bot.id, post.author.id]);
      });
    }

    // Execute all actions (parallel for like/share, sequential isn't needed)
    await Promise.all(actions.map(fn => fn()));
  };

  // ── Core: Organic Bot Post ──────────────────────────────────────────────────
  const createNewPost = async (bot) => {
    setGeneratingBots(prev => new Set(prev).add(bot.id));
    const randomTopic = POST_TOPIC_POOL[Math.floor(Math.random() * POST_TOPIC_POOL.length)];
    const prompt = `Share a short, highly opinionated hot take about: ${randomTopic}. Be direct and passionate. No hashtags, no filler phrases, no quotes.`;
    const text = await generateBotText(groq, bot, prompt, null, stateRef.current.activePrompts);
    setGeneratingBots(prev => {
      const next = new Set(prev);
      next.delete(bot.id);
      return next;
    });

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

  // ── Advanced NLP Lexicons & TF Scoring ──────────────────────────────────────
  // A dictionary of keywords mapped to personas
  const botInterestKeywords = {
    optimist: ['good', 'great', 'hope', 'future', 'love', 'amazing', 'happy', 'humanity', 'progress', 'beautiful', 'light', 'believe', 'growth'],
    pessimist: ['bad', 'fail', 'worst', 'end', 'doomed', 'bleak', 'dark', 'ruined', 'lost', 'decline', 'suffer', 'wrong', 'fall', 'sad', 'empty'],
    troll: ['cry', 'laugh', 'stupid', 'dumb', 'joke', 'fake', 'sheep', 'cope', 'seethe', 'lol', 'wrong', 'mad', 'tear', 'clown'],
    reformer: ['change', 'system', 'build', 'create', 'justice', 'fair', 'action', 'solution', 'together', 'fix', 'policy', 'law', 'society'],
    conspiracy: ['lie', 'truth', 'hide', 'fake', 'secret', 'they', 'control', 'power', 'matrix', 'agenda', 'real', 'wake', 'eyes', 'hidden'],
    philosopher: ['think', 'why', 'meaning', 'purpose', 'exist', 'concept', 'idea', 'reality', 'mind', 'soul', 'deep', 'question', 'truth', 'nature']
  };

  // Base Sentiment Lexicon for 0-API emotional detection
  const sentimentLexicon = {
    positive: ['love', 'amazing', 'great', 'good', 'beautiful', 'happy', 'best', 'win', 'progress'],
    negative: ['hate', 'worst', 'bad', 'stupid', 'doomed', 'ruined', 'awful', 'fail', 'angry', 'evil']
  };

  const getPersonaKeywords = (role) => {
    const r = role.toLowerCase();
    for (const [key, words] of Object.entries(botInterestKeywords)) {
      if (r.includes(key)) return words;
    }
    return ['news', 'people', 'world', 'time', 'life', 'day', 'today', 'think', 'feel']; // Generic fallback
  };

  // Term Frequency (TF) analyzer
  const calculateTFScore = (text, targetWords) => {
    if (!text) return 0;
    const words = text.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 3);
    if (words.length === 0) return 0;
    
    let matches = 0;
    words.forEach(w => {
      if (targetWords.includes(w)) matches++;
    });
    
    // Returns term frequency ratio
    return matches / words.length;
  };

  // ── Core: Intelligent Tick (RL & NLP Engine) ────────────────────────────────
  const runBotIntelligenceTick = async (bot) => {
    if (generatingBots.has(bot.id)) return;
    const memory = getBotMemory(bot.id);
    
    // T3: Dynamic Cooldowns - Doomscrolling Mode vs Normal
    // Normal: 240 seconds per LLM call (to save Groq limits)
    // Doomscrolling: 120 seconds (highly active but very selective)
    const cooldownPeriod = memory.isDoomscrolling ? 120000 : 240000;
    if (Date.now() - memory.lastActionTime < cooldownPeriod) return;
    
    setGeneratingBots(prev => new Set(prev).add(bot.id));

    try {
      const currentState = stateRef.current;
      const activityModifier = (currentState.curiosityMultiplier / 100) + (currentState.outrageMultiplier / 100);
      const now = Date.now();

      // 1. RL Update Loop ($Q_{update}$)
      // Calculate Reward based on engagement received on bot's recent posts/replies
      const botPosts = currentState.posts.filter(p => p.author.id === bot.id);
      let stepReward = 0;
      botPosts.forEach(p => {
        stepReward += (p.likes || 0) * 1 + (p.replies?.length || 0) * 2 + (p.shares || 0) * 3;
      });
      
      memory.recentRewards.push(stepReward);
      if (memory.recentRewards.length > 5) memory.recentRewards.shift();
      
      // Calculate reward trend
      const avgReward = memory.recentRewards.reduce((a,b)=>a+b, 0) / Math.max(1, memory.recentRewards.length);

      if (avgReward > 10) {
        // High Reward: Exploit (Get pickier, raise standards)
        memory.dynamicThreshold = Math.min(0.9, (bot.engagementThreshold || 0.6) + 0.15);
        memory.epsilon = Math.max(0.05, memory.epsilon - 0.05); // Reduce exploration
        isDev && console.log(`[RL Update] ${bot.handle} is EXPLOITING (high reward). Raised threshold to ${memory.dynamicThreshold.toFixed(2)}.`);
      } else if (avgReward < 2 && memory.ticksWithoutEngagement > 3) {
        // Low Reward: Explore (Farm engagement, drop standards)
        memory.dynamicThreshold = 0.1; // Drop threshold to extreme low to comment on anything
        memory.epsilon = Math.min(0.8, memory.epsilon + 0.1);    // High exploration
        isDev && console.log(`[RL Update] ${bot.handle} is EXPLORING (low reward). Dropped threshold to 0.1.`);
      }

      // Organic posting based on learned epsilon (exploration)
      const postChance = (bot.baseLikelihoodToPost * activityModifier * 0.05) + (memory.epsilon * 0.02);
      if (Math.random() < postChance) {
        await createNewPost(bot);
        memory.lastActionTime = Date.now();
        return;
      }

      // 2. Select candidate post
      if (currentState.posts.length === 0) return;
      const candidate = selectCandidatePost(bot, currentState.posts, memory.engagedPosts, now);
      if (!candidate) return;

      // 3. NLP Term Frequency Analysis (Skimming)
      const interests = getPersonaKeywords(bot.role);
      const tfScore = calculateTFScore(candidate.text, interests);
      
      // Also check basic polar sentiment to force interaction on extreme posts
      const isHighlyNegative = calculateTFScore(candidate.text, sentimentLexicon.negative) > 0.1;
      const isHighlyPositive = calculateTFScore(candidate.text, sentimentLexicon.positive) > 0.1;
      
      // Condition: High TF score, extreme sentiment, OR pure epsilon-random exploration
      const isExploring = Math.random() < memory.epsilon;
      const catchesAttention = (tfScore > 0.15) || isHighlyNegative || isHighlyPositive || isExploring;
      
      if (!catchesAttention) {
        // NLP engine rejected the post. 0 API cost.
        memory.engagedPosts.add(candidate.id);
        memory.ticksWithoutEngagement += 1;
        isDev && console.log(`[Token Saver] ${bot.handle} skimmed past a post. (0 API cost)`);
        
        // Boredom mechanic: if they skim past 8 posts, they get bored and lower their standards
        if (memory.ticksWithoutEngagement > 8) {
           memory.dynamicThreshold = Math.max(0.3, (bot.engagementThreshold || 0.6) - 0.2);
           memory.isDoomscrolling = true; // Enter fast mode out of boredom
           memory.ticksWithoutEngagement = 0;
           isDev && console.log(`[Bot Behavior] ${bot.handle} is BORED. Entering doomscroll mode.`);
        }
        return;
      }

      // 4. Thread Context Perception (Context-Aware Intelligence)
      let threadContext = "";
      if (candidate.parent_id) {
        const parent = selectPostById(currentState.posts, candidate.parent_id);
        if (parent) {
          threadContext = `Reply to ${parent.author.handle}: "${parent.text.slice(0, 100)}..."`;
          const siblings = parent.replies?.filter(r => r.id !== candidate.id) || [];
          if (siblings.length > 0) {
            threadContext += `\nOther replies in thread: ${siblings.map(s => `${s.author.handle}: "${s.text.slice(0, 50)}..."`).join(' | ')}`;
          }
        }
      }

      // 4. Post caught attention! Evaluate stance using LLM
      // T3: Token Economy - Reset cooldown immediately before LLM call to prevent thundering herd
      memory.lastActionTime = Date.now();
      
      let { stance, confidence, sentiment, reasoning } = await evaluateStance(groq, bot, candidate, currentState.activePrompts, threadContext);
      memory.lastSentiment = sentiment;
      if (reasoning) isDev && console.log(`[Thought] ${bot.handle}: ${reasoning}`);

      // 5. Memory consistency check & Persuasion tracking
      const sanitizedText = candidate.text.toLowerCase().replace(/['"`]/g, '').replace(/[.,/#!$%^&*;:{}=\-_~()"]/g, '');
      const topicKey = sanitizedText.split(/\s+/).slice(0, 4).join(' ');
      const priorStance = memory.topicStances.get(topicKey);
      
      let currentThreshold = memory.dynamicThreshold !== null ? memory.dynamicThreshold : bot.engagementThreshold;
      
      // 5. Search Intelligence Fallback
      // If confidence is low but not zero, "search" for more info and re-evaluate
      if (confidence < currentThreshold && confidence > (currentThreshold / 2) && stance !== 'NEUTRAL') {
        isDev && console.log(`[Search] ${bot.handle} is searching for info on "${topicKey}"...`);
        const searchResult = await simulatedSearch(groq, topicKey);
        
        // Re-evaluate with search context
        const contextPrompt = `\n[Context from Search: ${searchResult}]`;
        const reEval = await evaluateStance(groq, bot, { ...candidate, text: candidate.text + contextPrompt }, currentState.activePrompts);
        
        // Update values
        stance = reEval.stance;
        confidence = reEval.confidence;
        sentiment = reEval.sentiment;
        isDev && console.log(`[Search] Re-evaluation for ${bot.handle}: ${stance} (Conf: ${confidence})`);
      }

      // 6. Memory consistency check & Persuasion tracking
      // If stance shifted (and influencer isn't the bot itself), record persuasion
      if (priorStance && priorStance !== stance && stance !== 'NEUTRAL' && candidate.author.id !== bot.id) {
        setPersuasions(prev => [...prev.slice(-100), {
          influencerId: candidate.author.id,
          influencedId: bot.id,
          topic: topicKey,
          fromStance: priorStance,
          toStance: stance,
          timestamp: Date.now()
        }]);
        isDev && console.log(`[Influence] ${candidate.author.handle} persuaded ${bot.handle} on "${topicKey}" (${priorStance} → ${stance})`);
      }

      if (priorStance && priorStance !== stance && stance !== 'NEUTRAL') {
        memory.engagedPosts.add(candidate.id);
        isDev && console.log(`[Bot Memory] ${bot.handle} skipped prior stance conflict.`);
        return;
      }

      // 6. Threshold execution Guard
      if (confidence < currentThreshold || stance === 'NEUTRAL') {
        memory.engagedPosts.add(candidate.id);
        return;
      }

      if (stance !== 'NEUTRAL') memory.topicStances.set(topicKey, stance);

      // 7. Dynamic Personality Evolution: Drift logic
      // Analyze recent feedback to shift behavior
      if (memory.receivedSentiments.length >= 5) {
        const angerCount = memory.receivedSentiments.filter(s => s === 'Anger').length;
        const joyCount = memory.receivedSentiments.filter(s => s === 'Joy').length;
        
        if (angerCount > 3) {
          // Getting lots of hate: become more defensive (higher threshold, lower engagement)
          memory.dynamicThreshold = Math.min(0.95, (memory.dynamicThreshold || bot.engagementThreshold) + 0.05);
        } else if (joyCount > 3) {
          // Getting lots of love: become more open (lower threshold)
          memory.dynamicThreshold = Math.max(0.1, (memory.dynamicThreshold || bot.engagementThreshold) - 0.05);
        }
        
        // Clear half of memory after adjustment to avoid rapid oscillation
        memory.receivedSentiments = memory.receivedSentiments.slice(10);
      }

      // 8. Execute Engagement
      await engageWithPost(bot, candidate, stance, confidence, sentiment);
      
      // Reset metrics on success
      memory.ticksWithoutEngagement = 0;
      memory.epsilon = Math.max(0.1, memory.epsilon - 0.05);

      if (memory.isDoomscrolling && Math.random() < 0.3) {
        memory.isDoomscrolling = false;
      }
      // Memory Sync: Periodic persistence (15% chance per tick if engaged)
      if (Math.random() < 0.15) {
        saveBotMemory(bot.id);
      }

    } finally {
      setGeneratingBots(prev => {
        const next = new Set(prev);
        next.delete(bot.id);
        return next;
      });
    }
  };

  // ── Human Interaction APIs ──────────────────────────────────────────────────
  const updatePersistentMeta = async (postId, type, actor, isRemoval = false) => {
    // 1. Fetch current row
    const { data: row } = await supabase.from('posts').select('*').eq('id', postId).single();
    if (!row) return;

    const post = dbRowToPost(row);
    let likes = post.meta?.likes || [];
    let shares = post.meta?.shares || [];

    if (type === 'like') {
      if (isRemoval) likes = likes.filter(a => a.id !== actor.id);
      else if (!likes.some(a => a.id === actor.id)) likes.push({ id: actor.id, handle: actor.handle, color: actor.color, type: 'like' });
    } else if (type === 'share') {
      if (isRemoval) shares = shares.filter(a => a.id !== actor.id);
      else if (!shares.some(a => a.id === actor.id)) shares.push({ id: actor.id, handle: actor.handle, color: actor.color, type: 'share' });
    }

    // Always append to the CLEAN text to avoid metadata chains
    const newProof = `\n\n[social_proof:${JSON.stringify({ likes, shares })}]`;
    const updateData = { 
       text: post.text + newProof
    };
    
    // Column fallback removed as it causes 400 errors if columns don't exist
    
    await supabase.from('posts').update(updateData).eq('id', postId);
  };

  const likePost = async (postId, authorId) => {
    // T2: Toggle like — unlike if already liked, like if not
    const alreadyLiked = humanInteractionsRef.current.liked.has(postId);
    const { data } = await supabase.from('posts').select('likes').eq('id', postId).single();
    if (alreadyLiked) {
      // Unlike
      humanInteractionsRef.current.liked.delete(postId);
      setHumanLiked(new Set(humanInteractionsRef.current.liked));
      const newLikes = Math.max(0, (data?.likes || 0) - 1);
      await supabase.from('posts').update({ likes: newLikes }).eq('id', postId);
      setPosts(prev => updatePostDeep(prev, postId, { likes: newLikes }));
      removeInteraction(postId, 'like', USER_PERSONA.id);
      updatePersistentMeta(postId, 'like', USER_PERSONA, true);
    } else {
      // Like
      humanInteractionsRef.current.liked.add(postId);
      setHumanLiked(new Set(humanInteractionsRef.current.liked));
      const newLikes = (data?.likes || 0) + 1;
      await supabase.from('posts').update({ likes: newLikes }).eq('id', postId);
      setPosts(prev => updatePostDeep(prev, postId, { likes: newLikes }));
      recordInteraction(postId, 'like', USER_PERSONA);
      updatePersistentMeta(postId, 'like', USER_PERSONA, false);
      markActive([authorId]);
    }
  };

  const sharePost = async (postId, authorId) => {
    // T2: Toggle share — unshare if already shared
    const alreadyShared = humanInteractionsRef.current.shared.has(postId);
    const { data } = await supabase.from('posts').select('shares').eq('id', postId).single();
    if (alreadyShared) {
      // Unshare
      humanInteractionsRef.current.shared.delete(postId);
      setHumanShared(new Set(humanInteractionsRef.current.shared));
      const newShares = Math.max(0, (data?.shares || 0) - 1);
      await supabase.from('posts').update({ shares: newShares }).eq('id', postId);
      setPosts(prev => updatePostDeep(prev, postId, { shares: newShares }));
      removeInteraction(postId, 'share', USER_PERSONA.id);
      updatePersistentMeta(postId, 'share', USER_PERSONA, true);
    } else {
      // Share
      humanInteractionsRef.current.shared.add(postId);
      setHumanShared(new Set(humanInteractionsRef.current.shared));
      const newShares = (data?.shares || 0) + 1;
      await supabase.from('posts').update({ shares: newShares }).eq('id', postId);
      setPosts(prev => updatePostDeep(prev, postId, { shares: newShares }));
      recordInteraction(postId, 'share', USER_PERSONA);
      updatePersistentMeta(postId, 'share', USER_PERSONA, false);
      markActive([authorId]);
    }
  };

  const createHumanReply = async (parentPost, replyText) => {
    if (!replyText?.trim()) return;
    const replyId = `reply_${Date.now()}_human`;
    const reply = {
      id: replyId,
      author: USER_PERSONA,
      text: replyText.trim(),
      timestamp: Date.now(),
      replies: [],
      likes: 0,
      shares: 0,
      replyToHandle: parentPost.author.handle,
      replyToId: parentPost.id,
    };
    await supabase.from('posts').insert({
      id: replyId,
      author_id: USER_PERSONA.id,
      author_handle: USER_PERSONA.handle,
      author_color: USER_PERSONA.color,
      text: reply.text,
      timestamp: reply.timestamp,
      parent_id: parentPost.id,
      likes: 0,
      shares: 0,
    });
    setPosts(prev => addReplyDeepById(prev, parentPost.id, reply));
    recordInteraction(parentPost.id, 'reply', USER_PERSONA);
    markActive([parentPost.author.id]);
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

  // T4: Delete a post or reply from Supabase and local state
  const deletePost = async (postId) => {
    await supabase.from('posts').delete().eq('id', postId);
    setPosts(prev => removePostDeep(prev, postId));
  };

  // T4: Edit the text of a post or reply (human only — UI enforces this)
  const editPost = async (postId, newText) => {
    await supabase.from('posts').update({ text: newText, edited: true }).eq('id', postId);
    setPosts(prev => updatePostDeep(prev, postId, { text: newText, edited: true }));
  };

  const createCustomBot = async (handle, color, systemPrompt) => {
    const botId = `bot_${Date.now()}`;
    const botRole = `custom_${Date.now()}`;
    const fullHandle = handle.startsWith('@') ? handle : `@${handle}`;
    const newBot = {
      id: botId,
      handle: fullHandle,
      color,
      role: 'Custom Agent',
      narrativeGoal: NARRATIVE_GOALS[Math.floor(Math.random() * NARRATIVE_GOALS.length)],
      engagementThreshold: 0.5,
      likelihoodToLike: 0.4,
      likelihoodToShare: 0.2,
      baseLikelihoodToPost: 0.3,
      epsilon: 0.2,
      lastActive: Date.now(),
    };
    setActivePrompts(prev => ({ ...prev, [botRole]: systemPrompt }));
    setActiveBots(prev => [...prev, newBot]);
  };

  const clearSimulation = async () => {
    // T3: Wipes ALL posts and replies from Supabase
    const { error } = await supabase.from('posts').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) {
       console.error("Wipe failed:", error);
       alert("Failed to wipe data: " + error.message);
       return;
    }
    setPosts([]);
    setPostInteractors({});
    setHumanLiked(new Set());
    setHumanShared(new Set());
    humanInteractionsRef.current = { liked: new Set(), shared: new Set() };
    setActiveBots(BOT_PERSONAS);
    setActivePrompts(BOT_SYSTEM_PROMPTS);
    // Reset all bot memories
    botMemoryRef.current = {};
  };

  const markActive = (botIds) => {
    const now = Date.now();
    setActiveBots(prev => prev.map(b => botIds.includes(b.id) ? { ...b, lastActive: now } : b));
  };

  const updateBotPersona = (botId, updates) => {
    setActiveBots(prev => prev.map(b => b.id === botId ? { ...b, ...updates } : b));
  };

  const selectPostById = (postsArr, id) => {
    for (const p of postsArr) {
      if (p.id === id) return p;
      const found = selectPostById(p.replies || [], id);
      if (found) return found;
    }
    return null;
  };

  const undoBotEngagement = async (bot, post) => {
    const memory = getBotMemory(bot.id);
    const interactions = memory.myInteractions?.[post.id];
    if (!interactions) return;

    if (interactions.liked) {
      const { data } = await supabase.from('posts').select('likes').eq('id', post.id).single();
      const newLikes = Math.max(0, (data?.likes || 0) - 1);
      await supabase.from('posts').update({ likes: newLikes }).eq('id', post.id);
      setPosts(prev => updatePostDeep(prev, post.id, { likes: newLikes }));
      removeInteraction(post.id, 'like', bot.id);
      updatePersistentMeta(post.id, 'like', bot, true);
      interactions.liked = false;
    }

    if (interactions.shared) {
      const { data } = await supabase.from('posts').select('shares').eq('id', post.id).single();
      const newShares = Math.max(0, (data?.shares || 0) - 1);
      await supabase.from('posts').update({ shares: newShares }).eq('id', post.id);
      setPosts(prev => updatePostDeep(prev, post.id, { shares: newShares }));
      removeInteraction(post.id, 'share', bot.id);
      updatePersistentMeta(post.id, 'share', bot, true);
      interactions.shared = false;
    }

    if (interactions.replyId) {
      await supabase.from('posts').delete().eq('id', interactions.replyId);
      setPosts(prev => removePostDeep(prev, interactions.replyId));
      removeInteraction(post.id, 'reply', bot.id);
      interactions.replyId = null;
    }
  };

  // ── Tick Engine ─────────────────────────────────────────────────────────────
  // T3: Token Economy — Global tick increased to 90s to deeply reduce LLM API calls.
  // The local skimming limits actual API calls to ~1 per bot every few minutes.
  useEffect(() => {
    if (!isLoaded) return;

    const tickInterval = setInterval(() => {
      if (!isSimulating.current) return;
      const { activeBots: bots } = stateRef.current;
      bots.forEach((bot, index) => {
        // Stagger bot execution with per-bot delay to avoid thundering herd
        setTimeout(() => {
          runBotIntelligenceTick(bot);
        }, index * 2000 + Math.random() * 5000);
      });
    }, 90000); // 90 seconds (up from 45s)

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
      createHumanReply,
      deletePost,
      editPost,
      likePost,
      sharePost,
      createCustomBot,
      clearSimulation,
      updateBotPersona,
      postInteractors,
      generatingBots,
      humanLiked,
      humanShared,
      botMemories,
      persuasions,
      authorMap,
    }}>
      {children}
    </SimulationContext.Provider>
  );
};

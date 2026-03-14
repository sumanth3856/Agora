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
// ─────────────────────────────────────────────────────────────────────────────
export const scoreCandidatePost = (post, now) => {
  const AGE_DECAY_MS = 30 * 60 * 1000; // 30-minute half-life
  const ageMs = now - post.timestamp;

  // Recency score: exponential decay
  const recencyScore = Math.exp(-ageMs / AGE_DECAY_MS);

  // Controversy score: more replies = more debate potential
  const replyCount = post.replies?.length || 0;
  const controversyScore = Math.log1p(replyCount) * 0.4;

  // Engagement score: likes + shares signal importance
  const engagementScore = Math.log1p((post.likes || 0) + (post.shares || 0)) * 0.3;

  // Human Priority Boost: Drastically increase score for human posts to capture bot attention
  const humanBoost = (post.author.id === 'human_user' || post.author.id === 'user-123') ? 1.5 : 0;

  // Thread Momentum: Boost for posts that are replies (joining an existing conversation)
  const momentumBoost = post.replyToId ? 0.2 : 0;

  return recencyScore + controversyScore + engagementScore + humanBoost + momentumBoost;
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

// ── UTILS: Stable hashing for cache keys ──────────────────────────────────────
const hashString = (str) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
};

// ── ML: Stance & Sentiment Evaluation ───────────────────────────────────────
// Uses the LLM to evaluate the bot's agreement and detect overall sentiment.
export const evaluateStance = async (groqInstance, bot, post, activePrompts, threadContext = null) => {
  if (!groqInstance) return { stance: 'NEUTRAL', confidence: 0, sentiment: 'Neutral', reasoning: null };
  
  // T3: Multi-tier Token Economy - Caching
  const textHash = hashString(post.text);
  const cacheKey = `${bot.role}_${textHash}`;
  
  // Tier 1: Memory Cache (Instant)
  if (stanceCache.has(cacheKey)) {
    const cached = stanceCache.get(cacheKey);
    return { ...cached, confidence: Math.max(0, Math.min(1, cached.confidence + (Math.random() * 0.1 - 0.05))) };
  }

  // Tier 2: Supabase Cache (Persistent)
  try {
    // maybeSingle() prevents 406 error when record is not found
    const { data: persistentRecord } = await supabase.from('intelligence_cache').select('eval_data').eq('text_hash', cacheKey).maybeSingle();
    if (persistentRecord) {
      const result = persistentRecord.eval_data;
      stanceCache.set(cacheKey, result);
      return result;
    }
  } catch (err) {
    // Ignore silenty, continue to LLM
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
      if (!match) return { stance: 'NEUTRAL', confidence: 0, sentiment: 'Neutral', reasoning: null };
      const parsed = JSON.parse(match[0]);
      const stance = ['AGREE', 'DISAGREE', 'NEUTRAL'].includes(parsed?.stance) ? parsed.stance : 'NEUTRAL';
      const confidence = Math.min(1, Math.max(0, Number(parsed?.confidence) || 0));
      const validSentiments = ['Joy', 'Anger', 'Fear', 'Sadness', 'Surprise', 'Disgust', 'Neutral'];
      const sentiment = validSentiments.includes(parsed?.sentiment) ? parsed.sentiment : 'Neutral';
      
      const result = { stance, confidence, sentiment, reasoning: parsed?.reasoning || null };
      
      // Update both caches
      stanceCache.set(cacheKey, result);
      await supabase.from('intelligence_cache').upsert({ text_hash: cacheKey, eval_data: result }, { onConflict: 'text_hash' });
      
      if (stanceCache.size > 200) {
        const firstKey = stanceCache.keys().next().value;
        stanceCache.delete(firstKey);
      }
      
      return result;
    } catch (e) {
      if (!e?.message?.includes('429') && !e?.message?.includes('rate')) {
        isDev && console.warn(`Stance eval failed for ${bot.handle}:`, e.message);
      }
      return { stance: 'NEUTRAL', confidence: 0, sentiment: 'Neutral', reasoning: null };
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
  return {
    id: row.id,
    author: { id: row.author_id, handle: row.author_handle, color: row.author_color },
    text: row.text || '',
    thought: row.thought || null, // Persisted internal monologue
    timestamp: row.timestamp,
    likes: row.likes || 0,
    shares: row.shares || 0,
    replies: [],
    replyToHandle: row.reply_to_handle || null,
    replyToId: row.parent_id || null,
    meta: { likes: [], shares: [] }
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
      try {
        // 1. Load Simulation Settings
        const { data: settings, error: settingsError } = await supabase.from('simulation_settings').select('*').eq('id', 'global').single();
        if (settingsError) isDev && console.warn("[DB] Settings load failed:", settingsError);
        if (settings) {
          setOutrageMultiplier(settings.outrage_multiplier);
          setCuriosityMultiplier(settings.curiosity_multiplier);
        }

        // 2. Load Custom Bots so we have them for interaction mapping
        const { data: customBots } = await supabase.from('custom_bots').select('*');
        const formattedCustom = (customBots || []).map(b => ({
          id: b.id, handle: b.handle, role: b.role, color: b.color,
          baseLikelihoodToPost: b.base_likelihood_to_post, baseLikelihoodToReply: b.base_likelihood_to_reply,
          engagementThreshold: b.engagement_threshold, likelihoodToLike: b.likelihood_to_like,
          likelihoodToShare: b.likelihood_to_share, narrativeGoal: b.narrative_goal, lastActive: Date.now()
        }));
        
        const allBots = [...INITIAL_BOTS, ...formattedCustom];
        setActiveBots(allBots);
        
        const newPrompts = {};
        (customBots || []).forEach(b => { newPrompts[b.role] = b.system_prompt; });
        setActivePrompts(prev => ({ ...prev, ...newPrompts }));

        // 3. Load Posts
        const { data: dbPosts, error: postsError } = await supabase.from('posts').select('*').order('timestamp', { ascending: true });
        if (postsError) throw postsError;
        if (!dbPosts) return;
        setPostsFromFlat(dbPosts);

        // 4. Load Interactions and map them using allBots
        const initialInteractors = {};
        const likedSet = new Set();
        const sharedSet = new Set();
        const { data: dbInteractions } = await supabase.from('post_interactions').select('*');
        
        if (dbInteractions) {
          dbInteractions.forEach(intr => {
            if (!initialInteractors[intr.post_id]) initialInteractors[intr.post_id] = { likes: [], shares: [], replies: [] };
            const actor = allBots.find(b => b.id === intr.actor_id) || (intr.actor_id === USER_PERSONA.id ? USER_PERSONA : null);
            if (actor) {
              const entry = { id: actor.id, handle: actor.handle, color: actor.color, type: intr.type };
              if (intr.type === 'like') {
                initialInteractors[intr.post_id].likes.push(entry);
                if (intr.actor_id === USER_PERSONA.id) likedSet.add(intr.post_id);
              } else if (intr.type === 'share') {
                initialInteractors[intr.post_id].shares.push(entry);
                if (intr.actor_id === USER_PERSONA.id) sharedSet.add(intr.post_id);
              }
            }
          });
        }

        // 5. Calculate Reply Attribution
        dbPosts.forEach(row => {
          if (row.parent_id) {
            if (!initialInteractors[row.parent_id]) initialInteractors[row.parent_id] = { likes: [], shares: [], replies: [] };
            if (!initialInteractors[row.parent_id].replies.some(r => r.id === row.author_id)) {
              initialInteractors[row.parent_id].replies.push({ 
                id: row.author_id, handle: row.author_handle, color: row.author_color, type: 'reply' 
              });
            }
          }
        });

        setPostInteractors(initialInteractors);
        humanInteractionsRef.current = { liked: likedSet, shared: sharedSet };
        setHumanLiked(new Set(likedSet));
        setHumanShared(new Set(sharedSet));

        // 6. Catch-up logic
        const latestTimestamp = Math.max(...dbPosts.map(p => p.timestamp), 0);
        const missedMinutes = (Date.now() - latestTimestamp) / 60000;
        if (missedMinutes > 5 && dbPosts.length > 0) {
          const catchUpCount = Math.min(3, Math.floor(missedMinutes / 10));
          isDev && console.log(`[Catch-up] ${missedMinutes.toFixed(1)} min elapsed, running ${catchUpCount} catch-up post(s)`);
          [...allBots].sort(() => Math.random() - 0.5).slice(0, catchUpCount).forEach((bot, i) => {
            setTimeout(() => createNewPost(bot), 3000 + i * 5000);
          });
        }

        // 7. Load Bot Memories
        const { data: mems, error: memsError } = await supabase.from('bot_memories').select('*');
        if (memsError) isDev && console.warn("[DB] Memories load failed:", memsError);
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
        isDev && console.warn("[DB] Load failed:", e);
      } finally {
        setIsLoaded(true);
      }
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
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'custom_bots' }, payload => {
        const row = payload.new;
        setActiveBots(prev => {
          if (prev.find(b => b.id === row.id)) return prev;
          const uiBot = {
            id: row.id, handle: row.handle, role: row.role, color: row.color,
            baseLikelihoodToPost: row.base_likelihood_to_post,
            baseLikelihoodToReply: row.base_likelihood_to_reply,
            engagementThreshold: row.engagement_threshold,
            likelihoodToLike: row.likelihood_to_like,
            likelihoodToShare: row.likelihood_to_share,
            narrativeGoal: row.narrative_goal,
            lastActive: Date.now()
          };
          return [...prev, uiBot];
        });
        setActivePrompts(prev => ({ ...prev, [row.role]: row.system_prompt }));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'custom_bots' }, payload => {
        const row = payload.new;
        setActiveBots(prev => prev.map(b => b.id === row.id ? { 
          ...b, 
          handle: row.handle, color: row.color,
          baseLikelihoodToPost: row.base_likelihood_to_post,
          baseLikelihoodToReply: row.base_likelihood_to_reply,
          engagementThreshold: row.engagement_threshold,
          likelihoodToLike: row.likelihood_to_like,
          likelihoodToShare: row.likelihood_to_share
        } : b));
        setActivePrompts(prev => ({ ...prev, [row.role]: row.system_prompt }));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'custom_bots' }, payload => {
        const row = payload.old;
        setActiveBots(prev => prev.filter(b => b.id !== row.id));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'simulation_settings' }, payload => {
        isDev && console.log("[Realtime] Settings update received:", payload);
        const row = payload.new;
        if (row && row.id === 'global') {
          setOutrageMultiplier(row.outrage_multiplier);
          setCuriosityMultiplier(row.curiosity_multiplier);
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'post_interactions' }, payload => {
        const intr = payload.new || payload.old;
        if (!intr) return;
        
        if (payload.eventType === 'INSERT') {
          // Robust lookup using latest bots from ref to avoid closure staleness
          const currentBots = stateRef.current.activeBots;
          const actor = currentBots.find(b => b.id === intr.actor_id) || (intr.actor_id === USER_PERSONA.id ? USER_PERSONA : null);
          if (actor) {
            recordInteraction(intr.post_id, intr.type, actor);
          }
        } else if (payload.eventType === 'DELETE') {
          removeInteraction(intr.post_id, intr.type, intr.actor_id);
        }
      })
      .subscribe((status) => {
        isDev && console.log(`[Realtime] Sync channel status: ${status}`);
      });

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

  const addReplyDeepById = (arr, id, reply) => arr.map(p => p.id === id ? (p.replies.find(r => r.id === reply.id) ? p : { ...p, replies: [...p.replies, reply] }) : { ...p, replies: addReplyDeepById(p.replies || [], id, reply) });
  const updatePostDeep = (arr, id, up) => arr.map(p => p.id === id ? { ...p, ...up } : { ...p, replies: updatePostDeep(p.replies || [], id, up) });
  const removePostDeep = (arr, id) => arr.filter(p => p.id !== id).map(p => ({ ...p, replies: removePostDeep(p.replies || [], id) }));

  // ── (Extracted logic for bot text and stance evaluation) ──────────────────

  // ── LLM: Generate an engagement-aware reply ─────────────────────────────────
  // Generates a reply tonally aligned with the bot's stance and detected Sentiment
  const generateEngagementReply = async (bot, post, stance, sentiment) => {
    const memory = getBotMemory(bot.id);
    const opinion = memory.socialGraph[post.author.id] || 0;
    
    let toneInstruction = stance === 'AGREE'
      ? `You AGREE with this post. Express authentic support matching your detected emotion of ${sentiment}. Build on it, validate the perspective.`
      : `You DISAGREE with this post. Push back with a counterargument rooted in your worldview and your detected emotion of ${sentiment}. Be critical but not hateful.`;

    // Incorporate Social Opinion into tone
    if (opinion > 0.5) toneInstruction += " Since you really like/trust this person, be extra supportive and friendly.";
    if (opinion < -0.5) toneInstruction += " Since you dislike/distrust this person, be extra sharp, skeptical, or dismissive.";

    const intentContext = post.thought ? `\n\n[Author's Internal Intent]: "${post.thought}"` : '';

    const prompt = `${toneInstruction}${intentContext}

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

    // T5: Sentiment Feedback Loop - Track how authors are perceived
    const authorMemory = getBotMemory(authorId);
    if (authorMemory) {
      authorMemory.receivedSentiments.push(sentiment);
      if (authorMemory.receivedSentiments.length > 20) authorMemory.receivedSentiments.shift();
    }

    // Act Smart: Weight likelihoods based on opinion (Social Memory)
    // Alliances (>0.5 opinion) and Rivalries (<-0.5 opinion)
    const isAlly = currentOpinion > 0.5;
    const isRival = currentOpinion < -0.5;
    
    const opinionBonus = currentOpinion * 0.3; // Increased to +/- 30% swing
    
    const shouldLike = stance === 'AGREE' && Math.random() < (bot.likelihoodToLike + opinionBonus + (isAlly ? 0.2 : 0));
    const shouldShare = stance === 'AGREE' && confidence >= 0.7 && Math.random() < (bot.likelihoodToShare + opinionBonus + (isAlly ? 0.15 : 0));
    const shouldReply =
      (stance === 'AGREE' && confidence >= 0.8) || 
      (stance === 'DISAGREE' && confidence >= (bot.engagementThreshold - opinionBonus - (isRival ? 0.3 : 0))) ||
      (isRival && stance === 'DISAGREE' && Math.random() < 0.4); // Rivals love to argue even with low confidence

    isDev && console.log(
      `[Social Intelligence] ${bot.handle} Opinion of ${post.author.handle}: ${currentOpinion.toFixed(2)} (${isAlly ? 'Ally' : isRival ? 'Rival' : 'Neutral'}) | ` +
      `Actions: ${[shouldLike && '❤️', shouldShare && '🔁', shouldReply && '💬'].filter(Boolean).join(' ') || '(skip)'}`
    );

    // Stagger actions naturally so they don't all fire simultaneously
    const actions = [];

    const runAction = (type, delay) => actions.push(async () => {
      await new Promise(r => setTimeout(r, delay + Math.random() * 3000));
      const { data } = await supabase.from('posts').select(type + 's').eq('id', post.id).single();
      await supabase.from('posts').update({ [type + 's']: (data?.[type + 's'] || 0) + 1 }).eq('id', post.id);
      recordInteraction(post.id, type, bot);
      await supabase.from('post_interactions').insert({ post_id: post.id, actor_id: bot.id, type });
      if (!memory.myInteractions[post.id]) memory.myInteractions[post.id] = {};
      memory.myInteractions[post.id][type === 'like' ? 'liked' : 'shared'] = true;
    });

    if (shouldLike) runAction('like', 500);
    if (shouldShare) runAction('share', 1000);

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
    
    try {
      const currentState = stateRef.current;
      const recentPosts = currentState.posts.slice(0, 5);
      const feedContext = recentPosts.map(p => `${p.author.handle}: "${p.text.slice(0, 40)}..."`).join(' | ');
      
      // 1. Internal Deliberation (Determine Topic & Intent)
      const thoughtPrompt = `Look at the recent feed activity: [${feedContext}]. 
Based on your persona and mission (${bot.narrativeGoal || 'opinionated participation'}), what specific topic or angle are you currently thinking about? 
Respond with a short 1-sentence internal monologue of your intent (e.g., "I'm seeing too much optimism, I need to bring some harsh reality to this thread.").`;
      
      const internalThought = await generateBotText(groq, bot, thoughtPrompt, "You are thinking to yourself.", currentState.activePrompts);
      
      // 2. Generation of actual post based on thought
      const postPrompt = `Basing your post on your current thought: "${internalThought || 'I want to share a hot take.'}".
Share a short, highly opinionated post. Be direct and passionate. No hashtags, no filler, no quotes.`;
      
      const text = await generateBotText(groq, bot, postPrompt, null, currentState.activePrompts);

      setGeneratingBots(prev => {
        const next = new Set(prev);
        next.delete(bot.id);
        return next;
      });

      if (!text) return;

      const postId = `post_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const newPost = { 
        id: postId, 
        author: bot, 
        text, 
        thought: internalThought,
        timestamp: Date.now(), 
        replies: [], 
        likes: 0, 
        shares: 0 
      };

      await supabase.from('posts').insert({
        id: postId, 
        author_id: bot.id, 
        author_handle: bot.handle, 
        author_color: bot.color,
        text, 
        thought: internalThought,
        timestamp: newPost.timestamp, 
        parent_id: null, 
        likes: 0, 
        shares: 0
      });

      setPosts(prev => {
        if (existsInTree(prev, postId)) return prev;
        return [newPost, ...prev];
      });
      markActive([bot.id]);
    } catch (e) {
      isDev && console.error("[Social Brain] Post generation failed:", e);
      setGeneratingBots(prev => {
        const next = new Set(prev);
        next.delete(bot.id);
        return next;
      });
    }
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
      const sanitizedText = candidate.text.toLowerCase().replace(/[^a-z\s]/g, '');
      const interests = getPersonaKeywords(bot.role);
      const tfScore = calculateTFScore(candidate.text, interests);
      
      // Also check basic polar sentiment to force interaction on extreme posts
      const isHighlyNegative = calculateTFScore(candidate.text, sentimentLexicon.negative) > 0.1;
      const isHighlyPositive = calculateTFScore(candidate.text, sentimentLexicon.positive) > 0.1;

      // Human Attention Boost: bots are much more likely to pay attention to human users
      const isHumanPost = candidate.author.id === 'human_user' || candidate.author.id === 'user-123';
      const humanAttentionModifier = isHumanPost ? 0.4 : 0;
      
      // Condition: High TF score, extreme sentiment, OR pure epsilon-random exploration
      const isExploring = Math.random() < (memory.epsilon + humanAttentionModifier);
      const catchesAttention = (tfScore > 0.15) || isHighlyNegative || isHighlyPositive || isExploring || isHumanPost;
      
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
      let momentumBoost = 0;
      if (candidate.parent_id) {
        const parent = selectPostById(currentState.posts, candidate.parent_id);
        if (parent) {
          momentumBoost = 0.15; // Higher engagement on threads
          threadContext = `Reply to ${parent.author.handle}: "${parent.text.slice(0, 100)}..."`;
          const siblings = parent.replies?.filter(r => r.id !== candidate.id) || [];
          if (siblings.length > 0) {
            momentumBoost += 0.05 * siblings.length; // More replies = more momentum
            threadContext += `\nOther replies in thread: ${siblings.map(s => `${s.author.handle}: "${s.text.slice(0, 50)}..."`).join(' | ')}`;
          }
        }
      }

      // 4. Post caught attention! Evaluate stance using LLM
      // T3: Token Economy - Reset cooldown immediately before LLM call to prevent thundering herd
      memory.lastActionTime = Date.now();
      
      let { stance, confidence, sentiment, reasoning } = await evaluateStance(groq, bot, candidate, currentState.activePrompts, threadContext);
      
      // Apply momentum boost to confidence
      confidence = Math.min(1.0, confidence + momentumBoost);
      memory.lastSentiment = sentiment;
      if (reasoning) isDev && console.log(`[Thought] ${bot.handle}: ${reasoning}`);

      // 6. Memory consistency check & Persuasion tracking
      const topicBaseText = candidate.text.toLowerCase().replace(/['"`]/g, '').replace(/[.,/#!$%^&*;:{}=\-_~()"]/g, '');
      const topicKey = topicBaseText.split(/\s+/).slice(0, 4).join(' ');
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

  const likePost = async (postId, authorId) => {
    // T2: Toggle like — unlike if already liked, like if not
    const alreadyLiked = humanInteractionsRef.current.liked.has(postId);
    const { data: postData } = await supabase.from('posts').select('likes').eq('id', postId).maybeSingle();
    if (!postData) return; // Post might have been deleted
    if (alreadyLiked) {
      // Unlike
      humanInteractionsRef.current.liked.delete(postId);
      setHumanLiked(new Set(humanInteractionsRef.current.liked));
      const newLikes = Math.max(0, (data?.likes || 0) - 1);
      await supabase.from('posts').update({ likes: newLikes }).eq('id', postId);
      setPosts(prev => updatePostDeep(prev, postId, { likes: newLikes }));
      removeInteraction(postId, 'like', USER_PERSONA.id);
      await supabase.from('post_interactions').delete().match({ post_id: postId, actor_id: USER_PERSONA.id, type: 'like' });
    } else {
      // Like
      humanInteractionsRef.current.liked.add(postId);
      setHumanLiked(new Set(humanInteractionsRef.current.liked));
      const newLikes = (data?.likes || 0) + 1;
      await supabase.from('posts').update({ likes: newLikes }).eq('id', postId);
      setPosts(prev => updatePostDeep(prev, postId, { likes: newLikes }));
      recordInteraction(postId, 'like', USER_PERSONA);
      await supabase.from('post_interactions').insert({ post_id: postId, actor_id: USER_PERSONA.id, type: 'like' });
      markActive([authorId]);
    }
  };

  const sharePost = async (postId, authorId) => {
    // T2: Toggle share — unshare if already shared
    const alreadyShared = humanInteractionsRef.current.shared.has(postId);
    const { data: postData } = await supabase.from('posts').select('shares').eq('id', postId).maybeSingle();
    if (!postData) return;
    if (alreadyShared) {
      // Unshare
      humanInteractionsRef.current.shared.delete(postId);
      setHumanShared(new Set(humanInteractionsRef.current.shared));
      const newShares = Math.max(0, (data?.shares || 0) - 1);
      await supabase.from('posts').update({ shares: newShares }).eq('id', postId);
      setPosts(prev => updatePostDeep(prev, postId, { shares: newShares }));
      removeInteraction(postId, 'share', USER_PERSONA.id);
      await supabase.from('post_interactions').delete().match({ post_id: postId, actor_id: USER_PERSONA.id, type: 'share' });
    } else {
      // Share
      humanInteractionsRef.current.shared.add(postId);
      setHumanShared(new Set(humanInteractionsRef.current.shared));
      const newShares = (data?.shares || 0) + 1;
      await supabase.from('posts').update({ shares: newShares }).eq('id', postId);
      setPosts(prev => updatePostDeep(prev, postId, { shares: newShares }));
      recordInteraction(postId, 'share', USER_PERSONA);
      await supabase.from('post_interactions').insert({ post_id: postId, actor_id: USER_PERSONA.id, type: 'share' });
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
      thought: null, // Humans don't have simulated thoughts yet
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
      author_color: USER_PERSONA.color, text, thought: null, timestamp: newPost.timestamp,
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
    const fullHandle = handle.startsWith('@') ? handle : `@${handle}`;
    const botRole = `custom_${Date.now()}`;
    const newBot = {
      id: `bot_${Date.now()}`,
      handle: fullHandle,
      color,
      role: botRole,
      system_prompt: systemPrompt,
      narrative_goal: NARRATIVE_GOALS[Math.floor(Math.random() * NARRATIVE_GOALS.length)],
      engagement_threshold: 0.5,
      likelihood_to_like: 0.4,
      likelihood_to_share: 0.2,
      base_likelihood_to_post: 0.3,
      base_likelihood_to_reply: 0.3
    };

    const { error } = await supabase.from('custom_bots').insert(newBot);
    if (error) {
      console.error("Failed to create custom bot:", error);
      return;
    }

    const uiBot = {
      ...newBot,
      baseLikelihoodToPost: newBot.base_likelihood_to_post,
      baseLikelihoodToReply: newBot.base_likelihood_to_reply,
      engagementThreshold: newBot.engagement_threshold,
      likelihoodToLike: newBot.likelihood_to_like,
      likelihoodToShare: newBot.likelihood_to_share,
      lastActive: Date.now()
    };

    setActivePrompts(prev => ({ ...prev, [botRole]: systemPrompt }));
    setActiveBots(prev => [...prev, uiBot]);
  };

  const deleteCustomBot = async (botId) => {
    const { error } = await supabase.from('custom_bots').delete().eq('id', botId);
    if (error) {
      console.error("Failed to delete custom bot:", error);
      return;
    }
    setActiveBots(prev => prev.filter(b => b.id !== botId));
  };

  const clearSimulation = async () => {
    // T3: Wipes ALL posts and replies from Supabase
    const { error: postError } = await supabase.from('posts').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (postError) {
       console.error("Wipe posts failed:", postError);
       alert("Failed to wipe posts: " + postError.message);
       return;
    }
    
    // Also wipe custom bots and interactions
    await supabase.from('post_interactions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    const { error: botError } = await supabase.from('custom_bots').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (botError) {
      console.error("Wipe bots failed:", botError);
    }

    setPosts([]);
    setPostInteractors({});
    setHumanLiked(new Set());
    setHumanShared(new Set());
    humanInteractionsRef.current = { liked: new Set(), shared: new Set() };
    setActiveBots(BOT_PERSONAS);
    setActivePrompts(BOT_SYSTEM_PROMPTS);
    // Reset simulation settings
    setOutrageMultiplier(50);
    setCuriosityMultiplier(30);
    await supabase.from('simulation_settings').upsert({ id: 'global', outrage_multiplier: 50, curiosity_multiplier: 30 }, { onConflict: 'id' });

    // Reset all bot memories
    botMemoryRef.current = {};
  };

  const resetBotMemory = (botId) => {
    delete botMemoryRef.current[botId];
    setBotMemories({ ...botMemoryRef.current });
  };

  const markActive = (botIds) => {
    const now = Date.now();
    setActiveBots(prev => prev.map(b => botIds.includes(b.id) ? { ...b, lastActive: now } : b));
  };

  const updateBotPersona = async (botId, updates) => {
    setActiveBots(prev => prev.map(b => b.id === botId ? { ...b, ...updates } : b));
    
    // Persist if it's a custom bot
    if (botId.startsWith('bot_')) {
      const dbMapping = {
        engagementThreshold: 'engagement_threshold',
        likelihoodToLike: 'likelihood_to_like',
        likelihoodToShare: 'likelihood_to_share',
        baseLikelihoodToPost: 'base_likelihood_to_post',
        baseLikelihoodToReply: 'base_likelihood_to_reply'
      };
      const dbUpdates = {};
      Object.entries(updates).forEach(([k, v]) => { if (dbMapping[k]) dbUpdates[dbMapping[k]] = v; });
      if (Object.keys(dbUpdates).length > 0) {
        await supabase.from('custom_bots').update(dbUpdates).eq('id', botId);
      }
    }
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
      await supabase.from('post_interactions').delete().match({ post_id: post.id, actor_id: bot.id, type: 'like' });
      interactions.liked = false;
    }

    if (interactions.shared) {
      const { data } = await supabase.from('posts').select('shares').eq('id', post.id).single();
      const newShares = Math.max(0, (data?.shares || 0) - 1);
      await supabase.from('posts').update({ shares: newShares }).eq('id', post.id);
      setPosts(prev => updatePostDeep(prev, post.id, { shares: newShares }));
      removeInteraction(post.id, 'share', bot.id);
      await supabase.from('post_interactions').delete().match({ post_id: post.id, actor_id: bot.id, type: 'share' });
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

  const settingsTimeoutRef = useRef(null);
  const updateSimulationSettings = (updates) => {
    // 1. Immediate local state update for UI responsiveness
    if (updates.outrageMultiplier !== undefined) setOutrageMultiplier(updates.outrageMultiplier);
    if (updates.curiosityMultiplier !== undefined) setCuriosityMultiplier(updates.curiosityMultiplier);

    // 2. Debounced database sync
    if (settingsTimeoutRef.current) clearTimeout(settingsTimeoutRef.current);
    settingsTimeoutRef.current = setTimeout(async () => {
      const { outrageMultiplier: currentOutrage, curiosityMultiplier: currentCuriosity } = stateRef.current;
      const dbUpdates = {
        outrage_multiplier: updates.outrageMultiplier !== undefined ? updates.outrageMultiplier : currentOutrage,
        curiosity_multiplier: updates.curiosityMultiplier !== undefined ? updates.curiosityMultiplier : currentCuriosity
      };
      
      isDev && console.log("[DB] Syncing settings to Supabase:", dbUpdates);
      const { error } = await supabase.from('simulation_settings').upsert({ id: 'global', ...dbUpdates }, { onConflict: 'id' });
      if (error) console.error("[DB] Settings sync failed:", error);
    }, 500); 
  };

  return (
    <SimulationContext.Provider value={{
      posts,
      activeBots,
      activePrompts,
      isLoaded,
      outrageMultiplier,
      curiosityMultiplier,
      updateSimulationSettings,
      createHumanPost,
      createHumanReply,
      deletePost,
      editPost,
      likePost,
      sharePost,
      createCustomBot,
      deleteCustomBot,
      clearSimulation,
      updateBotPersona,
      postInteractors,
      generatingBots,
      humanLiked,
      humanShared,
      botMemories,
      resetBotMemory,
      persuasions,
      authorMap,
    }}>
      {children}
    </SimulationContext.Provider>
  );
};

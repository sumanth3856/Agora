import { describe, it, expect, vi } from 'vitest';
import { scoreCandidatePost, selectCandidatePost, evaluateStance, generateBotText, dbRowToPost, existsInTree } from './SimulationContext';

vi.mock('./supabaseClient', () => ({
  supabase: {
    from: vi.fn(),
    channel: vi.fn(),
    removeChannel: vi.fn()
  }
}));

describe('SimulationContext AI Engine', () => {
  describe('scoreCandidatePost', () => {
    it('prioritizes newer posts over older ones', () => {
      const now = Date.now();
      const newPost = { id: 1, timestamp: now - 1000, replies: [], likes: 0, shares: 0 };
      const oldPost = { id: 2, timestamp: now - 60 * 60 * 1000, replies: [], likes: 0, shares: 0 };
      
      const newScore = scoreCandidatePost(newPost, now);
      const oldScore = scoreCandidatePost(oldPost, now);
      
      expect(newScore).toBeGreaterThan(oldScore);
    });

    it('factors in controversy (reply count)', () => {
      const now = Date.now();
      const postNoReplies = { id: 1, timestamp: now, replies: [] };
      const postManyReplies = { id: 2, timestamp: now, replies: [{}, {}, {}] };
      
      const scoreLow = scoreCandidatePost(postNoReplies, now);
      const scoreHigh = scoreCandidatePost(postManyReplies, now);
      
      expect(scoreHigh).toBeGreaterThan(scoreLow);
    });

    it('factors in engagement (likes and shares)', () => {
      const now = Date.now();
      const baseline = { id: 1, timestamp: now, likes: 0, shares: 0 };
      const highlyEngaged = { id: 2, timestamp: now, likes: 5, shares: 5 };
      
      const scoreLow = scoreCandidatePost(baseline, now);
      const scoreHigh = scoreCandidatePost(highlyEngaged, now);
      
      expect(scoreHigh).toBeGreaterThan(scoreLow);
    });
  });

  describe('selectCandidatePost', () => {
    const mockBot = { id: 'bot1' };
    const now = Date.now();
    
    it('filters out bot\'s own posts', () => {
      const posts = [
        { id: '1', author: { id: 'bot1' }, text: 'This is my post that is long enough', timestamp: now },
        { id: '2', author: { id: 'other' }, text: 'This is someone elses post that is long enough', timestamp: now }
      ];
      
      const selected = selectCandidatePost(mockBot, posts, new Set(), now);
      expect(selected.id).toBe('2');
    });

    it('filters out already engaged posts', () => {
      const posts = [
        { id: '1', author: { id: 'other' }, text: 'already engaged post that is long enough', timestamp: now },
        { id: '2', author: { id: 'other' }, text: 'new post that is long enough to be selected', timestamp: now }
      ];
      const engaged = new Set(['1']);
      
      const selected = selectCandidatePost(mockBot, posts, engaged, now);
      expect(selected.id).toBe('2');
    });

    it('filters out posts older than 2 hours', () => {
      const THREE_HOURS = 3 * 60 * 60 * 1000;
      const posts = [
        { id: '1', author: { id: 'other' }, text: 'Very old post that is long enough', timestamp: now - THREE_HOURS },
        { id: '2', author: { id: 'other' }, text: 'Recent post that is long enough to select', timestamp: now }
      ];
      
      const selected = selectCandidatePost(mockBot, posts, new Set(), now);
      expect(selected?.id).toBe('2');
    });

    it('filters out short/empty posts', () => {
      const posts = [
        { id: '1', author: { id: 'other' }, text: 'short', timestamp: now },
        { id: '2', author: { id: 'other' }, text: 'This post is definitely long enough to pass the greater than 20 char check', timestamp: now }
      ];
      
      const selected = selectCandidatePost(mockBot, posts, new Set(), now);
      expect(selected?.id).toBe('2');
    });
  });

  describe('generateBotText', () => {
    const mockBot = { role: 'test_role' };
    const mockPrompts = { test_role: 'You are a testing bot' };

    it('returns null if groq instance is missing', async () => {
      const result = await generateBotText(null, mockBot, 'test prompt', null, mockPrompts);
      expect(result).toBeNull();
    });

    it('returns parsed content from groq', async () => {
      const mockGroq = {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{ message: { content: 'This is my "hot take" on the topic.' } }]
            })
          }
        }
      };

      const result = await generateBotText(mockGroq, mockBot, 'test prompt', null, mockPrompts);
      expect(result).toBe('This is my hot take on the topic.'); // Note string parsing in func
      expect(mockGroq.chat.completions.create).toHaveBeenCalled();
    });

    it('returns null on error', async () => {
      const mockGroq = {
        chat: {
          completions: {
            create: vi.fn().mockRejectedValue(new Error('Rate limit exceeded'))
          }
        }
      };

      const result = await generateBotText(mockGroq, mockBot, 'test prompt', null, mockPrompts);
      expect(result).toBeNull();
    });
  });

  describe('evaluateStance', () => {
    const mockBot = { role: 'test_role' };
    const mockPost = { text: 'I love writing unit tests' };
    const mockPrompts = { test_role: 'You are a testing bot' };

    it('returns NEUTRAL with 0 confidence if groq is missing', async () => {
      const result = await evaluateStance(null, mockBot, { text: 'missing groq' }, mockPrompts);
      expect(result).toEqual({ stance: 'NEUTRAL', confidence: 0, sentiment: 'Neutral', reasoning: null });
    });

    it('parses structured JSON return from groq', async () => {
      const mockGroq = {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{ message: { content: '{"stance":"AGREE","confidence":0.95,"sentiment":"Joy", "reasoning": "I agree because tests are good."}' } }]
            })
          }
        }
      };
      
      const result = await evaluateStance(mockGroq, mockBot, mockPost, mockPrompts);
      expect(result).toEqual({ stance: 'AGREE', confidence: 0.95, sentiment: 'Joy', reasoning: 'I agree because tests are good.' });
    });

    it('safely handles malformed json responses from groq', async () => {
      const malformedPost = { text: 'malformed json test' };
      const mockGroq = {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              // Invalid sentiment string should default to "Neutral"
              choices: [{ message: { content: 'I absolutely agree! {"stance":"AGREE","confidence":0.75,"sentiment":"Hungry"} That is my take.' } }]
            })
          }
        }
      };
      
      const result = await evaluateStance(mockGroq, mockBot, malformedPost, mockPrompts);
      expect(result).toEqual({ stance: 'AGREE', confidence: 0.75, sentiment: 'Neutral', reasoning: null });
    });

    it('falls back to NEUTRAL on error', async () => {
      const errorPost = { text: 'error fallback test' };
      const mockGroq = {
        chat: {
          completions: {
            create: vi.fn().mockRejectedValue(new Error('API failure'))
          }
        }
      };
      
      const result = await evaluateStance(mockGroq, mockBot, errorPost, mockPrompts);
      expect(result).toEqual({ stance: 'NEUTRAL', confidence: 0, sentiment: 'Neutral', reasoning: null });
    });
  });

  describe('dbRowToPost Utility', () => {
    it('parses raw database rows correctly', () => {
      const row = {
        id: '1', author_id: 'bot1', author_handle: '@bot', author_color: 'red',
        text: 'Hello world', timestamp: 12345, likes: 2, shares: 1
      };
      
      const post = dbRowToPost(row);
      expect(post.id).toBe('1');
      expect(post.author.handle).toBe('@bot');
      expect(post.text).toBe('Hello world');
      expect(post.likes).toBe(2);
    });

    it('extracts and strips hidden social proof metadata', () => {
      const metaJson = JSON.stringify({ likes: [{id: 'user1', handle: '@fan'}], shares: [] });
      const row = {
        id: '2', author_id: 'bot1', author_handle: '@bot', author_color: 'red',
        text: `Check this out! [social_proof:${metaJson}]`,
        timestamp: 12345
      };
      
      const post = dbRowToPost(row);
      expect(post.text).toBe('Check this out!');
      expect(post.meta.likes).toHaveLength(1);
      expect(post.meta.likes[0].handle).toBe('@fan');
    });

    it('prefers JSONB columns (likes_json/shares_json) if available', () => {
      const row = {
        id: '3', text: 'Clean text',
        likes_json: [{id: 'user2', handle: '@prefer'}],
        shares_json: []
      };
      const post = dbRowToPost(row);
      expect(post.meta.likes[0].handle).toBe('@prefer');
    });
  });

  describe('existsInTree Utility', () => {
    it('finds items in nested reply threads', () => {
      const tree = [
        { id: 'p1', replies: [{ id: 'p2', replies: [{ id: 'p3', replies: [] }] }] },
        { id: 'p4', replies: [] }
      ];
      
      expect(existsInTree(tree, 'p3')).toBe(true);
      expect(existsInTree(tree, 'p4')).toBe(true);
      expect(existsInTree(tree, 'p99')).toBe(false);
    });
  });
});

import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SimulationProvider, useSimulation } from './SimulationContext';
import { supabase } from './supabaseClient';

vi.mock('./supabaseClient', () => {
  const callbacks = {};
  const mockChannel = {
    on: vi.fn().mockImplementation((type, filter, callback) => {
      if (type === 'postgres_changes') {
        callbacks[filter.event] = callback;
      }
      return mockChannel;
    }),
    subscribe: vi.fn(),
  };

  return {
    supabase: {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [] }),
        insert: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: {} })
      })),
      channel: vi.fn(() => mockChannel),
      removeChannel: vi.fn(),
      // Helper function for tests to trigger realtime changes
      __triggerChange: (event, payload) => {
        if (callbacks[event]) {
          callbacks[event](payload);
        }
      }
    }
  };
});

describe('SimulationIntegration - Supabase Sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // A simple test component to consume the simulation context
  const TestComponent = () => {
    const { posts, isLoaded } = useSimulation();
    
    if (!isLoaded) return <div data-testid="loading">Loading...</div>;
    
    return (
      <div data-testid="feed">
        <span data-testid="post-count">{posts.length}</span>
        {posts.map(post => (
          <div key={post.id} data-testid={`post-${post.id}`}>
            {post.text} - Likes: {post.likes || 0}
            {post.replies?.map(reply => (
              <div key={reply.id} data-testid={`reply-${reply.id}`}>{reply.text}</div>
            ))}
          </div>
        ))}
      </div>
    );
  };

  it('loads initial posts from Supabase', async () => {
    // Override the mock for this specific test
    supabase.from.mockImplementationOnce(() => ({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [{ id: '1', text: 'Hello World', timestamp: Date.now(), likes: 0, shares: 0, parent_id: null, author_id: 'usr1', author_handle: '@usr1', author_color: '#fff' }]
      })
    }));

    await act(async () => {
      render(
        <SimulationProvider>
          <TestComponent />
        </SimulationProvider>
      );
    });

    expect(screen.getByTestId('post-count').textContent).toBe('1');
    expect(screen.getByTestId('post-1').textContent).toContain('Hello World');
  });

  it('handles realtime INSERT for new root posts', async () => {
    await act(async () => {
      render(
        <SimulationProvider>
          <TestComponent />
        </SimulationProvider>
      );
    });

    // Simulate realtime event
    await act(async () => {
      supabase.__triggerChange('INSERT', {
        new: { id: 'new_1', text: 'Realtime Post', timestamp: Date.now(), parent_id: null, likes: 0, shares: 0, author_id: 'usr2', author_handle: '@usr2', author_color: '#000' }
      });
    });

    expect(screen.getByTestId('post-count').textContent).toBe('1');
    expect(screen.getByTestId('post-new_1').textContent).toContain('Realtime Post');
  });

  it('handles realtime INSERT for replies to existing posts', async () => {
    supabase.from.mockImplementationOnce(() => ({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [{ id: 'parent_1', text: 'Root Post', timestamp: Date.now(), parent_id: null, author_id: 'usr1', author_handle: '@usr1', author_color: '#fff' }]
      })
    }));

    await act(async () => {
      render(
        <SimulationProvider>
          <TestComponent />
        </SimulationProvider>
      );
    });

    // Simulate realtime reply
    await act(async () => {
      supabase.__triggerChange('INSERT', {
        new: { id: 'reply_1', parent_id: 'parent_1', text: 'A reply!', timestamp: Date.now(), author_id: 'usr2', author_handle: '@usr2', author_color: '#000' }
      });
    });

    // The root count should still be 1
    expect(screen.getByTestId('post-count').textContent).toBe('1');
    // But the reply element should exist inside it
    expect(screen.getByTestId('reply-reply_1').textContent).toBe('A reply!');
  });

  it('handles realtime UPDATE for engagement counts (likes/shares)', async () => {
    supabase.from.mockImplementationOnce(() => ({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [{ id: 'p1', text: 'Test Post', timestamp: Date.now(), likes: 5, parent_id: null, author_id: 'usr1', author_handle: '@usr1', author_color: '#fff' }]
      })
    }));

    await act(async () => {
      render(
        <SimulationProvider>
          <TestComponent />
        </SimulationProvider>
      );
    });

    expect(screen.getByTestId('post-p1').textContent).toContain('Likes: 5');

    // Simulate realtime like update
    await act(async () => {
      supabase.__triggerChange('UPDATE', {
        new: { id: 'p1', likes: 6, text: 'Test Post' }
      });
    });

    expect(screen.getByTestId('post-p1').textContent).toContain('Likes: 6');
  });
});

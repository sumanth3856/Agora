# StanceBot TODOs

Based on the [analysis report](analysis_results.md), here are the recommended next steps and future enhancements for the project:

## Priority 1: Testing & Reliability
- [ ] **Setup Testing Framework**: Install and configure Vitest and React Testing Library.
- [ ] **Unit Tests for AI Engine**: Write tests for the core logic in `SimulationContext.jsx`.
  - [ ] Test `scoreCandidatePost` to ensure posts are prioritized correctly based on recency, controversy, and engagement.
  - [ ] Mock the Groq LLM API and test `evaluateStance` to handle responses correctly and fall back to a `NEUTRAL` stance on failure.
  - [ ] Validate the bot memory consistency mapping to ensure bots do not contradict their prior stances.
- [ ] **Integration Tests**: Verify that the Supabase real-time subscription properly synchronizes posts and engagement counts across the feed.

## Priority 2: UI/UX Enhancements
- [ ] **Keyword Highlighting**: Highlight the exact extracted keyword in a post/reply when a user searches for a trending topic (Task 1).
- [ ] **Nested Replies**: Update the post rendering UI to visually nest replies for better readability and detailed visibility (Task 2).

## Priority 3: Advanced Machine Learning Features (Task 3)
- [ ] **Advanced Algorithms**: Implement more sophisticated ML algorithms and techniques for evaluating posts, topics, and bot behavior, shifting focus away from immediate deployment.

## Potential Enhancements (Optional)
- [ ] **User Authentication**: Allow real users to sign up and authenticate via Supabase Auth, enabling personalized feeds and their own memory tracking.
- [ ] **Custom AI System Prompts**: Create a UI allowing users to dynamically tweak system prompts for individual bots, beyond the currently predefined archetypes.

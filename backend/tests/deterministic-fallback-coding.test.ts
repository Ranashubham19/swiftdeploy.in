import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDeterministicFallbackReply } from '../aiService.js';

test('deterministic fallback path is disabled for all prompts', async () => {
  const prompts = [
    'write python code for longest palindrome substring',
    'ok write code for return longest palindrome',
    'write python code to reverse a linked list',
    'write python bfs code for shortest path in grid maze',
    'write python dynamic programming code for coin change minimum coins',
    'What is palindrome',
    'Top 10 fastest cars in the world',
  ];
  for (const prompt of prompts) {
    const result = await generateDeterministicFallbackReply(prompt);
    assert.equal(result, null);
  }
});

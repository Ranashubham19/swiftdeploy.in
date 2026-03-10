import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enforceCodeGenerationIntentPolicy,
  isExplicitCodeGenerationRequest,
} from '../src/utils/codeGenerationIntentPolicy.js';

test('explicit code request is detected', () => {
  assert.equal(isExplicitCodeGenerationRequest('write code in python for fibonacci'), true);
  assert.equal(isExplicitCodeGenerationRequest('show example using javascript'), true);
});

test('non-explicit request with code-like reply is guarded', () => {
  const prompt = 'teach me python loops';
  const reply = '```python\nfor i in range(5):\n    print(i)\n```';
  const result = enforceCodeGenerationIntentPolicy(prompt, reply, {
    isLikelyCodePrompt: () => true,
  });
  assert.equal(
    result,
    'I can explain this concept first. If you want implementation, say "write code" and include language plus constraints.'
  );
});

test('guard strips code and keeps narrative for non-explicit prompts', () => {
  const prompt = 'explain binary search tree';
  const reply = [
    'A binary search tree stores ordered values and supports efficient search.',
    '',
    '```python',
    'class Node:',
    '    pass',
    '```',
  ].join('\n');
  const result = enforceCodeGenerationIntentPolicy(prompt, reply, {
    isLikelyCodePrompt: () => false,
  });
  assert.equal(result.includes('```'), false);
  assert.equal(result.includes('If you want code, say "write code" and share the target language.'), true);
  assert.equal(result.includes('binary search tree'), true);
});

test('explicit prompt preserves code reply unchanged', () => {
  const prompt = 'create implementation in python for merge sort';
  const reply = '```python\ndef merge_sort(arr):\n    return arr\n```';
  const result = enforceCodeGenerationIntentPolicy(prompt, reply, {
    isLikelyCodePrompt: () => true,
  });
  assert.equal(result, reply);
});

test('non-code reply remains unchanged', () => {
  const prompt = 'what is http';
  const reply = 'HTTP is the protocol used for transferring web resources.';
  const result = enforceCodeGenerationIntentPolicy(prompt, reply, {
    isLikelyCodePrompt: () => false,
  });
  assert.equal(result, reply);
});


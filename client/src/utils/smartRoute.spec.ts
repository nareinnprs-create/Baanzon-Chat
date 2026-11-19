import { pickLane } from './smartRoute';

describe('pickLane', () => {
  it('routes image attachments to the vision lane regardless of text', () => {
    expect(pickLane('hello', true)).toBe('vision');
    expect(pickLane('```js\ncode\n```', true)).toBe('vision');
  });

  it('routes code-intent messages to coding', () => {
    expect(pickLane('fix this bug in my function', false)).toBe('coding');
    expect(pickLane('```py\nprint(1)\n```', false)).toBe('coding');
    expect(pickLane('write a SQL query for orders', false)).toBe('coding');
  });

  it('routes long or deep-work prompts to reasoning', () => {
    const long = 'a'.repeat(601);
    expect(pickLane(long, false)).toBe('reasoning');
    expect(pickLane('analyze this report step by step and explain why', false)).toBe('reasoning');
    expect(pickLane('write an essay about strategy', false)).toBe('reasoning');
  });

  it('routes short conversational turns to fast', () => {
    expect(pickLane('hi', false)).toBe('fast');
    expect(pickLane('ok thanks', false)).toBe('fast');
  });

  it('routes medium general prompts to balanced', () => {
    expect(
      pickLane('what are the main differences between renewable energy sources today', false),
    ).toBe('balanced');
  });

  it('never routes anywhere without text', () => {
    expect(pickLane('', false)).toBe('fast');
  });
});

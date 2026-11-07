export const GALLERY_CATEGORIES = [
  'coding',
  'writing',
  'research',
  'analysis',
  'planning',
  'learning',
] as const;

export type StarterCategory = (typeof GALLERY_CATEGORIES)[number];

export type StarterTemplate = {
  id: string;
  title: string;
  /** Decorative emoji; the card's accessible name is "Use template: {title}". */
  icon: string;
  category: StarterCategory;
  /** Ready-to-edit composer text; bracketed placeholders mark what to fill in. */
  prompt: string;
};

/**
 * Curated starter templates for the Home landing. Titles and prompts are
 * fork content, deliberately unlocalized (the gallery locale keys cover only
 * the section heading and the use action) and kept model-agnostic.
 */
export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: 'explain-code',
    title: 'Explain code',
    icon: '🧩',
    category: 'coding',
    prompt:
      'Explain what this code does step by step and flag any bugs or edge cases:\n\n[Paste your code here]',
  },
  {
    id: 'debug-error',
    title: 'Debug an error',
    icon: '🐛',
    category: 'coding',
    prompt:
      'Help me fix this error. Here is the error message, what I expected to happen, and the relevant code:\n\n[Paste everything here]',
  },
  {
    id: 'draft-email',
    title: 'Draft an email',
    icon: '✉️',
    category: 'writing',
    prompt:
      'Help me draft a clear, professional email.\nAudience: [who it is for]\nGoal: [what it should achieve]\nKey points: [list them]',
  },
  {
    id: 'rewrite-polish',
    title: 'Rewrite and polish',
    icon: '✏️',
    category: 'writing',
    prompt:
      'Rewrite the text below to be clearer and more concise while keeping the original meaning and tone:\n\n[Paste your text here]',
  },
  {
    id: 'compare-options',
    title: 'Compare options',
    icon: '⚖️',
    category: 'research',
    prompt:
      'I am deciding between [option A] and [option B]. Compare them across cost, effort, and long-term trade-offs, then give a clear recommendation.',
  },
  {
    id: 'explain-topic',
    title: 'Explain a topic',
    icon: '🔭',
    category: 'research',
    prompt:
      'Explain [topic] in plain language, starting from the basics and building up. Include one concrete example.',
  },
  {
    id: 'analyze-data',
    title: 'Analyze data',
    icon: '📊',
    category: 'analysis',
    prompt:
      'Here is my data or summary:\n\n[Paste it here]\n\nDescribe the main patterns, anything unusual, and what I should look at next.',
  },
  {
    id: 'pros-cons',
    title: 'Weigh pros and cons',
    icon: '➗',
    category: 'analysis',
    prompt:
      'Break down the situation below into its key parts, list the pros and cons of each option, and recommend a next step:\n\n[Describe the situation]',
  },
  {
    id: 'plan-project',
    title: 'Plan a project',
    icon: '🗺️',
    category: 'planning',
    prompt:
      'Help me plan [project]. Break it into milestones with rough time estimates, flag the biggest risks, and tell me what to do first.',
  },
  {
    id: 'break-down-task',
    title: 'Break down a task',
    icon: '✂️',
    category: 'planning',
    prompt:
      'Break the task below into small, concrete steps I can start today:\n\n[Describe the task]',
  },
  {
    id: 'quiz-me',
    title: 'Quiz me',
    icon: '🎓',
    category: 'learning',
    prompt:
      'Teach me [subject]. After each short section, ask me one question and wait for my answer before continuing.',
  },
  {
    id: 'study-plan',
    title: 'Study plan',
    icon: '📚',
    category: 'learning',
    prompt:
      'Build me a study plan for [subject] over [time frame]. Assume [current level] and include weekly goals and practice ideas.',
  },
];

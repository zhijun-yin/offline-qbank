import { emptyState, validateState, clone } from './core.js';
export function compileBank(source) {
  if (!source || source.version !== 1 || !Array.isArray(source.categories) || !Array.isArray(source.questions)) throw new Error('题库必须包含 version、categories 和 questions。');
  const state = emptyState();
  state.categories = source.categories.map(category => ({ ...category, createdAt: category.createdAt ?? 0 }));
  state.questions = source.questions.map(raw => {
    const options = (raw.options || []).map((option,index) => typeof option === 'string' ? { id: `option_${index+1}`, text: option } : option);
    const optionId = value => Number.isInteger(value) ? options[value-1]?.id : value;
    let answer = raw.answer ?? (raw.type === 'multiple' || raw.type === 'fill' ? [] : raw.type === 'text' ? '' : null);
    if (raw.type === 'single') answer = optionId(answer);
    if (raw.type === 'multiple' && Array.isArray(answer)) answer = answer.map(optionId);
    if (raw.type === 'fill' && Array.isArray(answer)) answer = answer.map(variants => typeof variants === 'string' ? [variants] : variants);
    return { ...raw, status: raw.status ?? 'ready', difficulty: raw.difficulty ?? 'easy', categoryId: raw.categoryId ?? null, explanation: raw.explanation ?? '', tags: raw.tags ?? [], score: raw.score ?? 1, options, answer, createdAt: raw.createdAt ?? 0, updatedAt: raw.updatedAt ?? 0 };
  });
  return validateState(state);
}
export function mergeBank(state, incoming) {
  const next = clone(state);
  const merge = (existing,items) => [...new Map([...existing,...items].map(item => [item.id,item])).values()];
  next.categories = merge(next.categories,incoming.categories);
  next.questions = merge(next.questions,incoming.questions);
  return validateState(next);
}

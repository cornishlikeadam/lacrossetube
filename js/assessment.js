// Optional learning checks. This is a film-study starting point, not a player grade.
(function () {
  const QUESTIONS = [
    { id: 'recovery', focus: 'slides', title: 'Your teammate slides to stop a dodger. What should the beaten defender do next?', options: ['Chase the ball wherever it goes', 'Recover inside and communicate the next assignment', 'Stay on the original matchup without talking'], answer: 1, cue: 'Recover inside and communicate. Your team’s slide package decides the next assignment.', query: 'adjacent slide recovery' },
    { id: 'hands', focus: 'wallball', title: 'Which wall-ball habit makes both hands part of your routine?', options: ['Use only the hand that feels comfortable', 'Throw as hard as possible every rep', 'Use a controlled target and alternate equal sets with each hand'], answer: 2, cue: 'Start with controlled, balanced sets and count clean catches before adding speed.', query: 'wall ball routine' },
    { id: 'space', focus: 'dodging', title: 'After drawing a second defender, what should you look for?', options: ['A free teammate and a clear passing lane', 'A harder shot through both defenders', 'An extra cradle every time'], answer: 0, cue: 'Look up for the open player; the next pass can keep the advantage moving.', query: 'two-man pick seal' },
    { id: 'pocket', focus: 'stringing', title: 'Before copying a sidewall pattern, what should you check?', options: ['Whether the string colors match', 'The head, mesh, hole map, and the rules you play under', 'Only the number of shooting strings'], answer: 1, cue: 'Patterns depend on the head and mesh. Check the applicable equipment rules with your coach or official.', query: 'sidewall knot mesh' }
  ];
  const LABELS = { slides: 'Slides & recovery', wallball: 'Both-hand stickwork', dodging: 'Passing reads & two-man play', stringing: 'Pocket fundamentals' };
  function evaluate(answers = {}) {
    const results = QUESTIONS.filter(q => Number.isInteger(answers[q.id]) && answers[q.id] >= 0 && answers[q.id] < q.options.length)
      .map(q => ({ id: q.id, focus: q.focus, correct: answers[q.id] === q.answer, cue: q.cue, query: q.query }));
    return { answered: results.length, correct: results.filter(r => r.correct).length, priorities: [...new Set(results.filter(r => !r.correct).map(r => r.focus))], results };
  }
  function score(item, profile) {
    if (!profile) return 0;
    const blob = `${item.title || ''} ${item.subTag || ''} ${item.category || ''}`.toLowerCase();
    const focusMatch = focus => ({
      slides: /slide|recover|approach/.test(blob),
      wallball: /wall.?ball|stickwork|ground.?ball/.test(blob),
      dodging: /dodg|two.man|seal|pick|passing/.test(blob),
      stringing: item.category === 'pockets'
    })[focus] || false;
    let weight = focusMatch(profile.focus) ? 24 : 0;
    for (const focus of evaluate(profile.answers).priorities) if (focusMatch(focus)) weight += 36;
    if (profile.format === 'box' && /box|two.man|indoor|nll/.test(blob)) weight += 12;
    if (profile.format === 'field' && !/box|indoor|nll/.test(blob)) weight += 6;
    return weight;
  }
  globalThis.LT_ASSESSMENT = { QUESTIONS, LABELS, evaluate, score };
})();

// Add only supplied or verified stage images/times. A video thumbnail is not a stage still.
// Images use { src, alt, credit, sourceUrl }; a verified time is seconds, otherwise null.
window.LACROSSETUBE_PATTERNS = [
  {
    id: 'mesh-basics', title: 'Mesh foundations', track: 'mesh',
    head: null, mesh: null, recipe: null, image: null, before: null, after: null,
    sourceIds: ['yt-oRYrLLYtfRs', 'yt-QhNACCmrZzo'],
    note: 'Use the reference films to check your head and mesh. A hole-by-hole pattern has not been recorded for this reference.',
    stages: [
      { key: 'empty', label: 'Empty head', cue: 'Inspect the head, mesh, strings, and hole map.', itemId: 'yt-oRYrLLYtfRs', time: null, image: null },
      { key: 'topstring', label: 'Topstring', cue: 'Follow the source’s topstring and check left/right tension.', itemId: 'yt-QhNACCmrZzo', time: null, image: null },
      { key: 'sidewall', label: 'Sidewall', cue: 'Compare both sides against the source before adjusting pocket placement.', itemId: 'yt-oRYrLLYtfRs', time: null, image: null },
      { key: 'shooters', label: 'Shooters & check', cue: 'Test the release and have equipment checked against your playing rules.', itemId: 'yt-oRYrLLYtfRs', time: null, image: null }
    ]
  },
  {
    id: 'traditional-leather', title: 'Traditional leather', track: 'heritage',
    head: null, mesh: null, recipe: null, image: null, before: null, after: null,
    sourceIds: ['yt-I2EOPRxDkNw', 'yt-duskFhldfTM'],
    note: 'Traditional pocket references by The String Shark and Jerome Thompson. Keep maker attribution with any pattern or image added here.',
    stages: [
      { key: 'empty', label: 'Head & leathers', cue: 'Identify the materials and layout used by the maker.', itemId: 'yt-I2EOPRxDkNw', time: null, image: null },
      { key: 'topstring', label: 'Attach the leathers', cue: 'Follow the source’s attachment and initial spacing.', itemId: 'yt-I2EOPRxDkNw', time: null, image: null },
      { key: 'sidewall', label: 'Crosslace & sidewalls', cue: 'Work through the maker’s track and crosslace sequence.', itemId: 'yt-duskFhldfTM', time: null, image: null },
      { key: 'shooters', label: 'Tension & finish', cue: 'Check the pocket evenly and test before making small adjustments.', itemId: 'yt-I2EOPRxDkNw', time: null, image: null }
    ]
  },
  {
    id: 'pita-reference', title: 'Pita pocket reference', track: 'heritage',
    head: null, mesh: null, recipe: null, image: null, before: null, after: null,
    sourceIds: ['yt-83LnH5uPu7g'], stages: [],
    note: 'Traditional Thursday: Pita Pocket Tips, from Lacrosse All Stars. Pattern measurements and comparison images are awaiting supplied references.'
  }
];

// SSC CGL syllabus (Tier 1 + Tier 2). Edit freely – add/remove topics anytime.
// tiers: "T1" = Tier 1, "T2" = Tier 2 Paper 1, "P2" = Tier 2 Paper 2 (Statistics, JSO only)
export const SUBJECTS = [
  {
    id: "quant", name: "Quantitative Aptitude", icon: "🧮", tiers: ["T1", "T2"],
    topics: [
      "Number System", "Simplification & BODMAS", "HCF & LCM", "Square Roots, Cube Roots & Surds",
      "Percentage", "Ratio & Proportion", "Partnership", "Average", "Mixture & Alligation",
      "Profit, Loss & Discount", "Simple Interest", "Compound Interest", "Time & Work",
      "Pipes & Cisterns", "Time, Speed & Distance", "Boats & Streams", "Algebra (Identities)",
      "Linear Equations & Graphs", "Geometry – Lines & Angles", "Geometry – Triangles (Centres, Congruence, Similarity)",
      "Geometry – Circles (Chords, Tangents)", "Geometry – Quadrilaterals & Polygons", "Mensuration 2D",
      "Mensuration 3D", "Trigonometry", "Heights & Distances", "Data Interpretation",
      "Statistics Basics (Mean, Median, Mode)", "Probability (Tier 2)"
    ]
  },
  {
    id: "reasoning", name: "General Intelligence & Reasoning", icon: "🧩", tiers: ["T1", "T2"],
    topics: [
      "Analogy (Semantic, Symbolic, Figural)", "Classification / Odd One Out", "Number Series",
      "Alphabet Series", "Figure Series", "Coding-Decoding", "Blood Relations", "Direction Sense",
      "Order & Ranking", "Seating Arrangement", "Puzzles", "Syllogism", "Venn Diagrams",
      "Mathematical Operations", "Missing Number / Matrix", "Word Formation & Dictionary Order",
      "Statement & Conclusion", "Statement & Argument / Decision Making", "Paper Folding & Cutting",
      "Mirror & Water Image", "Embedded Figures", "Counting Figures", "Dice & Cube",
      "Pattern Completion", "Indexing / Address Matching", "Emotional & Social Intelligence (Tier 2)"
    ]
  },
  {
    id: "english", name: "English Comprehension", icon: "📖", tiers: ["T1", "T2"],
    topics: [
      "Reading Comprehension", "Cloze Test", "Error Spotting", "Sentence Improvement",
      "Fill in the Blanks", "Synonyms", "Antonyms", "Idioms & Phrases", "One Word Substitution",
      "Spelling Correction", "Active & Passive Voice", "Direct & Indirect Speech",
      "Para Jumbles / Sentence Rearrangement", "Grammar – Tenses", "Grammar – Subject-Verb Agreement",
      "Grammar – Articles, Prepositions, Conjunctions", "Vocabulary Revision (Daily)"
    ]
  },
  {
    id: "ga", name: "General Awareness", icon: "🌏", tiers: ["T1", "T2"],
    topics: [
      "Ancient History", "Medieval History", "Modern History & Freedom Struggle", "Art & Culture",
      "Indian Polity & Constitution", "Indian Geography", "World Geography", "Indian Economy",
      "Physics", "Chemistry", "Biology", "Environment & Ecology", "Books & Authors",
      "Awards & Honours", "Sports", "Important Days & Events", "Dances, Festivals & Musicians",
      "Government Schemes", "Current Affairs – National", "Current Affairs – International",
      "Science & Technology Current"
    ]
  },
  {
    id: "computer", name: "Computer Knowledge", icon: "💻", tiers: ["T2"],
    topics: [
      "Computer Basics & Organisation", "Memory & Storage Devices", "Input/Output Devices",
      "Software & Operating Systems", "MS Word", "MS Excel", "MS PowerPoint", "Internet & Email",
      "Networking Basics", "Cyber Security & Viruses", "Keyboard Shortcuts",
      "Data Entry Speed Test (Typing Practice)"
    ]
  },
  {
    id: "stats", name: "Statistics (JSO – Optional)", icon: "📊", tiers: ["P2"],
    topics: [
      "Collection, Classification & Presentation of Data", "Measures of Central Tendency",
      "Measures of Dispersion", "Moments, Skewness & Kurtosis", "Correlation & Regression",
      "Probability Theory", "Random Variables & Probability Distributions", "Sampling Theory",
      "Statistical Inference", "Analysis of Variance", "Time Series Analysis", "Index Numbers"
    ]
  }
];

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

// Stable ids like "quant__percentage"
SUBJECTS.forEach(sub => {
  sub.topics = sub.topics.map(name => ({ id: `${sub.id}__${slug(name)}`, name, subject: sub.id }));
});

export const ALL_TOPICS = SUBJECTS.flatMap(s => s.topics);
export const TOPIC_MAP = Object.fromEntries(ALL_TOPICS.map(t => [t.id, t]));
export const SUBJECT_MAP = Object.fromEntries(SUBJECTS.map(s => [s.id, s]));
export const TIER_LABEL = { T1: "Tier 1", T2: "Tier 2", P2: "Paper 2" };

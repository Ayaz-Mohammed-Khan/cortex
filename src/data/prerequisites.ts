/**
 * PREREQUISITES — the single source of truth for "learn this first" edges.
 *
 * Both the roadmap modal (`src/pages/index.astro`, the "Learn first" row) and
 * the note page (`src/pages/notes/[...slug].astro`, the "Prerequisites" line)
 * display a topic's prerequisites. Historically each read its own list — the
 * roadmap from inline arrays in `roadmap.ts`, the note from its Markdown
 * frontmatter — and the two drifted. This module is the one place that owns
 * those edges so the two views can never disagree.
 *
 * TWO MAPS, because a track and a note can share a Display_Name. The track
 * "Probability Distributions" (study it after Descriptive Statistics) and the
 * PDF/PMF note whose Display_Name is also "Probability Distributions" (study it
 * after Bivariate analysis) are different nodes with different prerequisites.
 * Keying everything by Display_Name alone would collide, so:
 *
 *   - {@link TOPIC_PREREQUISITES} — note-level edges. Keyed by the note's
 *     Display_Name (the filename minus its `NN - ` prefix). This is what a
 *     reader sees on a note page and on a leaf roadmap node.
 *   - {@link TRACK_PREREQUISITES} — main-spine edges. Keyed by the track name
 *     as written in `spine`. The coarse "finish track X before track Y" arrows.
 *
 * EDITORIAL RULE: list the *immediate* predecessor(s) only, not the whole
 * transitive chain. `Lists` requires `Strings` and `Time Complexity`; it does
 * NOT re-list `Python Fundamentals`, which those already depend on. This keeps
 * each "Learn first" row short and actionable; the full graph is recoverable by
 * following edges. Cross-track edges name the specific track or note the
 * dependency truly rests on (e.g. `Naive Bayes` needs `Probability
 * Distributions`, the note, not the whole statistics phase).
 *
 * The keys use the SAME Display_Names the rest of the app resolves by.
 * `scripts/check-prerequisites.ts` validates that every key and value resolves
 * to a real note or track and that there are no cycles.
 */

/** A prerequisite edge list keyed by Display_Name. */
export type PrerequisiteMap = Record<string, string[]>;

/**
 * Note-level "learn first" edges, keyed by note Display_Name.
 *
 * Grouped by track in study order. Within a track the chain is linear unless a
 * topic genuinely draws on two strands (e.g. `Lists` consolidates `Strings` and
 * `Time Complexity`; `ANOVA` needs both `Hypothesis Testing` and the t-test
 * machinery from `P-values and T-tests`). A note absent from this map has no
 * prerequisites — the first node of a chain, e.g. `Python Fundamentals`.
 */
export const TOPIC_PREREQUISITES: PrerequisiteMap = {
  // ── Python Foundations ────────────────────────────────────────────────
  // Fundamentals has no prerequisite; the rest form a chain, with Lists
  // pulling in both the string-handling and the complexity vocabulary it uses
  // to discuss list cost.
  'Operators & Control Flow': ['Python Fundamentals'],
  'Strings': ['Python Fundamentals'],
  'Time Complexity': ['Operators & Control Flow'],
  'Lists': ['Strings', 'Time Complexity'],
  'Tuples, Sets & Dicts': ['Lists'],
  'Functions': ['Tuples, Sets & Dicts'],

  // ── OOP & Advanced Python ─────────────────────────────────────────────
  // Two strands off the OOP base. The class strand is linear; the advanced
  // strand (file handling → exceptions → iterators → decorators) builds on
  // classes, since serialization and custom iterators use them.
  'Classes & Objects': ['Functions'],
  'Encapsulation': ['Classes & Objects'],
  'Inheritance': ['Encapsulation'],
  'Polymorphism': ['Inheritance'],
  'Abstraction': ['Inheritance'],
  'File Handling': ['Classes & Objects'],
  'Exception Handling': ['File Handling'],
  'Iterators & Generators': ['Exception Handling'],
  'Decorators & Namespaces': ['Iterators & Generators'],

  // ── Descriptive Statistics ────────────────────────────────────────────
  // Foundations is the stats entry point. Quantiles and bivariate analysis
  // both build directly on it.
  'Quantiles and Box Plots': ['Foundations and Central Tendency'],
  'Bivariate and Multivariate Analysis': ['Foundations and Central Tendency'],

  // ── Probability Distributions ─────────────────────────────────────────
  // The PDF/PMF note (Display_Name "Probability Distributions") depends on the
  // descriptive-stats bivariate work; everything else chains from there.
  'Probability Distributions': ['Bivariate and Multivariate Analysis'],
  'The Normal Distribution': ['Probability Distributions'],
  'Skewness, Kurtosis and Normality Checks': ['The Normal Distribution'],
  'Non-Gaussian Distributions and Transformations': [
    'Skewness, Kurtosis and Normality Checks',
  ],
  'Bernoulli and Binomial Distributions': ['Probability Distributions'],

  // ── Inferential Statistics ────────────────────────────────────────────
  // CLT starts from the discrete distributions; the hypothesis-testing chain
  // follows, with ANOVA resting on both hypothesis testing and the t-tests.
  'Central Limit Theorem': ['Bernoulli and Binomial Distributions'],
  'Confidence Intervals': ['Central Limit Theorem'],
  'Hypothesis Testing': ['Confidence Intervals'],
  'P-values and T-tests': ['Hypothesis Testing'],
  'Chi-Square Tests': ['Hypothesis Testing'],
  'ANOVA': ['Hypothesis Testing', 'P-values and T-tests'],

  // ── Maths & ML Foundations ────────────────────────────────────────────
  // The linear-algebra strand is a chain; Tensors is the entry point.
  'Vectors': ['Tensors'],
  'Matrices: Computation': ['Vectors'],
  'Matrices: Intuition': ['Matrices: Computation'],

  // ── Regression & Regularization ───────────────────────────────────────
  // Linear regression is the base. Optimization → gradient descent feed the
  // from-scratch models; regression analysis adds the inferential view;
  // regularization (ridge → lasso) sits on bias-variance and gradient descent.
  'Optimization': ['Linear Regression'],
  'Gradient Descent': ['Optimization'],
  'Regression Analysis': ['Linear Regression', 'Inferential Statistics'],
  'Multicollinearity': ['Regression Analysis'],
  'Ridge Regression': ['Bias-Variance Tradeoff', 'Gradient Descent'],
  'Lasso & ElasticNet': ['Ridge Regression'],

  // ── Feature Engineering & Selection ───────────────────────────────────
  // Filter methods lean on the inferential tests (ANOVA, chi-square) for
  // ranking features.
  'Filter Methods': ['Inferential Statistics'],

  // ── Classification ────────────────────────────────────────────────────
  // Naive Bayes needs the probability groundwork; logistic regression builds
  // on linear regression and gradient descent; SVM extends logistic.
  'Naive Bayes': ['Probability Distributions'],
  'Logistic Regression': ['Linear Regression', 'Gradient Descent'],
  'Support Vector Machines': ['Logistic Regression'],

  // ── Trees & Ensembles ─────────────────────────────────────────────────
  // Decision trees are the base; bagging → random forest, and boosting →
  // XGBoost / other boosters chain off trees and gradient descent.
  'Bagging': ['Decision Trees'],
  'Random Forest': ['Bagging'],
  'Gradient Boosting': ['Decision Trees', 'Gradient Descent'],
  'XGBoost': ['Gradient Boosting'],
  'Other Boosters': ['Gradient Boosting'],

  // ── Dimensionality Reduction ──────────────────────────────────────────
  // The linear-algebra intuition note powers eigen decomposition, which powers
  // PCA and SVD; t-SNE and LDA sit on PCA.
  'Eigen Decomposition': ['Matrices: Intuition'],
  'PCA': ['Eigen Decomposition'],
  'SVD': ['Eigen Decomposition'],
  't-SNE': ['PCA'],
  'LDA': ['PCA'],

  // ── Unsupervised Learning ─────────────────────────────────────────────
  // K-Means is the clustering base; density/hierarchical/GMM extend it, with
  // GMM also leaning on the distribution theory.
  'DBSCAN': ['K-Means Clustering'],
  'Hierarchical Clustering': ['K-Means Clustering'],
  'Gaussian Mixture Models': ['K-Means Clustering', 'Probability Distributions'],

  // ── MLOps & Deployment ────────────────────────────────────────────────
  // The tooling chain: version control → DVC → MLflow, and the deploy chain
  // Docker/K8s → CI/CD.
  'Reproducibility & DVC': ['Version Control'],
  'MLflow': ['Reproducibility & DVC'],
  'CI/CD': ['Docker & Kubernetes'],
};

/**
 * Main-spine "learn first" edges, keyed by track name (as in `spine`).
 *
 * The coarse phase-to-phase arrows. A track absent from this map starts a
 * phase with no cross-track prerequisite (e.g. `Python Foundations`, `SQL`,
 * which a learner can pick up alongside the Python track).
 */
export const TRACK_PREREQUISITES: PrerequisiteMap = {
  'OOP & Advanced Python': ['Python Foundations'],
  'NumPy & Pandas': ['Python Foundations'],
  'EDA & Visualization': ['NumPy & Pandas'],
  'Descriptive Statistics': ['NumPy & Pandas'],
  'Probability Distributions': ['Descriptive Statistics'],
  'Inferential Statistics': ['Probability Distributions'],
  'Maths & ML Foundations': ['NumPy & Pandas'],
  'Regression & Regularization': ['Maths & ML Foundations', 'Inferential Statistics'],
  'Feature Engineering & Selection': ['Regression & Regularization'],
  'Classification': ['Regression & Regularization'],
  'Trees & Ensembles': ['Classification'],
  'Dimensionality Reduction': ['Maths & ML Foundations'],
  'Model Evaluation': ['Classification'],
  'Unsupervised Learning': ['Dimensionality Reduction'],
  'MLOps & Deployment': ['Trees & Ensembles'],
  'Capstone Project': [
    'Model Evaluation',
    'Feature Engineering & Selection',
    'MLOps & Deployment',
  ],
};

const lower = (s: string): string => s.trim().toLowerCase();

/**
 * Resolve prerequisites for a Display_Name, preferring the note-level map and
 * falling back to the track-level one.
 *
 * `preferTrack` flips the lookup order for a main-spine node, where the track
 * reading is the intended one even though a note may share the name (the
 * "Probability Distributions" collision). Matching is case-insensitive and
 * whitespace-trimmed so a stray casing difference can never silently drop an
 * edge. Returns `[]` when the topic has no prerequisites.
 */
export function prerequisitesFor(name: string, preferTrack = false): string[] {
  const target = lower(name);
  const first = preferTrack ? TRACK_PREREQUISITES : TOPIC_PREREQUISITES;
  const second = preferTrack ? TOPIC_PREREQUISITES : TRACK_PREREQUISITES;
  for (const map of [first, second]) {
    for (const key of Object.keys(map)) {
      if (lower(key) === target) return map[key] ?? [];
    }
  }
  return [];
}

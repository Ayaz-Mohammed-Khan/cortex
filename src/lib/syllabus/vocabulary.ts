/**
 * Data-science vocabulary: the DOMAIN KNOWLEDGE behind syllabus-to-note linking.
 *
 * The matcher (`match.ts`) is deliberately dumb about subject matter; everything
 * it "knows" about data science lives here as reviewable data. That split is the
 * point: adding a term is a one-line data edit, not a code change, and the
 * reasoning behind any link can always be traced back to a table you can read.
 *
 * Three kinds of knowledge are encoded:
 *
 *   1. {@link ALIAS_GROUPS}    terms that mean the same thing ("PMF" and
 *      "probability mass function"), folded onto one canonical token so the two
 *      spellings compare equal.
 *   2. {@link STOPWORDS}       words that carry no topic signal ("the", "of").
 *   3. {@link GENERIC_TOKENS}  words that are real topics but far too common to
 *      identify a section on their own ("summary", "steps", "formula"). A bullet
 *      that reduces to nothing but these may only ever match EXACTLY, never by
 *      the looser subset/overlap tiers, because "Steps" could belong anywhere.
 *
 * Ordering rule for {@link ALIAS_GROUPS}: element 0 is the canonical form. It
 * should be the SHORTEST unambiguous spelling, normally the acronym, so that
 * multi-word phrases collapse to a single token and token-set comparisons stay
 * meaningful.
 */

/**
 * Groups of interchangeable terms. Element 0 is canonical; every other element
 * is rewritten to it during normalization.
 *
 * Multi-word members are matched as PHRASES before tokenization, longest first,
 * so "probability density function" becomes the single token `pdf` rather than
 * three tokens that happen to overlap with unrelated headings.
 */
export const ALIAS_GROUPS: readonly (readonly string[])[] = [
  // ---- Probability & distributions ----------------------------------------
  ['pmf', 'probability mass function'],
  ['pdf', 'probability density function'],
  ['cdf', 'cumulative distribution function'],
  ['kde', 'kernel density estimate', 'kernel density estimation', 'non parametric density estimation'],
  ['gaussian', 'normal', 'normality', 'normally'],
  ['zscore', 'z score', 'standard score', 'standardization', 'standardisation', 'standardize', 'standardise'],
  ['ztable', 'z table'],
  ['ztest', 'z test'],
  ['ttest', 't test'],
  ['tdistribution', 't distribution'],
  ['chisquare', 'chi square', 'chi squared'],
  ['clt', 'central limit theorem'],
  ['iqr', 'inter quartile range', 'interquartile range'],
  ['bernoulli', 'bernouli'],
  ['lognormal', 'log gaussian'],

  // ---- Descriptive statistics ---------------------------------------------
  ['cv', 'coefficient of variation'],
  ['mad', 'mean absolute deviation'],
  ['sd', 'standard deviation', 'std dev', 'stddev'],
  ['dispersion', 'spread', 'variability'],
  ['percentile', 'quantile'],
  ['univariate', 'one variable'],
  ['bivariate', 'two variable'],
  ['multivariate', 'many variable', 'multiple variable'],

  // ---- Inference ----------------------------------------------------------
  ['ci', 'confidence interval'],
  ['type1', 'type i', 'type 1', 'false positive'],
  ['type2', 'type ii', 'type 2', 'false negative'],
  ['pvalue', 'p value'],
  ['alternate', 'alternative'],
  ['rejection', 'critical'],
  ['anova', 'analysis of variance'],

  // ---- Linear algebra & maths --------------------------------------------
  ['svd', 'singular value decomposition'],
  ['pca', 'principal component analysis'],
  ['lda', 'linear discriminant analysis'],
  ['tsne', 't sne', 't distributed stochastic neighbor embedding'],
  ['eigenvector', 'eigen vector'],
  ['eigenvalue', 'eigen value'],
  ['eigendecomposition', 'eigen decomposition', 'spectral decomposition'],
  ['dotproduct', 'dot product', 'inner product', 'scalar product'],
  ['derivative', 'differentiation', 'differential'],

  // ---- Machine learning ---------------------------------------------------
  ['ml', 'machine learning'],
  ['dl', 'deep learning'],
  ['nlp', 'natural language processing'],
  ['eda', 'exploratory data analysis'],
  ['mldlc', 'machine learning development lifecycle', 'ml development lifecycle'],
  ['linreg', 'linear regression'],
  ['logreg', 'logistic regression'],
  ['mlr', 'multiple linear regression'],
  ['slr', 'simple linear regression'],
  ['gd', 'gradient descent'],
  ['sgd', 'stochastic gradient descent'],
  ['knn', 'k nearest neighbor', 'k nearest neighbour', 'nearest neighbor'],
  ['svm', 'support vector machine'],
  ['svc', 'support vector classifier'],
  ['svr', 'support vector regressor', 'support vector regression'],
  ['dt', 'decision tree'],
  ['rf', 'random forest'],
  ['gbm', 'gradient boosting', 'gradient boosted machine'],
  ['xgboost', 'extreme gradient boosting'],
  ['nb', 'naive bayes', 'naive bayse'],
  ['gmm', 'gaussian mixture model'],
  ['dbscan', 'density based clustering'],
  ['kmeans', 'k means'],
  ['mle', 'maximum likelihood estimation', 'maximum likelihood'],
  ['ols', 'ordinary least squares'],
  ['vif', 'variance inflation factor'],
  ['rfe', 'recursive feature elimination'],
  ['ohe', 'one hot encoding', 'one hot encode'],
  ['smote', 'synthetic minority oversampling technique'],
  ['cart', 'classification and regression tree'],
  ['oob', 'out of bag'],
  ['cv_crossval', 'cross validation'],
  ['loocv', 'leave one out cross validation'],
  ['kfold', 'k fold'],
  ['roc', 'receiver operating characteristic'],
  ['auc', 'area under the curve', 'area under curve'],
  ['tpr', 'true positive rate', 'recall', 'sensitivity'],
  ['fpr', 'false positive rate'],
  ['mae', 'mean absolute error'],
  ['mse', 'mean squared error'],
  ['rmse', 'root mean squared error'],
  ['r2', 'r squared', 'r 2 score', 'coefficient of determination'],
  ['regularization', 'regularisation'],
  ['hyperparameter', 'hyper parameter'],
  ['featureengineering', 'feature engineering'],
  ['featureselection', 'feature selection'],
  ['featurescaling', 'feature scaling'],
  ['imbalanceddata', 'imbalanced data', 'imbalance data', 'class imbalance'],
  ['outlier', 'anomaly'],
  ['imputation', 'imputer', 'impute'],
  ['discretization', 'discretisation', 'binning'],
  ['boxcox', 'box cox'],
  ['yeojohnson', 'yeo johnson'],
  // Sklearn class names appear unspaced in headings ("FunctionTransformer
  // transforms") but spaced in prose, so they need an explicit bridge.
  ['functiontransformer', 'function transformer'],
  ['powertransformer', 'power transformer'],
  ['columntransformer', 'column transformer'],
  ['simpleimputer', 'simple imputer'],
  ['knnimputer', 'knn imputer'],
  ['iterativeimputer', 'iterative imputer'],
  ['standardscaler', 'standard scaler'],
  ['minmaxscaler', 'minmax scaler', 'min max scaler'],
  ['robustscaler', 'robust scaler'],
  ['labelencoder', 'label encoder'],
  ['ordinalencoder', 'ordinal encoder'],
  ['onehotencoder', 'one hot encoder'],
  ['targetencoder', 'target encoder'],

  // ---- Engineering & MLOps ----------------------------------------------
  ['mlops', 'ml ops'],
  ['dvc', 'data version control'],
  ['vcs', 'version control system', 'version control'],
  ['cicd', 'ci cd', 'continuous integration continuous deployment'],
  ['api', 'application programming interface'],
  ['etl', 'extract transform load'],
  ['oop', 'object oriented programming'],
  ['db', 'database'],
  ['sql', 'structured query language'],
  ['ddl', 'data definition language'],
  ['dml', 'data manipulation language'],
  ['k8s', 'kubernetes'],
  ['ec2', 'elastic compute cloud'],
  ['s3', 'simple storage service'],
  ['rds', 'relational database service'],
  ['ecr', 'elastic container registry'],

  // ---- Common verb / noun variants --------------------------------------
  ['use', 'used', 'using', 'usage', 'uses', 'apply', 'applied', 'application'],
  ['build', 'built', 'building', 'construct', 'construction'],
  ['interpret', 'interpreting', 'interpretation', 'read', 'reading'],
  ['check', 'checking', 'verify', 'verifying', 'validate', 'validating'],
  ['calculate', 'calculating', 'calculation', 'compute', 'computing', 'computation'],
  ['select', 'selecting', 'selection', 'choose', 'choosing'],
  ['handle', 'handling', 'deal', 'dealing'],
  ['detect', 'detecting', 'detection', 'find', 'finding'],
  ['visualize', 'visualise', 'visualizing', 'visualising', 'visualization', 'visualisation', 'plot', 'plotting', 'graph', 'chart'],
  ['intuition', 'intuitive', 'geometric intuition'],
  ['limitation', 'drawback', 'disadvantage', 'weakness', 'flaw', 'problem'],
  ['benefit', 'advantage', 'strength'],
  ['assumption', 'condition', 'criteria', 'criterion', 'requirement'],
  ['formula', 'equation'],
  ['parameter', 'param'],
  ['category', 'categorical'],
  ['number', 'numerical', 'numeric'],
  ['probability', 'probabilistic'],
];

/**
 * Singular words ending in `s` that de-pluralization must leave alone.
 *
 * Endings that are never plural markers (`ss`, `sis`, `us`, `is`) are handled by
 * rule in `normalize.ts`; this list covers the rest. A vowel-before-s rule would
 * catch "bias" but would also wrongly protect every `-es` plural ("tables"), so
 * an explicit list is both shorter and safer.
 */
export const SINGULAR_EXCEPTIONS: ReadonlySet<string> = new Set([
  'bias', 'lens', 'series', 'species', 'news', 'canvas', 'atlas', 'alias',
  'gas', 'plus', 'minus', 'versus', 'class', 'always', 'perhaps', 'yes',
]);

/** Words that carry no topic signal and are dropped during normalization. */
export const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'of', 'in', 'on',
  'at', 'to', 'for', 'from', 'by', 'with', 'without', 'about', 'into', 'onto',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'do', 'does', 'did',
  'it', 'its', 'this', 'that', 'these', 'those', 'we', 'you', 'our', 'your',
  'what', 'which', 'who', 'whom', 'how', 'why', 'when', 'where',
  'so', 'as', 'than', 'too', 'very', 'just', 'also', 'not', 'no',
  'some', 'any', 'all', 'more', 'most', 'other', 'others', 'such',
  'can', 'will', 'would', 'should', 'could', 'may', 'might', 'must',
  'there', 'here', 'both', 'each', 'via', 'vs',
]);

/**
 * STRUCTURAL words: they describe a document's furniture rather than its
 * subject, and appear as a heading in nearly every note. A topic that reduces to
 * nothing but these cannot identify a section, so `match.ts` refuses it the
 * loose tiers — "Steps" would otherwise attach itself to an arbitrary section.
 *
 * Kept deliberately tight. Subject words that merely happen to be common
 * ("parameter", "assumption", "formula", "intuition") are NOT listed: they carry
 * real meaning, and ambiguity between notes is already handled by the matcher's
 * uniqueness check. Over-listing here silently suppresses correct links.
 */
export const GENERIC_TOKENS: ReadonlySet<string> = new Set([
  'summary', 'introduction', 'intro', 'overview', 'conclusion', 'recap',
  'step', 'example', 'code', 'demo', 'demonstration', 'practice', 'exercise',
  'note', 'detail', 'part', 'section', 'chapter', 'topic', 'concept',
  'basic', 'fundamental', 'key', 'main', 'important', 'idea', 'case', 'point',
  'question', 'answer', 'doubt', 'hands', 'session', 'week', 'task',
  'assignment', 'revision', 'result', 'work', 'working', 'start', 'end',
]);

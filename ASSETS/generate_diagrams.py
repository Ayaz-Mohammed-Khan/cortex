"""
Generates all diagrams used in the Cortex markdown notes.

Each PNG is written into the ASSETS/ folder of the roadmap track that uses it,
e.g. content/01 - Descriptive Statistics/ASSETS/, so every note's category owns
its own images. See IMAGE_FOLDERS below for the image -> track mapping.

Track folders follow Cortex's `NN - Track Name` convention under content/. The
`_track()` helper resolves a track to its existing numbered folder (matching on
the clean name after the NN prefix); if no folder exists yet it creates one with
the preferred prefix passed in, so the script works before a track is authored.

Run:  python generate_diagrams.py
"""

import os
import re
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.patches import Patch, FancyBboxPatch, Circle, Ellipse
from scipy import stats

# ----------------------------------------------------------------------------- setup
# Cortex content root, resolved relative to this file (ASSETS/ -> repo root).
_REPO_ROOT = os.path.dirname(os.path.dirname(__file__))
_CONTENT = os.environ.get("CONTENT_ROOT", os.path.join(_REPO_ROOT, "content"))

_PREFIX_RE = re.compile(r"^\s*\d+\s*[-_.]\s*")


def _display_name(folder_name):
    """Strip the leading `NN -` order prefix to get a track's clean name."""
    return _PREFIX_RE.sub("", folder_name).strip()


def _track(track_name, preferred_prefix):
    """Return the ASSETS/ path for a roadmap track under content/.

    Finds the existing `NN - <track_name>` folder by matching the clean display
    name (case-insensitive), so already-authored tracks resolve to their real
    folder regardless of the number. If none exists, creates
    `<preferred_prefix> - <track_name>` so figures still have a home before the
    track's notes are written.
    """
    target = track_name.casefold()
    if os.path.isdir(_CONTENT):
        for name in os.listdir(_CONTENT):
            if os.path.isdir(os.path.join(_CONTENT, name)) and \
                    _display_name(name).casefold() == target:
                return os.path.join(_CONTENT, name, "ASSETS")
    folder = f"{preferred_prefix} - {track_name}"
    return os.path.join(_CONTENT, folder, "ASSETS")


# Roadmap track ASSETS/ folders. The clean track names match `Step.label` in
# src/data/roadmap.ts; the numbers are the fallback prefix used only if a track
# folder does not exist yet. The three statistics tracks already exist and
# resolve to their real 01/02/03 folders.
_DESCRIPTIVE = _track("Descriptive Statistics", "06")
_PROBABILITY = _track("Probability Distributions", "07")
_INFERENTIAL = _track("Inferential Statistics", "08")
_MATHS_ML = _track("Maths & ML Foundations", "09")
_PYTHON = _track("Python Foundations", "01")

# Which track ASSETS/ folder each image belongs in. The statistics images are
# split across the three Cortex statistics tracks to match where each note lives.
IMAGE_FOLDERS = {
    # Descriptive Statistics
    "mean_median_outlier.png": _DESCRIPTIVE, "boxplot_anatomy.png": _DESCRIPTIVE,
    "histogram_shapes.png": _DESCRIPTIVE, "covariance_quadrants.png": _DESCRIPTIVE,
    "correlation_scatter.png": _DESCRIPTIVE,
    # Probability Distributions
    "pmf_vs_pdf.png": _PROBABILITY, "pdf_area.png": _PROBABILITY,
    "kde_concept.png": _PROBABILITY, "pdf_cdf.png": _PROBABILITY,
    "normal_distribution.png": _PROBABILITY, "normal_parameters.png": _PROBABILITY,
    "empirical_rule.png": _PROBABILITY, "skewness.png": _PROBABILITY,
    "kurtosis.png": _PROBABILITY, "qq_plot.png": _PROBABILITY,
    "uniform_distribution.png": _PROBABILITY, "lognormal_distribution.png": _PROBABILITY,
    "pareto_distribution.png": _PROBABILITY, "transformation.png": _PROBABILITY,
    "bernoulli_pmf.png": _PROBABILITY, "binomial_shapes.png": _PROBABILITY,
    "binomial_simulation.png": _PROBABILITY,
    # Inferential Statistics
    "clt_convergence.png": _INFERENTIAL, "confidence_interval.png": _INFERENTIAL,
    "t_vs_normal.png": _INFERENTIAL, "tailed_tests.png": _INFERENTIAL,
    "type1_type2.png": _INFERENTIAL, "pvalue_area.png": _INFERENTIAL,
    "chi_square.png": _INFERENTIAL, "f_distribution.png": _INFERENTIAL,
    "anova_variance.png": _INFERENTIAL,
    # Maths & ML Foundations (tensors, linear algebra, ML fundamentals)
    "vector_components.png": _MATHS_ML, "mean_centering.png": _MATHS_ML,
    "dot_product_geometry.png": _MATHS_ML, "hyperplane.png": _MATHS_ML,
    "linear_transformation.png": _MATHS_ML, "matrix_composition.png": _MATHS_ML,
    "determinant_area.png": _MATHS_ML, "tensor_dimensions.png": _MATHS_ML,
    "traditional_vs_ml.png": _MATHS_ML, "ai_ml_dl_hierarchy.png": _MATHS_ML,
    "ml_vs_dl_data.png": _MATHS_ML, "ml_types_supervision.png": _MATHS_ML,
    "regression_vs_classification.png": _MATHS_ML, "clustering_example.png": _MATHS_ML,
    "batch_vs_online.png": _MATHS_ML, "instance_vs_model.png": _MATHS_ML,
    "overfitting_underfitting.png": _MATHS_ML, "mldlc_cycle.png": _MATHS_ML,
    # Python Foundations: basics
    "compiler_vs_interpreter.png": _PYTHON,
    "variable_reference_model.png": _PYTHON,
    "type_conversion_new_object.png": _PYTHON,
    "print_sep_end.png": _PYTHON,
    "python_type_map.png": _PYTHON,
    # Python Foundations: operators & control flow
    "control_flow_branching.png": _PYTHON,
    "loop_execution.png": _PYTHON,
    "break_vs_continue.png": _PYTHON,
    # Python Foundations: strings
    "string_indexing.png": _PYTHON,
    "string_slicing.png": _PYTHON,
    # Python Foundations: time complexity
    "complexity_classes.png": _PYTHON,
    # Python Foundations: lists
    "list_vs_array_memory.png": _PYTHON,
    # Python Foundations: tuples, sets & dicts
    "set_operations.png": _PYTHON,
    # Python Foundations: functions
    "function_anatomy.png": _PYTHON,
    "function_scope.png": _PYTHON,
    "map_filter_reduce.png": _PYTHON,
}

# Fallback for any new image not yet mapped above.
_FALLBACK = os.path.join(os.path.dirname(__file__), "distributions")

for _folder in set(IMAGE_FOLDERS.values()):
    os.makedirs(_folder, exist_ok=True)

# consistent, clean palette
BLUE, ORANGE, GREEN, RED, PURPLE, GREY = (
    "#4C72B0", "#DD8452", "#55A868", "#C44E52", "#8172B3", "#8C8C8C",
)

plt.rcParams.update({
    "figure.dpi": 150,
    "savefig.dpi": 150,
    "font.size": 11,
    "axes.titlesize": 13,
    "axes.titleweight": "bold",
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.grid": True,
    "grid.alpha": 0.25,
    "figure.facecolor": "white",
    "axes.facecolor": "white",
})


def save(fig, name):
    folder = IMAGE_FOLDERS.get(name, _FALLBACK)
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, name)
    fig.savefig(path, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print("saved", path)


# ============================================================ Bernoulli & Binomial
def bernoulli_pmf():
    fig, axes = plt.subplots(1, 3, figsize=(10, 3.2), sharey=True)
    for ax, p, c in zip(axes, [0.2, 0.5, 0.8], [RED, PURPLE, BLUE]):
        ax.bar([0, 1], [1 - p, p], color=c, width=0.45, edgecolor="black")
        ax.set_title(f"p = {p}")
        ax.set_xticks([0, 1])
        ax.set_xlabel("outcome")
        ax.set_ylim(0, 1)
        ax.text(0, 1 - p + 0.03, f"{1-p:.1f}", ha="center", fontsize=10)
        ax.text(1, p + 0.03, f"{p:.1f}", ha="center", fontsize=10)
    axes[0].set_ylabel("probability")
    fig.suptitle("Bernoulli PMF — always two bars (failure=0, success=1)", y=1.03)
    save(fig, "bernoulli_pmf.png")


def binomial_shapes():
    n = 10
    x = np.arange(0, n + 1)
    fig, axes = plt.subplots(1, 3, figsize=(11, 3.4), sharey=True)
    specs = [(0.15, RED, "small p → right-skewed"),
             (0.5, PURPLE, "p = 0.5 → symmetric"),
             (0.85, BLUE, "large p → left-skewed")]
    for ax, (p, c, title) in zip(axes, specs):
        ax.bar(x, stats.binom.pmf(x, n, p), color=c, edgecolor="black", width=0.8)
        ax.set_title(title)
        ax.set_xlabel("number of successes")
    axes[0].set_ylabel("probability")
    fig.suptitle("Binomial PMF (n = 10) — shape depends on p", y=1.03)
    save(fig, "binomial_shapes.png")


def binomial_simulation():
    rng = np.random.default_rng(42)
    data = rng.binomial(n=10, p=0.5, size=10000)
    fig, ax = plt.subplots(figsize=(6.5, 3.6))
    bins = np.arange(-0.5, 11.5, 1)
    ax.hist(data, bins=bins, color=BLUE, edgecolor="black", rwidth=0.9,
            density=True, label="simulated (10,000 runs)")
    x = np.arange(0, 11)
    ax.plot(x, stats.binom.pmf(x, 10, 0.5), "o-", color=RED, label="theoretical PMF")
    ax.set_title("10 coin tosses, repeated 10,000 times")
    ax.set_xlabel("number of heads")
    ax.set_ylabel("probability")
    ax.legend()
    save(fig, "binomial_simulation.png")


# ============================================================ Central Limit Theorem
def clt_convergence():
    rng = np.random.default_rng(0)
    fig, axes = plt.subplots(2, 3, figsize=(11, 6))
    pops = [
        ("Uniform population", lambda size: rng.uniform(0, 1, size)),
        ("Exponential population", lambda size: rng.exponential(1.0, size)),
        ("Binomial population", lambda size: rng.binomial(10, 0.3, size)),
    ]
    for col, (title, sampler) in enumerate(pops):
        # population
        axes[0, col].hist(sampler(10000), bins=40, color=GREY, edgecolor="none")
        axes[0, col].set_title(title)
        # sampling distribution of the mean
        means = [sampler(30).mean() for _ in range(2000)]
        axes[1, col].hist(means, bins=40, color=GREEN, edgecolor="none", density=True)
        mu, sd = np.mean(means), np.std(means)
        xs = np.linspace(min(means), max(means), 200)
        axes[1, col].plot(xs, stats.norm.pdf(xs, mu, sd), color=RED, lw=2)
        axes[1, col].set_title("Sampling dist. of mean (n=30)")
    axes[0, 0].set_ylabel("population\ncount", fontsize=10)
    axes[1, 0].set_ylabel("density of\nsample means", fontsize=10)
    fig.suptitle("Central Limit Theorem: any population → normal sampling distribution of the mean",
                 y=1.02, fontsize=13, fontweight="bold")
    fig.tight_layout()
    save(fig, "clt_convergence.png")


# ============================================================ Confidence intervals
def t_vs_normal():
    x = np.linspace(-4, 4, 400)
    fig, ax = plt.subplots(figsize=(7, 3.8))
    ax.plot(x, stats.norm.pdf(x), color=BLUE, lw=2.2, label="Normal")
    for df, c in [(1, ORANGE), (5, GREEN)]:
        ax.plot(x, stats.t.pdf(x, df), color=c, lw=2, label=f"t (df={df})")
    ax.set_title("t-distribution has fatter tails than the normal")
    ax.set_xlabel("z / t")
    ax.set_ylabel("density")
    ax.legend()
    # annotate the fat tail
    ax.annotate("fatter tails\n(more area far out)", xy=(2.6, stats.t.pdf(2.6, 1)),
                xytext=(1.6, 0.22), fontsize=9,
                arrowprops=dict(arrowstyle="->", color="black"))
    save(fig, "t_vs_normal.png")


def confidence_interval():
    x = np.linspace(-4, 4, 500)
    y = stats.norm.pdf(x)
    fig, ax = plt.subplots(figsize=(7, 3.8))
    ax.plot(x, y, color=BLUE, lw=2)
    z = 1.96
    mask = (x >= -z) & (x <= z)
    ax.fill_between(x[mask], y[mask], color=BLUE, alpha=0.25)
    for v in (-z, z):
        ax.axvline(v, color=RED, ls="--", lw=1.3)
    ax.text(0, 0.15, "95%", ha="center", fontsize=14, fontweight="bold")
    ax.text(-z, -0.03, "-1.96", ha="center", color=RED)
    ax.text(z, -0.03, "1.96", ha="center", color=RED)
    ax.text(2.9, 0.02, "2.5%", ha="center", fontsize=9)
    ax.text(-2.9, 0.02, "2.5%", ha="center", fontsize=9)
    ax.set_title("95% confidence: middle 95% lies within ±1.96 (standard normal)")
    ax.set_xlabel("z")
    ax.set_ylabel("density")
    save(fig, "confidence_interval.png")


# ============================================================ Hypothesis testing
def tailed_tests():
    x = np.linspace(-4, 4, 500)
    y = stats.norm.pdf(x)
    fig, axes = plt.subplots(1, 2, figsize=(11, 3.6), sharey=True)

    # one-tailed
    ax = axes[0]
    ax.plot(x, y, color=BLUE, lw=2)
    zc = 1.645
    m = x >= zc
    ax.fill_between(x[m], y[m], color=RED, alpha=0.35)
    ax.axvline(zc, color=RED, ls="--")
    ax.text(2.5, 0.03, "α = 0.05", color=RED, ha="center", fontsize=9)
    ax.text(zc, -0.03, "1.645", ha="center", color=RED)
    ax.set_title("One-tailed (H₁: μ > value)")
    ax.set_xlabel("z")
    ax.set_ylabel("density")

    # two-tailed
    ax = axes[1]
    ax.plot(x, y, color=BLUE, lw=2)
    zc = 1.96
    ax.fill_between(x[x >= zc], y[x >= zc], color=RED, alpha=0.35)
    ax.fill_between(x[x <= -zc], y[x <= -zc], color=RED, alpha=0.35)
    for v in (-zc, zc):
        ax.axvline(v, color=RED, ls="--")
    ax.text(2.7, 0.02, "0.025", color=RED, ha="center", fontsize=9)
    ax.text(-2.7, 0.02, "0.025", color=RED, ha="center", fontsize=9)
    ax.set_title("Two-tailed (H₁: μ ≠ value)")
    ax.set_xlabel("z")
    save(fig, "tailed_tests.png")


def type1_type2():
    x = np.linspace(-4, 7, 600)
    h0 = stats.norm.pdf(x, 0, 1)
    h1 = stats.norm.pdf(x, 3, 1)
    zc = 1.645
    fig, ax = plt.subplots(figsize=(8, 3.8))
    ax.plot(x, h0, color=BLUE, lw=2, label="H₀ true")
    ax.plot(x, h1, color=GREEN, lw=2, label="H₁ true")
    ax.fill_between(x[x >= zc], h0[x >= zc], color=RED, alpha=0.4)
    ax.fill_between(x[x <= zc], h1[x <= zc], color=ORANGE, alpha=0.4)
    ax.axvline(zc, color="black", ls="--", lw=1)
    ax.text(2.4, 0.05, "Type I (α)", color=RED, fontsize=9)
    ax.text(0.3, 0.05, "Type II (β)", color=ORANGE, fontsize=9)
    ax.set_title("Type I vs Type II error (shifting the cutoff trades one for the other)")
    ax.set_xlabel("test statistic")
    ax.set_ylabel("density")
    ax.legend(loc="upper right")
    save(fig, "type1_type2.png")


# ============================================================ p-value
def pvalue_area():
    x = np.linspace(-4, 4, 500)
    y = stats.norm.pdf(x)
    fig, ax = plt.subplots(figsize=(7, 3.8))
    ax.plot(x, y, color=BLUE, lw=2)
    zobs = 1.3
    ax.fill_between(x[x >= zobs], y[x >= zobs], color=RED, alpha=0.4)
    ax.axvline(zobs, color=RED, ls="--")
    ax.text(zobs, -0.03, "observed", ha="center", color=RED)
    ax.annotate("p-value = area\nas/more extreme", xy=(2.1, 0.02),
                xytext=(2.2, 0.16), fontsize=9,
                arrowprops=dict(arrowstyle="->"))
    ax.set_title("The p-value is the tail area beyond the observed statistic")
    ax.set_xlabel("test statistic")
    ax.set_ylabel("density")
    save(fig, "pvalue_area.png")


# ============================================================ Chi-square
def chi_square():
    x = np.linspace(0, 20, 500)
    fig, ax = plt.subplots(figsize=(7, 3.8))
    for df, c in [(1, RED), (2, ORANGE), (3, GREEN), (5, BLUE), (10, PURPLE)]:
        ax.plot(x, stats.chi2.pdf(x, df), color=c, lw=2, label=f"df = {df}")
    ax.set_ylim(0, 0.5)
    ax.set_title("Chi-square distribution (right-skewed, mean = df)")
    ax.set_xlabel("χ²")
    ax.set_ylabel("density")
    ax.legend()
    save(fig, "chi_square.png")


# ============================================================ F-distribution & ANOVA
def f_distribution():
    x = np.linspace(0, 5, 500)
    fig, ax = plt.subplots(figsize=(7, 3.8))
    for (d1, d2), c in [((2, 6), RED), ((5, 10), ORANGE),
                        ((10, 20), GREEN), ((20, 40), BLUE)]:
        ax.plot(x, stats.f.pdf(x, d1, d2), color=c, lw=2, label=f"df = ({d1}, {d2})")
    ax.set_ylim(0, 1.0)
    ax.set_title("F-distribution (non-negative, right-skewed)")
    ax.set_xlabel("F")
    ax.set_ylabel("density")
    ax.legend()
    save(fig, "f_distribution.png")


def anova_variance():
    rng = np.random.default_rng(3)
    fig, axes = plt.subplots(1, 2, figsize=(11, 4), sharey=True)
    colors = [BLUE, ORANGE, GREEN]

    # small between-group difference (fail to reject)
    groups_close = [rng.normal(m, 1.4, 25) for m in (5.0, 5.3, 4.8)]
    # large between-group difference (reject)
    groups_far = [rng.normal(m, 1.4, 25) for m in (3.5, 6.0, 8.5)]

    for ax, groups, title in zip(
        axes, [groups_close, groups_far],
        ["Means close → small F → keep H₀", "Means far apart → large F → reject H₀"]):
        grand = np.mean(np.concatenate(groups))
        for i, (g, c) in enumerate(zip(groups, colors)):
            xj = np.full_like(g, i + 1) + rng.normal(0, 0.05, len(g))
            ax.scatter(xj, g, color=c, alpha=0.7, s=18)
            ax.hlines(g.mean(), i + 0.75, i + 1.25, color=c, lw=3)
        ax.axhline(grand, color="black", ls="--", lw=1, label="grand mean")
        ax.set_title(title, fontsize=11)
        ax.set_xticks([1, 2, 3])
        ax.set_xticklabels(["Group A", "Group B", "Group C"])
        ax.legend(loc="upper left", fontsize=8)
    axes[0].set_ylabel("value")
    fig.suptitle("ANOVA compares between-group spread vs within-group spread", y=1.02)
    fig.tight_layout()
    save(fig, "anova_variance.png")


# ============================================================ Normal distribution
def normal_distribution():
    x = np.linspace(-4, 4, 500)
    y = stats.norm.pdf(x)
    fig, ax = plt.subplots(figsize=(7.5, 3.8))
    ax.plot(x, y, color=BLUE, lw=2.3)
    ax.fill_between(x, y, color=BLUE, alpha=0.08)
    ax.axvline(0, color=RED, ls="--", lw=1.3)
    ax.text(0, 0.42, "mean (μ)\npeak", ha="center", color=RED, fontsize=9)
    ax.annotate("tail (never touches axis)", xy=(3.3, 0.01), xytext=(1.4, 0.12),
                fontsize=9, arrowprops=dict(arrowstyle="->"))
    ax.annotate("", xy=(-3.3, 0.01), xytext=(-1.6, 0.06),
                arrowprops=dict(arrowstyle="->"))
    ax.set_title("Normal (Gaussian) distribution — the bell curve")
    ax.set_xlabel("value of the random variable")
    ax.set_ylabel("probability density")
    save(fig, "normal_distribution.png")


def normal_parameters():
    x = np.linspace(-8, 10, 600)
    fig, axes = plt.subplots(1, 2, figsize=(11, 3.6))
    # effect of mu
    for mu, c in [(-2, RED), (0, BLUE), (3, GREEN)]:
        axes[0].plot(x, stats.norm.pdf(x, mu, 1), color=c, lw=2, label=f"μ = {mu}")
    axes[0].set_title("Changing μ shifts the curve")
    axes[0].legend()
    axes[0].set_xlabel("value"); axes[0].set_ylabel("density")
    # effect of sigma
    for sd, c in [(1, BLUE), (2, ORANGE), (3, GREEN)]:
        axes[1].plot(x, stats.norm.pdf(x, 0, sd), color=c, lw=2, label=f"σ = {sd}")
    axes[1].set_title("Changing σ changes the spread")
    axes[1].legend()
    axes[1].set_xlabel("value")
    fig.tight_layout()
    save(fig, "normal_parameters.png")


def empirical_rule():
    x = np.linspace(-4, 4, 600)
    y = stats.norm.pdf(x)
    fig, ax = plt.subplots(figsize=(8, 3.9))
    ax.plot(x, y, color="black", lw=1.5)
    bands = [(-1, 1, BLUE, "68%"), (-2, -1, ORANGE, "13.5%"), (1, 2, ORANGE, "13.5%"),
             (-3, -2, GREEN, "2.35%"), (2, 3, GREEN, "2.35%")]
    for lo, hi, c, label in bands:
        m = (x >= lo) & (x <= hi)
        ax.fill_between(x[m], y[m], color=c, alpha=0.45)
    for v in range(-3, 4):
        ax.axvline(v, color=GREY, lw=0.6, ls=":")
    ax.text(0, 0.16, "68%", ha="center", fontweight="bold")
    ax.text(1.5, 0.05, "13.5%", ha="center", fontsize=8)
    ax.text(-1.5, 0.05, "13.5%", ha="center", fontsize=8)
    ax.text(2.5, 0.015, "2.35%", ha="center", fontsize=8)
    ax.text(-2.5, 0.015, "2.35%", ha="center", fontsize=8)
    ax.set_xticks(range(-3, 4))
    ax.set_xticklabels(["μ-3σ", "μ-2σ", "μ-σ", "μ", "μ+σ", "μ+2σ", "μ+3σ"], fontsize=9)
    ax.set_title("Empirical rule: 68–95–99.7")
    ax.set_ylabel("density")
    save(fig, "empirical_rule.png")


# ============================================================ PMF vs PDF, area, CDF
def pmf_vs_pdf():
    fig, axes = plt.subplots(1, 2, figsize=(11, 3.6))
    x = np.arange(1, 7)
    axes[0].bar(x, np.full(6, 1 / 6), color=BLUE, edgecolor="black", width=0.6)
    axes[0].set_title("Discrete → PMF (bars with gaps)")
    axes[0].set_xlabel("die outcome"); axes[0].set_ylabel("probability")
    axes[0].set_ylim(0, 0.3)

    xs = np.linspace(-4, 4, 400)
    axes[1].plot(xs, stats.norm.pdf(xs), color=GREEN, lw=2.3)
    axes[1].fill_between(xs, stats.norm.pdf(xs), color=GREEN, alpha=0.12)
    axes[1].set_title("Continuous → PDF (smooth curve)")
    axes[1].set_xlabel("value"); axes[1].set_ylabel("density")
    fig.tight_layout()
    save(fig, "pmf_vs_pdf.png")


def pdf_area():
    x = np.linspace(-4, 4, 500)
    y = stats.norm.pdf(x)
    fig, ax = plt.subplots(figsize=(7, 3.8))
    ax.plot(x, y, color=BLUE, lw=2)
    m = (x >= 0.6) & (x <= 1.6)
    ax.fill_between(x[m], y[m], color=ORANGE, alpha=0.55)
    ax.set_title("Probability = area under the PDF between two points")
    ax.annotate(r"$P(a \leq X \leq b)=\int_a^b f(x)\,dx$", xy=(1.0, 0.12),
                xytext=(1.8, 0.28), fontsize=11,
                arrowprops=dict(arrowstyle="->"))
    ax.text(0.6, -0.03, "a", ha="center"); ax.text(1.6, -0.03, "b", ha="center")
    ax.set_xlabel("value"); ax.set_ylabel("density")
    save(fig, "pdf_area.png")


def pdf_cdf():
    x = np.linspace(-4, 4, 500)
    fig, axes = plt.subplots(1, 2, figsize=(11, 3.6))
    axes[0].plot(x, stats.norm.pdf(x), color=BLUE, lw=2.2)
    axes[0].fill_between(x, stats.norm.pdf(x), color=BLUE, alpha=0.1)
    axes[0].set_title("PDF")
    axes[0].set_xlabel("value"); axes[0].set_ylabel("density")
    axes[1].plot(x, stats.norm.cdf(x), color=PURPLE, lw=2.2)
    axes[1].axhline(0.5, color=GREY, ls=":")
    axes[1].axvline(0, color=GREY, ls=":")
    axes[1].set_title("CDF  (integrate PDF ⟶ ;  differentiate CDF ⟵)")
    axes[1].set_xlabel("value"); axes[1].set_ylabel("cumulative probability")
    fig.tight_layout()
    save(fig, "pdf_cdf.png")


# ============================================================ Skewness & kurtosis
def skewness():
    fig, axes = plt.subplots(1, 3, figsize=(11, 3.4), sharey=True)
    x = np.linspace(0, 20, 500)
    # right skew
    axes[0].plot(x, stats.lognorm.pdf(x, 0.6, scale=3), color=RED, lw=2)
    axes[0].set_title("Positive (right) skew\nmode < median < mean")
    # symmetric
    xs = np.linspace(-5, 5, 400)
    axes[1].plot(xs, stats.norm.pdf(xs), color=PURPLE, lw=2)
    axes[1].set_title("Symmetric\nmean = median = mode")
    # left skew
    axes[2].plot(x, stats.lognorm.pdf(20 - x, 0.6, scale=3), color=GREEN, lw=2)
    axes[2].set_title("Negative (left) skew\nmean < median < mode")
    for ax in axes:
        ax.set_xlabel("value")
    axes[0].set_ylabel("density")
    fig.tight_layout()
    save(fig, "skewness.png")


def kurtosis():
    x = np.linspace(-5, 5, 500)
    fig, ax = plt.subplots(figsize=(7, 3.8))
    ax.plot(x, stats.t.pdf(x, 3), color=RED, lw=2, label="Leptokurtic (fat tails, excess > 0)")
    ax.plot(x, stats.norm.pdf(x), color=PURPLE, lw=2, label="Mesokurtic (normal, excess ≈ 0)")
    ax.plot(x, stats.uniform.pdf(x, -2.5, 5), color=GREEN, lw=2, label="Platykurtic (thin tails, excess < 0)")
    ax.set_title("Kurtosis measures tail heaviness (not peakedness)")
    ax.set_xlabel("value"); ax.set_ylabel("density")
    ax.legend(fontsize=8)
    save(fig, "kurtosis.png")


def qq_plot():
    rng = np.random.default_rng(1)
    fig, axes = plt.subplots(1, 2, figsize=(10, 4))
    stats.probplot(rng.normal(0, 1, 300), dist="norm", plot=axes[0])
    axes[0].set_title("Normal data → points on the line")
    stats.probplot(rng.exponential(1, 300), dist="norm", plot=axes[1])
    axes[1].set_title("Skewed data → deviates at the tails")
    for ax in axes:
        ax.get_lines()[0].set_color(BLUE)
        ax.get_lines()[0].set_markersize(3)
        ax.get_lines()[1].set_color(RED)
    fig.tight_layout()
    save(fig, "qq_plot.png")


# ============================================================ Non-Gaussian
def uniform_distribution():
    fig, axes = plt.subplots(1, 2, figsize=(11, 3.4))
    x = np.linspace(-1, 6, 500)
    a, b = 1, 5
    pdf = np.where((x >= a) & (x <= b), 1 / (b - a), 0)
    axes[0].plot(x, pdf, color=BLUE, lw=2)
    axes[0].fill_between(x, pdf, color=BLUE, alpha=0.15)
    axes[0].set_title("Uniform PDF (flat between a and b)")
    axes[0].text(3, 1 / (b - a) + 0.01, "1/(b−a)", ha="center", fontsize=9)
    axes[0].set_xlabel("value"); axes[0].set_ylabel("density")
    axes[1].plot(x, stats.uniform.cdf(x, a, b - a), color=PURPLE, lw=2)
    axes[1].set_title("Uniform CDF (straight ramp)")
    axes[1].set_xlabel("value"); axes[1].set_ylabel("cumulative prob.")
    fig.tight_layout()
    save(fig, "uniform_distribution.png")


def lognormal_distribution():
    x = np.linspace(0, 6, 500)
    fig, ax = plt.subplots(figsize=(7, 3.8))
    for s, c in [(0.35, BLUE), (0.6, ORANGE), (1.0, GREEN)]:
        ax.plot(x, stats.lognorm.pdf(x, s), color=c, lw=2, label=f"σ = {s}")
    ax.set_title("Log-normal: right-skewed; log of the data is normal")
    ax.set_xlabel("value"); ax.set_ylabel("density")
    ax.legend()
    save(fig, "lognormal_distribution.png")


def pareto_distribution():
    x = np.linspace(1, 6, 500)
    fig, ax = plt.subplots(figsize=(7, 3.8))
    for a, c in [(1, GREEN), (2, BLUE), (3, RED)]:
        ax.plot(x, stats.pareto.pdf(x, a), color=c, lw=2, label=f"α = {a}")
    ax.set_title("Pareto distribution (power law, the 80–20 rule)")
    ax.set_xlabel("value"); ax.set_ylabel("density")
    ax.legend()
    save(fig, "pareto_distribution.png")


def kde_concept():
    pts = np.array([1.0, 1.6, 2.1, 4.0, 4.4, 6.0])
    x = np.linspace(-1, 8, 500)
    bw = 0.6
    fig, ax = plt.subplots(figsize=(7.5, 3.8))
    total = np.zeros_like(x)
    for p in pts:
        k = stats.norm.pdf(x, p, bw)
        total += k
        ax.plot(x, k, color=GREY, lw=1, alpha=0.8)
    ax.plot(x, total, color=RED, lw=2.4, label="sum = KDE estimate")
    ax.scatter(pts, np.zeros_like(pts), color=BLUE, zorder=5, label="data points")
    ax.set_title("KDE: place a kernel on each point, then sum them")
    ax.set_xlabel("value"); ax.set_ylabel("density")
    ax.legend(fontsize=8)
    save(fig, "kde_concept.png")


def transformation():
    rng = np.random.default_rng(7)
    data = rng.lognormal(0, 0.7, 3000)
    fig, axes = plt.subplots(1, 2, figsize=(11, 3.6))
    axes[0].hist(data, bins=50, color=RED, alpha=0.7, edgecolor="none")
    axes[0].set_title("Before: right-skewed (log-normal)")
    axes[0].set_xlabel("x"); axes[0].set_ylabel("count")
    axes[1].hist(np.log1p(data), bins=50, color=GREEN, alpha=0.7, edgecolor="none")
    axes[1].set_title("After log transform: ≈ normal")
    axes[1].set_xlabel("log(1 + x)")
    fig.tight_layout()
    save(fig, "transformation.png")


# ============================================================ Descriptive statistics
def mean_median_outlier():
    data = np.array([28, 30, 31, 29, 32, 30, 200])
    fig, ax = plt.subplots(figsize=(8, 2.8))
    ax.scatter(data, np.zeros_like(data), color=BLUE, s=70, zorder=3, label="salaries")
    mean, median = data.mean(), np.median(data)
    ax.axvline(mean, color=RED, lw=2, label=f"mean = {mean:.0f}")
    ax.axvline(median, color=GREEN, lw=2, label=f"median = {median:.0f}")
    ax.annotate("outlier", xy=(200, 0), xytext=(150, 0.5), fontsize=9,
                arrowprops=dict(arrowstyle="->"))
    ax.set_yticks([])
    ax.set_ylim(-0.6, 0.9)
    ax.set_title("One outlier drags the mean, but not the median")
    ax.set_xlabel("salary (in thousands)")
    ax.legend(loc="upper center", ncol=3, fontsize=9)
    save(fig, "mean_median_outlier.png")


def boxplot_anatomy():
    core = [213, 241, 260, 281, 290, 314, 321, 350]
    full = core + [6, 1500]
    fig, ax = plt.subplots(figsize=(9.5, 4.0))
    bp = ax.boxplot([full], orientation="horizontal", widths=0.45, patch_artist=True,
                    flierprops=dict(marker="o", markerfacecolor=RED,
                                    markeredgecolor=RED, markersize=8))
    bp["boxes"][0].set(facecolor=BLUE, alpha=0.35, edgecolor=BLUE)
    bp["medians"][0].set(color=RED, lw=2)

    # read the ACTUAL drawn positions so labels line up exactly
    verts = bp["boxes"][0].get_path().vertices[:, 0]
    q1, q3 = float(verts.min()), float(verts.max())
    med = float(bp["medians"][0].get_xdata()[0])
    wlo = min(float(w.get_xdata().min()) for w in bp["whiskers"])
    whi = max(float(w.get_xdata().max()) for w in bp["whiskers"])

    # Q1 / median / Q3 labels fanned out ABOVE the box (spread x so no overlap)
    def above(x, text, tx, color):
        ax.annotate(text, xy=(x, 1.23), xytext=(tx, 2.15), ha="center",
                    fontsize=9.5, color=color, fontweight="bold",
                    arrowprops=dict(arrowstyle="->", color=color, lw=1.2))
    above(q1, "Q1", 60, BLUE)
    above(med, "median", 285, RED)
    above(q3, "Q3", 520, BLUE)

    # whiskers + outliers labelled BELOW
    def below(x, text, tx, ty, color):
        ax.annotate(text, xy=(x, 0.77), xytext=(tx, ty), ha="center",
                    fontsize=8.5, color=color,
                    arrowprops=dict(arrowstyle="->", color=color, lw=1))
    below(wlo, "whisker\n(min within fence)", wlo, -0.35, GREY)
    below(whi, "whisker\n(max within fence)", whi, -0.35, GREY)
    below(6, "outlier", 6, -0.05, RED)
    below(1500, "outlier", 1500, -0.05, RED)

    ax.text(med, 0.5, "IQR (middle 50%)", ha="center", fontsize=9,
            color=BLUE, fontweight="bold")
    ax.set_ylim(-0.7, 2.6)
    ax.set_yticks([])
    ax.set_xlabel("value")
    ax.set_title("Box plot = five-number summary + outliers (1.5×IQR rule)")
    save(fig, "boxplot_anatomy.png")


def histogram_shapes():
    rng = np.random.default_rng(5)
    fig, axes = plt.subplots(1, 5, figsize=(14, 2.9))
    axes[0].hist(rng.normal(0, 1, 3000), bins=30, color=BLUE)
    axes[0].set_title("Symmetric")
    bim = np.concatenate([rng.normal(-2, 0.6, 1500), rng.normal(2, 0.6, 1500)])
    axes[1].hist(bim, bins=30, color=PURPLE)
    axes[1].set_title("Bimodal")
    axes[2].hist(-rng.exponential(1, 3000), bins=30, color=GREEN)
    axes[2].set_title("Left-skewed")
    axes[3].hist(rng.exponential(1, 3000), bins=30, color=ORANGE)
    axes[3].set_title("Right-skewed")
    axes[4].hist(rng.uniform(0, 1, 3000), bins=15, color=RED)
    axes[4].set_title("Uniform")
    for ax in axes:
        ax.set_yticks([])
        ax.set_xticks([])
    save(fig, "histogram_shapes.png")


def covariance_quadrants():
    rng = np.random.default_rng(2)
    x = rng.normal(50, 10, 90)
    y = 0.8 * x + rng.normal(0, 8, 90) + 5
    fig, ax = plt.subplots(figsize=(5.6, 4.8))
    mx, my = x.mean(), y.mean()
    ax.scatter(x, y, color=BLUE, alpha=0.7)
    ax.axvline(mx, color=GREY, ls="--")
    ax.axhline(my, color=GREY, ls="--")
    ax.text(mx + 12, my + 22, "(+)(+) = +", color=GREEN, fontsize=9)
    ax.text(mx - 22, my - 24, "(−)(−) = +", color=GREEN, fontsize=9)
    ax.text(mx - 22, my + 22, "(−)(+) = −", color=RED, fontsize=9)
    ax.text(mx + 12, my - 24, "(+)(−) = −", color=RED, fontsize=9)
    ax.set_title("Covariance: sign of (x−x̄)(y−ȳ) per quadrant")
    ax.set_xlabel("x  (deviation from x̄)")
    ax.set_ylabel("y  (deviation from ȳ)")
    save(fig, "covariance_quadrants.png")


def correlation_scatter():
    rng = np.random.default_rng(9)
    corrs = [1.0, 0.7, 0.0, -0.7, -1.0]
    fig, axes = plt.subplots(1, 5, figsize=(14, 3))
    for ax, r in zip(axes, corrs):
        x = rng.normal(0, 1, 250)
        y = r * x if abs(r) == 1 else r * x + np.sqrt(1 - r**2) * rng.normal(0, 1, 250)
        ax.scatter(x, y, color=BLUE, s=8, alpha=0.55)
        ax.set_title(f"r = {r}")
        ax.set_xticks([]); ax.set_yticks([])
    fig.suptitle("Correlation strength and direction (−1 to +1)", y=1.02)
    save(fig, "correlation_scatter.png")


# ============================================================ Tensors
def tensor_dimensions():
    from matplotlib.patches import Rectangle
    fig, axes = plt.subplots(1, 4, figsize=(13, 3.4))

    def cell(ax, x, y, c=BLUE):
        ax.add_patch(Rectangle((x, y), 1, 1, facecolor=c, alpha=0.5, edgecolor="black"))

    # 0D scalar
    cell(axes[0], 0, 0)
    axes[0].set_title("0D — scalar")
    axes[0].set_xlim(-1, 2); axes[0].set_ylim(-1, 2)
    # 1D vector
    for i in range(4):
        cell(axes[1], i, 0, ORANGE)
    axes[1].set_title("1D — vector")
    axes[1].set_xlim(-0.5, 4.5); axes[1].set_ylim(-2, 3)
    # 2D matrix
    for i in range(3):
        for j in range(3):
            cell(axes[2], i, j, GREEN)
    axes[2].set_title("2D — matrix")
    axes[2].set_xlim(-0.5, 3.5); axes[2].set_ylim(-0.5, 3.5)
    # 3D tensor (offset grids)
    for d, off in enumerate([0, 0.4, 0.8]):
        for i in range(3):
            for j in range(3):
                axes[3].add_patch(Rectangle((i + off, j + off), 1, 1,
                                            facecolor=PURPLE, alpha=0.30,
                                            edgecolor="black"))
    axes[3].set_title("3D — tensor")
    axes[3].set_xlim(-0.5, 4.5); axes[3].set_ylim(-0.5, 4.5)
    for ax in axes:
        ax.set_aspect("equal"); ax.axis("off")
    fig.suptitle("Tensors: stacking each dimension into the next", y=1.02)
    save(fig, "tensor_dimensions.png")


# ============================================================ Vectors
def vector_components():
    fig, ax = plt.subplots(figsize=(5, 5))
    ax.quiver(0, 0, 3, 4, angles="xy", scale_units="xy", scale=1, color=BLUE, width=0.013)
    ax.plot([3, 3], [0, 4], ls="--", color=GREY)
    ax.plot([0, 3], [0, 0], ls="--", color=GREY)
    ax.text(1.4, -0.5, "x-component = 3", ha="center", fontsize=9)
    ax.text(3.15, 2, "y-component = 4", fontsize=9)
    ax.text(1.2, 2.3, "(3, 4)", color=BLUE, fontsize=12, fontweight="bold")
    ax.set_xlim(-1, 6); ax.set_ylim(-1, 6); ax.set_aspect("equal")
    ax.axhline(0, color="black", lw=0.8); ax.axvline(0, color="black", lw=0.8)
    ax.set_title("A vector is a point with components")
    save(fig, "vector_components.png")


def dot_product_geometry():
    fig, axes = plt.subplots(1, 3, figsize=(12, 4))
    pairs = [((3, 1), (1, 3), "acute angle\ncos θ > 0 → similar"),
             ((3, 0), (0, 3), "90°\ncos θ = 0 → orthogonal"),
             ((3, 1), (-2, -1), "obtuse angle\ncos θ < 0 → dissimilar")]
    for ax, (a, b, t) in zip(axes, pairs):
        ax.quiver(0, 0, *a, angles="xy", scale_units="xy", scale=1, color=BLUE, width=0.02)
        ax.quiver(0, 0, *b, angles="xy", scale_units="xy", scale=1, color=ORANGE, width=0.02)
        ax.set_xlim(-3, 4); ax.set_ylim(-3, 4); ax.set_aspect("equal")
        ax.axhline(0, color="black", lw=0.6); ax.axvline(0, color="black", lw=0.6)
        ax.set_title(t, fontsize=10)
    fig.suptitle("Dot product & cosine similarity capture the angle between vectors", y=1.02)
    save(fig, "dot_product_geometry.png")


def mean_centering():
    rng = np.random.default_rng(4)
    pts = rng.normal([6, 5], [1, 1.3], (140, 2))
    fig, axes = plt.subplots(1, 2, figsize=(10, 4), sharex=True, sharey=True)
    axes[0].scatter(pts[:, 0], pts[:, 1], color=BLUE, alpha=0.6)
    axes[0].scatter(*pts.mean(0), color=RED, s=90, marker="X", zorder=5)
    axes[0].set_title("Before: cloud sits away from origin")
    c = pts - pts.mean(0)
    axes[1].scatter(c[:, 0], c[:, 1], color=GREEN, alpha=0.6)
    axes[1].scatter(0, 0, color=RED, s=90, marker="X", zorder=5)
    axes[1].set_title("After mean centering: centered at origin")
    for ax in axes:
        ax.axhline(0, color="black", lw=0.7); ax.axvline(0, color="black", lw=0.7)
    fig.suptitle("Mean centering shifts data to the origin (shape unchanged)", y=1.02)
    save(fig, "mean_centering.png")


def hyperplane():
    rng = np.random.default_rng(1)
    fig, ax = plt.subplots(figsize=(6, 5.2))
    xs = np.linspace(-3, 3, 10)
    ax.plot(xs, -xs, color="black", lw=2, label="hyperplane  wᵀx = 0")
    ax.quiver(0, 0, 1, 1, angles="xy", scale_units="xy", scale=1, color=RED,
              width=0.02, label="w (normal / perpendicular)")
    up = rng.uniform([-2.5, 0.5], [0.5, 3], (15, 2))
    dn = rng.uniform([-0.5, -3], [2.5, -0.5], (15, 2))
    ax.scatter(up[:, 0], up[:, 1], color=BLUE, alpha=0.7, label="one side")
    ax.scatter(dn[:, 0], dn[:, 1], color=ORANGE, alpha=0.7, label="other side")
    ax.set_xlim(-3, 3); ax.set_ylim(-3, 3); ax.set_aspect("equal")
    ax.axhline(0, color=GREY, lw=0.6); ax.axvline(0, color=GREY, lw=0.6)
    ax.set_title("A hyperplane splits space; w is perpendicular to it")
    ax.legend(loc="upper right", fontsize=8)
    save(fig, "hyperplane.png")


# ============================================================ Matrices
def _draw_grid(ax, M, title, vec_colors=(BLUE, RED)):
    rng_lines = np.arange(-4, 5)
    for i in rng_lines:
        v = M @ np.array([[i, i], [-4, 4]])
        ax.plot(v[0], v[1], color=GREY, lw=0.7, alpha=0.7)
        h = M @ np.array([[-4, 4], [i, i]])
        ax.plot(h[0], h[1], color=GREY, lw=0.7, alpha=0.7)
    ih = M @ np.array([1, 0])
    jh = M @ np.array([0, 1])
    ax.quiver(0, 0, ih[0], ih[1], angles="xy", scale_units="xy", scale=1,
              color=vec_colors[0], width=0.016, zorder=5)
    ax.quiver(0, 0, jh[0], jh[1], angles="xy", scale_units="xy", scale=1,
              color=vec_colors[1], width=0.016, zorder=5)
    ax.set_xlim(-5, 5); ax.set_ylim(-5, 5); ax.set_aspect("equal")
    ax.set_title(title, fontsize=11)


def linear_transformation():
    fig, axes = plt.subplots(1, 2, figsize=(10, 5))
    _draw_grid(axes[0], np.eye(2), "Original space (î blue, ĵ red)")
    _draw_grid(axes[1], np.array([[2, 1], [-1, 1]]), "After matrix transformation")
    fig.suptitle("A matrix transforms the whole grid; its columns show where î, ĵ land", y=1.0)
    save(fig, "linear_transformation.png")


def matrix_composition():
    B = np.array([[1, -1], [1, 1]])          # rotate + scale
    A = np.array([[2, 0], [0, 0.5]])          # stretch x, squish y
    fig, axes = plt.subplots(1, 3, figsize=(13, 4.4))
    _draw_grid(axes[0], np.eye(2), "1. Original")
    _draw_grid(axes[1], B, "2. After B")
    _draw_grid(axes[2], A @ B, "3. After A·B  (apply B, then A)")
    fig.suptitle("Matrix multiplication = applying transformations in sequence", y=1.0)
    save(fig, "matrix_composition.png")


def determinant_area():
    from matplotlib.patches import Polygon
    sq = np.array([[0, 0], [1, 0], [1, 1], [0, 1]])
    M = np.array([[2, 1], [0, 2]])
    fig, axes = plt.subplots(1, 2, figsize=(10, 5))
    axes[0].add_patch(Polygon(sq, closed=True, facecolor=BLUE, alpha=0.4, edgecolor=BLUE))
    axes[0].set_title("Unit square — area = 1")
    tsq = (M @ sq.T).T
    axes[1].add_patch(Polygon(tsq, closed=True, facecolor=ORANGE, alpha=0.4, edgecolor=ORANGE))
    axes[1].set_title(f"After matrix — area = det = {int(round(np.linalg.det(M)))}")
    for ax in axes:
        ax.set_xlim(-1, 4); ax.set_ylim(-1, 4); ax.set_aspect("equal")
        ax.axhline(0, color="black", lw=0.6); ax.axvline(0, color="black", lw=0.6)
    fig.suptitle("The determinant is the area (volume) scaling factor", y=1.0)
    save(fig, "determinant_area.png")


# ============================================================ Machine learning fundamentals
def _mlbox(ax, x, y, w, h, text, fc, tc="white", fs=10):
    ax.add_patch(FancyBboxPatch(
        (x - w / 2, y - h / 2), w, h,
        boxstyle="round,pad=0.02,rounding_size=0.12",
        facecolor=fc, edgecolor="black", alpha=0.9, lw=1.2))
    ax.text(x, y, text, ha="center", va="center", fontsize=fs, color=tc)


def _mlarrow(ax, x1, y1, x2, y2, color="black"):
    ax.annotate("", xy=(x2, y2), xytext=(x1, y1),
                arrowprops=dict(arrowstyle="-|>", color=color, lw=1.8))


def traditional_vs_ml():
    fig, axes = plt.subplots(2, 1, figsize=(9, 5))
    for ax in axes:
        ax.set_xlim(0, 7.5)
        ax.set_ylim(0, 2)
        ax.axis("off")

    ax = axes[0]
    _mlbox(ax, 1, 1, 1.6, 0.85, "Input", BLUE)
    _mlbox(ax, 3.2, 1, 1.6, 0.85, "Rules\n(you write)", ORANGE)
    _mlbox(ax, 6, 1, 1.6, 0.85, "Output", GREEN)
    ax.text(2.1, 1, "+", ha="center", va="center", fontsize=18, fontweight="bold")
    _mlarrow(ax, 4.05, 1, 5.15, 1)
    ax.set_title("Traditional programming: you write the rules")

    ax = axes[1]
    _mlbox(ax, 1, 1, 1.6, 0.85, "Input", BLUE)
    _mlbox(ax, 3.2, 1, 1.6, 0.85, "Output", GREEN)
    _mlbox(ax, 6, 1, 1.7, 0.85, "Rules\n(learned)", ORANGE)
    ax.text(2.1, 1, "+", ha="center", va="center", fontsize=18, fontweight="bold")
    _mlarrow(ax, 4.05, 1, 5.1, 1)
    ax.set_title("Machine learning: the algorithm learns the rules from data")
    fig.tight_layout()
    save(fig, "traditional_vs_ml.png")


def ai_ml_dl_hierarchy():
    fig, ax = plt.subplots(figsize=(6.2, 6))
    ax.add_patch(Ellipse((0, 0), 10, 10, facecolor=BLUE, alpha=0.22, edgecolor=BLUE, lw=2))
    ax.add_patch(Ellipse((0, -0.8), 7.2, 7.2, facecolor=ORANGE, alpha=0.3, edgecolor=ORANGE, lw=2))
    ax.add_patch(Ellipse((0, -1.6), 4.0, 4.0, facecolor=GREEN, alpha=0.45, edgecolor=GREEN, lw=2))
    ax.text(0, 4.2, "Artificial Intelligence", ha="center", fontsize=12, fontweight="bold", color=BLUE)
    ax.text(0, 1.8, "Machine Learning", ha="center", fontsize=11, fontweight="bold", color=ORANGE)
    ax.text(0, -1.6, "Deep\nLearning", ha="center", va="center", fontsize=10, fontweight="bold", color="white")
    ax.set_xlim(-6, 6)
    ax.set_ylim(-6, 6)
    ax.set_aspect("equal")
    ax.axis("off")
    ax.set_title("Nested subsets: AI contains ML contains DL")
    save(fig, "ai_ml_dl_hierarchy.png")


def ml_vs_dl_data():
    x = np.linspace(0, 10, 200)
    ml = 6 * (1 - np.exp(-0.9 * x)) + 0.03 * x
    dl = 1.5 * np.log1p(x) + 0.35 * x
    fig, ax = plt.subplots(figsize=(7, 4))
    ax.plot(x, ml, color=BLUE, lw=2.4, label="Machine learning (plateaus)")
    ax.plot(x, dl, color=RED, lw=2.4, label="Deep learning (keeps rising)")
    ax.set_title("Deep learning keeps improving as data grows")
    ax.set_xlabel("amount of data")
    ax.set_ylabel("performance")
    ax.set_xticks([])
    ax.set_yticks([])
    ax.legend(loc="upper left", fontsize=9)
    save(fig, "ml_vs_dl_data.png")


def ml_types_supervision():
    fig, ax = plt.subplots(figsize=(9.5, 5.4))
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 8)
    ax.axis("off")
    _mlbox(ax, 5, 7.2, 3.6, 0.9, "Machine learning\n(by supervision)", GREY, fs=11)
    specs = [
        (2.5, 4.7, BLUE, "Supervised\n\ninput + output\n(regression, classification)"),
        (7.5, 4.7, ORANGE, "Unsupervised\n\ninput only\n(clustering, dim. reduction,\nanomaly, association)"),
        (2.5, 1.6, GREEN, "Semi-supervised\n\nfew labels +\nmany unlabeled points"),
        (7.5, 1.6, PURPLE, "Reinforcement\n\nagent learns by\nreward and punishment"),
    ]
    for x, y, c, text in specs:
        _mlbox(ax, x, y, 3.8, 1.7, text, c, fs=9)
        _mlarrow(ax, 5, 6.75, x, y + 0.9)
    ax.set_title("Four types of machine learning by amount of supervision")
    save(fig, "ml_types_supervision.png")


def regression_vs_classification():
    rng = np.random.default_rng(11)
    fig, axes = plt.subplots(1, 2, figsize=(11, 4))
    x = np.linspace(1, 10, 40)
    y = 2.5 * x + 5 + rng.normal(0, 4, 40)
    axes[0].scatter(x, y, color=BLUE, alpha=0.7)
    m, b = np.polyfit(x, y, 1)
    axes[0].plot(x, m * x + b, color=RED, lw=2.2, label="best-fit line")
    axes[0].set_title("Regression: predict a number")
    axes[0].set_xlabel("input (e.g., IQ)")
    axes[0].set_ylabel("output (e.g., package)")
    axes[0].legend(fontsize=8)

    a = rng.normal([3, 7], 1.0, (30, 2))
    b2 = rng.normal([7, 3], 1.0, (30, 2))
    axes[1].scatter(a[:, 0], a[:, 1], color=GREEN, alpha=0.75, label="placed")
    axes[1].scatter(b2[:, 0], b2[:, 1], color=RED, alpha=0.75, label="not placed")
    xs = np.linspace(0, 10, 10)
    axes[1].plot(xs, xs, color="black", ls="--", lw=1.6, label="decision boundary")
    axes[1].set_title("Classification: predict a category")
    axes[1].set_xlabel("input (e.g., IQ)")
    axes[1].set_ylabel("input (e.g., CGPA)")
    axes[1].legend(fontsize=8)
    fig.tight_layout()
    save(fig, "regression_vs_classification.png")


def clustering_example():
    rng = np.random.default_rng(6)
    c1 = rng.normal([3, 7], 0.7, (30, 2))
    c2 = rng.normal([7, 7], 0.7, (30, 2))
    c3 = rng.normal([5, 3], 0.7, (30, 2))
    fig, axes = plt.subplots(1, 2, figsize=(11, 4.2), sharex=True, sharey=True)
    allpts = np.vstack([c1, c2, c3])
    axes[0].scatter(allpts[:, 0], allpts[:, 1], color=GREY, alpha=0.7)
    axes[0].set_title("Before: unlabeled data (input only)")
    axes[1].scatter(c1[:, 0], c1[:, 1], color=BLUE, alpha=0.8, label="cluster 1")
    axes[1].scatter(c2[:, 0], c2[:, 1], color=ORANGE, alpha=0.8, label="cluster 2")
    axes[1].scatter(c3[:, 0], c3[:, 1], color=GREEN, alpha=0.8, label="cluster 3")
    axes[1].set_title("After clustering: natural groups found")
    axes[1].legend(fontsize=8)
    for ax in axes:
        ax.set_xlabel("IQ")
        ax.set_ylabel("CGPA")
    fig.tight_layout()
    save(fig, "clustering_example.png")


def batch_vs_online():
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.8))
    for ax in axes:
        ax.set_xlim(0, 10)
        ax.set_ylim(0, 10)
        ax.axis("off")

    ax = axes[0]
    _mlbox(ax, 4.5, 9, 4, 1, "Entire dataset", BLUE)
    _mlbox(ax, 4.5, 6.5, 4, 1, "Train model (offline)", ORANGE)
    _mlbox(ax, 4.5, 4, 4, 1, "Deploy to server", GREEN)
    _mlbox(ax, 4.5, 1.5, 4, 1, "Serve predictions\n(static model)", GREY, fs=9)
    _mlarrow(ax, 4.5, 8.5, 4.5, 7)
    _mlarrow(ax, 4.5, 6, 4.5, 4.5)
    _mlarrow(ax, 4.5, 3.5, 4.5, 2)
    ax.annotate("", xy=(7.2, 6.5), xytext=(7.2, 1.5),
                arrowprops=dict(arrowstyle="-|>", color=RED, lw=1.6,
                                connectionstyle="arc3,rad=-0.55"))
    ax.text(9.0, 4, "periodic\nretrain", color=RED, fontsize=8, rotation=90, va="center", ha="center")
    ax.set_title("Batch (offline) learning")

    ax = axes[1]
    _mlbox(ax, 2, 8, 3, 0.9, "mini-batch 1", BLUE, fs=9)
    _mlbox(ax, 2, 6, 3, 0.9, "mini-batch 2", BLUE, fs=9)
    _mlbox(ax, 2, 4, 3, 0.9, "mini-batch 3", BLUE, fs=9)
    _mlbox(ax, 7.2, 6, 3.2, 1.5, "Model on server\n(keeps learning)", GREEN, fs=9)
    _mlarrow(ax, 3.5, 8, 5.6, 6.6)
    _mlarrow(ax, 3.5, 6, 5.6, 6)
    _mlarrow(ax, 3.5, 4, 5.6, 5.4)
    ax.text(2, 2.6, "streaming data", ha="center", color=GREY, fontsize=9)
    ax.set_title("Online learning")
    fig.tight_layout()
    save(fig, "batch_vs_online.png")


def instance_vs_model():
    rng = np.random.default_rng(8)
    red = rng.normal([7, 7], 1.0, (25, 2))
    blue = rng.normal([4, 4], 1.0, (25, 2))
    q = np.array([5.6, 5.6])
    fig, axes = plt.subplots(1, 2, figsize=(11, 4.6), sharex=True, sharey=True)

    ax = axes[0]
    ax.scatter(red[:, 0], red[:, 1], color=RED, alpha=0.7, label="placed")
    ax.scatter(blue[:, 0], blue[:, 1], color=BLUE, alpha=0.7, label="not placed")
    ax.scatter(*q, color=GREEN, s=160, marker="*", zorder=5, label="query")
    ax.add_patch(Circle(q, 1.6, fill=False, ls="--", color=GREEN, lw=1.6))
    ax.set_title("Instance-based (KNN): check nearest neighbors")
    ax.legend(fontsize=8)

    ax = axes[1]
    ax.scatter(red[:, 0], red[:, 1], color=RED, alpha=0.7)
    ax.scatter(blue[:, 0], blue[:, 1], color=BLUE, alpha=0.7)
    xs = np.linspace(1.5, 9.5, 10)
    ax.plot(xs, 11 - xs, color="black", lw=2, label="decision boundary")
    ax.set_title("Model-based: learn one boundary function")
    ax.legend(fontsize=8)
    for ax in axes:
        ax.set_xlabel("IQ")
        ax.set_ylabel("CGPA")
    fig.tight_layout()
    save(fig, "instance_vs_model.png")


def overfitting_underfitting():
    rng = np.random.default_rng(0)
    x = np.linspace(0, 1, 20)
    y = np.sin(2 * np.pi * x) + rng.normal(0, 0.25, len(x))
    xs = np.linspace(0, 1, 200)
    fig, axes = plt.subplots(1, 3, figsize=(13, 3.8), sharey=True)
    axes[0].plot(xs, np.polyval(np.polyfit(x, y, 1), xs), color=RED, lw=2)
    axes[0].set_title("Underfitting (too simple)")
    axes[1].plot(xs, np.polyval(np.polyfit(x, y, 3), xs), color=GREEN, lw=2)
    axes[1].set_title("Good fit")
    axes[2].plot(xs, np.polyval(np.polyfit(x, y, 15), xs), color=PURPLE, lw=2)
    axes[2].set_title("Overfitting (too wiggly)")
    for ax in axes:
        ax.scatter(x, y, color=BLUE, alpha=0.7, s=25)
        ax.set_xlabel("input")
        ax.set_ylim(-2, 2)
        ax.set_xticks([])
        ax.set_yticks([])
    fig.suptitle("Underfitting vs good fit vs overfitting", y=1.03)
    fig.tight_layout()
    save(fig, "overfitting_underfitting.png")


def mldlc_cycle():
    fig, ax = plt.subplots(figsize=(11, 6.5))
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 10)
    ax.axis("off")
    steps = {
        1: (2, 8.3, "1. Frame\nthe problem"),
        2: (5, 8.3, "2. Gather\ndata"),
        3: (8, 8.3, "3. Data\npreprocessing"),
        4: (8, 5.3, "4. Exploratory\ndata analysis"),
        5: (5, 5.3, "5. Feature eng.\n& selection"),
        6: (2, 5.3, "6. Train, evaluate\n& select model"),
        7: (2, 2.3, "7. Deploy"),
        8: (5, 2.3, "8. Testing\n(A/B)"),
        9: (8, 2.3, "9. Optimize\n& monitor"),
    }
    colors = [BLUE, BLUE, BLUE, ORANGE, ORANGE, ORANGE, GREEN, GREEN, GREEN]
    for (n, (x, y, t)), c in zip(steps.items(), colors):
        _mlbox(ax, x, y, 2.5, 1.2, t, c, fs=9)
    order = [1, 2, 3, 4, 5, 6, 7, 8, 9]
    for a, b in zip(order, order[1:]):
        x1, y1, _ = steps[a]
        x2, y2, _ = steps[b]
        if y1 == y2 and x2 > x1:
            _mlarrow(ax, x1 + 1.3, y1, x2 - 1.3, y2)
        elif y1 == y2 and x2 < x1:
            _mlarrow(ax, x1 - 1.3, y1, x2 + 1.3, y2)
        else:
            _mlarrow(ax, x1, y1 - 0.65, x2, y2 + 0.65)
    ax.set_title("Machine learning development life cycle (MLDLC)")
    save(fig, "mldlc_cycle.png")


# ============================================================ Python basics
def _pybox(ax, x, y, w, h, text, fc, tc="white", fs=10, alpha=0.92, mono=False):
    ax.add_patch(FancyBboxPatch(
        (x - w / 2, y - h / 2), w, h,
        boxstyle="round,pad=0.02,rounding_size=0.10",
        facecolor=fc, edgecolor="black", alpha=alpha, lw=1.2))
    ax.text(x, y, text, ha="center", va="center", fontsize=fs, color=tc,
            family="monospace" if mono else None)


def _pyarrow(ax, x1, y1, x2, y2, color="black", style="-|>", lw=1.8, rad=None):
    kw = dict(arrowstyle=style, color=color, lw=lw)
    if rad is not None:
        kw["connectionstyle"] = f"arc3,rad={rad}"
    ax.annotate("", xy=(x2, y2), xytext=(x1, y1), arrowprops=kw)


def compiler_vs_interpreter():
    """Shows the real consequence of line-by-line translation: an interpreted
    program produces output for the good lines before it hits the bad one."""
    code = ["print('a')", "print('b')", "print(oops)", "print('d')"]
    fig, axes = plt.subplots(1, 2, figsize=(12, 5))
    for ax in axes:
        ax.set_xlim(0, 10)
        ax.set_ylim(0, 10)
        ax.axis("off")

    # ---------------- compiler
    ax = axes[0]
    ax.set_title("Compiled: translate everything first", fontsize=11.5)
    for i, line in enumerate(code):
        y = 8.8 - i * 0.85
        bad = i == 2
        _pybox(ax, 2.5, y, 3.6, 0.7, line, RED if bad else BLUE, fs=9, mono=True)
    ax.add_patch(FancyBboxPatch((0.4, 5.8), 4.2, 3.45,
                                boxstyle="round,pad=0.1", fill=False,
                                edgecolor=GREY, ls="--", lw=1.4))
    ax.text(2.5, 5.25, "whole program scanned as one unit", ha="center",
            fontsize=8.5, color=GREY)
    _pyarrow(ax, 5.0, 7.5, 7.0, 7.5)
    _pybox(ax, 8.3, 7.5, 3.0, 1.3, "translation\nFAILS", RED, fs=10)
    _pybox(ax, 8.3, 4.3, 3.0, 1.3, "nothing runs\nno output", GREY, fs=10)
    _pyarrow(ax, 8.3, 6.8, 8.3, 5.0, color=RED)
    ax.text(5.0, 1.2, "You find the error before the program\never runs, so nothing half-happens.",
            ha="center", fontsize=9, color=RED, style="italic")

    # ---------------- interpreter
    ax = axes[1]
    ax.set_title("Interpreted: translate and run one line at a time", fontsize=11.5)
    outputs = ["a", "b", None, None]
    for i, line in enumerate(code):
        y = 8.8 - i * 2.1
        bad = i == 2
        dead = i == 3
        fc = RED if bad else (GREY if dead else BLUE)
        _pybox(ax, 2.2, y, 3.4, 0.8, line, fc, fs=9, mono=True,
               alpha=0.35 if dead else 0.92)
        if dead:
            ax.text(2.2, y - 0.75, "never reached", ha="center", fontsize=8, color=GREY)
            continue
        _pyarrow(ax, 4.0, y, 5.5, y, color=RED if bad else "black")
        if bad:
            _pybox(ax, 7.4, y, 3.6, 0.9, "ERROR, stop here", RED, fs=9)
        else:
            _pybox(ax, 7.4, y, 3.6, 0.9, f"prints  {outputs[i]}", GREEN, fs=9)
    ax.text(5.0, 0.25, "Lines 1 and 2 already printed before the\nerror appeared, so the run is half-done.",
            ha="center", fontsize=9, color=RED, style="italic")
    fig.tight_layout()
    save(fig, "compiler_vs_interpreter.png")


def variable_reference_model():
    """The mental model behind dynamic typing and dynamic binding: the name is a
    label, the type belongs to the object, and re-assigning just moves the label."""
    fig, axes = plt.subplots(1, 3, figsize=(13, 4.4))
    panels = [
        ("a = 5", [("int  5", BLUE, 6.3)], None,
         "the label 'a' points at an int object"),
        ("a = 'Nitish'", [("int  5", GREY, 6.3), ("str  'Nitish'", ORANGE, 3.4)], 1,
         "the label moves; the int is abandoned"),
        ("a = [1, 2]", [("int  5", GREY, 7.2), ("str  'Nitish'", GREY, 5.0),
                        ("list  [1, 2]", GREEN, 2.8)], 2,
         "any type is allowed, in the same program"),
    ]
    for ax, (code, objs, live, caption) in zip(axes, panels):
        ax.set_xlim(0, 10)
        ax.set_ylim(0, 9)
        ax.axis("off")
        ax.set_title(code, fontsize=12, family="monospace")

        # the name label
        _pybox(ax, 1.8, 4.8, 2.2, 0.9, "a", PURPLE, fs=13)
        ax.text(1.8, 3.9, "name", ha="center", fontsize=8, color=GREY)

        # objects in memory
        ax.add_patch(FancyBboxPatch((4.6, 1.4), 5.0, 7.0,
                                    boxstyle="round,pad=0.1", fill=False,
                                    edgecolor=GREY, ls="--", lw=1.3))
        ax.text(7.1, 8.7, "memory", ha="center", fontsize=8.5, color=GREY)

        target_y = None
        for j, (label, color, y) in enumerate(objs):
            faded = (live is not None and j != live) or (live is None and j != 0)
            _pybox(ax, 7.1, y, 3.8, 1.0, label, color, fs=10, mono=True,
                   alpha=0.30 if faded else 0.92,
                   tc="white" if not faded else "black")
            if not faded:
                target_y = y
            else:
                ax.text(7.1, y - 0.72, "orphaned", fontsize=7.5, color=GREY,
                        va="center", ha="center", style="italic")
        _pyarrow(ax, 3.0, 4.8, 5.1, target_y, color=PURPLE, lw=2.2)
        ax.text(5.0, 0.6, caption, ha="center", fontsize=8.5, color=GREY,
                style="italic", wrap=True)
    fig.suptitle("A variable is a label, not a box: the data type lives with the object",
                 y=1.02, fontsize=13, fontweight="bold")
    fig.tight_layout()
    save(fig, "variable_reference_model.png")


def type_conversion_new_object():
    """The commonly-missed rule: int(fnum) does not change fnum. It builds a new
    object, and only the new object has the new type."""
    fig, ax = plt.subplots(figsize=(10.5, 5.2))
    ax.set_xlim(0, 12)
    ax.set_ylim(0.3, 7.0)
    ax.axis("off")

    ax.text(6, 6.5, "result = int(fnum) + 10", ha="center", fontsize=14,
            family="monospace", fontweight="bold")

    # original object, untouched
    _pybox(ax, 2.0, 5.3, 2.0, 0.9, "fnum", PURPLE, fs=12)
    _pybox(ax, 2.0, 3.3, 2.6, 1.0, "str  '56'", ORANGE, fs=11, mono=True)
    _pyarrow(ax, 2.0, 4.8, 2.0, 3.9, color=PURPLE, lw=2.2)
    ax.text(2.0, 2.05, "UNCHANGED\nstill a string", ha="center", fontsize=9,
            color=RED, fontweight="bold")

    # conversion creates a new object
    _pyarrow(ax, 3.5, 3.3, 5.5, 3.3, color=BLUE, lw=2.2)
    ax.text(4.5, 3.8, "int( )", ha="center", fontsize=11, color=BLUE,
            family="monospace")
    ax.text(4.5, 2.7, "reads the value,\nbuilds something new", ha="center",
            fontsize=8, color=GREY)

    _pybox(ax, 7.2, 3.3, 2.6, 1.0, "int  56", BLUE, fs=11, mono=True)
    ax.text(7.2, 2.05, "NEW object\n(no name of its own)", ha="center", fontsize=9,
            color=BLUE, fontweight="bold")

    # it is the new object that gets used
    _pyarrow(ax, 8.6, 3.3, 10.2, 3.3, color=GREEN, lw=2.2)
    ax.text(9.4, 3.8, "+ 10", ha="center", fontsize=11, color=GREEN,
            family="monospace")
    _pybox(ax, 11.0, 3.3, 1.8, 1.0, "66", GREEN, fs=12, mono=True)

    ax.text(6, 0.85, "The arithmetic happens on the new object. "
                     "Because fnum was never touched,\n"
                     "type(fnum) still reports str after this line runs.",
            ha="center", fontsize=9.5, color=RED, style="italic")
    ax.set_title("Type conversion builds a new value; it never edits the original",
                 fontsize=12.5)
    save(fig, "type_conversion_new_object.png")


def print_sep_end():
    """Makes the invisible characters visible: sep sits between values, end sits
    after the line, and both are real characters in the output stream."""
    fig, axes = plt.subplots(2, 1, figsize=(11, 5.4))

    def draw_stream(ax, cells, title):
        ax.set_xlim(-0.4, 13)
        ax.set_ylim(-1.5, 1.9)
        ax.axis("off")
        ax.set_title(title, fontsize=11, loc="left", family="monospace")
        x = 0
        for text, kind in cells:
            w = 0.95
            color = {"val": BLUE, "sep": ORANGE, "end": PURPLE}[kind]
            ax.add_patch(FancyBboxPatch((x, -0.4), w, 0.9,
                                        boxstyle="square,pad=0.0",
                                        facecolor=color, edgecolor="black",
                                        alpha=0.85, lw=1.1))
            ax.text(x + w / 2, 0.05, text, ha="center", va="center",
                    fontsize=11, color="white", family="monospace",
                    fontweight="bold")
            if kind != "val":
                ax.text(x + w / 2, -0.95, kind, ha="center", fontsize=8,
                        color=color, fontweight="bold")
            x += w + 0.12

    draw_stream(axes[0],
                [("h", "val"), ("i", "val"), ("␣", "sep"), ("1", "val"),
                 ("␣", "sep"), ("4", "val"), ("\\n", "end")],
                "print('hi', 1, 4)          defaults:  sep=' '   end='\\n'")

    draw_stream(axes[1],
                [("h", "val"), ("i", "val"), ("/", "sep"), ("1", "val"),
                 ("/", "sep"), ("4", "val"), ("-", "end")],
                "print('hi', 1, 4, sep='/', end='-')")

    handles = [Patch(facecolor=BLUE, label="your values"),
               Patch(facecolor=ORANGE, label="sep: goes BETWEEN values"),
               Patch(facecolor=PURPLE, label="end: goes AFTER the last value")]
    axes[1].legend(handles=handles, loc="lower left", fontsize=9,
                   bbox_to_anchor=(0, -1.15), frameon=False)
    fig.suptitle("print() writes one stream of characters; sep and end are part of it",
                 y=0.99, fontsize=12.5, fontweight="bold")
    fig.tight_layout()
    save(fig, "print_sep_end.png")


def python_type_map():
    """One-picture summary of the type system, grouped by behaviour rather than
    listed flat, so the mutable/immutable and ordered/unordered splits show up."""
    fig, ax = plt.subplots(figsize=(12, 6.4))
    ax.set_xlim(0, 12)
    ax.set_ylim(0, 9)
    ax.axis("off")

    _pybox(ax, 6, 8.2, 3.4, 0.8, "Python data types", "black", fs=12)

    groups = [
        (2.0, GREY, "Immutable\n(cannot be changed\nafter creation)",
         [("int", "8, -50"), ("float", "8.55"), ("bool", "True"),
          ("str", "'hi'"), ("complex", "5+6j"), ("tuple", "(1, 2)")]),
        (9.0, GREEN, "Mutable\n(can be changed\nin place)",
         [("list", "[1, 2]"), ("set", "{1, 2}"), ("dict", "{'a': 1}")]),
    ]
    for cx, color, header, items in groups:
        _pybox(ax, cx, 6.6, 4.4, 1.1, header, color, fs=9.5)
        _pyarrow(ax, 6, 7.8, cx, 7.2)
        for i, (name, example) in enumerate(items):
            row, col = divmod(i, 2)
            x = cx - 1.1 + col * 2.2
            y = 5.2 - row * 1.25
            _pybox(ax, x, y, 2.0, 0.95, f"{name}\n{example}", color,
                   fs=9, mono=True, alpha=0.55, tc="black")

    # the odd one out
    _pybox(ax, 6, 1.25, 3.0, 0.9, "NoneType\nNone", PURPLE, fs=9.5, mono=True)
    ax.text(6, 0.35, "a value meaning 'nothing yet'", ha="center",
            fontsize=8.5, color=GREY, style="italic")

    ax.text(2.0, 1.7, "ordered: str, tuple\nunordered: the rest",
            ha="center", fontsize=8.5, color=GREY, style="italic")
    ax.text(9.0, 1.7, "ordered: list\nunordered: set, dict",
            ha="center", fontsize=8.5, color=GREY, style="italic")

    ax.set_title("The type system grouped by what you can do to a value",
                 fontsize=12.5)
    save(fig, "python_type_map.png")


# ============================================================ Python control flow
def control_flow_branching():
    """if / elif / else as a flowchart: each condition is a decision diamond,
    and exactly one branch runs."""
    fig, ax = plt.subplots(figsize=(9.5, 6.2))
    ax.set_xlim(0, 12)
    ax.set_ylim(0, 11)
    ax.axis("off")

    def diamond(x, y, text):
        ax.add_patch(plt.Polygon([(x, y + 0.75), (x + 2.1, y), (x, y - 0.75),
                                   (x - 2.1, y)], facecolor=BLUE, alpha=0.85,
                                  edgecolor="black", lw=1.2))
        ax.text(x, y, text, ha="center", va="center", fontsize=9, color="white")

    def action(x, y, text, c):
        _pybox(ax, x, y, 3.0, 0.95, text, c, fs=9)

    # start
    _pybox(ax, 3, 10.2, 2.4, 0.8, "start", GREY, fs=10)
    _pyarrow(ax, 3, 9.8, 3, 9.35)

    diamond(3, 8.5, "if\ncorrect?")
    diamond(3, 5.7, "elif\nemail ok?")

    _pyarrow(ax, 3, 7.75, 3, 6.45)
    _pyarrow(ax, 3, 4.95, 3, 4.1)

    # true branches to the right
    _pyarrow(ax, 5.1, 8.5, 7.2, 8.5, color=GREEN)
    ax.text(6.0, 8.75, "True", color=GREEN, fontsize=8.5, ha="center")
    action(8.8, 8.5, "print\n'Welcome'", GREEN)

    _pyarrow(ax, 5.1, 5.7, 7.2, 5.7, color=GREEN)
    ax.text(6.0, 5.95, "True", color=GREEN, fontsize=8.5, ha="center")
    action(8.8, 5.7, "print\n'Wrong password'", ORANGE)

    ax.text(3.25, 7.1, "False", color=RED, fontsize=8.5)
    ax.text(3.25, 4.4, "False", color=RED, fontsize=8.5)

    # else
    action(3, 3.3, "else:\nprint 'Incorrect email'", RED)

    # merge every outcome into one line, then continue.
    # route the true-branch outcomes out to a right rail so no line
    # passes through another box.
    merge_y = 2.0
    rail_x = 11.2
    for by in (8.5, 5.7):                 # welcome, wrong-password box centers
        ax.plot([10.3, rail_x], [by, by], color="black", lw=1.4)
        ax.plot([rail_x, rail_x], [by, merge_y], color="black", lw=1.4)
    ax.plot([3, 3], [2.82, merge_y], color="black", lw=1.4)   # else down
    ax.plot([3, rail_x], [merge_y, merge_y], color="black", lw=1.4)  # merge line
    _pyarrow(ax, 6.0, merge_y, 6.0, 1.55)
    _pybox(ax, 6.0, 1.15, 2.8, 0.8, "continue program", GREY, fs=10)
    ax.text(6, 0.4, "Python checks top to bottom and runs the FIRST true branch, then skips the rest.",
            ha="center", fontsize=9, color=GREY, style="italic")
    ax.set_title("if / elif / else: exactly one branch runs")
    save(fig, "control_flow_branching.png")


def loop_execution():
    """The cycle shared by while and for: check, run body, repeat, then exit."""
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.8))
    for ax in axes:
        ax.set_xlim(0, 10)
        ax.set_ylim(0, 10)
        ax.axis("off")

    # while loop
    ax = axes[0]
    ax.set_title("while loop", fontsize=12)
    def dia(ax, x, y, text):
        ax.add_patch(plt.Polygon([(x, y + 1.0), (x + 2.6, y), (x, y - 1.0),
                                   (x - 2.6, y)], facecolor=BLUE, alpha=0.85,
                                  edgecolor="black", lw=1.2))
        ax.text(x, y, text, ha="center", va="center", fontsize=8.5, color="white")
    dia(ax, 5, 8, "condition\ntrue?")
    _pybox(ax, 5, 4.6, 4.2, 1.1, "run the body\n(and update the counter)", GREEN, fs=9)
    _pyarrow(ax, 5, 6.95, 5, 5.2)
    ax.text(5.3, 6.1, "True", color=GREEN, fontsize=8.5)
    # loop back
    ax.annotate("", xy=(7.6, 8), xytext=(7.1, 4.6),
                arrowprops=dict(arrowstyle="-|>", color="black", lw=1.6,
                                connectionstyle="arc3,rad=-0.5"))
    ax.text(9.0, 6.3, "repeat", color="black", fontsize=8.5, rotation=90, va="center")
    _pyarrow(ax, 2.4, 8, 0.8, 8, color=RED)
    ax.text(1.5, 8.5, "False", color=RED, fontsize=8.5, ha="center")
    _pybox(ax, 1.0, 6.4, 2.0, 0.8, "exit", GREY, fs=9)

    # for loop
    ax = axes[1]
    ax.set_title("for loop", fontsize=12)
    dia(ax, 5, 8, "more items\nleft?")
    _pybox(ax, 5, 4.6, 4.4, 1.1, "take next item,\nrun the body", GREEN, fs=9)
    _pyarrow(ax, 5, 6.95, 5, 5.2)
    ax.text(5.3, 6.1, "Yes", color=GREEN, fontsize=8.5)
    ax.annotate("", xy=(7.6, 8), xytext=(7.2, 4.6),
                arrowprops=dict(arrowstyle="-|>", color="black", lw=1.6,
                                connectionstyle="arc3,rad=-0.5"))
    ax.text(9.0, 6.3, "repeat", color="black", fontsize=8.5, rotation=90, va="center")
    _pyarrow(ax, 2.4, 8, 0.8, 8, color=RED)
    ax.text(1.5, 8.5, "No", color=RED, fontsize=8.5, ha="center")
    _pybox(ax, 1.0, 6.4, 2.0, 0.8, "exit", GREY, fs=9)
    fig.suptitle("Both loops check first, run the body, then repeat until they should stop",
                 y=1.0, fontsize=12.5, fontweight="bold")
    fig.tight_layout()
    save(fig, "loop_execution.png")


def break_vs_continue():
    """Two traces of for i in range(1, 7): break exits the whole loop at i==4,
    continue only skips the body for i==4."""
    fig, axes = plt.subplots(1, 2, figsize=(11.5, 4.6))
    vals = list(range(1, 7))
    for ax in axes:
        ax.set_xlim(0, 10)
        ax.set_ylim(0, 8)
        ax.axis("off")

    def trace(ax, mode):
        ax.set_title(f"{mode} when i == 4", fontsize=12)
        y = 7.0
        for v in vals:
            stop = (mode == "break" and v >= 4)
            skipped = (mode == "continue" and v == 4)
            if mode == "break" and v > 4:
                continue
            fc = RED if (v == 4) else (GREEN if not stop else GREEN)
            label = f"i = {v}"
            if v == 4 and mode == "break":
                _pybox(ax, 2.4, y, 2.2, 0.7, label, RED, fs=9)
                ax.text(5.6, y, "break: leave the loop", color=RED, fontsize=9, va="center")
                _pyarrow(ax, 3.6, y, 4.5, y, color=RED)
                break
            if v == 4 and mode == "continue":
                _pybox(ax, 2.4, y, 2.2, 0.7, label, RED, fs=9)
                ax.text(5.6, y, "continue: skip the body", color=RED, fontsize=9, va="center")
                _pyarrow(ax, 3.6, y, 4.5, y, color=RED)
                y -= 1.15
                continue
            _pybox(ax, 2.4, y, 2.2, 0.7, label, GREEN, fs=9)
            ax.text(5.6, y, f"print {v}", color=GREEN, fontsize=9, va="center")
            _pyarrow(ax, 3.6, y, 4.5, y, color=GREEN)
            y -= 1.15

    trace(axes[0], "break")
    trace(axes[1], "continue")
    axes[0].text(5, 0.3, "prints 1, 2, 3", ha="center", fontsize=9,
                 color=GREY, style="italic")
    axes[1].text(5, 0.3, "prints 1, 2, 3, 5, 6", ha="center", fontsize=9,
                 color=GREY, style="italic")
    fig.suptitle("break stops the loop; continue skips only the current pass",
                 y=1.0, fontsize=12.5, fontweight="bold")
    fig.tight_layout()
    save(fig, "break_vs_continue.png")


# ============================================================ Python strings
def _char_cells(ax, s, y, cell_w=1.0, fc=BLUE, x0=0.5):
    """Draw each character of s as a box in a row; return x centers."""
    centers = []
    for k, ch in enumerate(s):
        x = x0 + k * cell_w
        disp = "space" if ch == " " else ch
        ax.add_patch(FancyBboxPatch((x - cell_w / 2 + 0.04, y - 0.4), cell_w - 0.08, 0.8,
                                    boxstyle="square,pad=0", facecolor=fc,
                                    edgecolor="black", alpha=0.85, lw=1.1))
        ax.text(x, y, disp, ha="center", va="center", fontsize=10 if ch != " " else 7,
                color="white", family="monospace")
        centers.append(x)
    return centers


def string_indexing():
    s = "hello world"
    fig, ax = plt.subplots(figsize=(12, 3.6))
    n = len(s)
    ax.set_xlim(0, n + 1)
    ax.set_ylim(0, 3.4)
    ax.axis("off")
    centers = _char_cells(ax, s, 1.9)
    for k, x in enumerate(centers):
        ax.text(x, 2.85, str(k), ha="center", va="center", fontsize=9.5, color=BLUE)
        ax.text(x, 0.95, str(k - n), ha="center", va="center", fontsize=9.5, color=RED)
    ax.text((n + 1) / 2, 3.25, "positive index (left to right, from 0)",
            ha="center", fontsize=10, color=BLUE, fontweight="bold")
    ax.text((n + 1) / 2, 0.35, "negative index (right to left, from -1)",
            ha="center", fontsize=10, color=RED, fontweight="bold")
    ax.set_title("Every character has a positive and a negative index")
    save(fig, "string_indexing.png")


def string_slicing():
    s = "hello world"
    fig, axes = plt.subplots(2, 1, figsize=(12, 5.0))
    n = len(s)
    for ax in axes:
        ax.set_xlim(0, n + 1)
        ax.set_ylim(0, 3.2)
        ax.axis("off")

    # top: s[0:5] selects hello, index 5 excluded
    ax = axes[0]
    ax.set_title("s[0:5]  takes indices 0 to 4  (stop index 5 is excluded)", fontsize=11)
    colors = [GREEN if k < 5 else GREY for k in range(n)]
    centers = []
    for k, ch in enumerate(s):
        x = 0.5 + k
        fc = colors[k]
        disp = "space" if ch == " " else ch
        ax.add_patch(FancyBboxPatch((x - 0.46, 1.5), 0.92, 0.8, boxstyle="square,pad=0",
                                    facecolor=fc, edgecolor="black",
                                    alpha=0.9 if colors[k] == GREEN else 0.4, lw=1.1))
        ax.text(x, 1.9, disp, ha="center", va="center",
                fontsize=10 if ch != " " else 7, color="white", family="monospace")
        ax.text(x, 2.6, str(k), ha="center", fontsize=9, color=BLUE)
        centers.append(x)
    ax.annotate("start\n(included)", xy=(centers[0], 1.45), xytext=(centers[0], 0.4),
                ha="center", fontsize=8.5, color=GREEN,
                arrowprops=dict(arrowstyle="->", color=GREEN))
    ax.annotate("stop = 5\n(excluded)", xy=(centers[5], 1.45), xytext=(centers[5] + 0.3, 0.4),
                ha="center", fontsize=8.5, color=RED,
                arrowprops=dict(arrowstyle="->", color=RED))
    ax.text(n + 0.7, 1.9, "= 'hello'", fontsize=11, color=GREEN, va="center",
            fontweight="bold")

    # bottom: reverse
    ax = axes[1]
    ax.set_title("s[::-1]  walks the whole string backward", fontsize=11)
    rev = s[::-1]
    for k, ch in enumerate(rev):
        x = 0.5 + k
        disp = "space" if ch == " " else ch
        ax.add_patch(FancyBboxPatch((x - 0.46, 1.5), 0.92, 0.8, boxstyle="square,pad=0",
                                    facecolor=PURPLE, edgecolor="black", alpha=0.9, lw=1.1))
        ax.text(x, 1.9, disp, ha="center", va="center",
                fontsize=10 if ch != " " else 7, color="white", family="monospace")
    ax.text(n + 0.7, 1.9, "= 'dlrow olleh'", fontsize=11, color=PURPLE, va="center",
            fontweight="bold")
    fig.tight_layout()
    save(fig, "string_slicing.png")


# ============================================================ Python time complexity
def complexity_classes():
    """The common Big O growth curves on one axis, so their very different
    scaling is visible at a glance."""
    n = np.linspace(1, 20, 200)
    fig, ax = plt.subplots(figsize=(8, 5.6))
    ax.plot(n, np.ones_like(n), color=GREY, lw=2.2, label=r"$O(1)$ constant")
    ax.plot(n, np.log2(n), color=BLUE, lw=2.2, label=r"$O(\log n)$ logarithmic")
    ax.plot(n, n, color=GREEN, lw=2.2, label=r"$O(n)$ linear")
    ax.plot(n, n * np.log2(n), color=ORANGE, lw=2.2, label=r"$O(n \log n)$ linearithmic")
    ax.plot(n, n ** 2, color=RED, lw=2.2, label=r"$O(n^2)$ quadratic")
    ax.plot(n, 2 ** n, color=PURPLE, lw=2.2, label=r"$O(2^n)$ exponential")
    ax.set_ylim(0, 120)
    ax.set_xlim(1, 20)
    ax.set_xlabel("input size (n)")
    ax.set_ylabel("operations / time")
    ax.set_title("How the common complexity classes grow")
    ax.legend(loc="upper left", fontsize=9, framealpha=0.9)
    ax.annotate("explodes fast", xy=(7, 110), xytext=(9, 95),
                fontsize=8.5, color=PURPLE,
                arrowprops=dict(arrowstyle="->", color=PURPLE))
    ax.annotate("barely grows", xy=(18, np.log2(18)), xytext=(13, 14),
                fontsize=8.5, color=BLUE,
                arrowprops=dict(arrowstyle="->", color=BLUE))
    save(fig, "complexity_classes.png")


# ============================================================ Python lists
def list_vs_array_memory():
    """Why a list can hold mixed types and costs more memory: an array packs
    values in one block, a list stores addresses that point elsewhere."""
    fig, axes = plt.subplots(1, 2, figsize=(12.5, 5.2))
    for ax in axes:
        ax.set_xlim(0, 10)
        ax.set_ylim(0, 10)
        ax.axis("off")

    # ---- array: one contiguous block of values
    ax = axes[0]
    ax.set_title("Array: values packed in one block", fontsize=12)
    vals = ["1", "2", "3", "4"]
    for k, v in enumerate(vals):
        x = 1.6 + k * 1.7
        ax.add_patch(FancyBboxPatch((x - 0.75, 5.2), 1.5, 1.5, boxstyle="square,pad=0",
                                    facecolor=GREEN, edgecolor="black", alpha=0.85, lw=1.2))
        ax.text(x, 5.95, v, ha="center", va="center", fontsize=13, color="white",
                family="monospace")
        ax.text(x, 4.7, f"addr {100 + k}", ha="center", fontsize=8, color=GREY)
    ax.annotate("", xy=(8.3, 6.9), xytext=(0.85, 6.9),
                arrowprops=dict(arrowstyle="<->", color=GREY, lw=1.2))
    ax.text(4.6, 7.4, "one continuous block", ha="center", fontsize=9.5, color=GREY)
    ax.text(4.6, 3.4, "same type only, no addresses stored\n-> compact and fast",
            ha="center", fontsize=9.5, color=GREEN, style="italic")

    # ---- list: slots hold addresses, values scattered
    ax = axes[1]
    ax.set_title("List: slots hold addresses of scattered values", fontsize=12)
    # the list slots
    addrs = ["500", "820", "610", "930"]
    objs = [("1", 1.4), ("'hi'", 8.4), ("3.5", 3.2), ("[..]", 6.4)]
    slot_y = 7.4
    for k, a in enumerate(addrs):
        x = 1.2 + k * 1.35
        ax.add_patch(FancyBboxPatch((x - 0.62, slot_y - 0.6), 1.24, 1.2,
                                    boxstyle="square,pad=0", facecolor=BLUE,
                                    edgecolor="black", alpha=0.85, lw=1.2))
        ax.text(x, slot_y, a, ha="center", va="center", fontsize=9, color="white",
                family="monospace")
    ax.text(3.6, slot_y + 1.15, "the list (stores addresses)", ha="center",
            fontsize=9, color=BLUE)
    # scattered value objects along the bottom, arrows from slots
    for k, (val, vx) in enumerate(objs):
        x = 1.2 + k * 1.35
        ax.add_patch(FancyBboxPatch((vx - 0.62, 1.3), 1.24, 1.0,
                                    boxstyle="round,pad=0.02", facecolor=ORANGE,
                                    edgecolor="black", alpha=0.85, lw=1.1))
        ax.text(vx, 1.8, val, ha="center", va="center", fontsize=9.5, color="white",
                family="monospace")
        ax.annotate("", xy=(vx, 2.35), xytext=(x, slot_y - 0.65),
                    arrowprops=dict(arrowstyle="-|>", color=GREY, lw=1.1,
                                    connectionstyle="arc3,rad=0.05"))
    ax.text(5.0, 0.5, "any type allowed, values live anywhere\n-> flexible but slower and heavier",
            ha="center", fontsize=9.5, color=RED, style="italic")
    fig.suptitle("How an array and a Python list store their items",
                 y=1.0, fontsize=12.5, fontweight="bold")
    fig.tight_layout()
    save(fig, "list_vs_array_memory.png")


# ============================================================ Python sets
def set_operations():
    """The four set operations as Venn diagrams, with the selected region shaded."""
    fig, axes = plt.subplots(2, 2, figsize=(10, 8))
    specs = [
        ("Union  s1 | s2", "both circles"),
        ("Intersection  s1 & s2", "overlap only"),
        ("Difference  s1 - s2", "left only"),
        ("Symmetric difference  s1 ^ s2", "everything except overlap"),
    ]
    cx1, cx2, r = 3.7, 5.3, 2.2

    def base(ax, title):
        ax.set_xlim(0, 9)
        ax.set_ylim(0, 7)
        ax.set_aspect("equal")
        ax.axis("off")
        ax.set_title(title, fontsize=11.5)

    def circle(ax, cx, color):
        ax.add_patch(Circle((cx, 3.4), r, facecolor="none", edgecolor=color, lw=2.2))

    for ax, (title, _) in zip(axes.ravel(), specs):
        base(ax, title)

    # shade helper using clipped patches
    def shade_circle(ax, cx, color, alpha=0.5):
        ax.add_patch(Circle((cx, 3.4), r, facecolor=color, edgecolor="none", alpha=alpha))

    # Union: shade both
    ax = axes[0, 0]
    shade_circle(ax, cx1, BLUE)
    shade_circle(ax, cx2, ORANGE)

    # Intersection: shade only the lens by overlaying a green lens (two clipped circles)
    ax = axes[0, 1]
    c1 = Circle((cx1, 3.4), r, transform=ax.transData)
    lens = Circle((cx2, 3.4), r, facecolor=GREEN, edgecolor="none", alpha=0.6)
    ax.add_patch(lens)
    lens.set_clip_path(c1)

    # Difference: shade left circle, then cover the overlap with white via clip
    ax = axes[0, 2] if False else axes[1, 0]
    shade_circle(ax, cx1, BLUE)
    c2 = Circle((cx2, 3.4), r, transform=ax.transData)
    cover = Circle((cx1, 3.4), r, facecolor="white", edgecolor="none", alpha=1.0)
    ax.add_patch(cover)
    cover.set_clip_path(c2)

    # Symmetric difference: shade both, then white-out the lens
    ax = axes[1, 1]
    shade_circle(ax, cx1, BLUE)
    shade_circle(ax, cx2, ORANGE)
    cc1 = Circle((cx1, 3.4), r, transform=ax.transData)
    lens2 = Circle((cx2, 3.4), r, facecolor="white", edgecolor="none", alpha=1.0)
    ax.add_patch(lens2)
    lens2.set_clip_path(cc1)

    # draw outlines and labels on every panel last so they sit on top
    for ax in axes.ravel():
        circle(ax, cx1, BLUE)
        circle(ax, cx2, ORANGE)
        ax.text(cx1 - 1.1, 6.0, "s1", color=BLUE, fontsize=11, fontweight="bold")
        ax.text(cx2 + 0.5, 6.0, "s2", color=ORANGE, fontsize=11, fontweight="bold")

    fig.suptitle("Set operations (shaded region is the result)",
                 y=0.98, fontsize=13, fontweight="bold")
    fig.tight_layout(rect=(0, 0, 1, 0.95))
    save(fig, "set_operations.png")


# ============================================================ Python functions
def function_anatomy():
    """Labels the parts of a def, and shows input flowing in and output back out."""
    fig, ax = plt.subplots(figsize=(11, 5.6))
    ax.set_xlim(0, 12)
    ax.set_ylim(0, 9)
    ax.axis("off")

    # the definition lines as monospace text
    lines = [
        ("def is_even(num):", 7.6),
        ('    """returns odd or even"""', 6.7),
        ("    if num % 2 == 0:", 5.9),
        ("        return 'even'", 5.1),
        ("    else:", 4.3),
        ("        return 'odd'", 3.5),
    ]
    ax.add_patch(FancyBboxPatch((0.4, 3.0), 6.6, 5.2, boxstyle="round,pad=0.1",
                                facecolor="#F4F6FA", edgecolor=GREY, lw=1.3))
    for text, y in lines:
        ax.text(0.7, y, text, fontsize=11, family="monospace", va="center")

    # labels pointing to parts
    def label(x, y, tx, ty, text, color):
        ax.annotate(text, xy=(x, y), xytext=(tx, ty), fontsize=9, color=color,
                    fontweight="bold",
                    arrowprops=dict(arrowstyle="->", color=color, lw=1.3))
    label(1.0, 7.6, 7.6, 8.4, "def keyword", BLUE)
    label(2.3, 7.6, 7.6, 7.5, "function name", ORANGE)
    label(3.6, 7.6, 7.6, 6.6, "parameter (input)", GREEN)
    label(2.4, 6.7, 7.6, 5.6, "docstring (manual)", PURPLE)
    label(3.0, 5.1, 7.6, 4.4, "body (the logic)", GREY)
    label(2.4, 5.1, 7.6, 3.4, "return (output back)", RED)

    # call flow at the bottom
    _pybox(ax, 2.0, 1.4, 2.6, 0.9, "is_even(7)", GREEN, fs=10)
    _pyarrow(ax, 3.4, 1.4, 4.6, 1.4)
    _pybox(ax, 5.9, 1.4, 2.4, 0.9, "the function\nruns", ORANGE, fs=9)
    _pyarrow(ax, 7.2, 1.4, 8.4, 1.4)
    _pybox(ax, 9.7, 1.4, 2.4, 0.9, "returns 'odd'", BLUE, fs=10)
    ax.text(6, 0.5, "defining does not run it; calling it with an argument runs the body",
            ha="center", fontsize=9, color=GREY, style="italic")
    ax.set_title("Anatomy of a function")
    save(fig, "function_anatomy.png")


def function_scope():
    """Nested boxes: the global scope holds x; the function's local scope holds y.
    Local can read global, but not the reverse."""
    fig, ax = plt.subplots(figsize=(9.5, 5.6))
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 9)
    ax.axis("off")

    # global scope box
    ax.add_patch(FancyBboxPatch((0.5, 0.6), 9.0, 7.7, boxstyle="round,pad=0.1",
                                facecolor="#EAF0FA", edgecolor=BLUE, lw=1.8))
    ax.text(1.0, 7.9, "global scope (main program)", fontsize=10.5, color=BLUE,
            fontweight="bold")
    _pybox(ax, 2.4, 6.9, 2.4, 0.8, "x = 5", BLUE, fs=11, mono=True)
    ax.text(2.4, 6.2, "global variable", ha="center", fontsize=8.5, color=BLUE)

    # local scope box (nested)
    ax.add_patch(FancyBboxPatch((2.0, 1.3), 6.2, 3.9, boxstyle="round,pad=0.1",
                                facecolor="#EAF7EF", edgecolor=GREEN, lw=1.8))
    ax.text(2.4, 4.7, "local scope (inside f)", fontsize=10.5, color=GREEN,
            fontweight="bold")
    _pybox(ax, 4.0, 3.5, 2.4, 0.8, "y = 10", GREEN, fs=11, mono=True)
    ax.text(4.0, 2.85, "local variable", ha="center", fontsize=8.5, color=GREEN)

    # arrows: local can read global (up), global cannot see local (blocked)
    ax.annotate("", xy=(2.4, 6.5), xytext=(4.0, 3.9),
                arrowprops=dict(arrowstyle="-|>", color=GREEN, lw=1.6))
    ax.text(4.55, 5.5, "reads the global", fontsize=8.5, color=GREEN, ha="left")
    ax.text(6.6, 3.5, "y vanishes when\nf finishes; the global\nprogram cannot see it",
            fontsize=8.5, color=RED, va="center")
    ax.text(5, 0.15, "a function can read a global but cannot change it in place",
            ha="center", fontsize=9, color=GREY, style="italic")
    ax.set_title("Local scope sits inside global scope")
    save(fig, "function_scope.png")


def map_filter_reduce():
    """One row each: map transforms all, filter keeps some, reduce collapses to one."""
    fig, axes = plt.subplots(3, 1, figsize=(11, 7.2))
    src = [1, 2, 3, 4, 5]

    def row_boxes(ax, values, y, color, x0=1.0, w=1.2, alpha=0.9, faded=None):
        centers = []
        for k, v in enumerate(values):
            x = x0 + k * (w + 0.25)
            a = 0.25 if (faded and k in faded) else alpha
            ax.add_patch(FancyBboxPatch((x - w / 2, y - 0.45), w, 0.9,
                                        boxstyle="round,pad=0.02", facecolor=color,
                                        edgecolor="black", alpha=a, lw=1.1))
            ax.text(x, y, str(v), ha="center", va="center", fontsize=11,
                    color="white", family="monospace")
            centers.append(x)
        return centers

    # map
    ax = axes[0]
    ax.set_xlim(0, 12); ax.set_ylim(0, 4); ax.axis("off")
    ax.set_title("map(lambda x: x**2, ...)   transforms every item", fontsize=11, loc="left")
    top = row_boxes(ax, src, 3.1, BLUE)
    bot = row_boxes(ax, [v ** 2 for v in src], 0.9, GREEN)
    for xt, xb in zip(top, bot):
        _pyarrow(ax, xt, 2.65, xb, 1.35, color=GREY)

    # filter
    ax = axes[1]
    ax.set_xlim(0, 12); ax.set_ylim(0, 4); ax.axis("off")
    ax.set_title("filter(lambda x: x > 2, ...)   keeps only some items", fontsize=11, loc="left")
    keep = [v > 2 for v in src]
    faded = [k for k, ok in enumerate(keep) if not ok]
    top = row_boxes(ax, src, 3.1, BLUE, faded=faded)
    kept_vals = [v for v in src if v > 2]
    bot = row_boxes(ax, kept_vals, 0.9, GREEN, x0=3.7)
    ki = 0
    for k, ok in enumerate(keep):
        if ok:
            _pyarrow(ax, top[k], 2.65, bot[ki], 1.35, color=GREEN)
            ki += 1

    # reduce
    ax = axes[2]
    ax.set_xlim(0, 12); ax.set_ylim(0, 4); ax.axis("off")
    ax.set_title("reduce(lambda x, y: x + y, ...)   combines all into one", fontsize=11, loc="left")
    top = row_boxes(ax, src, 3.1, BLUE)
    running = ["1", "1+2=3", "3+3=6", "6+4=10", "10+5=15"]
    for k in range(len(src)):
        ax.text(top[k], 2.2, "", ha="center")
    _pybox(ax, 6.0, 0.9, 2.4, 0.9, "15", RED, fs=13, mono=True)
    for xt in top:
        _pyarrow(ax, xt, 2.65, 6.0, 1.4, color=GREY)
    ax.text(9.6, 0.9, "two at a time,\nleft to right", fontsize=8.5, color=GREY, va="center")

    fig.suptitle("map transforms, filter selects, reduce combines",
                 y=1.0, fontsize=12.5, fontweight="bold")
    fig.tight_layout()
    save(fig, "map_filter_reduce.png")


if __name__ == "__main__":
    bernoulli_pmf()
    binomial_shapes()
    binomial_simulation()
    clt_convergence()
    t_vs_normal()
    confidence_interval()
    tailed_tests()
    type1_type2()
    pvalue_area()
    chi_square()
    f_distribution()
    anova_variance()
    normal_distribution()
    normal_parameters()
    empirical_rule()
    pmf_vs_pdf()
    pdf_area()
    pdf_cdf()
    skewness()
    kurtosis()
    qq_plot()
    uniform_distribution()
    lognormal_distribution()
    pareto_distribution()
    kde_concept()
    transformation()
    # descriptive statistics
    mean_median_outlier()
    boxplot_anatomy()
    histogram_shapes()
    covariance_quadrants()
    correlation_scatter()
    # tensors & linear algebra
    tensor_dimensions()
    vector_components()
    dot_product_geometry()
    mean_centering()
    hyperplane()
    linear_transformation()
    matrix_composition()
    determinant_area()
    # machine learning fundamentals
    traditional_vs_ml()
    ai_ml_dl_hierarchy()
    ml_vs_dl_data()
    ml_types_supervision()
    regression_vs_classification()
    clustering_example()
    batch_vs_online()
    instance_vs_model()
    overfitting_underfitting()
    mldlc_cycle()
    # python basics
    compiler_vs_interpreter()
    variable_reference_model()
    type_conversion_new_object()
    print_sep_end()
    python_type_map()
    # python operators & control flow
    control_flow_branching()
    loop_execution()
    break_vs_continue()
    # python strings
    string_indexing()
    string_slicing()
    # python time complexity
    complexity_classes()
    # python lists
    list_vs_array_memory()
    # python tuples, sets & dicts
    set_operations()
    # python functions
    function_anatomy()
    function_scope()
    map_filter_reduce()
    print("\nAll diagrams generated.")

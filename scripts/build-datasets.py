#!/usr/bin/env python3
"""
build-datasets.py: build the bundled datasets served at /datasets/.

Runnable Python cells call `cortex_data("name")` (see
src/components/pyodide-worker.ts); the worker fetches `/datasets/<name>.csv`
from the site's own origin. This script is the ONLY writer of
`public/datasets/`. It produces, deterministically:

  public/datasets/<name>.csv   one CSV per dataset (UTF-8, LF, no BOM)
  public/datasets/manifest.json machine-readable list + attribution
  public/datasets/LICENSES.md   human-readable credits and license terms
  public/datasets/.gitattributes `* -text`, so git never rewrites line endings
                                (this machine family runs core.autocrlf=true)

Design reference: .agents/tasks/pandas-design.md sections 2 and 3.

── Commercial-safe data only ────────────────────────────────────────────────
Cortex may carry a paid tier later, so ONLY data whose license is confirmed on
the publisher's page AND allows commercial use and modified redistribution
ships. The allowlist is LICENSE_ALLOWLIST below (CC0-1.0, CC-BY-4.0, ODbL-1.0,
MIT); the script refuses to write anything else (exit 3). Data that does not
meet the bar is replaced by seeded SYNTHETIC data that Cortex owns (MIT).
The course's own dataset folder is never read: every third-party file comes
from its publisher, pinned by SHA-256.

── Inputs (RAW_SOURCES) ─────────────────────────────────────────────────────
Each publisher original is downloaded (only with --fetch) into the cache
(default .agents/dataset-cache, gitignored) as <key>.csv and verified by byte
count and SHA-256 of the CSV itself (not the zip, which a host may rebuild).
No credentials, cookies, or tokens are ever read or sent. If a download
endpoint starts to require a login, download the file by hand from the page
URL in the error message into the cache under the stated name; the pinned
hash guarantees the same bytes.

── Per-dataset rules (DATASETS) ─────────────────────────────────────────────
  ipl_matches       Vora IPL_Matches_2008_2022.csv, shipped whole.
  ipl_deliveries    Vora IPL_Ball_by_Ball_2008_2022.csv, TRIMMED: group the
                    matches by Season, sort each season by integer ID, keep
                    positions 0, IPL_STRIDE, 2*IPL_STRIDE, ...; keep every
                    delivery whose ID is in that set, in source order.
                    ipl_matches ships whole, so every ipl_deliveries.ID has
                    exactly one ipl_matches row (asserted, exit 3).
  ipl_batter_runs   DERIVED: batsman_run summed per batter over every
                    delivery; sorted by batter (code point order).
  kohli_ipl         DERIVED: V Kohli's batsman_run summed per match in which
                    he faced a delivery; matches ordered by (Date, int ID);
                    match_no counts from 1.
  covid_confirmed   JHU CSSE time series (final archived commit), TRIMMED:
  covid_deaths      the 4 identifier columns plus every COVID_DATE_STEP-th
                    date column starting at the first date. All rows kept.
  expenses          Tharun "My expenses data", shipped whole.
  films, voyage_passengers, stock_prices, subscribers, courses, students,
  reg_month1, reg_month2, logins, order_deliveries
                    SYNTHETIC, generated from fixed seeds 1601 to 1610.
Every third-party value is copied as its ORIGINAL string (never parsed and
reformatted); only line endings and CSV quoting are normalized.

IPL_STRIDE knob: stride 12 gives 83 matches and about 1.72 MB. If the size
guard ever trips (exit 3), stride 13 gives 79 matches. Any change means: rerun
this script, then --check, then `npm test`, then regenerate every note output
fence that reads ipl_deliveries.

── Determinism rules ────────────────────────────────────────────────────────
  * Inputs pinned by SHA-256; any mismatch is fatal (exit 2).
  * Read with encoding='utf-8', newline='' and csv.reader (strict decoding).
  * Write with csv.writer(lineterminator='\\n', QUOTE_MINIMAL), UTF-8, no BOM.
  * Sampling uses sorted integer ids, never randomness.
  * Synthetic randomness comes ONLY from random.Random(seed).random(), whose
    sequence Python documents as stable for a given seed. choice, randrange,
    shuffle, and gauss are NOT used (their algorithms may change). Helpers
    pick/between/weighted/normal/chance below build on random() alone.
  * normal() (Box-Muller, uses math.log/cos/sqrt) rounds its result through
    '%.2f' before returning, so a last-ulp libm difference between platforms
    can never reach a comparison, a cumulative walk step, or the output.
    Every other float is produced by + - * / on such values (IEEE, identical
    everywhere) and written with a fixed format ('%.2f', '%.1f').
  * Word lists are literal tuples authored for Cortex; names and titles are
    invented combinations, not real people or works.
  * manifest.json: sorted by name, fixed key order, no timestamps, no paths,
    no Python version. LICENSES.md and .gitattributes: fixed order, LF.
  * Running twice leaves `git status` clean; --check proves it byte for byte.

── Usage ────────────────────────────────────────────────────────────────────
  python scripts/build-datasets.py [--cache DIR] [--out DIR] [--fetch] [--check]
    --cache  download cache; default $CORTEX_DATASETS_CACHE, else
             <repo>/.agents/dataset-cache
    --out    output dir; default <repo>/public/datasets
    --fetch  allow network downloads of missing cache files
    --check  build into a temp dir and byte-compare with --out (writes nothing)

Exit codes: 0 success / identical; 1 --check found differences; 2 input
problem (missing cache file without --fetch, download or hash failure,
missing column, synthetic invariant failed); 3 budget exceeded (file over
MAX_FILE_BYTES or total over MAX_TOTAL_BYTES), IPL join assertion failed, or a
license outside the allowlist.

Standard library only (Python 3.10+), so no pandas version can change output.
Cloudflare never runs this script: the generated files are committed.
"""

from __future__ import annotations

import argparse
import csv
import datetime
import hashlib
import io
import json
import math
import os
import pathlib
import random
import sys
import tempfile
import urllib.request
import zipfile

REPO = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_OUT = REPO / "public" / "datasets"
DEFAULT_CACHE = REPO / ".agents" / "dataset-cache"

IPL_STRIDE = 12
COVID_DATE_STEP = 7
MAX_FILE_BYTES = 2_000_000
MAX_TOTAL_BYTES = 6_000_000
LICENSE_ALLOWLIST = ("CC0-1.0", "CC-BY-4.0", "ODbL-1.0", "MIT")
USER_AGENT = "cortex-build-datasets"


class InputError(Exception):
    """Exit 2: an input file is missing, wrong, or an invariant failed."""


class GuardError(Exception):
    """Exit 3: budget, join, or license guard tripped."""


# ── Publisher originals ──────────────────────────────────────────────────────

VORA_PAGE = "https://www.kaggle.com/datasets/vora1011/ipl-2008-to-2021-all-match-dataset"
VORA_ZIP = "https://www.kaggle.com/api/v1/datasets/download/vora1011/ipl-2008-to-2021-all-match-dataset"
JHU_PAGE = "https://github.com/CSSEGISandData/COVID-19"
JHU_COMMIT = "4360e50239b4eb6b22f3a1759323748f36752177"
JHU_RAW = (
    "https://raw.githubusercontent.com/CSSEGISandData/COVID-19/" + JHU_COMMIT
    + "/csse_covid_19_data/csse_covid_19_time_series/"
)
THARUN_PAGE = "https://www.kaggle.com/datasets/tharunprabu/my-expenses-data"
THARUN_ZIP = "https://www.kaggle.com/api/v1/datasets/download/tharunprabu/my-expenses-data"

RAW_SOURCES = [
    {
        "key": "vora_matches",
        "page": VORA_PAGE,
        "url": VORA_ZIP,
        "member": "IPL_Matches_2008_2022.csv",
        "file": "IPL_Matches_2008_2022.csv",
        "bytes": 471_165,
        "sha256": "63bd6920b1e1664e7c0094c0662e2e3aaaa19e622247d3b3535ef4f6baafc72a",
    },
    {
        "key": "vora_balls",
        "page": VORA_PAGE,
        "url": VORA_ZIP,
        "member": "IPL_Ball_by_Ball_2008_2022.csv",
        "file": "IPL_Ball_by_Ball_2008_2022.csv",
        "bytes": 19_949_749,
        "sha256": "7645fa2ec0546af9d06a1512985d919afaed0282706e6a2fd7b5d217ffb5cdf3",
    },
    {
        "key": "jhu_confirmed",
        "page": JHU_PAGE,
        "url": JHU_RAW + "time_series_covid19_confirmed_global.csv",
        "member": None,
        "file": "time_series_covid19_confirmed_global.csv",
        "bytes": 1_819_904,
        "sha256": "e6234a59eec4359d2577358b5220e1a7e3da74c162913cdb7d882db1413f98c2",
    },
    {
        "key": "jhu_deaths",
        "page": JHU_PAGE,
        "url": JHU_RAW + "time_series_covid19_deaths_global.csv",
        "member": None,
        "file": "time_series_covid19_deaths_global.csv",
        "bytes": 1_255_258,
        "sha256": "4e87757a3e059c45650a1e1856614f8e339ee3c70653c378a7ba6f7b0ee8c72e",
    },
    {
        "key": "tharun_expenses",
        "page": THARUN_PAGE,
        "url": THARUN_ZIP,
        "member": "expense_data_1.csv",
        "file": "expense_data_1.csv",
        "bytes": 22_898,
        "sha256": "b7e5cc0bca39f51fe6de8ae64a95edd78e71bdecb88952860385b10ea092e090",
    },
]
RAW_BY_KEY = {r["key"]: r for r in RAW_SOURCES}


# ── Licenses and sources (single source for manifest, LICENSES.md, callouts) ─

REPO_LICENSE_URL = "https://github.com/Ayaz-Mohammed-Khan/cortex/blob/main/LICENSE"

LIC_MIT = {
    "name": "MIT License",
    "spdx": "MIT",
    "url": REPO_LICENSE_URL,
    "status": "confirmed",
    "shareAlike": False,
    "attribution": "Synthetic data generated for Cortex.",
}
LIC_JHU = {
    "name": "Creative Commons Attribution 4.0 International",
    "spdx": "CC-BY-4.0",
    "url": "https://creativecommons.org/licenses/by/4.0/",
    "status": "confirmed",
    "shareAlike": False,
    "attribution": (
        "COVID-19 Data Repository by the Center for Systems Science and Engineering (CSSE) "
        "at Johns Hopkins University, https://github.com/CSSEGISandData/COVID-19"
    ),
}
LIC_IPL = {
    "name": "Open Database License (ODbL) v1.0, contents under the Database Contents License (DbCL) v1.0",
    "spdx": "ODbL-1.0",
    "url": "https://opendatacommons.org/licenses/odbl/1-0/",
    "status": "confirmed",
    "shareAlike": True,
    "attribution": (
        "IPL 2008 to 2022 All Match Dataset by Sahil Vora (Kaggle), from Cricsheet data, "
        "licensed under ODbL 1.0 (database) and DbCL 1.0 (contents)."
    ),
}
LIC_CC0 = {
    "name": "Creative Commons Zero v1.0 Universal (CC0 1.0)",
    "spdx": "CC0-1.0",
    "url": "https://creativecommons.org/publicdomain/zero/1.0/",
    "status": "confirmed",
    "shareAlike": False,
    "attribution": "My expenses data by Tharun (Kaggle), CC0 1.0.",
}

SRC_SYNTHETIC = {
    "name": "Cortex (synthetic data generated by scripts/build-datasets.py)",
    "url": None,
    "upstream": None,
}
SRC_JHU = {
    "name": (
        "COVID-19 Data Repository by the Center for Systems Science and Engineering (CSSE) "
        "at Johns Hopkins University"
    ),
    "url": JHU_PAGE,
    "upstream": None,
}
SRC_IPL = {
    "name": "IPL 2008 to 2022 All Match Dataset by Sahil Vora (Kaggle)",
    "url": VORA_PAGE,
    "upstream": {
        "name": "Cricsheet",
        "url": "https://cricsheet.org/",
        "license": (
            "Open Data Commons Attribution License v1.0 (XML match data: Creative Commons "
            "Attribution 4.0 International), https://cricsheet.org/licensing/"
        ),
    },
}
SRC_THARUN = {
    "name": "My expenses data by Tharun (Kaggle)",
    "url": THARUN_PAGE,
    "upstream": None,
}

# Verbatim from https://cricsheet.org/licensing/ (checked for this build).
CRICSHEET_QUOTE = (
    "Most of the data is covered by the Open Data Commons Attribution License, whereas the "
    "XML match data alone is available under the Creative Commons Attribution 4.0 "
    "International License."
)


# ── Raw input handling ───────────────────────────────────────────────────────

_download_memo: dict[str, bytes] = {}


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _download(url: str) -> bytes:
    if url in _download_memo:
        return _download_memo[url]
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            status = getattr(res, "status", 200)
            if status < 200 or status >= 300:
                raise InputError("HTTP " + str(status) + " for " + url)
            data = res.read()
    except InputError:
        raise
    except Exception as exc:  # network, TLS, HTTP errors
        raise InputError("download failed for " + url + ": " + str(exc)) from exc
    _download_memo[url] = data
    return data


def raw_path(cache: pathlib.Path, key: str, fetch: bool) -> pathlib.Path:
    """Return the verified cache path for a RAW_SOURCES key (download if allowed)."""
    src = RAW_BY_KEY[key]
    path = cache / (key + ".csv")
    hint = (
        " Page: " + src["page"] + " ; file: " + src["file"] + " ; expected "
        + str(src["bytes"]) + " bytes, sha256 " + src["sha256"]
        + " ; save it as " + str(path)
    )
    if not path.exists():
        if not fetch:
            raise InputError("missing cache file for " + key + " (rerun with --fetch)." + hint)
        data = _download(src["url"])
        if src["member"] is not None:
            try:
                with zipfile.ZipFile(io.BytesIO(data)) as zf:
                    data = zf.read(src["member"])
            except KeyError as exc:
                raise InputError("zip member " + src["member"] + " not found." + hint) from exc
            except zipfile.BadZipFile as exc:
                raise InputError("download is not a zip (login required?)." + hint) from exc
        if len(data) != src["bytes"] or _sha256(data) != src["sha256"]:
            raise InputError(
                "downloaded " + key + " does not match the pinned size/hash (got "
                + str(len(data)) + " bytes, sha256 " + _sha256(data) + ")." + hint
            )
        cache.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    data = path.read_bytes()
    if len(data) != src["bytes"] or _sha256(data) != src["sha256"]:
        raise InputError("cache file " + str(path) + " does not match the pinned size/hash." + hint)
    return path


def read_csv_rows(path: pathlib.Path) -> tuple[list[str], list[list[str]]]:
    """Read a CSV strictly (UTF-8, no BOM), returning (header, rows) as strings."""
    try:
        with open(path, encoding="utf-8", newline="") as fh:
            rows = list(csv.reader(fh))
    except UnicodeDecodeError as exc:
        raise InputError("decode error in " + str(path) + ": " + str(exc)) from exc
    if not rows:
        raise InputError("empty CSV " + str(path))
    header = rows[0]
    if header and header[0].startswith("\ufeff"):
        raise InputError("unexpected BOM in " + str(path))
    width = len(header)
    for i, row in enumerate(rows[1:], start=2):
        if len(row) != width:
            raise InputError(str(path) + " line " + str(i) + " has " + str(len(row)) + " fields, expected " + str(width))
    return header, rows[1:]


def col_index(header: list[str], name: str, where: str) -> int:
    if name not in header:
        raise InputError("expected column " + repr(name) + " missing in " + where)
    return header.index(name)


# ── Third-party transforms ───────────────────────────────────────────────────

class Ctx:
    """Per-build state: cache path, fetch flag, and memoized parsed inputs."""

    def __init__(self, cache: pathlib.Path, fetch: bool) -> None:
        self.cache = cache
        self.fetch = fetch
        self._parsed: dict[str, tuple[list[str], list[list[str]]]] = {}

    def table(self, key: str) -> tuple[list[str], list[list[str]]]:
        if key not in self._parsed:
            self._parsed[key] = read_csv_rows(raw_path(self.cache, key, self.fetch))
        return self._parsed[key]


def ipl_sample_ids(ctx: Ctx) -> set[str]:
    """Every IPL_STRIDE-th match (by integer ID) within each season."""
    header, rows = ctx.table("vora_matches")
    i_id = col_index(header, "ID", "vora_matches")
    i_season = col_index(header, "Season", "vora_matches")
    by_season: dict[str, list[int]] = {}
    for row in rows:
        by_season.setdefault(row[i_season], []).append(int(row[i_id]))
    keep: set[str] = set()
    for season in sorted(by_season):
        ids = sorted(by_season[season])
        for pos in range(0, len(ids), IPL_STRIDE):
            keep.add(str(ids[pos]))
    return keep


def build_ipl_matches(ctx: Ctx):
    header, rows = ctx.table("vora_matches")
    ids = [r[col_index(header, "ID", "vora_matches")] for r in rows]
    if len(set(ids)) != len(ids):
        raise InputError("vora_matches has duplicate IDs")
    return header, rows


def build_ipl_deliveries(ctx: Ctx):
    header, rows = ctx.table("vora_balls")
    i_id = col_index(header, "ID", "vora_balls")
    keep = ipl_sample_ids(ctx)
    out = [r for r in rows if r[i_id] in keep]
    # Join assertion: every sampled delivery's match exists exactly once.
    m_header, m_rows = ctx.table("vora_matches")
    m_i = col_index(m_header, "ID", "vora_matches")
    counts: dict[str, int] = {}
    for r in m_rows:
        counts[r[m_i]] = counts.get(r[m_i], 0) + 1
    for mid in {r[i_id] for r in out}:
        if counts.get(mid, 0) != 1:
            raise GuardError("IPL join assertion failed: delivery ID " + mid + " has " + str(counts.get(mid, 0)) + " ipl_matches rows")
    if {r[i_id] for r in out} != keep:
        raise GuardError("IPL join assertion failed: a sampled match has no deliveries")
    return header, out


def build_ipl_batter_runs(ctx: Ctx):
    header, rows = ctx.table("vora_balls")
    i_b = col_index(header, "batter", "vora_balls")
    i_r = col_index(header, "batsman_run", "vora_balls")
    totals: dict[str, int] = {}
    for r in rows:
        totals[r[i_b]] = totals.get(r[i_b], 0) + int(r[i_r])
    return ["batter", "batsman_run"], [[b, str(totals[b])] for b in sorted(totals)]


def build_kohli_ipl(ctx: Ctx):
    header, rows = ctx.table("vora_balls")
    i_id = col_index(header, "ID", "vora_balls")
    i_b = col_index(header, "batter", "vora_balls")
    i_r = col_index(header, "batsman_run", "vora_balls")
    runs: dict[str, int] = {}
    for r in rows:
        if r[i_b] == "V Kohli":
            runs[r[i_id]] = runs.get(r[i_id], 0) + int(r[i_r])
    m_header, m_rows = ctx.table("vora_matches")
    m_id = col_index(m_header, "ID", "vora_matches")
    m_date = col_index(m_header, "Date", "vora_matches")
    dates = {r[m_id]: r[m_date] for r in m_rows}
    missing = [mid for mid in runs if mid not in dates]
    if missing:
        raise InputError("kohli_ipl: match IDs without a match row: " + ", ".join(sorted(missing)))
    order = sorted(runs, key=lambda mid: (dates[mid], int(mid)))
    if not order:
        raise InputError("kohli_ipl: no deliveries for batter 'V Kohli'")
    return ["match_no", "runs"], [[str(n), str(runs[mid])] for n, mid in enumerate(order, start=1)]


def _covid(ctx: Ctx, key: str):
    header, rows = ctx.table(key)
    expected = ["Province/State", "Country/Region", "Lat", "Long"]
    if header[:4] != expected:
        raise InputError(key + ": unexpected identifier columns " + repr(header[:4]))
    cols = list(range(4)) + list(range(4, len(header), COVID_DATE_STEP))
    return [header[i] for i in cols], [[row[i] for i in cols] for row in rows]


def build_covid_confirmed(ctx: Ctx):
    return _covid(ctx, "jhu_confirmed")


def build_covid_deaths(ctx: Ctx):
    return _covid(ctx, "jhu_deaths")


def build_expenses(ctx: Ctx):
    return ctx.table("tharun_expenses")


# ── Synthetic helpers (random() only; see the determinism rules) ─────────────

def pick(rng: random.Random, seq):
    return seq[int(rng.random() * len(seq))]


def between(rng: random.Random, lo: int, hi: int) -> int:
    """Uniform integer in [lo, hi]."""
    return lo + int(rng.random() * (hi - lo + 1))


def chance(rng: random.Random, p: float) -> bool:
    return rng.random() < p


def weighted(rng: random.Random, items, weights):
    """Pick one item with integer weights."""
    total = sum(weights)
    r = rng.random() * total
    acc = 0
    for item, w in zip(items, weights):
        acc += w
        if r < acc:
            return item
    return items[-1]


def normal(rng: random.Random) -> float:
    """Standard normal via Box-Muller, rounded through '%.2f' (see header)."""
    u1 = rng.random()
    u2 = rng.random()
    z = math.sqrt(-2.0 * math.log(1.0 - u1)) * math.cos(2.0 * math.pi * u2)
    return float("%.2f" % z)


def clamp(x, lo, hi):
    return lo if x < lo else hi if x > hi else x


def check(cond: bool, message: str) -> None:
    if not cond:
        raise InputError("synthetic invariant failed: " + message)


def unique_names(rng: random.Random, firsts, lasts, n: int, exclude=()) -> list[str]:
    seen = set(exclude)
    out: list[str] = []
    tries = 0
    while len(out) < n:
        tries += 1
        check(tries < n * 200, "could not draw enough unique names")
        name = pick(rng, firsts) + " " + pick(rng, lasts)
        if name not in seen:
            seen.add(name)
            out.append(name)
    return out


# Word lists authored for Cortex (invented combinations, not real people).
FIRST_NAMES = (
    "Aarav", "Ada", "Amara", "Anika", "Arlo", "Bea", "Cyrus", "Dalia", "Devika", "Elio",
    "Esme", "Farah", "Fen", "Gita", "Hana", "Idris", "Ines", "Ishan", "Jun", "Kavya",
    "Kenji", "Leela", "Lior", "Maren", "Mira", "Nadia", "Niko", "Odile", "Omar", "Priya",
    "Quinn", "Rafael", "Rhea", "Rohan", "Saanvi", "Soren", "Tara", "Teo", "Uma", "Vihaan",
    "Wren", "Yara", "Zain", "Zoya", "Basil", "Celine", "Dhruv", "Elif", "Ilya", "Juno",
)
LAST_NAMES = (
    "Ambrel", "Ashcombe", "Bastow", "Belvane", "Calder", "Corvell", "Dashiro", "Delmont",
    "Everly", "Farrow", "Galloway", "Harlan", "Ilvane", "Jessop", "Kavell", "Kestrel",
    "Larkin", "Lowmere", "Marchetti", "Merrow", "Navarre", "Northam", "Okonta", "Ormond",
    "Pellar", "Quarry", "Ravel", "Rookwood", "Sarvan", "Selwyn", "Tamsin", "Thornbury",
    "Ulloa", "Varga", "Vellacott", "Wexley", "Whitlow", "Yardley", "Zamora", "Zeller",
)
TITLE_ADJ = (
    "Silent", "Crimson", "Hidden", "Last", "Golden", "Broken", "Distant", "Burning",
    "Paper", "Winter", "Hollow", "Velvet", "Iron", "Restless", "Quiet", "Wild",
    "Glass", "Northern", "Sleeping", "Midnight", "Borrowed", "Electric", "Painted", "Lost",
    "Bitter", "Bright", "Secret", "Second", "Salt", "Silver", "Final", "Open",
    "Falling", "Forgotten", "Lucky", "Strange", "Gentle", "Endless", "Copper", "Little",
)
TITLE_NOUN = (
    "Harbor", "Lantern", "River", "Monsoon", "Orchard", "Signal", "Compass", "Letter",
    "Garden", "Station", "Mirror", "Highway", "Tide", "Kingdom", "Window", "Echo",
    "Circus", "Bridge", "Island", "Engine", "Canvas", "Festival", "Horizon", "Market",
    "Ladder", "Promise", "Theory", "Season", "Frontier", "Rooftop", "Voyage", "Archive",
    "Carnival", "Lighthouse", "Courtyard", "Monument", "Postcard", "Satellite", "Shadow", "Village",
    "Summer", "Melody", "Thread", "Verdict", "Wedding", "Ember", "Avenue", "Riddle", "Tunnel", "Crown",
)
TITLE_PLACE = (
    "Bombay", "the North", "Kerala", "the Valley", "Lisbon", "the Coast", "Old Delhi",
    "the Hills", "Kyoto", "the Desert", "Marseille", "the Delta", "Seoul", "the Plains",
    "Havana", "the Old Town", "Zanzibar", "the Border", "Goa", "the Island",
)
GENRES = (
    "Drama", "Comedy", "Action", "Thriller", "Romance", "Crime", "Adventure", "Mystery",
    "Family", "Fantasy", "Horror", "Biography", "Musical", "Sci-Fi", "Animation", "History",
)
GENRE_W = (30, 22, 18, 14, 14, 11, 9, 7, 6, 6, 5, 4, 4, 4, 3, 3)
COUNTRY_LANG = (
    ("India", "Hindi"), ("India", "Tamil"), ("India", "Malayalam"), ("United States", "English"),
    ("United Kingdom", "English"), ("France", "French"), ("South Korea", "Korean"),
    ("Japan", "Japanese"), ("Spain", "Spanish"), ("Germany", "German"), ("Italy", "Italian"),
    ("Brazil", "Portuguese"), ("Nigeria", "English"), ("Mexico", "Spanish"),
)
COUNTRY_W = (24, 8, 5, 22, 9, 6, 6, 5, 4, 3, 3, 2, 2, 2)
CERTS = ("U", "UA", "A", "PG-13", "R")
CERT_W = (22, 30, 18, 15, 15)


def _film_title(rng: random.Random) -> str:
    form = weighted(rng, (1, 2, 3, 4, 5), (6, 30, 30, 22, 12))
    if form == 1:
        return pick(rng, TITLE_NOUN) + "s"
    if form == 2:
        return pick(rng, TITLE_ADJ) + " " + pick(rng, TITLE_NOUN)
    if form == 3:
        return "The " + pick(rng, TITLE_ADJ) + " " + pick(rng, TITLE_NOUN)
    if form == 4:
        return "The " + pick(rng, TITLE_NOUN) + " of " + pick(rng, TITLE_PLACE)
    return "A " + pick(rng, TITLE_NOUN) + " for the " + pick(rng, TITLE_ADJ) + " " + pick(rng, TITLE_NOUN)


def build_films(_ctx: Ctx):
    rng = random.Random(1601)
    directors = unique_names(rng, FIRST_NAMES, LAST_NAMES, 120)
    leads = unique_names(rng, FIRST_NAMES, LAST_NAMES, 250, exclude=directors)
    # Mild skew: a few prolific names, a long tail of one-film names.
    dir_w = [3 + 24 // (k + 3) for k in range(len(directors))]
    lead_w = [2 + 30 // (k + 3) for k in range(len(leads))]
    header = [
        "title", "year", "runtime_min", "certificate", "genres", "rating", "votes",
        "metascore", "gross_musd", "director", "lead", "co_lead", "country", "language",
    ]
    rows: list[list[str]] = []
    titles: set[str] = set()
    decades = ((1975, 1979), (1980, 1989), (1990, 1999), (2000, 2009), (2010, 2019), (2020, 2023))
    for _ in range(1000):
        title = _film_title(rng)
        tries = 0
        while title in titles:
            tries += 1
            check(tries < 500, "could not draw a unique film title")
            title = _film_title(rng)
        titles.add(title)
        lo, hi = weighted(rng, decades, (3, 6, 12, 25, 38, 16))
        year = between(rng, lo, hi)
        runtime = int(clamp(float("%.0f" % (122 + 21 * normal(rng))), 78, 212))
        cert = "" if chance(rng, 0.04) else weighted(rng, CERTS, CERT_W)
        n_genres = weighted(rng, (1, 2, 3), (30, 45, 25))
        genres: list[str] = []
        while len(genres) < n_genres:
            g = weighted(rng, GENRES, GENRE_W)
            if g not in genres:
                genres.append(g)
        rating = float("%.1f" % clamp(6.6 + 0.9 * normal(rng), 2.5, 9.4))
        if rating >= 7.6:
            tier = weighted(rng, (0, 1, 2, 3), (10, 40, 40, 10))
        else:
            tier = weighted(rng, (0, 1, 2, 3), (35, 45, 18, 2))
        votes = between(rng, *((1_000, 9_999), (10_000, 99_999), (100_000, 999_999), (1_000_000, 2_500_000))[tier])
        meta_raw = normal(rng)
        metascore = "" if chance(rng, 0.12) else str(int(clamp(float("%.0f" % (rating * 10 - 6 + 9 * meta_raw)), 18, 99)))
        gross_mult = between(rng, 4, 90)
        gross = "" if chance(rng, 0.18) else "%.2f" % min(votes * gross_mult / 100_000.0, 900.0)
        director = weighted(rng, directors, dir_w)
        lead = weighted(rng, leads, lead_w)
        co_lead = weighted(rng, leads, lead_w)
        while co_lead == lead:
            co_lead = weighted(rng, leads, lead_w)
        country, language = weighted(rng, COUNTRY_LANG, COUNTRY_W)
        rows.append([
            title, str(year), str(runtime), cert, ", ".join(genres), "%.1f" % rating, str(votes),
            metascore, gross, director, lead, co_lead, country, language,
        ])
    check(len(titles) == 1000, "film titles unique")
    dir_counts: dict[str, int] = {}
    lead_counts: dict[str, int] = {}
    for r in rows:
        dir_counts[r[9]] = dir_counts.get(r[9], 0) + 1
        lead_counts[r[10]] = lead_counts.get(r[10], 0) + 1
    check(max(dir_counts.values()) >= 8, "some director has 8+ films")
    check(max(lead_counts.values()) >= 8, "some lead has 8+ films")
    check(sum(1 for c in lead_counts.values() if c >= 3) >= 20, "20+ leads with 3+ films")
    for col, lo, hi in ((7, 0.08, 0.16), (8, 0.14, 0.22), (3, 0.02, 0.06)):
        share = sum(1 for r in rows if r[col] == "") / len(rows)
        check(lo <= share <= hi, "missing share of " + header[col] + " is " + str(share))
    return header, rows


FAMILY_NAMES = (
    "Abernath", "Ashdown", "Bellamy", "Brannock", "Carrow", "Castellan", "Dunmore", "Elsworth",
    "Fairbanks", "Fennimore", "Garrick", "Greaves", "Halloran", "Hartigan", "Ivers", "Jessamy",
    "Kilbride", "Lacombe", "Lindqvist", "Maddox", "Mallory", "Nettleton", "Norcross", "Oakhurst",
    "Pemberly", "Prescott", "Quayle", "Radcliffe", "Rourke", "Sandoval", "Sorensen", "Thackery",
    "Tremaine", "Underhill", "Vasquez", "Waverly", "Whitcombe", "Wyndham", "Yeoman", "Zellweger",
    "Brightwater", "Coldharbour", "Dewhurst", "Farraday", "Gillespie", "Holloway", "Kingsley",
    "Lockhart", "Merriweather", "Pendleton",
)
MALE_GIVEN = (
    "Albert", "Arthur", "Bertram", "Cecil", "Clement", "Edmund", "Edwin", "Ernest", "Felix",
    "Frederick", "George", "Harold", "Henry", "Hugo", "Isaac", "Jasper", "Leopold", "Lionel",
    "Matthias", "Milo", "Nathaniel", "Oscar", "Percival", "Rupert", "Silas", "Theodore",
    "Victor", "Walter",
)
FEMALE_GIVEN = (
    "Adelaide", "Agnes", "Beatrice", "Clara", "Constance", "Dorothea", "Edith", "Eleanor",
    "Eliza", "Florence", "Georgina", "Harriet", "Ida", "Imogen", "Josephine", "Lavinia",
    "Lillian", "Mabel", "Margaret", "Matilda", "Nora", "Olive", "Philippa", "Rosalind",
    "Sybil", "Violet", "Winifred",
)
TICKET_PREFIX = ("PC", "A/5", "SOTON/O.Q.", "C.A.", "STON/O2.", "W./C.", "S.C./PARIS", "F.C.C.")


def build_voyage_passengers(_ctx: Ctx):
    rng = random.Random(1602)
    header = [
        "passenger_id", "survived", "cabin_class", "name", "sex", "age", "sib_sp", "par_ch",
        "ticket", "fare", "cabin", "embarked",
    ]
    rows: list[list[str]] = []
    married = 0
    maiden = 0
    for pid in range(1, 901):
        cls = weighted(rng, (1, 2, 3), (22, 21, 57))
        sex = "male" if chance(rng, 0.64) else "female"
        age_val = between(rng, 1, 74)
        if sex == "male":
            if age_val < 13:
                title = "Master"
            else:
                title = weighted(rng, ("Mr", "Dr", "Rev", "Capt", "Col", "Major"), (180, 3, 3, 1, 1, 1))
        else:
            if age_val < 18:
                title = "Miss"
            else:
                title = weighted(rng, ("Mrs", "Miss", "Ms", "Dr", "Lady", "Countess"), (100, 70, 2, 1, 1, 1))
        family = pick(rng, FAMILY_NAMES)
        if sex == "male":
            given = pick(rng, MALE_GIVEN)
            if chance(rng, 0.35):
                given += " " + pick(rng, MALE_GIVEN)
        elif title == "Mrs":
            married += 1
            husband = pick(rng, MALE_GIVEN)
            if chance(rng, 0.08):
                maiden += 1
                given = husband + " (" + pick(rng, FEMALE_GIVEN) + " " + pick(rng, FAMILY_NAMES) + ")"
            else:
                given = pick(rng, FEMALE_GIVEN)
        else:
            given = pick(rng, FEMALE_GIVEN)
            if chance(rng, 0.3):
                given += " " + pick(rng, FEMALE_GIVEN)
        name = family + ", " + title + ". " + given
        age = "" if chance(rng, 0.2) else str(age_val)
        sib_sp = weighted(rng, (0, 1, 2, 3, 4, 5), (68, 23, 4, 2, 2, 1))
        par_ch = weighted(rng, (0, 1, 2, 3, 4), (76, 13, 9, 1, 1))
        if title == "Master" and par_ch == 0:
            par_ch = between(rng, 1, 2)
        if chance(rng, 0.7):
            ticket = str(between(rng, 1000, 399999))
        else:
            ticket = pick(rng, TICKET_PREFIX) + " " + str(between(rng, 100, 39999))
        lo, hi = {1: (26.0, 263.0), 2: (10.5, 73.5), 3: (6.75, 39.7)}[cls]
        fare = "%.2f" % (lo + rng.random() * (hi - lo))
        has_cabin = chance(rng, {1: 0.8, 2: 0.15, 3: 0.05}[cls])
        cabin = ""
        if has_cabin:
            deck = pick(rng, {1: "ABCDE", 2: "DEF", 3: "EFG"}[cls])
            cabin = deck + str(between(rng, 2, 148))
        embarked = weighted(rng, ("S", "C", "Q"), (72, 19, 9))
        if sex == "female":
            p = {1: 0.95, 2: 0.88, 3: 0.5}[cls]
        elif title == "Master":
            p = 0.55
        else:
            p = {1: 0.38, 2: 0.16, 3: 0.14}[cls]
        survived = "1" if chance(rng, p) else "0"
        rows.append([
            str(pid), survived, str(cls), name, sex, age, str(sib_sp), str(par_ch), ticket, fare,
            cabin, embarked,
        ])
    # Exactly two passengers with no recorded port, chosen by the seeded stream.
    blanks: list[int] = []
    while len(blanks) < 2:
        i = between(rng, 0, 899)
        if i not in blanks:
            blanks.append(i)
    for i in blanks:
        rows[i][11] = ""
    check(sum(1 for r in rows if r[11] == "") == 2, "exactly 2 missing embarked")
    cabin_na = sum(1 for r in rows if r[10] == "") / len(rows)
    check(0.68 <= cabin_na <= 0.82, "cabin missing share " + str(cabin_na))
    age_na = sum(1 for r in rows if r[5] == "") / len(rows)
    check(0.15 <= age_na <= 0.25, "age missing share " + str(age_na))
    check(married > 0 and maiden >= 3, "some married women carry a maiden name")
    check(all(", " in r[3] and ". " in r[3] for r in rows), "name format Family, Title. Given")
    check(any(not r[8].isdigit() for r in rows) and any(r[8].isdigit() for r in rows), "ticket mix")
    return header, rows


def build_stock_prices(_ctx: Ctx):
    rng = random.Random(1603)
    split = datetime.date(2020, 7, 15)
    day = datetime.date(2014, 1, 2)
    end = datetime.date(2023, 12, 29)
    adj = 38.40  # split-adjusted close, the "economic" price
    header = ["Date", "Open", "High", "Low", "Close", "Adj Close", "Volume"]
    rows: list[list[str]] = []
    weekday_pct = (115, 104, 100, 98, 90)
    while day <= end:
        if day.weekday() < 5:
            if day < datetime.date(2020, 2, 20):
                vol = 0.012
            elif day < datetime.date(2021, 6, 1):
                vol = 0.026
            else:
                vol = 0.016
            gap = 0.003 * normal(rng)
            open_adj = float("%.2f" % (adj * (1 + gap)))
            r = 0.0004 + vol * normal(rng)
            close_adj = float("%.2f" % (open_adj * (1 + r)))
            check(close_adj > 1.0, "price stays positive")
            spread_hi = float("%.4f" % (rng.random() * vol))
            spread_lo = float("%.4f" % (rng.random() * vol))
            factor = 2 if day < split else 1
            o = float("%.2f" % (open_adj * factor))
            c = float("%.2f" % (close_adj * factor))
            h = float("%.2f" % (max(o, c) * (1 + spread_hi)))
            low = float("%.2f" % (min(o, c) * (1 - spread_lo)))
            if h < max(o, c):
                h = max(o, c)
            if low > min(o, c):
                low = min(o, c)
            check(h >= max(o, c) and low <= min(o, c) and low > 0, "OHLC consistent")
            base = 1_600_000 if day < split else 3_200_000
            volume = int(float("%.0f" % (base * weekday_pct[day.weekday()] / 100 * (1 + 0.22 * normal(rng)))))
            volume = max(volume, 150_000)
            rows.append([
                day.isoformat(), "%.2f" % o, "%.2f" % h, "%.2f" % low, "%.2f" % c,
                "%.2f" % close_adj, str(volume),
            ])
            adj = close_adj
        day += datetime.timedelta(days=1)
    check(len(rows) == 2607, "weekday count 2014-01-02 to 2023-12-29 is " + str(len(rows)))
    return header, rows


def build_subscribers(_ctx: Ctx):
    rng = random.Random(1604)
    spikes = {74: 410, 190: 560, 301: 330}
    values: list[int] = []
    week = (1.12, 1.05, 1.0, 0.97, 0.93, 0.78, 0.82)
    for i in range(365):
        trend = 34 + i * 0.32
        v = trend * week[i % 7] * (1 + 0.18 * normal(rng))
        for start, size in spikes.items():
            if start <= i < start + 6:
                v += size / (1 + (i - start) * 1.5)
        values.append(max(0, int(float("%.0f" % v))))
    check(min(values) >= 0, "non-negative")
    check(sum(1 for v in values if v < 50) >= 20, "some quiet days under 50")
    check(max(values) > 300, "visible spikes")
    return ["new_subscribers"], [[str(v)] for v in values]


COURSE_NAMES = (
    "Python Basics", "Data Cleaning", "SQL Essentials", "Statistics Primer", "Excel to pandas",
    "Data Visualization", "Machine Learning 101", "Deep Learning Intro", "Web Scraping",
    "Time Series Basics", "Text Analysis", "Dashboards with Python",
)


def build_courses(_ctx: Ctx):
    rng = random.Random(1605)
    prices = (999, 1199, 1499, 1999, 2499, 2999, 3499, 3999, 4499, 4999)
    rows = [[str(i + 1), COURSE_NAMES[i], str(pick(rng, prices))] for i in range(12)]
    return ["course_id", "course_name", "price"], rows


def build_students(_ctx: Ctx):
    rng = random.Random(1606)
    names = unique_names(rng, FIRST_NAMES, LAST_NAMES, 25)
    rows = []
    for sid in range(1, 26):
        partner = between(rng, 1, 25)
        while partner == sid:
            partner = between(rng, 1, 25)
        rows.append([str(sid), names[sid - 1], str(partner)])
    check(all(r[0] != r[2] for r in rows), "no self-partner")
    return ["student_id", "name", "partner"], rows


def _registrations(rng: random.Random, n_rows: int, forced: list[tuple[int, int]]) -> list[list[str]]:
    pairs: list[tuple[int, int]] = []
    seen: set[tuple[int, int]] = set(forced)
    while len(pairs) < n_rows - len(forced):
        pair = (between(rng, 1, 25), between(rng, 1, 12))
        if pair not in seen:
            seen.add(pair)
            pairs.append(pair)
    for pair in forced:
        pairs.insert(between(rng, 0, len(pairs)), pair)
    return [[str(s), str(c)] for s, c in pairs]


def build_reg_month1(_ctx: Ctx):
    rng = random.Random(1607)
    return ["student_id", "course_id"], _registrations(rng, 25, [])


def build_reg_month2(_ctx: Ctx):
    rng = random.Random(1608)
    forced = [(26, 4), (27, 9), (28, 2), (between(rng, 1, 25), 13)]
    rows = _registrations(rng, 28, forced)
    # Join-behaviour invariants against the other registration tables.
    m1 = {int(r[0]) for r in build_reg_month1(_ctx)[1]}
    m2 = {int(r[0]) for r in rows}
    check(bool(m1 & m2) and bool(m1 - m2) and bool(m2 - m1), "month overlap and differences exist")
    students = set(range(1, 26))
    inner = sum(1 for r in rows if int(r[0]) in students)
    left = inner + len(students - m2)
    right = inner + sum(1 for r in rows if int(r[0]) not in students)
    outer = left + (right - inner)
    counts = (inner, left, right, outer)
    check(len(set(counts)) == 4, "students x reg_month2 join counts differ: " + repr(counts))
    check(any(r[1] == "13" for r in rows), "course 13 present")
    return ["student_id", "course_id"], rows


def build_logins(_ctx: Ctx):
    rng = random.Random(1609)
    start = datetime.datetime(2023, 1, 2)
    hour_w = (2, 1, 1, 1, 1, 2, 4, 7, 10, 12, 12, 11, 10, 11, 12, 12, 11, 10, 10, 11, 12, 10, 7, 4)
    users = tuple(range(2101, 2121))
    user_w = (40, 32, 26, 22, 19, 16, 14, 12, 10, 9, 8, 7, 6, 5, 5, 4, 4, 3, 3, 2)
    offsets: set[int] = set()
    while len(offsets) < 3000:
        d = between(rng, 0, 179)
        h = weighted(rng, tuple(range(24)), hour_w)
        offsets.add(d * 86400 + h * 3600 + between(rng, 0, 3599))
    ordered = sorted(offsets)
    rows = []
    for n, off in enumerate(ordered, start=1):
        ts = start + datetime.timedelta(seconds=off)
        rows.append([str(n), str(weighted(rng, users, user_w)), ts.strftime("%Y-%m-%d %H:%M:%S")])
    check(all(rows[i][2] < rows[i + 1][2] for i in range(len(rows) - 1)), "strictly increasing")
    check(rows[-1][2] <= "2023-06-30 23:59:59", "inside the window")
    return None, rows


def _mdyy(d: datetime.date) -> str:
    return str(d.month) + "/" + str(d.day) + "/" + "%02d" % (d.year % 100)


def build_order_deliveries(_ctx: Ctx):
    rng = random.Random(1610)
    first = datetime.date(2018, 1, 1)
    span = (datetime.date(2022, 11, 26) - first).days
    rows = []
    for _ in range(500):
        order = first + datetime.timedelta(days=between(rng, 0, span))
        band = weighted(rng, ((1, 14), (15, 60), (61, 180), (181, 400)), (55, 28, 12, 5))
        delivered = order + datetime.timedelta(days=between(rng, *band))
        check(delivered.year <= 2023, "delivery inside 2023")
        rows.append([_mdyy(order), _mdyy(delivered)])
    return ["order_date", "delivery_date"], rows


# ── Dataset registry ─────────────────────────────────────────────────────────

def _third_party(name, title, description, origin, build, source, license_, raw_keys, trimmed, changes):
    return {
        "name": name, "title": title, "description": description, "origin": origin,
        "build": build, "source": source, "license": license_, "raw": raw_keys,
        "trimmed": trimmed, "changes": changes,
    }


def _synthetic(name, title, description, build, seed):
    return {
        "name": name, "title": title, "description": description, "origin": "synthetic",
        "build": build, "source": SRC_SYNTHETIC, "license": LIC_MIT, "raw": [],
        "trimmed": False,
        "changes": "Synthetic: generated from seed " + str(seed) + "; not real data.",
    }


DATASETS = [
    _third_party(
        "ipl_matches", "IPL matches 2008 to 2022",
        "One row per Indian Premier League match: teams, venue, toss, result, margin, and players.",
        "publisher", build_ipl_matches, SRC_IPL, LIC_IPL, ["vora_matches"], False,
        "Shipped whole. Line endings normalized to LF.",
    ),
    _third_party(
        "ipl_deliveries", "IPL ball-by-ball deliveries (sampled matches)",
        "One row per delivery for a sample of IPL matches: batter, bowler, runs, extras, and wickets.",
        "publisher", build_ipl_deliveries, SRC_IPL, LIC_IPL, ["vora_matches", "vora_balls"], True,
        "Trimmed: kept every delivery of every " + str(IPL_STRIDE) + "th match (by match ID) "
        "within each season. Line endings normalized to LF.",
    ),
    _third_party(
        "ipl_batter_runs", "IPL career runs per batter, 2008 to 2022",
        "Total runs off the bat for every batter across all IPL deliveries from 2008 to 2022.",
        "derived", build_ipl_batter_runs, SRC_IPL, LIC_IPL, ["vora_balls"], False,
        "Derived: batsman_run summed per batter over every delivery, sorted by batter name.",
    ),
    _third_party(
        "kohli_ipl", "V Kohli IPL runs per match, 2008 to 2022",
        "Runs off the bat scored by V Kohli in each IPL match he batted in, in match date order.",
        "derived", build_kohli_ipl, SRC_IPL, LIC_IPL, ["vora_matches", "vora_balls"], False,
        "Derived: V Kohli's batsman_run summed per match, matches ordered by date then match ID.",
    ),
    _third_party(
        "covid_confirmed", "COVID-19 confirmed cases by country (weekly)",
        "Cumulative confirmed cases per country or province, one column per sampled date.",
        "publisher", build_covid_confirmed, SRC_JHU, LIC_JHU, ["jhu_confirmed"], True,
        "Trimmed: kept the 4 identifier columns and every " + str(COVID_DATE_STEP) + "th date "
        "column from 1/22/20 (one date per week). Line endings normalized to LF.",
    ),
    _third_party(
        "covid_deaths", "COVID-19 deaths by country (weekly)",
        "Cumulative deaths per country or province, one column per sampled date.",
        "publisher", build_covid_deaths, SRC_JHU, LIC_JHU, ["jhu_deaths"], True,
        "Trimmed: kept the 4 identifier columns and every " + str(COVID_DATE_STEP) + "th date "
        "column from 1/22/20 (one date per week). Line endings normalized to LF.",
    ),
    _third_party(
        "expenses", "Personal expense and income records",
        "One person's dated expense and income entries with category, account, and note.",
        "publisher", build_expenses, SRC_THARUN, LIC_CC0, ["tharun_expenses"], False,
        "Shipped whole. Line endings normalized to LF.",
    ),
    _synthetic(
        "films", "Fictional film catalogue",
        "1000 invented films with year, runtime, certificate, genres, ratings, votes, gross, and crew.",
        build_films, 1601,
    ),
    _synthetic(
        "voyage_passengers", "Fictional ship passenger list (SS Meridian)",
        "900 invented passengers of a fictional liner: class, name with title, age, family, ticket, fare, cabin, port, survival.",
        build_voyage_passengers, 1602,
    ),
    _synthetic(
        "stock_prices", "Fictional daily stock prices (ticker CRTX)",
        "Weekday open, high, low, close, adjusted close, and volume for a fictional ticker, 2014 to 2023, with a 2-for-1 split on 2020-07-15.",
        build_stock_prices, 1603,
    ),
    _synthetic(
        "subscribers", "Fictional daily new subscribers",
        "New subscribers gained per day over one year for a fictional channel.",
        build_subscribers, 1604,
    ),
    _synthetic(
        "courses", "Fictional course catalogue",
        "12 courses with an id, a name, and a price.",
        build_courses, 1605,
    ),
    _synthetic(
        "students", "Fictional student roster",
        "25 students with an id, a name, and the id of their study partner.",
        build_students, 1606,
    ),
    _synthetic(
        "reg_month1", "Fictional course registrations, month 1",
        "Which student registered for which course in the first month.",
        build_reg_month1, 1607,
    ),
    _synthetic(
        "reg_month2", "Fictional course registrations, month 2",
        "Which student registered for which course in the second month, including ids missing from the student and course tables.",
        build_reg_month2, 1608,
    ),
    _synthetic(
        "logins", "Fictional login log",
        "3000 login events (row id, user id, timestamp) from January to June 2023, stored without a header row.",
        build_logins, 1609,
    ),
    _synthetic(
        "order_deliveries", "Fictional order and delivery dates",
        "500 orders with order and delivery dates written as M/D/YY.",
        build_order_deliveries, 1610,
    ),
]


# ── Writers ──────────────────────────────────────────────────────────────────

def csv_bytes(header, rows) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n", quoting=csv.QUOTE_MINIMAL)
    if header is not None:
        writer.writerow(header)
    writer.writerows(rows)
    return buf.getvalue().encode("utf-8")


def _md_link(text: str, url: str | None) -> str:
    return "[" + text + "](" + url + ")" if url else text


def licenses_md(entries: list[dict]) -> str:
    out: list[str] = []
    add = out.append
    add("# Dataset licenses")
    add("")
    add("These files back the runnable code cells on Cortex (`cortex_data(\"name\")`).")
    add("Third-party files keep their own licenses, listed below, and are not covered by the")
    add("repository's MIT License. Synthetic files were generated for Cortex and are MIT")
    add("licensed. Every license listed here allows commercial use and redistribution of")
    add("modified copies.")
    add("")
    add("Generated by `scripts/build-datasets.py`; do not edit by hand.")
    add("")
    add("## ShareAlike conditions")
    add("")
    sa = [e["name"] for e in entries if e["license"]["shareAlike"]]
    add("The following datasets are licensed under the Open Database License (ODbL) v1.0, with")
    add("their contents under the Database Contents License (DbCL) v1.0: "
        + ", ".join("`" + n + "`" for n in sa) + ".")
    add("")
    add("- Attribute: credit the source as shown in each dataset's section below.")
    add("- Keep the license notice: ODbL 1.0 (https://opendatacommons.org/licenses/odbl/1-0/)")
    add("  and DbCL 1.0 (https://opendatacommons.org/licenses/dbcl/1-0/) travel with the files.")
    add("- Share alike: the trimmed and derived files here are adapted databases of the ODbL")
    add("  original, and this folder offers them under ODbL 1.0 as well.")
    add("- The upstream data comes from Cricsheet (https://cricsheet.org/). Its licensing page")
    add("  (https://cricsheet.org/licensing/) states:")
    add("  \"" + CRICSHEET_QUOTE + "\"")
    add("  No Cricsheet data is excluded from reuse, and IPL match data is not excluded: it")
    add("  falls under one of those two licenses, and both allow commercial reuse and")
    add("  adaptation with attribution.")
    add("")
    add("## Summary")
    add("")
    add("| Dataset | File | Origin | Source | License | Changes |")
    add("| :-- | :-- | :-- | :-- | :-- | :-- |")
    for e in entries:
        add("| `" + e["name"] + "` | " + e["file"] + " | " + e["origin"] + " | "
            + _md_link(e["source"]["name"], e["source"]["url"]) + " | "
            + _md_link(e["license"]["name"], e["license"]["url"]) + " | " + e["changes"] + " |")
    add("")
    for e in entries:
        add("## " + e["name"])
        add("")
        add("- Title: " + e["title"])
        add("- File: " + e["file"] + " (" + str(e["rows"]) + " rows, " + str(e["bytes"]) + " bytes)")
        add("- SHA-256: " + e["sha256"])
        add("- Origin: " + e["origin"])
        add("- Source: " + _md_link(e["source"]["name"], e["source"]["url"]))
        up = e["source"]["upstream"]
        if up:
            add("- Upstream: " + _md_link(up["name"], up["url"]) + ", " + up["license"])
        if e["source"]["raw"]:
            add("- Built from:")
            for raw in e["source"]["raw"]:
                add("  - " + raw["file"] + " (" + raw["url"] + "), SHA-256 " + raw["sha256"])
        else:
            add("- Built from: generated by scripts/build-datasets.py (no third-party input)")
        add("- License: " + _md_link(e["license"]["name"], e["license"]["url"]))
        add("- Required attribution: " + e["license"]["attribution"])
        add("- Changes: " + e["changes"])
        add("")
    add("## Regenerating")
    add("")
    add("```text")
    add("python scripts/build-datasets.py --fetch   # download publisher files into the cache, build")
    add("python scripts/build-datasets.py --check   # rebuild into a temp dir and byte-compare")
    add("```")
    add("")
    add("The download cache lives in `.agents/dataset-cache` (not committed).")
    return "\n".join(out) + "\n"


def build_outputs(ctx: Ctx) -> dict[str, bytes]:
    """Build every output file in memory: {file name: bytes}."""
    files: dict[str, bytes] = {}
    entries: list[dict] = []
    for spec in sorted(DATASETS, key=lambda d: d["name"]):
        lic = spec["license"]
        if lic["spdx"] not in LICENSE_ALLOWLIST or lic["status"] != "confirmed":
            raise GuardError("license " + lic["spdx"] + " for " + spec["name"] + " is not allowlisted")
        header, rows = spec["build"](ctx)
        data = csv_bytes(header, rows)
        file = spec["name"] + ".csv"
        if len(data) > MAX_FILE_BYTES:
            raise GuardError(file + " is " + str(len(data)) + " bytes (max " + str(MAX_FILE_BYTES) + ")")
        files[file] = data
        raw = [
            {"file": RAW_BY_KEY[k]["file"], "url": RAW_BY_KEY[k]["url"], "sha256": RAW_BY_KEY[k]["sha256"]}
            for k in spec["raw"]
        ]
        if spec["origin"] != "synthetic" and not raw:
            raise GuardError(spec["name"] + " has no raw source")
        entries.append({
            "name": spec["name"],
            "file": file,
            "title": spec["title"],
            "description": spec["description"],
            "origin": spec["origin"],
            "bytes": len(data),
            "sha256": _sha256(data),
            "rows": len(rows),
            "header": header is not None,
            "columns": header,
            "source": {
                "name": spec["source"]["name"],
                "url": spec["source"]["url"],
                "upstream": spec["source"]["upstream"],
                "raw": raw,
            },
            "license": dict(lic),
            "trimmed": spec["trimmed"],
            "changes": spec["changes"],
        })
    total = sum(len(b) for b in files.values())
    if total > MAX_TOTAL_BYTES:
        raise GuardError("datasets total " + str(total) + " bytes (max " + str(MAX_TOTAL_BYTES) + ")")
    manifest = {
        "version": 1,
        "generator": "scripts/build-datasets.py",
        "licensesFile": "LICENSES.md",
        "datasets": entries,
    }
    files["manifest.json"] = (json.dumps(manifest, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    files["LICENSES.md"] = licenses_md(entries).encode("utf-8")
    files[".gitattributes"] = b"* -text\n"
    return files


def write_dir(out: pathlib.Path, files: dict[str, bytes]) -> None:
    out.mkdir(parents=True, exist_ok=True)
    for existing in out.iterdir():
        if existing.is_file() and existing.name not in files:
            print("removing stale " + existing.name, file=sys.stderr)
            existing.unlink()
    for name in sorted(files):
        with open(out / name, "wb") as fh:
            fh.write(files[name])


def compare_dir(out: pathlib.Path, files: dict[str, bytes]) -> list[str]:
    diffs: list[str] = []
    present = {p.name for p in out.iterdir() if p.is_file()} if out.exists() else set()
    for name in sorted(files):
        if name not in present:
            diffs.append("missing: " + name)
        elif (out / name).read_bytes() != files[name]:
            diffs.append("different: " + name)
    for name in sorted(present - set(files)):
        diffs.append("extra: " + name)
    return diffs


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Build the bundled Cortex datasets.")
    parser.add_argument("--cache", type=pathlib.Path,
                        default=pathlib.Path(os.environ.get("CORTEX_DATASETS_CACHE", str(DEFAULT_CACHE))))
    parser.add_argument("--out", type=pathlib.Path, default=DEFAULT_OUT)
    parser.add_argument("--fetch", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)

    ctx = Ctx(args.cache, args.fetch)
    try:
        files = build_outputs(ctx)
    except InputError as exc:
        print("error: " + str(exc), file=sys.stderr)
        return 2
    except GuardError as exc:
        print("guard: " + str(exc), file=sys.stderr)
        return 3

    if args.check:
        with tempfile.TemporaryDirectory() as tmp:
            write_dir(pathlib.Path(tmp), files)
            rebuilt = {p.name: p.read_bytes() for p in pathlib.Path(tmp).iterdir()}
        diffs = compare_dir(args.out, rebuilt)
        if diffs:
            for d in diffs:
                print(d, file=sys.stderr)
            return 1
        print("check: " + str(len(files)) + " files identical in " + str(args.out))
        return 0

    write_dir(args.out, files)
    manifest = json.loads(files["manifest.json"])
    total = 0
    for e in manifest["datasets"]:
        total += e["bytes"]
        print("%-18s %7d rows %9d bytes  %s" % (e["name"], e["rows"], e["bytes"], e["sha256"][:12]))
    print("total %d bytes in %d datasets -> %s" % (total, len(manifest["datasets"]), args.out))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

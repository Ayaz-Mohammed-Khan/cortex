---
tags:
  - pandas
  - dataframe-methods
  - missing-values
  - sorting
aliases:
  - DataFrame Methods
  - pandas methods
difficulty: beginner
runnable: true
prerequisites:
  - Pandas DataFrame
created: 2026-10-13
---

> [!info] Where this fits
> This builds on [[Pandas DataFrame]], where you learned to create, select, and filter tables. Here you learn the methods that clean and reorganize them: counting, sorting, ranking, re-indexing, handling missing values, removing duplicates, and applying your own functions. From here you continue to [[GroupBy]].

Raw data is rarely ready to analyze. Some values are missing, some rows repeat, the order is arbitrary, and the labels are awkward. The methods in this note are the everyday tools for fixing those things. Most of them work on both a Series and a DataFrame, so what you learn once applies in both places.

> [!info] Dataset
> - **IPL matches 2008 to 2022** (`cortex_data("ipl_matches")`) from [IPL 2008 to 2022 All Match Dataset by Sahil Vora (Kaggle)](https://www.kaggle.com/datasets/vora1011/ipl-2008-to-2021-all-match-dataset). License: [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Shipped whole.
> - **IPL career runs per batter, 2008 to 2022** (`cortex_data("ipl_batter_runs")`) from the same source. License: [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Derived: batsman_run summed per batter over every delivery.
> - **Fictional film catalogue** (`cortex_data("films")`): synthetic data generated for Cortex, not real records. License: [MIT](https://github.com/Ayaz-Mohammed-Khan/cortex/blob/main/LICENSE).
>
> Full credits and license terms: [dataset licenses (Markdown file)](/datasets/LICENSES.md).

The film catalogue is generated and fictional, so its results are not real findings. Cricket results describe the matches in the file.

---

## value_counts

`value_counts()` counts how often each distinct value occurs, largest first. On a Series it counts values. On a DataFrame it counts each distinct **combination of row values**.

```python
import pandas as pd

loans = pd.DataFrame({
    "branch": ["north", "south", "north", "north", "south", "east"],
    "genre": ["sci-fi", "history", "sci-fi", "poetry", "history", "sci-fi"],
})
print(loans["branch"].value_counts())
loans.value_counts()
```

```text
branch
north    3
south    2
east     1
Name: count, dtype: int64
branch  genre  
south   history    2
north   sci-fi     2
        poetry     1
east    sci-fi     1
Name: count, dtype: int64
```

The `~` operator negates a boolean mask. In the match table, `MatchNumber` holds a number for league games and a name (such as `Final`) for playoffs. `str.isdigit()` is true for numbers, so its negation keeps the playoffs.

```python
import pandas as pd

m = cortex_data("ipl_matches")
playoffs = m[~m["MatchNumber"].str.isdigit()]
print(playoffs.shape[0])
playoffs["Venue"].value_counts().head(3)
```

```text
58
Venue
Wankhede Stadium         9
Eden Gardens             6
M Chinnaswamy Stadium    6
Name: count, dtype: int64
```

`value_counts` pairs naturally with a pie chart for shares.

```python
import matplotlib.pyplot as plt

m = cortex_data("ipl_matches")
m["WonBy"].value_counts().plot(kind="pie", title="How matches were won")
plt.ylabel("")
plt.show()
```

Two `value_counts` Series **align by index** when you add them, so labels match up rather than positions. Adding the number of matches each team won to the number of tosses it won, for example, lines both up by team name. A label present in only one Series becomes `NaN` unless you use `add(..., fill_value=0)`.

```python
import pandas as pd

m = cortex_data("ipl_matches")
tosses = m["TossWinner"].value_counts()
wins = m["WinningTeam"].value_counts()
both = tosses.add(wins, fill_value=0)
both.sort_values(ascending=False).head(4)
```

```text
Mumbai Indians                 254
Chennai Super Kings            230
Kolkata Knight Riders          228
Royal Challengers Bangalore    214
Name: count, dtype: int64
```

---

## sort & sort_values

`sort_values` orders by the data. On a Series it needs no argument. On a DataFrame, `by` names the column.

```python
import pandas as pd

films = cortex_data("films")
films.sort_values("runtime_min", ascending=False)[["title", "runtime_min"]].head(3)
```

```text
                   title  runtime_min
22     The Tide of Seoul          183
281        Hidden Season          177
659  The Final Satellite          176
```

Missing values go last by default. `na_position="first"` puts them at the top. `inplace=True` modifies the table and returns `None`, which is rarely worth the risk.

```python
import numpy as np
import pandas as pd

scores = pd.DataFrame({"name": ["Ava", "Ben", "Cho", "Dev"],
                       "score": [72.0, np.nan, 88.0, 65.0]})
print(scores.sort_values("score"))
print(scores.sort_values("score", na_position="first"))
```

```text
  name  score
3  Dev   65.0
0  Ava   72.0
2  Cho   88.0
1  Ben    NaN
  name  score
1  Ben    NaN
3  Dev   65.0
0  Ava   72.0
2  Cho   88.0
```

To sort by several columns, pass a list of columns and a matching list of `ascending` flags. The first column decides the main order, and later columns break ties.

```python
import pandas as pd

films = cortex_data("films")
films.sort_values(["certificate", "rating"], ascending=[True, False])[
    ["title", "certificate", "rating"]
].head(4)
```

```text
                   title certificate  rating
197              Bridges           A     8.9
558       Falling Season           A     8.8
691  Midnight Lighthouse           A     8.7
232     The Paper Market           A     8.4
```

---

## Ranking rows with rank

`rank()` replaces each value with its position in the sorted order, so the smallest value gets rank 1. When values tie, the default `method="average"` gives each tied item the average of the ranks they span (so ties produce ranks such as 2.5). `method="min"` gives every tied item the lowest rank, and `pct=True` returns the rank as a fraction of the group.

```python
import pandas as pd

runs = cortex_data("ipl_batter_runs")
r = runs[runs["batsman_run"].between(1, 4) & runs["batter"].str.startswith("A ")].copy()
r["rank_avg"] = r["batsman_run"].rank()
r["rank_min"] = r["batsman_run"].rank(method="min")
r["pct"] = r["batsman_run"].rank(pct=True).round(2)
r
```

```text
         batter  batsman_run  rank_avg  rank_min  pct
2    A Chandila            4       3.5       2.0  0.7
5   A Dananjaya            4       3.5       2.0  0.7
14      A Singh            2       1.0       1.0  0.2
16      A Tomar            4       3.5       2.0  0.7
17     A Uniyal            4       3.5       2.0  0.7
```

Pass `ascending=False` to give the largest value rank 1.

---

## Sorting by labels with sort_index

`sort_index()` orders by the index instead of the values, on a Series or a DataFrame. It also takes `ascending=False`.

```python
import pandas as pd

marks = pd.Series({"cy": 71, "ana": 88, "ben": 64})
print(marks.sort_index())

films = cortex_data("films", index_col="title")
films[["year"]].sort_index(ascending=False).head(3)
```

```text
ana    88
ben    64
cy     71
dtype: int64
                year
title               
Winter Verdict  2010
Winter Shadow   2022
Winter Rooftop  2018
```

---

## index & reset_index

`set_index("col")` moves a column into the index. `reset_index()` does the opposite: it moves the index back into a regular column and restores the default 0, 1, 2 numbering. With `drop=True` the old index is discarded instead of kept as a column.

```python
import pandas as pd

runs = cortex_data("ipl_batter_runs").head(4)
by_name = runs.set_index("batter")
print(by_name)
print(by_name.reset_index())
print(by_name.reset_index(drop=True))
```

```text
                batsman_run
batter                     
A Ashish Reddy          280
A Badoni                161
A Chandila                4
A Chopra                 53
           batter  batsman_run
0  A Ashish Reddy          280
1        A Badoni          161
2      A Chandila            4
3        A Chopra           53
   batsman_run
0          280
1          161
2            4
3           53
```

### Replacing the index without losing a column

`set_index` on a table that already has a meaningful index throws that index away. To swap one index for another and keep the old one as a column, reset first, then set.

```python
import pandas as pd

t = pd.DataFrame({"code": ["a1", "b2", "c3"], "qty": [5, 9, 2]},
                 index=["north", "south", "east"])
t.rename_axis("region").reset_index().set_index("code")
```

```text
     region  qty
code            
a1    north    5
b2    south    9
c3     east    2
```

### Turning a Series into a DataFrame

`reset_index()` on a Series returns a DataFrame with the index as one column and the values as another. It is the standard step after `value_counts` or a group result when you want a regular table.

```python
import pandas as pd

m = cortex_data("ipl_matches")
counts = m["TossDecision"].value_counts()
counts.reset_index()
```

```text
  TossDecision  count
0        field    599
1          bat    351
```

---

## Renaming with rename

`rename` takes a dictionary of old label to new label. Use `columns=` for column names and `index=` for row labels. It returns a new object.

```python
import pandas as pd

films = cortex_data("films", index_col="title")
small = films[["runtime_min", "rating"]].head(3)
small.rename(columns={"runtime_min": "minutes"},
             index={"The Borrowed Satellite": "Satellite"})
```

```text
                           minutes  rating
title                                     
The Rooftop of the Border       97     6.0
Satellite                      115     5.8
The Golden Shadow              139     7.0
```

---

## unique and nunique

`unique()` returns the distinct values as an array, including `NaN` if present. `nunique()` counts the distinct values and **excludes** `NaN` unless you pass `dropna=False`.

```python
import numpy as np
import pandas as pd

s = pd.Series([4, 7, 4, np.nan, 9, 7])
print(s.unique())
print(s.nunique(), s.nunique(dropna=False), len(s.unique()))

m = cortex_data("ipl_matches")
print(m["City"].nunique(), m["Venue"].nunique())
```

```text
[ 4.  7. nan  9.]
3 4 4
33 49
```

---

## isnull

`isnull()` returns a boolean mask that is `True` where a value is missing, and `notnull()` is its opposite. Both work on Series and DataFrames. The Series attribute `hasnans` answers "is anything missing at all".

```python
import numpy as np
import pandas as pd

loans = pd.DataFrame({
    "member": ["Ira", "Jon", None, "Kai"],
    "days": [14.0, np.nan, 7.0, 21.0],
    "fine": [0.0, 2.5, np.nan, np.nan],
})
print(loans.isnull())
print(loans["days"].hasnans)
loans[loans["member"].notnull()]
```

```text
   member   days   fine
0   False  False  False
1   False   True  False
2    True  False   True
3   False  False   True
True
  member  days  fine
0    Ira  14.0   0.0
1    Jon   NaN   2.5
3    Kai  21.0   NaN
```

Because `True` counts as 1, `loans.isnull().sum()` gives the number of gaps per column.

---

## dropna & fillna

Two strategies handle missing data: remove the gaps or fill them. Which one is right depends on how much data you can afford to lose and whether a sensible replacement exists.

### Dropping missing values

`dropna()` removes rows that contain gaps. On a DataFrame, `how="any"` (the default) drops a row if any value is missing, and `how="all"` drops it only if every value is missing. `subset=[...]` limits the check to chosen columns.

```python
import numpy as np
import pandas as pd

loans = pd.DataFrame({
    "member": ["Ira", "Jon", None, "Kai", None],
    "days": [14.0, np.nan, 7.0, 21.0, np.nan],
    "fine": [0.0, 2.5, np.nan, np.nan, np.nan],
})
print(loans.dropna().shape[0])
print(loans.dropna(how="all").shape[0])
print(loans.dropna(subset=["days"]).shape[0])
loans.dropna(subset=["member", "days"])
```

```text
1
4
3
  member  days  fine
0    Ira  14.0   0.0
3    Kai  21.0   NaN
```

### Filling missing values

`fillna` replaces gaps with a value, a different value per column (using a dictionary), or a statistic such as the mean. Filling a whole table with `0` is usually wrong, because a zero in a column such as "days" would be read as real data.

```python
import numpy as np
import pandas as pd

loans = pd.DataFrame({
    "member": ["Ira", "Jon", None, "Kai"],
    "days": [14.0, np.nan, 7.0, 21.0],
    "fine": [0.0, 2.5, np.nan, np.nan],
})
filled = loans.fillna({"member": "unknown", "days": loans["days"].mean(), "fine": 0})
filled
```

```text
    member  days  fine
0      Ira  14.0   0.0
1      Jon  14.0   2.5
2  unknown   7.0   0.0
3      Kai  21.0   0.0
```

**Forward fill** copies the last seen value into a gap, and **backward fill** copies the next one. They suit ordered data such as readings over time.

```python
import numpy as np
import pandas as pd

reading = pd.Series([20.1, np.nan, np.nan, 22.4, np.nan])
print(reading.ffill())
print(reading.bfill())
```

```text
0    20.1
1    20.1
2    20.1
3    22.4
4    22.4
dtype: float64
0    20.1
1    22.4
2    22.4
3    22.4
4     NaN
dtype: float64
```

> [!note] The old method argument
> Older code writes `fillna(method="ffill")`. That form is deprecated, so call `.ffill()` and `.bfill()` directly.

---

## drop_duplicates

`duplicated()` marks repeated rows and `drop_duplicates()` removes them. On a DataFrame, `subset` limits the comparison to chosen columns and `keep` picks the surviving row (`"first"`, `"last"`, or `False` to drop every copy).

```python
import pandas as pd

visits = pd.DataFrame({
    "user": ["u1", "u2", "u1", "u3", "u2"],
    "page": ["home", "home", "docs", "home", "home"],
})
print(visits.duplicated().sum())
print(visits.drop_duplicates(subset=["user"]))
visits.drop_duplicates(subset=["user"], keep="last")
```

```text
1
  user  page
0   u1  home
1   u2  home
3   u3  home
  user  page
2   u1  docs
3   u3  home
4   u2  home
```

Sorting first and then dropping duplicates is a common way to keep the "latest" or "best" row per key. The next example finds, for each venue, the most recent match in which a chosen player appeared. The two squad columns hold text, so the example joins them and tests for the name inside.

```python
import pandas as pd

m = cortex_data("ipl_matches")
m["squads"] = m["Team1Players"] + m["Team2Players"]

def played(row, name):
    return name in row["squads"]

hit = m[m.apply(played, axis=1, name="MS Dhoni")]
latest = hit.sort_values("Date", ascending=False).drop_duplicates(subset=["Venue"], keep="first")
latest[["Venue", "Date"]].head(4)
```

```text
                                            Venue        Date
6                       Brabourne Stadium, Mumbai  2022-05-20
12                       Wankhede Stadium, Mumbai  2022-05-15
19             Dr DY Patil Sports Academy, Mumbai  2022-05-08
25  Maharashtra Cricket Association Stadium, Pune  2022-05-04
```

---

## Removing rows and columns with drop

`drop` removes by label. Use `index=[...]` for rows and `columns=[...]` for columns. After a `set_index`, the row labels are the new index values, so drop by those labels; on a default index, the labels are the numbers 0, 1, 2.

```python
import pandas as pd

s = pd.Series([10, 20, 30, 40], index=["w", "x", "y", "z"])
print(s.drop(index=["x", "z"]))

t = pd.DataFrame({"name": ["Ana", "Ben", "Cy"], "age": [31, 25, 40], "city": ["Rome", "Oslo", "Lima"]})
print(t.drop(columns=["city"]))
print(t.drop(index=[0, 2]))
print(t.set_index("name").drop(index=["Ben"]))
```

```text
w    10
y    30
dtype: int64
  name  age
0  Ana   31
1  Ben   25
2   Cy   40
  name  age  city
1  Ben   25  Oslo
      age  city
name           
Ana    31  Rome
Cy     40  Lima
```

---

## apply

`apply(func)` on a Series calls the function once per value. Use it for logic that has no built-in method, such as the **sigmoid** function, which squashes any number into the range between 0 and 1:

$$
\sigma(x) = \frac{1}{1 + e^{-x}}
$$

where $x$ is the input and $e$ is Euler's number. Write the denominator with parentheses. Without them, Python's precedence rules compute `1 / 1` first and then add `np.exp(-x)`, which is a different formula.

```python
import numpy as np
import pandas as pd

x = pd.Series([-2.0, 0.0, 2.0])
wrong = x.apply(lambda v: 1 / 1 + np.exp(-v))
right = x.apply(lambda v: 1 / (1 + np.exp(-v)))
print(wrong.round(3).tolist())
print(right.round(3).tolist())
```

```text
[8.389, 2.0, 1.135]
[0.119, 0.5, 0.881]
```

> [!warning] Operator precedence
> Division binds tighter than addition, so `1 / 1 + np.exp(-v)` means `(1 / 1) + np.exp(-v)`. The values it returns look plausible, which makes the mistake easy to miss. Always check a formula on a few inputs you can compute by hand.

### Row-wise apply with axis=1

On a DataFrame, `apply(func, axis=1)` passes each **row** to the function as a Series, so it can read several columns at once. This turns the margin and unit of a result into a readable label.

```python
import pandas as pd

m = cortex_data("ipl_matches")
close = m[m["WonBy"].isin(["Runs", "Wickets"])].head(4).copy()

def describe(row):
    unit = "run" if row["WonBy"] == "Runs" else "wicket"
    n = int(row["Margin"])
    return f"{row['WinningTeam']} by {n} {unit}{'' if n == 1 else 's'}"

close["result"] = close.apply(describe, axis=1)
close[["Season", "result"]]
```

```text
  Season                                  result
0   2022             Gujarat Titans by 7 wickets
1   2022           Rajasthan Royals by 7 wickets
2   2022  Royal Challengers Bangalore by 14 runs
3   2022             Gujarat Titans by 7 wickets
```

Row-wise `apply` is flexible but slower than vectorized column math, so reach for it only when a column expression cannot express the rule.

---

## More useful methods

> [!tip] Placing a column
> `insert(position, name, values)` adds a column at a chosen position instead of the end; [[Pandas DataFrame]] shows it in use.

### Filtering with isin

`isin` keeps rows whose value appears in a list. It reads better than a chain of `|` comparisons.

```python
import pandas as pd

films = cortex_data("films")
films[films["certificate"].isin(["PG-13", "R"])].shape[0]
```

```text
269
```

### Correlation with corr

`corr()` computes pairwise correlation between numeric columns, from -1 (move in opposite directions) to 1 (move together). Pass `numeric_only=True` so text columns are skipped.

```python
import pandas as pd

films = cortex_data("films")
films[["rating", "metascore", "votes", "runtime_min"]].corr(numeric_only=True).round(2)
```

```text
             rating  metascore  votes  runtime_min
rating         1.00       0.73   0.19        -0.01
metascore      0.73       1.00   0.14         0.03
votes          0.19       0.14   1.00        -0.00
runtime_min   -0.01       0.03  -0.00         1.00
```

### Top and bottom rows with nlargest and nsmallest

`nlargest(n, column)` and `nsmallest(n, column)` return the rows with the biggest or smallest values, without sorting the whole table.

```python
import pandas as pd

films = cortex_data("films")
print(films.nlargest(3, "votes")[["title", "votes"]])
print(films.nsmallest(3, "runtime_min")[["title", "runtime_min"]])
```

```text
                     title    votes
755  The Lighthouse of Goa  2456726
799          Bright Melody  2446749
859              Festivals  2329649
                              title  runtime_min
19   A Monsoon for the Paper Letter           78
74       The Courtyard of the Hills           78
142            The Canvas of Bombay           78
```

### Independent copies with copy

`copy()` returns an independent object. Editing the copy leaves the original unchanged, which is the safe way to experiment with a slice.

```python
import pandas as pd

a = pd.DataFrame({"x": [1, 2, 3]})
b = a.copy()
b.loc[0, "x"] = 99
print(a["x"].tolist(), b["x"].tolist())
```

```text
[1, 2, 3] [99, 2, 3]
```

---

## Summary

1. `value_counts` counts values on a Series and distinct rows on a DataFrame; Series with matching labels add by index, and `fill_value` covers labels that appear on one side only.
2. `sort_values` orders by data (`by`, `ascending`, `na_position`, and a list for several columns), and `sort_index` orders by labels.
3. `rank` converts values to positions; ties average by default, `method="min"` takes the lowest, and `pct=True` gives a fraction.
4. `set_index` and `reset_index` move data between columns and the index; `reset_index().set_index(...)` swaps indexes without losing a column, and `reset_index` on a Series makes a DataFrame.
5. `rename` relabels columns or rows through a dictionary.
6. `unique` keeps `NaN`; `nunique` skips it unless `dropna=False`.
7. `isnull`, `notnull`, and `hasnans` find gaps; `dropna` (`how`, `subset`) removes them; `fillna`, `ffill`, and `bfill` fill them.
8. `drop_duplicates` (`subset`, `keep`) removes repeats, and sorting first controls which row survives.
9. `drop` removes rows by `index=` and columns by `columns=`.
10. `apply` runs custom logic per value, and `axis=1` runs it per row; mind operator precedence in formulas.
11. `isin`, `corr`, `nlargest`, `nsmallest`, and `copy` round out the toolkit.

---

> [!info] Continues to
> Next is [[GroupBy]], which splits a table into groups, summarizes each, and combines the results.

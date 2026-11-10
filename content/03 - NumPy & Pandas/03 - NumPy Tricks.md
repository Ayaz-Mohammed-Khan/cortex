---
tags:
  - numpy
  - array-manipulation
  - utilities
aliases:
  - NumPy Tricks
  - NumPy Functions
difficulty: intermediate
runnable: true
prerequisites:
  - Advanced NumPy
created: 2026-10-13
---

> [!info] Where this fits
> This builds on [[Advanced NumPy]], where you learned to index, filter, and broadcast arrays. Here you collect the lesser-known utility functions that turn a ten-line loop into one call: sorting, searching, cumulative totals, percentiles, set operations, and in-place edits. From here you continue to [[Pandas Series]], which is built on top of these same functions.

NumPy ships hundreds of functions, and most people know only a handful. Each function below replaces custom code you would otherwise write with loops and counters, so knowing it exists makes you faster and your code shorter. Treat this note as a reference toolkit: every section gives the intuition, a small table or list of options, and one self-contained example you can edit and rerun.

Most examples share two fixed arrays, so the outputs stay reproducible. `v` is a 1D array of 15 integers and `g` is a 2D array of shape `(6, 4)`.

```python
# cortex:norun
import numpy as np

v = np.array([64, 17, 82, 45, 9, 73, 31, 58, 96, 24, 67, 13, 50, 88, 39])
g = np.array([[27, 64, 41,  8],
              [90, 35, 72, 19],
              [53, 86, 12, 47],
              [31, 60, 95, 22],
              [78,  4, 69, 38],
              [14, 57, 83, 26]])
```

> [!note] Temporary versus permanent operations
> Most functions here return a **new array** and leave the input untouched, so you see the result as output. A few, such as `np.put`, edit the existing array **in place** and return `None`, so nothing prints. If a call shows no output, check whether it changed the original array instead.

---

## Sort and append arrays

**`np.sort`** returns a sorted copy of an array in ascending order. Python's built-in `sorted` can sort an array too, but it returns a Python list; `np.sort` keeps the result as a NumPy array, ready for further vectorized work.

| Argument | Effect |
| :--- | :--- |
| `axis=-1` (default) | Sort along the last axis, so each row of a 2D array is sorted on its own. |
| `axis=0` | Sort down the rows, so each column is sorted on its own. |
| `kind` | Choose the algorithm: `'quicksort'` (default), `'mergesort'`, `'heapsort'`, or `'stable'`. |

There is no `reverse=True` parameter. For descending order, sort and then reverse with the slice `[::-1]`.

```python
import numpy as np

v = np.array([64, 17, 82, 45, 9, 73, 31, 58, 96, 24, 67, 13, 50, 88, 39])
print(np.sort(v))
print(np.sort(v)[::-1])
```

```text
[ 9 13 17 24 31 39 45 50 58 64 67 73 82 88 96]
[96 88 82 73 67 64 58 50 45 39 31 24 17 13  9]
```

On a 2D array, `axis` decides the direction. With `axis=0` every column is sorted from top to bottom independently, so rows no longer stay together.

```python
import numpy as np

g = np.array([[27, 64, 41,  8],
              [90, 35, 72, 19],
              [53, 86, 12, 47],
              [31, 60, 95, 22],
              [78,  4, 69, 38],
              [14, 57, 83, 26]])
np.sort(g, axis=0)
```

```text
array([[14,  4, 12,  8],
       [27, 35, 41, 19],
       [31, 57, 69, 22],
       [53, 60, 72, 26],
       [78, 64, 83, 38],
       [90, 86, 95, 47]])
```

Leave out `axis` and each row is sorted instead: the first row becomes `[ 8, 27, 41, 64]`.

**`np.append`** adds values at the end of an array, like `list.append`, but returns a new array.

```python
import numpy as np

v = np.array([64, 17, 82, 45, 9, 73, 31, 58, 96, 24, 67, 13, 50, 88, 39])
np.append(v, 150)
```

```text
array([ 64,  17,  82,  45,   9,  73,  31,  58,  96,  24,  67,  13,  50,
        88,  39, 150])
```

To add a column to a 2D array, pass a block with one column per row and set `axis=1`. Without `axis`, `np.append` flattens both inputs to 1D first and tacks the new values onto the end, which is rarely what you want.

```python
import numpy as np

g = np.array([[27, 64, 41,  8],
              [90, 35, 72, 19],
              [53, 86, 12, 47],
              [31, 60, 95, 22],
              [78,  4, 69, 38],
              [14, 57, 83, 26]])
# a new column of 0.5, one value per row
np.append(g, np.full((g.shape[0], 1), 0.5), axis=1)
```

```text
array([[27. , 64. , 41. ,  8. ,  0.5],
       [90. , 35. , 72. , 19. ,  0.5],
       [53. , 86. , 12. , 47. ,  0.5],
       [31. , 60. , 95. , 22. ,  0.5],
       [78. ,  4. , 69. , 38. ,  0.5],
       [14. , 57. , 83. , 26. ,  0.5]])
```

The result is a float array because the new column holds floats, and an array holds one `dtype`. Swap `np.full` for `np.random.random((g.shape[0], 1))` to append a column of random values instead.

---

## Concatenate arrays

**`np.concatenate`** joins a sequence of arrays along an existing axis. Pass the arrays as a tuple, as many as you like, and pick the axis.

- `axis=0` joins top to bottom, adding rows. It does the job of `np.vstack`.
- `axis=1` joins side by side, adding columns. It does the job of `np.hstack`.

```python
import numpy as np

p = np.array([[3, 1, 4], [1, 5, 9]])
q = np.array([[2, 6, 5], [3, 5, 8]])
print(np.concatenate((p, q), axis=0))
print(np.concatenate((p, q), axis=1))
```

```text
[[3 1 4]
 [1 5 9]
 [2 6 5]
 [3 5 8]]
[[3 1 4 2 6 5]
 [1 5 9 3 5 8]]
```

Because one function covers both directions, practitioners tend to prefer `np.concatenate` over the stacking functions from [[NumPy Fundamentals]]. The arrays must match on every axis except the one you join along.

---

## Selecting and replacing with np.where

**`np.where`** answers two questions, depending on how many arguments you give it.

| Call | Returns |
| :--- | :--- |
| `np.where(condition)` | The index positions where the condition is `True`, as a tuple with one array per axis. |
| `np.where(condition, x, y)` | A new array that takes `x` where the condition is `True` and `y` where it is `False`. |

With one argument it finds positions. Here it reports where the values fall below 20.

```python
import numpy as np

v = np.array([64, 17, 82, 45, 9, 73, 31, 58, 96, 24, 67, 13, 50, 88, 39])
np.where(v < 20)
```

```text
(array([ 1,  4, 11]),)
```

With three arguments it becomes a vectorized if-else. Read `np.where(v >= 60, 60, v)` as "if the value is 60 or more, use 60, otherwise keep the value from `v`".

```python
import numpy as np

v = np.array([64, 17, 82, 45, 9, 73, 31, 58, 96, 24, 67, 13, 50, 88, 39])
# cap every value at 60
print(np.where(v >= 60, 60, v))
# keep the even values and mark the odd ones with -1
print(np.where(v % 2 == 0, v, -1))
```

```text
[60 17 60 45  9 60 31 58 60 24 60 13 50 60 39]
[64 -1 82 -1 -1 -1 -1 58 96 24 -1 -1 50 88 -1]
```

> [!tip] np.where versus a boolean mask
> A boolean mask such as `v[v >= 60]` keeps only the matching values, so the result is shorter. `np.where(v >= 60, 60, v)` keeps every position and swaps values, so the result has the same shape as `v`. Choose the mask to filter and `np.where` to transform. Both `x` and `y` can be arrays, so the same pattern builds complex rules in one line.

---

## Finding extremes

**`np.argmax`** returns the **index** of the largest element, not the element itself. **`np.argmin`** does the same for the smallest. "Arg" is short for argument: the position that produces the maximum. Without these you would find the maximum, then loop to locate it.

```python
import numpy as np

v = np.array([64, 17, 82, 45, 9, 73, 31, 58, 96, 24, 67, 13, 50, 88, 39])
print(np.argmax(v))     # position of the largest value
print(v[np.argmax(v)])  # the largest value itself
print(np.argmin(v))     # position of the smallest value
```

```text
8
96
4
```

On a 2D array, `axis` gives one index per column or per row.

- `axis=0` searches down each column and returns the row index of each column's maximum.
- `axis=1` searches across each row and returns the column index of each row's maximum.

```python
import numpy as np

g = np.array([[27, 64, 41,  8],
              [90, 35, 72, 19],
              [53, 86, 12, 47],
              [31, 60, 95, 22],
              [78,  4, 69, 38],
              [14, 57, 83, 26]])
print(np.argmax(g, axis=0))
print(np.argmax(g, axis=1))
```

```text
[1 2 3 2]
[1 0 1 2 0 2]
```

In practice you reach for `argmax` and `argmin` most often on a single column of data, to answer "which record holds the highest value". In classification, `np.argmax` over a row of class probabilities gives the predicted class.

> [!warning] Axis numbering flips in pandas
> In NumPy, `axis=0` works down the rows (one result per column) and `axis=1` works across the columns (one result per row). Pandas describes some operations the other way around, which is a common source of confusion. When in doubt, run both and check the output shape.

---

## Cumulative functions

A **cumulative sum** replaces each element with the running total up to and including that position. If you deposit 120, 80, 0, 45, 200, and 15 into a savings jar over six weeks, the cumulative sum is the balance at the end of each week. Daily sales, steps walked, and other running totals work the same way.

```python
import numpy as np

deposits = np.array([120, 80, 0, 45, 200, 15])
np.cumsum(deposits)
```

```text
array([120, 200, 200, 245, 445, 460])
```

**`np.cumsum`** computes it in one call. On a 2D array, `axis=1` runs the total across each row and `axis=0` runs it down each column. With no `axis`, NumPy flattens the array to 1D first and runs one total over every element.

```python
import numpy as np

g = np.array([[27, 64, 41,  8],
              [90, 35, 72, 19],
              [53, 86, 12, 47],
              [31, 60, 95, 22],
              [78,  4, 69, 38],
              [14, 57, 83, 26]])
print(np.cumsum(g, axis=1))
print(np.cumsum(g))
```

```text
[[ 27  91 132 140]
 [ 90 125 197 216]
 [ 53 139 151 198]
 [ 31  91 186 208]
 [ 78  82 151 189]
 [ 14  71 154 180]]
[  27   91  132  140  230  265  337  356  409  495  507  554  585  645
  740  762  840  844  913  951  965 1022 1105 1131]
```

**`np.cumprod`** is the same idea with multiplication: each element becomes the product of everything up to it. Compounding growth is the classic use. Four yearly growth factors of 1.10, 1.05, 0.98, and 1.20 multiply into the value of one unit invested at the start, after each year.

```python
import numpy as np

factors = np.array([1.10, 1.05, 0.98, 1.20])
np.cumprod(factors)
```

```text
array([1.1    , 1.155  , 1.1319 , 1.35828])
```

Running products grow fast, and an integer array has a fixed size. Multiplying the whole numbers from 10 to 30 passes the limit of a 64-bit integer at the element for 25, wraps around, and soon turns negative. The example pins `dtype=np.int64` so the result is the same on every platform; the browser runtime defaults to 32-bit integers and would overflow sooner.

```python
import numpy as np

np.cumprod(np.arange(10, 31, dtype=np.int64))
```

```text
array([                  10,                  110,                 1320,
                      17160,               240240,              3603600,
                   57657600,            980179200,          17643225600,
               335221286400,        6704425728000,      140792940288000,
           3097444686336000,    71241227785728000,  1709789466857472000,
        5851248524017696768,  4558509034783703040, -6047464576806879232,
       -3308311487206653952, -3707312760445206528,  -538918371098886144])
```

> [!warning]
> NumPy integer overflow is silent: no error, only wrong numbers. Convert to floats with `arr.astype(float)` before a long running product, or work in logarithms.

---

## Percentiles

The **percentile** of a value tells you what percentage of the data sits below it. A score at the 99th percentile in an exam beats 99% of the candidates. For a value $x$ in a dataset,

$$
P = \frac{n}{N} \times 100
$$

where $n$ is the number of values below $x$ and $N$ is the total number of values. Three percentiles have fixed meanings:

- The **0th percentile** is the minimum.
- The **50th percentile** is the **median**, the middle value.
- The **100th percentile** is the maximum, since nothing lies above it.

**`np.percentile(v, q)`** goes the other way: given a percentage `q`, it returns the value at that percentile.

```python
import numpy as np

v = np.array([64, 17, 82, 45, 9, 73, 31, 58, 96, 24, 67, 13, 50, 88, 39])
print(np.percentile(v, 0))
print(np.percentile(v, 50))
print(np.median(v))
print(np.percentile(v, 100))
print(np.percentile(v, [25, 75]))
```

```text
9.0
50.0
50.0
96.0
[27.5 70. ]
```

The 25th percentile, 27.5, is not in the data. When the requested position falls between two sorted values (here 24 and 31), NumPy interpolates linearly between them. The 25th and 75th percentiles are the first and third **quartiles**; their gap is the **interquartile range**, the core of the five-number summary and the box plot you meet in statistics. Percentiles also set the bounds for clipping outliers, covered under clipping values below.

---

## Histograms

A **histogram** is a frequency count over ranges. You split the number line into **bins**, such as 0 to 25, 25 to 50, and so on, then count how many values fall into each bin. Drawn as bars, the counts show the shape of the distribution.

**`np.histogram`** does the counting, not the drawing. Pass the bin edges with `bins`, and it returns two arrays: the count in each bin and the edges themselves.

```python
import numpy as np

v = np.array([64, 17, 82, 45, 9, 73, 31, 58, 96, 24, 67, 13, 50, 88, 39])
counts, edges = np.histogram(v, bins=[0, 25, 50, 75, 100])
print(counts)
print(edges)
```

```text
[4 3 5 3]
[  0  25  50  75 100]
```

Read it pairwise: four values (9, 13, 17, and 24) lie in the 0 to 25 bin, three (31, 39, and 45) in 25 to 50, and so on. Each bin includes its left edge and excludes its right edge, except the last bin, which includes both, so the 50 lands in the 50 to 75 bin. Wider bins give a coarser picture: `bins=[0, 50, 100]` returns counts `[7, 8]`. Hand `counts` and `edges` to a plotting library to draw the bars.

---

## Correlation

The **correlation coefficient** measures how strongly two quantities move together, on a scale from -1 to 1.

| Value | Meaning |
| :--- | :--- |
| 1 | Perfect positive correlation: when one rises, the other rises in step. |
| 0 | No linear relationship: one tells you nothing about the other. |
| -1 | Perfect negative correlation: when one rises, the other falls in step. |

**`np.corrcoef`** returns the Pearson product-moment correlation coefficients as a matrix. With two inputs you get a 2 by 2 matrix: the diagonal holds each quantity's correlation with itself, always 1, and the off-diagonal entries hold the correlation between the two.

```python
import numpy as np

hours = np.array([2, 4, 5, 7, 9])
marks = np.array([52, 60, 68, 79, 91])
np.corrcoef(hours, marks)
```

```text
array([[1.        , 0.99667797],
       [0.99667797, 1.        ]])
```

Here study hours and exam marks have a very strong positive correlation of about 0.997: more hours go with higher marks almost in lockstep. Pass three quantities and you get a 3 by 3 matrix, one row and column per quantity. Adding the number of classes each student missed shows a strong negative link.

```python
import numpy as np

hours = np.array([2, 4, 5, 7, 9])
marks = np.array([52, 60, 68, 79, 91])
missed = np.array([6, 4, 5, 1, 0])
np.corrcoef([hours, marks, missed])
```

```text
array([[ 1.        ,  0.99667797, -0.94372423],
       [ 0.99667797,  1.        , -0.93380688],
       [-0.94372423, -0.93380688,  1.        ]])
```

---

## Set functions

These functions bring the set operations from [[Tuples, Sets & Dicts]] to arrays. The advantage is that they take and return NumPy arrays, so you never convert to a Python set and back. Every result comes back sorted with duplicates removed.

**`np.unique`** returns the distinct values. It answers questions such as "how many unique customers bought a course" when the same customer appears in many rows.

```python
import numpy as np

tags = np.array([4, 4, 9, 2, 2, 2, 7, 9, 4])
np.unique(tags)
```

```text
array([2, 4, 7, 9])
```

**`np.isin`** checks many values at once. `np.isin(v, items)` returns a boolean mask that is `True` wherever an element of `v` appears in `items`. Use the mask to pull out the matches.

```python
import numpy as np

v = np.array([64, 17, 82, 45, 9, 73, 31, 58, 96, 24, 67, 13, 50, 88, 39])
items = [13, 24, 50, 64, 99]
v[np.isin(v, items)]
```

```text
array([64, 24, 13, 50])
```

The remaining functions combine two arrays.

| Function | Returns | For `s1 = [1, 3, 5, 7, 9]`, `s2 = [5, 7, 9, 11, 13]` |
| :--- | :--- | :--- |
| `np.union1d(s1, s2)` | Values in either array | `[1, 3, 5, 7, 9, 11, 13]` |
| `np.intersect1d(s1, s2)` | Values in both arrays | `[5, 7, 9]` |
| `np.setdiff1d(s2, s1)` | Values in the first array but not the second | `[11, 13]` |
| `np.setxor1d(s1, s2)` | Values in exactly one array, never in both | `[1, 3, 11, 13]` |

```python
import numpy as np

s1 = np.array([1, 3, 5, 7, 9])
s2 = np.array([5, 7, 9, 11, 13])
print(np.union1d(s1, s2))
print(np.intersect1d(s1, s2))
print(np.setdiff1d(s2, s1))
print(np.setdiff1d(s1, s2))
print(np.setxor1d(s1, s2))
```

```text
[ 1  3  5  7  9 11 13]
[5 7 9]
[11 13]
[1 3]
[ 1  3 11 13]
```

Order matters for `np.setdiff1d`: swapping the arguments swaps the answer. The difference between a union and an XOR is the common values: the union keeps `5, 7, 9` once, while the XOR drops them.

**`np.in1d`** is the older membership test, the array version of Python's `in` operator. It works like `np.isin` on 1D input and returns a mask. It is deprecated since NumPy 2.0 and raises a `DeprecationWarning`, so write `np.isin` in new code.

```python
# cortex:norun
s1[np.in1d(s1, 7)]   # array([7])
np.in1d(s1, 4)       # array([False, False, False, False, False])
```

---

## Flip arrays

**`np.flip`** reverses the order of elements along an axis and keeps the shape. On a 1D array it produces the mirror image.

```python
import numpy as np

v = np.array([64, 17, 82, 45, 9, 73, 31, 58, 96, 24, 67, 13, 50, 88, 39])
np.flip(v)
```

```text
array([39, 88, 50, 13, 67, 24, 96, 58, 31, 73,  9, 45, 82, 17, 64])
```

On a 2D array the axis decides which way it flips.

| Call | Effect on `g` |
| :--- | :--- |
| `np.flip(g)` | Reverses every axis: the rows and the columns, so the last element moves to the front. |
| `np.flip(g, axis=0)` | Reverses the row order: the bottom row comes to the top. |
| `np.flip(g, axis=1)` | Reverses each row: the last column comes first. |

```python
import numpy as np

g = np.array([[27, 64, 41,  8],
              [90, 35, 72, 19],
              [53, 86, 12, 47],
              [31, 60, 95, 22],
              [78,  4, 69, 38],
              [14, 57, 83, 26]])
np.flip(g, axis=0)
```

```text
array([[14, 57, 83, 26],
       [78,  4, 69, 38],
       [31, 60, 95, 22],
       [53, 86, 12, 47],
       [90, 35, 72, 19],
       [27, 64, 41,  8]])
```

Change `axis=0` to `axis=1` to reverse each row instead, or drop `axis` to flip both ways at once.

---

## Modifying in place

**`np.put`** replaces elements at given positions with new values. It treats the array as flattened, so the indices count across the whole array. It edits the original array **in place** and returns `None`, so print the array afterwards to see the change.

```python
import numpy as np

w = np.array([64, 17, 82, 45, 9, 73, 31, 58, 96, 24, 67, 13, 50, 88, 39])
np.put(w, [1, 4, 6], [-5, -6, -7])   # no output: w is changed in place
print(w)
```

```text
[64 -5 82 45 -6 73 -7 58 96 24 67 13 50 88 39]
```

The positions need not be next to each other; any list of indices works.

**`np.delete`** removes the elements at given indices. Unlike `np.put`, it returns a **new array** and leaves the original alone.

```python
import numpy as np

w = np.array([64, -5, 82, 45, -6, 73, -7, 58, 96, 24, 67, 13, 50, 88, 39])
print(np.delete(w, [1, 3, 5]))
print(w)  # unchanged
```

```text
[64 82 -6 -7 58 96 24 67 13 50 88 39]
[64 -5 82 45 -6 73 -7 58 96 24 67 13 50 88 39]
```

Indices 1, 3, and 5 held -5, 45, and 73, so those three are gone. To delete by condition rather than by position, use a boolean mask or `np.where`.

---

## Clipping values

**`np.clip`** limits every value to a range. Any value below `a_min` becomes `a_min`, any value above `a_max` becomes `a_max`, and values in between stay as they are.

```python
import numpy as np

v = np.array([64, 17, 82, 45, 9, 73, 31, 58, 96, 24, 67, 13, 50, 88, 39])
np.clip(v, a_min=30, a_max=70)
```

```text
array([64, 30, 70, 45, 30, 70, 31, 58, 70, 30, 67, 30, 50, 70, 39])
```

The values 82, 73, 96, and 88 drop to 70, and 17, 9, 24, and 13 rise to 30. Clipping tames outliers without deleting rows: compute bounds with `np.percentile` (for example the 1st and 99th) and clip to them. Deep learning uses the same idea to keep values, such as gradients, from growing too large.

---

## Other useful functions

These utilities come up less often, but each replaces several lines of manual code.

| Function | What it does |
| :--- | :--- |
| `np.expand_dims` | Inserts a new axis of size 1, raising the number of dimensions by one. |
| `np.swapaxes` | Exchanges two axes of an array. |
| `np.random.uniform` | Draws random floats evenly spread over a range. |
| `np.count_nonzero` | Counts the elements that are not zero, or that are `True` in a mask. |
| `np.tile` | Repeats a whole array as a block. |
| `np.repeat` | Repeats each element a given number of times. |
| `np.array_equal` and `np.allclose` | Compare whole arrays, exactly or within a tolerance. |

### Expanding dimensions

**`np.expand_dims`** adds an axis of size 1 at the position you name. A 1D array of shape `(15,)` becomes `(1, 15)` with `axis=0` (one row) or `(15, 1)` with `axis=1` (one column).

```python
import numpy as np

v = np.array([64, 17, 82, 45, 9, 73, 31, 58, 96, 24, 67, 13, 50, 88, 39])
print(v.shape)
print(np.expand_dims(v, axis=0).shape)
print(np.expand_dims(v, axis=1).shape)
```

```text
(15,)
(1, 15)
(15, 1)
```

The practical reason is batching. Most machine-learning models expect a **batch** of samples, a 2D array with one row per sample, even when you predict for one. A single house described by its floor area and bedroom count is shape `(2,)`; `np.expand_dims` turns it into a batch of one, shape `(1, 2)`. Image models do the same, adding a leading batch axis to a single image.

```python
import numpy as np

house = np.array([1200, 3])   # floor area in square feet and bedrooms
np.expand_dims(house, axis=0)
```

```text
array([[1200,    3]])
```

### Swapping axes

**`np.swapaxes(arr, axis1, axis2)`** exchanges two axes. On a 2D array, swapping axes 0 and 1 is the transpose. On higher-dimensional arrays it reorders exactly the two axes you name and leaves the rest in place.

```python
import numpy as np

s = np.arange(10, 16).reshape(2, 3)
print(np.swapaxes(s, 0, 1))
print(np.swapaxes(np.zeros((5, 2, 3)), 0, 2).shape)
```

```text
[[10 13]
 [11 14]
 [12 15]]
(3, 2, 5)
```

### Uniform random numbers

**`np.random.uniform(low, high, size)`** draws floats from the range `low` (included) to `high` (excluded), where every value is equally likely. Unlike `np.random.random`, which always uses 0 to 1, you choose the range. Setting a seed with `np.random.seed` makes the draw reproducible.

```python
import numpy as np

np.random.seed(11)
np.random.uniform(20, 30, 4)
```

```text
array([21.80269689, 20.19475241, 24.63218526, 27.24933929])
```

### Counting non-zero values

**`np.count_nonzero`** counts the elements that are not zero. Because `True` counts as 1 and `False` as 0, passing a condition counts how many elements satisfy it, with no loop and no `sum` of a list.

```python
import numpy as np

flags = np.array([1, 0, 0, 4, 0, 2, 9])
print(np.count_nonzero(flags))
v = np.array([64, 17, 82, 45, 9, 73, 31, 58, 96, 24, 67, 13, 50, 88, 39])
print(np.count_nonzero(v > 60))
```

```text
4
6
```

It also takes `axis`: `np.count_nonzero(m, axis=0)` returns one count per column of `m`.

### Tiling and repeating

**`np.tile`** and **`np.repeat`** both make an array longer by repetition, but they repeat different things.

- `np.tile(arr, reps)` repeats the **whole array** as a block, like laying tiles side by side. A tuple such as `(2, 2)` tiles in two dimensions.
- `np.repeat(arr, repeats)` repeats **each element** in turn. A list of counts repeats each element a different number of times.

```python
import numpy as np

x = np.array([7, 8])
print(np.tile(x, 3))
print(np.repeat(x, 3))
print(np.repeat(x, [3, 1]))
print(np.tile(x, (2, 2)))
```

```text
[7 8 7 8 7 8]
[7 7 7 8 8 8]
[7 7 7 8]
[[7 8 7 8]
 [7 8 7 8]]
```

### Comparing arrays

`==` and **`np.equal`** compare element by element and return a boolean array, not a single answer. To ask "are these two arrays the same", use a whole-array test.

| Function | Returns |
| :--- | :--- |
| `np.equal(x, y)` or `x == y` | A boolean array, `True` at each position where the two elements are exactly equal. |
| `np.array_equal(x, y)` | A single `True` only if both arrays have the same shape and every element is exactly equal. |
| `np.allclose(x, y)` | A single `True` only if every pair of elements is equal within a small tolerance. |

Floating-point arithmetic is not exact: `0.1 * 3` is stored as `0.30000000000000004`. An exact comparison then fails where `np.allclose` succeeds, which is why you compare computed floats with `np.allclose`.

```python
import numpy as np

x = np.array([0.1 * 3, 4.0])
y = np.array([0.3, 4.0])
print(np.equal(x, y))
print(np.array_equal(x, y))
print(np.allclose(x, y))
print(np.array_equal(np.array([5, 6]), np.array([5, 6])))
```

```text
[False  True]
False
True
True
```

---

## Summary

1. **`np.sort`** returns a sorted NumPy array (descending with `[::-1]`, per column with `axis=0`); **`np.append`** adds values at the end and needs `axis=1` to add a column instead of flattening.
2. **`np.concatenate`** joins arrays along an existing axis: `axis=0` adds rows like `np.vstack`, `axis=1` adds columns like `np.hstack`.
3. **`np.where(condition)`** returns the positions where a condition holds; **`np.where(condition, x, y)`** is a vectorized if-else that keeps the array's shape.
4. **`np.argmax`** and **`np.argmin`** return the index of the largest or smallest element, not the value; `axis` gives one index per column or row.
5. **`np.cumsum`** and **`np.cumprod`** compute running totals and products; with no `axis` they flatten first, and integer products overflow silently.
6. **`np.percentile`** returns the value below which a given percentage of the data lies; the 50th percentile equals `np.median`, and the quartiles feed the interquartile range.
7. **`np.histogram`** counts values per bin and returns the counts and the bin edges; **`np.corrcoef`** returns the Pearson correlation matrix with values from -1 to 1.
8. The set functions **`np.unique`**, **`np.isin`**, **`np.union1d`**, **`np.intersect1d`**, **`np.setdiff1d`**, and **`np.setxor1d`** work on arrays and return sorted arrays; prefer `np.isin` over the deprecated `np.in1d`.
9. **`np.flip`** reverses along an axis, or along every axis when `axis` is left out.
10. **`np.put`** edits the original array in place and returns `None`; **`np.delete`** returns a new array without the given indices.
11. **`np.clip`** limits values to a range, a quick way to tame outliers.
12. **`np.expand_dims`** adds a size-1 axis for batching, **`np.swapaxes`** exchanges two axes, **`np.random.uniform`** draws floats in a chosen range, **`np.count_nonzero`** counts non-zero or `True` entries, **`np.tile`** repeats a whole array while **`np.repeat`** repeats each element, and **`np.allclose`** compares floats within a tolerance where **`np.array_equal`** demands an exact match.

---

> [!info] Continues to
> Next, [[Pandas Series]] introduces the labelled one-dimensional structure of pandas. It is built on NumPy arrays, so `unique`, `isin`, `where`, `clip`, and the cumulative and percentile functions you met here reappear there almost unchanged.

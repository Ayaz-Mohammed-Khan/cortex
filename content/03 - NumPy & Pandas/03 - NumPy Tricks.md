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

Most examples share two fixed arrays, so the outputs stay reproducible. `a` is a 1D array of 15 integers and `b` is a 2D array of shape `(6, 4)`.

```python
# cortex:norun
import numpy as np

a = np.array([11, 53, 28, 50, 38, 37, 94, 92, 5, 30, 68, 9, 78, 2, 21])
b = np.array([[12, 52, 42,  6],
              [29, 18, 47, 55],
              [61, 93, 83,  9],
              [38, 63, 44, 85],
              [ 8, 87, 31, 72],
              [40, 71,  2,  7]])
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

a = np.array([11, 53, 28, 50, 38, 37, 94, 92, 5, 30, 68, 9, 78, 2, 21])
print(np.sort(a))
print(np.sort(a)[::-1])
```

```text
[ 2  5  9 11 21 28 30 37 38 50 53 68 78 92 94]
[94 92 78 68 53 50 38 37 30 28 21 11  9  5  2]
```

On a 2D array, `axis` decides the direction. With `axis=0` every column is sorted from top to bottom independently, so rows no longer stay together.

```python
import numpy as np

b = np.array([[12, 52, 42,  6],
              [29, 18, 47, 55],
              [61, 93, 83,  9],
              [38, 63, 44, 85],
              [ 8, 87, 31, 72],
              [40, 71,  2,  7]])
np.sort(b, axis=0)
```

```text
array([[ 8, 18,  2,  6],
       [12, 52, 31,  7],
       [29, 63, 42,  9],
       [38, 71, 44, 55],
       [40, 87, 47, 72],
       [61, 93, 83, 85]])
```

Leave out `axis` and each row is sorted instead: the first row becomes `[ 6, 12, 42, 52]`.

**`np.append`** adds values at the end of an array, like `list.append`, but returns a new array.

```python
import numpy as np

a = np.array([11, 53, 28, 50, 38, 37, 94, 92, 5, 30, 68, 9, 78, 2, 21])
np.append(a, 200)
```

```text
array([ 11,  53,  28,  50,  38,  37,  94,  92,   5,  30,  68,   9,  78,
         2,  21, 200])
```

To add a column to a 2D array, pass a block with one column per row and set `axis=1`. Without `axis`, `np.append` flattens both inputs to 1D first and tacks the new values onto the end, which is rarely what you want.

```python
import numpy as np

b = np.array([[12, 52, 42,  6],
              [29, 18, 47, 55],
              [61, 93, 83,  9],
              [38, 63, 44, 85],
              [ 8, 87, 31, 72],
              [40, 71,  2,  7]])
# a new column of ones, one value per row
np.append(b, np.ones((b.shape[0], 1)), axis=1)
```

```text
array([[12., 52., 42.,  6.,  1.],
       [29., 18., 47., 55.,  1.],
       [61., 93., 83.,  9.,  1.],
       [38., 63., 44., 85.,  1.],
       [ 8., 87., 31., 72.,  1.],
       [40., 71.,  2.,  7.,  1.]])
```

The result is a float array because `np.ones` produces floats, and an array holds one `dtype`. Swap `np.ones` for `np.random.random((b.shape[0], 1))` to append a column of random values instead.

---

## Concatenate arrays

**`np.concatenate`** joins a sequence of arrays along an existing axis. Pass the arrays as a tuple, as many as you like, and pick the axis.

- `axis=0` joins top to bottom, adding rows. It does the job of `np.vstack`.
- `axis=1` joins side by side, adding columns. It does the job of `np.hstack`.

```python
import numpy as np

c = np.arange(6).reshape(2, 3)
d = np.arange(6, 12).reshape(2, 3)
print(np.concatenate((c, d), axis=0))
print(np.concatenate((c, d), axis=1))
```

```text
[[ 0  1  2]
 [ 3  4  5]
 [ 6  7  8]
 [ 9 10 11]]
[[ 0  1  2  6  7  8]
 [ 3  4  5  9 10 11]]
```

Because one function covers both directions, practitioners tend to prefer `np.concatenate` over the stacking functions from [[NumPy Fundamentals]]. The arrays must match on every axis except the one you join along.

---

## Selecting and replacing with np.where

**`np.where`** answers two questions, depending on how many arguments you give it.

| Call | Returns |
| :--- | :--- |
| `np.where(condition)` | The index positions where the condition is `True`, as a tuple with one array per axis. |
| `np.where(condition, x, y)` | A new array that takes `x` where the condition is `True` and `y` where it is `False`. |

With one argument it finds positions. Here it reports where the values exceed 50.

```python
import numpy as np

a = np.array([11, 53, 28, 50, 38, 37, 94, 92, 5, 30, 68, 9, 78, 2, 21])
np.where(a > 50)
```

```text
(array([ 1,  6,  7, 10, 12]),)
```

With three arguments it becomes a vectorized if-else. Read `np.where(a > 50, 0, a)` as "if the value is greater than 50, use 0, otherwise keep the value from `a`".

```python
import numpy as np

a = np.array([11, 53, 28, 50, 38, 37, 94, 92, 5, 30, 68, 9, 78, 2, 21])
# replace every value greater than 50 with 0
print(np.where(a > 50, 0, a))
# replace every even value with 0
print(np.where(a % 2 == 0, 0, a))
```

```text
[11  0 28 50 38 37  0  0  5 30  0  9  0  2 21]
[11 53  0  0  0 37  0  0  5  0  0  9  0  0 21]
```

> [!tip] np.where versus a boolean mask
> A boolean mask such as `a[a > 50]` keeps only the matching values, so the result is shorter. `np.where(a > 50, 0, a)` keeps every position and swaps values, so the result has the same shape as `a`. Choose the mask to filter and `np.where` to transform. Both `x` and `y` can be arrays, so the same pattern builds complex rules in one line.

---

## Finding extremes

**`np.argmax`** returns the **index** of the largest element, not the element itself. **`np.argmin`** does the same for the smallest. "Arg" is short for argument: the position that produces the maximum. Without these you would find the maximum, then loop to locate it.

```python
import numpy as np

a = np.array([11, 53, 28, 50, 38, 37, 94, 92, 5, 30, 68, 9, 78, 2, 21])
print(np.argmax(a))     # position of the largest value
print(a[np.argmax(a)])  # the largest value itself
print(np.argmin(a))     # position of the smallest value
```

```text
6
94
13
```

On a 2D array, `axis` gives one index per column or per row.

- `axis=0` searches down each column and returns the row index of each column's maximum.
- `axis=1` searches across each row and returns the column index of each row's maximum.

```python
import numpy as np

b = np.array([[12, 52, 42,  6],
              [29, 18, 47, 55],
              [61, 93, 83,  9],
              [38, 63, 44, 85],
              [ 8, 87, 31, 72],
              [40, 71,  2,  7]])
print(np.argmax(b, axis=0))
print(np.argmax(b, axis=1))
```

```text
[2 2 2 3]
[1 3 1 3 1 1]
```

In practice you reach for `argmax` and `argmin` most often on a single column of data, to answer "which record holds the highest value". In classification, `np.argmax` over a row of class probabilities gives the predicted class.

> [!warning] Axis numbering flips in pandas
> In NumPy, `axis=0` works down the rows (one result per column) and `axis=1` works across the columns (one result per row). Pandas describes some operations the other way around, which is a common source of confusion. When in doubt, run both and check the output shape.

---

## Cumulative functions

A **cumulative sum** replaces each element with the running total up to and including that position. If a batsman scores 25, 18, 59, 61, 0, 52, and 100 runs in successive matches, the cumulative sum is the career total after each match. Daily subscriber gains, daily sales, and other running totals work the same way.

```python
import numpy as np

runs = np.array([25, 18, 59, 61, 0, 52, 100])
np.cumsum(runs)
```

```text
array([ 25,  43, 102, 163, 163, 215, 315])
```

**`np.cumsum`** computes it in one call. On a 2D array, `axis=1` runs the total across each row and `axis=0` runs it down each column. With no `axis`, NumPy flattens the array to 1D first and runs one total over every element.

```python
import numpy as np

b = np.array([[12, 52, 42,  6],
              [29, 18, 47, 55],
              [61, 93, 83,  9],
              [38, 63, 44, 85],
              [ 8, 87, 31, 72],
              [40, 71,  2,  7]])
print(np.cumsum(b, axis=1))
print(np.cumsum(b))
```

```text
[[ 12  64 106 112]
 [ 29  47  94 149]
 [ 61 154 237 246]
 [ 38 101 145 230]
 [  8  95 126 198]
 [ 40 111 113 120]]
[  12   64  106  112  141  159  206  261  322  415  498  507  545  608
  652  737  745  832  863  935  975 1046 1048 1055]
```

**`np.cumprod`** is the same idea with multiplication: each element becomes the product of everything up to it.

```python
import numpy as np

np.cumprod(np.array([1, 2, 3, 4, 5]))
```

```text
array([  1,   2,   6,  24, 120])
```

Running products grow fast, and an integer array has a fixed size. On the 15-value array `a`, the product passes the limit of a 64-bit integer by the 13th element, wraps around, and turns negative. The output below is from a platform with 64-bit default integers; the browser runtime uses 32-bit integers and overflows sooner.

```python
# cortex:norun
np.cumprod(a)
```

```text
array([                  11,                  583,                16324,
                     816200,             31015600,           1147577200,
               107872256800,        9924247625600,       49621238128000,
           1488637143840000,   101227325781120000,   911045932030080000,
       -2725393596491966464, -5450787192983932928, -3786066610405281792])
```

> [!warning]
> NumPy integer overflow is silent: no error, only wrong numbers. Convert to floats with `a.astype(float)` before a long running product, or work in logarithms.

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

**`np.percentile(a, q)`** goes the other way: given a percentage `q`, it returns the value at that percentile.

```python
import numpy as np

a = np.array([11, 53, 28, 50, 38, 37, 94, 92, 5, 30, 68, 9, 78, 2, 21])
print(np.percentile(a, 0))
print(np.percentile(a, 50))
print(np.median(a))
print(np.percentile(a, 100))
print(np.percentile(a, [25, 75]))
```

```text
2.0
37.0
37.0
94.0
[16.  60.5]
```

The 25th percentile, 16.0, is not in the data. When the requested position falls between two sorted values (here 11 and 21), NumPy interpolates linearly between them. The 25th and 75th percentiles are the first and third **quartiles**; their gap is the **interquartile range**, the core of the five-number summary and the box plot you meet in statistics. Percentiles also set the bounds for clipping outliers, covered under clipping values below.

---

## Histograms

A **histogram** is a frequency count over ranges. You split the number line into **bins**, such as 0 to 10, 10 to 20, and so on, then count how many values fall into each bin. Drawn as bars, the counts show the shape of the distribution.

**`np.histogram`** does the counting, not the drawing. Pass the bin edges with `bins`, and it returns two arrays: the count in each bin and the edges themselves.

```python
import numpy as np

a = np.array([11, 53, 28, 50, 38, 37, 94, 92, 5, 30, 68, 9, 78, 2, 21])
counts, edges = np.histogram(a, bins=[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
print(counts)
print(edges)
```

```text
[3 1 2 3 0 2 1 1 0 2]
[  0  10  20  30  40  50  60  70  80  90 100]
```

Read it pairwise: three values (2, 5, and 9) lie in the 0 to 10 bin, one (11) in 10 to 20, and so on. Each bin includes its left edge and excludes its right edge, except the last bin, which includes both. Wider bins give a coarser picture: `bins=[0, 50, 100]` returns counts `[9, 6]`. Hand `counts` and `edges` to a plotting library to draw the bars.

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

salary = np.array([20000, 40000, 25000, 35000, 60000])
experience = np.array([1, 3, 2, 4, 2])
np.corrcoef(salary, experience)
```

```text
array([[1.        , 0.25344572],
       [0.25344572, 1.        ]])
```

Here salary and experience have a weak positive correlation of about 0.25: more experience tends to come with a somewhat higher salary. Pass three quantities and you get a 3 by 3 matrix, one row and column per quantity.

---

## Set functions

These functions bring the set operations from [[Tuples, Sets & Dicts]] to arrays. The advantage is that they take and return NumPy arrays, so you never convert to a Python set and back. Every result comes back sorted with duplicates removed.

**`np.unique`** returns the distinct values. It answers questions such as "how many unique customers bought a course" when the same customer appears in many rows.

```python
import numpy as np

e = np.array([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6])
np.unique(e)
```

```text
array([1, 2, 3, 4, 5, 6])
```

**`np.isin`** checks many values at once. `np.isin(a, items)` returns a boolean mask that is `True` wherever an element of `a` appears in `items`. Use the mask to pull out the matches.

```python
import numpy as np

a = np.array([11, 53, 28, 50, 38, 37, 94, 92, 5, 30, 68, 9, 78, 2, 21])
items = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
a[np.isin(a, items)]
```

```text
array([50, 30])
```

The remaining functions combine two arrays.

| Function | Returns | For `m = [1, 2, 3, 4, 5]`, `n = [3, 4, 5, 6, 7]` |
| :--- | :--- | :--- |
| `np.union1d(m, n)` | Values in either array | `[1, 2, 3, 4, 5, 6, 7]` |
| `np.intersect1d(m, n)` | Values in both arrays | `[3, 4, 5]` |
| `np.setdiff1d(n, m)` | Values in the first array but not the second | `[6, 7]` |
| `np.setxor1d(m, n)` | Values in exactly one array, never in both | `[1, 2, 6, 7]` |

```python
import numpy as np

m = np.array([1, 2, 3, 4, 5])
n = np.array([3, 4, 5, 6, 7])
print(np.union1d(m, n))
print(np.intersect1d(m, n))
print(np.setdiff1d(n, m))
print(np.setdiff1d(m, n))
print(np.setxor1d(m, n))
```

```text
[1 2 3 4 5 6 7]
[3 4 5]
[6 7]
[1 2]
[1 2 6 7]
```

Order matters for `np.setdiff1d`: swapping the arguments swaps the answer. The difference between a union and an XOR is the common values: the union keeps `3, 4, 5` once, while the XOR drops them.

**`np.in1d`** is the older membership test, the array version of Python's `in` operator. It works like `np.isin` on 1D input and returns a mask. It is deprecated since NumPy 2.0 and raises a `DeprecationWarning`, so write `np.isin` in new code.

```python
# cortex:norun
m[np.in1d(m, 1)]   # array([1])
np.in1d(m, 10)     # array([False, False, False, False, False])
```

---

## Flip arrays

**`np.flip`** reverses the order of elements along an axis and keeps the shape. On a 1D array it produces the mirror image.

```python
import numpy as np

a = np.array([11, 53, 28, 50, 38, 37, 94, 92, 5, 30, 68, 9, 78, 2, 21])
np.flip(a)
```

```text
array([21,  2, 78,  9, 68, 30,  5, 92, 94, 37, 38, 50, 28, 53, 11])
```

On a 2D array the axis decides which way it flips.

| Call | Effect on `b` |
| :--- | :--- |
| `np.flip(b)` | Reverses every axis: the rows and the columns, so the last element moves to the front. |
| `np.flip(b, axis=0)` | Reverses the row order: the bottom row comes to the top. |
| `np.flip(b, axis=1)` | Reverses each row: the last column comes first. |

```python
import numpy as np

b = np.array([[12, 52, 42,  6],
              [29, 18, 47, 55],
              [61, 93, 83,  9],
              [38, 63, 44, 85],
              [ 8, 87, 31, 72],
              [40, 71,  2,  7]])
np.flip(b, axis=1)
```

```text
array([[ 6, 42, 52, 12],
       [55, 47, 18, 29],
       [ 9, 83, 93, 61],
       [85, 44, 63, 38],
       [72, 31, 87,  8],
       [ 7,  2, 71, 40]])
```

Change `axis=1` to `axis=0` to see the row of 40 move to the top, or drop `axis` to flip both ways at once.

---

## Modifying in place

**`np.put`** replaces elements at given positions with new values. It treats the array as flattened, so the indices count across the whole array. It edits the original array **in place** and returns `None`, so print the array afterwards to see the change.

```python
import numpy as np

a = np.array([11, 53, 28, 50, 38, 37, 94, 92, 5, 30, 68, 9, 78, 2, 21])
np.put(a, [0, 1], [110, 530])   # no output: a is changed in place
print(a)
```

```text
[110 530  28  50  38  37  94  92   5  30  68   9  78   2  21]
```

The positions need not be next to each other; any list of indices works.

**`np.delete`** removes the elements at given indices. Unlike `np.put`, it returns a **new array** and leaves the original alone.

```python
import numpy as np

a = np.array([110, 530, 28, 50, 38, 37, 94, 92, 5, 30, 68, 9, 78, 2, 21])
print(np.delete(a, [0, 2, 4]))
print(a)  # unchanged
```

```text
[530  50  37  94  92   5  30  68   9  78   2  21]
[110 530  28  50  38  37  94  92   5  30  68   9  78   2  21]
```

Indices 0, 2, and 4 held 110, 28, and 38, so those three are gone. To delete by condition rather than by position, use a boolean mask or `np.where`.

---

## Clipping values

**`np.clip`** limits every value to a range. Any value below `a_min` becomes `a_min`, any value above `a_max` becomes `a_max`, and values in between stay as they are.

```python
import numpy as np

a = np.array([110, 530, 28, 50, 38, 37, 94, 92, 5, 30, 68, 9, 78, 2, 21])
np.clip(a, a_min=25, a_max=75)
```

```text
array([75, 75, 28, 50, 38, 37, 75, 75, 25, 30, 68, 25, 75, 25, 25])
```

Both 110 and 530 drop to 75, and 5, 9, 2, and 21 rise to 25. Clipping tames outliers without deleting rows: compute bounds with `np.percentile` (for example the 1st and 99th) and clip to them. Deep learning uses the same idea to keep values, such as gradients, from growing too large.

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

a = np.array([11, 53, 28, 50, 38, 37, 94, 92, 5, 30, 68, 9, 78, 2, 21])
print(a.shape)
print(np.expand_dims(a, axis=0).shape)
print(np.expand_dims(a, axis=1).shape)
```

```text
(15,)
(1, 15)
(15, 1)
```

The practical reason is batching. Most machine-learning models expect a **batch** of samples, a 2D array with one row per sample, even when you predict for one. A single student described by IQ and marks is shape `(2,)`; `np.expand_dims` turns it into a batch of one, shape `(1, 2)`. Image models do the same, adding a leading batch axis to a single image.

```python
import numpy as np

student = np.array([110, 8.5])   # IQ and marks for one student
np.expand_dims(student, axis=0)
```

```text
array([[110. ,   8.5]])
```

### Swapping axes

**`np.swapaxes(arr, axis1, axis2)`** exchanges two axes. On a 2D array, swapping axes 0 and 1 is the transpose. On higher-dimensional arrays it reorders exactly the two axes you name and leaves the rest in place.

```python
import numpy as np

s = np.arange(6).reshape(2, 3)
print(np.swapaxes(s, 0, 1))
print(np.swapaxes(np.zeros((2, 3, 4)), 0, 2).shape)
```

```text
[[0 3]
 [1 4]
 [2 5]]
(4, 3, 2)
```

### Uniform random numbers

**`np.random.uniform(low, high, size)`** draws floats from the range `low` (included) to `high` (excluded), where every value is equally likely. Unlike `np.random.random`, which always uses 0 to 1, you choose the range. Setting a seed with `np.random.seed` makes the draw reproducible.

```python
import numpy as np

np.random.seed(0)
np.random.uniform(1, 10, 5)
```

```text
array([5.93932154, 7.4367043 , 6.42487038, 5.90394865, 4.81289319])
```

### Counting non-zero values

**`np.count_nonzero`** counts the elements that are not zero. Because `True` counts as 1 and `False` as 0, passing a condition counts how many elements satisfy it, with no loop and no `sum` of a list.

```python
import numpy as np

z = np.array([0, 3, 0, 5, 7, 0])
print(np.count_nonzero(z))
a = np.array([11, 53, 28, 50, 38, 37, 94, 92, 5, 30, 68, 9, 78, 2, 21])
print(np.count_nonzero(a > 50))
```

```text
3
5
```

It also takes `axis`: `np.count_nonzero(m, axis=0)` returns one count per column of `m`.

### Tiling and repeating

**`np.tile`** and **`np.repeat`** both make an array longer by repetition, but they repeat different things.

- `np.tile(arr, reps)` repeats the **whole array** as a block, like laying tiles side by side. A tuple such as `(2, 2)` tiles in two dimensions.
- `np.repeat(arr, repeats)` repeats **each element** in turn. A list of counts repeats each element a different number of times.

```python
import numpy as np

x = np.array([1, 2, 3])
print(np.tile(x, 3))
print(np.repeat(x, 3))
print(np.repeat(x, [1, 2, 3]))
print(np.tile(x, (2, 2)))
```

```text
[1 2 3 1 2 3 1 2 3]
[1 1 1 2 2 2 3 3 3]
[1 2 2 3 3 3]
[[1 2 3 1 2 3]
 [1 2 3 1 2 3]]
```

### Comparing arrays

`==` and **`np.equal`** compare element by element and return a boolean array, not a single answer. To ask "are these two arrays the same", use a whole-array test.

| Function | Returns |
| :--- | :--- |
| `np.equal(x, y)` or `x == y` | A boolean array, `True` at each position where the two elements are exactly equal. |
| `np.array_equal(x, y)` | A single `True` only if both arrays have the same shape and every element is exactly equal. |
| `np.allclose(x, y)` | A single `True` only if every pair of elements is equal within a small tolerance. |

Floating-point arithmetic is not exact: `0.1 + 0.2` is stored as `0.30000000000000004`. An exact comparison then fails where `np.allclose` succeeds, which is why you compare computed floats with `np.allclose`.

```python
import numpy as np

x = np.array([0.1 + 0.2, 1.0])
y = np.array([0.3, 1.0])
print(np.equal(x, y))
print(np.array_equal(x, y))
print(np.allclose(x, y))
print(np.array_equal(np.array([1, 2, 3]), np.array([1, 2, 3])))
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

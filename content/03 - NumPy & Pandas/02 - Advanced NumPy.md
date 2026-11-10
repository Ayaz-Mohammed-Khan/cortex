---
tags:
  - numpy
  - broadcasting
  - indexing
  - vectorization
aliases:
  - Advanced NumPy
  - NumPy Broadcasting
  - Fancy Indexing
difficulty: intermediate
runnable: true
prerequisites:
  - NumPy Fundamentals
created: 2026-10-13
---

> [!info] Where this fits
> This builds on [[NumPy Fundamentals]], where you learned to create, inspect, and operate on arrays. Here you move from "arrays exist" to why they are fast and how a practitioner indexes and broadcasts them: pulling arbitrary elements, filtering by condition, combining arrays of different shapes, and writing vectorized mathematical formulas. From here you continue to [[NumPy Tricks]].

The leap from a beginner to a fluent NumPy user is not more functions, it is a shift in how you think. You stop writing loops and start expressing an operation over a whole array at once. This note covers the three pillars of that style: fancy and boolean indexing to select data, broadcasting to combine arrays whose shapes differ, and vectorized formulas such as the sigmoid and mean squared error. It assumes the array creation, indexing, reshaping, and stacking from [[NumPy Fundamentals]].

---

## NumPy arrays versus Python lists

A NumPy array beats a Python list on three fronts: speed, memory, and convenience.

**Speed.** Totalling the squares of three million numbers with a Python loop is slow because the interpreter fetches, type-checks, and multiplies every element as a separate Python object. The same job on a NumPy array is one vectorized expression, `np.sum(arr * arr)`, that runs a compiled loop over contiguous memory. The array version is tens of times faster. The benchmark below is machine-dependent, so the exact seconds vary, but the ratio is the point.

```python
# cortex:norun
import numpy as np
import time

n = 3_000_000

# Python list and a loop
nums = list(range(n))
start = time.perf_counter()
total = 0
for x in nums:
    total += x * x
print(time.perf_counter() - start)
# 0.2743346691131592

# NumPy array and one expression
arr = np.arange(n, dtype=np.int64)
start = time.perf_counter()
total = int(np.sum(arr * arr))
print(time.perf_counter() - start)
# 0.008917093276977539
```

On that run the NumPy version was about 31 times faster. The gap widens as the arrays grow.

**Memory.** A list stores a table of references, and each reference points to a separate Python integer object with its own header. `sys.getsizeof` on the list counts only the reference table, so the integer objects add to it on top. A NumPy array stores the bare values in one packed block, and its `dtype` sets how many bytes each value takes.

```python
import sys
import numpy as np

n = 1_000_000
nums = list(range(n))

print(sys.getsizeof(nums))       # the reference table alone
print(sys.getsizeof(nums[-1]))   # one integer object
print(np.arange(n, dtype=np.int64).nbytes)
print(np.arange(n, dtype=np.int8).nbytes)
```

```text
8000056
28
8000000
1000000
```

For a million values the list needs roughly 8 MB for its references plus about 28 MB for the integer objects, around 36 MB in all. The same values in an `int64` array cost 8 MB, and in an `int8` array just 1 MB (this works only when the values fit in a byte).

**Convenience.** Vectorization is also less code. Totalling two columns is `a + b`, with no loop, no index bookkeeping, and no accumulator list. Operations read like the mathematics they express, which is the convenience that makes NumPy the base of the scientific Python stack.

| | Python list | NumPy array |
| :--- | :--- | :--- |
| Element type | mixed | one shared `dtype` |
| Memory layout | scattered object references | one contiguous block |
| Elementwise sum | explicit loop | `a + b` |
| Speed on large data | slow (interpreted loop) | fast (compiled, vectorized) |

---

## Advanced indexing

Before the new techniques, recall the normal indexing and slicing from [[NumPy Fundamentals]]. On a 2D array you pass one index or slice per axis, separated by a comma: the first selects rows, the second selects columns.

```python
import numpy as np

m = np.arange(30).reshape(5, 6)
print(m[2, 3])       # the element at row 2, column 3
print(m[1:4, 2:5])   # the 3 by 3 block from rows 1 to 3, columns 2 to 4
```

```text
15
[[ 8  9 10]
 [14 15 16]
 [20 21 22]]
```

Advanced indexing goes beyond single elements and contiguous slices. The two forms below, fancy and boolean indexing, let you pull arbitrary elements and filter by condition.

---

## Fancy indexing

**Fancy indexing** means indexing with a list or array of indices instead of a single integer or a slice. It pulls out arbitrary rows or columns in any order, even with repeats, which a slice cannot do.

Pass a list of column indices after the row slice to select those columns. Here `[4, 0, 2]` keeps columns 4, 0, and 2 in exactly that order and drops the rest.

```python
import numpy as np

stock = np.arange(10, 70, 2).reshape(6, 5)
stock[:, [4, 0, 2]]
```

```text
array([[18, 10, 14],
       [28, 20, 24],
       [38, 30, 34],
       [48, 40, 44],
       [58, 50, 54],
       [68, 60, 64]])
```

![A row of six cells with values 10 to 60, an index array of 0, 2, 4 pulling out the values 10, 30, and 50 into a smaller result](./ASSETS/fancy_indexing.png)

The index list can reorder or repeat. `stock[[2, 0, 2]]` returns row 2, then row 0, then row 2 again. This is how you reorder rows, build a sample with replacement, or gather specific records by position.

```python
import numpy as np

stock = np.arange(10, 70, 2).reshape(6, 5)
stock[[2, 0, 2]]
```

```text
array([[30, 32, 34, 36, 38],
       [10, 12, 14, 16, 18],
       [30, 32, 34, 36, 38]])
```

A basic slice and a fancy index also differ in what they hand back. A slice such as `lane[2:5]` is a **view**: it shares memory with `lane`, so writing into it changes `lane`. Fancy indexing such as `lane[[2, 3, 4]]`, and boolean indexing too, returns a new **copy**, so edits to the result leave the original untouched.

```python
import numpy as np

lane = np.arange(10, 70, 10)
window = lane[2:5]          # slice: a view
window[0] = -1
print(lane)

other = np.arange(10, 70, 10)
picked = other[[2, 3, 4]]   # fancy index: a copy
picked[0] = -1
print(other)
```

```text
[10 20 -1 40 50 60]
[10 20 30 40 50 60]
```

> [!warning]
> Editing a slice silently edits the original array. Call `.copy()` on the slice, as in `lane[2:5].copy()`, when you need an independent array.

---

## Boolean indexing

**Boolean indexing** filters an array with a boolean mask: a same-shaped array of `True` and `False` values, usually produced by a comparison. Indexing with the mask returns a 1D array of the elements where the mask is `True`.

The mask comes from a relational operation, exactly the scalar comparison from [[NumPy Fundamentals]]. The examples use a fixed array of temperature readings so the outputs are reproducible.

```python
import numpy as np

temps = np.array([[18, 31, 25, 40],
                  [12, 36, 29, 22],
                  [33, 15, 38, 27],
                  [24, 41, 19, 30],
                  [35, 21, 28, 16]])
# all readings above 30
temps[temps > 30]
```

```text
array([31, 40, 36, 33, 38, 41, 35])
```

![An array of six values, a boolean mask of the same shape marking which are greater than ten, and the shorter filtered result](./ASSETS/boolean_mask.png)

A condition on the remainder selects the odd numbers.

```python
import numpy as np

temps = np.array([[18, 31, 25, 40],
                  [12, 36, 29, 22],
                  [33, 15, 38, 27],
                  [24, 41, 19, 30],
                  [35, 21, 28, 16]])
# odd readings
temps[temps % 2 == 1]
```

```text
array([31, 25, 29, 33, 15, 27, 41, 19, 35, 21])
```

Combine conditions with the bitwise operators `&` (and), `|` (or), and `~` (not). Each condition must be wrapped in parentheses because `&` binds tighter than the comparison. Here the mask keeps values that are both above 25 and odd.

```python
import numpy as np

temps = np.array([[18, 31, 25, 40],
                  [12, 36, 29, 22],
                  [33, 15, 38, 27],
                  [24, 41, 19, 30],
                  [35, 21, 28, 16]])
# above 25 and odd
temps[(temps > 25) & (temps % 2 == 1)]
```

```text
array([31, 29, 33, 27, 41, 35])
```

The `~` operator negates a mask. Here it keeps the values that are not divisible by 3.

```python
import numpy as np

temps = np.array([[18, 31, 25, 40],
                  [12, 36, 29, 22],
                  [33, 15, 38, 27],
                  [24, 41, 19, 30],
                  [35, 21, 28, 16]])
# not divisible by 3
temps[~(temps % 3 == 0)]
```

```text
array([31, 25, 40, 29, 22, 38, 41, 19, 35, 28, 16])
```

> [!warning]
> Use `&`, `|`, and `~`, not the Python keywords `and`, `or`, and `not`. The keywords try to evaluate the whole array as a single truth value and raise `ValueError: The truth value of an array with more than one element is ambiguous`. The bitwise operators work element by element, which is what a mask needs.

---

## Broadcasting

**Broadcasting** is how NumPy combines arrays of different shapes in an arithmetic operation. The smaller array is stretched across the larger one so the two line up, without copying data. It is what lets you add a row vector to every row of a matrix, or scale a matrix by a per-column factor, with no loop.

When the shapes already match, the operation is a plain elementwise combine.

```python
import numpy as np

u = np.arange(1, 7).reshape(2, 3)
v = np.arange(10, 70, 10).reshape(2, 3)
print(u + v)
```

```text
[[11 22 33]
 [44 55 66]]
```

When the shapes differ, broadcasting can still make them fit. A `(1, 3)` row added to a `(2, 3)` array is reused for every row of the larger array.

```python
import numpy as np

u = np.arange(1, 7).reshape(2, 3)
shift = np.array([[100, 200, 300]])
print(u + shift)
```

```text
[[101 202 303]
 [104 205 306]]
```

The most striking case stretches both operands at once. A `(4, 1)` column and a `(1, 3)` row broadcast to a full `(4, 3)` grid, each contributing along one direction.

```python
import numpy as np

col = np.array([[0], [10], [20], [30]])
row = np.array([[1, 2, 3]])
print(col + row)
```

```text
[[ 1  2  3]
 [11 12 13]
 [21 22 23]
 [31 32 33]]
```

![A column of shape 3 by 1 stretched across and a row of shape 1 by 3 stretched down, combining into a 3 by 3 grid of elementwise sums](./ASSETS/broadcasting_stretch.png)

### Broadcasting rules

NumPy compares the shapes of the two arrays axis by axis, starting from the trailing (rightmost) axis, and applies two rules.

1. **Match the number of dimensions.** If one array has fewer dimensions, NumPy prepends axes of size 1 to its shape until both have the same number of axes. So a 1D `(3,)` array is treated as `(1, 3)` when combined with a 2D array.
2. **Match each axis.** For every axis, the sizes must be equal, or one of them must be 1. An axis of size 1 is stretched to match the other. If two axes differ and neither is 1, the shapes are incompatible and NumPy raises a `ValueError`.

A 1D `(3,)` array adds cleanly to a `(4, 3)` array: rule 1 pads it to `(1, 3)`, then rule 2 stretches the leading 1 to 4. Here a per-subject bonus is added to the marks of four students.

```python
import numpy as np

marks = np.array([[70, 82, 65],
                  [91, 58, 77],
                  [60, 88, 94],
                  [73, 69, 81]])
bonus = np.array([5, 0, 10])
print(marks + bonus)
```

```text
[[ 75  82  75]
 [ 96  58  87]
 [ 65  88 104]
 [ 78  69  91]]
```

Broadcasting fails when a non-unit axis does not match. Each pairing below triggers a `ValueError`, so read them rather than run them.

```python
# cortex:norun
import numpy as np

# (2, 5) with (2,) -> padded to (1, 2); trailing 5 vs 2 mismatch
np.ones((2, 5)) + np.ones(2)

# (3, 4) with (4, 3) -> trailing 4 vs 3 mismatch
np.ones((3, 4)) + np.ones((4, 3))

# (6, 6) with (3, 3) -> 6 vs 3 on both axes, neither is 1
np.ones((6, 6)) + np.ones((3, 3))
```

> [!tip]
> To predict a broadcast, write the two shapes right-aligned and scan each column. Every column must read "equal" or "one of them is 1". The first column that reads neither is where it fails.

---

## Working with mathematical formulas

Because NumPy functions are vectorized, a formula written once applies to a whole array. The elementwise functions such as `np.sin`, `np.exp`, and `np.log` are the building blocks.

```python
import numpy as np

x = np.linspace(0, np.pi, 5)
print(np.round(np.cos(x), 3))
```

```text
[ 1.     0.707  0.    -0.707 -1.   ]
```

The **sigmoid** function maps any real number into the open interval from 0 to 1, which is why it turns a score into a probability. It is defined as

$$
\sigma(x) = \frac{1}{1 + e^{-x}}
$$

where $x$ is the input value (a real number) and $\sigma(x)$ is the output in the range from 0 to 1. The vectorized NumPy form applies it to every element of an array at once.

```python
import numpy as np

def sigmoid(z):
    return 1 / (1 + np.exp(-z))

sigmoid(np.array([-4, -0.5, 0, 2, 6]))
```

```text
array([0.01798621, 0.37754067, 0.5       , 0.88079708, 0.99752738])
```

The **mean squared error** measures how far predictions sit from the true values, averaged over all samples. It is defined as

$$
\text{MSE} = \frac{1}{n} \sum_{i=1}^{n} (y_i - \hat{y}_i)^2
$$

where $n$ is the number of samples, $y_i$ is the true value of sample $i$, and $\hat{y}_i$ is the predicted value of sample $i$. In NumPy the subtraction, squaring, and averaging are all vectorized, so the whole formula is one line.

```python
import numpy as np

def mse(actual, predicted):
    return np.mean((actual - predicted) ** 2)

actual = np.array([12.0, 7.5, 9.0, 15.0])
predicted = np.array([11.0, 9.0, 9.0, 18.0])
print(mse(actual, predicted))
```

```text
3.0625
```

The **binary cross-entropy** loss scores probability predictions for a two-class problem, punishing a confident wrong answer heavily. It is defined as

$$
\text{BCE} = -\frac{1}{n} \sum_{i=1}^{n} \left[ y_i \log(\hat{y}_i) + (1 - y_i) \log(1 - \hat{y}_i) \right]
$$

where $n$ is the number of samples, $y_i$ is the true label (0 or 1) of sample $i$, and $\hat{y}_i$ is the predicted probability that sample $i$ belongs to class 1. The NumPy expression mirrors the formula term for term.

```python
import numpy as np

labels = np.array([0, 1, 1, 0])
probs = np.array([0.2, 0.6, 0.95, 0.4])
bce = -np.mean(labels * np.log(probs) + (1 - labels) * np.log(1 - probs))
print(round(bce, 6))
```

```text
0.324022
```

---

## Working with missing values

Real data has gaps. NumPy marks a missing numeric value with **`np.nan`** (not a number), a special float. Any array that holds a `np.nan` becomes a float array, and arithmetic that touches a `np.nan` returns `np.nan`.

```python
import numpy as np

readings = np.array([21.5, np.nan, 19.0, 23.5, np.nan, 20.0])
print(readings)
print(readings.sum())
```

```text
[21.5  nan 19.  23.5  nan 20. ]
nan
```

You cannot test for `np.nan` with `==`, because `np.nan` does not equal anything, including itself. Use **`np.isnan`**, which returns a boolean mask marking the missing entries. Negate that mask with `~` to keep only the present values, which is boolean indexing again.

```python
import numpy as np

readings = np.array([21.5, np.nan, 19.0, 23.5, np.nan, 20.0])
clean = readings[~np.isnan(readings)]
print(clean)
print(clean.mean())
```

```text
[21.5 19.  23.5 20. ]
21.0
```

---

## Plotting graphs

NumPy pairs naturally with `matplotlib`: build the x values with `np.linspace`, compute the y values with a vectorized expression, and hand both to `plt.plot`. The fences below emit a figure rather than text, and in-browser figure capture is out of scope, so they are marked copy-only; run them in a notebook to see the curve.

A straight line with a slope and an offset, `y = 2x + 1`, is the simplest case.

```python
# cortex:norun
import numpy as np
import matplotlib.pyplot as plt

x = np.linspace(-5, 5, 200)
y = 2 * x + 1
plt.plot(x, y)
```

A cubic, `y = x` cubed, bends down on the left of zero and up on the right.

```python
# cortex:norun
import numpy as np
import matplotlib.pyplot as plt

x = np.linspace(-5, 5, 200)
y = x ** 3
plt.plot(x, y)
```

The cosine curve, `y = cos(x)`, oscillates between -1 and 1.

```python
# cortex:norun
import numpy as np
import matplotlib.pyplot as plt

x = np.linspace(-5, 5, 200)
y = np.cos(x)
plt.plot(x, y)
```

Plotting `y = sqrt(x)` is only defined for non-negative `x`. For the negative half of the range, `np.sqrt` returns `np.nan` with a runtime warning, and matplotlib simply leaves that part of the curve blank.

```python
# cortex:norun
import numpy as np
import matplotlib.pyplot as plt

x = np.linspace(-5, 5, 200)
y = np.sqrt(x)
plt.plot(x, y)
```

The hyperbolic tangent, `y = tanh(x)`, is the sigmoid's rescaled cousin (`tanh(x)` equals `2 * sigmoid(2x) - 1`). It has the same S shape, squashing any input into the range from -1 to 1.

```python
# cortex:norun
import numpy as np
import matplotlib.pyplot as plt

x = np.linspace(-5, 5, 200)
y = np.tanh(x)
plt.plot(x, y)
```

---

## Meshgrids

**`np.meshgrid`** turns two 1D coordinate arrays into a pair of 2D grids, one holding the x coordinate at every grid point and the other holding the y coordinate. It is how you evaluate a function of two variables over a rectangular grid, which plotting a surface or a contour requires.

```python
import numpy as np

cols = np.array([10, 20, 30])
rows = np.array([1, 2])
xx, yy = np.meshgrid(cols, rows)
print(xx)
print(yy)
print(xx * yy)
```

```text
[[10 20 30]
 [10 20 30]]
[[1 1 1]
 [2 2 2]]
[[10 20 30]
 [20 40 60]]
```

Every position `(row, col)` in the grid now has its x coordinate in `xx` and its y coordinate in `yy`, so a vectorized expression such as `xx * yy` (printed last) evaluates the function at all points at once.

---

## Summary

1. A NumPy array beats a Python list on speed (vectorized compiled loops over contiguous memory), memory (one packed block with a chosen `dtype`), and convenience (operations read like the math).
2. **Fancy indexing** uses a list or array of indices to pull arbitrary rows or columns, in any order and with repeats, which a slice cannot do.
3. **Boolean indexing** filters with a same-shaped mask from a comparison; combine masks with `&`, `|`, and `~`, wrapping each condition in parentheses, and never with the keywords `and`, `or`, or `not`.
4. **Broadcasting** stretches arrays of different shapes to fit: compare shapes from the trailing axis, pad the shorter with leading size-1 axes, then stretch any size-1 axis; a mismatch where neither axis is 1 raises a `ValueError`.
5. Vectorized formulas apply to a whole array at once: the sigmoid is `1 / (1 + np.exp(-x))`, the mean squared error is `np.mean((actual - predicted) ** 2)`, and binary cross-entropy follows its formula term for term.
6. Mark missing values with `np.nan`, detect them with `np.isnan` (never `==`), and drop them with `a[~np.isnan(a)]`.
7. Plot with `matplotlib` by building x with `np.linspace` and y with a vectorized expression; `np.meshgrid` builds the coordinate grids for functions of two variables.

---

> [!info] Continues to
> Next, [[NumPy Tricks]] gathers the most useful array utilities: sorting, searching with `np.where`, set operations, percentiles, and the reshaping and comparison helpers you reach for every day.

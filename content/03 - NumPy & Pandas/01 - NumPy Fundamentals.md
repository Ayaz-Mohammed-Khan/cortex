---
tags:
  - numpy
  - arrays
  - ndarray
  - scientific-computing
aliases:
  - NumPy Fundamentals
  - NumPy Arrays
  - ndarray
difficulty: beginner
runnable: true
prerequisites:
  - Lists
created: 2026-10-13
---

> [!info] Where this fits
> This builds on [[Lists]], whose array-versus-list contrast and indexing carry straight over. NumPy is the foundation of the scientific Python stack: pandas, scikit-learn, and the deep learning libraries all store their data as NumPy arrays. Once you can create, reshape, and operate on arrays, you continue to [[Advanced NumPy]].

**NumPy** is the fundamental package for numerical computing in Python. Its core is the `ndarray`, an n-dimensional array of values that all share one data type. A Python list can hold anything and grows on demand, which is convenient but slow. A NumPy array fixes the type and the size so the data sits in one compact block that the CPU can race through. This note covers what the `ndarray` is, how to create and inspect arrays, how to compute with them element by element, and how to index, reshape, stack, and split them.

---

## What NumPy is

A **NumPy array** (`ndarray`) is a grid of values of a single type, stored in one contiguous block of memory. Two properties set it apart from a Python list.

- **Homogeneous.** Every element has the same data type, so every element takes the same number of bytes. A list is heterogeneous and can mix types.
- **Fixed size.** The size is set when the array is created. Growing an array creates a new array and discards the old one, whereas a list grows in place.

These constraints are the source of NumPy's speed. Because the elements are the same size and packed together, NumPy runs tight, compiled loops over the whole block and applies one operation to every element at once. That style is called **vectorization**, and it replaces slow Python-level loops with fast array-level operations.

An array also has a number of dimensions. A 1D array is a vector, a 2D array is a matrix, and a 3D array is a stack of matrices. The number of dimensions is the array's **rank**, and NumPy calls each dimension an **axis**.

![A 1D vector, a 2D matrix, and a 3D cube shown side by side to tie ndim and shape to a mental picture](./ASSETS/ndarray_dimensions.png)

> [!note]
> NumPy ships many derived objects and routines (matrices, masked arrays, Fourier transforms, linear algebra, random sampling), but the `ndarray` is the object everything else is built on. Learn it first.

---

## Creating arrays

The import convention is universal: `import numpy as np`. The simplest constructor, `np.array`, turns a Python list into a 1D array.

```python
import numpy as np

ages = np.array([34, 29, 41, 52])
print(ages)
```

```text
[34 29 41 52]
```

Nest lists to build higher dimensions. One level of nesting gives a 2D array (a matrix), two levels give a 3D array.

```python
import numpy as np

table = np.array([[10, 20, 30, 40], [50, 60, 70, 80]])
print(table)

crate = np.array([[[1, 3], [5, 7]], [[2, 4], [6, 8]]])
print(crate)
```

```text
[[10 20 30 40]
 [50 60 70 80]]
[[[1 3]
  [5 7]]

 [[2 4]
  [6 8]]]
```

Pass `dtype=` to force a type at creation. Here integers become floats.

```python
# cortex:norun
np.array([4, 5, 6], dtype=float)
# array([4., 5., 6.])
```

Typing out every element is impractical, so NumPy provides routines that generate arrays.

| Routine | What it makes |
| :--- | :--- |
| `np.arange(start, stop, step)` | evenly spaced values, like `range` but returning an array |
| `np.ones(shape)` | an array filled with `1.0` |
| `np.zeros(shape)` | an array filled with `0.0` |
| `np.random.random(shape)` | an array of random floats in `[0, 1)` |
| `np.linspace(start, stop, num)` | `num` values spaced evenly between `start` and `stop` inclusive |
| `np.identity(n)` | the `n` by `n` identity matrix |

`np.arange` takes a step, exactly like the built-in `range`. Counting down works too, with a negative step.

```python
import numpy as np

print(np.arange(3, 30, 4))
print(np.arange(50, 0, -12))
```

```text
[ 3  7 11 15 19 23 27]
[50 38 26 14  2]
```

Chain `.reshape` to fold a flat range into any shape whose sizes multiply to the element count. Here 24 elements become a 2 by 3 by 4 array: two blocks, each with three rows and four columns.

```python
import numpy as np

np.arange(24).reshape(2, 3, 4)
```

```text
array([[[ 0,  1,  2,  3],
        [ 4,  5,  6,  7],
        [ 8,  9, 10, 11]],

       [[12, 13, 14, 15],
        [16, 17, 18, 19],
        [20, 21, 22, 23]]])
```

`np.ones` and `np.zeros` take a shape tuple and are the usual way to pre-allocate an array you will fill later.

```python
import numpy as np

print(np.ones((2, 5)))
print(np.zeros((4, 2)))
```

```text
[[1. 1. 1. 1. 1.]
 [1. 1. 1. 1. 1.]]
[[0. 0.]
 [0. 0.]
 [0. 0.]
 [0. 0.]]
```

`np.random.random` fills a shape with random floats between 0 and 1. The values change on every run unless you fix the generator first with `np.random.seed`, which is what the example does so you can compare your output with the one shown.

```python
import numpy as np

np.random.seed(7)
np.random.random((2, 5))
```

```text
array([[0.07630829, 0.77991879, 0.43840923, 0.72346518, 0.97798951],
       [0.53849587, 0.50112046, 0.07205113, 0.26843898, 0.4998825 ]])
```

`np.linspace` differs from `np.arange` in what you fix. With `arange` you choose the step and NumPy decides how many values you get. With `linspace` you choose how many values you want and NumPy computes the spacing to fit them between the endpoints inclusive.

```python
import numpy as np

print(np.linspace(0, 100, 5))
print(np.linspace(5, 6, 4))
```

```text
[  0.  25.  50.  75. 100.]
[5.         5.33333333 5.66666667 6.        ]
```

`np.identity` returns a square matrix with ones on the diagonal and zeros elsewhere.

```python
import numpy as np

np.identity(4)
```

```text
array([[1., 0., 0., 0.],
       [0., 1., 0., 0.],
       [0., 0., 1., 0.],
       [0., 0., 0., 1.]])
```

---

## Array attributes

Every array carries metadata you read through attributes, not function calls. The example below builds three arrays of different ranks and prints their attributes.

```python
import numpy as np

ids = np.arange(6, dtype=np.int32)                 # 1D, 6 ints
grid = np.arange(20, dtype=float).reshape(4, 5)    # 2D, 4 by 5 floats
cube = np.arange(24, dtype=np.int64).reshape(2, 3, 4)  # 3D, 2 by 3 by 4

print(cube.ndim)
print(cube.shape)
print(grid.size)
print(cube.itemsize)
print(ids.dtype, grid.dtype, cube.dtype)
```

```text
3
(2, 3, 4)
20
8
int32 float64 int64
```

| Attribute | Returns | Value for the arrays above |
| :--- | :--- | :--- |
| `ndim` | number of dimensions (axes) | `cube.ndim` is `3` |
| `shape` | size along each axis, as a tuple | `cube.shape` is `(2, 3, 4)` |
| `size` | total number of elements | `grid.size` is `20` |
| `itemsize` | bytes used by one element | `cube.itemsize` is `8` |
| `dtype` | the element data type | `ids.dtype` is `int32` |

`ndim` counts the axes, which equals the depth of nesting. `shape` gives the length of every axis, and the product of the shape equals `size`: `2 * 3 * 4` is 24 elements in `cube`.

`itemsize` reports the bytes per element, which follows directly from the `dtype`. An `int64` or `float64` element takes 8 bytes, an `int32` element takes 4. Multiply `size` by `itemsize` to get the total bytes, which NumPy also reports as `nbytes`.

---

## Changing the data type

Casting an array to another type is useful when you want to shrink memory (store small integers as `int8`) or move between integers and floats. **`astype`** returns a new array with the requested `dtype`; it does not change the original in place.

```python
import numpy as np

levels = np.arange(100, 106, dtype=np.int64)
small = levels.astype(np.int8)
print(levels.dtype, levels.nbytes)
print(small.dtype, small.nbytes)
print(levels.astype(float))
```

```text
int64 48
int8 6
[100. 101. 102. 103. 104. 105.]
```

> [!tip]
> Narrowing the `dtype` is the simplest way to cut an array's memory footprint. An array of values that never exceed 127 fits in `int8` and uses one eighth of the memory of the default `int64`.

---

## Array operations

Arithmetic and comparison operators work on whole arrays at once, element by element, with no loop. Two same-shaped arrays line up position by position.

```python
import numpy as np

p = np.arange(1, 13).reshape(3, 4)
q = np.arange(20, 8, -1).reshape(3, 4)
print(p + q)
print(p * q)
```

```text
[[21 21 21 21]
 [21 21 21 21]
 [21 21 21 21]]
[[ 20  38  54  68]
 [ 80  90  98 104]
 [108 110 110 108]]
```

Comparison operators work the same way and return a boolean array of the same shape, one `True` or `False` per element. That boolean array is the basis of the filtering you will meet in [[Advanced NumPy]].

---

## Scalar and vector operations

NumPy distinguishes two cases, and both avoid an explicit loop.

- **Scalar operation:** one array and one plain number. The number is applied to every element.
- **Vector operation:** two arrays of the same shape. The operator is applied position by position.

A scalar arithmetic operation applies the number everywhere. Cubing an array cubes each element.

```python
import numpy as np

p = np.arange(1, 13).reshape(3, 4)
p ** 3
```

```text
array([[   1,    8,   27,   64],
       [ 125,  216,  343,  512],
       [ 729, 1000, 1331, 1728]])
```

A scalar relational operation compares every element against the number and returns a boolean array.

```python
import numpy as np

q = np.arange(20, 8, -1).reshape(3, 4)
q >= 15
```

```text
array([[ True,  True,  True,  True],
       [ True,  True, False, False],
       [False, False, False, False]])
```

A vector operation combines two arrays element by element. Here each element of `base` is raised to the matching element of `power`.

```python
import numpy as np

base = np.array([[3, 7, 11], [15, 19, 23]], dtype=np.int64)
power = np.array([[4, 9, 17], [24, 28, 40]], dtype=np.int64)
base ** power
```

```text
array([[                  81,             40353607,   505447028499293771],
       [-4797504088901905791, -6131528708192907151, -2425797740717627583]])
```

> [!warning]
> The wrapped and negative values in that last result are integer overflow. Raising large integers to large powers exceeds the range of a 64-bit integer, and NumPy wraps around rather than switching to arbitrary precision the way a plain Python `int` would. Watch the `dtype` when exponents grow.

---

## Array functions

NumPy provides reductions that collapse an array to a summary and element-wise functions that transform every value. The examples below each rebuild the same 3 by 3 array of whole numbers, so every output is reproducible. The shapes and behavior are what matter.

**Reductions** such as `np.sum`, `np.prod`, `np.max`, and `np.min` collapse the array. The `axis` argument chooses the direction of the collapse: `axis=0` reduces down the columns, `axis=1` reduces across the rows. With no `axis`, the whole array reduces to one number.

![A 2D array labelled with axis 0 running down the rows and axis 1 running across the columns](./ASSETS/array_axes.png)

```python
import numpy as np

m = np.array([[12, 45, 8], [67, 23, 90], [34, 56, 19]])
print(np.sum(m, axis=0))   # total of each column
print(np.max(m, axis=1))   # largest in each row
print(np.min(m))           # smallest overall
```

```text
[113 124 117]
[45 90 56]
8
```

**Statistical functions** `np.mean`, `np.median`, `np.std`, and `np.var` take the same `axis` argument. Here the mean and the variance are computed across each row.

```python
import numpy as np

m = np.array([[12, 45, 8], [67, 23, 90], [34, 56, 19]])
print(np.mean(m, axis=1))
print(np.var(m, axis=1))
```

```text
[21.66666667 60.         36.33333333]
[274.88888889 772.66666667 230.88888889]
```

**Trigonometric functions** such as `np.sin` and `np.cos` apply element-wise and return an array of the same shape. They expect radians, so a quarter turn is `np.pi / 2`.

```python
import numpy as np

angles = np.array([0, np.pi / 6, np.pi / 2, np.pi])
print(np.round(np.sin(angles), 3))
print(np.round(np.cos(angles), 3))
```

```text
[0.  0.5 1.  0. ]
[ 1.     0.866  0.    -1.   ]
```

**Logarithm and exponential** functions `np.log` and `np.exp` also apply to every element, and they undo each other.

```python
import numpy as np

m = np.array([[12, 45, 8], [67, 23, 90], [34, 56, 19]])
print(np.round(np.log(m), 2))
print(np.exp(np.array([0, 1, 2, 5])))
```

```text
[[2.48 3.81 2.08]
 [4.2  3.14 4.5 ]
 [3.53 4.03 2.94]]
[  1.           2.71828183   7.3890561  148.4131591 ]
```

---

## Rounding functions

Three functions round floating-point arrays, each with a different rule.

- **`np.round`** rounds to the nearest integer (or to a given number of decimals). A value exactly halfway goes to the nearest even integer.
- **`np.floor`** rounds down toward negative infinity.
- **`np.ceil`** rounds up toward positive infinity.

The negative numbers show the difference most clearly: flooring moves them further from zero, ceiling moves them closer.

```python
import numpy as np

vals = np.array([2.5, -1.7, 3.14, 8.5, 0.49, -4.5])
print(np.round(vals))
print(np.floor(vals))
print(np.ceil(vals))
print(np.round(vals, 1))
```

```text
[ 2. -2.  3.  8.  0. -4.]
[ 2. -2.  3.  8.  0. -5.]
[ 3. -1.  4.  9.  1. -4.]
[ 2.5 -1.7  3.1  8.5  0.5 -4.5]
```

---

## The dot product

The **dot product** multiplies two matrices in the linear-algebra sense, not element by element. For `np.dot(A, B)` the arrays must be conformable: the number of columns of `A` must equal the number of rows of `B`. A `(2, 3)` array times a `(3, 4)` array yields a `(2, 4)` result, because each of the 2 rows of `A` is combined with each of the 4 columns of `B`.

```python
import numpy as np

left = np.arange(1, 7).reshape(2, 3)
right = np.arange(12).reshape(3, 4)
result = np.dot(left, right)
print(result)
print(result.shape)
```

```text
[[ 32  38  44  50]
 [ 68  83  98 113]]
(2, 4)
```

> [!warning]
> If the inner dimensions do not match, for example a `(2, 3)` array times another `(2, 3)` array, NumPy raises a `ValueError`. Check that the columns of the left operand equal the rows of the right operand before calling `np.dot`.

---

## Indexing and slicing

Indexing pulls out single elements; slicing pulls out ranges. Both extend the rules from [[Lists]] to multiple dimensions, with one index or slice per axis, separated by commas.

For a 1D array, indexing is identical to a list. For a 2D array, give a row index and a column index: `t[2, 3]` reads row 2, column 3. For a 3D array, supply three indices, one per axis.

```python
import numpy as np

v = np.arange(10, 100, 10)         # 10, 20, ..., 90
t = np.arange(20).reshape(4, 5)
c = np.arange(24).reshape(2, 3, 4)

print(v[3])
print(t[2, 3])
print(c[1, 2, 0])
print(c[0, 1, 3])
```

```text
40
13
20
7
```

**Slicing** uses `start:stop:step` on each axis, with `stop` excluded. A 1D slice with a step skips elements.

On a 2D array, the first slice selects rows and the second selects columns. A lone `:` means the whole axis, and a plain integer picks one position and drops that axis from the result.

```python
import numpy as np

v = np.arange(10, 100, 10)
t = np.arange(20).reshape(4, 5)

print(v[1:8:3])
print(t[1:3, ::2])
print(t[::2, 1::2])
print(t[3, ::2])
print(t[0, :])
print(t[:, 1])
print(t[1:, 2:4])
```

```text
[20 50 80]
[[ 5  7  9]
 [10 12 14]]
[[ 1  3]
 [11 13]]
[15 17 19]
[0 1 2 3 4]
[ 1  6 11 16]
[[ 7  8]
 [12 13]
 [17 18]]
```

On a 3D array, slice each of the three axes. Mixing an integer and slices drops that axis from the result.

```python
import numpy as np

c = np.arange(24).reshape(2, 3, 4)

print(c[:, 1, ::2])
print(c[1, 1:, 2:])
print(c[0, 2, :])
```

```text
[[ 4  6]
 [16 18]]
[[18 19]
 [22 23]]
[ 8  9 10 11]
```

---

## Iterating

A plain `for` loop over an array iterates along **axis 0**, the outermost axis. Over a 1D array you get scalars; over a 2D array you get rows; over a 3D array you get 2D slices.

```python
import numpy as np

t = np.arange(1, 13).reshape(3, 4)
for row in t:
    print(row)
```

```text
[1 2 3 4]
[5 6 7 8]
[ 9 10 11 12]
```

To visit every element regardless of rank, use **`np.nditer`**, which flattens the iteration to one element at a time.

```python
import numpy as np

crate = np.array([[[4, 8, 15]], [[16, 23, 42]]])
for x in np.nditer(crate):
    print(x)
```

```text
4
8
15
16
23
42
```

---

## Reshaping

Three operations rearrange an array without changing its data.

- **`reshape`** returns a new view with a different shape, as long as the element count stays the same.
- **Transpose** (`np.transpose` or the `.T` attribute) swaps the axes, turning rows into columns.
- **`ravel`** flattens any array back to 1D.

![Twelve elements shown first as a flat 1D row, then folded into a 3 by 4 grid in row-major order](./ASSETS/reshape_1d_to_2d.png)

Transpose flips a matrix across its diagonal.

```python
import numpy as np

r = np.arange(1, 9).reshape(2, 4)
print(r)
print(r.T)
```

```text
[[1 2 3 4]
 [5 6 7 8]]
[[1 5]
 [2 6]
 [3 7]
 [4 8]]
```

`ravel` collapses any shape into a single 1D array, reading in row-major order.

```python
import numpy as np

cube = np.arange(100, 124).reshape(2, 3, 4)
cube.ravel()
```

```text
array([100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112,
       113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123])
```

---

## Stacking and splitting

**Stacking** joins arrays into a larger one; **splitting** cuts one array into several. They are inverses.

- **`np.hstack`** stacks horizontally, placing arrays side by side (more columns).
- **`np.vstack`** stacks vertically, placing arrays top to bottom (more rows).
- **`np.hsplit`** splits horizontally into a given number of equal column-wise pieces.
- **`np.vsplit`** splits vertically into equal row-wise pieces.

Horizontal stacking widens the arrays.

```python
import numpy as np

left = np.arange(1, 7).reshape(2, 3)
right = np.arange(-6, 0).reshape(2, 3)
np.hstack((left, right))
```

```text
array([[ 1,  2,  3, -6, -5, -4],
       [ 4,  5,  6, -3, -2, -1]])
```

Vertical stacking deepens them.

```python
import numpy as np

left = np.arange(1, 7).reshape(2, 3)
right = np.arange(-6, 0).reshape(2, 3)
np.vstack((left, right))
```

```text
array([[ 1,  2,  3],
       [ 4,  5,  6],
       [-6, -5, -4],
       [-3, -2, -1]])
```

`np.hsplit` returns a list of arrays. The count must divide the number of columns evenly. A `(2, 6)` array split into 3 gives three `(2, 2)` arrays.

```python
import numpy as np

wide = np.arange(10, 22).reshape(2, 6)
np.hsplit(wide, 3)
```

```text
[array([[10, 11],
       [16, 17]]), array([[12, 13],
       [18, 19]]), array([[14, 15],
       [20, 21]])]
```

`np.vsplit` is the vertical counterpart, and the count must divide the number of rows. A `(6, 4)` array split into 3 gives three `(2, 4)` arrays.

```python
import numpy as np

tall = np.arange(24).reshape(6, 4)
for piece in np.vsplit(tall, 3):
    print(piece)
    print()
```

```text
[[0 1 2 3]
 [4 5 6 7]]

[[ 8  9 10 11]
 [12 13 14 15]]

[[16 17 18 19]
 [20 21 22 23]]

```

> [!warning]
> Both split functions require an even division. Splitting a 6-column array into 4 pieces raises a `ValueError` because 6 is not divisible by 4. Choose a count that divides the relevant axis.

---

## Summary

1. A **NumPy array** (`ndarray`) is a homogeneous, fixed-size, contiguous grid of values; those constraints let NumPy vectorize operations and run far faster than Python loops.
2. Create arrays with `np.array` from nested lists, or generate them with `np.arange`, `np.ones`, `np.zeros`, `np.random.random`, `np.linspace`, and `np.identity`.
3. Inspect an array through its attributes: `ndim`, `shape`, `size`, `itemsize`, and `dtype`.
4. Change an array's type with `astype`, which returns a new array and is the simplest way to cut memory.
5. Operators act element-wise: a scalar is applied to every element, and two same-shaped arrays combine position by position, including relational operators that return boolean arrays.
6. Reductions (`sum`, `prod`, `max`, `min`, `mean`, `median`, `std`, `var`) take an `axis`: `axis=0` collapses columns, `axis=1` collapses rows. Element-wise functions include `sin`, `log`, and `exp`.
7. `np.round`, `np.floor`, and `np.ceil` round to the nearest, down, and up.
8. `np.dot` is the matrix dot product and needs conformable shapes: the columns of the left operand must equal the rows of the right.
9. Index and slice with one entry per axis, separated by commas, using `start:stop:step`; a plain `for` loop walks axis 0, and `np.nditer` visits every element.
10. Rearrange data with `reshape`, transpose (`.T`), and `ravel`; combine and cut arrays with `np.hstack`, `np.vstack`, `np.hsplit`, and `np.vsplit`.

---

> [!info] Continues to
> Next, [[Advanced NumPy]] builds on these basics with fancy and boolean indexing, broadcasting, vectorized mathematical formulas, and handling missing values.

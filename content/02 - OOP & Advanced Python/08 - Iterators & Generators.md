---
tags:
  - python
  - iterators
  - generators
  - memory-efficiency
difficulty: intermediate
prerequisites:
  - Exception Handling
created: 2026-09-29
---

> [!info] Where this fits
> This follows [[Exception Handling]] and builds on classes from [[Classes & Objects]]. It explains what actually happens when you write a `for` loop, and how to produce values one at a time instead of building a whole list in memory, the same memory-saving idea as reading a file in chunks from [[File Handling]]. For data work this is essential: it is how you process a dataset larger than your RAM.

An **iterator** is an object that walks through a sequence one item at a time **without loading the whole sequence into memory**. This note untangles three easily-confused terms (iteration, iterable, iterator), shows how a `for` loop works under the hood, and then introduces **generators**, a compact way to build iterators with a single function. The payoff is being able to process arbitrarily large, even infinite, streams of data in constant memory.

---

## Three terms: iteration, iterable, iterator

These three sound alike and are constantly confused. Pin them down first:

- **Iteration**: the process of taking each item of something, one after another. Any loop over a group of items is iteration.
- **Iterable**: an object you *can* loop over, a list, tuple, set, dict, string.
- **Iterator**: the object that *makes* iteration happen, fetching one item at a time without holding the whole sequence in memory.

```python
L = [1, 2, 3]
for item in L:      # this is ITERATION
    print(item)
# L is an ITERABLE; the object the loop uses internally is an ITERATOR
```

---

## Why iterators matter: memory

The defining feature of an iterator is that it holds **only one item in memory at a time**. This is its entire reason for existing. Compare two ways to double every number up to 100,000:

```python
import sys

# Way 1: build a list, holds all 100,000 numbers in memory
L = [x for x in range(100000)]
sys.getsizeof(L)        # ~800,000 bytes

# Way 2: use range, an iterator, holds one number at a time
x = range(100000)
sys.getsizeof(x)        # 48 bytes, and it stays 48 even for range(10_000_000)
```

Both loops produce the same output, but the list stores every number at once, while `range` generates each number as needed, uses it, discards it, and fetches the next. The list's memory grows with its size; the iterator's does not.

> [!tip]
> This is why you can loop over `range(10_000_000)` without a care: the iterator never materializes ten million numbers. It is the same brick-by-brick idea as chunked file reading, process one item, free it, move on, so the data can be any size while memory stays flat.

---

## Iterable versus iterator, precisely

Both can be looped over, so what separates them? Two rules capture it:

- **Every iterator is an iterable** (you can loop over an iterator).
- **Not every iterable is an iterator.** A list is iterable, but it is *not* an iterator, because it loads all its items into memory at once, breaking the one-item-at-a-time rule.

You can turn an iterable into an iterator with the **`iter()`** function:

```python
L = [1, 2, 3]
type(L)          # <class 'list'>, an iterable
type(iter(L))    # <class 'list_iterator'>, an iterator derived from it
```

### How to tell what something is

Use the `dir()` function to inspect an object's methods:

- An object is **iterable** if it has an `__iter__` method.
- An object is an **iterator** if it has **both `__iter__` and `__next__`**.

```python
L = [1, 2, 3]
'__iter__' in dir(L)              # True, so L is iterable
'__next__' in dir(L)              # False, so L is NOT an iterator

it = iter(L)
'__next__' in dir(it)             # True, so it IS an iterator
```

A quick behavioral check: if a loop runs over it, it is iterable; `for i in 5:` fails because an `int` has no `__iter__`.

---

## How a `for` loop really works

Python's `for` loop has no visible counter or stop condition, yet it walks a list, tuple, or set perfectly. Under the hood it does two things:

1. **Get an iterator** from the iterable, with `iter()`.
2. **Call `next()` repeatedly** on that iterator to pull items, until `next()` raises `StopIteration`.

```python
num = [1, 2, 3]
it = iter(num)       # step 1: get the iterator
next(it)             # 1
next(it)             # 2
next(it)             # 3
next(it)             # raises StopIteration, which the for loop catches to end
```

Each `next()` advances the iterator's internal position and returns the next item; after the last item it raises `StopIteration`. The `for` loop is exactly this, with the error caught silently to stop. You can build the loop yourself:

```python
def my_for(iterable):
    it = iter(iterable)          # get the iterator
    while True:
        try:
            print(next(it))      # pull the next item
        except StopIteration:
            break                # no more items, stop

my_for([1, 2, 3])
my_for(range(1, 5))
my_for({1, 2, 3})               # works on any iterable
```

> [!note]
> Running `iter()` on an iterator returns the **same iterator**, not a new one (`id(it) == id(iter(it))`). This is why an iterator is also iterable: its `__iter__` just returns itself, so a `for` loop can consume it directly.

---

## Building a custom iterator

To give your own object the ability to be looped over, you implement the iterator protocol by hand: an iterable class whose `__iter__` returns an iterator class that implements `__iter__` (returns itself) and `__next__` (produces the next value or raises `StopIteration`). Recreating `range` makes it concrete:

```python
class MyRange:
    def __init__(self, start, end):
        self.start = start
        self.end = end

    def __iter__(self):
        return MyRangeIterator(self)

class MyRangeIterator:
    def __init__(self, iterable):
        self.iterable = iterable

    def __iter__(self):
        return self

    def __next__(self):
        if self.iterable.start >= self.iterable.end:
            raise StopIteration
        current = self.iterable.start
        self.iterable.start += 1
        return current

for i in MyRange(1, 11):
    print(i)        # 1 2 3 ... 10, just like range
```

This works, but it is heavy, two classes and three protocol methods for a simple job. That weight is exactly what generators remove.

---

## Generators

A **generator** is a simple way of creating an iterator. It looks like an ordinary function, with one change: it uses **`yield`** instead of `return`.

```python
def gen_demo():
    yield 'first statement'
    yield 'second statement'
    yield 'third statement'
```

Calling a generator does not run its body; it returns a **generator object** (which is an iterator). You then pull values with `next()` or a `for` loop:

```python
gen = gen_demo()
next(gen)        # 'first statement'
next(gen)        # 'second statement'
next(gen)        # 'third statement'
next(gen)        # raises StopIteration

for item in gen_demo():   # or just loop over it
    print(item)
```

### `yield` versus `return`

This is the heart of generators. The difference in behavior:

| | `return` (normal function) | `yield` (generator) |
| :--- | :--- | :--- |
| On call | runs the whole body, produces one result | runs nothing yet; returns a generator object |
| After producing a value | the function ends and is discarded | the function **pauses**, remembering its state |
| Next call (`next`) | starts over from the top | resumes right after the last `yield` |

A normal function runs once, returns, and is gone from memory. A generator **pauses** at each `yield`, keeps its local variables and position, and the next `next()` call resumes from exactly where it left off. That pause-and-remember behavior is what lets a generator hand out one value at a time without storing them all.

```python
def square(nums):
    for i in range(nums):
        yield i ** 2

gen = square(10)
next(gen)        # 0
next(gen)        # 1
next(gen)        # 4
for i in gen:    # continues from where next() left off: 9, 16, 25, ...
    print(i)
```

The loop picks up where the `next()` calls stopped, because the single generator object holds all the state.

### Generator expressions

For a simple generator you do not even need a function. A **generator expression** is like a list comprehension but with round brackets, and it builds a generator instead of a list:

```python
L = [i ** 2 for i in range(1, 101)]     # list comprehension: builds the whole list
gen = (i ** 2 for i in range(1, 101))   # generator expression: builds a generator

for i in gen:
    print(i)
```

The whole custom `MyRange` class above collapses to this:

```python
def my_range(start, end):
    for i in range(start, end):
        yield i
```

Two lines replace two classes and three protocol methods, same behavior.

---

## Benefits of generators

Generators give you four concrete wins:

- **Ease of implementation**: a two-line function replaces the multi-class iterator boilerplate.
- **Memory efficiency**: like any iterator, a generator holds one item at a time. A list of 10,000 items grows with its size; a generator stays tiny no matter how large.
- **Infinite streams**: you can model data with no end, because only the current value is ever in memory.
- **Chaining**: generators can feed one another to build complex pipelines.

```python
def all_even():
    n = 0
    while True:          # infinite, but safe: only one number in memory
        yield n
        n += 2
```

> [!tip]
> This is why generators are everywhere in data science and deep learning. A 20 GB folder of images will not fit in 8 GB of RAM, so you write a generator that opens one image, converts it to a NumPy array, `yield`s it, and moves to the next. Keras's `ImageDataGenerator` is exactly this: it streams data one batch at a time so the dataset can be any size.

---

## Summary

1. Iteration is traversing items one by one; an iterable is something you can loop over; an iterator is the object that makes iteration happen, holding one item at a time.
2. Iterators matter because they keep only one item in memory, so `range(10_000_000)` costs the same as `range(10)`, unlike a list.
3. Every iterator is iterable, but not every iterable is an iterator (a list loads everything at once); `iter()` turns an iterable into an iterator.
4. An object is iterable if it has `__iter__`, and an iterator if it has both `__iter__` and `__next__`.
5. A `for` loop calls `iter()` once to get an iterator, then `next()` repeatedly until `StopIteration`; you can rebuild it with a `while` loop and `try`/`except`.
6. A custom iterator needs an iterable class and an iterator class implementing `__iter__` and `__next__`, which is verbose.
7. A generator is a function using `yield` instead of `return`; calling it returns a generator object you drive with `next()` or a `for` loop.
8. `yield` pauses the function and remembers its state, resuming on the next call, whereas `return` ends the function; this is what lets a generator produce values lazily.
9. A generator expression `(expr for x in iterable)` builds a generator in one line, like a list comprehension with round brackets.
10. Generators are easy to write, memory-efficient, handle infinite streams, and chain together, which is why they power large-data processing like Keras image generators.

---

> [!info] Continues to
> The final advanced-Python topic is [[Decorators & Namespaces]], which uses the idea of functions as first-class values to wrap and extend other functions, and explains the scope rules that decide which variable a name refers to.
